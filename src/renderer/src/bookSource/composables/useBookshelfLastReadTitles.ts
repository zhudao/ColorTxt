import { ref, watch, type Ref } from "vue";
import type { BookshelfBook } from "../findBookBookshelf";
import {
  bookshelfBookKey,
  updateFindBookBookshelfBookInfo,
  updateFindBookBookshelfReadProgress,
} from "../findBookBookshelf";
import { formatBookshelfLastRead } from "../findBookshelfDisplay";
import { ipcPlain } from "../ipcPlain";

const MAX_CONCURRENT = 2;

export function useBookshelfLastReadTitles(
  books: Ref<readonly BookshelfBook[]>,
  active: () => boolean,
  onPersisted?: () => void,
) {
  const resolvedTitles = ref<Record<string, string>>({});
  const resolvingKeys = new Set<string>();
  let inFlight = 0;
  const queue: BookshelfBook[] = [];

  function keyOf(book: BookshelfBook): string {
    return bookshelfBookKey(book.bookUrl, book.origin);
  }

  function needsResolve(book: BookshelfBook): boolean {
    if (book.lastReadChapterTitle?.trim()) return false;
    if (
      typeof book.lastReadChapterIndex !== "number" ||
      !Number.isFinite(book.lastReadChapterIndex) ||
      book.lastReadChapterIndex < 0
    ) {
      return false;
    }
    return !resolvedTitles.value[keyOf(book)];
  }

  function getLastReadText(book: BookshelfBook): string {
    const stored = book.lastReadChapterTitle?.trim();
    if (stored) return stored;
    const resolved = resolvedTitles.value[keyOf(book)];
    if (resolved) return resolved;
    return formatBookshelfLastRead(book);
  }

  async function resolveOne(book: BookshelfBook): Promise<void> {
    const key = keyOf(book);
    if (resolvingKeys.has(key) || !needsResolve(book)) return;

    const idx = book.lastReadChapterIndex!;
    resolvingKeys.add(key);
    inFlight += 1;
    try {
      const infoRes = await window.colorTxt.bookSourceGetBookInfo(
        ipcPlain({
          bookSourceUrl: book.origin,
          bookUrl: book.bookUrl,
          name: book.name,
          author: book.author,
          kind: book.kind,
          wordCount: book.wordCount,
          intro: book.intro,
          lastChapter: book.lastChapter,
          coverUrl: book.coverUrl,
          variable: book.variable,
        }),
      );
      const detail = infoRes.detail ? ipcPlain(infoRes.detail) : undefined;
      if (!detail?.tocUrl) return;

      const tocRes = await window.colorTxt.bookSourceGetChapterList({
        bookSourceUrl: book.origin,
        book: detail,
      });
      const contentChapters = (tocRes.chapters ?? []).filter((ch) => !ch.isVolume);
      const title = contentChapters[idx]?.title?.trim();
      if (!title) return;

      resolvedTitles.value = { ...resolvedTitles.value, [key]: title };
      let next = updateFindBookBookshelfReadProgress(
        book.bookUrl,
        book.origin,
        idx,
        title,
      );
      if (detail.tocUrl && contentChapters.length) {
        const withToc = updateFindBookBookshelfBookInfo(book.bookUrl, book.origin, {
          tocUrl: detail.tocUrl,
          chapters: tocRes.chapters ?? [],
          bookUrl: detail.bookUrl?.trim() || book.bookUrl,
        });
        if (withToc) next = withToc;
      }
      if (next) onPersisted?.();
    } finally {
      resolvingKeys.delete(key);
      inFlight -= 1;
      pumpQueue();
    }
  }

  function pumpQueue(): void {
    while (inFlight < MAX_CONCURRENT && queue.length) {
      const book = queue.shift();
      if (book) void resolveOne(book);
    }
  }

  function enqueueResolve(book: BookshelfBook): void {
    const key = keyOf(book);
    if (!needsResolve(book) || resolvingKeys.has(key)) return;
    if (queue.some((b) => keyOf(b) === key)) return;
    queue.push(book);
    pumpQueue();
  }

  watch(
    books,
    (list) => {
      if (!active()) return;
      for (const book of list) {
        enqueueResolve(book);
      }
    },
    { immediate: true, deep: true },
  );

  watch(
    () => active(),
    (on) => {
      if (!on) return;
      for (const book of books.value) {
        enqueueResolve(book);
      }
    },
  );

  return { getLastReadText };
}
