/** 工具入参在列表/导出中的摘要长度（须保持合法 JSON，不可裸截断字符串） */
export const TOOL_ARGS_PREVIEW_MAX = 400;

const LONG_ARG_FIELDS = [
  "markdown",
  "mergedMarkdown",
  "content",
  "reasoning",
] as const;

function shrinkLongStringFields(
  obj: Record<string, unknown>,
  fieldMax: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const key of LONG_ARG_FIELDS) {
    const v = out[key];
    if (typeof v !== "string" || v.length <= fieldMax) continue;
    out[key] = `${v.slice(0, fieldMax)}…（共 ${v.length} 字）`;
  }
  return out;
}

/**
 * 生成工具参数单行摘要：解析 JSON 后仅缩短大字段，避免 `previewJson` 在字符串中间截断导致无法 `JSON.parse`。
 */
export function summarizeToolArgumentsJson(
  raw: string,
  maxLen = TOOL_ARGS_PREVIEW_MAX,
): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  try {
    const parsed: unknown = JSON.parse(t);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const s = JSON.stringify(parsed);
      return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
    }
    const obj = parsed as Record<string, unknown>;
    for (let fieldMax = 120; fieldMax >= 32; fieldMax -= 32) {
      const slim = shrinkLongStringFields(obj, fieldMax);
      const s = JSON.stringify(slim);
      if (s.length <= maxLen) return s;
    }
    const minimal = shrinkLongStringFields(obj, 32);
    const s = JSON.stringify(minimal);
    return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
  } catch {
    return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`;
  }
}

/** 折叠区「请求」展示用：尽量返回可解析的完整参数 JSON 文本 */
export function normalizeToolArgumentsDisplayJson(raw: string): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  try {
    return JSON.stringify(JSON.parse(t));
  } catch {
    return t;
  }
}
