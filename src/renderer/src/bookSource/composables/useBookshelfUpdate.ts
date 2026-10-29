import { computed, ref } from "vue";
import type { BookChapter } from "@shared/bookSource/types";
import {
  bookshelfBookKey,
  updateFindBookBookshelfBookInfo,
  type BookshelfBook,
  type BookshelfBookInfoPatch,
} from "../findBookBookshelf";
import { resolveLatestChapterTitleFromToc } from "../findBookshelfDisplay";
import { ipcPlain } from "../ipcPlain";

const updatingKeys = ref(new Set<string>());

/** 更新目录错误日志（批量/单项共用，打开「日志」面板查看） */
const bookshelfUpdateLogEntries = ref<string[]>([]);

/** 对齐 Legado AppConfig.threadCount 默认 16；书架更新略保守 */
const BOOKSHELF_UPDATE_CONCURRENCY = 8;

/** 同一书源同时只更新一本书（Legado sourceSemaphores Semaphore(1)） */
const sourceUpdateTail = new Map<string, Promise<void>>();

export const bookshelfUpdateBusy = computed(() => updatingKeys.value.size > 0);

export const bookshelfUpdateHasLog = computed(
  () => bookshelfUpdateLogEntries.value.length > 0,
);

export function getBookshelfUpdateLogText(): string {
  return bookshelfUpdateLogEntries.value.length
    ? bookshelfUpdateLogEntries.value.join("\n\n")
    : "（暂无日志）";
}

export function clearBookshelfUpdateLogs(): void {
  bookshelfUpdateLogEntries.value = [];
}

function appendBookshelfUpdateLog(entry: string) {
  const text = entry.trim();
  if (!text) return;
  bookshelfUpdateLogEntries.value = [...bookshelfUpdateLogEntries.value, text];
}

function formatUpdateErrorEntry(
  book: BookshelfBook,
  headline: string,
  logs?: string[] | null,
): string {
  const header = `「${book.name}」${book.originName ? ` · ${book.originName}` : ""}\n${book.origin}`;
  const parts = [header, headline.trim()].filter(Boolean);
  const extra = (logs ?? []).map((l) => l.trim()).filter(Boolean);
  if (extra.length) parts.push(extra.join("\n"));
  return parts.join("\n");
}

async function withSourceUpdateLock<T>(
  origin: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = sourceUpdateTail.get(origin) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = prev.then(() => gate);
  sourceUpdateTail.set(origin, current);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (sourceUpdateTail.get(origin) === current) {
      sourceUpdateTail.delete(origin);
    }
  }
}

function formatLastChapter(raw: string | undefined): string {
  const s = raw?.trim() ?? "";
  if (!s) return "";
  return s
    .replace(/[·•][^\n]*$/, "")
    .replace(
      /\s+(?:\d+\s*(?:分钟|小时|天|周|个月|月|年)前|刚刚|\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$/u,
      "",
    )
    .trim();
}

function buildInfoPatch(
  book: BookshelfBook,
  detail: NonNullable<
    Awaited<ReturnType<typeof window.colorTxt.bookSourceGetBookInfo>>["detail"]
  >,
  chapters: BookChapter[],
): BookshelfBookInfoPatch {
  // 对齐 Legado：有目录时以最新章节标题为准（写入 chapters 时还会再覆盖一次）
  const tocTitle = resolveLatestChapterTitleFromToc(chapters);
  const lastChapter =
    tocTitle || formatLastChapter(detail.lastChapter) || book.lastChapter;
  const patch: BookshelfBookInfoPatch = {
    name: detail.name?.trim() || book.name,
    author: detail.author?.trim() || book.author,
    intro: detail.intro ?? book.intro,
    kind: detail.kind ?? book.kind,
    wordCount: detail.wordCount ?? book.wordCount,
    updateTime: detail.updateTime?.trim() || undefined,
    lastChapter: lastChapter || book.lastChapter,
  };
  if (detail.coverUrl?.trim()) patch.coverUrl = detail.coverUrl.trim();
  if (detail.coverSourceUrl?.trim()) {
    patch.coverSourceUrl = detail.coverSourceUrl.trim();
  }
  const nextBookUrl = detail.bookUrl?.trim();
  if (nextBookUrl && nextBookUrl !== book.bookUrl) {
    patch.bookUrl = nextBookUrl;
  }
  if (detail.variable && Object.keys(detail.variable).length) {
    patch.variable = detail.variable;
  }
  return patch;
}

export function useBookshelfUpdate(onBooksChanged?: (books: BookshelfBook[]) => void) {
  const isAnyUpdating = bookshelfUpdateBusy;

  function isUpdating(book: BookshelfBook): boolean {
    return updatingKeys.value.has(bookshelfBookKey(book.bookUrl, book.origin));
  }

  function setUpdating(key: string, active: boolean) {
    const next = new Set(updatingKeys.value);
    if (active) next.add(key);
    else next.delete(key);
    updatingKeys.value = next;
  }

  async function updateBook(book: BookshelfBook): Promise<boolean> {
    if (book.canUpdate === false) return false;
    return withSourceUpdateLock(book.origin, () => updateBookOnce(book));
  }

  async function updateBookOnce(book: BookshelfBook): Promise<boolean> {
    const key = bookshelfBookKey(book.bookUrl, book.origin);
    if (updatingKeys.value.has(key)) return false;

    setUpdating(key, true);
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
      if (!infoRes.detail) {
        appendBookshelfUpdateLog(
          formatUpdateErrorEntry(
            book,
            infoRes.message?.trim() || "获取书籍详情失败",
            infoRes.logs,
          ),
        );
        return false;
      }

      const detail = ipcPlain(infoRes.detail);
      const tocRes = await window.colorTxt.bookSourceGetChapterList({
        bookSourceUrl: book.origin,
        book: detail,
      });
      if (tocRes.message?.trim() && !(tocRes.chapters?.length)) {
        appendBookshelfUpdateLog(
          formatUpdateErrorEntry(
            book,
            tocRes.message.trim() || "获取目录失败",
            tocRes.logs,
          ),
        );
        return false;
      }
      if (tocRes.message?.trim() && tocRes.chapters?.length) {
        // 有目录但仍有告警：记入日志，继续写入
        appendBookshelfUpdateLog(
          formatUpdateErrorEntry(book, tocRes.message.trim(), tocRes.logs),
        );
      }

      const chapters = tocRes.chapters ?? [];
      const patch = buildInfoPatch(book, detail, chapters);
      const next = updateFindBookBookshelfBookInfo(book.bookUrl, book.origin, {
        ...patch,
        tocUrl: detail.tocUrl,
        chapters,
      });
      if (next) onBooksChanged?.(next);
      return Boolean(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendBookshelfUpdateLog(
        formatUpdateErrorEntry(book, msg || "更新目录异常"),
      );
      return false;
    } finally {
      setUpdating(key, false);
    }
  }

  async function updateBooks(books: readonly BookshelfBook[]): Promise<void> {
    const queue = books.filter((book) => book.canUpdate !== false);
    if (!queue.length) return;

    clearBookshelfUpdateLogs();

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(BOOKSHELF_UPDATE_CONCURRENCY, queue.length) },
      async () => {
        while (cursor < queue.length) {
          const book = queue[cursor++];
          await updateBook(book);
        }
      },
    );
    await Promise.all(workers);
  }

  return {
    isAnyUpdating,
    isUpdating,
    updateBook,
    updateBooks,
  };
}
