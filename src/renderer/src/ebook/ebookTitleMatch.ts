/**
 * 转换时目录标题匹配：从 MD/HTML 混合行提取纯文本标题。
 * 匹配与展示分离：匹配剥内链且不展开 label；展示保留链接语法。
 */

import { chapterTitleForDisplay } from "../chapter";
import { stripMdLinksFromLine } from "../markdown/markdownLinkShared";

const RE_SPAN_ID = /<span\s+id="[^"]*"\s*><\/span>/gi;
const RE_ATX_PREFIX = /^\s{0,3}#{1,6}\s+/;

function firstPhysicalLine(rawLine: string): string {
  return rawLine.replace(/\r\n/g, "\n").split("\n")[0] ?? rawLine;
}

/** 去掉任意位置 MD 内链 / 外链语法（不展开 label） */
export function stripAllMdInternalLinksFromLine(line: string): string {
  return stripMdLinksFromLine(line);
}

/**
 * 目录标题匹配用纯文本：去 span / ATX / 任意位置内链。
 * 不把 link label 并入标题（避免「标题<a>注</a>）」误匹配）。
 */
export function plainTextForEbookTitleMatch(rawLine: string): string {
  let s = firstPhysicalLine(rawLine);
  s = s.replace(RE_SPAN_ID, "");
  s = s.replace(RE_ATX_PREFIX, "");
  s = stripAllMdInternalLinksFromLine(s);
  return chapterTitleForDisplay(s);
}

/**
 * 阅读器行映射用：仅去 span 锚点，保留内链 MD 语法与 label。
 * 目录匹配请用 {@link plainTextForEbookTitleMatch}。
 */
export function visibleReaderLineFromPhysicalRaw(rawLine: string): string {
  return firstPhysicalLine(rawLine).replace(RE_SPAN_ID, "");
}
