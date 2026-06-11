import type { Chapter } from "../chapter";

/**
 * 根据当前视口行号，查找所属章节下标。
 * 取 `lineNumber ≤ probe` 中展示行最大者；同行多节时取 `tocOrder` 更大（更深）的一条。
 */
export function pickActiveChapterIdx(
  list: readonly Chapter[],
  lineNumber: number,
): number {
  if (list.length === 0) return -1;

  let bestIdx = -1;
  let bestLine = -1;
  let bestOrder = -1;

  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!;
    if (ch.lineNumber > lineNumber) continue;
    const order = ch.tocOrder ?? i;
    if (
      ch.lineNumber > bestLine ||
      (ch.lineNumber === bestLine && order > bestOrder)
    ) {
      bestLine = ch.lineNumber;
      bestOrder = order;
      bestIdx = i;
    }
  }

  return bestIdx;
}
