import { resolveEmbeddingBatchSize } from "@shared/aiTypes";
import type { Chapter } from "../chapter";
import { chunkNovelForAi } from "../utils/aiChunkBook";
import { getBuiltinEmbeddingBlockMessage } from "./embeddingReady";

export function isAiVectorIndexAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

export type AiBookVectorIndexPhase = "chunking" | "embedding" | "indexing";

export type AiBookVectorIndexHooks = {
  onPhase: (phase: AiBookVectorIndexPhase) => void;
  onEmbedProgress: (current: number, total: number) => void;
  clearError: () => void;
  setError: (message: string) => void;
  setPhaseIdle: () => void;
  setPhaseError: () => void;
};

/**
 * 为当前书构建向量索引：分块 → 分批 embed → replaceChunks。
 * 供「AI 阅读助手」与「角色」侧栏 AI 检索共用。
 */
export async function runAiBookVectorIndexBuild(params: {
  signal: AbortSignal;
  embedRequestId: number;
  bookHash: string;
  fullText: string;
  chapters: readonly Chapter[];
  hooks: AiBookVectorIndexHooks;
  /**
   * `throw`：abort 时抛 `AbortError`（阅读助手外层 try 与 `ensureIndexed` 一致）。
   * `returnFalse`：abort 时静默 `setPhaseIdle` 并返回 false（角色侧栏）。
   */
  abortMode: "throw" | "returnFalse";
}): Promise<boolean> {
  const {
    signal,
    embedRequestId,
    bookHash,
    fullText,
    chapters,
    hooks,
    abortMode,
  } = params;

  const abortAsConfigured = (): boolean => {
    if (!signal.aborted) return false;
    if (abortMode === "throw") {
      const e = new Error("Aborted");
      e.name = "AbortError";
      throw e;
    }
    hooks.setPhaseIdle();
    return true;
  };

  if (abortAsConfigured()) return false;

  hooks.clearError();
  const cfg = await window.colorTxt.ai.configGet();
  const blockMsg = await getBuiltinEmbeddingBlockMessage(cfg);
  if (blockMsg) {
    hooks.setPhaseError();
    hooks.setError(blockMsg);
    return false;
  }
  hooks.onPhase("chunking");
  const drafts = chunkNovelForAi({
    fullText,
    chapters: chapters as Chapter[],
    bookHash,
    targetTokens: cfg.chunkTargetTokens,
    minTokens: cfg.chunkMinTokens,
    overlapRatio: cfg.chunkOverlapRatio,
  });

  if (abortAsConfigured()) return false;

  const texts = drafts.map((d) => d.content);
  const embedBatchSize = resolveEmbeddingBatchSize(cfg.embedding);
  hooks.onPhase("embedding");
  const embedTotal = Math.max(
    1,
    Math.ceil(texts.length / embedBatchSize),
  );
  let embedCurrent = 0;
  hooks.onEmbedProgress(embedCurrent, embedTotal);
  const allEmb: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += embedBatchSize) {
      if (abortAsConfigured()) return false;
      const batch = texts.slice(i, i + embedBatchSize);
      const emb = await window.colorTxt.ai.embed(batch, embedRequestId);
      allEmb.push(...emb);
      embedCurrent = Math.min(embedTotal, embedCurrent + 1);
      hooks.onEmbedProgress(embedCurrent, embedTotal);
    }
    if (abortAsConfigured()) return false;
    hooks.onPhase("indexing");
    const records = drafts.map((d, j) => ({
      ...d,
      embedding: allEmb[j]!,
    }));
    const r = await window.colorTxt.ai.indexReplaceChunks(bookHash, records);
    if (!r.ok) {
      hooks.setPhaseError();
      hooks.setError(r.error ?? "索引写入失败");
      return false;
    }
    hooks.setPhaseIdle();
    return true;
  } catch (e) {
    if (signal.aborted || isAiVectorIndexAbortError(e)) {
      hooks.setPhaseIdle();
      hooks.clearError();
      if (abortMode === "throw") throw e;
      return false;
    }
    hooks.setPhaseError();
    hooks.setError(e instanceof Error ? e.message : String(e));
    return false;
  }
}
