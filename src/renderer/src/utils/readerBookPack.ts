import JSZip from "jszip";
import {
  COLOR_TXT_BOOK_PACK_ENCRYPTED_FILE_EXT,
  COLOR_TXT_BOOK_PACK_FILE_EXT,
} from "@shared/colorTxtOpenSaveDialog";
import type {
  CharacterBookStylePersisted,
  CharacterRosterEntry,
} from "@shared/characterTypes";
import {
  characterPortraitBookDirAbs,
  characterPortraitImageAbsCandidates,
  isAllowedPortraitImageBasename,
  normalizePortraitImageExtension,
  portraitImageExtensionFromPath,
  portraitStemForCharacterName,
  sanitizeBookFolderSegment,
} from "@shared/characterPortraitPaths";
import {
  fileNameKey,
  type FileBookmarkItem,
  type FileMetaRecord,
  type HighlightWordsByIndex,
  type ReaderAnnotationRecord,
  normalizeCharacterBookStyle,
  normalizeCharacterRoster,
} from "../stores/fileMetaStore";
import type { TxtFileItem } from "../services/fileListService";
import { basenameFromPath } from "../services/fileListService";
import { isEbookFilePath } from "../ebook/ebookFormat";
import {
  imagesDirAbsBesideConvertedMd,
  resolveConvertedMdOutputPaths,
} from "../ebook/convert/convertEbookToMarkdown";
import { dirnameFs, joinFs } from "../ebook/pathUtils";
import {
  bookTitleForExport,
} from "./readerAnnotationExport";
import {
  buildReaderBookmarksExportJson,
  mergeImportedBookmarks,
  normalizeBookmarksList,
  parseReaderBookmarksExportJson,
} from "./readerBookmarkExport";
import {
  buildReaderHighlightsExportJson,
  mergeImportedHighlightWords,
  parseReaderHighlightsExportJson,
} from "./readerHighlightExport";
import {
  buildReaderAnnotationsExportJson,
  parseReaderAnnotationsExportJson,
} from "./readerAnnotationExport";
import {
  mergeImportedAnnotations,
  normalizeReaderAnnotations,
} from "./readerAnnotations";
import {
  CHARACTER_ROSTER_PACK_KIND,
  CHARACTER_ROSTER_PACK_SCHEMA_VERSION,
  mergeCharacterRosterByDisplayName,
  parseCharacterRosterPackManifest,
  type CharacterRosterPackManifestV1,
} from "./characterRosterPack";
import {
  sanitizeChatExportTitleForFilename,
} from "../aiAssistant/aiAssistantExport";
import { resolveDefaultEbookConvertOutputDirSync } from "./defaultCacheDirs";
import {
  openBookPackZipPayload,
  sealBookPackZipIfNeeded,
} from "./readerBookPackCrypto";

export const READER_BOOK_PACK_KIND = "readerBook" as const;
export const READER_BOOK_PACK_SCHEMA_VERSION = 1 as const;
export const READER_BOOK_PACK_FILE_EXT = COLOR_TXT_BOOK_PACK_FILE_EXT;
export const READER_BOOK_PACK_ENCRYPTED_FILE_EXT =
  COLOR_TXT_BOOK_PACK_ENCRYPTED_FILE_EXT;

export const READER_BOOK_PACK_SAVE_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [
  { name: "彩读书包", extensions: [COLOR_TXT_BOOK_PACK_FILE_EXT] },
];

export const READER_BOOK_PACK_ENCRYPTED_SAVE_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [
  {
    name: "加密彩读书包",
    extensions: [COLOR_TXT_BOOK_PACK_ENCRYPTED_FILE_EXT],
  },
];

export const READER_BOOK_PACK_OPEN_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [
  {
    name: "彩读书包",
    extensions: [
      COLOR_TXT_BOOK_PACK_FILE_EXT,
      COLOR_TXT_BOOK_PACK_ENCRYPTED_FILE_EXT,
    ],
  },
];

const MANIFEST_NAME = "manifest.json";
const CONTENT_DIR = "content/";
const CHARACTERS_DIR = "characters/";

export type ReaderBookPackManifestV1 = {
  kind: typeof READER_BOOK_PACK_KIND;
  schemaVersion: typeof READER_BOOK_PACK_SCHEMA_VERSION;
  exportedAt: number;
  contentFileName: string;
  sourceEbookFileName?: string;
  imagesDirName?: string;
  viewportTopPhysicalLine?: number;
};

export type ParsedReaderBookPack = {
  manifest: ReaderBookPackManifestV1;
  content: ArrayBuffer;
  /** relative posix under images dir → bytes */
  images: Map<string, ArrayBuffer>;
  bookmarks: FileBookmarkItem[];
  highlightWordsByIndex: HighlightWordsByIndex;
  annotations: ReaderAnnotationRecord[];
  characterRoster: CharacterRosterEntry[];
  characterBookStyle?: CharacterBookStylePersisted;
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

export function isReaderBookPackPath(filePath: string): boolean {
  return looksLikeZipBookPackCandidate(filePath);
}

/**
 * 可能是彩读书包的候选：`.ctz`（明文）或 `.ctzx`（加密）。
 * 是否合法书包由 `parseReaderBookPackZip`（manifest / kind）判定。
 */
export function looksLikeZipBookPackCandidate(filePath: string): boolean {
  const lower = filePath.trim().toLowerCase();
  return (
    lower.endsWith(`.${COLOR_TXT_BOOK_PACK_FILE_EXT}`) ||
    lower.endsWith(`.${COLOR_TXT_BOOK_PACK_ENCRYPTED_FILE_EXT}`)
  );
}

export function buildReaderBookPackDefaultName(
  bookName: string,
  encrypted = false,
): string {
  const titlePart = sanitizeChatExportTitleForFilename(
    bookTitleForExport(bookName || "书包"),
  );
  const ext = encrypted
    ? READER_BOOK_PACK_ENCRYPTED_FILE_EXT
    : READER_BOOK_PACK_FILE_EXT;
  return `${titlePart}.${ext}`;
}

export function parseReaderBookPackManifest(
  raw: unknown,
): ReaderBookPackManifestV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== READER_BOOK_PACK_KIND) return null;
  if (obj.schemaVersion !== READER_BOOK_PACK_SCHEMA_VERSION) return null;
  const contentFileName =
    typeof obj.contentFileName === "string"
      ? obj.contentFileName.trim()
      : "";
  if (!contentFileName || contentFileName.includes("/") || contentFileName.includes("\\") || contentFileName.includes("..")) {
    return null;
  }
  const out: ReaderBookPackManifestV1 = {
    kind: READER_BOOK_PACK_KIND,
    schemaVersion: READER_BOOK_PACK_SCHEMA_VERSION,
    exportedAt:
      typeof obj.exportedAt === "number" && Number.isFinite(obj.exportedAt)
        ? Math.floor(obj.exportedAt)
        : Date.now(),
    contentFileName,
  };
  if (typeof obj.sourceEbookFileName === "string" && obj.sourceEbookFileName.trim()) {
    const s = obj.sourceEbookFileName.trim();
    if (!s.includes("/") && !s.includes("\\") && !s.includes("..")) {
      out.sourceEbookFileName = s;
    }
  }
  if (typeof obj.imagesDirName === "string" && obj.imagesDirName.trim()) {
    const s = obj.imagesDirName.trim();
    if (!s.includes("/") && !s.includes("\\") && !s.includes("..")) {
      out.imagesDirName = s;
    }
  }
  if (
    typeof obj.viewportTopPhysicalLine === "number" &&
    Number.isFinite(obj.viewportTopPhysicalLine)
  ) {
    out.viewportTopPhysicalLine = Math.max(
      1,
      Math.floor(obj.viewportTopPhysicalLine),
    );
  }
  return out;
}

export function arrayBuffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] !== ub[i]) return false;
  }
  return true;
}

/** 列表中多个同名时取靠后一条 */
export function findTxtFileByBasename(
  files: readonly TxtFileItem[],
  fileName: string,
): TxtFileItem | null {
  const key = fileNameKey(fileName);
  if (!key) return null;
  let found: TxtFileItem | null = null;
  for (const f of files) {
    if (fileNameKey(f.path) === key) found = f;
  }
  return found;
}

export function imagesDirNameBesideContentFileName(
  contentFileName: string,
): string | null {
  if (!/\.md$/i.test(contentFileName)) return null;
  return `${contentFileName.slice(0, -".md".length)}.Images`;
}

/** 从转换 md 文件名推断源电子书名：`foo.epub.md` → `foo.epub` */
export function inferSourceEbookFileNameFromContentName(
  contentFileName: string,
): string | null {
  const base = contentFileName.trim();
  if (!/\.md$/i.test(base)) return null;
  const withoutMd = base.slice(0, -".md".length);
  if (!withoutMd || !isEbookFilePath(withoutMd)) return null;
  return withoutMd;
}

export async function resolveConvertedMdPathForEbook(params: {
  ebookAbsPath: string;
  meta?: FileMetaRecord | null;
  ebookConvertOutputDir?: string;
}): Promise<string> {
  const recorded = params.meta?.convertedMdPath?.trim();
  if (recorded) {
    try {
      const st = await window.colorTxt.stat(recorded);
      if (st.isFile) return recorded;
    } catch {
      /* fall through */
    }
  }
  const outDir =
    params.ebookConvertOutputDir?.trim() ||
    resolveDefaultEbookConvertOutputDirSync();
  const { convertedMdPath } = resolveConvertedMdOutputPaths({
    sourceBookPath: params.ebookAbsPath,
    ebookConvertOutputDir: outDir,
  });
  return convertedMdPath;
}

async function collectImagesIntoMap(
  imagesDirAbs: string,
): Promise<{ dirName: string; files: Map<string, ArrayBuffer> } | null> {
  try {
    const st = await window.colorTxt.stat(imagesDirAbs);
    if (!st.isDirectory) return null;
  } catch {
    return null;
  }
  const listed = await window.colorTxt.listFilesRecursive(imagesDirAbs);
  if (!listed.files.length) return null;
  const dirName = basenameFromPath(imagesDirAbs);
  const files = new Map<string, ArrayBuffer>();
  for (const rel of listed.files) {
    const abs = joinFs(imagesDirAbs, ...rel.split("/"));
    try {
      const buf = await window.colorTxt.readFileAsArrayBuffer(abs);
      files.set(rel.replace(/\\/g, "/"), buf);
    } catch {
      /* skip */
    }
  }
  if (files.size === 0) return null;
  return { dirName, files };
}

async function collectPortraitsForRoster(
  roster: readonly CharacterRosterEntry[],
  sessionPathForFolder: string,
  portraitCacheDir: string,
): Promise<Map<string, ArrayBuffer>> {
  const portraits = new Map<string, ArrayBuffer>();
  const root =
    portraitCacheDir.trim() ||
    (await window.colorTxt.getDefaultCharacterPortraitCacheDir());
  const bookSeg = sanitizeBookFolderSegment(sessionPathForFolder);
  for (const entry of roster) {
    const name = entry.displayName.trim();
    if (!name) continue;
    let abs: string | null = null;
    for (const candidate of characterPortraitImageAbsCandidates(
      root,
      bookSeg,
      name,
    )) {
      try {
        const st = await window.colorTxt.stat(candidate);
        if (st.isFile) {
          abs = candidate;
          break;
        }
      } catch {
        /* try next */
      }
    }
    if (!abs) continue;
    const ext = normalizePortraitImageExtension(
      portraitImageExtensionFromPath(abs) || "png",
    );
    const basename = `${portraitStemForCharacterName(name)}.${ext}`;
    try {
      portraits.set(basename, await window.colorTxt.readFileAsArrayBuffer(abs));
    } catch {
      /* skip */
    }
  }
  return portraits;
}

export async function buildReaderBookPackZip(options: {
  physicalContentPath: string;
  sessionFilePath: string;
  meta: FileMetaRecord | null | undefined;
  portraitCacheDir: string;
  includeReadingProgress: boolean;
  viewportTopPhysicalLine?: number | null;
  /** 非空则对 ZIP 整包 AES-GCM 加密 */
  password?: string;
}): Promise<ArrayBuffer> {
  const contentAbs = options.physicalContentPath.trim();
  const contentBuf = await window.colorTxt.readFileAsArrayBuffer(contentAbs);
  const contentFileName = basenameFromPath(contentAbs);
  const sessionPath = options.sessionFilePath.trim() || contentAbs;

  const manifest: ReaderBookPackManifestV1 = {
    kind: READER_BOOK_PACK_KIND,
    schemaVersion: READER_BOOK_PACK_SCHEMA_VERSION,
    exportedAt: Date.now(),
    contentFileName,
  };
  if (isEbookFilePath(sessionPath)) {
    manifest.sourceEbookFileName = basenameFromPath(sessionPath);
  } else {
    // 若直接打开的是转换 md（如 foo.epub.md），仍记下源电子书文件名便于导入匹配
    const inferred = inferSourceEbookFileNameFromContentName(contentFileName);
    if (inferred) manifest.sourceEbookFileName = inferred;
  }
  if (
    options.includeReadingProgress &&
    typeof options.viewportTopPhysicalLine === "number" &&
    Number.isFinite(options.viewportTopPhysicalLine)
  ) {
    manifest.viewportTopPhysicalLine = Math.max(
      1,
      Math.floor(options.viewportTopPhysicalLine),
    );
  }

  const zip = new JSZip();
  zip.file(`${CONTENT_DIR}${contentFileName}`, contentBuf);

  if (/\.md$/i.test(contentFileName)) {
    try {
      const imagesAbs = imagesDirAbsBesideConvertedMd(contentAbs);
      const collected = await collectImagesIntoMap(imagesAbs);
      if (collected) {
        manifest.imagesDirName = collected.dirName;
        for (const [rel, buf] of collected.files) {
          zip.file(`${CONTENT_DIR}${collected.dirName}/${rel}`, buf);
        }
      }
    } catch {
      /* no images */
    }
  }

  zip.file(MANIFEST_NAME, JSON.stringify(manifest, null, 2));

  const meta = options.meta;
  const bookmarks = meta?.bookmarks ?? [];
  if (bookmarks.length) {
    zip.file(
      "bookmarks.json",
      buildReaderBookmarksExportJson(sessionPath, basenameFromPath(sessionPath), bookmarks),
    );
  }
  const highlights = meta?.highlightWordsByIndex;
  if (highlights && Object.keys(highlights).length) {
    zip.file(
      "highlights.json",
      buildReaderHighlightsExportJson(highlights),
    );
  }
  const annotations = meta?.readerAnnotations ?? [];
  if (annotations.length) {
    zip.file(
      "notes.json",
      buildReaderAnnotationsExportJson(
        sessionPath,
        basenameFromPath(sessionPath),
        annotations,
      ),
    );
  }

  const roster = meta?.characterRoster ?? [];
  const style = meta?.characterBookStyle;
  if (roster.length || style) {
    const charManifest: CharacterRosterPackManifestV1 = {
      kind: CHARACTER_ROSTER_PACK_KIND,
      schemaVersion: CHARACTER_ROSTER_PACK_SCHEMA_VERSION,
      exportedAt: Date.now(),
      characterRoster: normalizeCharacterRoster(roster) ?? [],
    };
    const ns = style ? normalizeCharacterBookStyle(style) : undefined;
    if (ns) charManifest.characterBookStyle = ns;
    zip.file(
      `${CHARACTERS_DIR}manifest.json`,
      JSON.stringify(charManifest, null, 2),
    );
    const portraits = await collectPortraitsForRoster(
      roster,
      sessionPath,
      options.portraitCacheDir,
    );
    for (const [basename, buf] of portraits) {
      zip.file(`${CHARACTERS_DIR}portraits/${basename}`, buf);
    }
  }

  const zipBuffer = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
  });
  return sealBookPackZipIfNeeded(zipBuffer, options.password ?? "");
}

export async function parseReaderBookPackZip(
  buffer: ArrayBuffer,
  password = "",
): Promise<
  | { ok: true; pack: ParsedReaderBookPack }
  | {
      ok: false;
      error: string;
      code?: "needPassword" | "wrongPassword";
    }
> {
  const opened = await openBookPackZipPayload(buffer, password);
  if (!opened.ok) return opened;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(opened.zipBuffer);
  } catch {
    return { ok: false, error: "无法读取压缩包" };
  }

  const manifestFile = zip.file(MANIFEST_NAME);
  if (!manifestFile) {
    return { ok: false, error: "不是有效的彩读书包（缺少 manifest.json）" };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await manifestFile.async("string")) as unknown;
  } catch {
    return { ok: false, error: "彩读书包 manifest 无法解析" };
  }
  if (
    parsedJson &&
    typeof parsedJson === "object" &&
    !Array.isArray(parsedJson) &&
    (parsedJson as Record<string, unknown>).kind != null &&
    (parsedJson as Record<string, unknown>).kind !== READER_BOOK_PACK_KIND
  ) {
    return { ok: false, error: "不是彩读书包（包类型不匹配）" };
  }
  const manifest = parseReaderBookPackManifest(parsedJson);
  if (!manifest) {
    return { ok: false, error: "不是有效的彩读书包（manifest 无效）" };
  }

  const contentEntry = zip.file(`${CONTENT_DIR}${manifest.contentFileName}`);
  if (!contentEntry) {
    return { ok: false, error: "彩读书包缺少正文文件" };
  }
  const content = await contentEntry.async("arraybuffer");

  const images = new Map<string, ArrayBuffer>();
  if (manifest.imagesDirName) {
    const prefix = `${CONTENT_DIR}${manifest.imagesDirName}/`;
    const tasks: Array<Promise<void>> = [];
    zip.forEach((relativePath, file) => {
      if (file.dir) return;
      const norm = relativePath.replace(/\\/g, "/");
      if (!norm.startsWith(prefix)) return;
      const rel = norm.slice(prefix.length);
      if (!rel || rel.includes("..")) return;
      tasks.push(
        (async () => {
          images.set(rel, await file.async("arraybuffer"));
        })(),
      );
    });
    await Promise.all(tasks);
  }

  let bookmarks: FileBookmarkItem[] = [];
  const bookmarksFile = zip.file("bookmarks.json");
  if (bookmarksFile) {
    try {
      const env = parseReaderBookmarksExportJson(
        await bookmarksFile.async("string"),
      );
      if (env) bookmarks = env.bookmarks;
      else bookmarks = normalizeBookmarksList(
        JSON.parse(await bookmarksFile.async("string")),
      );
    } catch {
      /* ignore */
    }
  }

  let highlightWordsByIndex: HighlightWordsByIndex = {};
  const highlightsFile = zip.file("highlights.json");
  if (highlightsFile) {
    try {
      const env = parseReaderHighlightsExportJson(
        await highlightsFile.async("string"),
      );
      if (env) highlightWordsByIndex = env.highlightWordsByIndex;
    } catch {
      /* ignore */
    }
  }

  let annotations: ReaderAnnotationRecord[] = [];
  const notesFile = zip.file("notes.json");
  if (notesFile) {
    try {
      const env = parseReaderAnnotationsExportJson(
        await notesFile.async("string"),
      );
      if (env) {
        annotations = normalizeReaderAnnotations(env.annotations) ?? [];
      }
    } catch {
      /* ignore */
    }
  }

  let characterRoster: CharacterRosterEntry[] = [];
  let characterBookStyle: CharacterBookStylePersisted | undefined;
  const portraits = new Map<string, ArrayBuffer>();
  const charManifestFile = zip.file(`${CHARACTERS_DIR}manifest.json`);
  if (charManifestFile) {
    try {
      const raw = JSON.parse(await charManifestFile.async("string")) as unknown;
      const cm = parseCharacterRosterPackManifest(raw);
      if (cm) {
        characterRoster = cm.characterRoster;
        characterBookStyle = cm.characterBookStyle;
      }
    } catch {
      /* ignore */
    }
    const portraitPrefix = `${CHARACTERS_DIR}portraits/`;
    const pTasks: Array<Promise<void>> = [];
    zip.forEach((relativePath, file) => {
      if (file.dir) return;
      const norm = relativePath.replace(/\\/g, "/");
      if (!norm.startsWith(portraitPrefix)) return;
      const base = norm.slice(portraitPrefix.length);
      if (!base || base.includes("/") || base.includes("..")) return;
      if (!isAllowedPortraitImageBasename(base)) return;
      pTasks.push(
        (async () => {
          portraits.set(base, await file.async("arraybuffer"));
        })(),
      );
    });
    await Promise.all(pTasks);
  }

  return {
    ok: true,
    pack: {
      manifest,
      content,
      images,
      bookmarks,
      highlightWordsByIndex,
      annotations,
      characterRoster,
      characterBookStyle,
      portraits,
    },
  };
}

export async function saveReaderBookPackFile(
  defaultName: string,
  zipBuffer: ArrayBuffer,
  encrypted = false,
): Promise<
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }
> {
  const r = await window.colorTxt.showSaveDialog({
    title: "导出书包",
    defaultPath: defaultName,
    filters: encrypted
      ? READER_BOOK_PACK_ENCRYPTED_SAVE_FILTERS
      : READER_BOOK_PACK_SAVE_FILTERS,
  });
  if (r.canceled || !r.filePath) {
    return { ok: false, cancelled: true };
  }
  let target = r.filePath;
  const lower = target.toLowerCase();
  const hasKnownExt =
    lower.endsWith(`.${COLOR_TXT_BOOK_PACK_FILE_EXT}`) ||
    lower.endsWith(`.${COLOR_TXT_BOOK_PACK_ENCRYPTED_FILE_EXT}`);
  if (!hasKnownExt) {
    target = `${target}.${
      encrypted
        ? READER_BOOK_PACK_ENCRYPTED_FILE_EXT
        : READER_BOOK_PACK_FILE_EXT
    }`;
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

export async function writeContentAndImages(params: {
  contentAbsPath: string;
  content: ArrayBuffer;
  imagesDirName?: string;
  images: ReadonlyMap<string, ArrayBuffer>;
}): Promise<void> {
  await window.colorTxt.mkdir(dirnameFs(params.contentAbsPath));
  await window.colorTxt.writeBinaryFile(
    params.contentAbsPath,
    arrayBufferToBase64(params.content),
  );
  if (!params.imagesDirName || params.images.size === 0) return;
  const imagesAbs = joinFs(
    dirnameFs(params.contentAbsPath),
    params.imagesDirName,
  );
  await window.colorTxt.mkdir(imagesAbs);
  for (const [rel, buf] of params.images) {
    const dest = joinFs(imagesAbs, ...rel.split("/").filter(Boolean));
    await window.colorTxt.mkdir(dirnameFs(dest));
    await window.colorTxt.writeBinaryFile(dest, arrayBufferToBase64(buf));
  }
}

export async function writePortraitsForBook(params: {
  sessionPathForFolder: string;
  portraitCacheDir: string;
  portraits: ReadonlyMap<string, ArrayBuffer>;
}): Promise<void> {
  if (params.portraits.size === 0) return;
  const root =
    params.portraitCacheDir.trim() ||
    (await window.colorTxt.getDefaultCharacterPortraitCacheDir());
  const bookSeg = sanitizeBookFolderSegment(params.sessionPathForFolder);
  const bookDir = characterPortraitBookDirAbs(root, bookSeg);
  await window.colorTxt.mkdir(bookDir);
  for (const [basename, buf] of params.portraits) {
    if (!isAllowedPortraitImageBasename(basename)) continue;
    const rawExt = portraitImageExtensionFromPath(basename);
    const keepExt = normalizePortraitImageExtension(rawExt || "png");
    const stem = basename.slice(0, basename.length - rawExt.length - 1);
    if (!stem) continue;
    const dest = joinFs(bookDir, `${stem}.${keepExt}`);
    await window.colorTxt.writeBinaryFile(dest, arrayBufferToBase64(buf));
    const keepPath = dest.replace(/\\/g, "/").toLowerCase();
    for (const candidate of characterPortraitImageAbsCandidates(
      root,
      bookSeg,
      stem,
    )) {
      if (candidate.replace(/\\/g, "/").toLowerCase() === keepPath) continue;
      try {
        const st = await window.colorTxt.stat(candidate);
        if (st.isFile) await window.colorTxt.removePath(candidate);
      } catch {
        /* ignore */
      }
    }
  }
}

export function mergeBookPackMetaIntoRecord(params: {
  existing: FileMetaRecord | null | undefined;
  pack: ParsedReaderBookPack;
  includeProgress: boolean;
}): {
  bookmarks: FileBookmarkItem[];
  highlightWordsByIndex: HighlightWordsByIndex | undefined;
  readerAnnotations: ReaderAnnotationRecord[];
  characterRoster: CharacterRosterEntry[] | undefined;
  characterBookStyle: CharacterBookStylePersisted | undefined;
  viewportTopPhysicalLine?: number;
  clearEditorViewState: boolean;
} {
  const bookmarks = mergeImportedBookmarks(
    params.existing?.bookmarks ?? [],
    params.pack.bookmarks,
  );
  const highlightWordsByIndex =
    mergeImportedHighlightWords(
      params.existing?.highlightWordsByIndex,
      params.pack.highlightWordsByIndex,
    ) || undefined;
  const readerAnnotations = mergeImportedAnnotations(
    params.existing?.readerAnnotations ?? [],
    params.pack.annotations,
  );
  const characterRoster = mergeCharacterRosterByDisplayName(
    params.existing?.characterRoster ?? [],
    params.pack.characterRoster,
  );
  const characterBookStyle =
    params.pack.characterBookStyle ?? params.existing?.characterBookStyle;
  const out: {
    bookmarks: FileBookmarkItem[];
    highlightWordsByIndex: HighlightWordsByIndex | undefined;
    readerAnnotations: ReaderAnnotationRecord[];
    characterRoster: CharacterRosterEntry[] | undefined;
    characterBookStyle: CharacterBookStylePersisted | undefined;
    viewportTopPhysicalLine?: number;
    clearEditorViewState: boolean;
  } = {
    bookmarks,
    highlightWordsByIndex:
      highlightWordsByIndex && Object.keys(highlightWordsByIndex).length
        ? highlightWordsByIndex
        : params.existing?.highlightWordsByIndex,
    readerAnnotations,
    characterRoster: characterRoster.length ? characterRoster : undefined,
    characterBookStyle,
    clearEditorViewState: false,
  };
  if (
    params.includeProgress &&
    typeof params.pack.manifest.viewportTopPhysicalLine === "number"
  ) {
    out.viewportTopPhysicalLine = params.pack.manifest.viewportTopPhysicalLine;
    out.clearEditorViewState = true;
  }
  return out;
}

export { arrayBufferToBase64 };
