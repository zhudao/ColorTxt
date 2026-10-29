import type { WebContents } from "electron";
import { fetchChapterPlainTextFromRenderer } from "../rag/chapterPlainTextBridge";

const CHAPTER_PLAIN_MAX = 512_000;

export type ChapterPlainSlice = {
  chapterIndex: number;
  text: string;
};

export async function fetchChaptersPlainTextRange(opts: {
  webContents: WebContents;
  chapterCount: number;
  minChapterIndex: number;
  maxChapterIndex: number;
  maxCharsPerChapter?: number;
  onProgress?: (current: number, total: number) => void;
}): Promise<ChapterPlainSlice[]> {
  const {
    webContents,
    chapterCount,
    minChapterIndex,
    maxChapterIndex,
    maxCharsPerChapter = CHAPTER_PLAIN_MAX,
    onProgress,
  } = opts;
  const lo = Math.max(0, minChapterIndex);
  const hi = Math.min(chapterCount - 1, maxChapterIndex);
  if (chapterCount <= 0 || lo > hi) return [];

  const out: ChapterPlainSlice[] = [];
  const total = hi - lo + 1;
  for (let ci = lo; ci <= hi; ci++) {
    onProgress?.(ci - lo + 1, total);
    const text =
      (await fetchChapterPlainTextFromRenderer(
        webContents,
        ci,
        maxCharsPerChapter,
      )) ?? "";
    if (text.trim()) out.push({ chapterIndex: ci, text });
  }
  return out;
}

/** 分层抽样章节索引（含首尾） */
export function pickSampleChapterIndices(
  maxChapterIndex: number,
  sampleCount: number,
): number[] {
  const n = maxChapterIndex + 1;
  const count = Math.min(Math.max(1, sampleCount), n);
  if (count === 1) return [0];
  if (count >= n) {
    return Array.from({ length: n }, (_, i) => i);
  }
  const set = new Set<number>();
  for (let i = 0; i < count; i++) {
    set.add(Math.round((i * maxChapterIndex) / (count - 1)));
  }
  return [...set].sort((a, b) => a - b);
}

export function countTermInText(text: string, term: string): number {
  const t = term.trim();
  if (!t || !text) return 0;
  let count = 0;
  let idx = 0;
  while (idx <= text.length) {
    const found = text.indexOf(t, idx);
    if (found < 0) break;
    count++;
    idx = found + Math.max(1, t.length);
  }
  return count;
}

export function countTermsInChapters(
  chapters: readonly ChapterPlainSlice[],
  terms: readonly string[],
): Map<string, number> {
  const sorted = [...terms]
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const uniq = [...new Set(sorted)];
  const freq = new Map<string, number>();
  for (const term of uniq) {
    let total = 0;
    for (const ch of chapters) {
      total += countTermInText(ch.text, term);
    }
    if (total > 0) freq.set(term, total);
  }
  return freq;
}

export function mergeFreqMaps(
  maps: Iterable<Map<string, number>>,
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const m of maps) {
    for (const [k, v] of m) {
      merged.set(k, (merged.get(k) ?? 0) + v);
    }
  }
  return merged;
}

export function topWordsFromFreq(
  freq: Map<string, number>,
  maxWords: number,
): Array<{ text: string; weight: number }> {
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, maxWords)
    .map(([text, weight]) => ({ text, weight }));
}
