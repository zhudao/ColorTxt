import type { HighlightWordsByIndex } from "../stores/fileMetaStore";
import { normalizeHighlightWordsByIndex } from "../stores/fileMetaStore";
import { mergeHighlightWordsByIndex } from "./highlightWords";
import {
  bookTitleForExport,
  pickAndReadJsonFile,
} from "./readerAnnotationExport";
import { sanitizeChatExportTitleForFilename } from "../aiAssistant/aiAssistantExport";

/** @deprecated 读入时仍接受；写出使用 v2 */
export type ReaderHighlightsExportV1 = {
  schemaVersion: 1;
  exportedAt: number;
  highlightWordsByIndex: HighlightWordsByIndex;
};

/** 本书 / 收藏共用；v2 值为色索引 → 词组 string[][] */
export type ReaderHighlightsExportV2 = {
  schemaVersion: 2;
  exportedAt: number;
  highlightWordsByIndex: HighlightWordsByIndex;
};

export type ReaderHighlightsExport =
  | ReaderHighlightsExportV1
  | ReaderHighlightsExportV2;

/** 本书高亮词默认导出名：`{书名}.highlights.json` */
export function buildHighlightExportDefaultName(bookName: string): string {
  const titlePart = sanitizeChatExportTitleForFilename(
    bookTitleForExport(bookName || "高亮词"),
  );
  return `${titlePart}.highlights.json`;
}

/** 收藏高亮词默认导出名（固定） */
export const FAVORITE_HIGHLIGHTS_EXPORT_DEFAULT_NAME = "favorite.highlights.json";

export function countHighlightWordsInMap(
  map: HighlightWordsByIndex | undefined,
): number {
  if (!map) return 0;
  let n = 0;
  for (const groups of Object.values(map)) {
    for (const g of groups) n += g.length;
  }
  return n;
}

export function buildReaderHighlightsExportJson(
  highlightWordsByIndex: HighlightWordsByIndex,
): string {
  const payload: ReaderHighlightsExportV2 = {
    schemaVersion: 2,
    exportedAt: Date.now(),
    highlightWordsByIndex,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseReaderHighlightsExportJson(
  raw: string,
): ReaderHighlightsExportV2 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const ver = obj.schemaVersion;
    if (ver !== 1 && ver !== 2) return null;
    const highlightWordsByIndex = normalizeHighlightWordsByIndex(
      obj.highlightWordsByIndex,
    );
    if (!highlightWordsByIndex) return null;
    return {
      schemaVersion: 2,
      exportedAt:
        typeof obj.exportedAt === "number" && Number.isFinite(obj.exportedAt)
          ? obj.exportedAt
          : Date.now(),
      highlightWordsByIndex,
    };
  } catch {
    return null;
  }
}

/** 合并导入词表：同词以导入侧颜色为准 */
export function mergeImportedHighlightWords(
  local: HighlightWordsByIndex | undefined,
  imported: HighlightWordsByIndex,
): HighlightWordsByIndex {
  return mergeHighlightWordsByIndex(local, imported) ?? imported;
}

export async function saveHighlightExportFile(
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
    filters: [{ name: "彩读高亮词", extensions: ["json"] }],
  });
}

export async function pickAndReadHighlightJsonFile(
  title: string,
): Promise<
  | { ok: true; text: string; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  return pickAndReadJsonFile(title, "彩读高亮词");
}
