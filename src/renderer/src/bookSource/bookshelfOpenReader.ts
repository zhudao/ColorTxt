import type { BookChapter, Book } from "@shared/bookSource/types";
import {
  updateFindBookBookshelfBookInfo,
  bookshelfAsBook,
  type BookshelfBook,
} from "./findBookBookshelf";
import { resolveBookshelfReadChapterIndex } from "./findBookshelfDisplay";
import { ipcPlain } from "./ipcPlain";

export function hasCachedBookshelfToc(book: BookshelfBook): boolean {
  return Boolean(book.tocUrl?.trim() && book.chapters?.length);
}

export type BookshelfReaderPayload = {
  detail: Book;
  chapters: BookChapter[];
  chapterIndex: number;
};

export async function loadBookshelfReaderPayload(
  book: BookshelfBook,
): Promise<{ payload: BookshelfReaderPayload | null; books?: BookshelfBook[]; message?: string }> {
  if (hasCachedBookshelfToc(book)) {
    const detail = bookshelfAsBook(book);
    const chapters = book.chapters!;
    const contentChapters = chapters.filter((ch) => !ch.isVolume);
    return {
      payload: {
        detail,
        chapters,
        chapterIndex: resolveBookshelfReadChapterIndex(book, contentChapters),
      },
    };
  }

  let detail: Book;
  if (book.tocUrl?.trim()) {
    detail = ipcPlain(bookshelfAsBook(book));
  } else {
    const seed = bookshelfAsBook(book);
    const infoRes = await window.colorTxt.bookSourceGetBookInfo(
      ipcPlain({
        bookSourceUrl: book.origin,
        bookUrl: seed.bookUrl,
        name: seed.name,
        author: seed.author,
        kind: seed.kind,
        wordCount: seed.wordCount,
        intro: seed.intro,
        lastChapter: seed.lastChapter,
        coverUrl: seed.coverUrl,
        variable: seed.variable,
      }),
    );
    if (!infoRes.detail) {
      return { payload: null, message: infoRes.message ?? "加载书籍失败" };
    }
    detail = ipcPlain(infoRes.detail);
  }

  const tocRes = await window.colorTxt.bookSourceGetChapterList({
    bookSourceUrl: book.origin,
    book: detail,
  });
  const chapters = tocRes.chapters ?? [];
  const contentChapters = chapters.filter((ch) => !ch.isVolume);
  if (!contentChapters.length) {
    return {
      payload: null,
      message: tocRes.message || "暂无章节",
    };
  }

  // chapters 写入时 updateFindBookBookshelfBookInfo 会覆盖 lastChapter 为目录最新章
  const next = updateFindBookBookshelfBookInfo(book.bookUrl, book.origin, {
    tocUrl: detail.tocUrl,
    chapters,
    bookUrl: detail.bookUrl?.trim() || book.bookUrl,
    name: detail.name,
    author: detail.author,
    kind: detail.kind,
    intro: detail.intro,
    coverUrl: detail.coverUrl,
    coverSourceUrl: detail.coverSourceUrl,
    lastChapter: detail.lastChapter,
    wordCount: detail.wordCount,
    updateTime: detail.updateTime,
    variable: detail.variable,
  });

  return {
    payload: {
      detail,
      chapters,
      chapterIndex: resolveBookshelfReadChapterIndex(book, contentChapters),
    },
    books: next ?? undefined,
  };
}
