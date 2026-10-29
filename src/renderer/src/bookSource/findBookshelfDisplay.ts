import { formatLegadoBookAuthor } from "@shared/bookSource/formatBookAuthor";
import type { BookChapter } from "@shared/bookSource/types";
import { resolveFirstChapterContentIndex } from "@shared/bookSource/chapterReadingOrder";

/** 从 kind 标签中提取日期作为更新时间兜底 */
export function extractUpdateTimeFromKind(kind?: string): string {
  const raw = kind?.trim();
  if (!raw) return "";
  const m = raw.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/);
  return m ? m[0].replace(/-/g, "/") : "";
}

type BookshelfDisplayFields = {
  updateTime?: string;
  kind?: string;
  lastChapter?: string;
  lastReadChapterTitle?: string;
  lastReadChapterIndex?: number;
  author?: string;
};

export function resolveBookshelfUpdateTime(book: BookshelfDisplayFields): string {
  return book.updateTime?.trim() || extractUpdateTimeFromKind(book.kind);
}

/** 目录内容章首章标题（最新在前）；供写回 lastChapter，对齐 Legado */
export function resolveLatestChapterTitleFromToc(
  chapters: BookChapter[] | undefined,
): string {
  return bookshelfContentChapters({ chapters })[0]?.title?.trim() ?? "";
}

/** 「最新章节：xxx（更新时间：xxx）」中的章节段（对齐 Legado：读落库 lastChapter） */
export function formatBookshelfLatestChapter(book: BookshelfDisplayFields): string {
  const chapter = book.lastChapter?.trim();
  if (!chapter) return "暂无";
  const updateTime = resolveBookshelfUpdateTime(book);
  // return updateTime ? `${chapter}（更新时间：${updateTime}）` : chapter;
  return updateTime ? `${chapter}（${updateTime}）` : chapter;
}

export function formatBookshelfLastRead(book: BookshelfDisplayFields): string {
  const title = book.lastReadChapterTitle?.trim();
  if (title) return title;
  if (
    typeof book.lastReadChapterIndex === "number" &&
    Number.isFinite(book.lastReadChapterIndex) &&
    book.lastReadChapterIndex >= 0
  ) {
    return `第 ${book.lastReadChapterIndex + 1} 章`;
  }
  return "暂无";
}

/**
 * 最后阅读章节是否已是最新章节（标题比对；不含「更新时间」后缀）。
 * `lastReadDisplay` 优先（可为异步解析的章节名）。
 */
export function isBookshelfCaughtUpToLatest(
  book: Pick<BookshelfDisplayFields, "lastChapter" | "lastReadChapterTitle">,
  lastReadDisplay?: string,
): boolean {
  const latest = book.lastChapter?.trim();
  if (!latest) return false;
  const read = (lastReadDisplay?.trim() || book.lastReadChapterTitle?.trim() || "");
  if (!read || read === "暂无") return false;
  return read === latest;
}

/** 书架内容章（已过滤分卷）；目录约定「最新在前」 */
export function bookshelfContentChapters(
  book: { chapters?: BookChapter[] },
): BookChapter[] {
  return (book.chapters ?? []).filter((ch) => !ch.isVolume);
}

function chapterIsPaid(ch: BookChapter | undefined): boolean {
  return Boolean(ch?.isVip || ch?.isPay);
}

/** 最新章节是否付费（需有目录缓存） */
export function isBookshelfLatestChapterVip(book: {
  chapters?: BookChapter[];
}): boolean {
  return chapterIsPaid(bookshelfContentChapters(book)[0]);
}

/** 最后阅读章节是否付费（需有目录缓存） */
export function isBookshelfLastReadChapterVip(book: {
  chapters?: BookChapter[];
  lastReadChapterIndex?: number;
  lastReadChapterTitle?: string;
}): boolean {
  const list = bookshelfContentChapters(book);
  if (!list.length) return false;
  const idx = book.lastReadChapterIndex;
  if (
    typeof idx === "number" &&
    Number.isFinite(idx) &&
    idx >= 0 &&
    idx < list.length
  ) {
    return chapterIsPaid(list[idx]);
  }
  const title = book.lastReadChapterTitle?.trim();
  if (!title) return false;
  return chapterIsPaid(list.find((ch) => ch.title?.trim() === title));
}

/** 作者行：对齐 Legado 作者净化 */
export function formatBookshelfAuthor(author: string | undefined): string {
  return formatLegadoBookAuthor(author) || "未知";
}

/**
 * 书架打开阅读：有进度 → 继续阅读下标；无进度 → 第一章（同详情页「开始阅读」）。
 * `contentChapters` 为已过滤分卷的内容章列表。
 */
export function resolveBookshelfReadChapterIndex(
  book: { lastReadChapterIndex?: number },
  contentChapters: BookChapter[],
): number {
  const n = contentChapters.length;
  if (n <= 0) return 0;
  const idx = book.lastReadChapterIndex;
  if (
    typeof idx === "number" &&
    Number.isFinite(idx) &&
    idx >= 0 &&
    idx < n
  ) {
    return idx;
  }
  return resolveFirstChapterContentIndex(contentChapters);
}
