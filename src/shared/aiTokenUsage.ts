import type { AITokenPricePerMillion } from "./aiTypes";
export type AITokenUsageTotals = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 输入中由服务商上下文缓存命中的 token（DeepSeek / OpenAI 等） */
  promptCacheHitTokens?: number;
};

export const ZERO_TOKEN_USAGE: AITokenUsageTotals = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export function addTokenUsage(
  acc: AITokenUsageTotals,
  part: AITokenUsageTotals | null | undefined,
): AITokenUsageTotals {
  if (!part) return acc;
  const promptTokens = acc.promptTokens + (part.promptTokens || 0);
  const completionTokens =
    acc.completionTokens + (part.completionTokens || 0);
  const totalTokens =
    part.totalTokens > 0
      ? acc.totalTokens + part.totalTokens
      : promptTokens + completionTokens;
  const promptCacheHitTokens =
    (acc.promptCacheHitTokens ?? 0) + (part.promptCacheHitTokens ?? 0);
  const out: AITokenUsageTotals = {
    promptTokens,
    completionTokens,
    totalTokens,
  };
  if (promptCacheHitTokens > 0) {
    out.promptCacheHitTokens = promptCacheHitTokens;
  }
  return out;
}

/** 从 usage 对象解析各厂商的「输入缓存命中」token 数 */
function readPromptCacheHitTokens(usage: Record<string, unknown>): number {
  if (typeof usage.prompt_cache_hit_tokens === "number") {
    return Math.max(0, Math.round(usage.prompt_cache_hit_tokens));
  }
  const details = usage.prompt_tokens_details;
  if (details && typeof details === "object") {
    const cached = (details as Record<string, unknown>).cached_tokens;
    if (typeof cached === "number") {
      return Math.max(0, Math.round(cached));
    }
  }
  if (typeof usage.cache_read_input_tokens === "number") {
    return Math.max(0, Math.round(usage.cache_read_input_tokens));
  }
  return 0;
}

export function extractUsageFromChatJson(
  json: unknown,
): AITokenUsageTotals | null {
  if (!json || typeof json !== "object") return null;
  const u = (json as Record<string, unknown>).usage;
  if (!u || typeof u !== "object") return null;
  const usage = u as Record<string, unknown>;
  const promptTokens =
    typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens =
    typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  let totalTokens =
    typeof usage.total_tokens === "number" ? usage.total_tokens : 0;
  if (totalTokens <= 0) totalTokens = promptTokens + completionTokens;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
    return null;
  }
  const out: AITokenUsageTotals = {
    promptTokens,
    completionTokens,
    totalTokens,
  };
  const hit = readPromptCacheHitTokens(usage);
  if (hit > 0) out.promptCacheHitTokens = hit;
  return out;
}

export function formatTokenCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("zh-CN");
}

function isTokenPriceSet(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** 根据用量与单价估算花费；条件不足时返回 null */
export function computeTokenUsageCost(
  usage: AITokenUsageTotals,
  price: AITokenPricePerMillion | null | undefined,
): number | null {
  if (!price) return null;
  if (!isTokenPriceSet(price.output)) return null;
  const hitSet = isTokenPriceSet(price.inputCacheHit);
  const missSet = isTokenPriceSet(price.inputCacheMiss);
  if (!hitSet && !missSet) return null;

  const promptTokens = Math.max(0, usage.promptTokens);
  const completionTokens = Math.max(0, usage.completionTokens);
  const hitRaw = usage.promptCacheHitTokens ?? 0;
  const hitTokens = Math.min(Math.max(0, hitRaw), promptTokens);

  let inputCost = 0;
  if (hitSet && missSet) {
    const missTokens = Math.max(0, promptTokens - hitTokens);
    inputCost =
      (hitTokens * price.inputCacheHit! +
        missTokens * price.inputCacheMiss!) /
      1_000_000;
  } else {
    const rate = (hitSet ? price.inputCacheHit : price.inputCacheMiss)!;
    inputCost = (promptTokens * rate) / 1_000_000;
  }
  const outputCost = (completionTokens * price.output) / 1_000_000;
  return inputCost + outputCost;
}

function trimFixedDecimalZeros(fixed: string): string {
  const dot = fixed.indexOf(".");
  if (dot < 0) return fixed;
  const intPart = fixed.slice(0, dot);
  const frac = fixed.slice(dot + 1).replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : intPart;
}

export function formatTokenUsageCost(amount: number): string {
  const n = Math.max(0, amount);
  let digits: number;
  if (n >= 100) digits = 2;
  else if (n >= 0.1) digits = 3;
  else if (n >= 0.001) digits = 4;
  else digits = 6;
  return `¥${trimFixedDecimalZeros(n.toFixed(digits))}`;
}

export function formatTokenUsageSummaryLine(
  usage: AITokenUsageTotals,
  available: boolean,
  pricePerMillion?: AITokenPricePerMillion | null,
  label = "本次对话消耗 Token",
): string {
  if (!available) {
    return "未能从模型服务获取本次 token 用量（请确认接口支持 usage / stream_options.include_usage）";
  }
  let inputPart = `输入 ${formatTokenCount(usage.promptTokens)}`;
  const hit = usage.promptCacheHitTokens ?? 0;
  if (hit > 0) {
    inputPart += `（缓存命中 ${formatTokenCount(hit)}）`;
  }
  let line = `${label}：${formatTokenCount(usage.totalTokens)}（${inputPart}，输出 ${formatTokenCount(usage.completionTokens)}）`;
  const cost = computeTokenUsageCost(usage, pricePerMillion);
  if (cost != null) {
    line += `，总花费约：${formatTokenUsageCost(cost)}`;
  }
  return line;
}

export function formatTokenUsageActualLine(
  usage: AITokenUsageTotals,
  available: boolean,
  pricePerMillion?: AITokenPricePerMillion | null,
): string {
  return formatTokenUsageSummaryLine(
    usage,
    available,
    pricePerMillion,
    "本次对话消耗 Token",
  );
}
