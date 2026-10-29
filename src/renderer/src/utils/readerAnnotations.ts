import * as monaco from "monaco-editor";
import type { Chapter } from "../chapter";
import {
  applyLeadIndentFullWidth,
  detectChapterTitle,
  displayColumnsToPhysicalSlice,
  displayOffsetToPhysicalOffset,
  physicalOffsetToDisplayOffset,
} from "../chapter";
import { visibleReaderLineFromPhysicalRaw } from "../ebook/ebookTitleMatch";
import { parseLineationColorIndexRaw } from "../constants/annotationColors";
import { pickActiveChapterIdx } from "../reader/chapterIndex";
import type {
  ReaderAnnotationRecord,
  ReaderLineationType,
} from "../stores/fileMetaStore";

export type AnnotationListRow = {
  id: string;
  kind: "lineation" | "note";
  text: string;
  lineationType?: ReaderLineationType;
  colorIndex?: number;
  noteContent?: string;
  stale?: boolean;
  createdAt: number;
  updatedAt: number;
  record: ReaderAnnotationRecord;
};

export type AnnotationListChapterGroup = {
  key: string;
  chapterIdx: number;
  title: string;
  headingLevel?: number;
  rows: AnnotationListRow[];
};

const ANNOTATION_UNGROUPED_CHAPTER_IDX = -1;

/** 存盘区间：物理行 + 物理列（磁盘原文 1-based 列号） */
export type AnnotationRange = {
  startPhysicalLine: number;
  startColumn: number;
  endPhysicalLine: number;
  endColumn: number;
};

/** 物理列 ↔ Monaco 展示列映射（须与 {@link useTxtStreamPipeline.physicalSearchRangeToDisplayColumns} 一致） */
export type AnnotationColumnMapOptions = {
  leadIndentFullWidth: boolean;
};

export function annotationColumnMapOptions(input: {
  readerEditMode: boolean;
  leadIndentFullWidth: boolean;
}): AnnotationColumnMapOptions {
  return {
    leadIndentFullWidth: !input.readerEditMode && input.leadIndentFullWidth,
  };
}

export function chapterTitleExemptForPhysicalLine(
  physicalLine: string,
): boolean {
  return detectChapterTitle(physicalLine) != null;
}

export function physicalColumnToDisplayColumn(
  physicalLine: string,
  physicalColumn1Based: number,
  columnMap: AnnotationColumnMapOptions,
): number {
  if (!columnMap.leadIndentFullWidth) return physicalColumn1Based;
  const exempt = chapterTitleExemptForPhysicalLine(physicalLine);
  return (
    physicalOffsetToDisplayOffset(physicalLine, physicalColumn1Based - 1, {
      exemptChapterTitle: exempt,
    }) + 1
  );
}

export function displayColumnToPhysicalColumn(
  physicalLine: string,
  displayColumn1Based: number,
  columnMap: AnnotationColumnMapOptions,
): number {
  if (!columnMap.leadIndentFullWidth) return displayColumn1Based;
  const exempt = chapterTitleExemptForPhysicalLine(physicalLine);
  return (
    displayOffsetToPhysicalOffset(physicalLine, displayColumn1Based - 1, {
      exemptChapterTitle: exempt,
    }) + 1
  );
}

export function annotationPhysicalRange(
  ann: ReaderAnnotationRecord,
): AnnotationRange {
  return {
    startPhysicalLine: ann.startPhysicalLine,
    startColumn: ann.startColumn,
    endPhysicalLine: ann.endPhysicalLine,
    endColumn: ann.endColumn,
  };
}

export function physicalRangeToMonacoRange(
  range: AnnotationRange,
  physicalToDisplay: (physicalLine: number) => number,
  getPhysicalLineContent: (physicalLine: number) => string,
  columnMap: AnnotationColumnMapOptions,
): monaco.IRange {
  const startLine = physicalToDisplay(range.startPhysicalLine);
  const endLine = physicalToDisplay(range.endPhysicalLine);
  const startColumn = physicalColumnToDisplayColumn(
    getPhysicalLineContent(range.startPhysicalLine),
    range.startColumn,
    columnMap,
  );
  const endColumn = physicalColumnToDisplayColumn(
    getPhysicalLineContent(range.endPhysicalLine),
    range.endColumn,
    columnMap,
  );
  return {
    startLineNumber: startLine,
    startColumn,
    endLineNumber: endLine,
    endColumn,
  };
}

export function monacoRangeToPhysicalRange(
  range: monaco.IRange,
  displayToPhysical: (displayLine: number) => number,
  getPhysicalLineContent: (physicalLine: number) => string,
  columnMap: AnnotationColumnMapOptions,
): AnnotationRange {
  const startPhysicalLine = displayToPhysical(range.startLineNumber);
  const endPhysicalLine = displayToPhysical(range.endLineNumber);
  return {
    startPhysicalLine,
    startColumn: displayColumnToPhysicalColumn(
      getPhysicalLineContent(startPhysicalLine),
      range.startColumn,
      columnMap,
    ),
    endPhysicalLine,
    endColumn: displayColumnToPhysicalColumn(
      getPhysicalLineContent(endPhysicalLine),
      range.endColumn,
      columnMap,
    ),
  };
}

export function rangesEqual(a: AnnotationRange, b: AnnotationRange): boolean {
  return (
    a.startPhysicalLine === b.startPhysicalLine &&
    a.startColumn === b.startColumn &&
    a.endPhysicalLine === b.endPhysicalLine &&
    a.endColumn === b.endColumn
  );
}

export function rangesIntersect(
  a: AnnotationRange,
  b: AnnotationRange,
): boolean {
  if (a.endPhysicalLine < b.startPhysicalLine) return false;
  if (b.endPhysicalLine < a.startPhysicalLine) return false;
  if (
    a.endPhysicalLine === b.startPhysicalLine &&
    a.endColumn <= b.startColumn
  ) {
    return false;
  }
  if (
    b.endPhysicalLine === a.startPhysicalLine &&
    b.endColumn <= a.startColumn
  ) {
    return false;
  }
  return true;
}

export function rangeContainsRange(
  outer: AnnotationRange,
  inner: AnnotationRange,
): boolean {
  if (inner.startPhysicalLine < outer.startPhysicalLine) return false;
  if (inner.endPhysicalLine > outer.endPhysicalLine) return false;
  if (
    inner.startPhysicalLine === outer.startPhysicalLine &&
    inner.startColumn < outer.startColumn
  ) {
    return false;
  }
  if (
    inner.endPhysicalLine === outer.endPhysicalLine &&
    inner.endColumn > outer.endColumn
  ) {
    return false;
  }
  return true;
}

export function findAnnotationContainingRange(
  annotations: readonly ReaderAnnotationRecord[],
  inner: AnnotationRange,
): ReaderAnnotationRecord | null {
  let best: ReaderAnnotationRecord | null = null;
  let bestLen = Infinity;
  for (const ann of annotations) {
    if (ann.stale) continue;
    const outer = annotationPhysicalRange(ann);
    if (!rangeContainsRange(outer, inner)) continue;
    const len =
      (ann.endPhysicalLine - ann.startPhysicalLine) * 1_000_000 +
      (ann.endColumn - ann.startColumn);
    if (len < bestLen) {
      bestLen = len;
      best = ann;
    }
  }
  return best;
}

/** 选区与标注物理范围完全一致时绑定 */
export function findAnnotationMatchingExactSelection(
  annotations: readonly ReaderAnnotationRecord[],
  selection: monaco.IRange,
  displayToPhysical: (displayLine: number) => number,
  getPhysicalLineContent: (physicalLine: number) => string,
  columnMap: AnnotationColumnMapOptions,
): ReaderAnnotationRecord | null {
  const sel = monacoRangeToPhysicalRange(
    selection,
    displayToPhysical,
    getPhysicalLineContent,
    columnMap,
  );
  for (const ann of annotations) {
    if (ann.stale) continue;
    if (rangesEqual(annotationPhysicalRange(ann), sel)) return ann;
  }
  return null;
}

export function findAnnotationsIntersectingRange(
  annotations: readonly ReaderAnnotationRecord[],
  range: AnnotationRange,
): ReaderAnnotationRecord[] {
  return annotations.filter(
    (ann) => !ann.stale && rangesIntersect(annotationPhysicalRange(ann), range),
  );
}

function comparePhysicalPosition(
  line: number,
  column: number,
  otherLine: number,
  otherColumn: number,
): number {
  if (line !== otherLine) return line - otherLine;
  return column - otherColumn;
}

/** 合并多个物理区间为最小覆盖超集 */
export function unionPhysicalRanges(
  ranges: readonly AnnotationRange[],
): AnnotationRange {
  if (ranges.length === 0) {
    throw new Error("unionPhysicalRanges: empty");
  }
  let startPhysicalLine = ranges[0]!.startPhysicalLine;
  let startColumn = ranges[0]!.startColumn;
  let endPhysicalLine = ranges[0]!.endPhysicalLine;
  let endColumn = ranges[0]!.endColumn;
  for (let i = 1; i < ranges.length; i++) {
    const r = ranges[i]!;
    if (
      comparePhysicalPosition(
        r.startPhysicalLine,
        r.startColumn,
        startPhysicalLine,
        startColumn,
      ) < 0
    ) {
      startPhysicalLine = r.startPhysicalLine;
      startColumn = r.startColumn;
    }
    if (
      comparePhysicalPosition(
        r.endPhysicalLine,
        r.endColumn,
        endPhysicalLine,
        endColumn,
      ) > 0
    ) {
      endPhysicalLine = r.endPhysicalLine;
      endColumn = r.endColumn;
    }
  }
  return {
    startPhysicalLine,
    startColumn,
    endPhysicalLine,
    endColumn,
  };
}

/** 笔记面板 / 导出等展示用：折叠空白为单空格 */
export function collapseAnnotationQuoteText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function findAnnotationAtPoint(
  annotations: readonly ReaderAnnotationRecord[],
  physicalLine: number,
  column: number,
): ReaderAnnotationRecord | null {
  const pt: AnnotationRange = {
    startPhysicalLine: physicalLine,
    startColumn: column,
    endPhysicalLine: physicalLine,
    endColumn: column + 1,
  };
  return findAnnotationContainingRange(annotations, pt);
}

export function getTextInPhysicalRange(
  model: monaco.editor.ITextModel,
  range: AnnotationRange,
  physicalToDisplay: (physicalLine: number) => number,
  getPhysicalLineContent: (physicalLine: number) => string,
  columnMap: AnnotationColumnMapOptions,
): string {
  const mr = physicalRangeToMonacoRange(
    range,
    physicalToDisplay,
    getPhysicalLineContent,
    columnMap,
  );
  return model.getValueInRange(mr);
}

/** 标注区间列号语义：默认 physical（磁盘原文列）；display 仅用于旧数据迁移 */
export type AnnotationRangeColumnSpace = "display" | "physical";

function displayLineLengthForPhysicalLine(
  physicalLine: string,
  columnMap: AnnotationColumnMapOptions,
): number {
  if (!columnMap.leadIndentFullWidth) return physicalLine.length;
  const exemptChapterTitle = detectChapterTitle(physicalLine) != null;
  return applyLeadIndentFullWidth(physicalLine, { exemptChapterTitle }).length;
}

function slicePhysicalLineByRangeColumns(
  physicalLine: string,
  startColumn: number,
  endColumn: number,
  columnSpace: AnnotationRangeColumnSpace,
  columnMap: AnnotationColumnMapOptions,
): string {
  if (columnSpace === "physical") {
    return physicalLine.slice(startColumn - 1, endColumn - 1);
  }
  if (!columnMap.leadIndentFullWidth) {
    return physicalLine.slice(startColumn - 1, endColumn - 1);
  }
  const exemptChapterTitle = detectChapterTitle(physicalLine) != null;
  const { start, end } = displayColumnsToPhysicalSlice(
    physicalLine,
    startColumn,
    endColumn,
    { exemptChapterTitle },
  );
  return physicalLine.slice(start, end);
}

/** 单行：展示层选区 → 源物理行 substring */
function slicePhysicalFromDisplayColumns(
  physicalLine: string,
  displayLine: string,
  startColumn: number,
  endColumn: number,
): string {
  const selectedDisplay = displayLine.slice(startColumn - 1, endColumn - 1);
  if (!selectedDisplay) return "";

  const exemptChapterTitle = detectChapterTitle(physicalLine) != null;
  const leadIndented = applyLeadIndentFullWidth(physicalLine, {
    exemptChapterTitle,
  });
  if (displayLine === leadIndented) {
    const { start, end } = displayColumnsToPhysicalSlice(
      physicalLine,
      startColumn,
      endColumn,
      { exemptChapterTitle },
    );
    return physicalLine.slice(start, end);
  }

  const idx = physicalLine.indexOf(selectedDisplay);
  if (idx >= 0) {
    return physicalLine.slice(idx, idx + selectedDisplay.length);
  }

  const visible = visibleReaderLineFromPhysicalRaw(physicalLine);
  const visibleIdx = visible.indexOf(selectedDisplay);
  if (visibleIdx >= 0) {
    return visible.slice(visibleIdx, visibleIdx + selectedDisplay.length);
  }

  return slicePhysicalLineByRangeColumns(
    physicalLine,
    startColumn,
    endColumn,
    "display",
    { leadIndentFullWidth: true },
  );
}

/** 由展示层行号/列号截取源物理区间原文（旧数据迁移） */
export function extractPhysicalTextFromDisplayRange(
  getPhysicalLineContent: (physicalLine: number) => string,
  getDisplayLineContent: (displayLine: number) => string,
  displayToPhysical: (displayLine: number) => number,
  range: AnnotationRange,
  displayLineRange: { startDisplayLine: number; endDisplayLine: number },
): string {
  const { startDisplayLine, endDisplayLine } = displayLineRange;
  if (startDisplayLine === endDisplayLine) {
    const displayLine = getDisplayLineContent(startDisplayLine);
    const physicalLine = getPhysicalLineContent(
      displayToPhysical(startDisplayLine),
    );
    return slicePhysicalFromDisplayColumns(
      physicalLine,
      displayLine,
      range.startColumn,
      range.endColumn,
    );
  }
  const parts: string[] = [];
  for (let dl = startDisplayLine; dl <= endDisplayLine; dl += 1) {
    const displayLine = getDisplayLineContent(dl);
    const physicalLine = getPhysicalLineContent(displayToPhysical(dl));
    const startCol = dl === startDisplayLine ? range.startColumn : 1;
    const endCol =
      dl === endDisplayLine ? range.endColumn : displayLine.length + 1;
    parts.push(
      slicePhysicalFromDisplayColumns(
        physicalLine,
        displayLine,
        startCol,
        endCol,
      ),
    );
  }
  return parts.join("\n");
}

function getTextInDisplayRangeFromDisplayLines(
  getDisplayLineContent: (displayLine: number) => string,
  startDisplayLine: number,
  endDisplayLine: number,
  startColumn: number,
  endColumn: number,
): string {
  if (startDisplayLine === endDisplayLine) {
    const line = getDisplayLineContent(startDisplayLine);
    return line.slice(startColumn - 1, endColumn - 1);
  }
  const parts: string[] = [];
  for (let dl = startDisplayLine; dl <= endDisplayLine; dl += 1) {
    const line = getDisplayLineContent(dl);
    if (dl === startDisplayLine) {
      parts.push(line.slice(startColumn - 1));
    } else if (dl === endDisplayLine) {
      parts.push(line.slice(0, endColumn - 1));
    } else {
      parts.push(line);
    }
  }
  return parts.join("\n");
}

/** 侧栏/导出：由物理区间映射到当前展示层并截取原文 */
export function getTextInDisplayRangeFromStoredRange(
  getDisplayLineContent: (displayLine: number) => string,
  getPhysicalLineContent: (physicalLine: number) => string,
  range: AnnotationRange,
  physicalToDisplay: (physicalLine: number) => number,
  columnMap: AnnotationColumnMapOptions,
): string {
  const mr = physicalRangeToMonacoRange(
    range,
    physicalToDisplay,
    getPhysicalLineContent,
    columnMap,
  );
  return getTextInDisplayRangeFromDisplayLines(
    getDisplayLineContent,
    mr.startLineNumber,
    mr.endLineNumber,
    mr.startColumn,
    mr.endColumn,
  );
}

/** 从源文件物理行截取区间文本；默认列号为磁盘物理列 */
export function getTextInPhysicalRangeFromLines(
  getPhysicalLineContent: (physicalLine: number) => string,
  range: AnnotationRange,
  columnSpace: AnnotationRangeColumnSpace = "physical",
  columnMap: AnnotationColumnMapOptions = { leadIndentFullWidth: false },
): string {
  const { startPhysicalLine, startColumn, endPhysicalLine, endColumn } = range;
  if (startPhysicalLine === endPhysicalLine) {
    const line = getPhysicalLineContent(startPhysicalLine);
    return slicePhysicalLineByRangeColumns(
      line,
      startColumn,
      endColumn,
      columnSpace,
      columnMap,
    );
  }
  const parts: string[] = [];
  for (let ln = startPhysicalLine; ln <= endPhysicalLine; ln++) {
    const line = getPhysicalLineContent(ln);
    if (ln === startPhysicalLine) {
      parts.push(
        slicePhysicalLineByRangeColumns(
          line,
          startColumn,
          displayLineLengthForPhysicalLine(line, columnMap) + 1,
          columnSpace,
          columnMap,
        ),
      );
    } else if (ln === endPhysicalLine) {
      parts.push(
        slicePhysicalLineByRangeColumns(line, 1, endColumn, columnSpace, columnMap),
      );
    } else {
      parts.push(line);
    }
  }
  return parts.join("\n");
}

/**
 * 用 `newText` 替换物理行数组中的区间（列号为 1-based 物理列）。
 * 成功返回新数组，失败返回 `null`（不修改入参）。
 */
export function replaceTextInPhysicalLines(
  lines: readonly string[],
  range: AnnotationRange,
  newText: string,
): string[] | null {
  const { startPhysicalLine, startColumn, endPhysicalLine, endColumn } = range;
  if (
    startPhysicalLine < 1 ||
    endPhysicalLine < startPhysicalLine ||
    endPhysicalLine > lines.length
  ) {
    return null;
  }
  if (startColumn < 1 || endColumn < 1) return null;
  const startLine = lines[startPhysicalLine - 1] ?? "";
  const endLine = lines[endPhysicalLine - 1] ?? "";
  if (startColumn - 1 > startLine.length) return null;
  if (endColumn - 1 > endLine.length) return null;

  const prefix = startLine.slice(0, startColumn - 1);
  const suffix = endLine.slice(endColumn - 1);
  const before = lines.slice(0, startPhysicalLine - 1);
  const after = lines.slice(endPhysicalLine);
  const parts = newText.split("\n");
  if (parts.length === 1) {
    return [...before, prefix + parts[0] + suffix, ...after];
  }
  const merged = parts.slice();
  merged[0] = prefix + merged[0]!;
  merged[merged.length - 1] = merged[merged.length - 1]! + suffix;
  return [...before, ...merged, ...after];
}

/** 从内存中的展示层行数组截取原文 */
export function getTextInDisplayRangeFromLines(
  getDisplayLineContent: (displayLine: number) => string,
  getPhysicalLineContent: (physicalLine: number) => string,
  range: AnnotationRange,
  physicalToDisplay: (physicalLine: number) => number,
  columnMap: AnnotationColumnMapOptions,
): string {
  return getTextInDisplayRangeFromStoredRange(
    getDisplayLineContent,
    getPhysicalLineContent,
    range,
    physicalToDisplay,
    columnMap,
  );
}

/** 侧栏/导出等展示的标注原文（用户笔记 `note.content` 不在此列） */
export function annotationQuoteText(ann: ReaderAnnotationRecord): string {
  return ann.displayText ?? ann.text;
}

/** 装饰命中表列信息（与 {@link buildAnnotationHitsByDisplayLine} 一致） */
export type AnnotationQuoteHit = {
  annotationId: string;
  startColumn: number;
  endColumnExclusive: number;
};

/** 与视口装饰同源：按 hits 列号从 Monaco 截取原文 */
export function getAnnotationQuoteFromHits(
  ann: ReaderAnnotationRecord,
  model: monaco.editor.ITextModel,
  physicalToDisplay: (physicalLine: number) => number,
  hitsByLine: ReadonlyMap<number, readonly AnnotationQuoteHit[]>,
): string | null {
  if (ann.stale) return null;
  const lineCount = model.getLineCount();
  if (lineCount <= 0) return null;
  const parts: string[] = [];
  const seenDisplayLines = new Set<number>();
  for (
    let physicalLine = ann.startPhysicalLine;
    physicalLine <= ann.endPhysicalLine;
    physicalLine += 1
  ) {
    const displayLine = Math.max(1, Math.floor(physicalToDisplay(physicalLine)));
    if (displayLine < 1 || displayLine > lineCount) return null;
    if (seenDisplayLines.has(displayLine)) continue;
    const hits = hitsByLine.get(displayLine);
    const hit = hits?.find((h) => h.annotationId === ann.id);
    if (!hit) continue;
    seenDisplayLines.add(displayLine);
    let line: string;
    try {
      line = model.getLineContent(displayLine);
    } catch {
      return null;
    }
    const maxCol = line.length + 1;
    const startCol = Math.min(Math.max(1, hit.startColumn), maxCol);
    const endCol = Math.min(
      Math.max(startCol, hit.endColumnExclusive),
      maxCol,
    );
    if (startCol >= endCol) return null;
    parts.push(line.slice(startCol - 1, endCol - 1));
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

export type AnnotationDisplayQuoteContext = {
  readerEditMode: boolean;
  getDisplayLineContent: (displayLine: number) => string;
  getPhysicalLineContent: (physicalLine: number) => string;
  physicalToDisplay: (physicalLine: number) => number;
  columnMap: AnnotationColumnMapOptions;
  monacoModel?: monaco.editor.ITextModel | null;
  /** 传入时优先与阅读器装饰同源截取 */
  hitsByLine?: ReadonlyMap<number, readonly AnnotationQuoteHit[]>;
};

/**
 * 标注引用原文（侧栏 / 导出 / 存盘 displayText）。
 * 优先级：hits 表 → Monaco 区间 → 展示行数组 → 物理 text。
 * 不 trim：选区内的行首全角缩进等空白须原样保留。
 */
export function resolveAnnotationDisplayQuote(
  ann: ReaderAnnotationRecord,
  ctx: AnnotationDisplayQuoteContext,
): string {
  if (ctx.readerEditMode) {
    return (
      getTextInPhysicalRangeFromLines(
        ctx.getPhysicalLineContent,
        annotationPhysicalRange(ann),
        "physical",
      ) || ann.text
    );
  }
  if (ann.stale) return annotationQuoteText(ann);

  const model = ctx.monacoModel;
  const lineCount = model?.getLineCount() ?? 0;
  if (model && lineCount > 0) {
    try {
      if (ctx.hitsByLine) {
        const fromHits = getAnnotationQuoteFromHits(
          ann,
          model,
          ctx.physicalToDisplay,
          ctx.hitsByLine,
        );
        if (fromHits && fromHits.length > 0) return fromHits;
      }
      const fromRange = getTextInPhysicalRange(
        model,
        annotationPhysicalRange(ann),
        ctx.physicalToDisplay,
        ctx.getPhysicalLineContent,
        ctx.columnMap,
      );
      if (fromRange.length > 0) return fromRange;
    } catch {
      /* Monaco 尚未就绪或行号越界 */
    }
  }

  try {
    const live = getTextInDisplayRangeFromLines(
      ctx.getDisplayLineContent,
      ctx.getPhysicalLineContent,
      annotationPhysicalRange(ann),
      ctx.physicalToDisplay,
      ctx.columnMap,
    );
    if (live.length > 0) return live;
  } catch {
    /* fall through */
  }
  return ann.text;
}

function compactDisplayTextField(
  text: string,
  displayText: string,
): string | undefined {
  return displayText === text ? undefined : displayText;
}

/** 展示层正文或转换切换后，批量刷新未失效标注的 `displayText` */
export function refreshAnnotationDisplayTexts(
  annotations: readonly ReaderAnnotationRecord[],
  ctx: AnnotationDisplayQuoteContext,
): ReaderAnnotationRecord[] {
  return annotations.map((ann) => {
    if (ann.stale) return ann;
    try {
      const displayText = resolveAnnotationDisplayQuote(ann, ctx);
      const nextDisplay = compactDisplayTextField(ann.text, displayText);
      if (nextDisplay === ann.displayText) return ann;
      if (nextDisplay === undefined) {
        if (ann.displayText === undefined) return ann;
        const { displayText: _omit, ...rest } = ann;
        return rest;
      }
      return { ...ann, displayText: nextDisplay };
    } catch {
      return ann;
    }
  });
}

function stripLegacyDisplayLineFields(
  ann: ReaderAnnotationRecord,
): ReaderAnnotationRecord {
  if (ann.startDisplayLine == null && ann.endDisplayLine == null) return ann;
  const { startDisplayLine: _s, endDisplayLine: _e, ...rest } = ann;
  return rest;
}

function locatePhysicalRangeForStoredText(
  ann: ReaderAnnotationRecord,
  getPhysicalLineContent: (physicalLine: number) => string,
): AnnotationRange | null {
  const needle = ann.text;
  if (!needle) return null;
  const startLine = ann.startPhysicalLine;
  const endLine = ann.endPhysicalLine;
  if (startLine === endLine) {
    const line = getPhysicalLineContent(startLine);
    const idx = line.indexOf(needle);
    if (idx < 0) return null;
    return {
      startPhysicalLine: startLine,
      startColumn: idx + 1,
      endPhysicalLine: endLine,
      endColumn: idx + 1 + needle.length,
    };
  }
  const parts: string[] = [];
  for (let ln = startLine; ln <= endLine; ln += 1) {
    parts.push(getPhysicalLineContent(ln));
  }
  const joined = parts.join("\n");
  const idx = joined.indexOf(needle);
  if (idx < 0) return null;
  let offset = 0;
  for (let ln = startLine; ln <= endLine; ln += 1) {
    const line = parts[ln - startLine] ?? "";
    const lineEnd = offset + line.length;
    if (idx >= offset && idx < lineEnd) {
      const startColumn = idx - offset + 1;
      const endOffset = idx + needle.length;
      if (endOffset <= lineEnd) {
        return {
          startPhysicalLine: ln,
          startColumn,
          endPhysicalLine: ln,
          endColumn: startColumn + needle.length,
        };
      }
      let endPhysicalLine = ln;
      let endColumn = line.length + 1;
      let scan = lineEnd + 1;
      for (let next = ln + 1; next <= endLine; next += 1) {
        const nextLine = parts[next - startLine] ?? "";
        const nextEnd = scan + nextLine.length;
        if (endOffset <= nextEnd) {
          endPhysicalLine = next;
          endColumn = endOffset - scan + 1;
          break;
        }
        scan = nextEnd + 1;
      }
      return {
        startPhysicalLine: ln,
        startColumn,
        endPhysicalLine,
        endColumn,
      };
    }
    offset = lineEnd + 1;
  }
  return null;
}

/** 旧版存盘为展示列时，一次性改写为物理列 */
export function migrateLegacyAnnotationToPhysicalColumns(
  ann: ReaderAnnotationRecord,
  getPhysicalLineContent: (physicalLine: number) => string,
  getDisplayLineContent: (displayLine: number) => string,
  displayToPhysical: (displayLine: number) => number,
  physicalToDisplay: (physicalLine: number) => number,
): ReaderAnnotationRecord | null {
  const range = annotationPhysicalRange(ann);
  const physicalText = getTextInPhysicalRangeFromLines(
    getPhysicalLineContent,
    range,
    "physical",
  );
  if (physicalText === ann.text) {
    return stripLegacyDisplayLineFields(ann);
  }

  const legacyStartDisplay =
    ann.startDisplayLine ?? physicalToDisplay(ann.startPhysicalLine);
  const legacyEndDisplay =
    ann.endDisplayLine ?? physicalToDisplay(ann.endPhysicalLine);
  const legacyText = extractPhysicalTextFromDisplayRange(
    getPhysicalLineContent,
    getDisplayLineContent,
    displayToPhysical,
    range,
    {
      startDisplayLine: legacyStartDisplay,
      endDisplayLine: legacyEndDisplay,
    },
  );
  if (legacyText === ann.text) {
    for (const leadIndentFullWidth of [true, false] as const) {
      const migrated = monacoRangeToPhysicalRange(
        {
          startLineNumber: legacyStartDisplay,
          startColumn: ann.startColumn,
          endLineNumber: legacyEndDisplay,
          endColumn: ann.endColumn,
        },
        displayToPhysical,
        getPhysicalLineContent,
        { leadIndentFullWidth },
      );
      const migratedText = getTextInPhysicalRangeFromLines(
        getPhysicalLineContent,
        migrated,
        "physical",
      );
      if (migratedText === ann.text) {
        const { startDisplayLine: _s, endDisplayLine: _e, ...base } = ann;
        return { ...base, ...migrated };
      }
    }
  }

  const located = locatePhysicalRangeForStoredText(ann, getPhysicalLineContent);
  if (!located) return null;
  const locatedText = getTextInPhysicalRangeFromLines(
    getPhysicalLineContent,
    located,
    "physical",
  );
  if (locatedText !== ann.text) return null;
  const { startDisplayLine: _s, endDisplayLine: _e, ...base } = ann;
  return { ...base, ...located };
}

export function validateAnnotationAgainstPhysicalSource(
  getPhysicalLineContent: (physicalLine: number) => string,
  getPhysicalLineCount: () => number,
  ann: ReaderAnnotationRecord,
): { valid: boolean; stale: boolean } {
  const range = annotationPhysicalRange(ann);
  if (
    range.startPhysicalLine < 1 ||
    range.endPhysicalLine > getPhysicalLineCount()
  ) {
    return { valid: false, stale: true };
  }
  try {
    const physicalText = getTextInPhysicalRangeFromLines(
      getPhysicalLineContent,
      range,
      "physical",
    );
    if (physicalText === ann.text) {
      return { valid: true, stale: false };
    }
    return { valid: false, stale: true };
  } catch {
    return { valid: false, stale: true };
  }
}

export function revalidateAnnotations(
  getPhysicalLineContent: (physicalLine: number) => string,
  getPhysicalLineCount: () => number,
  annotations: ReaderAnnotationRecord[],
  options?: {
    getDisplayLineContent?: (displayLine: number) => string;
    displayToPhysical?: (displayLine: number) => number;
    physicalToDisplay?: (physicalLine: number) => number;
  },
): ReaderAnnotationRecord[] {
  return annotations.map((ann) => {
    let current = ann;
    if (
      options?.getDisplayLineContent &&
      options.displayToPhysical &&
      options.physicalToDisplay
    ) {
      const migrated = migrateLegacyAnnotationToPhysicalColumns(
        ann,
        getPhysicalLineContent,
        options.getDisplayLineContent,
        options.displayToPhysical,
        options.physicalToDisplay,
      );
      if (migrated) current = migrated;
    }
    const { stale } = validateAnnotationAgainstPhysicalSource(
      getPhysicalLineContent,
      getPhysicalLineCount,
      current,
    );
    if (!!current.stale === stale && current === ann) return ann;
    return { ...current, stale: stale || undefined };
  });
}

export function buildAnnotationListRows(
  annotations: readonly ReaderAnnotationRecord[],
  resolveQuoteText?: (ann: ReaderAnnotationRecord) => string,
): AnnotationListRow[] {
  const rows: AnnotationListRow[] = annotations.map((ann) => {
    const hasNote = !!ann.note?.content?.trim();
    return {
      id: ann.id,
      kind: hasNote ? "note" : "lineation",
      text: resolveQuoteText?.(ann) ?? annotationQuoteText(ann),
      lineationType: ann.lineation?.type,
      colorIndex: ann.lineation?.colorIndex,
      noteContent: ann.note?.content,
      stale: ann.stale,
      createdAt: ann.createdAt,
      updatedAt: ann.updatedAt,
      record: ann,
    };
  });
  rows.sort((a, b) => {
    if (a.record.startPhysicalLine !== b.record.startPhysicalLine) {
      return (
        a.record.startPhysicalLine - b.record.startPhysicalLine ||
        a.record.startColumn - b.record.startColumn
      );
    }
    return a.record.startColumn - b.record.startColumn;
  });
  return rows;
}

/** 按标注起始位置所属章节分组；无章节表时返回单组且无标题（不展示分组头）。 */
export function groupAnnotationListRowsByChapter(
  rows: readonly AnnotationListRow[],
  chapters: readonly Chapter[],
  physicalLineToDisplayLine: (physicalLine: number) => number,
): AnnotationListChapterGroup[] {
  if (rows.length === 0) return [];
  if (chapters.length === 0) {
    return [
      {
        key: "flat",
        chapterIdx: -2,
        title: "",
        rows: [...rows],
      },
    ];
  }

  const bucket = new Map<number, AnnotationListRow[]>();
  for (const row of rows) {
    const displayLine = physicalLineToDisplayLine(row.record.startPhysicalLine);
    const idx = pickActiveChapterIdx(chapters, displayLine);
    const list = bucket.get(idx) ?? [];
    list.push(row);
    bucket.set(idx, list);
  }

  const groups: AnnotationListChapterGroup[] = [];
  const pushGroup = (
    chapterIdx: number,
    title: string,
    headingLevel?: number,
  ) => {
    const groupRows = bucket.get(chapterIdx);
    if (!groupRows?.length) return;
    groups.push({
      key: chapterIdx < 0 ? "__ungrouped__" : `ch-${chapterIdx}`,
      chapterIdx,
      title,
      headingLevel,
      rows: groupRows,
    });
    bucket.delete(chapterIdx);
  };

  pushGroup(ANNOTATION_UNGROUPED_CHAPTER_IDX, "未分章");
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]!;
    const title = ch.title.trim();
    pushGroup(i, title || `第 ${i + 1} 章`, ch.headingLevel);
  }
  for (const [idx, groupRows] of bucket) {
    const ch = chapters[idx];
    groups.push({
      key: `ch-${idx}`,
      chapterIdx: idx,
      title: ch?.title?.trim() || "未分章",
      headingLevel: ch?.headingLevel,
      rows: groupRows,
    });
  }
  return groups;
}

function normalizeLineation(raw: unknown): ReaderAnnotationRecord["lineation"] {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type !== "marker" && type !== "wavy" && type !== "straight") {
    return undefined;
  }
  return {
    type,
    colorIndex: parseLineationColorIndexRaw(o.colorIndex),
  };
}

function normalizeNote(raw: unknown): ReaderAnnotationRecord["note"] {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const content = typeof o.content === "string" ? o.content.trim() : "";
  if (!content) return undefined;
  const now = Date.now();
  const createdAt =
    typeof o.createdAt === "number" && Number.isFinite(o.createdAt)
      ? Math.floor(o.createdAt)
      : now;
  const updatedAt =
    typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
      ? Math.floor(o.updatedAt)
      : now;
  return { content, createdAt, updatedAt };
}

export function normalizeReaderAnnotation(
  raw: unknown,
): ReaderAnnotationRecord | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  const startPhysicalLine = Math.max(
    1,
    Math.floor(Number(o.startPhysicalLine)),
  );
  const startColumn = Math.max(1, Math.floor(Number(o.startColumn)));
  const endPhysicalLine = Math.max(
    1,
    Math.floor(Number(o.endPhysicalLine)),
  );
  const endColumn = Math.max(1, Math.floor(Number(o.endColumn)));
  const startDisplayLineRaw = Number(o.startDisplayLine);
  const endDisplayLineRaw = Number(o.endDisplayLine);
  const startDisplayLine =
    Number.isFinite(startDisplayLineRaw) && startDisplayLineRaw >= 1
      ? Math.floor(startDisplayLineRaw)
      : undefined;
  const endDisplayLine =
    Number.isFinite(endDisplayLineRaw) && endDisplayLineRaw >= 1
      ? Math.floor(endDisplayLineRaw)
      : undefined;
  const text = typeof o.text === "string" ? o.text : "";
  if (!text) return null;
  const displayTextRaw =
    typeof o.displayText === "string" ? o.displayText : undefined;
  const displayText =
    displayTextRaw && displayTextRaw !== text ? displayTextRaw : undefined;
  const lineation = normalizeLineation(o.lineation);
  const note = normalizeNote(o.note);
  if (!lineation && !note) return null;
  const now = Date.now();
  const createdAt =
    typeof o.createdAt === "number" && Number.isFinite(o.createdAt)
      ? Math.floor(o.createdAt)
      : now;
  const updatedAt =
    typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
      ? Math.floor(o.updatedAt)
      : now;
  const stale = o.stale === true ? true : undefined;
  return {
    id,
    startPhysicalLine,
    startColumn,
    endPhysicalLine,
    endColumn,
    ...(startDisplayLine != null && endDisplayLine != null
      ? { startDisplayLine, endDisplayLine }
      : {}),
    text,
    ...(displayText ? { displayText } : {}),
    lineation,
    note,
    createdAt,
    updatedAt,
    stale,
  };
}

export function normalizeReaderAnnotations(
  raw: unknown,
): ReaderAnnotationRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, ReaderAnnotationRecord>();
  for (const item of raw) {
    const n = normalizeReaderAnnotation(item);
    if (n) byId.set(n.id, n);
  }
  return [...byId.values()];
}

export function createAnnotationFromRange(
  range: AnnotationRange,
  text: string,
  partial?: Partial<
    Pick<ReaderAnnotationRecord, "lineation" | "note" | "id" | "displayText">
  >,
): ReaderAnnotationRecord {
  const now = Date.now();
  const displayText =
    partial?.displayText && partial.displayText !== text
      ? partial.displayText
      : undefined;
  return {
    id: partial?.id ?? crypto.randomUUID(),
    ...range,
    text,
    ...(displayText ? { displayText } : {}),
    lineation: partial?.lineation,
    note: partial?.note,
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeImportedAnnotations(
  local: ReaderAnnotationRecord[],
  imported: ReaderAnnotationRecord[],
): ReaderAnnotationRecord[] {
  const map = new Map(local.map((a) => [a.id, a]));
  for (const ann of imported) {
    map.set(ann.id, ann);
  }
  return [...map.values()];
}

