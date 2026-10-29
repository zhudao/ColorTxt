/**
 * 阅读器表面配色方案：用户方案、按 id 选中与落盘。
 * 内置方案目录只从 `readerBuiltins/palettes.ts` 引入，本文件不再转导出。
 */
import {
  isValidReaderSurfaceHex,
  mergeReaderSurfacePalette,
  overridesFromColorEnabled,
  parseReaderPaletteOverrides,
  READER_SURFACE_KEYS,
  type ReaderSurfaceColorEnabled,
  type ReaderSurfacePalette,
} from "./readerPalette";
import {
  parseTextureIdFromPaletteRaw,
} from "./readerBackground";
import { READER_BACKGROUND_NONE_ID } from "./readerBuiltins/textures";
import {
  defaultReaderPalettePresetId,
  getBuiltinReaderPalettePreset,
  isBuiltinReaderPalettePresetId,
  type ReaderPaletteThemeSide,
} from "./readerBuiltins/palettes";

export type { ReaderPaletteThemeSide };

/** 保留 id，避免用户方案占用 */
export const CURRENT_READER_PALETTE_PRESET_KEY = "current";
export const DEFAULT_USER_READER_PALETTE_PRESET_NAME = "自定义";
/** 无 selectedId 时，把旧 `readerPaletteOverrides*` 迁成用户方案用的稳定 id */
export const LEGACY_MIGRATED_USER_PRESET_ID_LIGHT = "u-legacy-light";
export const LEGACY_MIGRATED_USER_PRESET_ID_DARK = "u-legacy-dark";

export type ReaderPaletteWithTexture = ReaderSurfacePalette & {
  textureId: string;
};

export type ReaderPalettePreset = {
  id: string;
  name: string;
  theme: ReaderPaletteThemeSide;
  palette: ReaderPaletteWithTexture;
};

export function cloneReaderSurfacePalette(
  palette: ReaderSurfacePalette,
): ReaderSurfacePalette {
  return { ...palette };
}

export function cloneReaderPaletteWithTexture(
  palette: ReaderPaletteWithTexture,
): ReaderPaletteWithTexture {
  return {
    ...cloneReaderSurfacePalette(palette),
    textureId: palette.textureId || READER_BACKGROUND_NONE_ID,
  };
}

export function cloneReaderPalettePreset(
  presetItem: ReaderPalettePreset,
): ReaderPalettePreset {
  return {
    id: presetItem.id,
    name: presetItem.name,
    theme: presetItem.theme,
    palette: cloneReaderPaletteWithTexture(presetItem.palette),
  };
}

export function parseReaderPaletteSelectedId(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function readerSurfacePaletteEqual(
  a: ReaderSurfacePalette,
  b: ReaderSurfacePalette,
): boolean {
  for (const key of READER_SURFACE_KEYS) {
    if (a[key].toLowerCase() !== b[key].toLowerCase()) return false;
  }
  return true;
}

function legacyMigratedUserPresetId(theme: ReaderPaletteThemeSide): string {
  return theme === "dark"
    ? LEGACY_MIGRATED_USER_PRESET_ID_DARK
    : LEGACY_MIGRATED_USER_PRESET_ID_LIGHT;
}

function paletteFromLegacyOverrides(
  raw: unknown,
  theme: ReaderPaletteThemeSide,
): ReaderPaletteWithTexture | null {
  const partial = parseReaderPaletteOverrides(raw);
  if (!READER_SURFACE_KEYS.some((key) => Boolean(partial[key]))) return null;
  const fallback = getBuiltinReaderPalettePreset(
    defaultReaderPalettePresetId(theme),
  )!.palette;
  const merged = mergeReaderSurfacePalette(fallback, partial);
  if (readerSurfacePaletteEqual(merged, fallback)) return null;
  return {
    ...merged,
    textureId: fallback.textureId,
  };
}

function upsertLegacyCustomPreset(
  presets: ReaderPalettePreset[],
  theme: ReaderPaletteThemeSide,
  palette: ReaderPaletteWithTexture,
): string {
  const id = legacyMigratedUserPresetId(theme);
  const idx = presets.findIndex((p) => p.id === id);
  const next: ReaderPalettePreset = {
    id,
    name:
      idx >= 0 ? presets[idx]!.name : DEFAULT_USER_READER_PALETTE_PRESET_NAME,
    theme,
    palette: cloneReaderPaletteWithTexture(palette),
  };
  if (idx >= 0) presets[idx] = next;
  else presets.push(next);
  return id;
}

/**
 * 无选中 id 时，把旧覆盖色迁成「自定义」用户方案并选中。
 * 只比 9 个色值（背景图新版才有）；覆盖为空或与当前内置「默认」色相同则不生成。
 */
export function migrateLegacyReaderPaletteOverrides(input: {
  userPresets: readonly ReaderPalettePreset[];
  selectedIdLight: string;
  selectedIdDark: string;
  overridesLight: unknown;
  overridesDark: unknown;
}): {
  userPresets: ReaderPalettePreset[];
  selectedIdLight: string;
  selectedIdDark: string;
  migrated: boolean;
} {
  const userPresets = serializeReaderPaletteUserPresets(input.userPresets);
  let selectedIdLight = parseReaderPaletteSelectedId(input.selectedIdLight);
  let selectedIdDark = parseReaderPaletteSelectedId(input.selectedIdDark);
  let migrated = false;
  if (!selectedIdLight) {
    const palette = paletteFromLegacyOverrides(input.overridesLight, "light");
    if (palette) {
      selectedIdLight = upsertLegacyCustomPreset(userPresets, "light", palette);
      migrated = true;
    }
  }
  if (!selectedIdDark) {
    const palette = paletteFromLegacyOverrides(input.overridesDark, "dark");
    if (palette) {
      selectedIdDark = upsertLegacyCustomPreset(userPresets, "dark", palette);
      migrated = true;
    }
  }
  return { userPresets, selectedIdLight, selectedIdDark, migrated };
}

/**
 * 在内置与用户方案中按 id 查找；须与主题一致。
 */
export function findSelectedReaderPalettePreset(
  id: string,
  theme: ReaderPaletteThemeSide,
  userPresets: readonly ReaderPalettePreset[],
): ReaderPalettePreset | undefined {
  if (!id) return undefined;
  const found = findNamedReaderPalettePreset(id, userPresets);
  if (found && found.theme === theme) return found;
  return undefined;
}

export function findNamedReaderPalettePreset(
  id: string,
  userPresets: readonly ReaderPalettePreset[],
): ReaderPalettePreset | undefined {
  const builtin = getBuiltinReaderPalettePreset(id);
  if (builtin) return builtin;
  return userPresets.find((p) => p.id === id);
}

/** 找不到 id 时回退为该主题的内置「默认」 */
export function resolveNamedReaderPalettePreset(
  id: string,
  userPresets: readonly ReaderPalettePreset[],
  theme: ReaderPaletteThemeSide,
): ReaderPalettePreset {
  const found = findSelectedReaderPalettePreset(id, theme, userPresets);
  if (found) return found;
  return getBuiltinReaderPalettePreset(defaultReaderPalettePresetId(theme))!;
}

/** 阅读器 / 预览用：按选中 id 取 9 色 + 选图，找不到则用「默认」 */
export function resolveReaderPaletteBySelectedId(
  id: string,
  theme: ReaderPaletteThemeSide,
  userPresets: readonly ReaderPalettePreset[],
): ReaderPaletteWithTexture {
  return cloneReaderPaletteWithTexture(
    resolveNamedReaderPalettePreset(id, userPresets, theme).palette,
  );
}

export type PersistedReaderPaletteState = {
  readerPaletteColorEnabledOverrides: Partial<ReaderSurfaceColorEnabled>;
  readerPaletteUserPresets: ReaderPalettePreset[];
  readerPaletteSelectedIdLight: string;
  readerPaletteSelectedIdDark: string;
};

export function toPersistedReaderPaletteState(input: {
  colorEnabled: ReaderSurfaceColorEnabled;
  userPresets: readonly ReaderPalettePreset[];
  selectedIdLight: string;
  selectedIdDark: string;
}): PersistedReaderPaletteState {
  return {
    readerPaletteColorEnabledOverrides: overridesFromColorEnabled(
      input.colorEnabled,
    ),
    readerPaletteUserPresets: serializeReaderPaletteUserPresets(
      input.userPresets,
    ),
    readerPaletteSelectedIdLight: parseReaderPaletteSelectedId(
      input.selectedIdLight,
    ),
    readerPaletteSelectedIdDark: parseReaderPaletteSelectedId(
      input.selectedIdDark,
    ),
  };
}

export function newUserReaderPalettePresetId(): string {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseFullPalette(raw: unknown): ReaderSurfacePalette | null {
  const partial = parseReaderPaletteOverrides(raw);
  for (const key of READER_SURFACE_KEYS) {
    if (!partial[key] || !isValidReaderSurfaceHex(partial[key]!)) return null;
  }
  return {
    readerBg: partial.readerBg!,
    chapterTitle: partial.chapterTitle!,
    bodyText: partial.bodyText!,
    txtrQuoteInner: partial.txtrQuoteInner!,
    txtrBracketInner: partial.txtrBracketInner!,
    txtrPunctuation: partial.txtrPunctuation!,
    txtrSpecialMarker: partial.txtrSpecialMarker!,
    txtrNumber: partial.txtrNumber!,
    txtrEnglish: partial.txtrEnglish!,
  };
}

function parseThemeSide(raw: unknown): ReaderPaletteThemeSide | null {
  return raw === "light" || raw === "dark" ? raw : null;
}

function isReservedPresetId(id: string): boolean {
  return (
    id === CURRENT_READER_PALETTE_PRESET_KEY ||
    isBuiltinReaderPalettePresetId(id)
  );
}

/** 从持久化 JSON 解析用户配色方案；只认 `{ id, name, theme, palette }`。 */
export function parseReaderPaletteUserPresets(
  raw: unknown,
): ReaderPalettePreset[] {
  if (!Array.isArray(raw)) return [];
  const out: ReaderPalettePreset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string") continue;
    const id = o.id.trim();
    if (!id || isReservedPresetId(id) || seen.has(id)) continue;
    if (typeof o.name !== "string") continue;
    const theme = parseThemeSide(o.theme);
    if (!theme) continue;
    const name = o.name.trim() || DEFAULT_USER_READER_PALETTE_PRESET_NAME;
    const palette = parseFullPalette(o.palette);
    if (!palette) continue;
    seen.add(id);
    out.push({
      id,
      name,
      theme,
      palette: {
        ...palette,
        textureId: parseTextureIdFromPaletteRaw(o.palette),
      },
    });
  }
  return out;
}

export function serializeReaderPaletteUserPresets(
  presets: readonly ReaderPalettePreset[],
): ReaderPalettePreset[] {
  return presets.map((p) => cloneReaderPalettePreset(p));
}
