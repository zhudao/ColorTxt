import type { Chapter } from "../chapter";

/** 侧栏章节树每级缩进，与原先 `(headingLevel - 1) * 10px` 一致 */
export const CHAPTER_LIST_INDENT_PX = 10;

export function chapterHeadingLevel(ch: Chapter): number {
  return Math.max(1, Math.floor(ch.headingLevel ?? 1));
}

/** 与 `useReaderSidebarLists` 的 `activeChapterKey` 同一套稳定键 */
export function chapterListItemKey(ch: Chapter): string {
  return ch.tocOrder != null
    ? `o:${ch.tocOrder}`
    : `l:${ch.lineNumber}:${ch.title}`;
}

/** 父级子树右开区间：其后 `headingLevel` 更深的连续项 */
export function chapterChildrenEndIndex(
  chapters: readonly Chapter[],
  parentIndex: number,
): number {
  const parentLevel = chapterHeadingLevel(chapters[parentIndex]!);
  let j = parentIndex + 1;
  while (j < chapters.length && chapterHeadingLevel(chapters[j]!) > parentLevel) {
    j += 1;
  }
  return j;
}

export function chapterHasChildren(
  chapters: readonly Chapter[],
  index: number,
): boolean {
  return chapterChildrenEndIndex(chapters, index) > index + 1;
}

export function chapterListHasNesting(chapters: readonly Chapter[]): boolean {
  for (let i = 0; i < chapters.length; i++) {
    if (chapterHasChildren(chapters, i)) return true;
  }
  return false;
}

export function collectChapterParentKeys(
  chapters: readonly Chapter[],
): string[] {
  const keys: string[] = [];
  for (let i = 0; i < chapters.length; i++) {
    if (chapterHasChildren(chapters, i)) {
      keys.push(chapterListItemKey(chapters[i]!));
    }
  }
  return keys;
}

/**
 * 折叠某父级时隐藏其整棵子树（含子父级）。
 * `collapsedParentKeys` 为空则全部展开。
 */
export function filterVisibleChapters(
  chapters: readonly Chapter[],
  collapsedParentKeys: ReadonlySet<string>,
): Chapter[] {
  if (collapsedParentKeys.size === 0) return chapters.slice();
  const out: Chapter[] = [];
  let skipUntil = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (i < skipUntil) continue;
    const ch = chapters[i]!;
    out.push(ch);
    if (
      chapterHasChildren(chapters, i) &&
      collapsedParentKeys.has(chapterListItemKey(ch))
    ) {
      skipUntil = chapterChildrenEndIndex(chapters, i);
    }
  }
  return out;
}

/** 当前章被折叠隐藏时，需展开的祖先父级键（由近到远） */
export function ancestorParentKeysForChapter(
  chapters: readonly Chapter[],
  target: Chapter,
): string[] {
  const targetKey = chapterListItemKey(target);
  let targetIdx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapterListItemKey(chapters[i]!) === targetKey) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx <= 0) return [];
  const ancestors: string[] = [];
  let needLevel = chapterHeadingLevel(chapters[targetIdx]!);
  for (let i = targetIdx - 1; i >= 0; i--) {
    const lvl = chapterHeadingLevel(chapters[i]!);
    if (lvl >= needLevel) continue;
    if (!chapterHasChildren(chapters, i)) continue;
    if (chapterChildrenEndIndex(chapters, i) <= targetIdx) continue;
    ancestors.push(chapterListItemKey(chapters[i]!));
    needLevel = lvl;
    if (needLevel <= 1) break;
  }
  return ancestors;
}
