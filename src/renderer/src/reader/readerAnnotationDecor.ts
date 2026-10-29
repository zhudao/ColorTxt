import * as monaco from "monaco-editor";
import {
  clampLineationColorIndex,
  lineationColorAt,
} from "../constants/annotationColors";
import {
  annotationPhysicalRange,
  physicalColumnToDisplayColumn,
  physicalRangeToMonacoRange,
  type AnnotationColumnMapOptions,
} from "../utils/readerAnnotations";
import type {
  ReaderAnnotationRecord,
  ReaderLineationType,
} from "../stores/fileMetaStore";

export type AnnotationCompactHit = {
  annotationId: string;
  startColumn: number;
  endColumnExclusive: number;
  lineationType?: ReaderLineationType;
  colorIndex?: number;
  hasNote: boolean;
  noteContent?: string;
};

export const ANNOTATION_VIEWPORT_BUFFER_LINES = 80;
export const ANNOTATION_VIEWPORT_SYNC_MS = 48;

/** 与阅读器 Monaco 模型语言 `txtr-text` 一致 */
const TXTR_TEXT_LANGUAGE_ID = "txtr-text";

export function buildAnnotationHitsByDisplayLine(
  annotations: readonly ReaderAnnotationRecord[],
  physicalToDisplay: (physicalLine: number) => number,
  getPhysicalLineContent: (physicalLine: number) => string,
  columnMap: AnnotationColumnMapOptions,
  lineationColorCount?: number,
): Map<number, AnnotationCompactHit[]> {
  const map = new Map<number, AnnotationCompactHit[]>();
  for (const ann of annotations) {
    if (ann.stale) continue;
    for (
      let physicalLine = ann.startPhysicalLine;
      physicalLine <= ann.endPhysicalLine;
      physicalLine += 1
    ) {
      const rawLine = getPhysicalLineContent(physicalLine);
      // 压缩空行时空白物理行会映射到下一段正文展示行；再插 hit 会让原文/悬停重复
      if (rawLine.trim().length === 0) continue;
      const displayLine = physicalToDisplay(physicalLine);
      let startColumn = 1;
      let endColumnExclusive = Number.MAX_SAFE_INTEGER;
      if (physicalLine === ann.startPhysicalLine) {
        startColumn = physicalColumnToDisplayColumn(
          rawLine,
          ann.startColumn,
          columnMap,
        );
      }
      if (physicalLine === ann.endPhysicalLine) {
        endColumnExclusive = physicalColumnToDisplayColumn(
          rawLine,
          ann.endColumn,
          columnMap,
        );
      }
      const hits = map.get(displayLine) ?? [];
      const existing = hits.find((h) => h.annotationId === ann.id);
      if (existing) {
        existing.startColumn = Math.min(existing.startColumn, startColumn);
        existing.endColumnExclusive = Math.max(
          existing.endColumnExclusive,
          endColumnExclusive,
        );
        continue;
      }
      const rawColorIndex = ann.lineation?.colorIndex;
      hits.push({
        annotationId: ann.id,
        startColumn,
        endColumnExclusive,
        lineationType: ann.lineation?.type,
        colorIndex:
          ann.lineation?.type != null && lineationColorCount != null
            ? clampLineationColorIndex(rawColorIndex ?? 0, lineationColorCount)
            : rawColorIndex,
        hasNote: !!ann.note?.content?.trim(),
        noteContent: ann.note?.content,
      });
      map.set(displayLine, hits);
    }
  }
  return map;
}

function annotationInlineClassName(hit: AnnotationCompactHit): string {
  const parts = ["readerAnnotationHit"];
  const colorIdx = hit.colorIndex ?? 0;
  if (hit.lineationType === "marker") {
    parts.push("readerAnnotationMarker");
    parts.push(`readerAnnotationMarker--${colorIdx}`);
  } else if (hit.lineationType === "wavy") {
    parts.push("readerAnnotationWavy");
    parts.push(`readerAnnotationWavy--${colorIdx}`);
  } else if (hit.lineationType === "straight") {
    parts.push("readerAnnotationStraight");
    parts.push(`readerAnnotationStraight--${colorIdx}`);
  } else if (hit.hasNote) {
    parts.push("readerAnnotationNoteOnly");
  }
  return parts.join(" ");
}

export function buildAnnotationDecorationsForViewport(
  lo: number,
  hi: number,
  hitsByLine: Map<number, AnnotationCompactHit[]>,
  model: monaco.editor.ITextModel,
): monaco.editor.IModelDeltaDecoration[] {
  const decs: monaco.editor.IModelDeltaDecoration[] = [];
  for (let line = lo; line <= hi; line++) {
    const hits = hitsByLine.get(line);
    if (!hits?.length) continue;
    const maxCol = model.getLineMaxColumn(line);
    for (const h of hits) {
      const endCol = Math.min(h.endColumnExclusive, maxCol);
      const startCol = Math.min(h.startColumn, maxCol);
      if (startCol >= endCol) continue;
      decs.push({
        range: new monaco.Range(line, startCol, line, endCol),
        options: {
          inlineClassName: annotationInlineClassName(h),
          stickiness:
            monaco.editor.TrackedRangeStickiness
              .NeverGrowsWhenTypingAtEdges,
        },
      });
    }
  }
  return decs;
}

/** 笔记悬停按纯文本转义，避免 `*` / `_` 被当成 Markdown */
export function annotationNoteToHoverMarkdown(
  note: string,
): monaco.IMarkdownString {
  const escaped = note.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
  const value = escaped.replace(/\r\n|\r/g, "\n").replace(/\n/g, "  \n");
  return { value, supportHtml: false };
}

export function annotationNotesAtColumn(
  hits: readonly AnnotationCompactHit[] | undefined,
  column: number,
  maxColumn: number,
  suppressAnnotationId: string | null,
): { notes: string[] } | null {
  if (!hits?.length) return null;
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (!h.noteContent) continue;
    if (suppressAnnotationId && h.annotationId === suppressAnnotationId) {
      continue;
    }
    const start = Math.min(h.startColumn, maxColumn);
    const end = Math.min(h.endColumnExclusive, maxColumn);
    if (column < start || column >= end) continue;
    if (seen.has(h.annotationId)) continue;
    seen.add(h.annotationId);
    notes.push(h.noteContent);
  }
  return notes.length > 0 ? { notes } : null;
}

type AnnotationNoteHoverQuery = (
  model: monaco.editor.ITextModel,
  position: monaco.Position,
) => monaco.languages.Hover | null;

const annotationNoteHoverQueries = new Set<AnnotationNoteHoverQuery>();
let annotationNoteHoverProvider: monaco.IDisposable | null = null;

/**
 * 笔记悬停走 HoverProvider，而不是每行 decoration 的 hoverMessage。
 * 折行时鼠标锚点常是整段 view line，窄 hoverMessage 会被滤掉或叠出多个框。
 */
export function registerAnnotationNoteHoverQuery(
  query: AnnotationNoteHoverQuery,
): monaco.IDisposable {
  if (!annotationNoteHoverProvider) {
    annotationNoteHoverProvider = monaco.languages.registerHoverProvider(
      TXTR_TEXT_LANGUAGE_ID,
      {
        provideHover(model, position) {
          for (const q of annotationNoteHoverQueries) {
            const hover = q(model, position);
            if (hover) return hover;
          }
          return null;
        },
      },
    );
  }
  annotationNoteHoverQueries.add(query);
  return {
    dispose() {
      annotationNoteHoverQueries.delete(query);
    },
  };
}

/** 笔记-only 虚线：1px、短间隔 dash，接近微信读书 */
export const READER_ANNOTATION_NOTE_ONLY_CSS_RULE =
  ".monaco-editor .view-lines .view-line span.readerAnnotationNoteOnly { text-decoration: none !important; background-image: repeating-linear-gradient(90deg, color-mix(in srgb, var(--vscode-editor-foreground, #888) 32%, transparent) 0, color-mix(in srgb, var(--vscode-editor-foreground, #888) 32%, transparent) 4px, transparent 4px, transparent 6px) !important; background-size: 6px 1px !important; background-repeat: repeat-x !important; background-position: 0 100% !important; padding-bottom: 2px !important; box-decoration-break: clone !important; -webkit-box-decoration-break: clone !important; }";

export function annotationMarkerCssRules(
  colors: readonly string[],
): string {
  const rules: string[] = [
    ".monaco-editor .view-lines .view-line span.readerAnnotationHit { cursor: pointer; box-decoration-break: clone; -webkit-box-decoration-break: clone; }",
    READER_ANNOTATION_NOTE_ONLY_CSS_RULE,
  ];
  for (let i = 0; i < colors.length; i++) {
    const c = lineationColorAt(i, colors);
    rules.push(
      `.monaco-editor .view-lines .view-line span.readerAnnotationMarker--${i} { background-color: color-mix(in srgb, ${c} 35%, transparent) !important; border-radius: 2px; }`,
      `.monaco-editor .view-lines .view-line span.readerAnnotationWavy--${i} { text-decoration: underline wavy ${c} !important; text-decoration-thickness: 2px; text-underline-offset: 4px; }`,
      `.monaco-editor .view-lines .view-line span.readerAnnotationStraight--${i} { text-decoration: underline solid ${c} !important; text-decoration-thickness: 2px; text-underline-offset: 4px; }`,
    );
  }
  return rules.join("\n");
}

export function monacoRangeFromAnnotation(
  ann: ReaderAnnotationRecord,
  physicalToDisplay: (n: number) => number,
  getPhysicalLineContent: (physicalLine: number) => string,
  columnMap: AnnotationColumnMapOptions,
): monaco.IRange {
  return physicalRangeToMonacoRange(
    annotationPhysicalRange(ann),
    physicalToDisplay,
    getPhysicalLineContent,
    columnMap,
  );
}
