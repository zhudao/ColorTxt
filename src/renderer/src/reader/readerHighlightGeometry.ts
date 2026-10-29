import * as monaco from "monaco-editor";

/** 用于行尾列 `col+1` 映射到下一折行时 `getOffsetForColumn` 返回异常（offHi ≤ offLo）的宽度回退 */
export function charPixelWidthForHighlightAnchor(
  fi: monaco.editor.FontInfo,
  char: string,
): number {
  if (!char) return fi.typicalHalfwidthCharacterWidth;
  const cp = char.codePointAt(0)!;
  if (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0xac00 && cp <= 0xd7af)
  ) {
    return fi.typicalFullwidthCharacterWidth;
  }
  return fi.typicalHalfwidthCharacterWidth;
}

function columnRightInContent(
  ed: monaco.editor.IStandaloneCodeEditor,
  m: monaco.editor.ITextModel,
  line: number,
  colBefore: number,
): number | null {
  const offLo = ed.getOffsetForColumn(line, colBefore);
  const offHi = ed.getOffsetForColumn(line, colBefore + 1);
  const fi = ed.getOption(monaco.editor.EditorOption.fontInfo);
  const lastChar = m.getValueInRange(
    new monaco.Range(line, colBefore, line, colBefore + 1),
  );
  if (offLo >= 0 && offHi > offLo) return offHi;
  if (offLo >= 0) return offLo + charPixelWidthForHighlightAnchor(fi, lastChar);
  return null;
}

function columnLeftInContent(
  ed: monaco.editor.IStandaloneCodeEditor,
  line: number,
  column: number,
): number | null {
  const off = ed.getOffsetForColumn(line, column);
  return off >= 0 ? off : null;
}

/** 同一模型行内，与 startCol 处于同一视觉折行的最后一列（wordWrap 下跨折行选区只锚首段） */
function lastColumnOnSameVisualRow(
  ed: monaco.editor.IStandaloneCodeEditor,
  line: number,
  startCol: number,
  maxColBefore: number,
): number | null {
  const startVp = ed.getScrolledVisiblePosition({
    lineNumber: line,
    column: startCol,
  });
  if (startVp == null) return null;
  const startTop = startVp.top;
  let lo = startCol;
  let hi = Math.max(startCol, maxColBefore);
  let best = startCol;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const vp = ed.getScrolledVisiblePosition({ lineNumber: line, column: mid });
    if (vp != null && Math.abs(vp.top - startTop) <= 0.5) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export type RangeViewportAnchor = {
  selectionCenterX: number;
  selectionLeftX: number;
  selectionRightX: number;
  anchorTop: number;
  lineBottom: number;
};

/** 选区与当前可见行的最早交集（文档顺序）；无交集返回 null */
function firstVisibleIntersection(
  ed: monaco.editor.IStandaloneCodeEditor,
  range: monaco.Range,
): monaco.Range | null {
  let best: monaco.Range | null = null;
  for (const vr of ed.getVisibleRanges()) {
    const hit = range.intersectRanges(vr);
    if (!hit || hit.isEmpty()) continue;
    if (
      !best ||
      monaco.Range.compareRangesUsingStarts(hit, best) < 0
    ) {
      best = hit;
    }
  }
  return best;
}

/**
 * 按给定范围的文档起点锚到同一视觉折行首段。
 * 起点不在视口（getScrolledVisiblePosition 为 null）时返回 null。
 */
function anchorAtRangeDocumentStart(
  e: monaco.editor.IStandaloneCodeEditor,
  m: monaco.editor.ITextModel,
  range: monaco.Range,
  domRect: DOMRect,
  baseX: number,
): RangeViewportAnchor | null {
  const dragStart = range.getStartPosition();
  const dragEnd = range.getEndPosition();
  const firstInDoc =
    monaco.Position.compare(dragStart, dragEnd) <= 0 ? dragStart : dragEnd;
  const lastInDoc =
    monaco.Position.compare(dragStart, dragEnd) <= 0 ? dragEnd : dragStart;
  const firstLine = firstInDoc.lineNumber;
  const lastLine = lastInDoc.lineNumber;

  const startCol = firstInDoc.column;
  const selectionEndColBefore =
    firstLine === lastLine
      ? Math.max(startCol, lastInDoc.column - 1)
      : m.getLineMaxColumn(firstLine) - 1;
  const endColBefore = lastColumnOnSameVisualRow(
    e,
    firstLine,
    startCol,
    selectionEndColBefore,
  );
  if (endColBefore == null) return null;

  const startLeft = columnLeftInContent(e, firstLine, startCol);
  if (startLeft == null) return null;

  const endRight = columnRightInContent(e, m, firstLine, endColBefore);
  if (endRight == null) return null;

  const startVp = e.getScrolledVisiblePosition({
    lineNumber: firstLine,
    column: startCol,
  });
  if (startVp == null) return null;

  const top = domRect.top + startVp.top;
  const lineBottom = top + Math.max(1, startVp.height);

  const selectionLeftX = baseX + startLeft;
  const selectionRightX = baseX + endRight;
  const selectionCenterX = (selectionLeftX + selectionRightX) / 2;
  return {
    selectionCenterX,
    selectionLeftX,
    selectionRightX,
    anchorTop: top,
    lineBottom,
  };
}

/**
 * 指定范围在视口中的锚点（水平居中 + 首行顶/底）。
 * 跨行/跨软换行时仅按**第一行上第一段视觉折行**定位。
 * 若文档起点已滚出视口，则改锚到选区与可见行的最早交集，便于 Shift 扩展长选区后仍能弹出工具条。
 */
export function getRangeViewportAnchor(
  e: monaco.editor.IStandaloneCodeEditor,
  m: monaco.editor.ITextModel,
  range: monaco.IRange,
): RangeViewportAnchor | null {
  const sel = monaco.Range.lift(range);
  if (sel.isEmpty()) return null;
  const dom = e.getDomNode();
  if (!dom) return null;
  const rect = dom.getBoundingClientRect();
  const layout = e.getLayoutInfo();
  const scrollLeft = e.getScrollLeft();
  const baseX = rect.left + layout.contentLeft - scrollLeft;

  const atStart = anchorAtRangeDocumentStart(e, m, sel, rect, baseX);
  if (atStart) return atStart;

  const visible = firstVisibleIntersection(e, sel);
  if (!visible || visible.isEmpty()) return null;
  return anchorAtRangeDocumentStart(e, m, visible, rect, baseX);
}

/**
 * 选区在视口中的锚点（水平居中 + 首行顶/底）。
 * 跨行/跨软换行时仅按**第一行上第一段视觉折行**定位（如「得井|井有」只锚「得井」），
 * 忽略后续折行或模型行；垂直位置用首段起始列的视觉行。
 */
export function getSelectionViewportAnchor(
  e: monaco.editor.IStandaloneCodeEditor,
  m: monaco.editor.ITextModel,
): RangeViewportAnchor | null {
  const sel = e.getSelection();
  if (!sel || sel.isEmpty()) return null;
  return getRangeViewportAnchor(e, m, sel);
}

export type FloatClipRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
};

export type FloatPlacementInput = {
  selectionCenterX: number;
  anchorTop: number;
  lineBottom: number;
  floatHeight: number;
  floatWidth: number;
  gap?: number;
  margin?: number;
  clip: FloatClipRect;
};

export type FloatPlacementResult = {
  centerX: number;
  rootTop: number;
  openDownward: boolean;
};

/** 工具条/色盘/词典浮层：钳制在传入 clip 内；两边都能放下时优先空间更大的一侧 */
export function computeFloatPlacement(
  input: FloatPlacementInput,
): FloatPlacementResult {
  const gap = input.gap ?? 6;
  const margin = input.margin ?? 8;
  const { clip } = input;
  const clipTop = clip.top + margin;
  const clipBottom = clip.bottom - margin;
  const clipLeft = clip.left + margin;
  const clipRight = clip.right - margin;
  const halfW = input.floatWidth / 2;

  const upwardBottom = input.anchorTop - gap;
  const upwardTop = upwardBottom - input.floatHeight;
  const fitsAbove = upwardTop >= clipTop;

  const downwardTop = input.lineBottom + gap;
  const downwardBottom = downwardTop + input.floatHeight;
  const fitsBelow = downwardBottom <= clipBottom;

  const spaceAbove = upwardBottom - clipTop;
  const spaceBelow = clipBottom - downwardTop;

  let openDownward: boolean;
  let rootTop: number;

  if (fitsAbove && !fitsBelow) {
    openDownward = false;
    rootTop = upwardBottom;
  } else if (!fitsAbove && fitsBelow) {
    openDownward = true;
    rootTop = downwardTop;
  } else if (fitsAbove && fitsBelow) {
    // 两边都能放下：往空间更大的一侧弹（词典等较高浮层尤其需要）
    if (spaceBelow > spaceAbove) {
      openDownward = true;
      rootTop = downwardTop;
    } else {
      openDownward = false;
      rootTop = upwardBottom;
    }
  } else if (spaceBelow > spaceAbove) {
    openDownward = true;
    rootTop = Math.min(downwardTop, clipBottom - input.floatHeight);
  } else {
    openDownward = false;
    rootTop = Math.max(upwardBottom, clipTop + input.floatHeight);
  }

  const centerX = Math.max(
    clipLeft + halfW,
    Math.min(input.selectionCenterX, clipRight - halfW),
  );

  return { centerX, rootTop, openDownward };
}

/** @deprecated 使用 {@link getSelectionViewportAnchor} */
export function getSelectionEndViewportAnchor(
  e: monaco.editor.IStandaloneCodeEditor,
  m: monaco.editor.ITextModel,
) {
  const anchor = getSelectionViewportAnchor(e, m);
  if (!anchor) return null;
  return {
    selectionRightX: anchor.selectionRightX,
    anchorTop: anchor.anchorTop,
    lineBottom: anchor.lineBottom,
  };
}
