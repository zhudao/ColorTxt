import JSZip from "jszip";
import type {
  CharacterBookStylePersisted,
  CharacterRosterEntry,
} from "@shared/characterTypes";
import {
  normalizeCharacterBookStyle,
  normalizeCharacterRoster,
} from "../stores/fileMetaStore";
import {
  isAllowedPortraitImageBasename,
} from "@shared/characterPortraitPaths";
import {
  bookTitleForExport,
} from "./readerAnnotationExport";
import { sanitizeChatExportTitleForFilename } from "../aiAssistant/aiAssistantExport";

/** 权威包类型标识（导入时校验） */
export const CHARACTER_ROSTER_PACK_KIND = "characterRoster" as const;

export const CHARACTER_ROSTER_PACK_SCHEMA_VERSION = 1 as const;

/** 建议保存扩展（完整后缀，含 .zip） */
export const CHARACTER_ROSTER_PACK_FILE_EXT = "characters.zip";

export const CHARACTER_ROSTER_PACK_SAVE_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [
  { name: "彩读角色卡包", extensions: ["zip"] },
];

export const CHARACTER_ROSTER_PACK_OPEN_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [
  { name: "彩读角色卡包", extensions: ["zip"] },
];

const PORTRAITS_DIR = "portraits/";
const MANIFEST_NAME = "manifest.json";

export type CharacterRosterPackManifestV1 = {
  kind: typeof CHARACTER_ROSTER_PACK_KIND;
  schemaVersion: typeof CHARACTER_ROSTER_PACK_SCHEMA_VERSION;
  exportedAt: number;
  characterBookStyle?: CharacterBookStylePersisted;
  characterRoster: CharacterRosterEntry[];
};

export type ParsedCharacterRosterPack = {
  manifest: CharacterRosterPackManifestV1;
  /** basename → 图片字节（文件名与包内一致） */
  portraits: Map<string, ArrayBuffer>;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export function buildCharacterRosterPackDefaultName(bookName: string): string {
  const titlePart = sanitizeChatExportTitleForFilename(
    bookTitleForExport(bookName || "角色卡"),
  );
  return `${titlePart}.${CHARACTER_ROSTER_PACK_FILE_EXT}`;
}

/** 同角色名（trim 后）以导入侧字段为准，保留已有条目的 id；总数经 normalize 裁到上限 */
export function mergeCharacterRosterByDisplayName(
  existing: readonly CharacterRosterEntry[],
  incoming: readonly CharacterRosterEntry[],
): CharacterRosterEntry[] {
  const byName = new Map<string, CharacterRosterEntry>();
  for (const e of existing) {
    const key = e.displayName.trim();
    if (key) byName.set(key, e);
  }
  for (const e of incoming) {
    const key = e.displayName.trim();
    if (!key) continue;
    const prev = byName.get(key);
    byName.set(key, prev ? { ...e, id: prev.id } : e);
  }
  return normalizeCharacterRoster([...byName.values()]) ?? [];
}

function isSafePortraitBasename(name: string): boolean {
  return isAllowedPortraitImageBasename(name);
}

export function parseCharacterRosterPackManifest(
  raw: unknown,
): CharacterRosterPackManifestV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== CHARACTER_ROSTER_PACK_KIND) return null;
  if (obj.schemaVersion !== CHARACTER_ROSTER_PACK_SCHEMA_VERSION) return null;
  const roster = normalizeCharacterRoster(obj.characterRoster) ?? [];
  const style = normalizeCharacterBookStyle(obj.characterBookStyle);
  const exportedAt =
    typeof obj.exportedAt === "number" && Number.isFinite(obj.exportedAt)
      ? Math.floor(obj.exportedAt)
      : Date.now();
  const manifest: CharacterRosterPackManifestV1 = {
    kind: CHARACTER_ROSTER_PACK_KIND,
    schemaVersion: CHARACTER_ROSTER_PACK_SCHEMA_VERSION,
    exportedAt,
    characterRoster: roster,
  };
  if (style) manifest.characterBookStyle = style;
  return manifest;
}

export async function buildCharacterRosterPackZip(options: {
  characterRoster: readonly CharacterRosterEntry[];
  characterBookStyle?: CharacterBookStylePersisted;
  /** basename → 图片内容（已存在的正式立绘） */
  portraits: ReadonlyMap<string, ArrayBuffer>;
}): Promise<ArrayBuffer> {
  const roster =
    normalizeCharacterRoster([...options.characterRoster]) ?? [];
  const style = options.characterBookStyle
    ? normalizeCharacterBookStyle(options.characterBookStyle)
    : undefined;
  const manifest: CharacterRosterPackManifestV1 = {
    kind: CHARACTER_ROSTER_PACK_KIND,
    schemaVersion: CHARACTER_ROSTER_PACK_SCHEMA_VERSION,
    exportedAt: Date.now(),
    characterRoster: roster,
  };
  if (style) manifest.characterBookStyle = style;

  const zip = new JSZip();
  zip.file(MANIFEST_NAME, JSON.stringify(manifest, null, 2));
  for (const [basename, buf] of options.portraits) {
    if (!isSafePortraitBasename(basename)) continue;
    zip.file(`${PORTRAITS_DIR}${basename}`, buf);
  }
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

export async function parseCharacterRosterPackZip(
  buffer: ArrayBuffer,
): Promise<
  | { ok: true; pack: ParsedCharacterRosterPack }
  | { ok: false; error: string }
> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { ok: false, error: "无法读取压缩包" };
  }

  const manifestFile = zip.file(MANIFEST_NAME);
  if (!manifestFile) {
    return { ok: false, error: "不是有效的角色卡包（缺少 manifest.json）" };
  }

  let parsedJson: unknown;
  try {
    const text = await manifestFile.async("string");
    parsedJson = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "角色卡包 manifest 无法解析" };
  }

  if (
    parsedJson &&
    typeof parsedJson === "object" &&
    !Array.isArray(parsedJson) &&
    (parsedJson as Record<string, unknown>).kind != null &&
    (parsedJson as Record<string, unknown>).kind !== CHARACTER_ROSTER_PACK_KIND
  ) {
    return { ok: false, error: "不是角色卡包（包类型不匹配）" };
  }

  const manifest = parseCharacterRosterPackManifest(parsedJson);
  if (!manifest) {
    return { ok: false, error: "不是有效的角色卡包（manifest 无效）" };
  }

  const portraits = new Map<string, ArrayBuffer>();
  const folder = zip.folder("portraits");
  if (folder) {
    const tasks: Array<Promise<void>> = [];
    folder.forEach((relativePath, file) => {
      if (file.dir) return;
      const basename = relativePath.replace(/^.*[/\\]/, "").trim();
      if (!isSafePortraitBasename(basename)) return;
      tasks.push(
        (async () => {
          const data = await file.async("arraybuffer");
          portraits.set(basename, data);
        })(),
      );
    });
    await Promise.all(tasks);
  }

  return { ok: true, pack: { manifest, portraits } };
}

export async function saveCharacterRosterPackFile(
  defaultName: string,
  zipBuffer: ArrayBuffer,
): Promise<
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  const r = await window.colorTxt.showSaveDialog({
    title: "导出角色卡包",
    defaultPath: defaultName,
    filters: CHARACTER_ROSTER_PACK_SAVE_FILTERS,
  });
  if (r.canceled || !r.filePath) {
    return { ok: false, cancelled: true };
  }
  let target = r.filePath;
  const lower = target.toLowerCase();
  if (
    !lower.endsWith(".characters.zip") &&
    !lower.endsWith(".ct-characters.zip") &&
    !lower.endsWith(".colortxt-characters.zip") &&
    !lower.endsWith(".zip")
  ) {
    target = `${target}.${CHARACTER_ROSTER_PACK_FILE_EXT}`;
  }
  try {
    await window.colorTxt.writeBinaryFile(
      target,
      arrayBufferToBase64(zipBuffer),
    );
    return { ok: true, path: target };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function pickAndReadCharacterRosterPackFile(
  title = "导入角色卡包",
): Promise<
  | { ok: true; buffer: ArrayBuffer; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  const r = await window.colorTxt.showOpenDialog({
    title,
    filters: CHARACTER_ROSTER_PACK_OPEN_FILTERS,
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths?.[0]) {
    return { ok: false, cancelled: true };
  }
  const filePath = r.filePaths[0];
  try {
    const buffer = await window.colorTxt.readFileAsArrayBuffer(filePath);
    return { ok: true, buffer, path: filePath };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function joinBookDirPortraitPath(
  bookDirAbs: string,
  basename: string,
): string {
  const dir = bookDirAbs.replace(/[/\\]+$/, "");
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir}${sep}${basename}`;
}

export { arrayBufferToBase64 };
