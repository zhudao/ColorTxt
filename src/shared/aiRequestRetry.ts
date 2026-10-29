export const AI_REQUEST_MAX_RETRIES = 3;

export function isRetryableAiRequestError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("abort")) return false;
  if (/\b(401|403|400)\b/.test(msg)) return false;
  if (lower.includes("未配置对话模型") || lower.includes("未配置")) return false;
  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("socket") ||
    lower.includes("连接") ||
    lower.includes("超时")
  ) {
    return true;
  }
  if (/\b(502|503|504|429)\b/.test(msg)) return true;
  if (lower.includes("closed") && lower.includes("connection")) return true;
  return false;
}
