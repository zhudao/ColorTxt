import type { WebDavAuthPayload } from "@shared/webDavIpc";
import type { BookSourceRecord } from "@shared/bookSource/types";
import { parseBookSourceJson } from "@shared/bookSource/types";
import {
  stripVoiceReadProfileApiKeysForDisk,
  stripVoiceReadSettingsApiKeysForDisk,
} from "@shared/voiceReadProfiles";
import { persistKey, persistedSettingsChangedEvent } from "../constants/appUi";
import { parseReaderBackgroundState } from "../constants/readerBackground";
import {
  deleteUnreferencedLocalBackgroundFiles,
  downloadReaderBackgroundFiles,
  pruneRemoteOrphanBackgroundFiles,
  readerBackgroundFromLocalStorage,
  uniqueCustomBackgroundFileNames,
  uploadReaderBackgroundFiles,
} from "./webDavReaderBackgroundSync";
import {
  loadFindBookBookshelf,
  saveFindBookBookshelf,
  type BookshelfBook,
} from "../bookSource/findBookBookshelf";
import {
  BOOKSHELF_CATEGORY_CATALOG_KEY,
} from "../bookSource/findBookshelfCategory";
import { DEFAULT_BOOKSHELF_SORT } from "../bookSource/findBookshelfSort";
import { ipcPlain } from "../bookSource/ipcPlain";

const REPLACE_FB = "colortxt:replaceRules:findBook";
const FB_SETTINGS = "colortxt.findBook.settings";
const FB_SORT = "colortxt:findBookBookshelfSort";
const FB_CAT_FILTER = "colortxt:findBookBookshelfCategory";
const FB_SEARCH = "colortxt:findBookSearchHistory";
const SYNC_STATE_KEY = "colortxt:findBookBookshelfWebDavSync";

/** 找书同步用的阅读/编辑/语音/配色相关 ui 字段 */
const UI_READER_KEYS = [
  "theme",
  "fontSize",
  "lineHeightMultiple",
  "lineSpacingPx",
  "letterSpacingPx",
  "readerHorizontalInsetPx",
  "fontFamily",
  "pinnedOtherFonts",
  "compressBlankLines",
  "compressBlankKeepOneBlank",
  "chapterTitleBlankMode",
  "leadIndentFullWidth",
  "textConvertZh",
  "textConvertLetter",
  "textConvertDigit",
  "monacoCustomHighlight",
  "txtrDelimitedMatchCrossLine",
  "monacoAdvancedWrapping",
  "monacoCjkWrapOptimize",
  "monacoSmoothScrolling",
  "scrollbarTrackBehavior",
  "mouseWheelScrollSensitivity",
  "fastScrollSensitivity",
  "stickyChapterTitleEnabled",
  "readerClickMode",
  "readingRulerEnabled",
  "readingRulerFocusLines",
  "readingRulerDimOpacity",
  "readingRulerDimStickyTitle",
  "readingRulerTransitionEnabled",
  "markdownImageHeightPx",
  "chapterNavToolbarEnabled",
  "readerEditShowLineNumbers",
  "readerEditMinimap",
  "editAutoRefreshChapterList",
  "timedScroll",
  "readerPaletteColorEnabledOverrides",
  "readerPaletteColorEnabledOverridesLight",
  "readerPaletteColorEnabledOverridesDark",
  "readerPaletteUserPresets",
  "readerPaletteSelectedIdLight",
  "readerPaletteSelectedIdDark",
  // 旧覆盖色：仅给对端尚未迁 selectedId 的远端；读盘后 migrateLegacyReaderPaletteOverrides 会消化并删掉
  "readerPaletteOverridesLight",
  "readerPaletteOverridesDark",
  "readerBackground",
  "highlightColorsLight",
  "highlightColorsDark",
  "lineationColorsLight",
  "lineationColorsDark",
  "lineationLastColors",
  "highlightLastColor",
  "voiceRead",
] as const;

type SyncEntry = { hash: string; remoteLastModified?: string | null };
type SyncState = Record<string, SyncEntry>;

function loadSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SyncState;
  } catch {
    return {};
  }
}

function saveSyncState(state: SyncState): void {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function bookContentHash(book: BookshelfBook): string {
  return hashString(stableStringify(book));
}

/**
 * 远端一书一文件：`书名_作者_{id短hash}.json`。
 * 去掉 \ / : * ? " < > |；绝不用 book.id（含 URL）当文件名。
 */
function shelfRemoteFileName(book: Pick<BookshelfBook, "id" | "name" | "author">): string {
  const raw = `${book.name.trim() || "未命名"}_${book.author.trim() || "佚名"}`;
  const cleaned = raw
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .replace(/_+/g, "_")
    .trim() || "book";
  const stem = `${cleaned}_${hashString(book.id).slice(0, 6)}`.slice(0, 180);
  return `${stem}.json`;
}

const SHELF_REMOTE_DIR = "FindBook/bookshelf";

function shelfRemotePath(book: Pick<BookshelfBook, "id" | "name" | "author">): string {
  return `${SHELF_REMOTE_DIR}/${shelfRemoteFileName(book)}`;
}

function isShelfBookJson(name: string): boolean {
  return name.toLowerCase().endsWith(".json");
}

function buildUiReaderJson(): string {
  let raw: Record<string, unknown> = {};
  try {
    const s = localStorage.getItem(persistKey);
    if (s) raw = JSON.parse(s) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const out: Record<string, unknown> = { schemaVersion: 1 };
  for (const k of UI_READER_KEYS) {
    if (k in raw) out[k] = raw[k];
  }
  if (out.voiceRead && typeof out.voiceRead === "object") {
    const vr = out.voiceRead as Record<string, unknown>;
    const stripped = stripVoiceReadSettingsApiKeysForDisk(vr as never) as Record<
      string,
      unknown
    >;
    if (Array.isArray(vr.profiles)) {
      stripped.profiles = stripVoiceReadProfileApiKeysForDisk(
        vr.profiles as never,
      );
    }
    out.voiceRead = stripped;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

function applyUiReaderJson(text: string): void {
  const patch = JSON.parse(text) as Record<string, unknown>;
  if (!patch || typeof patch !== "object") {
    throw new Error("ui-reader.json 格式无效");
  }
  let raw: Record<string, unknown> = {};
  try {
    const s = localStorage.getItem(persistKey);
    if (s) raw = JSON.parse(s) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  for (const k of UI_READER_KEYS) {
    if (k in patch) raw[k] = patch[k];
  }
  localStorage.setItem(persistKey, JSON.stringify(raw));
}

function peekReaderBackgroundAfterUiReader(text: string) {
  const patch = JSON.parse(text) as Record<string, unknown>;
  if (!patch || typeof patch !== "object") {
    throw new Error("ui-reader.json 格式无效");
  }
  if ("readerBackground" in patch) {
    return parseReaderBackgroundState(patch.readerBackground);
  }
  return readerBackgroundFromLocalStorage();
}

function lsGet(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: string): void {
  localStorage.setItem(key, value);
}

async function putTextLines(
  auth: WebDavAuthPayload,
  path: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const text = body.endsWith("\n") ? body : `${body}\n`;
  return api.putText(auth, path, text);
}

export type FindBookBookshelfSyncStats = {
  booksUploaded: number;
  booksSkipped: number;
  booksDeletedRemote: number;
  booksDownloaded: number;
  booksDownloadSkipped: number;
};

export type FindBookBookSourceSyncStats = {
  sourceCount: number;
  added: number;
  updated: number;
};

/** 上传书架（含分类 / 排序；一书一文件，增量） */
export async function uploadFindBookBookshelf(
  auth: WebDavAuthPayload,
): Promise<
  | { ok: true; stats: FindBookBookshelfSyncStats }
  | { ok: false; error: string }
> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const ensure = await api.ensureLayout(auth);
  if (!ensure.ok) return ensure;

  const metaFiles: [string, string][] = [
    [
      "FindBook/bookshelfCategory.json",
      JSON.stringify({
        filter: lsGet(FB_CAT_FILTER, ""),
        catalog: lsGet(BOOKSHELF_CATEGORY_CATALOG_KEY, "[]"),
      }),
    ],
    [
      "FindBook/bookshelfSort.json",
      JSON.stringify(lsGet(FB_SORT, DEFAULT_BOOKSHELF_SORT)),
    ],
  ];
  for (const [path, body] of metaFiles) {
    const r = await putTextLines(auth, path, body);
    if (!r.ok) return r;
  }

  const books = loadFindBookBookshelf();
  const state = loadSyncState();
  const localIds = new Set(books.map((b) => b.id));
  const localFileNames = new Set(books.map((b) => shelfRemoteFileName(b)));

  // 列出 FindBook/bookshelf/ 下已有书文件
  const remoteFileNames = new Set<string>();
  const listedBefore = await api.list(auth, SHELF_REMOTE_DIR);
  if (listedBefore.ok) {
    for (const ent of listedBefore.entries) {
      if (ent.isDirectory) continue;
      if (isShelfBookJson(ent.name)) remoteFileNames.add(ent.name);
    }
  }

  let booksUploaded = 0;
  let booksSkipped = 0;
  for (const book of books) {
    const hash = bookContentHash(book);
    const fileName = shelfRemoteFileName(book);
    if (remoteFileNames.has(fileName) && state[book.id]?.hash === hash) {
      booksSkipped += 1;
      continue;
    }
    const r = await putTextLines(auth, shelfRemotePath(book), JSON.stringify(book));
    if (!r.ok) return r;
    state[book.id] = { hash };
    remoteFileNames.add(fileName);
    booksUploaded += 1;
  }

  for (const id of Object.keys(state)) {
    if (!localIds.has(id)) {
      delete state[id];
    }
  }

  let booksDeletedRemote = 0;
  for (const name of remoteFileNames) {
    if (localFileNames.has(name)) continue;
    const d = await api.delete(auth, `${SHELF_REMOTE_DIR}/${name}`);
    if (!d.ok) return d;
    booksDeletedRemote += 1;
  }

  saveSyncState(state);

  return {
    ok: true,
    stats: {
      booksUploaded,
      booksSkipped,
      booksDeletedRemote,
      booksDownloaded: 0,
      booksDownloadSkipped: 0,
    },
  };
}

/** 更新书架（增量；保留本地独有书） */
export async function downloadFindBookBookshelf(
  auth: WebDavAuthPayload,
): Promise<
  | { ok: true; stats: FindBookBookshelfSyncStats }
  | { ok: false; error: string }
> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };

  const cat = await api.getText(auth, "FindBook/bookshelfCategory.json");
  if (cat.ok) {
    try {
      const o = JSON.parse(cat.text) as {
        filter?: string;
        catalog?: string | unknown;
      };
      if (typeof o.filter === "string") lsSet(FB_CAT_FILTER, o.filter);
      if (typeof o.catalog === "string") {
        lsSet(BOOKSHELF_CATEGORY_CATALOG_KEY, o.catalog);
      } else if (o.catalog != null) {
        lsSet(BOOKSHELF_CATEGORY_CATALOG_KEY, JSON.stringify(o.catalog));
      }
    } catch {
      return { ok: false, error: "远端 bookshelfCategory.json 无效" };
    }
  }

  const sort = await api.getText(auth, "FindBook/bookshelfSort.json");
  if (sort.ok) {
    try {
      const parsed: unknown = JSON.parse(sort.text);
      if (typeof parsed === "string" && parsed.trim()) {
        lsSet(FB_SORT, parsed.trim());
      } else if (sort.text.trim()) {
        lsSet(FB_SORT, sort.text.trim().replace(/^"|"$/g, ""));
      }
    } catch {
      const t = sort.text.trim().replace(/^"|"$/g, "");
      if (t) lsSet(FB_SORT, t);
    }
  }

  const local = loadFindBookBookshelf();
  const byId = new Map(local.map((b) => [b.id, b]));
  const state = loadSyncState();
  let booksDownloaded = 0;
  let booksDownloadSkipped = 0;

  async function ingestEntry(
    ent: { name: string; isDirectory: boolean; lastModified?: string | null },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (ent.isDirectory) return { ok: true };
    if (!isShelfBookJson(ent.name)) return { ok: true };

    const g = await api!.getText(auth, `${SHELF_REMOTE_DIR}/${ent.name}`);
    if (!g.ok) return g;
    try {
      const book = JSON.parse(g.text) as BookshelfBook;
      if (!book || typeof book !== "object" || typeof book.id !== "string") {
        return { ok: true };
      }
      const prev = state[book.id];
      if (
        prev &&
        prev.remoteLastModified &&
        ent.lastModified &&
        prev.remoteLastModified === ent.lastModified &&
        byId.has(book.id)
      ) {
        booksDownloadSkipped += 1;
        return { ok: true };
      }
      byId.set(book.id, book);
      state[book.id] = {
        hash: bookContentHash(book),
        remoteLastModified: ent.lastModified ?? g.lastModified,
      };
      booksDownloaded += 1;
      return { ok: true };
    } catch {
      return { ok: false, error: `解析书架文件失败：${ent.name}` };
    }
  }

  const listedShelf = await api.list(auth, SHELF_REMOTE_DIR);
  if (listedShelf.ok) {
    for (const ent of listedShelf.entries) {
      const r = await ingestEntry(ent);
      if (!r.ok) return r;
    }
  } else if (!/404|不存在|失败/.test(listedShelf.error)) {
    return listedShelf;
  }

  saveFindBookBookshelf([...byId.values()]);
  saveSyncState(state);

  return {
    ok: true,
    stats: {
      booksUploaded: 0,
      booksSkipped: 0,
      booksDeletedRemote: 0,
      booksDownloaded,
      booksDownloadSkipped,
    },
  };
}

/** 上传找书设置（阅读 UI 子集、找书设置、替换规则、搜索历史） */
export async function uploadFindBookSettings(
  auth: WebDavAuthPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const ensure = await api.ensureLayout(auth);
  if (!ensure.ok) return ensure;
  const files = await uploadReaderBackgroundFiles(auth);
  if (!files.ok) return files;

  const filesJson: [string, string][] = [
    ["FindBook/ui-reader.json", buildUiReaderJson()],
    ["FindBook/settings.json", lsGet(FB_SETTINGS, "{}")],
    ["FindBook/replaceRules.json", lsGet(REPLACE_FB, "[]")],
    ["FindBook/searchHistory.json", lsGet(FB_SEARCH, "[]")],
  ];
  for (const [path, body] of filesJson) {
    const r = await putTextLines(auth, path, body);
    if (!r.ok) return r;
  }
  return pruneRemoteOrphanBackgroundFiles(auth);
}

/** 更新找书设置 */
export async function downloadFindBookSettings(
  auth: WebDavAuthPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };

  const tryGet = async (rel: string) => api.getText(auth, rel);

  const ui = await tryGet("FindBook/ui-reader.json");
  if (ui.ok) {
    try {
      const prevNames = uniqueCustomBackgroundFileNames(
        readerBackgroundFromLocalStorage(),
      );
      const nextBg = peekReaderBackgroundAfterUiReader(ui.text);
      const files = await downloadReaderBackgroundFiles(auth, nextBg);
      if (!files.ok) return files;
      applyUiReaderJson(ui.text);
      await deleteUnreferencedLocalBackgroundFiles(
        prevNames,
        uniqueCustomBackgroundFileNames(nextBg),
      );
      window.dispatchEvent(new Event(persistedSettingsChangedEvent));
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "应用 ui-reader 失败",
      };
    }
  }

  const settings = await tryGet("FindBook/settings.json");
  if (settings.ok) {
    try {
      JSON.parse(settings.text);
      lsSet(FB_SETTINGS, settings.text.trim() ? settings.text : "{}");
    } catch {
      return { ok: false, error: "远端 FindBook/settings.json 无效" };
    }
  }

  const rules = await tryGet("FindBook/replaceRules.json");
  if (rules.ok) {
    try {
      JSON.parse(rules.text);
      lsSet(REPLACE_FB, rules.text.trim() ? rules.text : "[]");
    } catch {
      return { ok: false, error: "远端 replaceRules.json 无效" };
    }
  }

  const hist = await tryGet("FindBook/searchHistory.json");
  if (hist.ok) {
    try {
      JSON.parse(hist.text);
      lsSet(FB_SEARCH, hist.text.trim() ? hist.text : "[]");
    } catch {
      return { ok: false, error: "远端 searchHistory.json 无效" };
    }
  }

  return { ok: true };
}

/** 上传书源库 → FindBook/bookSource.json */
export async function uploadFindBookBookSources(
  auth: WebDavAuthPayload,
): Promise<
  | { ok: true; stats: FindBookBookSourceSyncStats }
  | { ok: false; error: string }
> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };

  const listed = await window.colorTxt.bookSourceList();
  const sources: BookSourceRecord[] = [];
  for (const item of listed) {
    const source = await window.colorTxt.bookSourceGet(item.bookSourceUrl);
    if (source) sources.push(source);
  }
  if (!sources.length) {
    return { ok: false, error: "没有可上传的书源" };
  }

  const ensure = await api.ensureLayout(auth);
  if (!ensure.ok) return ensure;

  const r = await putTextLines(
    auth,
    "FindBook/bookSource.json",
    JSON.stringify(sources, null, 2),
  );
  if (!r.ok) return r;
  return {
    ok: true,
    stats: { sourceCount: sources.length, added: 0, updated: 0 },
  };
}

/** 更新书源库（合并：新增 / 更新，不删本地多出的源） */
export async function downloadFindBookBookSources(
  auth: WebDavAuthPayload,
): Promise<
  | { ok: true; stats: FindBookBookSourceSyncStats }
  | { ok: false; error: string }
> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };

  const got = await api.getText(auth, "FindBook/bookSource.json");
  if (!got.ok) return got;

  const sources = parseBookSourceJson(got.text);
  if (!sources.length) {
    return { ok: false, error: "远端书源文件无效或为空" };
  }

  const preview = await window.colorTxt.bookSourceImportPreview(sources);
  const addUrls: string[] = [];
  const updateUrls: string[] = [];
  const commitSources: BookSourceRecord[] = [];
  for (const item of preview) {
    if (item.status === "new") {
      addUrls.push(item.source.bookSourceUrl);
      commitSources.push(item.source);
    } else if (item.status === "update") {
      updateUrls.push(item.source.bookSourceUrl);
      commitSources.push(item.source);
    }
  }
  if (!addUrls.length && !updateUrls.length) {
    return {
      ok: true,
      stats: { sourceCount: sources.length, added: 0, updated: 0 },
    };
  }
  await window.colorTxt.bookSourceImportCommit(
    ipcPlain({
      addUrls,
      updateUrls,
      sources: commitSources,
    }),
  );
  return {
    ok: true,
    stats: {
      sourceCount: sources.length,
      added: addUrls.length,
      updated: updateUrls.length,
    },
  };
}
