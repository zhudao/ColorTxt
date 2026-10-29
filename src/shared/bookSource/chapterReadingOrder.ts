import type { BookChapter } from "./types";

/** 从标题前缀解析章节序号；序章/楔子等视为 0，解析失败返回 null */
function leadingChapterIndexFromTitle(title: string): number | null {
  const t = title.trim();
  if (/^(序章|楔子|引子|前言|序言|内容简介|作品相关)/.test(t)) return 0;
  if (/^第一章/.test(t) || /^第\s*一\s*章/.test(t)) return 1;
  const digit = t.match(/^第\s*(\d+)\s*章/);
  if (digit?.[1]) return Number.parseInt(digit[1], 10);
  return null;
}

function isFirstChapterIndex(n: number | null): boolean {
  return n === 0 || n === 1;
}

/** 推断目录第一章在 content 数组中的下标（Legado 默认 reverse 后在末尾） */
export function resolveFirstChapterContentIndex(
  chapters: BookChapter[],
): number {
  const list = chapters.filter((ch) => !ch.isVolume);
  if (!list.length) return 0;

  const startN = leadingChapterIndexFromTitle(list[0]!.title);
  const endN = leadingChapterIndexFromTitle(list[list.length - 1]!.title);
  const startIsFirst = isFirstChapterIndex(startN);
  const endIsFirst = isFirstChapterIndex(endN);

  if (startIsFirst && !endIsFirst) return 0;
  if (endIsFirst && !startIsFirst) return list.length - 1;
  if (startIsFirst && endIsFirst) return 0;

  if (startN != null && endN != null) {
    if (startN < endN) return 0;
    if (startN > endN) return list.length - 1;
  }

  return list.length - 1;
}

/** 内容章按阅读顺序（第一章起）排列，用于下载等 */
export function contentChaptersInReadingOrder(
  chapters: BookChapter[],
): BookChapter[] {
  const list = chapters.filter((ch) => !ch.isVolume);
  if (list.length <= 1) return list;
  const firstIdx = resolveFirstChapterContentIndex(chapters);
  if (firstIdx === list.length - 1) return [...list].reverse();
  return list;
}

/** 展示下标 → 阅读顺序下标（0 = 第一章，与侧栏正/倒序无关） */
export function readingOrderIndexFromDisplay(
  displayIndex: number,
  listLength: number,
  sortDesc: boolean,
): number {
  if (listLength <= 0) return -1;
  const idx = Math.max(0, Math.min(listLength - 1, Math.floor(displayIndex)));
  return sortDesc ? listLength - 1 - idx : idx;
}

/** 阅读顺序下标 → 当前展示排序下的 display 下标 */
export function displayIndexForReadingOrder(
  readingOrderIndex: number,
  listLength: number,
  sortDesc: boolean,
): number {
  const ro = Math.max(
    0,
    Math.min(listLength - 1, Math.floor(readingOrderIndex)),
  );
  return sortDesc ? listLength - 1 - ro : ro;
}
