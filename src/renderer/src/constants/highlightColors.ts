/**
 * 自定义高亮色：Web 安全色（#RGB 各通道 ∈ {00,33,66,99,CC,FF}），亮/暗底上可读。
 */

export const MIN_HIGHLIGHT_COLORS = 3;

/**
 * 亮主题阅读器默认底 `#f4ead7`、正文 `#000000`（见 defaultReaderPaletteLight）。
 * 高亮为前景色，需与奶黄底有足够对比、且明显区别于纯黑正文；色相约每 36° 一枚，避免近黑灰。
 */
export const DEFAULT_HIGHLIGHT_COLORS_LIGHT: readonly string[] = [
  "#CC0000",
  "#CC6600",
  "#996600",
  "#669900",
  "#009933",
  "#009999",
  "#0033CC",
  "#6633CC",
  "#990099",
  "#CC3399",
];

/** 默认 `#1e1e1e` 暗底、正文 `#d4d4d4`：偏亮、色相分散；末色勿用近正文的中性灰 */
export const DEFAULT_HIGHLIGHT_COLORS_DARK: readonly string[] = [
  "#FF6666",
  "#FFCC66",
  "#FFFF66",
  "#66FF66",
  "#66FFFF",
  "#66CCFF",
  "#9999FF",
  "#CC66FF",
  "#FF99CC",
  "#FFCCCC",
];

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isValidHighlightHex(s: string): boolean {
  return typeof s === "string" && HEX6.test(s);
}

/** 自持久化 JSON 解析高亮色数组；长度不足 MIN 则视为无效 */
export function parseHighlightColorsArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const h = x.startsWith("#") ? x : `#${x}`;
    if (!isValidHighlightHex(h)) continue;
    out.push(h.toLowerCase());
  }
  if (out.length < MIN_HIGHLIGHT_COLORS) return undefined;
  return out;
}

export function mergeHighlightColors(
  defaults: readonly string[],
  saved?: string[] | null,
): string[] {
  if (!saved || saved.length < MIN_HIGHLIGHT_COLORS) {
    return [...defaults];
  }
  return saved.map((c) => (c.startsWith("#") ? c : `#${c}`).toLowerCase());
}

export function highlightColorsPersistPayload(
  current: readonly string[],
  defaults: readonly string[],
): string[] | undefined {
  if (
    current.length === defaults.length &&
    current.every(
      (c, i) => c.toLowerCase() === defaults[i]!.toLowerCase(),
    )
  ) {
    return undefined;
  }
  return [...current];
}

/** 选区工具条「高亮词」上次选用的色槽下标（默认首色） */
export const DEFAULT_HIGHLIGHT_LAST_COLOR = 0;

/** 将下标映射到当前高亮色盘；无效或越界时回退到最后一色 */
export function clampHighlightColorIndex(
  index: number,
  colorCount?: number,
): number {
  const count = Math.max(
    MIN_HIGHLIGHT_COLORS,
    colorCount ?? DEFAULT_HIGHLIGHT_COLORS_LIGHT.length,
  );
  const last = count - 1;
  if (!Number.isFinite(index)) return last;
  const i = Math.floor(index);
  if (i < 0 || i >= count) return last;
  return i;
}

/** 持久化读回：保留原始下标，由 {@link clampHighlightLastColorToCount} 按当前色盘长度夹取 */
export function parseHighlightLastColor(raw: unknown): number {
  if (!Number.isFinite(Number(raw))) return DEFAULT_HIGHLIGHT_LAST_COLOR;
  return Math.max(0, Math.floor(Number(raw)));
}

export function clampHighlightLastColorToCount(
  index: number,
  colorCount: number,
): number {
  return clampHighlightColorIndex(index, colorCount);
}
