import { parentPort } from "node:worker_threads";
import { hfModelIdToCachePathSegments } from "@shared/transformersCachePaths";

type WorkerIn =
  | {
      type: "load";
      modelId: string;
      hfModelId: string;
      hfRemoteHost: string;
      transformersCacheDir: string;
    }
  | { type: "embed"; requestId: string; texts: string[]; abortFlag?: boolean }
  | { type: "embed:abort"; requestId: string }
  | { type: "dispose" }
  | { type: "clearCache"; hfModelId: string; transformersCacheDir: string };

let pipeline: ((
  text: string,
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>) | null = null;
let currentModelId: string | null = null;
const embedAbortByRequest = new Set<string>();

function post(msg: unknown) {
  parentPort?.postMessage(msg);
}

async function handleLoad(msg: Extract<WorkerIn, { type: "load" }>) {
  try {
    if (pipeline && currentModelId === msg.modelId) {
      post({ type: "load:done" });
      return;
    }
    pipeline = null;
    currentModelId = null;

    const { pipeline: createPipeline, env } = await import(
      "@huggingface/transformers"
    );
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.cacheDir = msg.transformersCacheDir;
    env.useFSCache = true;
    env.useBrowserCache = false;
    env.remoteHost = msg.hfRemoteHost.replace(/\/+$/, "");
    // 内置向量仅 CPU；勿用 dml/auto，以便打包时可省略 DirectML.dll
    env.backends.onnx = {
      ...(env.backends.onnx as Record<string, unknown>),
      executionProviders: ["cpu"],
    };

    const created = await createPipeline("feature-extraction", msg.hfModelId, {
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p.status === "progress") {
          post({
            type: "load:progress",
            progress: Math.round(p.progress ?? 0),
          });
        }
      },
    });
    pipeline = created as unknown as NonNullable<typeof pipeline>;
    currentModelId = msg.modelId;
    post({ type: "load:done" });
  } catch (err) {
    post({
      type: "load:error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleEmbed(msg: Extract<WorkerIn, { type: "embed" }>) {
  if (!pipeline) {
    post({
      type: "embed:error",
      requestId: msg.requestId,
      error: "MODEL_NOT_LOADED",
    });
    return;
  }
  try {
    const embeddings: number[][] = [];
    const total = msg.texts.length;
    for (let i = 0; i < total; i++) {
      if (embedAbortByRequest.has(msg.requestId)) {
        embedAbortByRequest.delete(msg.requestId);
        post({
          type: "embed:error",
          requestId: msg.requestId,
          error: "Aborted",
        });
        return;
      }
      const output = await pipeline!(msg.texts[i]!, {
        pooling: "mean",
        normalize: true,
      });
      const dim = output.dims[1] ?? 0;
      embeddings.push(
        Array.from(output.data as Float32Array).slice(0, dim),
      );
      if ((i + 1) % 2 === 0 || i === total - 1) {
        post({
          type: "embed:progress",
          requestId: msg.requestId,
          done: i + 1,
          total,
        });
      }
    }
    embedAbortByRequest.delete(msg.requestId);
    post({ type: "embed:done", requestId: msg.requestId, embeddings });
  } catch (err) {
    embedAbortByRequest.delete(msg.requestId);
    post({
      type: "embed:error",
      requestId: msg.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleDispose() {
  pipeline = null;
  currentModelId = null;
}

async function handleClearCache(msg: Extract<WorkerIn, { type: "clearCache" }>) {
  try {
    await handleDispose();
    const { rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const target = join(
      msg.transformersCacheDir,
      ...hfModelIdToCachePathSegments(msg.hfModelId),
    );
    try {
      await rm(target, { recursive: true, force: true });
    } catch {
      /* ignore missing */
    }
    post({ type: "clearCache:done" });
  } catch (err) {
    post({
      type: "clearCache:error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

parentPort?.on("message", (msg: WorkerIn) => {
  if (msg.type === "load") void handleLoad(msg);
  else if (msg.type === "embed") void handleEmbed(msg);
  else if (msg.type === "embed:abort") embedAbortByRequest.add(msg.requestId);
  else if (msg.type === "dispose") void handleDispose();
  else if (msg.type === "clearCache") void handleClearCache(msg);
});
