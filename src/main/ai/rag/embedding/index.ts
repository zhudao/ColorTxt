import { openAiCompatEmbeddingsUrl } from "@shared/apiEndpointPresets";
import {
  BUILTIN_EMBEDDING_BATCH_SIZE,
  resolveEmbeddingBatchSize,
  type AIEmbeddingEndpoint,
  type AIConfig,
} from "@shared/aiTypes";
import {
  getBuiltinEmbeddingModel,
  isBuiltinEmbeddingModel,
} from "@shared/builtinEmbeddingModels";
import {
  embedBuiltinTexts,
  isBuiltinModelDownloaded,
  isBuiltinModelLoaded,
  loadBuiltinEmbeddingModel,
} from "./localBackend";

async function ensureBuiltinModelReady(cfg: AIConfig): Promise<void> {
  const modelId = cfg.embedding.builtinModel.trim();
  if (!modelId) throw new Error("MODEL_NOT_CONFIGURED");
  if (isBuiltinModelLoaded(modelId)) return;
  if (!(await isBuiltinModelDownloaded(cfg, modelId))) {
    throw new Error("MODEL_NOT_DOWNLOADED");
  }
  await loadBuiltinEmbeddingModel(cfg, modelId);
}

/** 仅依赖 URL / Key / 模型，不包含 dimension（用于探测向量长度） */
export type EmbeddingEndpointCore = Pick<
  AIEmbeddingEndpoint,
  "provider" | "baseUrl" | "apiKey" | "remoteModel" | "builtinModel"
>;

function parseEmbeddingVectors(json: {
  data?: Array<{ embedding?: number[] }>;
}): number[][] {
  const out: number[][] = [];
  if (Array.isArray(json.data)) {
    for (const row of json.data) {
      if (Array.isArray(row.embedding)) out.push(row.embedding);
    }
  }
  return out;
}

function normalizeEmbeddingModelId(id: string): string {
  return id.trim().toLowerCase();
}

/** 响应 model 与请求 model 是否指向同一模型（兼容 provider/ 前缀差异） */
function embeddingModelIdsMatch(requested: string, returned: string): boolean {
  const a = normalizeEmbeddingModelId(requested);
  const b = normalizeEmbeddingModelId(returned);
  if (!a || !b) return true;
  if (a === b) return true;
  const aTail = a.split("/").pop() ?? a;
  const bTail = b.split("/").pop() ?? b;
  return aTail === bTail;
}

function vectorsNearlyEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 1e-5) return false;
  }
  return true;
}

function assertEmbeddingResponseModel(
  requestedModel: string,
  responseModel: string | undefined,
): void {
  const req = requestedModel.trim();
  const ret = responseModel?.trim() ?? "";
  if (!req || !ret) return;
  if (!embeddingModelIdsMatch(req, ret)) {
    throw new Error(
      `接口返回模型「${ret}」与请求的「${req}」不一致，可能不是嵌入模型或已被服务端替换`,
    );
  }
}

async function postEmbeddingOnce(
  endpoint: EmbeddingEndpointCore,
  batch: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  if (batch.length === 0) return [];

  const url = openAiCompatEmbeddingsUrl(endpoint.baseUrl);
  if (!url) throw new Error("缺少接口地址");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (endpoint.apiKey.trim()) {
    headers.Authorization = `Bearer ${endpoint.apiKey.trim()}`;
  }

  const body = {
    model: endpoint.remoteModel,
    input: batch.length === 1 ? batch[0] : batch,
    encoding_format: "float",
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Embedding HTTP ${res.status}: ${t.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
    model?: string;
    error?: { message?: string };
  };

  if (json.error?.message) {
    throw new Error(json.error.message);
  }

  assertEmbeddingResponseModel(endpoint.remoteModel, json.model);

  const out = parseEmbeddingVectors(json);
  if (out.length === 0) {
    throw new Error("Embedding 响应格式无效");
  }

  return out;
}

export async function probeEmbeddingDimension(
  endpoint: EmbeddingEndpointCore,
): Promise<number> {
  if (endpoint.provider === "builtin") {
    const m = getBuiltinEmbeddingModel(endpoint.builtinModel);
    if (!m) throw new Error("未知内置模型");
    return m.dimension;
  }
  const probeInputs = [".", "__embedding_dim_probe__"];
  const vecs = await postEmbeddingOnce(endpoint, probeInputs, undefined);
  if (vecs.length < probeInputs.length) {
    throw new Error(
      `嵌入接口未返回 ${probeInputs.length} 条向量，当前模型可能不支持嵌入`,
    );
  }
  const len = vecs[0]?.length ?? 0;
  if (len < 1) throw new Error("无法从响应解析向量维度");
  if (vectorsNearlyEqual(vecs[0]!, vecs[1]!)) {
    throw new Error("不同输入得到相同嵌入向量，当前模型可能不是嵌入模型");
  }
  return len;
}

export async function embedTexts(
  endpoint: AIEmbeddingEndpoint,
  texts: string[],
  signal?: AbortSignal,
  cfg?: AIConfig,
): Promise<number[][]> {
  const batchSize =
    endpoint.provider === "builtin"
      ? BUILTIN_EMBEDDING_BATCH_SIZE
      : resolveEmbeddingBatchSize(endpoint);
  const all: number[][] = [];

  if (endpoint.provider === "builtin") {
    if (!cfg) throw new Error("内置嵌入需要完整 AI 配置");
    await ensureBuiltinModelReady(cfg);
    for (let i = 0; i < texts.length; i += batchSize) {
      if (signal?.aborted) {
        const e = new Error("Aborted");
        e.name = "AbortError";
        throw e;
      }
      const batch = texts.slice(i, i + batchSize);
      const part = await embedBuiltinTexts(cfg, batch, signal);
      all.push(...part);
    }
  } else {
    const core: EmbeddingEndpointCore = {
      provider: "remote",
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      remoteModel: endpoint.remoteModel,
      builtinModel: "",
    };
    for (let i = 0; i < texts.length; i += batchSize) {
      if (signal?.aborted) {
        const e = new Error("Aborted");
        e.name = "AbortError";
        throw e;
      }
      const batch = texts.slice(i, i + batchSize);
      const part = await postEmbeddingOnce(core, batch, signal);
      all.push(...part);
    }
  }

  const dim = endpoint.dimension;
  for (const vec of all) {
    if (vec.length !== dim) {
      throw new Error(
        `向量维度 ${vec.length} 与配置 dimension=${dim} 不符`,
      );
    }
  }

  return all;
}

export function isEmbeddingBuiltin(endpoint: AIEmbeddingEndpoint): boolean {
  return endpoint.provider === "builtin";
}

export function assertBuiltinModelId(model: string): void {
  if (!isBuiltinEmbeddingModel(model)) {
    throw new Error(`未知内置模型: ${model}`);
  }
}
