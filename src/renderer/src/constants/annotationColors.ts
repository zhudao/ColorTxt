/** 划线（马克笔 / 波浪线 / 直线）默认 5 色；实际数量由用户配置决定 */

import {
  DEFAULT_LINEATION_COLORS_LIGHT,
  MIN_LINEATION_COLORS,
} from "./lineationColors";

export const ANNOTATION_LINEATION_COLOR_COUNT =
  DEFAULT_LINEATION_COLORS_LIGHT.length;

export const ANNOTATION_LINEATION_COLORS: readonly string[] =
  DEFAULT_LINEATION_COLORS_LIGHT;

export type LineationLastColorPrefs = {
  marker: number;
  wavy: number;
  straight: number;
};

export const DEFAULT_LINEATION_LAST_COLORS: LineationLastColorPrefs = {
  marker: 0,
  wavy: 0,
  straight: 0,
};

/** 将下标映射到当前色盘；无效或越界时回退到最后一色 */
export function clampLineationColorIndex(
  index: number,
  colorCount?: number,
): number {
  const count = Math.max(
    MIN_LINEATION_COLORS,
    colorCount ?? ANNOTATION_LINEATION_COLOR_COUNT,
  );
  const last = count - 1;
  if (!Number.isFinite(index)) return last;
  const i = Math.floor(index);
  if (i < 0 || i >= count) return last;
  return i;
}

/** 持久化读回：保留原始下标，由 {@link clampLineationLastColorsToCount} 按当前色盘长度夹取 */
export function parseLineationColorIndexRaw(value: unknown): number {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.floor(Number(value)));
}

export function parseLineationLastColors(raw: unknown): LineationLastColorPrefs {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_LINEATION_LAST_COLORS };
  }
  const o = raw as Record<string, unknown>;
  return {
    marker: parseLineationColorIndexRaw(o.marker),
    wavy: parseLineationColorIndexRaw(o.wavy),
    straight: parseLineationColorIndexRaw(o.straight),
  };
}

export function lineationColorAt(
  index: number,
  colors: readonly string[] = ANNOTATION_LINEATION_COLORS,
): string {
  const idx = clampLineationColorIndex(index, colors.length);
  return colors[idx] ?? colors[0] ?? "#FF6B9D";
}

export function clampLineationLastColorsToCount(
  prefs: LineationLastColorPrefs,
  colorCount: number,
): LineationLastColorPrefs {
  return {
    marker: clampLineationColorIndex(prefs.marker, colorCount),
    wavy: clampLineationColorIndex(prefs.wavy, colorCount),
    straight: clampLineationColorIndex(prefs.straight, colorCount),
  };
}
