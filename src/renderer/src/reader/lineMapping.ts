import { chapterTitleForDisplay } from "../chapter";

/** 源文件物理行号 → 滤空后的显示行号（map[i] = 第 i+1 显示行对应的物理行号） */
export function physicalLineToFilteredDisplayLine(
  physicalP: number,
  map: readonly number[],
): number {
  if (map.length === 0) return 1;
  const p = Math.max(1, Math.floor(physicalP));
  for (let i = 0; i < map.length; i++) {
    if (map[i]! >= p) return i + 1;
  }
  return map.length;
}

/**
 * 同一物理行可能对应多行显示（章节留白等），视口最底一行应对「最后一个」`map[i]===physicalP` 的显示行。
 * 无精确等号时回退为 {@link physicalLineToFilteredDisplayLine}（首个 `map[i]>=p`）。
 */
export function physicalLineToLastFilteredDisplayLine(
  physicalP: number,
  map: readonly number[],
): number {
  if (map.length === 0) return 1;
  const p = Math.max(1, Math.floor(physicalP));
  let last = 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i] === p) last = i + 1;
  }
  if (last >= 1) return last;
  return physicalLineToFilteredDisplayLine(p, map);
}

/** 物理行内容是否为空行（无可见字符，含仅空格/缩进） */
export function isBlankPhysicalLineContent(line: string): boolean {
  return line.trim().length === 0;
}

/** 插图等删展示行后，将仍指向删前 Monaco 行号的 1-based 行号上移 */
export function shiftDisplayLineAfterDeletions(
  displayLine: number,
  deletedDisplayLinesDesc: readonly number[],
): number {
  if (deletedDisplayLinesDesc.length === 0) return displayLine;
  const deletedAsc = [...deletedDisplayLinesDesc].sort((a, b) => a - b);
  let removedAbove = 0;
  for (const d of deletedAsc) {
    if (d < displayLine) removedAbove += 1;
  }
  return displayLine - removedAbove;
}

/** 删展示行后同步「章节标题物理行 → 展示行」缓存 */
export function shiftChapterTitleDisplayLineMap(
  map: Map<number, number>,
  deletedDisplayLinesDesc: readonly number[],
): void {
  if (deletedDisplayLinesDesc.length === 0) return;
  for (const [phys, dl] of map) {
    map.set(phys, shiftDisplayLineAfterDeletions(dl, deletedDisplayLinesDesc));
  }
}

/**
 * 压缩空行时同一物理行可对应多行展示（章节留白等）。
 * 章节标题应落在「有正文」的展示行，而非首个映射行（常为留白空行）。
 */
export function physicalLineToChapterTitleDisplayLine(
  physicalP: number,
  map: readonly number[],
  options?: {
    wantShown?: string;
    getDisplayLineContent?: (displayLine: number) => string;
  },
): number {
  if (map.length === 0) return 1;
  const p = Math.max(1, Math.floor(physicalP));
  const want = options?.wantShown ?? "";
  const getLine = options?.getDisplayLineContent;
  let firstNonBlank = 0;
  let lastNonBlank = 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i] !== p) continue;
    const displayLine = i + 1;
    const content = getLine?.(displayLine) ?? "";
    if (
      want.length > 0 &&
      chapterTitleForDisplay(content) === chapterTitleForDisplay(want)
    ) {
      return displayLine;
    }
    if (content.trim().length > 0) {
      if (!firstNonBlank) firstNonBlank = displayLine;
      lastNonBlank = displayLine;
    }
  }
  // 压缩空行章节留白：同一物理行常为「空行…、标题、尾空行」，标题取最后一个非空展示行
  if (want.length > 0 && lastNonBlank > 0) return lastNonBlank;
  if (firstNonBlank > 0) return firstNonBlank;
  return physicalLineToFilteredDisplayLine(p, map);
}
