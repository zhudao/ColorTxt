/** 未展开的 Legado 规则片段，不应作为标签展示 */
function isSuspiciousMetaTag(tag: string): boolean {
  const t = tag.trim();
  if (!t) return true;
  if (/^\$\.?\.?[\w[*]/.test(t) || /\{\{/.test(t)) return true;
  if (/@(?:text|html|href|src|json)\b/i.test(t) && /[#.:>]/.test(t)) return true;
  if (/\s&&\s*$/.test(t) || t.includes("@text&&")) return true;
  // 误把 HTML 整页写进 kind 时，过滤标签碎片
  if (/^<\/?[a-zA-Z!]/.test(t) || /^<!doctype/i.test(t)) return true;
  return false;
}

/**
 * Legado BaseBook.getKindList：按逗号/换行拆分 kind，保留含空格的日期时间片段。
 * 不按空格拆分，避免 `2026-07-10 18:25:17` 被拆成两个 tag。
 */
export function splitBookMetaTags(kind: string | undefined): string[] {
  if (!kind?.trim()) return [];
  return kind
    .split(/[,，\n\r]+/)
    .map((s) => s.trim().replace(/^\{+|\}+$/g, ""))
    .filter(Boolean)
    .filter((t) => !isSuspiciousMetaTag(t));
}

/** Legado BaseBook.getKindList：先 wordCount，再拆分 kind */
export function getBookKindList(item: {
  kind?: string;
  wordCount?: string;
}): string[] {
  const out: string[] = [];
  const wc = item.wordCount?.trim();
  if (wc) out.push(wc);
  if (item.kind?.trim()) out.push(...splitBookMetaTags(item.kind));
  return out;
}
