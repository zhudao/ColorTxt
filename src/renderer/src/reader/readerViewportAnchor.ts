import * as monaco from "monaco-editor";
import { getLineSpacingPx } from "../monaco/lineSpacing";
import { physicalLineToFilteredDisplayLine } from "./lineMapping";

/** 切换排版/格式化前后用于恢复视口的锚点（源物理行 + 该行内自动换行视觉行下标） */
export type ReaderViewportRestoreAnchor = {
  physicalLine: number;
  /** 物理行在 Monaco 中折行后的第几条视觉行（0-based） */
  wrappedLineIndex: number;
};

/** 与书签保存一致：视口内容区顶沿往下第 2 条字高带 */
export const READER_VIEWPORT_RESTORE_SLOT_FROM_TOP = 2;

/** 章节列表跳转：顶沿往下第 N 条字高带，N 与 `headingLevel` 对齐（黏性章节条层数） */
export function chapterJumpAnchorSlotFromTop(headingLevel?: number): number {
  return Math.max(1, Math.floor(headingLevel ?? 1));
}

/** 书签跳转：固定第 2 条字高带（单层章节时的黏性条留白） */
export const READER_BOOKMARK_JUMP_SLOT_FROM_TOP = 2;

/** 在内容坐标 Y 处命中 Monaco 模型行号（1-based） */
export function findModelLineAtContentY(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  contentY: number,
): number | null {
  const lc = Math.max(1, model.getLineCount());
  let lo = 1;
  let hi = lc;
  let ans = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const top = editor.getTopForLineNumber(mid);
    if (!Number.isFinite(top)) return null;
    if (top <= contentY) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(1, Math.min(ans, lc));
}

export function computeWrappedLineIndexInModelLine(
  editor: monaco.editor.IStandaloneCodeEditor,
  displayLine: number,
  contentY: number,
): number {
  const lineHeightPx = Math.max(
    1,
    editor.getOption(monaco.editor.EditorOption.lineHeight),
  );
  const lineTop = editor.getTopForLineNumber(displayLine);
  if (!Number.isFinite(lineTop)) return 0;
  const lineBottom = editor.getBottomForLineNumber(displayLine);
  // getBottom 含物理行后的段间距；折行带只按字高计算
  const blockH = Math.max(
    0,
    lineBottom - lineTop - Math.max(0, getLineSpacingPx()),
  );
  const maxIndex = Math.max(0, Math.floor((blockH - 1) / lineHeightPx));
  const idx = Math.floor((contentY - lineTop) / lineHeightPx);
  return Math.max(0, Math.min(idx, maxIndex));
}

/**
 * 压缩空行等会在同一物理行下插入空白展示行；锚点若落在空白行，
 * 恢复时又对齐到首条正文展示行，会造成每次切换下移一行。采锚时上移到非空行。
 */
function preferNonBlankDisplayLineForAnchor(
  model: monaco.editor.ITextModel,
  displayLine: number,
): number {
  let d = Math.max(1, Math.floor(displayLine));
  const max = Math.max(1, model.getLineCount());
  d = Math.min(d, max);
  while (d > 1 && model.getLineContent(d).trim().length === 0) {
    d -= 1;
  }
  return d;
}

export function captureReaderViewportRestoreAnchor(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  resolvePhysicalLine: (displayLine: number) => number,
  anchorSlotFromTop = READER_VIEWPORT_RESTORE_SLOT_FROM_TOP,
  opts?: { skipLayout?: boolean },
): ReaderViewportRestoreAnchor | null {
  if (!opts?.skipLayout) editor.layout();
  const lineHeightPx = Math.max(
    1,
    editor.getOption(monaco.editor.EditorOption.lineHeight),
  );
  const scrollTop = Math.max(0, editor.getScrollTop());
  const offsetHeights = Math.max(1, Math.floor(anchorSlotFromTop)) - 1;
  const targetY = scrollTop + offsetHeights * lineHeightPx;
  const hitLine = findModelLineAtContentY(editor, model, targetY);
  if (hitLine == null) return null;
  const displayLine = preferNonBlankDisplayLineForAnchor(model, hitLine);
  const physicalLine = Math.max(1, Math.floor(resolvePhysicalLine(displayLine)));
  const wrappedLineIndex = computeWrappedLineIndexInModelLine(
    editor,
    displayLine,
    targetY,
  );
  return { physicalLine, wrappedLineIndex };
}

export function resolveDisplayLineForViewportRestore(
  physicalLine: number,
  modelLineCount: number,
  displayLineToPhysicalLine?: readonly number[],
  getDisplayLineContent?: (displayLine: number) => string,
): number {
  const p = Math.max(1, Math.floor(physicalLine));
  const max = Math.max(1, modelLineCount);
  if (displayLineToPhysicalLine && displayLineToPhysicalLine.length > 0) {
    // 同一物理行多条展示行时，优先落到非空正文行（跳过 keepOneBlank 插入的空行）
    if (getDisplayLineContent) {
      let firstExact = 0;
      for (let i = 0; i < displayLineToPhysicalLine.length; i++) {
        if (displayLineToPhysicalLine[i] !== p) continue;
        const d = i + 1;
        if (!firstExact) firstExact = d;
        if (getDisplayLineContent(d).trim().length > 0) {
          return Math.max(1, Math.min(d, max));
        }
      }
      if (firstExact) return Math.max(1, Math.min(firstExact, max));
    }
    const display = physicalLineToFilteredDisplayLine(
      p,
      displayLineToPhysicalLine,
    );
    return Math.max(1, Math.min(display, max));
  }
  return Math.max(1, Math.min(p, max));
}

/**
 * 使锚点对应的「物理行 + 折行内行」重新落在视口第 N 条字高带（默认第 2 条）。
 */
export function computeScrollTopForReaderViewportRestoreAnchor(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  anchor: ReaderViewportRestoreAnchor,
  displayLineToPhysicalLine?: readonly number[],
  anchorSlotFromTop = READER_VIEWPORT_RESTORE_SLOT_FROM_TOP,
): number | null {
  editor.layout();
  const lineHeightPx = Math.max(
    1,
    editor.getOption(monaco.editor.EditorOption.lineHeight),
  );
  const displayLine = resolveDisplayLineForViewportRestore(
    anchor.physicalLine,
    model.getLineCount(),
    displayLineToPhysicalLine,
    (d) => model.getLineContent(d),
  );
  const lineTop = editor.getTopForLineNumber(displayLine);
  const lineBottom = editor.getBottomForLineNumber(displayLine);
  if (!Number.isFinite(lineTop) || !Number.isFinite(lineBottom)) return null;

  // 与采锚一致：行块高度去掉物理行后的段间距
  const blockH = Math.max(
    0,
    lineBottom - lineTop - Math.max(0, getLineSpacingPx()),
  );
  const maxWrapped = Math.max(0, Math.floor((blockH - 1) / lineHeightPx));
  const wrappedIdx = Math.max(
    0,
    Math.min(Math.floor(anchor.wrappedLineIndex), maxWrapped),
  );
  const pointY = lineTop + wrappedIdx * lineHeightPx;
  const offsetHeights = Math.max(1, Math.floor(anchorSlotFromTop)) - 1;
  const layoutH = Math.max(1, editor.getLayoutInfo().height);
  const maxTop = Math.max(0, editor.getScrollHeight() - layoutH);
  const targetTop = pointY - offsetHeights * lineHeightPx;
  return Math.max(0, Math.min(maxTop, targetTop));
}

/**
 * 将指定展示行顶沿对齐到视口内容区「从上往下第 anchorSlotFromTop 条字高带」。
 * anchorSlotFromTop = 1 表示贴视口顶（与 `revealLineNearTop` 一致）。
 */
export function computeScrollTopForLineAtViewportSlot(
  editor: monaco.editor.IStandaloneCodeEditor,
  displayLine: number,
  anchorSlotFromTop: number,
): number | null {
  editor.layout();
  const lineHeightPx = Math.max(
    1,
    editor.getOption(monaco.editor.EditorOption.lineHeight),
  );
  const top = editor.getTopForLineNumber(displayLine);
  if (!Number.isFinite(top)) return null;
  const offsetHeights = Math.max(1, Math.floor(anchorSlotFromTop)) - 1;
  const layoutH = Math.max(1, editor.getLayoutInfo().height);
  const maxTop = Math.max(0, editor.getScrollHeight() - layoutH);
  const targetTop = top - offsetHeights * lineHeightPx;
  return Math.max(0, Math.min(maxTop, targetTop));
}
