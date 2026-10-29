import type { BookshelfBook } from "./findBookBookshelf";
import { extractUpdateTimeFromKind } from "./findBookshelfDisplay";
import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import { icons } from "../icons";

export type BookshelfSortMode =
  | "readTimeAsc"
  | "readTimeDesc"
  | "updateTimeAsc"
  | "updateTimeDesc"
  | "nameAsc"
  | "nameDesc"
  | "manual"
  | "comprehensiveAsc"
  | "comprehensiveDesc";

export const DEFAULT_BOOKSHELF_SORT: BookshelfSortMode = "readTimeDesc";

const STORAGE_KEY = "colortxt:findBookBookshelfSort";

const SORT_LABELS: Record<BookshelfSortMode, string> = {
  readTimeAsc: "阅读时间",
  readTimeDesc: "阅读时间",
  updateTimeAsc: "更新时间",
  updateTimeDesc: "更新时间",
  nameAsc: "书名",
  nameDesc: "书名",
  manual: "手动",
  comprehensiveAsc: "综合",
  comprehensiveDesc: "综合",
};

const SORT_MODES: BookshelfSortMode[] = [
  "readTimeAsc",
  "readTimeDesc",
  "updateTimeAsc",
  "updateTimeDesc",
  "nameAsc",
  "nameDesc",
  "manual",
  "comprehensiveAsc",
  "comprehensiveDesc",
];

export function isBookshelfSortAsc(mode: BookshelfSortMode): boolean {
  return /Asc$/.test(mode);
}

export function isBookshelfManualSort(mode: BookshelfSortMode): boolean {
  return mode === "manual";
}

export function bookshelfSortLabel(mode: BookshelfSortMode): string {
  return SORT_LABELS[mode];
}

export function bookshelfSortTriggerPrefixHtml(mode: BookshelfSortMode): string {
  if (mode === "manual") return icons.move;
  return isBookshelfSortAsc(mode) ? icons.asc : icons.desc;
}

export function createBookshelfSortItems(): CustomSelectItem[] {
  return SORT_MODES.map((m) => ({
    kind: "item" as const,
    id: m,
    label: SORT_LABELS[m],
    prefixHtml: bookshelfSortTriggerPrefixHtml(m),
  }));
}

function normalizeStoredSortMode(raw: string): BookshelfSortMode | null {
  if (raw === "manualAsc" || raw === "manualDesc") return "manual";
  if (SORT_MODES.includes(raw as BookshelfSortMode)) {
    return raw as BookshelfSortMode;
  }
  return null;
}

export function loadBookshelfSortMode(): BookshelfSortMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const mode = normalizeStoredSortMode(raw);
      if (mode) return mode;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_BOOKSHELF_SORT;
}

export function saveBookshelfSortMode(mode: BookshelfSortMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** 最后阅读时间（对齐 Legado durChapterTime） */
export function bookshelfReadTimeMs(book: BookshelfBook): number {
  if (typeof book.lastReadAt === "number" && Number.isFinite(book.lastReadAt)) {
    return book.lastReadAt;
  }
  if (book.lastReadChapterIndex !== undefined) {
    return book.savedAt;
  }
  return 0;
}

/** 书籍更新时间戳（对齐 Legado latestChapterTime） */
export function bookshelfUpdateTimeMs(book: BookshelfBook): number {
  const raw = book.updateTime?.trim() || extractUpdateTimeFromKind(book.kind);
  if (!raw) return 0;
  const m = raw.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const t = new Date(y, mo, d).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** 综合排序键：max(阅读时间, 更新时间) */
export function bookshelfComprehensiveMs(book: BookshelfBook): number {
  return Math.max(bookshelfReadTimeMs(book), bookshelfUpdateTimeMs(book));
}

function compareName(a: BookshelfBook, b: BookshelfBook): number {
  return a.name.localeCompare(b.name, "zh-CN");
}

export function sortBookshelfBooks(
  books: readonly BookshelfBook[],
  mode: BookshelfSortMode,
): BookshelfBook[] {
  if (mode === "manual") return [...books];

  const list = [...books];
  switch (mode) {
    case "readTimeAsc":
      return list.sort((a, b) => bookshelfReadTimeMs(a) - bookshelfReadTimeMs(b));
    case "readTimeDesc":
      return list.sort((a, b) => bookshelfReadTimeMs(b) - bookshelfReadTimeMs(a));
    case "updateTimeAsc":
      return list.sort((a, b) => bookshelfUpdateTimeMs(a) - bookshelfUpdateTimeMs(b));
    case "updateTimeDesc":
      return list.sort((a, b) => bookshelfUpdateTimeMs(b) - bookshelfUpdateTimeMs(a));
    case "nameAsc":
      return list.sort(compareName);
    case "nameDesc":
      return list.sort((a, b) => compareName(b, a));
    case "comprehensiveAsc":
      return list.sort(
        (a, b) => bookshelfComprehensiveMs(a) - bookshelfComprehensiveMs(b),
      );
    case "comprehensiveDesc":
      return list.sort(
        (a, b) => bookshelfComprehensiveMs(b) - bookshelfComprehensiveMs(a),
      );
    default:
      return list;
  }
}

/** 手动排序：按当前列表顺序拖拽重排 */
export function reorderBookshelfManual(
  books: readonly BookshelfBook[],
  from: number,
  to: number,
): BookshelfBook[] {
  const next = [...books];
  const [moved] = next.splice(from, 1);
  if (!moved) return [...books];
  next.splice(to, 0, moved);
  return next;
}
