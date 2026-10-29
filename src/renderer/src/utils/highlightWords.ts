import type { HighlightWordsByIndex } from "../stores/fileMetaStore";

export type HighlightListTerm = {
  /** 侧栏展示（只读转换后可能与 storedTerms 不同） */
  terms: string[];
  /** 持久化词组原文（删除/收藏/改色/编辑操作用） */
  storedTerms: string[];
  color: string;
  colorIndex: number;
  /** 已收藏 = 全局词表；未收藏 = 当前文件词表 */
  scope: "global" | "book";
  isFavorited: boolean;
};

const MAX_HIGHLIGHT_TERM_LEN = 100;

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 侧栏点击跳转：单词字面量；多词则逐词转义后 `|` 连接 */
export function buildHighlightFindQuery(terms: readonly string[]): {
  query: string;
  useRegex: boolean;
} {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length <= 1) {
    return { query: cleaned[0] ?? "", useRegex: false };
  }
  return {
    query: cleaned.map(escapeRegExp).join("|"),
    useRegex: true,
  };
}

export function highlightGroupsEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function trimTerm(text: string): string {
  let term = text.trim();
  if (!term) return "";
  if (term.length > MAX_HIGHLIGHT_TERM_LEN) {
    term = term.slice(0, MAX_HIGHLIGHT_TERM_LEN);
  }
  return term;
}

export function normalizeHighlightGroup(
  texts: readonly string[],
): string[] | null {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of texts) {
    const t = trimTerm(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.length > 0 ? out : null;
}

/** 输入框提交：按 `,` / `，` / `、` / `;` / `；` 拆成多个词（`split: false` 时整段为一词） */
export function parseHighlightInputTerms(
  raw: string,
  options?: { split?: boolean },
): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (options?.split === false) {
    return normalizeHighlightGroup([trimmed]) ?? [];
  }
  return normalizeHighlightGroup(trimmed.split(/[,，、;；]+/)) ?? [];
}

/** 从所有桶的各组中移除含该词的项：多词组剔除该词，空组删除 */
function removeTermFromMap(map: HighlightWordsByIndex, term: string): boolean {
  let changed = false;
  for (const k of Object.keys(map)) {
    const prevGroups = map[k]!;
    const nextGroups: string[][] = [];
    for (const g of prevGroups) {
      if (!g.includes(term)) {
        nextGroups.push(g);
        continue;
      }
      changed = true;
      const next = g.filter((w) => w !== term);
      if (next.length > 0) nextGroups.push(next);
    }
    if (nextGroups.length === 0) delete map[k];
    else map[k] = nextGroups;
  }
  return changed;
}

function removeGroupFromMap(
  map: HighlightWordsByIndex,
  storedTerms: readonly string[],
): boolean {
  let changed = false;
  for (const k of Object.keys(map)) {
    const prev = map[k]!;
    const next = prev.filter((g) => !highlightGroupsEqual(g, storedTerms));
    if (next.length !== prev.length) changed = true;
    if (next.length === 0) delete map[k];
    else map[k] = next;
  }
  return changed;
}

function findGroupLocation(
  map: HighlightWordsByIndex,
  storedTerms: readonly string[],
): { key: string; index: number } | null {
  for (const [k, groups] of Object.entries(map)) {
    const i = groups.findIndex((g) => highlightGroupsEqual(g, storedTerms));
    if (i >= 0) return { key: k, index: i };
  }
  return null;
}

function cloneMap(map: HighlightWordsByIndex | undefined): HighlightWordsByIndex {
  const out: HighlightWordsByIndex = {};
  if (!map) return out;
  for (const [k, groups] of Object.entries(map)) {
    out[k] = groups.map((g) => [...g]);
  }
  return out;
}

/**
 * 将单词汇组归到指定色（选区添词）。
 * 若词已在多词组中则先从该组剔除；再以 `[term]` 写入目标桶。
 */
export function assignHighlightTermToColorMap(
  map: HighlightWordsByIndex | undefined,
  colorIndex: number,
  text: string,
): HighlightWordsByIndex | undefined {
  const term = trimTerm(text);
  if (!term || colorIndex < 0 || !Number.isFinite(colorIndex)) return map;
  return upsertHighlightGroupInMap(map, colorIndex, [term], {
    matchSingletonOnly: false,
  });
}

/**
 * 写入 / 更新词组到指定色：先清掉新组内各词在其它组的占用，再放入目标桶。
 * `replaceStoredTerms`：编辑时先按旧组定位并替换（保持相对位置优先）。
 */
export function upsertHighlightGroupInMap(
  map: HighlightWordsByIndex | undefined,
  colorIndex: number,
  terms: readonly string[],
  opts?: {
    replaceStoredTerms?: readonly string[];
    /** 为 true 时仅当已存在刚好为单词汇组才视为同组原地（默认 false） */
    matchSingletonOnly?: boolean;
  },
): HighlightWordsByIndex | undefined {
  const group = normalizeHighlightGroup(terms);
  if (!group || colorIndex < 0 || !Number.isFinite(colorIndex)) return map;
  const targetKey = String(Math.floor(colorIndex));
  const base = cloneMap(map);

  if (opts?.replaceStoredTerms) {
    removeGroupFromMap(base, opts.replaceStoredTerms);
  }

  for (const t of group) {
    removeTermFromMap(base, t);
  }

  const list = [...(base[targetKey] ?? [])];
  list.push(group);
  base[targetKey] = list;
  return base;
}

/** 将已有词组迁到另一高亮色（整组） */
export function setHighlightGroupColorInMap(
  map: HighlightWordsByIndex | undefined,
  storedTerms: readonly string[],
  colorIndex: number,
): HighlightWordsByIndex | undefined {
  const group = normalizeHighlightGroup(storedTerms);
  if (!group || !map || colorIndex < 0 || !Number.isFinite(colorIndex)) {
    return map;
  }
  const targetKey = String(Math.floor(colorIndex));
  const loc = findGroupLocation(map, group);
  if (!loc) return map;
  if (loc.key === targetKey) return map;

  const base = cloneMap(map);
  const fromList = [...base[loc.key]!];
  const [moved] = fromList.splice(loc.index, 1);
  if (!moved) return map;
  if (fromList.length === 0) delete base[loc.key];
  else base[loc.key] = fromList;

  const toList = [...(base[targetKey] ?? [])];
  toList.push(moved);
  base[targetKey] = toList;
  return base;
}

/** 按整组删除（storedTerms 全等匹配） */
export function removeHighlightGroupFromMap(
  map: HighlightWordsByIndex | undefined,
  storedTerms: readonly string[],
): HighlightWordsByIndex | undefined {
  const group = normalizeHighlightGroup(storedTerms);
  if (!group || !map) return map;
  const base = cloneMap(map);
  if (!removeGroupFromMap(base, group)) return map;
  return Object.keys(base).length > 0 ? base : undefined;
}

/** 合并两组：词序为 target 在前、source 去重追加；写入 target 色桶并清除原两组占用 */
export function mergeHighlightGroupsInMap(
  map: HighlightWordsByIndex | undefined,
  sourceStoredTerms: readonly string[],
  targetStoredTerms: readonly string[],
  targetColorIndex: number,
): HighlightWordsByIndex | undefined {
  const source = normalizeHighlightGroup(sourceStoredTerms);
  const target = normalizeHighlightGroup(targetStoredTerms);
  if (!source || !target || highlightGroupsEqual(source, target)) return map;
  if (targetColorIndex < 0 || !Number.isFinite(targetColorIndex)) return map;
  const merged = normalizeHighlightGroup([...target, ...source]);
  if (!merged) return map;
  return upsertHighlightGroupInMap(map, targetColorIndex, merged, {
    replaceStoredTerms: target,
  });
}

/**
 * 从多词组中拆出一个词为独立单词汇组（同色）。
 * 单词汇组无法拆分，原样返回。
 */
export function splitTermFromHighlightGroupInMap(
  map: HighlightWordsByIndex | undefined,
  storedTerms: readonly string[],
  termToSplit: string,
  colorIndex: number,
): HighlightWordsByIndex | undefined {
  const group = normalizeHighlightGroup(storedTerms);
  const term = trimTerm(termToSplit);
  if (!map || !group || !term || group.length < 2 || !group.includes(term)) {
    return map;
  }
  if (colorIndex < 0 || !Number.isFinite(colorIndex)) return map;
  const remaining = group.filter((t) => t !== term);
  let next = removeHighlightGroupFromMap(map, group);
  next = upsertHighlightGroupInMap(next, colorIndex, remaining);
  next = upsertHighlightGroupInMap(next, colorIndex, [term]);
  return next;
}

/** @deprecated 兼容：删除含该词的整组中的该词（多词组收缩）；若需删整组请用 removeHighlightGroupFromMap */
export function removeHighlightTermFromMap(
  map: HighlightWordsByIndex | undefined,
  text: string,
): HighlightWordsByIndex | undefined {
  const term = trimTerm(text);
  if (!term || !map) return map;
  const base = cloneMap(map);
  if (!removeTermFromMap(base, term)) return map;
  return Object.keys(base).length > 0 ? base : undefined;
}

export function termExistsInHighlightMap(
  map: HighlightWordsByIndex | undefined,
  text: string,
): boolean {
  const term = trimTerm(text);
  if (!term || !map) return false;
  return Object.values(map).some((groups) =>
    groups.some((g) => g.includes(term)),
  );
}

export function groupExistsInHighlightMap(
  map: HighlightWordsByIndex | undefined,
  storedTerms: readonly string[],
): boolean {
  const group = normalizeHighlightGroup(storedTerms);
  if (!group || !map) return false;
  return findGroupLocation(map, group) != null;
}

export function findHighlightColorIndexInMap(
  map: HighlightWordsByIndex | undefined,
  text: string,
): number | null {
  const term = trimTerm(text);
  if (!term || !map) return null;
  for (const [k, groups] of Object.entries(map)) {
    if (!groups.some((g) => g.includes(term))) continue;
    const idx = Number.parseInt(k, 10);
    if (Number.isFinite(idx) && idx >= 0) return idx;
  }
  return null;
}

/**
 * 合并全局与本书词表供 Monarch / 导入：同词本书（后者）优先。
 * 后者的整组写入；先从结果中剔除组内各词。
 */
export function mergeHighlightWordsByIndex(
  global: HighlightWordsByIndex | undefined,
  book: HighlightWordsByIndex | undefined,
): HighlightWordsByIndex | undefined {
  if (!global && !book) return undefined;
  const out = cloneMap(global);
  if (!book) {
    return Object.keys(out).length > 0 ? out : undefined;
  }
  for (const [k, groups] of Object.entries(book)) {
    const idx = Number.parseInt(k, 10);
    if (!Number.isFinite(idx) || idx < 0) continue;
    for (const g of groups) {
      if (!g.length) continue;
      for (const w of g) {
        if (w) removeTermFromMap(out, w);
      }
      const key = String(idx);
      const list = [...(out[key] ?? [])];
      list.push([...g]);
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
  toDisplayText?: (storedText: string) => string,
): HighlightListTerm[] {
  if (!map) return [];
  const isFavorited = scope === "global";
  const out: HighlightListTerm[] = [];
  for (const [idxKey, groups] of Object.entries(map)) {
    const idx = Number.parseInt(idxKey, 10);
    if (!Number.isFinite(idx) || idx < 0) continue;
    const color = idx < colors.length ? colors[idx]! : bodyText;
    for (const storedTerms of groups) {
      if (!storedTerms.length) continue;
      const terms = storedTerms.map((s) => toDisplayText?.(s) ?? s);
      out.push({
        terms,
        storedTerms: [...storedTerms],
        color,
        colorIndex: idx,
        scope,
        isFavorited,
      });
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
  toDisplayText?: (storedText: string) => string,
): HighlightListTerm[] {
  return [
    ...expandHighlightMapToListTerms(
      global,
      "global",
      colors,
      bodyText,
      toDisplayText,
    ),
    ...expandHighlightMapToListTerms(
      book,
      "book",
      colors,
      bodyText,
      toDisplayText,
    ),
  ];
}

/** 稳定列表 key 基底（不含 colorIndex；词序无关，组内重排不改变 key） */
export function highlightGroupListKeyBase(storedTerms: readonly string[]): string {
  return [...storedTerms]
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .join("\0");
}
