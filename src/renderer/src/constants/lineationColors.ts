/**
 * 划线标注色（马克笔 / 波浪线 / 直线）；亮/暗主题各一套，与高亮词独立。
 */

export const MIN_LINEATION_COLORS = 3;

/** 与 `annotationColors` 默认 5 色一致 */
export const DEFAULT_LINEATION_COLORS_LIGHT: readonly string[] = [
  "#FF6B9D",
  "#A855F7",
  "#3B82F6",
  "#22C55E",
  "#F59E0B",
];

export const DEFAULT_LINEATION_COLORS_DARK: readonly string[] = [
  "#FF6B9D",
  "#A855F7",
  "#3B82F6",
  "#22C55E",
  "#F59E0B",
];

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isValidLineationHex(s: string): boolean {
  return typeof s === "string" && HEX6.test(s);
}

export function parseLineationColorsArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const h = x.startsWith("#") ? x : `#${x}`;
    if (!isValidLineationHex(h)) continue;
    out.push(h.toLowerCase());
  }
  if (out.length < MIN_LINEATION_COLORS) return undefined;
  return out;
}

export function mergeLineationColors(
  defaults: readonly string[],
  saved?: string[] | null,
): string[] {
  if (!saved || saved.length < MIN_LINEATION_COLORS) {
    return [...defaults];
  }
  return saved.map((c) => (c.startsWith("#") ? c : `#${c}`).toLowerCase());
}

export function lineationColorsPersistPayload(
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
