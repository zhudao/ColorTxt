import type { BookSourceRecord } from "@shared/bookSource/types";

/** 对齐 Legado AppPattern.splitGroupRegex：逗号/中文逗号/分号分隔 */
function splitGroups(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinGroups(groups: Iterable<string>): string {
  return [...groups].join(",");
}

export function addBookSourceGroups(
  source: BookSourceRecord,
  groups: string,
): BookSourceRecord {
  const set = new Set(splitGroups(source.bookSourceGroup));
  for (const g of splitGroups(groups)) set.add(g);
  return { ...source, bookSourceGroup: joinGroups(set) || undefined };
}

export function removeBookSourceGroups(
  source: BookSourceRecord,
  groups: string,
): BookSourceRecord {
  const remove = new Set(splitGroups(groups));
  if (!remove.size) return source;
  const next = splitGroups(source.bookSourceGroup).filter((g) => !remove.has(g));
  return { ...source, bookSourceGroup: joinGroups(next) || undefined };
}

/** 对齐 Legado BookSource.getInvalidGroupNames */
export function getInvalidGroupNames(source: BookSourceRecord): string {
  return splitGroups(source.bookSourceGroup)
    .filter((g) => g.includes("失效") || g === "校验超时")
    .join(",");
}

export function removeInvalidGroups(source: BookSourceRecord): BookSourceRecord {
  return removeBookSourceGroups(source, getInvalidGroupNames(source));
}

/** 对齐 Legado BookSource.removeErrorComment / addErrorComment */
export function removeErrorComment(source: BookSourceRecord): BookSourceRecord {
  const comment = source.bookSourceComment;
  if (!comment?.trim()) return source;
  const next = comment
    .split("\n\n")
    .filter((block) => !block.startsWith("// Error: "))
    .join("\n")
    .trim();
  return { ...source, bookSourceComment: next || undefined };
}

export function addErrorComment(
  source: BookSourceRecord,
  message: string,
): BookSourceRecord {
  const line = `// Error: ${message}`;
  const prev = source.bookSourceComment?.trim();
  return {
    ...source,
    bookSourceComment: prev ? `${line}\n\n${prev}` : line,
  };
}

export function getCheckKeyword(
  source: BookSourceRecord,
  defaultKeyword: string,
): string {
  const kw = source.ruleSearch?.checkKeyWord?.trim();
  return kw || defaultKeyword;
}
