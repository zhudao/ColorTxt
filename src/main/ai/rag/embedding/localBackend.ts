import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { access, mkdir, readdir } from "node:fs/promises";
import type { AIConfig, AIEmbeddingEndpoint } from "@shared/aiTypes";
import {
  getBuiltinEmbeddingModel,
  isBuiltinEmbeddingModel,
  resolveHfRemoteHost,
} from "@shared/builtinEmbeddingModels";
import { hfModelIdToCachePathSegments } from "@shared/transformersCachePaths";
import {
  resolveBuiltinModelCacheRoot,
  transformersCacheDirForModelRoot,
} from "../../infra/paths";

type LoadProgressCb = (progress: number) => void;
type EmbedProgressCb = (done: number, total: number) => void;

let worker: Worker | null = null;
let loadedModelId: string | null = null;
let requestCounter = 0;

function workerScriptPath(): string {
  return fileURLToPath(
    new URL("./ai/rag/embedding/worker.js", import.meta.url),
  );
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(workerScriptPath(), {
      type: "module",
    } as import("node:worker_threads").WorkerOptions);
  }
  return worker;
}

function buildLoadPayload(cfg: AIConfig, modelId: string) {
  const model = getBuiltinEmbeddingModel(modelId);
  if (!model) throw new Error(`未知内置模型: ${modelId}`);
  const root = resolveBuiltinModelCacheRoot(cfg);
  return {
    modelId: model.id,
    hfModelId: model.hfModelId,
    hfRemoteHost: resolveHfRemoteHost(cfg.embedding.hfRemoteHost),
    transformersCacheDir: transformersCacheDirForModelRoot(root),
  };
}

export function isBuiltinModelLoaded(modelId: string): boolean {
  return loadedModelId === modelId.trim();
}

export function getLoadedBuiltinModelId(): string | null {
  return loadedModelId;
}

function transformersModelCachePath(
  cfg: AIConfig,
  hfModelId: string,
): string {
  const root = resolveBuiltinModelCacheRoot(cfg);
  const cacheDir = transformersCacheDirForModelRoot(root);
  return path.join(cacheDir, ...hfModelIdToCachePathSegments(hfModelId));
}

export async function isBuiltinModelDownloaded(
  cfg: AIConfig,
  modelId: string,
): Promise<boolean> {
  const model = getBuiltinEmbeddingModel(modelId.trim());
  if (!model) return false;
  const target = transformersModelCachePath(cfg, model.hfModelId);
  try {
    await access(target);
    const entries = await readdir(target);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function loadBuiltinEmbeddingModel(
  cfg: AIConfig,
  modelId: string,
  onProgress?: LoadProgressCb,
): Promise<void> {
  const id = modelId.trim();
  if (!isBuiltinEmbeddingModel(id)) {
    throw new Error(`未知内置模型: ${id}`);
  }
  if (loadedModelId === id) return;

  const root = resolveBuiltinModelCacheRoot(cfg);
  await mkdir(root, { recursive: true });
  await mkdir(transformersCacheDirForModelRoot(root), { recursive: true });

  const w = getWorker();
  const payload = buildLoadPayload(cfg, id);

  await new Promise<void>((resolve, reject) => {
    const onMsg = (raw: unknown) => {
      const m = raw as { type?: string; error?: string; progress?: number };
      if (m.type === "load:progress" && typeof m.progress === "number") {
        onProgress?.(m.progress);
        return;
      }
      if (m.type === "load:done") {
        w.off("message", onMsg);
        w.off("error", onErr);
        resolve();
        return;
      }
      if (m.type === "load:error") {
        w.off("message", onMsg);
        w.off("error", onErr);
        reject(new Error(m.error ?? "load failed"));
      }
    };
    const onErr = (e: Error) => {
      w.off("message", onMsg);
      w.off("error", onErr);
      reject(e);
    };
    w.on("message", onMsg);
    w.on("error", onErr);
    w.postMessage({ type: "load", ...payload });
  });

  loadedModelId = id;
}

export async function embedBuiltinTexts(
  cfg: AIConfig,
  texts: string[],
  signal?: AbortSignal,
  onProgress?: EmbedProgressCb,
): Promise<number[][]> {
  const modelId = cfg.embedding.builtinModel.trim();
  if (!loadedModelId || loadedModelId !== modelId) {
    throw new Error("MODEL_NOT_LOADED");
  }
  if (texts.length === 0) return [];

  const w = getWorker();
  const requestId = `req-${++requestCounter}`;

  const abortListener = () => {
    w.postMessage({ type: "embed:abort", requestId });
  };
  signal?.addEventListener("abort", abortListener, { once: true });

  try {
    return await new Promise<number[][]>((resolve, reject) => {
      const onMsg = (raw: unknown) => {
        const m = raw as {
          type?: string;
          requestId?: string;
          embeddings?: number[][];
          error?: string;
          done?: number;
          total?: number;
        };
        if (m.requestId !== requestId) return;
        if (m.type === "embed:progress") {
          onProgress?.(m.done ?? 0, m.total ?? texts.length);
          return;
        }
        if (m.type === "embed:done") {
          w.off("message", onMsg);
          w.off("error", onErr);
          resolve(m.embeddings ?? []);
          return;
        }
        if (m.type === "embed:error") {
          w.off("message", onMsg);
          w.off("error", onErr);
          reject(new Error(m.error ?? "embed failed"));
        }
      };
      const onErr = (e: Error) => {
        w.off("message", onMsg);
        w.off("error", onErr);
        reject(e);
      };
      w.on("message", onMsg);
      w.on("error", onErr);
      w.postMessage({ type: "embed", requestId, texts });
    });
  } finally {
    signal?.removeEventListener("abort", abortListener);
  }
}

export async function disposeLocalEmbeddingBackend(): Promise<void> {
  loadedModelId = null;
  if (!worker) return;
  const w = worker;
  worker = null;
  w.postMessage({ type: "dispose" });
  await w.terminate().catch(() => undefined);
}

export async function clearBuiltinModelCache(
  cfg: AIConfig,
  modelId: string,
): Promise<void> {
  const model = getBuiltinEmbeddingModel(modelId.trim());
  if (!model) throw new Error(`未知内置模型: ${modelId}`);
  const root = resolveBuiltinModelCacheRoot(cfg);
  const cacheDir = transformersCacheDirForModelRoot(root);
  if (loadedModelId === model.id) loadedModelId = null;
  const w = getWorker();
  await new Promise<void>((resolve, reject) => {
    const onMsg = (raw: unknown) => {
      const m = raw as { type?: string; error?: string };
      if (m.type === "clearCache:done") {
        w.off("message", onMsg);
        w.off("error", onErr);
        resolve();
        return;
      }
      if (m.type === "clearCache:error") {
        w.off("message", onMsg);
        w.off("error", onErr);
        reject(new Error(m.error ?? "clear failed"));
      }
    };
    const onErr = (e: Error) => {
      w.off("message", onMsg);
      w.off("error", onErr);
      reject(e);
    };
    w.on("message", onMsg);
    w.on("error", onErr);
    w.postMessage({
      type: "clearCache",
      hfModelId: model.hfModelId,
      transformersCacheDir: cacheDir,
    });
  });
}

export function resolveBuiltinEndpoint(
  endpoint: AIEmbeddingEndpoint,
): AIEmbeddingEndpoint {
  return endpoint;
}
