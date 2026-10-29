/**
 * 配色面板导入/导出：zip 包（JSON + 自定义背景图）。
 */
import JSZip from "jszip";
import {
  defaultReaderPaletteColorEnabled,
  defaultReaderPaletteDark,
  defaultReaderPaletteLight,
  mergeReaderPaletteColorEnabled,
  mergeReaderSurfacePalette,
  parseReaderPaletteOverrides,
  READER_SURFACE_OPTIONAL_COLOR_KEYS,
  type ReaderSurfaceColorEnabled,
  type ReaderSurfacePalette,
} from "../constants/readerPalette";
import {
  getBuiltinReaderTexture,
  READER_BACKGROUND_NONE_ID,
} from "../constants/readerBuiltins";
import {
  cloneReaderBackgroundThemeSettings,
  cloneReaderCustomBackground,
  defaultReaderBackgroundThemeSettingsForId,
  parseReaderCustomBackgrounds,
  parseReaderTextureId,
  parseTextureIdFromPaletteRaw,
  readerBackgroundCustomAbs,
  type ReaderBackgroundLayerSettings,
  type ReaderBackgroundState,
  type ReaderCustomBackground,
} from "../constants/readerBackground";
import {
  parseReaderPaletteSelectedId,
  parseReaderPaletteUserPresets,
  serializeReaderPaletteUserPresets,
  type ReaderPalettePreset,
} from "../constants/readerPalettePresets";
import { parseHighlightColorsArray } from "../constants/highlightColors";
import { parseLineationColorsArray } from "../constants/lineationColors";
import { sanitizeChatExportTitleForFilename } from "../aiAssistant/aiAssistantExport";
import { arrayBufferToBase64 } from "./characterRosterPack";

export const COLOR_SCHEME_EXPORT_KIND = "colortxt-color-scheme";
export const COLOR_SCHEME_EXPORT_SCHEMA_VERSION = 1;
/** 建议保存扩展（完整后缀，含 .zip），与 `{书名}.characters.zip` 等同形态 */
export const COLOR_SCHEME_EXPORT_FILE_EXT = "color-scheme.zip";
/** 「导出配色」默认名（全局包，无方案名前缀） */
export const COLOR_SCHEME_EXPORT_DEFAULT_NAME = COLOR_SCHEME_EXPORT_FILE_EXT;
export const COLOR_SCHEME_EXPORT_JSON_NAME = "color-scheme.json";
export const COLOR_SCHEME_EXPORT_TEXTURES_DIR = "textures/";

export const COLOR_SCHEME_EXPORT_SAVE_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [{ name: "彩读配色", extensions: ["zip"] }];

export const COLOR_SCHEME_EXPORT_OPEN_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [{ name: "彩读配色", extensions: ["zip"] }];

export type ColorSchemeExportTexture = {
  id: string;
  name: string;
  fileName?: string;
  light: ReaderBackgroundLayerSettings;
  dark: ReaderBackgroundLayerSettings;
};

export type ColorSchemeExportReader = {
  light: ReaderSurfacePalette & { textureId?: string };
  dark: ReaderSurfacePalette & { textureId?: string };
  colorEnabled: ReaderSurfaceColorEnabled;
  userPresets: ReaderPalettePreset[];
  selectedIdLight?: string;
  selectedIdDark?: string;
  textures?: Record<string, ColorSchemeExportTexture>;
  /** 解析后摊平，供写入图库 */
  custom?: ReaderCustomBackground[];
};

export type ColorSchemeExportColors = {
  light: string[];
  dark: string[];
};

export type ColorSchemeExportV1 = {
  kind: typeof COLOR_SCHEME_EXPORT_KIND;
  schemaVersion: typeof COLOR_SCHEME_EXPORT_SCHEMA_VERSION;
  exportedAt: number;
  reader?: ColorSchemeExportReader;
  highlight?: ColorSchemeExportColors;
  lineation?: ColorSchemeExportColors;
};

export type ColorSchemeExportPack = {
  data: ColorSchemeExportV1;
  /** fileName → 图片字节 */
  textures: Map<string, Uint8Array>;
};

function parseExportedColorEnabled(raw: unknown): ReaderSurfaceColorEnabled {
  if (!raw || typeof raw !== "object") {
    return { ...defaultReaderPaletteColorEnabled };
  }
  const o = raw as Record<string, unknown>;
  const partial: Partial<ReaderSurfaceColorEnabled> = {};
  for (const key of READER_SURFACE_OPTIONAL_COLOR_KEYS) {
    if (o[key] === false) partial[key] = false;
    else if (o[key] === true) partial[key] = true;
  }
  return mergeReaderPaletteColorEnabled(partial);
}

function parseExportedPalette(
  raw: unknown,
  fallback: ReaderSurfacePalette,
): ReaderSurfacePalette | null {
  const partial = parseReaderPaletteOverrides(raw);
  if (Object.keys(partial).length === 0) return null;
  return mergeReaderSurfacePalette(fallback, partial);
}

function cloneExportTexture(
  t: ColorSchemeExportTexture,
): ColorSchemeExportTexture {
  return {
    id: t.id,
    name: t.name,
    ...(t.fileName ? { fileName: t.fileName } : {}),
    ...cloneReaderBackgroundThemeSettings(t),
  };
}

function parseExportTextures(raw: unknown): {
  custom: ReaderCustomBackground[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { custom: [] };
  }
  const custom: ReaderCustomBackground[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const o = value as Record<string, unknown>;
    const idRaw = typeof o.id === "string" && o.id.trim() ? o.id.trim() : key;
    const id = idRaw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const parsed = parseReaderCustomBackgrounds([{ ...o, id }]);
    if (parsed[0]) {
      custom.push(cloneReaderCustomBackground(parsed[0]));
    }
  }
  return { custom };
}

function parseExportedReader(raw: unknown): ColorSchemeExportReader | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const light = parseExportedPalette(o.light, defaultReaderPaletteLight);
  const dark = parseExportedPalette(o.dark, defaultReaderPaletteDark);
  if (!light || !dark) return null;
  const fromTextures = parseExportTextures(o.textures);
  const userPresets = parseReaderPaletteUserPresets(o.userPresets);
  const textures: Record<string, ColorSchemeExportTexture> = {};
  for (const c of fromTextures.custom) {
    textures[c.id] = {
      id: c.id,
      name: c.name,
      fileName: c.fileName,
      ...cloneReaderBackgroundThemeSettings(c),
    };
  }
  return {
    light: { ...light, textureId: parseTextureIdFromPaletteRaw(o.light) },
    dark: { ...dark, textureId: parseTextureIdFromPaletteRaw(o.dark) },
    colorEnabled: parseExportedColorEnabled(o.colorEnabled),
    userPresets,
    selectedIdLight: parseReaderPaletteSelectedId(o.selectedIdLight),
    selectedIdDark: parseReaderPaletteSelectedId(o.selectedIdDark),
    ...(Object.keys(textures).length > 0 ? { textures } : {}),
    ...(fromTextures.custom.length > 0 ? { custom: fromTextures.custom } : {}),
  };
}

function parseExportedColorPair(raw: unknown, kind: "highlight" | "lineation") {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const parse =
    kind === "highlight" ? parseHighlightColorsArray : parseLineationColorsArray;
  const light = parse(o.light);
  const dark = parse(o.dark);
  if (!light || !dark) return undefined;
  return { light, dark };
}

function addTextureId(ids: Set<string>, id: string | undefined) {
  if (!id || id === READER_BACKGROUND_NONE_ID) return;
  ids.add(id);
}

export function collectColorSchemeExportTextureIds(input: {
  light?: { textureId?: string };
  dark?: { textureId?: string };
  userPresets?: readonly ReaderPalettePreset[];
}): Set<string> {
  const ids = new Set<string>();
  addTextureId(ids, input.light?.textureId);
  addTextureId(ids, input.dark?.textureId);
  for (const p of input.userPresets ?? []) {
    addTextureId(ids, p.palette.textureId);
  }
  return ids;
}

export function sliceBackgroundGalleryForExport(
  state: ReaderBackgroundState,
  referencedIds: ReadonlySet<string>,
): Pick<ColorSchemeExportReader, "textures"> {
  const textures: Record<string, ColorSchemeExportTexture> = {};
  for (const id of referencedIds) {
    if (!id || id === READER_BACKGROUND_NONE_ID) continue;
    const custom = state.custom.find((c) => c.id === id);
    if (custom) {
      textures[id] = {
        id: custom.id,
        name: custom.name,
        fileName: custom.fileName,
        ...cloneReaderBackgroundThemeSettings(custom),
      };
      continue;
    }
    const builtin = getBuiltinReaderTexture(id);
    if (!builtin) continue;
    textures[id] = {
      id,
      name: builtin.name,
      ...cloneReaderBackgroundThemeSettings(
        defaultReaderBackgroundThemeSettingsForId(id),
      ),
    };
  }
  return Object.keys(textures).length > 0 ? { textures } : {};
}

export function customFilesFromExportTextures(
  textures: Record<string, ColorSchemeExportTexture> | undefined,
): Array<{ fileName: string }> {
  if (!textures) return [];
  const out: Array<{ fileName: string }> = [];
  const seen = new Set<string>();
  for (const t of Object.values(textures)) {
    const fileName = t.fileName?.trim();
    if (!fileName || seen.has(fileName)) continue;
    seen.add(fileName);
    out.push({ fileName });
  }
  return out;
}

export function buildColorSchemeExportPayload(input: {
  reader?: ColorSchemeExportReader;
  highlight?: ColorSchemeExportColors;
  lineation?: ColorSchemeExportColors;
}): ColorSchemeExportV1 {
  const payload: ColorSchemeExportV1 = {
    kind: COLOR_SCHEME_EXPORT_KIND,
    schemaVersion: COLOR_SCHEME_EXPORT_SCHEMA_VERSION,
    exportedAt: Date.now(),
  };
  if (input.reader) {
    const textures = input.reader.textures
      ? Object.fromEntries(
          Object.entries(input.reader.textures).map(([id, t]) => [
            id,
            cloneExportTexture(t),
          ]),
        )
      : undefined;
    payload.reader = {
      light: {
        ...input.reader.light,
        textureId: parseReaderTextureId(input.reader.light.textureId),
      },
      dark: {
        ...input.reader.dark,
        textureId: parseReaderTextureId(input.reader.dark.textureId),
      },
      colorEnabled: { ...input.reader.colorEnabled },
      userPresets: serializeReaderPaletteUserPresets(input.reader.userPresets),
      selectedIdLight: parseReaderPaletteSelectedId(input.reader.selectedIdLight),
      selectedIdDark: parseReaderPaletteSelectedId(input.reader.selectedIdDark),
      ...(textures && Object.keys(textures).length > 0 ? { textures } : {}),
    };
  }
  if (input.highlight) {
    payload.highlight = {
      light: [...input.highlight.light],
      dark: [...input.highlight.dark],
    };
  }
  if (input.lineation) {
    payload.lineation = {
      light: [...input.lineation.light],
      dark: [...input.lineation.dark],
    };
  }
  return payload;
}

export function stringifyColorSchemeExport(payload: ColorSchemeExportV1): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function parseColorSchemeExportJson(
  raw: string,
): ColorSchemeExportV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const o = parsed as Record<string, unknown>;
    if (o.kind !== COLOR_SCHEME_EXPORT_KIND) return null;
    if (o.schemaVersion !== COLOR_SCHEME_EXPORT_SCHEMA_VERSION) return null;
    const reader = parseExportedReader(o.reader);
    const highlight = parseExportedColorPair(o.highlight, "highlight");
    const lineation = parseExportedColorPair(o.lineation, "lineation");
    if (!reader && !highlight && !lineation) return null;
    return {
      kind: COLOR_SCHEME_EXPORT_KIND,
      schemaVersion: COLOR_SCHEME_EXPORT_SCHEMA_VERSION,
      exportedAt:
        typeof o.exportedAt === "number" && Number.isFinite(o.exportedAt)
          ? o.exportedAt
          : Date.now(),
      ...(reader ? { reader } : {}),
      ...(highlight ? { highlight } : {}),
      ...(lineation ? { lineation } : {}),
    };
  } catch {
    return null;
  }
}

function zipEntryBasename(relativePath: string): string {
  const norm = relativePath.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export async function buildColorSchemeExportZip(
  payload: ColorSchemeExportV1,
  textures: ReadonlyMap<string, Uint8Array>,
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(COLOR_SCHEME_EXPORT_JSON_NAME, stringifyColorSchemeExport(payload));
  for (const [fileName, bytes] of textures) {
    zip.file(`${COLOR_SCHEME_EXPORT_TEXTURES_DIR}${fileName}`, bytes);
  }
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

export async function parseColorSchemeExportZip(
  buffer: ArrayBuffer,
): Promise<ColorSchemeExportPack | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const jsonEntry =
    zip.file(COLOR_SCHEME_EXPORT_JSON_NAME) ??
    zip.file(/^color-scheme\.json$/i)?.[0] ??
    null;
  if (!jsonEntry) return null;
  const text = await jsonEntry.async("string");
  const data = parseColorSchemeExportJson(text);
  if (!data) return null;
  const wanted = new Set<string>();
  for (const t of Object.values(data.reader?.textures ?? {})) {
    if (t.fileName) wanted.add(t.fileName);
  }
  for (const c of data.reader?.custom ?? []) {
    wanted.add(c.fileName);
  }
  const textures = new Map<string, Uint8Array>();
  const jobs: Promise<void>[] = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    const base = zipEntryBasename(relativePath);
    if (!wanted.has(base) || textures.has(base)) return;
    jobs.push(
      file.async("uint8array").then((bytes) => {
        textures.set(base, bytes);
      }),
    );
  });
  await Promise.all(jobs);
  return { data, textures };
}

export async function readCustomBackgroundFiles(
  custom: readonly { fileName: string }[],
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const c of custom) {
    try {
      const abs = readerBackgroundCustomAbs(c.fileName);
      const buf = await window.colorTxt.readFileAsArrayBuffer(abs);
      out.set(c.fileName, new Uint8Array(buf));
    } catch {
      /* 缺文件则不写入包，导入侧该 id 无图 */
    }
  }
  return out;
}

/** 「导出当前配色方案」默认名：`{方案名}.color-scheme.zip`；无名称时回退为全局包名 */
export function colorSchemeExportZipFileName(label: string): string {
  const raw = label.trim();
  if (!raw) return COLOR_SCHEME_EXPORT_DEFAULT_NAME;
  const stem = sanitizeChatExportTitleForFilename(raw);
  return `${stem}.${COLOR_SCHEME_EXPORT_FILE_EXT}`;
}

export async function saveColorSchemeExportZip(
  zipBuffer: ArrayBuffer,
  options?: { title?: string; defaultPath?: string },
): Promise<
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  const r = await window.colorTxt.showSaveDialog({
    title: options?.title ?? "导出配色",
    defaultPath: options?.defaultPath ?? COLOR_SCHEME_EXPORT_DEFAULT_NAME,
    filters: COLOR_SCHEME_EXPORT_SAVE_FILTERS,
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  let target = r.filePath;
  const lower = target.toLowerCase();
  if (
    !lower.endsWith(".color-scheme.zip") &&
    !lower.endsWith(".zip")
  ) {
    target = `${target}.${COLOR_SCHEME_EXPORT_FILE_EXT}`;
  }
  try {
    await window.colorTxt.writeBinaryFile(
      target,
      arrayBufferToBase64(zipBuffer),
    );
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function pickAndReadColorSchemeFile(
  title = "导入配色",
): Promise<
  | { ok: true; pack: ColorSchemeExportPack }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  const r = await window.colorTxt.showOpenDialog({
    title,
    filters: COLOR_SCHEME_EXPORT_OPEN_FILTERS,
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths?.[0]) {
    return { ok: false, cancelled: true };
  }
  const filePath = r.filePaths[0];
  try {
    const buffer = await window.colorTxt.readFileAsArrayBuffer(filePath);
    const pack = await parseColorSchemeExportZip(buffer);
    if (!pack) return { ok: false, error: "无法解析配色包" };
    return { ok: true, pack };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
