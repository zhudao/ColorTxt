import * as monaco from "monaco-editor";
import { getStickyChapterScrollHeight } from "../monaco/chapterStickyScroll";
import {
  computeWrappedLineIndexInModelLine,
  findModelLineAtContentY,
} from "./readerViewportAnchor";

export const READER_RULER_FOCUS_CLASS = "readerRulerFocus";
/** 刚离开聚焦带：整行 DOM 会被 Monaco 换掉，只能靠 animation 淡出 */
export const READER_RULER_FOCUS_OUT_CLASS = "readerRulerFocusOut";
export const READER_RULER_EDITOR_CLASS = "reader-reading-ruler";
export const READER_RULER_DIM_STICKY_CLASS = "reader-reading-ruler-dim-sticky";
export const READER_RULER_TRANSITION_CLASS = "reader-reading-ruler-transition";
export const READER_RULER_DIM_CSS_VAR = "--reader-ruler-dim";
export const READER_RULER_FADE_MS = 200;

export type ReadingRulerPos = { lineNumber: number; column: number };

const TOP_EPS = 0.5;

export function isRulerLineInModel(
  model: monaco.editor.ITextModel,
  line: number,
): boolean {
  if (!Number.isFinite(line)) return false;
  const n = Math.floor(line);
  return n >= 1 && n <= model.getLineCount();
}

function lineHeightPx(ed: monaco.editor.IStandaloneCodeEditor): number {
  return Math.max(1, ed.getOption(monaco.editor.EditorOption.lineHeight));
}

function posKey(p: ReadingRulerPos): string {
  return `${p.lineNumber}:${p.column}`;
}

export function positionsEqual(a: ReadingRulerPos, b: ReadingRulerPos): boolean {
  return a.lineNumber === b.lineNumber && a.column === b.column;
}

export function visualRowStart(
  ed: monaco.editor.IStandaloneCodeEditor,
  line: number,
  column: number,
): ReadingRulerPos {
  const top = ed.getTopForPosition(line, column);
  if (!Number.isFinite(top)) return { lineNumber: line, column: 1 };
  let lo = 1;
  let hi = Math.max(1, column);
  let best = column;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = ed.getTopForPosition(line, mid);
    if (Number.isFinite(t) && Math.abs(t - top) <= TOP_EPS) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return { lineNumber: line, column: Math.max(1, best) };
}

export function visualRowEndColumn(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  line: number,
  column: number,
): number {
  if (!isRulerLineInModel(model, line)) return 1;
  const maxCol = model.getLineMaxColumn(line);
  const top = ed.getTopForPosition(line, column);
  if (!Number.isFinite(top)) return maxCol;
  let lo = Math.max(1, column);
  let hi = maxCol;
  let best = column;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = ed.getTopForPosition(line, mid);
    if (Number.isFinite(t) && Math.abs(t - top) <= TOP_EPS) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(1, Math.min(maxCol, best));
}

export function clampRulerPos(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
): ReadingRulerPos {
  const lc = Math.max(1, model.getLineCount());
  const line = Math.max(1, Math.min(lc, Math.floor(pos.lineNumber) || 1));
  const maxCol = model.getLineMaxColumn(line);
  const col = Math.max(1, Math.min(maxCol, Math.floor(pos.column) || 1));
  return visualRowStart(ed, line, col);
}

export function stepVisualLine(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
  direction: -1 | 1,
): ReadingRulerPos {
  const cur = clampRulerPos(ed, model, pos);
  const lc = Math.max(1, model.getLineCount());
  if (direction > 0) {
    const endCol = visualRowEndColumn(
      ed,
      model,
      cur.lineNumber,
      cur.column,
    );
    const maxCol = model.getLineMaxColumn(cur.lineNumber);
    if (endCol < maxCol) {
      return visualRowStart(ed, cur.lineNumber, endCol + 1);
    }
    if (cur.lineNumber < lc) {
      return visualRowStart(ed, cur.lineNumber + 1, 1);
    }
    return cur;
  }
  if (cur.column > 1) {
    return visualRowStart(ed, cur.lineNumber, cur.column - 1);
  }
  if (cur.lineNumber > 1) {
    const prevMax = model.getLineMaxColumn(cur.lineNumber - 1);
    return visualRowStart(ed, cur.lineNumber - 1, prevMax);
  }
  return cur;
}

/**
 * 锚点即聚焦带中间行。奇数恰好居中；偶数多出的行在下方。
 * 文首/文末一侧不够时，先下后上把剩余行补到另一侧。
 */
export function collectVisualRowsFromAnchor(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  anchor: ReadingRulerPos,
  count: number,
): ReadingRulerPos[] {
  const n = Math.max(1, Math.floor(count));
  const mid = snapRulerPosToContent(ed, model, anchor);
  if (!visualRowHasContent(ed, model, mid)) return [];
  const wantBelow = Math.ceil((n - 1) / 2);
  const wantAbove = Math.floor((n - 1) / 2);
  const below = collectContentInDirection(ed, model, mid, 1, wantBelow);
  const above = collectContentInDirection(ed, model, mid, -1, wantAbove);
  let remaining = n - 1 - below.length - above.length;
  if (remaining > 0) {
    const moreBelow = collectContentInDirection(
      ed,
      model,
      below[below.length - 1] ?? mid,
      1,
      remaining,
    );
    below.push(...moreBelow);
    remaining -= moreBelow.length;
  }
  if (remaining > 0) {
    const moreAbove = collectContentInDirection(
      ed,
      model,
      above[above.length - 1] ?? mid,
      -1,
      remaining,
    );
    above.push(...moreAbove);
  }
  return [...above.reverse(), mid, ...below];
}

function collectContentInDirection(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  from: ReadingRulerPos,
  direction: -1 | 1,
  max: number,
): ReadingRulerPos[] {
  const n = Math.max(0, Math.floor(max));
  if (n <= 0) return [];
  const out: ReadingRulerPos[] = [];
  let p = clampRulerPos(ed, model, from);
  const guard = Math.max(64, model.getLineCount() * 8);
  for (let i = 0; i < guard && out.length < n; i++) {
    const next = stepToNextContentVisualRow(ed, model, p, direction);
    if (positionsEqual(next, p)) break;
    p = next;
    out.push(p);
  }
  return out;
}

export function visualRowHasContent(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
): boolean {
  if (!isRulerLineInModel(model, pos.lineNumber)) return false;
  const start = visualRowStart(ed, pos.lineNumber, pos.column);
  if (!isRulerLineInModel(model, start.lineNumber)) return false;
  const endCol = visualRowEndColumn(ed, model, start.lineNumber, start.column);
  const text = model
    .getLineContent(start.lineNumber)
    .slice(start.column - 1, endCol);
  return text.trim().length > 0;
}

/** 空行不作为锚点：先向下再向上找到最近的有内容视觉行。 */
export function snapRulerPosToContent(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
): ReadingRulerPos {
  const cur = clampRulerPos(ed, model, pos);
  if (visualRowHasContent(ed, model, cur)) return cur;
  const down = stepToNextContentVisualRow(ed, model, cur, 1);
  if (visualRowHasContent(ed, model, down) && !positionsEqual(down, cur)) {
    return down;
  }
  const up = stepToNextContentVisualRow(ed, model, cur, -1);
  if (visualRowHasContent(ed, model, up)) return up;
  return cur;
}

function stepToNextContentVisualRow(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
  direction: -1 | 1,
): ReadingRulerPos {
  let p = clampRulerPos(ed, model, pos);
  const first = stepVisualLine(ed, model, p, direction);
  if (positionsEqual(first, p)) return p;
  p = first;
  const guard = Math.max(64, model.getLineCount() * 8);
  for (let i = 0; i < guard; i++) {
    if (visualRowHasContent(ed, model, p)) return p;
    const next = stepVisualLine(ed, model, p, direction);
    if (positionsEqual(next, p)) return p;
    p = next;
  }
  return p;
}

export function stepContentVisualLines(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
  direction: -1 | 1,
  count: number,
): ReadingRulerPos {
  let p = clampRulerPos(ed, model, pos);
  const n = Math.max(1, Math.floor(count));
  for (let i = 0; i < n; i++) {
    const next = stepToNextContentVisualRow(ed, model, p, direction);
    if (positionsEqual(next, p)) break;
    p = next;
  }
  return p;
}

export function focusWindowIsBlank(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  anchor: ReadingRulerPos,
  count: number,
): boolean {
  return collectVisualRowsFromAnchor(ed, model, anchor, count).length === 0;
}

/** 文档第一个 / 最后一个有内容的视觉行。 */
export function documentContentEdgePos(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  direction: -1 | 1,
): ReadingRulerPos {
  if (direction < 0) {
    return snapRulerPosToContent(ed, model, visualRowStart(ed, 1, 1));
  }
  const lc = Math.max(1, model.getLineCount());
  return snapRulerPosToContent(
    ed,
    model,
    visualRowStart(ed, lc, model.getLineMaxColumn(lc)),
  );
}

/**
 * 聚焦带贴文首/文末时的锚点：取该侧 N 条有内容视觉行的自然中间
 * （与 `collectVisualRowsFromAnchor` 的 `wantAbove` 一致）。
 * 若把锚点钉在边行，先下后上会把带撑满，反向要走多次带才视觉位移。
 */
export function rulerAnchorForContentEdgeBand(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  direction: -1 | 1,
  focusCount: number,
): ReadingRulerPos {
  const n = Math.max(1, Math.floor(focusCount));
  const edge = documentContentEdgePos(ed, model, direction);
  const wantAbove = Math.floor((n - 1) / 2);
  const restDir: -1 | 1 = direction < 0 ? 1 : -1;
  const rest = collectContentInDirection(ed, model, edge, restDir, n - 1);
  const rows = direction < 0 ? [edge, ...rest] : [...rest.reverse(), edge];
  const i = Math.min(Math.max(0, wantAbove), rows.length - 1);
  return rows[i]!;
}

/**
 * 当前聚焦带已经盖住文首（向上）或文末（向下）的有内容行时，不应再沿该方向移锚点。
 */
export function focusBandTouchesContentEdge(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  anchor: ReadingRulerPos,
  focusCount: number,
  direction: -1 | 1,
): boolean {
  const rows = collectVisualRowsFromAnchor(ed, model, anchor, focusCount);
  if (!rows.length) return true;
  const bandEdge = direction < 0 ? rows[0]! : rows[rows.length - 1]!;
  return positionsEqual(
    bandEdge,
    documentContentEdgePos(ed, model, direction),
  );
}

/**
 * 沿方向移动阅读尺锚点 `stepCount` 条有内容的视觉行（空行不计入）。
 * 若落点拼不出有内容的聚焦带（宽度为 `focusCount`），则继续走到有内容的行。
 */
export function advanceRulerAnchorByContentLines(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
  direction: -1 | 1,
  stepCount: number,
  focusCount: number,
): ReadingRulerPos {
  const steps = Math.max(1, Math.floor(stepCount));
  const n = Math.max(1, Math.floor(focusCount));
  let p = stepContentVisualLines(ed, model, pos, direction, steps);
  if (!focusWindowIsBlank(ed, model, p, n)) return p;
  const guard = Math.max(64, model.getLineCount() * 8);
  for (let i = 0; i < guard; i++) {
    const next = stepToNextContentVisualRow(ed, model, p, direction);
    if (positionsEqual(next, p)) return p;
    p = next;
    if (!focusWindowIsBlank(ed, model, p, n)) return p;
  }
  return p;
}

/**
 * 翻页移尺：步长等于聚焦行数（相邻两段聚焦带不重叠）。
 */
export function advanceRulerAnchorByFocusWindow(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
  direction: -1 | 1,
  focusCount: number,
): ReadingRulerPos {
  const n = Math.max(1, Math.floor(focusCount));
  return advanceRulerAnchorByContentLines(ed, model, pos, direction, n, n);
}

function visualRowToRange(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
): monaco.Range | null {
  if (!isRulerLineInModel(model, pos.lineNumber)) return null;
  const start = visualRowStart(ed, pos.lineNumber, pos.column);
  if (!isRulerLineInModel(model, start.lineNumber)) return null;
  const endCol = visualRowEndColumn(ed, model, start.lineNumber, start.column);
  const maxCol = model.getLineMaxColumn(start.lineNumber);
  const exclusiveEnd =
    endCol < maxCol ? Math.min(maxCol, endCol + 1) : maxCol;
  return new monaco.Range(
    start.lineNumber,
    start.column,
    start.lineNumber,
    Math.max(start.column, exclusiveEnd),
  );
}

function addVisualRowsIntersectingLineRange(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  line: number,
  selStartCol: number,
  selEndCol: number,
  into: Map<string, ReadingRulerPos>,
) {
  if (!isRulerLineInModel(model, line)) return;
  const maxCol = model.getLineMaxColumn(line);
  const from = Math.max(1, Math.min(maxCol, selStartCol));
  const to = Math.max(from, Math.min(maxCol, selEndCol));
  let p = visualRowStart(ed, line, from);
  for (let guard = 0; guard < 4096; guard++) {
    const rowEnd = visualRowEndColumn(ed, model, p.lineNumber, p.column);
    const overlaps = !(rowEnd < from || p.column >= to);
    if (overlaps) into.set(posKey(p), p);
    const next = stepVisualLine(ed, model, p, 1);
    if (next.lineNumber !== line || next.column <= p.column) break;
    if (next.column >= to) break;
    p = next;
  }
}

export function collectSelectionVisualRows(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
): ReadingRulerPos[] {
  const sels = ed.getSelections();
  if (!sels?.length) return [];
  const into = new Map<string, ReadingRulerPos>();
  for (const sel of sels) {
    if (sel.isEmpty()) continue;
    const range = monaco.Range.lift(sel);
    const start = range.getStartPosition();
    const end = range.getEndPosition();
    const lc = model.getLineCount();
    const fromLine = Math.max(1, start.lineNumber);
    const toLine = Math.min(lc, end.lineNumber);
    if (fromLine > toLine) continue;
    for (let line = fromLine; line <= toLine; line++) {
      const lineStart = line === start.lineNumber ? start.column : 1;
      const lineEnd =
        line === end.lineNumber
          ? end.column
          : model.getLineMaxColumn(line);
      addVisualRowsIntersectingLineRange(
        ed,
        model,
        line,
        lineStart,
        lineEnd,
        into,
      );
    }
  }
  return [...into.values()];
}

export function buildRulerFocusDecorations(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  rows: readonly ReadingRulerPos[],
  className: string = READER_RULER_FOCUS_CLASS,
): monaco.editor.IModelDeltaDecoration[] {
  const seen = new Set<string>();
  const out: monaco.editor.IModelDeltaDecoration[] = [];
  for (const row of rows) {
    if (!isRulerLineInModel(model, row.lineNumber)) continue;
    const start = visualRowStart(ed, row.lineNumber, row.column);
    if (!isRulerLineInModel(model, start.lineNumber)) continue;
    const key = posKey(start);
    if (seen.has(key)) continue;
    seen.add(key);
    const range = visualRowToRange(ed, model, start);
    if (!range) continue;
    const emptyLine = model.getLineMaxColumn(start.lineNumber) <= 1;
    out.push({
      range,
      options: {
        inlineClassName: className,
        ...(emptyLine ? { afterContentClassName: className } : {}),
        stickiness:
          monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    });
  }
  return out;
}

function visualRowBottomY(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
): number {
  const top = ed.getTopForPosition(pos.lineNumber, pos.column);
  const next = stepVisualLine(ed, model, pos, 1);
  const nextTop = ed.getTopForPosition(next.lineNumber, next.column);
  if (
    Number.isFinite(top) &&
    Number.isFinite(nextTop) &&
    nextTop > top + TOP_EPS
  ) {
    return nextTop;
  }
  const bottom = ed.getBottomForLineNumber(pos.lineNumber);
  if (Number.isFinite(bottom)) return bottom;
  return (Number.isFinite(top) ? top : 0) + lineHeightPx(ed);
}

function visualRowCenterY(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pos: ReadingRulerPos,
): number | null {
  const top = ed.getTopForPosition(pos.lineNumber, pos.column);
  const bottom = visualRowBottomY(ed, model, pos);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  return (top + bottom) / 2;
}

/** 视口扣粘性条后，内容区垂直中点的文档 Y（与移尺居中、刷新采锚同一套）。 */
export function rulerViewportVisibleCenterContentY(
  ed: monaco.editor.IStandaloneCodeEditor,
): number {
  const stickyHeight = getStickyChapterScrollHeight(ed);
  const layoutH = Math.max(1, ed.getLayoutInfo().height);
  const visibleH = Math.max(1, layoutH - stickyHeight);
  return Math.max(0, ed.getScrollTop()) + stickyHeight + visibleH / 2;
}

export function scrollTopToCenterVisualBand(
  ed: monaco.editor.IStandaloneCodeEditor,
  rows: readonly ReadingRulerPos[],
): number | null {
  if (!rows.length) return null;
  const model = ed.getModel();
  if (!model) return null;
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const top = ed.getTopForPosition(first.lineNumber, first.column);
  const bottom = visualRowBottomY(ed, model, last);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  const center = (top + bottom) / 2;
  const stickyHeight = getStickyChapterScrollHeight(ed);
  const layoutH = Math.max(1, ed.getLayoutInfo().height);
  const visibleH = Math.max(1, layoutH - stickyHeight);
  const maxTop = Math.max(0, ed.getScrollHeight() - layoutH);
  return Math.max(
    0,
    Math.min(maxTop, center - stickyHeight - visibleH / 2),
  );
}

export function rulerPosAtContentY(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  contentY: number,
): ReadingRulerPos {
  const line = findModelLineAtContentY(ed, model, contentY) ?? 1;
  const wrapIdx = computeWrappedLineIndexInModelLine(ed, line, contentY);
  let p = visualRowStart(ed, line, 1);
  for (let i = 0; i < wrapIdx; i++) {
    const next = stepVisualLine(ed, model, p, 1);
    if (next.lineNumber !== line || positionsEqual(next, p)) break;
    p = next;
  }
  return clampRulerPos(ed, model, p);
}

/** 距 contentY 最近的视觉行（平局取偏上的一行，避免刷新时锚点逐次下移）。 */
export function rulerPosNearestContentY(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  contentY: number,
): ReadingRulerPos {
  const approx = rulerPosAtContentY(ed, model, contentY);
  const prev = stepVisualLine(ed, model, approx, -1);
  const next = stepVisualLine(ed, model, approx, 1);
  let best = approx;
  let bestDist = Infinity;
  for (const p of [prev, approx, next]) {
    const c = visualRowCenterY(ed, model, p);
    if (c == null) continue;
    const d = Math.abs(c - contentY);
    if (d + TOP_EPS < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return clampRulerPos(ed, model, best);
}

/** 启用尺时采锚：贴文末/文首时聚焦带贴边（锚点取带的自然中间），其余用视口中间行。 */
export function seedRulerAnchorFromViewport(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  focusCount: number,
): ReadingRulerPos {
  const layoutH = Math.max(1, ed.getLayoutInfo().height);
  const maxTop = Math.max(0, ed.getScrollHeight() - layoutH);
  const st = Math.max(0, ed.getScrollTop());
  if (maxTop > 0 && st >= maxTop - 1) {
    return rulerAnchorForContentEdgeBand(ed, model, 1, focusCount);
  }
  if (maxTop > 0 && st <= 1) {
    return rulerAnchorForContentEdgeBand(ed, model, -1, focusCount);
  }
  return rulerPosNearestContentY(
    ed,
    model,
    rulerViewportVisibleCenterContentY(ed),
  );
}

export function rulerPosFromClientPoint(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  clientX: number,
  clientY: number,
): ReadingRulerPos | null {
  const hit = ed.getTargetAtClientPoint(clientX, clientY)?.position;
  if (!hit) return null;
  return clampRulerPos(ed, model, hit);
}
