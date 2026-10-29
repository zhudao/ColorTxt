import { formatLegadoBookAuthor } from "@shared/bookSource/formatBookAuthor";

/** 书籍列表作者行：净化后补「作者：」前缀（对齐 Legado 展示） */
export function formatBookAuthor(author: string | undefined): string {
  const a = formatLegadoBookAuthor(author) || "未知";
  return `作者：${a}`;
}

/** 默认封面作者标签 */
export function formatCoverAuthor(author: string | undefined): string {
  return formatLegadoBookAuthor(author) || "未知";
}

export {
  getBookKindList,
  splitBookMetaTags,
} from "@shared/bookSource/bookMetaTags";

/** 简介展示：按行去掉首尾空白（含全角空格），仅影响 UI，不改引擎存盘 */
export function formatBookIntroForDisplay(intro: string | undefined | null): string {
  const raw = intro ?? "";
  if (!raw.replace(/[\t\n\r\f\v \u3000]+/g, "")) return "";
  const lines = raw.split(/\r\n|\r|\n/).map((line) => line.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join("\n");
}

/** 详情简介 HTML（转义 + 换行），供 v-html 使用 */
export function formatBookIntroHtmlForDisplay(intro: string | undefined | null): string {
  const text = formatBookIntroForDisplay(intro);
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "<br>");
}
