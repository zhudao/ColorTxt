import type { HighlightWordsByIndex } from "../stores/fileMetaStore";

export type HighlightListTerm = {
  text: string;
  color: string;
  colorIndex: number;
  /** 已收藏 = 全局词表；未收藏 = 当前文件词表 */
  scope: "global" | "book";
  isFavorited: boolean;
};

const MAX_HIGHLIGHT_TERM_LEN = 100;

function trimTerm(text: string): string {
  let term = text.trim();
  if (!term) return "";
  if (term.length > MAX_HIGHLIGHT_TERM_LEN) {
    term = term.slice(0, MAX_HIGHLIGHT_TERM_LEN);
  }
  return term;
}

function removeTermFromMap(map: HighlightWordsByIndex, term: string): boolean {
  let changed = false;
  for (const k of Object.keys(map)) {
    const prevList = map[k]!;
    const next = prevList.filter((w) => w !== term);
    if (next.length !== prevList.length) changed = true;
    if (next.length === 0) delete map[k];
    else map[k] = next;
  }
  return changed;
}

/** 将词归到指定高亮色索引；先从所有桶移除同一词，再写入目标桶 */
export function assignHighlightTermToColorMap(
  map: HighlightWordsByIndex | undefined,
  colorIndex: number,
  text: string,
): HighlightWordsByIndex | undefined {
  const term = trimTerm(text);
  if (!term || colorIndex < 0 || !Number.isFinite(colorIndex)) return map;
  const base = { ...(map ?? {}) };
  removeTermFromMap(base, term);
  const targetKey = String(Math.floor(colorIndex));
  const list = [...(base[targetKey] ?? [])];
  if (!list.includes(term)) list.push(term);
  base[targetKey] = list;
  return base;
}

export function removeHighlightTermFromMap(
  map: HighlightWordsByIndex | undefined,
  text: string,
): HighlightWordsByIndex | undefined {
  const term = trimTerm(text);
  if (!term || !map) return map;
  const base = { ...map };
  if (!removeTermFromMap(base, term)) return map;
  return Object.keys(base).length > 0 ? base : undefined;
}

export function termExistsInHighlightMap(
  map: HighlightWordsByIndex | undefined,
  text: string,
): boolean {
  const term = trimTerm(text);
  if (!term || !map) return false;
  return Object.values(map).some((words) => words.includes(term));
}

export function findHighlightColorIndexInMap(
  map: HighlightWordsByIndex | undefined,
  text: string,
): number | null {
  const term = trimTerm(text);
  if (!term || !map) return null;
  for (const [k, words] of Object.entries(map)) {
    if (!words.includes(term)) continue;
    const idx = Number.parseInt(k, 10);
    if (Number.isFinite(idx) && idx >= 0) return idx;
  }
  return null;
}

/**
 * 合并全局与本书词表供 Monarch 上色：同一词本书颜色优先。
 */
export function mergeHighlightWordsByIndex(
  global: HighlightWordsByIndex | undefined,
  book: HighlightWordsByIndex | undefined,
): HighlightWordsByIndex | undefined {
  if (!global && !book) return undefined;
  const out: HighlightWordsByIndex = {};
  if (global) {
    for (const [k, words] of Object.entries(global)) {
      out[k] = [...words];
    }
  }
  if (!book) {
    return Object.keys(out).length > 0 ? out : undefined;
  }
  for (const [k, words] of Object.entries(book)) {
    const idx = Number.parseInt(k, 10);
    if (!Number.isFinite(idx) || idx < 0) continue;
    for (const w of words) {
      if (!w) continue;
      removeTermFromMap(out, w);
      const key = String(idx);
      const list = [...(out[key] ?? [])];
      if (!list.includes(w)) list.push(w);
      out[key] = list;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function expandHighlightMapToListTerms(
  map: HighlightWordsByIndex | undefined,
  scope: "global" | "book",
  colors: readonly string[],
  bodyText: string,
): HighlightListTerm[] {
  if (!map) return [];
  const isFavorited = scope === "global";
  const out: HighlightListTerm[] = [];
  for (const [idxKey, terms] of Object.entries(map)) {
    const idx = Number.parseInt(idxKey, 10);
    if (!Number.isFinite(idx) || idx < 0) continue;
    const color = idx < colors.length ? colors[idx]! : bodyText;
    for (const text of terms) {
      if (!text) continue;
      out.push({ text, color, colorIndex: idx, scope, isFavorited });
    }
  }
  return out;
}

/** 侧栏列表：已收藏（全局）在前，未收藏（本书）在后 */
export function buildHighlightListTerms(
  global: HighlightWordsByIndex | undefined,
  book: HighlightWordsByIndex | undefined,
  colors: readonly string[],
  bodyText: string,
): HighlightListTerm[] {
  return [
    ...expandHighlightMapToListTerms(global, "global", colors, bodyText),
    ...expandHighlightMapToListTerms(book, "book", colors, bodyText),
  ];
}
