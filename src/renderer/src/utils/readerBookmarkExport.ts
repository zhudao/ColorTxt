import type { FileBookmarkItem } from "../stores/fileMetaStore";
import {
  bookTitleForExport,
  pickAndReadJsonFile,
} from "./readerAnnotationExport";
import { sanitizeChatExportTitleForFilename } from "../aiAssistant/aiAssistantExport";

export type ReaderBookmarksExportV1 = {
  schemaVersion: 1;
  exportedAt: number;
  bookPath: string;
  bookName: string;
  bookmarks: FileBookmarkItem[];
};

function normalizeBookmarkItem(
  item: Partial<FileBookmarkItem>,
): FileBookmarkItem | null {
  if (typeof item.line !== "number" || !Number.isFinite(item.line)) return null;
  const line = Math.max(1, Math.floor(item.line));
  const note = typeof item.note === "string" ? item.note.trim() : "";
  const now = Date.now();
  const createdAt =
    typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
      ? Math.floor(item.createdAt)
      : now;
  const updatedAt =
    typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
      ? Math.floor(item.updatedAt)
      : now;
  return { line, note: note || undefined, createdAt, updatedAt };
}

export function normalizeBookmarksList(
  raw: unknown,
): FileBookmarkItem[] {
  if (!Array.isArray(raw)) return [];
  const byLine = new Map<number, FileBookmarkItem>();
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const n = normalizeBookmarkItem(row as Partial<FileBookmarkItem>);
    if (n) byLine.set(n.line, n);
  }
  return Array.from(byLine.values()).sort((a, b) => a.line - b.line);
}

export function buildBookmarkExportDefaultName(bookName: string): string {
  const titlePart = sanitizeChatExportTitleForFilename(
    bookTitleForExport(bookName || "书签"),
  );
  return `${titlePart}.bookmarks.json`;
}

export function buildReaderBookmarksExportJson(
  bookPath: string,
  bookName: string,
  bookmarks: FileBookmarkItem[],
): string {
  const payload: ReaderBookmarksExportV1 = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    bookPath,
    bookName,
    bookmarks: normalizeBookmarksList(bookmarks),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseReaderBookmarksExportJson(
  raw: string,
): ReaderBookmarksExportV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as ReaderBookmarksExportV1).schemaVersion !== 1
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const bookPath =
      typeof obj.bookPath === "string" ? obj.bookPath.trim() : "";
    const bookName =
      typeof obj.bookName === "string" ? obj.bookName.trim() : "";
    if (!bookPath) return null;
    return {
      schemaVersion: 1,
      exportedAt:
        typeof obj.exportedAt === "number" && Number.isFinite(obj.exportedAt)
          ? Math.floor(obj.exportedAt)
          : Date.now(),
      bookPath,
      bookName: bookName || bookTitleForExport(bookPath),
      bookmarks: normalizeBookmarksList(obj.bookmarks),
    };
  } catch {
    return null;
  }
}

/** 同 line 以导入侧为准 */
export function mergeImportedBookmarks(
  local: readonly FileBookmarkItem[],
  imported: readonly FileBookmarkItem[],
): FileBookmarkItem[] {
  const byLine = new Map<number, FileBookmarkItem>();
  for (const b of local) byLine.set(b.line, b);
  for (const b of imported) byLine.set(b.line, b);
  return Array.from(byLine.values()).sort((a, b) => a.line - b.line);
}

export async function saveBookmarkExportFile(
  defaultName: string,
  data: string,
): Promise<
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  return window.colorTxt.ai.exportSave({
    defaultName,
    data,
    filters: [{ name: "彩读书签", extensions: ["json"] }],
  });
}

export async function pickAndReadBookmarkJsonFile(
  title = "导入书签（JSON）",
): Promise<
  | { ok: true; text: string; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  return pickAndReadJsonFile(title, "彩读书签");
}
