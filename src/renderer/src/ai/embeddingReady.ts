import type { AIConfig } from "@shared/aiTypes";
import { buildBuiltinEmbeddingIpcPayload } from "@shared/builtinEmbeddingIpc";

/** 内置嵌入未就绪（未下载）时返回提示文案；否则 null（推理时主进程会自动加载） */
export async function getBuiltinEmbeddingBlockMessage(
  cfg: AIConfig,
): Promise<string | null> {
  if (
    !cfg.aiEnabled ||
    !cfg.embeddingEnabled ||
    cfg.embedding.provider !== "builtin"
  ) {
    return null;
  }
  const mid = cfg.embedding.builtinModel.trim();
  try {
    const r = await window.colorTxt.ai.embeddingBuiltinIsCached(
      buildBuiltinEmbeddingIpcPayload(mid, cfg),
    );
    if (!r.ok) return r.error;
    if (!r.cached) {
      return "启用「向量模型」→「内置本地模型」时，需要下载「内置模型」。";
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}
