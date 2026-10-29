import type { Chapter } from "../chapter";
import type { ReaderAnnotationRecord } from "../stores/fileMetaStore";
import {
  buildAnnotationListRows,
  groupAnnotationListRowsByChapter,
} from "./readerAnnotations";
import { sanitizeChatExportTitleForFilename } from "../aiAssistant/aiAssistantExport";

export type ReaderAnnotationsExportV1 = {
  schemaVersion: 1;
  exportedAt: number;
  bookPath: string;
  bookName: string;
  annotations: ReaderAnnotationRecord[];
};

export function bookTitleForExport(bookName: string): string {
  const trimmed = bookName.trim();
  // 去掉末尾常见正文书后缀（可连续，如 foo.epub.md → foo）
  const withoutExt = trimmed
    .replace(/(\.(txt|md|epub|mobi|azw3|fb2|fbz|pdf|chm))+$/i, "")
    .trim();
  return withoutExt || trimmed || "未命名";
}

export function buildAnnotationExportDefaultName(
  bookName: string,
  ext: "md" | "json",
): string {
  const titlePart = sanitizeChatExportTitleForFilename(
    bookTitleForExport(bookName || "笔记"),
  );
  return `${titlePart}.notes.${ext}`;
}

export function buildReaderAnnotationsExportJson(
  bookPath: string,
  bookName: string,
  annotations: ReaderAnnotationRecord[],
): string {
  const payload: ReaderAnnotationsExportV1 = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    bookPath,
    bookName,
    annotations,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseReaderAnnotationsExportJson(
  raw: string,
): ReaderAnnotationsExportV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as ReaderAnnotationsExportV1).schemaVersion !== 1 ||
      !Array.isArray((parsed as ReaderAnnotationsExportV1).annotations)
    ) {
      return null;
    }
    return parsed as ReaderAnnotationsExportV1;
  } catch {
    return null;
  }
}

function prefixFirstLine(prefix: string, content: string): string {
  if (!content) return prefix.trimEnd();
  const nl = content.indexOf("\n");
  if (nl === -1) return `${prefix}${content}`;
  return `${prefix}${content.slice(0, nl)}\n${content.slice(nl + 1)}`;
}

function blockquoteLines(text: string): string[] {
  return text.split("\n").map((line) => `> ${line}`);
}

function appendAnnotationMarkdownLines(
  lines: string[],
  ann: ReaderAnnotationRecord,
  quoteText: string,
): void {
  const stale = ann.stale ? "[已失效] " : "";
  const noteContent = ann.note?.content?.trim();
  if (noteContent) {
    lines.push(prefixFirstLine(`${stale}💡 `, quoteText));
    lines.push("");
    lines.push(...blockquoteLines(noteContent));
    lines.push("");
    return;
  }
  if (ann.lineation) {
    lines.push(`${stale}✨ ${quoteText}`);
    lines.push("");
  }
}

export function buildReaderAnnotationsExportMarkdown(
  bookName: string,
  annotations: ReaderAnnotationRecord[],
  options?: {
    chapters?: readonly Chapter[];
    physicalLineToDisplayLine?: (physicalLine: number) => number;
    resolveQuoteText?: (ann: ReaderAnnotationRecord) => string;
  },
): string {
  const title = bookTitleForExport(bookName);
  const lines: string[] = [`# 《${title}》阅读笔记`, ""];

  const rows = buildAnnotationListRows(annotations, options?.resolveQuoteText);
  const groups = groupAnnotationListRowsByChapter(
    rows,
    options?.chapters ?? [],
    options?.physicalLineToDisplayLine ?? ((physicalLine) => physicalLine),
  );

  for (const group of groups) {
    if (group.title) {
      lines.push(`## ${group.title}`);
      lines.push("");
    }
    for (const row of group.rows) {
      appendAnnotationMarkdownLines(lines, row.record, row.text);
    }
  }

  lines.push("", "---", "", `*导出于 ${new Date().toLocaleString()}*`);

  return lines.join("\n").trimEnd() + "\n";
}

export async function saveAnnotationExportFile(
  defaultName: string,
  data: string,
  ext: "md" | "json",
): Promise<
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  return window.colorTxt.ai.exportSave({
    defaultName,
    data,
    filters:
      ext === "md"
        ? [{ name: "彩读笔记", extensions: ["md"] }]
        : [{ name: "彩读笔记", extensions: ["json"] }],
  });
}

export async function pickAndReadJsonFile(
  title = "导入笔记（JSON）",
  filterName = "彩读笔记",
): Promise<
  | { ok: true; text: string; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  const r = await window.colorTxt.showOpenDialog({
    title,
    filters: [{ name: filterName, extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths?.[0]) {
    return { ok: false, cancelled: true };
  }
  const filePath = r.filePaths[0];
  try {
    const buf = await window.colorTxt.readFileAsArrayBuffer(filePath);
    const text = new TextDecoder("utf-8").decode(buf);
    return { ok: true, text, path: filePath };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
