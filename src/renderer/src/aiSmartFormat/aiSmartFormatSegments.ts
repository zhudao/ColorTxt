import {
  resolveSmartFormatChunkMaxChars,
  splitTextByMaxChars,
} from "@shared/aiSmartFormatChunkLimits";
import type { Chapter } from "../chapter";

export type SmartFormatSegmentPlan = {
  id: string;
  /** 任务开始时 1-based 行号（写回前须叠加 lineDelta） */
  startLine: number;
  endLine: number;
  /** 首行 1-based 列（含）；缺省为 1 */
  startColumn?: number;
  /** 末行 1-based 列（含）；缺省为行末 */
  endColumn?: number;
};

function linesFromModelText(
  fullText: string,
  startLine: number,
  endLine: number,
): string {
  const lines = fullText.split("\n");
  const start = Math.max(1, Math.min(startLine, lines.length));
  const end = Math.max(start, Math.min(endLine, lines.length));
  return lines.slice(start - 1, end).join("\n");
}

function lineLengthInRangeText(
  rangeText: string,
  rangeStartLine: number,
  lineNumber: number,
): number {
  const lineIndex = lineNumber - rangeStartLine;
  const lines = rangeText.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return 0;
  return lines[lineIndex]!.length;
}

/** `offset` 为 rangeText 内 0-based 字符偏移，返回全文 1-based 行列 */
function offsetToLineColumn(
  rangeText: string,
  offset: number,
  rangeStartLine: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, rangeText.length));
  const before = rangeText.slice(0, clamped);
  const lineIndexInRange = before.split("\n").length - 1;
  const lastNl = before.lastIndexOf("\n");
  const column = lastNl < 0 ? clamped + 1 : clamped - lastNl;
  return { line: rangeStartLine + lineIndexInRange, column };
}

function appendSegmentsForLineRange(
  plans: SmartFormatSegmentPlan[],
  fullText: string,
  startLine: number,
  endLine: number,
  idPrefix: string,
  chunkMaxChars: number,
): void {
  if (startLine > endLine) return;
  const rangeText = linesFromModelText(fullText, startLine, endLine);
  if (!rangeText) {
    plans.push({ id: `${idPrefix}-0`, startLine, endLine });
    return;
  }
  if (rangeText.length <= chunkMaxChars) {
    plans.push({ id: `${idPrefix}-0`, startLine, endLine });
    return;
  }

  const chunks = splitTextByMaxChars(rangeText, chunkMaxChars);
  let charOffset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkLen = chunks[i]!.length;
    const charStart = charOffset;
    const charEnd = charOffset + chunkLen;
    const start = offsetToLineColumn(rangeText, charStart, startLine);
    const lastChar = offsetToLineColumn(
      rangeText,
      Math.max(charStart, charEnd - 1),
      startLine,
    );

    const plan: SmartFormatSegmentPlan = {
      id: `${idPrefix}-${i}`,
      startLine: start.line,
      endLine: lastChar.line,
    };

    const atRangeStart = charStart === 0;
    const atRangeEnd = charEnd >= rangeText.length;
    const lastLineLen = lineLengthInRangeText(
      rangeText,
      startLine,
      lastChar.line,
    );

    if (!atRangeStart || start.column > 1) {
      plan.startColumn = start.column;
    }
    if (!atRangeEnd || lastChar.column < lastLineLen) {
      plan.endColumn = lastChar.column;
    }

    plans.push(plan);
    charOffset = charEnd;
  }
}

/** 全文：按章节切分（含第一章前内容）；超长章再按 maxTokens 预算切块 */
export function planFullTextSegments(
  lineCount: number,
  chapters: readonly Chapter[],
  fullText: string,
  maxTokens?: number,
): SmartFormatSegmentPlan[] {
  const chunkMaxChars = resolveSmartFormatChunkMaxChars(maxTokens);
  if (lineCount < 1) return [];
  if (chapters.length > 0) {
    const plans: SmartFormatSegmentPlan[] = [];
    const firstChapterLine = chapters[0]!.lineNumber;
    if (firstChapterLine > 1) {
      appendSegmentsForLineRange(
        plans,
        fullText,
        1,
        firstChapterLine - 1,
        "pre",
        chunkMaxChars,
      );
    }
    for (let i = 0; i < chapters.length; i++) {
      const startLine = chapters[i]!.lineNumber;
      const endLine =
        i + 1 < chapters.length
          ? chapters[i + 1]!.lineNumber - 1
          : lineCount;
      if (startLine > endLine || startLine > lineCount) continue;
      appendSegmentsForLineRange(
        plans,
        fullText,
        startLine,
        Math.min(endLine, lineCount),
        `ch-${i}`,
        chunkMaxChars,
      );
    }
    if (plans.length > 0) return plans;
  }

  const plans: SmartFormatSegmentPlan[] = [];
  appendSegmentsForLineRange(
    plans,
    fullText,
    1,
    lineCount,
    "blk",
    chunkMaxChars,
  );
  return plans;
}

/** 选区：按 maxTokens 预算切块（行号相对于全文） */
export function planSelectionSegments(
  fullText: string,
  selStartLine: number,
  selEndLine: number,
  maxTokens?: number,
): SmartFormatSegmentPlan[] {
  const chunkMaxChars = resolveSmartFormatChunkMaxChars(maxTokens);
  const plans: SmartFormatSegmentPlan[] = [];
  appendSegmentsForLineRange(
    plans,
    fullText,
    selStartLine,
    selEndLine,
    "sel",
    chunkMaxChars,
  );
  return plans;
}

export function countLinesInText(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

export function lineDeltaAfterReplace(
  oldText: string,
  newText: string,
): number {
  return countLinesInText(newText) - countLinesInText(oldText);
}

/** 从 workingLines 按段计划提取正文（支持行内切块） */
export function extractSegmentTextFromWorkingLines(
  workingLines: string[],
  plan: SmartFormatSegmentPlan,
  rangeStart: number,
  lineDelta: number,
): string {
  const startIdx = plan.startLine - rangeStart + lineDelta;
  const endIdx = plan.endLine - rangeStart + lineDelta;
  if (startIdx < 0 || endIdx >= workingLines.length) {
    return "";
  }
  const hasPartial =
    plan.startColumn != null ||
    plan.endColumn != null;
  if (!hasPartial) {
    return workingLines.slice(startIdx, endIdx + 1).join("\n");
  }

  const parts: string[] = [];
  for (let li = startIdx; li <= endIdx; li++) {
    const line = workingLines[li] ?? "";
    const sc = li === startIdx ? (plan.startColumn ?? 1) - 1 : 0;
    const ec =
      li === endIdx
        ? plan.endColumn != null
          ? plan.endColumn
          : line.length
        : line.length;
    parts.push(line.slice(sc, ec));
  }
  return parts.join("\n");
}

/** 将段结果写回 workingLines（支持行内切块） */
export function applySegmentTextToWorkingLines(
  workingLines: string[],
  plan: SmartFormatSegmentPlan,
  rangeStart: number,
  lineDelta: number,
  newText: string,
): void {
  const startIdx = plan.startLine - rangeStart + lineDelta;
  const endIdx = plan.endLine - rangeStart + lineDelta;
  if (startIdx < 0 || endIdx >= workingLines.length) return;

  const hasPartial =
    plan.startColumn != null ||
    plan.endColumn != null;
  if (!hasPartial) {
    workingLines.splice(startIdx, endIdx - startIdx + 1, ...newText.split("\n"));
    return;
  }

  const firstLine = workingLines[startIdx] ?? "";
  const lastLine = workingLines[endIdx] ?? "";
  const sc = (plan.startColumn ?? 1) - 1;
  const ec =
    plan.endColumn != null ? plan.endColumn : lastLine.length;
  const prefix = firstLine.slice(0, sc);
  const suffix = lastLine.slice(ec);
  const newLines = newText.split("\n");

  if (newLines.length === 1) {
    const merged = prefix + newLines[0]! + suffix;
    if (startIdx === endIdx) {
      workingLines[startIdx] = merged;
    } else {
      workingLines.splice(startIdx, endIdx - startIdx + 1, merged);
    }
    return;
  }

  newLines[0] = prefix + newLines[0]!;
  newLines[newLines.length - 1] = newLines[newLines.length - 1]! + suffix;
  workingLines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
}
