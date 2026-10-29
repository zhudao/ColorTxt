/**
 * 目录展示排序：`getChapterList` 约定数组「最新在前」（无 `-` 时反转页面正序）。
 * `newestFirst === true`（倒序）保持 API 顺序；否则反转为正序阅读（旧→新）。
 */
export function sortContentChaptersDisplay<T>(
  contentChapters: T[],
  newestFirst: boolean,
): T[] {
  return newestFirst ? contentChapters : [...contentChapters].reverse();
}
