import { Lexer, type Tokens } from "marked";
import { dirnameFs, joinFs } from "../ebook/pathUtils";

export type BlockMarkdownImageLine = {
  line: number;
  absPath: string;
};

export type ParsedMdImage = {
  index: number;
  length: number;
  alt: string;
  url: string;
};

function isRemoteImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function isAbsolutePathUrl(url: string): boolean {
  const u = url.trim();
  return /^[a-zA-Z]:[\\/]/.test(u) || u.startsWith("/");
}

/** 将相对 `md` 的路径解析为插图绝对路径（支持路径段内 `[]` 等字符） */
export function resolveMarkdownAssetAbsPath(
  relativePath: string,
  mdFileAbsPath: string,
): string {
  const trimmed = relativePath.trim();
  if (isRemoteImageUrl(trimmed)) return trimmed;
  if (isAbsolutePathUrl(trimmed)) {
    return trimmed.replace(/\\/g, "/");
  }
  const mdNorm = mdFileAbsPath.replace(/\\/g, "/");
  const baseDir = dirnameFs(mdNorm);
  let abs = baseDir;
  for (const seg of trimmed.replace(/\\/g, "/").split("/").filter(Boolean)) {
    abs = joinFs(abs, seg);
  }
  return abs;
}

/** 块级 `![alt](url)` 的 url → 插图绝对路径或 https URL */
export function resolveMarkdownBlockImageAbsPath(
  url: string,
  mdFileAbsPath: string,
): string {
  const abs = resolveMarkdownAssetAbsPath(url, mdFileAbsPath);
  if (isRemoteImageUrl(abs) || isAbsolutePathUrl(abs)) {
    return abs.replace(/\\/g, "/");
  }
  return abs;
}

/**
 * 从 `startIndex` 解析一处 `![alt](url)`（走 marked，与内链同一套规则）。
 * 路径中的 `()` 等特殊字符应由转换侧 `escapeMdUrl` 写出；此处不做非标准兜底。
 */
export function parseMdImageAt(
  line: string,
  startIndex: number,
): ParsedMdImage | null {
  const sub = line.slice(startIndex);
  if (!sub.startsWith("![")) return null;
  const tokens = Lexer.lexInline(sub);
  const first = tokens[0];
  if (!first || first.type !== "image") return null;
  const img = first as Tokens.Image;
  if (!sub.startsWith(img.raw)) return null;
  const url = (img.href ?? "").trim();
  if (!url) return null;
  return {
    index: startIndex,
    length: img.raw.length,
    alt: img.text ?? "",
    url,
  };
}

/** 扫描一行内所有 `![…](…)`（不要求块级） */
export function findMdImagesInLine(line: string): ParsedMdImage[] {
  const out: ParsedMdImage[] = [];
  let i = 0;
  while (i < line.length) {
    const bang = line.indexOf("![", i);
    if (bang < 0) break;
    const parsed = parseMdImageAt(line, bang);
    if (!parsed) {
      i = bang + 2;
      continue;
    }
    out.push(parsed);
    i = parsed.index + parsed.length;
  }
  return out;
}

/** 行内脚注图标链：`[![](icon)](#frag)` 不当作块级图 */
function isInlineLinkIconImage(
  line: string,
  matchIndex: number,
  matchLen: number,
): boolean {
  const after = line.slice(matchIndex + matchLen);
  return /^\]\(#/.test(after.trimStart());
}

function isBlockLevelImageOnLine(
  line: string,
  match: { index: number; length: number },
): boolean {
  const before = line
    .slice(0, match.index)
    .replace(/<span[^>]*><\/span>/gi, "")
    .trim();
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
  const candidates = findMdImagesInLine(line).filter(
    (m) => !isInlineLinkIconImage(line, m.index, m.length),
  );
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
