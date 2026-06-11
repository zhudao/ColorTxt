import { dirnameFs, joinFs } from "../ebook/pathUtils";

const RE_MD_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export type BlockMarkdownImageLine = {
  line: number;
  absPath: string;
};

function isRemoteImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function isAbsolutePathUrl(url: string): boolean {
  const u = url.trim();
  return /^[a-zA-Z]:[\\/]/.test(u) || u.startsWith("/");
}

/** 块级 `![alt](url)` 的 url → 插图绝对路径或 https URL */
export function resolveMarkdownBlockImageAbsPath(
  url: string,
  mdFileAbsPath: string,
): string {
  const trimmed = url.trim();
  if (isRemoteImageUrl(trimmed)) return trimmed;
  if (isAbsolutePathUrl(trimmed)) {
    return trimmed.replace(/\\/g, "/");
  }
  const baseDir = dirnameFs(mdFileAbsPath.replace(/\\/g, "/"));
  return joinFs(baseDir, trimmed.replace(/\\/g, "/")).replace(/\\/g, "/");
}

/** 行内脚注图标链：`[![](icon)](#frag)` 不当作块级图 */
function isInlineLinkIconImage(line: string, matchIndex: number, matchLen: number): boolean {
  const after = line.slice(matchIndex + matchLen);
  return /^\]\(#/.test(after.trimStart());
}

function isBlockLevelImageOnLine(
  line: string,
  match: { index: number; length: number },
): boolean {
  const before = line.slice(0, match.index).replace(/<span[^>]*><\/span>/gi, "").trim();
  const after = line
    .slice(match.index + match.length)
    .replace(/<span[^>]*><\/span>/gi, "")
    .trim();
  return before.length === 0 && after.length === 0;
}

function blockImageAbsPathOnLine(
  line: string,
  mdFileAbsPath: string,
): string | null {
  let m: RegExpExecArray | null;
  RE_MD_IMAGE.lastIndex = 0;
  const candidates: { index: number; length: number; url: string }[] = [];
  while ((m = RE_MD_IMAGE.exec(line)) !== null) {
    const url = m[2]?.trim() ?? "";
    if (!url) continue;
    if (isInlineLinkIconImage(line, m.index, m[0]!.length)) continue;
    candidates.push({ index: m.index, length: m[0]!.length, url });
  }
  if (candidates.length !== 1) return null;
  const only = candidates[0]!;
  if (!isBlockLevelImageOnLine(line, only)) return null;
  return resolveMarkdownBlockImageAbsPath(only.url, mdFileAbsPath);
}

/** 扫描全文独占行的块级 `![…](…)`，供阅读器直接插 View Zone */
export function collectBlockMarkdownImageLines(
  text: string,
  mdFileAbsPath: string,
): BlockMarkdownImageLine[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  const out: BlockMarkdownImageLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const absPath = blockImageAbsPathOnLine(lines[i]!, mdFileAbsPath);
    if (absPath) out.push({ line: i + 1, absPath });
  }
  return out;
}

export function omitLinesAtLineNumbers(
  text: string,
  lineNumbers: ReadonlySet<number>,
): string {
  if (lineNumbers.size === 0) return text;
  const lines = text.length > 0 ? text.split("\n") : [];
  return lines.filter((_, i) => !lineNumbers.has(i + 1)).join("\n");
}
