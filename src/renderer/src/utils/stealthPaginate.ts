/**
 * 摸鱼窗分页：用与展示节点相同的测量函数求当前页结束偏移。
 * `fits(slice)` 为真表示 `slice` 能完整落入视口（无纵向溢出）。
 *
 * 切勿对「从 start 到全文末尾」做测量——长文会卡死主线程。
 */

export function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** 字符偏移 → 1-based 展示行号 */
export function offsetToLine(lineStarts: readonly number[], offset: number): number {
  const o = Math.max(0, offset);
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if ((lineStarts[mid] ?? 0) <= o) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** 1-based 展示行号 → 该行起始字符偏移 */
export function lineToOffset(lineStarts: readonly number[], line: number): number {
  if (lineStarts.length === 0) return 0;
  const i = Math.max(0, Math.min(lineStarts.length - 1, Math.floor(line) - 1));
  return lineStarts[i] ?? 0;
}

/**
 * 最大的 `end`（不含）使得 `text.slice(start, end)` 能装进视口；至少 1 个字符。
 * 先按 hint 指数扩张上界，再二分；测量切片长度约为页长量级，与全书无关。
 */
export function fitPageEnd(
  text: string,
  start: number,
  fits: (slice: string) => boolean,
  hintChars = 512,
): number {
  const n = text.length;
  if (start >= n) return n;

  const one = Math.min(n, start + 1);
  if (!fits(text.slice(start, one))) return one;

  const hint = Math.max(32, Math.min(1 << 16, Math.floor(hintChars) || 512));
  let lo = one;
  let hi = Math.min(n, start + hint);

  while (hi < n && fits(text.slice(start, hi))) {
    lo = hi;
    const grown = start + (hi - start) * 2;
    hi = Math.min(n, grown);
  }

  if (hi >= n && fits(text.slice(start, n))) return n;

  // 此时 (lo, hi]：lo 能装下，hi 装不下（或 hi===n 且装不下）
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (fits(text.slice(start, mid))) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(one, Math.min(lo, n));
}

/**
 * 上一页起点：最小的 `s ∈ [0, currentStart]` 使得一页能覆盖到 `currentStart`。
 * 有页栈时应优先弹栈；本函数作缩放/丢栈后的兜底（对 fit 次数为 log 级）。
 */
export function findPrevPageStart(
  text: string,
  currentStart: number,
  fits: (slice: string) => boolean,
  hintPageChars: number,
): number {
  if (currentStart <= 0) return 0;
  const hint = Math.max(32, hintPageChars || 512);
  let lo = 0;
  let hi = currentStart;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (fitPageEnd(text, mid, fits, hint) >= currentStart) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
