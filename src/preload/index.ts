import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { FileFilter } from "electron";
import { EBOOK_CONVERT_DEFAULT_SUBDIR } from "@shared/ebookConvertPaths";
import type { RawSystemFontFace } from "@shared/systemFontFace";
import { CHARACTER_PORTRAIT_DEFAULT_SUBDIR } from "@shared/characterPortraitPaths";
import {
  defaultAiDataCacheRoot,
  defaultBuiltinModelCacheRoot,
} from "@shared/aiDataPaths";
import { APP_DISPLAY_NAME } from "@shared/packageDerived";
import type {
  ReaderBackgroundDeleteResult,
  ReaderBackgroundImportResult,
  ReaderBackgroundImportBytesPayload,
  ReaderBackgroundInstallFilePayload,
  ReaderBackgroundInstallFileResult,
} from "@shared/readerBackground";
import {
  EYEDROPPER_IPC,
  type EyedropperFormat,
  type EyedropperInitPayload,
  type EyedropperPointerPayload,
} from "@shared/eyedropperIpc";
import {
  STEALTH_READER_IPC,
  type StealthBounds,
  type StealthCommand,
  type StealthChapterNavDirection,
  type StealthEnterPayload,
  type StealthHoverCursor,
  type StealthOwnerChapterNavPayload,
  type StealthOwnerProgressPayload,
  type StealthPagePayload,
} from "@shared/stealthReaderIpc";
import { STEALTH_SETTINGS_IPC } from "@shared/stealthSettingsIpc";
import type {
  AIAgentRendererEvent,
  AIAgentStartPayload,
  AIChunkRecord,
  AIChatStreamPayload,
  AIConfig,
  AIIndexSearchHit,
  BookStyleInferResult,
  CharacterGoldenQuotesResult,
  PortraitExtractResult,
} from "@shared/aiTypes";
import type {
  AISmartFormatCleanupResult,
  AISmartFormatProgressEvent,
  AISmartFormatSegmentInput,
} from "@shared/aiSmartFormatTypes";
import type { BuiltinEmbeddingIpcPayload } from "@shared/builtinEmbeddingIpc";
import type {
  ColorTxtShowMessageBoxOptions,
  ColorTxtShowMessageBoxResult,
} from "@shared/colorTxtShowMessageBox";
import type {
  ColorTxtOpenDialogOptions,
  ColorTxtOpenDialogResult,
  ColorTxtSaveDialogOptions,
  ColorTxtSaveDialogResult,
} from "@shared/colorTxtOpenSaveDialog";
import {
  DICTIONARY_IPC,
  type DictionaryImportRequest,
  type DictionaryImportResponse,
  type DictionaryLookupRequest,
  type DictionaryLookupResponse,
  type DictionaryRemoveRequest,
  type DictionaryRemoveResponse,
} from "@shared/dictionaryTypes";
import type {
  AiTxt2ImgInvokeDraft,
  AiTxt2ImgInvokeResult,
} from "@shared/aiTxt2ImgIpc";
import type { VoiceReadEdgeTtsRequest } from "@shared/voiceReadEdgeIpc";
import type {
  VoiceReadCancelSynthesisPayload,
  VoiceReadHealthCheckIpcResult,
  VoiceReadHealthCheckPayload,
  VoiceReadListVoicesIpcResult,
  VoiceReadListVoicesPayload,
  VoiceReadSynthesizeIpcResult,
  VoiceReadSynthesizePayload,
} from "@shared/voiceReadSynthesisIpc";
import {
  VOICE_READ_IPC_CANCEL_SYNTHESIS,
  VOICE_READ_IPC_HEALTH_CHECK,
  VOICE_READ_IPC_LIST_VOICES,
  VOICE_READ_IPC_SYNTHESIZE,
} from "@shared/voiceReadSynthesisIpc";
import type {
  VoiceReadAttributeSpeakersRequest,
  VoiceReadAttributeSpeakersResult,
} from "@shared/voiceReadSpeakerIpc";
import { SECRET_SLOT_VOICE_READ_PROFILE_KEYS } from "@shared/secretSlots";
import { SECRET_SLOT_WEBDAV_PASSWORD } from "@shared/secretSlots";
import { SECRET_SLOT_TRANSLATION_PROVIDER_KEYS } from "@shared/secretSlots";
import {
  TRANSLATION_IPC,
  type TranslationRequest,
  type TranslationResponse,
} from "@shared/translationTypes";
import { BOOK_SOURCE_IPC } from "@shared/bookSource/ipc";
import type { BookSourceIpcApi } from "@shared/bookSource/ipc";
import { WEBDAV_IPC } from "@shared/webDavIpc";
import type {
  WebDavAuthPayload,
  WebDavDeleteResult,
  WebDavGetTextResult,
  WebDavGetToFileResult,
  WebDavListResult,
  WebDavMkdirResult,
  WebDavPutResult,
  WebDavTestResult,
  WebDavTransferProgress,
  WebDavAbortResult,
} from "@shared/webDavIpc";

/** sandbox 下 preload 不可 require('path')，与 renderer 的 joinFs 行为对齐 */
function joinUserDataSubdir(userData: string, segment: string): string {
  const base = userData.replace(/[/\\]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${segment.replace(/^[/\\]+|[/\\]+$/g, "")}`;
}

/** `app.getPath` 仅在主进程可用；preload 通过同步 IPC 向主进程取路径 */
function getPathFromMainSync(name: "userData"): string {
  try {
    const r = ipcRenderer.sendSync("app:getPathSync", name);
    return typeof r === "string" ? r.trim() : "";
  } catch {
    return "";
  }
}

/** 磁盘上被读取的文件路径（通常为 .txt） */
export type StreamStart = {
  requestId: number;
  filePath: string;
  /** 与阅读会话绑定的逻辑路径（如电子书原路径）；缺省则与 filePath 相同 */
  sessionFilePath?: string;
  encoding?: string;
  totalBytes: number;
};
export type StreamChunkPayload = {
  requestId: number;
  filePath: string;
  sessionFilePath?: string;
  text: string;
  readBytes: number;
  totalBytes: number;
};
export type StreamEnd = {
  requestId: number;
  filePath: string;
  sessionFilePath?: string;
};
export type StreamError = {
  requestId: number;
  filePath: string;
  sessionFilePath?: string;
  message: string;
};

export type DirListTxtScanPayload =
  | { phase: "start"; dirPath: string }
  | { phase: "progress"; name: string };

// Signal for quick runtime verification from renderer.
try {
  (globalThis as any).__COLORTXT_PRELOAD__ = true;
} catch {
  // ignore
}

const openTxtFromShellQueue: string[] = [];
const openTxtFromShellCbs = new Set<(filePath: string) => void>();

function flushOpenTxtFromShellQueue() {
  if (openTxtFromShellCbs.size === 0 || openTxtFromShellQueue.length === 0)
    return;
  const batch = openTxtFromShellQueue.splice(0, openTxtFromShellQueue.length);
  for (const filePath of batch) {
    for (const cb of openTxtFromShellCbs) cb(filePath);
  }
}

ipcRenderer.on("app:open-txt-path", (_e, filePath: string) => {
  openTxtFromShellQueue.push(filePath);
  flushOpenTxtFromShellQueue();
});

const api = {
  showOpenDialog: (options: ColorTxtOpenDialogOptions) =>
    ipcRenderer.invoke(
      "dialog:showOpenDialog",
      options,
    ) as Promise<ColorTxtOpenDialogResult>,
  showSaveDialog: (options: ColorTxtSaveDialogOptions) =>
    ipcRenderer.invoke(
      "dialog:showSaveDialog",
      options,
    ) as Promise<ColorTxtSaveDialogResult>,
  showMessageBox: (options: ColorTxtShowMessageBoxOptions) =>
    ipcRenderer.invoke(
      "dialog:showMessageBox",
      options,
    ) as Promise<ColorTxtShowMessageBoxResult>,
  /** 原生消息框，单钮「确定」，语义类似 `window.alert` */
  alert: (message: string) =>
    ipcRenderer
      .invoke("dialog:showMessageBox", {
        type: "info",
        title: APP_DISPLAY_NAME,
        message,
        buttons: ["确定"],
        defaultId: 0,
        noLink: true,
      } satisfies ColorTxtShowMessageBoxOptions)
      .then(() => {}),
  /** 原生消息框「取消 / 确定」，语义类似 `window.confirm`（确定为 `true`） */
  confirm: (message: string) =>
    ipcRenderer
      .invoke("dialog:showMessageBox", {
        type: "question",
        title: APP_DISPLAY_NAME,
        message,
        buttons: ["取消", "确定"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      } satisfies ColorTxtShowMessageBoxOptions)
      .then((r) => (r as ColorTxtShowMessageBoxResult).response === 1),
  voiceReadEdgeTts: (payload: VoiceReadEdgeTtsRequest) =>
    ipcRenderer.invoke("voiceRead:edgeTts", payload) as Promise<
      { ok: true; mp3: ArrayBuffer } | { ok: false; error: string }
    >,
  voiceReadSynthesize: (payload: VoiceReadSynthesizePayload) =>
    ipcRenderer.invoke(
      VOICE_READ_IPC_SYNTHESIZE,
      payload,
    ) as Promise<VoiceReadSynthesizeIpcResult>,
  voiceReadCancelSynthesis: (payload: VoiceReadCancelSynthesisPayload) =>
    ipcRenderer.invoke(VOICE_READ_IPC_CANCEL_SYNTHESIS, payload) as Promise<{
      ok: true;
    }>,
  voiceReadListVoices: (payload: VoiceReadListVoicesPayload) =>
    ipcRenderer.invoke(
      VOICE_READ_IPC_LIST_VOICES,
      payload,
    ) as Promise<VoiceReadListVoicesIpcResult>,
  voiceReadHealthCheck: (payload: VoiceReadHealthCheckPayload) =>
    ipcRenderer.invoke(
      VOICE_READ_IPC_HEALTH_CHECK,
      payload,
    ) as Promise<VoiceReadHealthCheckIpcResult>,
  voiceReadAttributeSpeakers: (payload: VoiceReadAttributeSpeakersRequest) =>
    ipcRenderer.invoke(
      "voiceRead:attributeSpeakers",
      payload,
    ) as Promise<VoiceReadAttributeSpeakersResult>,
  listTxtFilesInDirectory: (dirPath: string) =>
    ipcRenderer.invoke("dir:listTxtFiles", dirPath) as Promise<{
      dirPath: string;
      files: Array<{ name: string; path: string; size: number }>;
    }>,
  onDirListTxtScan: (cb: (payload: DirListTxtScanPayload) => void) => {
    const fn = (_: unknown, payload: DirListTxtScanPayload) => cb(payload);
    ipcRenderer.on("dir:listTxtFiles:scan", fn);
    return () => ipcRenderer.off("dir:listTxtFiles:scan", fn);
  },
  stat: (filePath: string) =>
    ipcRenderer.invoke("file:stat", filePath) as Promise<{
      size: number;
      mtimeMs: number;
      isFile: boolean;
      isDirectory: boolean;
    }>,
  getPath: (name: string) =>
    ipcRenderer.invoke("app:getPath", name) as Promise<string | null>,
  getUserDataPath: () => getPathFromMainSync("userData"),
  /** 默认电子书转 txt 输出目录：`userData/ConvertedTxt` */
  getDefaultEbookConvertOutputDir: () => {
    const ud = getPathFromMainSync("userData");
    if (!ud) return "";
    return joinUserDataSubdir(ud, EBOOK_CONVERT_DEFAULT_SUBDIR);
  },
  /** 默认角色立绘缓存根：`userData/CharacterPortrait` */
  getDefaultCharacterPortraitCacheDir: () => {
    const ud = getPathFromMainSync("userData");
    if (!ud) return "";
    return joinUserDataSubdir(ud, CHARACTER_PORTRAIT_DEFAULT_SUBDIR);
  },
  getDefaultAiDataCacheDir: () => {
    const ud = getPathFromMainSync("userData");
    if (!ud) return "";
    return defaultAiDataCacheRoot(ud);
  },
  getDefaultBuiltinModelCacheDir: () => {
    const ud = getPathFromMainSync("userData");
    if (!ud) return "";
    return defaultBuiltinModelCacheRoot(ud);
  },

  secrets: {
    isEncryptionAvailable: () =>
      ipcRenderer.invoke("secrets:isEncryptionAvailable") as Promise<{
        ok: true;
        available: boolean;
        backend: "safeStorage" | "appBound" | "unavailable";
      }>,
    getDeprecated: (slot: string) =>
      ipcRenderer.invoke("secrets:getDeprecated", slot) as Promise<
        { ok: true; value: string } | { ok: false; error: string }
      >,
    getVoiceReadProfileKeys: () =>
      ipcRenderer
        .invoke("secrets:get", SECRET_SLOT_VOICE_READ_PROFILE_KEYS)
        .then(
          (res: { ok: boolean; value?: string }) =>
            ({
              ok: true as const,
              keys: res.ok ? (res.value ?? "") : "",
            }) as const,
        ),
    setVoiceReadProfileKeys: (keysBlob: string) =>
      ipcRenderer.invoke("secrets:set", {
        slot: SECRET_SLOT_VOICE_READ_PROFILE_KEYS,
        value: keysBlob,
      }) as Promise<{ ok: true }>,
    setVoiceReadSecrets: (payload: { profileKeys: string }) =>
      ipcRenderer.invoke(
        "secrets:setVoiceReadSecrets",
        payload,
      ) as Promise<{ ok: true } | { ok: false; error: string }>,
    getWebDavPassword: () =>
      ipcRenderer.invoke("secrets:get", SECRET_SLOT_WEBDAV_PASSWORD).then(
        (res: { ok: boolean; value?: string }) =>
          ({
            ok: true as const,
            password: res.ok ? (res.value ?? "") : "",
          }) as const,
      ),
    setWebDavPassword: (password: string) =>
      ipcRenderer.invoke(
        "secrets:setWebDavPassword",
        password,
      ) as Promise<{ ok: true }>,
    getTranslationProviderKeys: () =>
      ipcRenderer
        .invoke("secrets:get", SECRET_SLOT_TRANSLATION_PROVIDER_KEYS)
        .then(
          (res: { ok: boolean; value?: string }) =>
            ({
              ok: true as const,
              keys: res.ok ? (res.value ?? "") : "",
            }) as const,
        ),
    setTranslationSecrets: (payload: { providerKeys: string }) =>
      ipcRenderer.invoke(
        "secrets:setTranslationSecrets",
        payload,
      ) as Promise<{ ok: true } | { ok: false; error: string }>,
  },
  webdav: {
    test: (auth: WebDavAuthPayload) =>
      ipcRenderer.invoke(WEBDAV_IPC.test, auth) as Promise<WebDavTestResult>,
    ensureLayout: (auth: WebDavAuthPayload) =>
      ipcRenderer.invoke(WEBDAV_IPC.ensureLayout, auth) as Promise<
        WebDavTestResult & { appRoot?: string }
      >,
    list: (auth: WebDavAuthPayload, relativePath: string) =>
      ipcRenderer.invoke(WEBDAV_IPC.list, {
        auth,
        relativePath,
      }) as Promise<WebDavListResult>,
    getText: (auth: WebDavAuthPayload, relativePath: string) =>
      ipcRenderer.invoke(WEBDAV_IPC.getText, {
        auth,
        relativePath,
      }) as Promise<WebDavGetTextResult>,
    getToFile: (
      auth: WebDavAuthPayload,
      relativePath: string,
      fileName?: string,
      requestId?: string,
    ) =>
      ipcRenderer.invoke(WEBDAV_IPC.getToFile, {
        auth,
        relativePath,
        fileName,
        requestId,
      }) as Promise<WebDavGetToFileResult>,
    putText: (
      auth: WebDavAuthPayload,
      relativePath: string,
      text: string,
      contentType?: string,
    ) =>
      ipcRenderer.invoke(WEBDAV_IPC.putText, {
        auth,
        relativePath,
        text,
        contentType,
      }) as Promise<WebDavPutResult>,
    putFile: (
      auth: WebDavAuthPayload,
      relativePath: string,
      localPath: string,
      contentType?: string,
      requestId?: string,
    ) =>
      ipcRenderer.invoke(WEBDAV_IPC.putFile, {
        auth,
        relativePath,
        localPath,
        contentType,
        requestId,
      }) as Promise<WebDavPutResult>,
    mkdir: (auth: WebDavAuthPayload, relativePath: string) =>
      ipcRenderer.invoke(WEBDAV_IPC.mkdir, {
        auth,
        relativePath,
      }) as Promise<WebDavMkdirResult>,
    delete: (auth: WebDavAuthPayload, relativePath: string) =>
      ipcRenderer.invoke(WEBDAV_IPC.delete, {
        auth,
        relativePath,
      }) as Promise<WebDavDeleteResult>,
    onTransferProgress: (
      cb: (payload: WebDavTransferProgress) => void,
    ): (() => void) => {
      const fn = (
        _e: Electron.IpcRendererEvent,
        payload: WebDavTransferProgress,
      ) => {
        cb(payload);
      };
      ipcRenderer.on(WEBDAV_IPC.transferProgress, fn);
      return () => ipcRenderer.off(WEBDAV_IPC.transferProgress, fn);
    },
    abortTransfer: (requestId: string) =>
      ipcRenderer.invoke(
        WEBDAV_IPC.abortTransfer,
        requestId,
      ) as Promise<WebDavAbortResult>,
  },
  pathToFileUrl: (filePath: string) =>
    ipcRenderer.invoke("path:toFileUrl", filePath) as Promise<string | null>,
  /**
   * 用于 `<img src>` / 灯箱：短 URL `colortxt-local://resource/{uuid}`，避免整段路径过长导致不发起请求。
   */
  pathToReadableLocalUrl: (filePath: string) =>
    ipcRenderer.invoke("colortxtLocal:registerPath", filePath) as Promise<
      string | null
    >,
  readFileAsArrayBuffer: async (filePath: string) => {
    const data = (await ipcRenderer.invoke(
      "file:readFileAsBuffer",
      filePath,
    )) as ArrayBuffer | Uint8Array;
    if (data instanceof ArrayBuffer) return data;
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
  },
  writeUtf8File: (filePath: string, utf8: string) =>
    ipcRenderer.invoke("file:writeUtf8File", filePath, utf8) as Promise<{
      ok: true;
    }>,
  readWholeTextFile: (filePath: string) =>
    ipcRenderer.invoke("file:readWholeTextFile", filePath) as Promise<
      | { ok: true; text: string; encoding: string }
      | { ok: false; message: string }
    >,
  writeTextFile: (filePath: string, content: string, encoding: string) =>
    ipcRenderer.invoke(
      "file:writeTextFile",
      filePath,
      content,
      encoding,
    ) as Promise<{ ok: true } | { ok: false; message: string }>,
  writeBinaryFile: (filePath: string, base64: string) =>
    ipcRenderer.invoke("file:writeBinaryFile", filePath, base64) as Promise<{
      ok: true;
    }>,
  emptyDir: (dirPath: string) =>
    ipcRenderer.invoke("fs:emptyDir", dirPath) as Promise<{ ok: true }>,
  removePath: (targetPath: string) =>
    ipcRenderer.invoke("fs:removePath", targetPath) as Promise<{ ok: true }>,
  mkdir: (dirPath: string) =>
    ipcRenderer.invoke("fs:mkdir", dirPath) as Promise<{ ok: true }>,
  listFilesRecursive: (dirPath: string) =>
    ipcRenderer.invoke("fs:listFilesRecursive", dirPath) as Promise<{
      ok: true;
      files: string[];
    }>,
  renamePath: (fromPath: string, toPath: string) =>
    ipcRenderer.invoke("fs:renamePath", fromPath, toPath) as Promise<
      | { ok: true; path: string; size: number }
      | { ok: false; message: string; code?: string }
    >,
  characterPortrait: {
    migrateCacheRoot: (payload: { from: string; to: string }) =>
      ipcRenderer.invoke(
        "characterPortrait:migrateCacheRoot",
        payload,
      ) as Promise<{ ok: true } | { ok: false; error: string }>,
    copyFileTo: (payload: { from: string; to: string }) =>
      ipcRenderer.invoke("characterPortrait:copyFileTo", payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
  readerBackground: {
    importFromPath: (sourcePath: string) =>
      ipcRenderer.invoke(
        "readerBackground:importFromPath",
        sourcePath,
      ) as Promise<ReaderBackgroundImportResult>,
    importFromBytes: (payload: ReaderBackgroundImportBytesPayload) =>
      ipcRenderer.invoke(
        "readerBackground:importFromBytes",
        payload,
      ) as Promise<ReaderBackgroundImportResult>,
    installFile: (payload: ReaderBackgroundInstallFilePayload) =>
      ipcRenderer.invoke(
        "readerBackground:installFile",
        payload,
      ) as Promise<ReaderBackgroundInstallFileResult>,
    deleteFile: (fileName: string) =>
      ipcRenderer.invoke(
        "readerBackground:deleteFile",
        fileName,
      ) as Promise<ReaderBackgroundDeleteResult>,
  },
  /** 全屏取色：冻结截屏 + 覆盖层；取消或失败返回 `null` */
  eyedropperPick: () =>
    ipcRenderer.invoke(EYEDROPPER_IPC.pick) as Promise<string | null>,
  stealthReaderEnter: (payload: StealthEnterPayload) =>
    ipcRenderer.invoke(STEALTH_READER_IPC.enter, payload) as Promise<{
      ok: boolean;
      message?: string;
    }>,
  stealthReaderGetPayload: () =>
    ipcRenderer.invoke(STEALTH_READER_IPC.getPayload) as Promise<StealthPagePayload | null>,
  stealthReaderUpdatePayload: (payload: StealthPagePayload) =>
    ipcRenderer.invoke(STEALTH_READER_IPC.updatePayload, payload) as Promise<{
      ok: boolean;
      message?: string;
    }>,
  stealthReaderGetPendingPayload: () =>
    ipcRenderer.invoke(
      STEALTH_READER_IPC.getPendingPayload,
    ) as Promise<StealthPagePayload | null>,
  stealthReaderOwnerChapterNav: (
    direction: StealthChapterNavDirection,
    anchor?: "start" | "end",
  ) =>
    ipcRenderer.send(STEALTH_READER_IPC.ownerChapterNav, {
      direction,
      anchor: anchor === "end" ? "end" : "start",
    }),
  stealthReaderChapterNavSettled: () =>
    ipcRenderer.send(STEALTH_READER_IPC.chapterNavSettled),
  stealthReaderExit: (line: number) =>
    ipcRenderer.send(STEALTH_READER_IPC.exit, line),
  stealthReaderPopupMenu: (opts?: { timedScrollActive?: boolean }) =>
    ipcRenderer.send(STEALTH_READER_IPC.popupMenu, {
      timedScrollActive: opts?.timedScrollActive === true,
    }),
  stealthReaderSetNavShortcuts: (shortcuts: Record<string, string>) =>
    ipcRenderer.send(STEALTH_READER_IPC.setNavShortcuts, shortcuts),
  openStealthSettingsWindow: () =>
    ipcRenderer.invoke(STEALTH_SETTINGS_IPC.open) as Promise<void>,
  closeStealthSettingsWindow: () =>
    ipcRenderer.invoke(STEALTH_SETTINGS_IPC.close) as Promise<void>,
  stealthReaderGetBounds: () =>
    ipcRenderer.invoke(STEALTH_READER_IPC.getBounds) as Promise<StealthBounds | null>,
  /** 与 BrowserWindow.getBounds 同为 DIP；经主进程读取（沙箱 preload 无 screen） */
  stealthReaderGetCursorScreenPoint: () =>
    ipcRenderer.sendSync(STEALTH_READER_IPC.getCursorScreenPoint) as {
      x: number;
      y: number;
    },
  stealthReaderSetBounds: (bounds: StealthBounds) =>
    ipcRenderer.send(STEALTH_READER_IPC.setBounds, bounds),
  stealthReaderSetPosition: (x: number, y: number) =>
    ipcRenderer.send(STEALTH_READER_IPC.setPosition, x, y),
  stealthReaderSetMinSize: (width: number, height: number) =>
    ipcRenderer.send(STEALTH_READER_IPC.setMinSize, width, height),
  /** macOS 摸鱼窗边缘：CSS cursor 不生效，改由主进程设系统光标（同步，避免离开窗口后改写别的光标） */
  stealthReaderSetHoverCursor: (cursor: StealthHoverCursor) => {
    ipcRenderer.sendSync(STEALTH_READER_IPC.setHoverCursor, cursor);
  },
  stealthReaderBlur: () => ipcRenderer.send(STEALTH_READER_IPC.blur),
  /** 重申摸鱼窗透明（不改尺寸）；`nudge` 时水平微移逼 DWM 重绘 */
  stealthReaderRefreshTransparency(nudge?: boolean): void {
    ipcRenderer.send(
      STEALTH_READER_IPC.refreshTransparency,
      nudge === true,
    );
  },
  stealthReaderPrepareEyedropper: () =>
    ipcRenderer.invoke(STEALTH_READER_IPC.prepareEyedropper) as Promise<void>,
  stealthReaderRestoreEyedropper: () =>
    ipcRenderer.invoke(STEALTH_READER_IPC.restoreEyedropper) as Promise<void>,
  onStealthReaderCommand: (
    cb: (command: StealthCommand, extra: string) => void,
  ) => {
    const fn = (_: unknown, command: StealthCommand, extra: string) =>
      cb(command, extra ?? "");
    ipcRenderer.on(STEALTH_READER_IPC.command, fn);
    return () => ipcRenderer.off(STEALTH_READER_IPC.command, fn);
  },
  onStealthReaderMenuOpen: (cb: (open: boolean) => void) => {
    const fn = (_: unknown, open: boolean) => cb(Boolean(open));
    ipcRenderer.on(STEALTH_READER_IPC.menuOpen, fn);
    return () => ipcRenderer.off(STEALTH_READER_IPC.menuOpen, fn);
  },
  onStealthOwnerProgress: (cb: (payload: StealthOwnerProgressPayload) => void) => {
    const fn = (_: unknown, payload: StealthOwnerProgressPayload) => cb(payload);
    ipcRenderer.on(STEALTH_READER_IPC.ownerProgress, fn);
    return () => ipcRenderer.off(STEALTH_READER_IPC.ownerProgress, fn);
  },
  onStealthOwnerChapterNav: (
    cb: (payload: StealthOwnerChapterNavPayload) => void,
  ) => {
    const fn = (_: unknown, payload: StealthOwnerChapterNavPayload) =>
      cb(payload);
    ipcRenderer.on(STEALTH_READER_IPC.ownerChapterNav, fn);
    return () => ipcRenderer.off(STEALTH_READER_IPC.ownerChapterNav, fn);
  },
  eyedropperOnInit: (cb: (payload: EyedropperInitPayload) => void) => {
    const fn = (_: unknown, payload: EyedropperInitPayload) => cb(payload);
    ipcRenderer.on(EYEDROPPER_IPC.init, fn);
    return () => ipcRenderer.off(EYEDROPPER_IPC.init, fn);
  },
  eyedropperReady: () => ipcRenderer.send(EYEDROPPER_IPC.ready),
  eyedropperSubmit: (hex: string) =>
    ipcRenderer.send(EYEDROPPER_IPC.submit, hex),
  eyedropperCancel: () => ipcRenderer.send(EYEDROPPER_IPC.cancel),
  eyedropperCopy: () => ipcRenderer.send(EYEDROPPER_IPC.copy),
  eyedropperSample: (text: string) =>
    ipcRenderer.send(EYEDROPPER_IPC.sample, text),
  eyedropperOnCopied: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on(EYEDROPPER_IPC.copied, fn);
    return () => ipcRenderer.off(EYEDROPPER_IPC.copied, fn);
  },
  eyedropperToggleFormat: () => ipcRenderer.send(EYEDROPPER_IPC.toggleFormat),
  eyedropperOnFormat: (cb: (format: EyedropperFormat) => void) => {
    const fn = (_: unknown, format: EyedropperFormat) => cb(format);
    ipcRenderer.on(EYEDROPPER_IPC.format, fn);
    return () => ipcRenderer.off(EYEDROPPER_IPC.format, fn);
  },
  eyedropperOnPointer: (cb: (payload: EyedropperPointerPayload) => void) => {
    const fn = (_: unknown, payload: EyedropperPointerPayload) => cb(payload);
    ipcRenderer.on(EYEDROPPER_IPC.pointer, fn);
    return () => ipcRenderer.off(EYEDROPPER_IPC.pointer, fn);
  },
  eyedropperHover: () => ipcRenderer.send(EYEDROPPER_IPC.hover),
  eyedropperOnInactive: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on(EYEDROPPER_IPC.inactive, fn);
    return () => ipcRenderer.off(EYEDROPPER_IPC.inactive, fn);
  },
  streamFile: (filePath: string, options?: { sessionFilePath?: string }) =>
    ipcRenderer.send("file:stream", {
      physicalPath: filePath,
      sessionFilePath: options?.sessionFilePath,
    }),
  /** 由主进程 `fs.watch` 监控磁盘文件；传 `null` 停止 */
  watchCurrentFile: (filePath: string | null) =>
    ipcRenderer.invoke("file:watchCurrent", filePath) as Promise<void>,
  onCurrentFileDiskChanged: (
    cb: (payload: { path: string; mtimeMs: number }) => void,
  ) => {
    const fn = (_: unknown, payload: { path: string; mtimeMs: number }) =>
      cb(payload);
    ipcRenderer.on("file:disk-changed", fn);
    return () => ipcRenderer.off("file:disk-changed", fn);
  },
  setWindowTitle: (title: string) => ipcRenderer.send("window:setTitle", title),
  setFullscreen: (value: boolean) =>
    ipcRenderer.invoke("window:setFullscreen", value) as Promise<boolean>,
  getWindowContentBounds: () =>
    ipcRenderer.invoke("window:getContentBounds") as Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>,
  shouldRestoreSession: () =>
    ipcRenderer.invoke("window:shouldRestoreSession") as Promise<boolean>,
  /** 首屏用：本窗口是否会加载文件（新窗口为 false；首启恢复 / 打开方式为 true） */
  getInitialWindowLoadIntent: () =>
    ipcRenderer.sendSync("window:getInitialLoadIntent") as {
      shouldRestoreSession: boolean;
      hasPendingOpenTxt: boolean;
      isFindBookWindow: boolean;
    },
  /** 安装包关联 / 命令行启动时由主进程写入，仅可取一次 */
  consumePendingOpenTxtPath: () =>
    ipcRenderer.invoke("window:consumePendingOpenTxtPath") as Promise<
      string | null
    >,
  onOpenTxtFromShell: (cb: (filePath: string) => void) => {
    openTxtFromShellCbs.add(cb);
    flushOpenTxtFromShellQueue();
    return () => {
      openTxtFromShellCbs.delete(cb);
    };
  },
  setNativeTheme: (theme: string) => ipcRenderer.send("theme:set", theme),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  listSystemFonts: (opts?: { force?: boolean }) =>
    ipcRenderer.invoke("fonts:listSystemFonts", opts) as Promise<
      RawSystemFontFace[]
    >,
  /** 把绝对路径重新注册为 colortxt-local URL（启动恢复字重 pin 用） */
  registerFontFilePaths: (paths: string[]) =>
    ipcRenderer.invoke("fonts:registerFontFilePaths", paths) as Promise<
      Record<string, string>
    >,
  /** 解析当前用户终端默认字体族名（Windows Terminal / 控制台 FaceName / 平台回退）。 */
  getTerminalDefaultFontFace: () =>
    ipcRenderer.invoke("fonts:getTerminalDefaultFace") as Promise<string | null>,
  convertTextOpenCc: (text: string, config: string) =>
    ipcRenderer.invoke("text-convert:opencc", {
      text,
      config,
    }) as Promise<string>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("shell:openExternal", url) as Promise<void>,
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke("shell:showItemInFolder", filePath) as Promise<void>,
  openPath: (dirPath: string) =>
    ipcRenderer.invoke("shell:openPath", dirPath) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  openNewWindow: () => {
    ipcRenderer.send("window:new");
  },
  openFindBookWindow: () => {
    ipcRenderer.send("window:openFindBook");
  },
  /** 始终新建找书窗（默认「书架」标签） */
  openNewFindBookWindow: () => {
    ipcRenderer.send("window:newFindBook");
  },
  createFindBookDesktopShortcut: () =>
    ipcRenderer.invoke("findBook:createDesktopShortcut") as Promise<
      { ok: true; shortcutPath: string } | { ok: false; error: string }
    >,
  /** Windows / Linux 可创建桌面快捷方式；macOS 为 false */
  supportsFindBookDesktopShortcut:
    process.platform === "win32" || process.platform === "linux",
  onFindBookActivateTab: (cb: (tab: string) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, tab: string) => {
      cb(tab);
    };
    ipcRenderer.on("findBook:activateTab", fn);
    return () => ipcRenderer.removeListener("findBook:activateTab", fn);
  },
  focusOrOpenMainWindow: () =>
    ipcRenderer.invoke("window:focusOrOpenMain") as Promise<void>,
  openFileInMainWindow: (filePath: string) =>
    ipcRenderer.invoke("window:openFileInMain", filePath) as Promise<void>,
  openFileInNewWindow: (filePath: string) => {
    ipcRenderer.send("window:new", filePath);
  },
  toggleDevTools: () =>
    ipcRenderer.invoke("window:toggleDevTools") as Promise<void>,
  getGlobalShortcut: () =>
    ipcRenderer.invoke("shortcut:getGlobalToggle") as Promise<string>,
  validateGlobalShortcut: (accelerator: string) =>
    ipcRenderer.invoke(
      "shortcut:validateGlobalToggle",
      accelerator,
    ) as Promise<{
      ok: boolean;
      message?: string;
    }>,
  setGlobalShortcut: (accelerator: string) =>
    ipcRenderer.invoke("shortcut:setGlobalToggle", accelerator) as Promise<{
      ok: boolean;
      message?: string;
    }>,
  suspendGlobalShortcutsForRecording: () =>
    ipcRenderer.invoke("shortcut:suspendForRecording") as Promise<void>,
  resumeGlobalShortcutsAfterRecording: () =>
    ipcRenderer.invoke("shortcut:resumeAfterRecording") as Promise<void>,
  quitApp: () => {
    ipcRenderer.send("app:quit");
  },
  onWindowRequestClose: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("window:requestClose", fn);
    return () => ipcRenderer.off("window:requestClose", fn);
  },
  proceedCloseWindow: () => {
    ipcRenderer.send("window:proceedClose");
  },
  onStreamStart: (cb: (payload: StreamStart) => void) => {
    const fn = (_: unknown, payload: StreamStart) => cb(payload);
    ipcRenderer.on("file:stream-start", fn);
    return () => ipcRenderer.off("file:stream-start", fn);
  },
  onStreamChunk: (cb: (payload: StreamChunkPayload) => void) => {
    const fn = (_: unknown, payload: StreamChunkPayload) => cb(payload);
    ipcRenderer.on("file:stream-chunk", fn);
    return () => ipcRenderer.off("file:stream-chunk", fn);
  },
  onStreamEnd: (cb: (payload: StreamEnd) => void) => {
    const fn = (_: unknown, payload: StreamEnd) => cb(payload);
    ipcRenderer.on("file:stream-end", fn);
    return () => ipcRenderer.off("file:stream-end", fn);
  },
  onStreamError: (cb: (payload: StreamError) => void) => {
    const fn = (_: unknown, payload: StreamError) => cb(payload);
    ipcRenderer.on("file:stream-error", fn);
    return () => ipcRenderer.off("file:stream-error", fn);
  },
  onFullscreenChanged: (cb: (payload: { isFullscreen: boolean }) => void) => {
    const fn = (_: unknown, payload: { isFullscreen: boolean }) => cb(payload);
    ipcRenderer.on("window:fullscreen-changed", fn);
    return () => ipcRenderer.off("window:fullscreen-changed", fn);
  },
  onThemeSync: (cb: (theme: string) => void) => {
    const fn = (_: unknown, theme: string) => cb(theme);
    ipcRenderer.on("theme:sync", fn);
    return () => ipcRenderer.off("theme:sync", fn);
  },
  isPackaged: () => ipcRenderer.invoke("app:isPackaged") as Promise<boolean>,
  isWindowsPortable: () =>
    ipcRenderer.invoke("app:isWindowsPortable") as Promise<boolean>,
  checkForUpdates: () =>
    ipcRenderer.invoke("updater:check") as Promise<
      { skipped: true } | { ok: true } | { ok: false; message: string }
    >,
  downloadUpdate: () =>
    ipcRenderer.invoke("updater:download") as Promise<
      { skipped: true } | { ok: true } | { ok: false; message: string }
    >,
  quitAndInstall: () =>
    ipcRenderer.invoke("updater:quitAndInstall") as Promise<boolean>,
  onUpdaterUpdateAvailable: (cb: (payload: { version: string }) => void) => {
    const fn = (_: unknown, payload: { version: string }) => cb(payload);
    ipcRenderer.on("updater:update-available", fn);
    return () => ipcRenderer.off("updater:update-available", fn);
  },
  onUpdaterUpdateNotAvailable: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("updater:update-not-available", fn);
    return () => ipcRenderer.off("updater:update-not-available", fn);
  },
  onUpdaterError: (cb: (payload: { message: string }) => void) => {
    const fn = (_: unknown, payload: { message: string }) => cb(payload);
    ipcRenderer.on("updater:error", fn);
    return () => ipcRenderer.off("updater:error", fn);
  },
  onUpdaterDownloadProgress: (
    cb: (payload: {
      percent: number;
      transferred: number;
      total: number;
    }) => void,
  ) => {
    const fn = (
      _: unknown,
      payload: { percent: number; transferred: number; total: number },
    ) => cb(payload);
    ipcRenderer.on("updater:download-progress", fn);
    return () => ipcRenderer.off("updater:download-progress", fn);
  },
  onUpdaterUpdateDownloaded: (cb: (payload: { version: string }) => void) => {
    const fn = (_: unknown, payload: { version: string }) => cb(payload);
    ipcRenderer.on("updater:update-downloaded", fn);
    return () => ipcRenderer.off("updater:update-downloaded", fn);
  },

  ai: {
    configGet: () => ipcRenderer.invoke("ai:config:get") as Promise<AIConfig>,
    configSet: (cfg: AIConfig) =>
      ipcRenderer.invoke(
        "ai:config:set",
        JSON.parse(JSON.stringify(cfg)) as AIConfig,
      ) as Promise<{ ok: true } | { ok: false; error: string }>,
    embed: (texts: string[], requestId?: number) =>
      ipcRenderer.invoke(
        "ai:embedding:embed",
        texts,
        requestId ?? null,
      ) as Promise<number[][]>,
    embedAbort: (requestId: number) =>
      ipcRenderer.invoke("ai:embedding:abort", requestId) as Promise<{
        ok: true;
      }>,
    indexHasBook: (bookHash: string) =>
      ipcRenderer.invoke("ai:index:hasBook", bookHash) as Promise<boolean>,
    indexDeleteBook: (bookHash: string) =>
      ipcRenderer.invoke("ai:index:deleteBook", bookHash) as Promise<{
        ok: boolean;
      }>,
    indexDeleteAll: () =>
      ipcRenderer.invoke("ai:index:deleteAll") as Promise<{ ok: boolean }>,
    segmentDeleteBook: (bookHash: string) =>
      ipcRenderer.invoke("ai:segment:deleteBook", bookHash) as Promise<{
        ok: boolean;
      }>,
    segmentRebuildBook: (payload: { bookHash: string; chapterCount: number }) =>
      ipcRenderer.invoke("ai:segment:rebuildBook", payload) as Promise<
        { ok: true; chaptersBuilt: number } | { ok: false; error: string }
      >,
    /** 高亮词侧栏 AI 检索（semantic 词云管线；全书、默认不截断词项上限） */
    wordcloudRun: (payload: {
      bookHash: string;
      chapterCount: number;
      semanticQuery: string;
      title?: string;
      /** 默认 true：返回全部已计数词项 */
      unlimitedTerms?: boolean;
      /** 与 wordcloudAbort 配对，供 Esc 中止 */
      requestId?: number;
    }) =>
      ipcRenderer.invoke("ai:wordcloud:run", payload) as Promise<
        | { ok: true; result: import("@shared/aiTypes").AIWordcloudToolResult }
        | { ok: false; error: string; aborted?: boolean }
      >,
    wordcloudAbort: (requestId: number) =>
      ipcRenderer.invoke("ai:wordcloud:abort", requestId) as Promise<{
        ok: true;
      }>,
    indexReplaceChunks: (bookHash: string, chunks: AIChunkRecord[]) =>
      ipcRenderer.invoke(
        "ai:index:replaceChunks",
        bookHash,
        chunks,
      ) as Promise<{ ok: boolean; error?: string }>,
    indexSearch: (args: {
      bookHash: string;
      queryEmbedding: number[];
      topK?: number;
    }) =>
      ipcRenderer.invoke("ai:index:search", args) as Promise<
        AIIndexSearchHit[] | { error: string }
      >,
    chatStart: (payload: AIChatStreamPayload) =>
      ipcRenderer.invoke(
        "ai:chat:start",
        JSON.parse(JSON.stringify(payload)) as AIChatStreamPayload,
      ) as Promise<{ ok: true } | { ok: false; error?: string }>,
    agentStart: (payload: AIAgentStartPayload) =>
      ipcRenderer.invoke(
        "ai:agent:start",
        JSON.parse(JSON.stringify(payload)) as AIAgentStartPayload,
      ) as Promise<{ ok: true } | { ok: false; error?: string }>,
    chatAbort: (requestId: number) =>
      ipcRenderer.invoke("ai:chat:abort", requestId) as Promise<{ ok: true }>,
    textFormatCleanup: (payload: {
      requestId: number;
      segment: AISmartFormatSegmentInput;
      mergeHardWrap: boolean;
      fixPunctuation: boolean;
      unifyDialogueQuotes: import("@shared/aiSmartFormatTypes").AiSmartFormatUnifyDialogueQuotes;
      removePromotionalContent: boolean;
      removePiracyWatermarks: boolean;
      restoreGarbledChars: boolean;
      restoreAsteriskMasks: boolean;
      cleanHtmlRemnants?: boolean;
      skillPrompt?: string;
    }) =>
      ipcRenderer.invoke("ai:text-format:cleanup", payload) as Promise<
        | { ok: true; result: AISmartFormatCleanupResult }
        | { ok: false; error: string }
      >,
    textFormatAbort: (requestId: number) =>
      ipcRenderer.invoke("ai:text-format:abort", requestId) as Promise<{
        ok: true;
      }>,
    modelsList: (draft: {
      baseUrl?: string;
      apiKey?: string;
      provider?: "remote" | "builtin";
    }) =>
      ipcRenderer.invoke("ai:models:list", draft) as Promise<
        { ok: true; models: string[] } | { ok: false; error: string }
      >,
    txt2imgInvoke: (draft: AiTxt2ImgInvokeDraft) =>
      ipcRenderer.invoke("ai:txt2img", draft) as Promise<AiTxt2ImgInvokeResult>,
    testChat: (draft: Record<string, unknown>) =>
      ipcRenderer.invoke("ai:test:chat", draft) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    testEmbedding: (draft: Record<string, unknown>) =>
      ipcRenderer.invoke("ai:test:embedding", draft) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    embeddingProbeDimension: (draft: {
      baseUrl?: string;
      apiKey?: string;
      remoteModel?: string;
      builtinModel?: string;
      /** @deprecated 旧版单一 model 字段 */
      model?: string;
      provider?: "remote" | "builtin";
    }) =>
      ipcRenderer.invoke("ai:embedding:probeDimension", draft) as Promise<
        { ok: true; dimension: number } | { ok: false; error: string }
      >,
    migrateDataCacheRoot: (payload: { from: string; to: string }) =>
      ipcRenderer.invoke("ai:migrateDataCacheRoot", payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    migrateBuiltinModelCacheRoot: (payload: { from: string; to: string }) =>
      ipcRenderer.invoke("ai:migrateBuiltinModelCacheRoot", payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    openAiDataCacheDir: (dir?: string) =>
      ipcRenderer.invoke("ai:paths:openDataCacheDir", dir ?? "") as Promise<void>,
    openBuiltinModelCacheDir: (dir: string, config: AIConfig) =>
      ipcRenderer.invoke(
        "ai:paths:openModelCacheDir",
        dir,
        JSON.parse(JSON.stringify(config)) as AIConfig,
      ) as Promise<void>,
    embeddingBuiltinList: () =>
      ipcRenderer.invoke("ai:embedding:builtin:list") as Promise<{
        ok: true;
        models: import("@shared/builtinEmbeddingModels").BuiltinEmbeddingModel[];
      }>,
    embeddingBuiltinStatus: () =>
      ipcRenderer.invoke("ai:embedding:builtin:status") as Promise<{
        ok: true;
        loadedModelId: string | null;
        loaded: boolean;
      }>,
    embeddingBuiltinIsCached: (payload: BuiltinEmbeddingIpcPayload) =>
      ipcRenderer.invoke(
        "ai:embedding:builtin:isCached",
        JSON.parse(JSON.stringify(payload)) as BuiltinEmbeddingIpcPayload,
      ) as Promise<
        { ok: true; cached: boolean } | { ok: false; error: string }
      >,
    embeddingBuiltinLoad: (payload: BuiltinEmbeddingIpcPayload) =>
      ipcRenderer.invoke(
        "ai:embedding:builtin:load",
        JSON.parse(JSON.stringify(payload)) as BuiltinEmbeddingIpcPayload,
      ) as Promise<
        { ok: true } | { ok: false; error: string; code?: string }
      >,
    embeddingBuiltinClearCache: (payload: BuiltinEmbeddingIpcPayload) =>
      ipcRenderer.invoke(
        "ai:embedding:builtin:clearCache",
        JSON.parse(JSON.stringify(payload)) as BuiltinEmbeddingIpcPayload,
      ) as Promise<{ ok: true } | { ok: false; error: string }>,
    onEmbeddingLoadProgress: (
      cb: (payload: { modelId: string; progress: number }) => void,
    ) => {
      const fn = (
        _: unknown,
        payload: { modelId: string; progress: number },
      ) => cb(payload);
      ipcRenderer.on("ai:embedding:loadProgress", fn);
      return () => ipcRenderer.off("ai:embedding:loadProgress", fn);
    },
    threadList: (bookHash: string) =>
      ipcRenderer.invoke("ai:thread:list", bookHash) as Promise<
        Array<{
          id: string;
          bookHash: string;
          title: string;
          createdAt: number;
          updatedAt: number;
          titleLocked: number;
        }>
      >,
    threadCreate: (bookHash: string, title?: string) =>
      ipcRenderer.invoke(
        "ai:thread:create",
        bookHash,
        title,
      ) as Promise<string>,
    threadRename: (threadId: string, title: string, userChosen?: boolean) =>
      ipcRenderer.invoke(
        "ai:thread:rename",
        threadId,
        title,
        userChosen === true,
      ) as Promise<void>,
    threadDelete: (threadId: string) =>
      ipcRenderer.invoke("ai:thread:delete", threadId) as Promise<void>,
    threadDeleteAll: () =>
      ipcRenderer.invoke("ai:thread:deleteAll") as Promise<void>,
    threadDeleteEmptyForBook: (
      bookHash: string,
      exceptThreadId?: string | null,
    ) =>
      ipcRenderer.invoke(
        "ai:thread:deleteEmptyForBook",
        bookHash,
        exceptThreadId ?? undefined,
      ) as Promise<void>,
    messageList: (threadId: string) =>
      ipcRenderer.invoke("ai:message:list", threadId) as Promise<
        Array<{
          id: string;
          threadId: string;
          role: string;
          content: string;
          createdAt: number;
          aborted: boolean;
          toolCallId?: string | null;
          toolName?: string | null;
          toolCallsJson?: string | null;
          payload?: string | null;
        }>
      >,
    messageAppend: (
      threadId: string,
      role: "user" | "assistant" | "system",
      content: string,
      aborted?: boolean,
    ) =>
      ipcRenderer.invoke(
        "ai:message:append",
        threadId,
        role,
        content,
        aborted,
      ) as Promise<string>,
    messageUpdateToolContent: (
      threadId: string,
      toolCallId: string,
      content: string,
    ) =>
      ipcRenderer.invoke(
        "ai:message:updateToolContent",
        threadId,
        toolCallId,
        content,
      ) as Promise<boolean>,
    exportSave: (payload: {
      defaultName: string;
      data: string;
      filters?: FileFilter[];
      /** 完整默认路径（目录+文件名），绝对路径时用作对话框初始位置 */
      defaultPath?: string;
    }) =>
      ipcRenderer.invoke("ai:export:save", payload) as Promise<
        | { ok: true; path: string }
        | { ok: false; cancelled: true }
        | { ok: false; error: string }
      >,
    portraitExtract: (payload: {
      bookHash: string;
      characterName: string;
      characterAliases?: string;
      spoilerSafe?: boolean;
      activeChapterIdx?: number;
      /** 与 portraitInferBookStyle、portraitRetrieveAbort 对齐，用于中止本轮检索 */
      retrieveSessionId?: number;
    }) =>
      ipcRenderer.invoke("ai:portrait:extract", payload) as Promise<
        PortraitExtractResult | { error: string }
      >,
    portraitGoldenQuotes: (payload: {
      bookHash: string;
      characterName: string;
      characterAliases?: string;
      spoilerSafe?: boolean;
      activeChapterIdx?: number;
      retrieveSessionId?: number;
    }) =>
      ipcRenderer.invoke("ai:portrait:goldenQuotes", payload) as Promise<
        CharacterGoldenQuotesResult | { error: string }
      >,
    portraitTranslateSdPrompt: (payload: {
      styleZh?: string;
      promptZh: string;
      negativeZh: string;
    }) =>
      ipcRenderer.invoke("ai:portrait:translateSdPrompt", payload) as Promise<
        | { style_en: string; prompt_en: string; negative_en: string }
        | { error: string }
      >,
    portraitInferBookStyle: (payload: {
      bookHash: string;
      fileTitle?: string;
      spoilerSafe?: boolean;
      activeChapterIdx?: number;
      retrieveSessionId?: number;
    }) =>
      ipcRenderer.invoke("ai:portrait:inferStyle", payload) as Promise<
        BookStyleInferResult | { error: string }
      >,
    portraitRetrieveAbort: (retrieveSessionId: number) =>
      ipcRenderer.invoke(
        "ai:portrait:retrieve:abort",
        retrieveSessionId,
      ) as Promise<{ ok: true } | { ok: false }>,
    portraitRetrieveSessionDispose: (retrieveSessionId: number) =>
      ipcRenderer.invoke(
        "ai:portrait:retrieve:session:dispose",
        retrieveSessionId,
      ) as Promise<{ ok: true } | { ok: false }>,
    portraitTxt2ImgToPath: (payload: {
      outputPath: string;
      styleZh?: string;
      /** 角色形象（自然语言） */
      appearanceZh?: string;
      /** @deprecated 使用 appearanceZh */
      promptZh?: string;
      negativeZh?: string;
    }) =>
      ipcRenderer.invoke("ai:portrait:txt2imgToPath", payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    portraitTxt2ImgToPathAbort: () =>
      ipcRenderer.invoke("ai:portrait:txt2imgToPath:abort") as Promise<{
        ok: true;
      }>,
    onChatChunk: (
      cb: (payload: { requestId: number; delta: string }) => void,
    ) => {
      const fn = (_: unknown, payload: { requestId: number; delta: string }) =>
        cb(payload);
      ipcRenderer.on("ai:chat:chunk", fn);
      return () => ipcRenderer.off("ai:chat:chunk", fn);
    },
    onChatDone: (cb: (payload: { requestId: number }) => void) => {
      const fn = (_: unknown, payload: { requestId: number }) => cb(payload);
      ipcRenderer.on("ai:chat:done", fn);
      return () => ipcRenderer.off("ai:chat:done", fn);
    },
    onChatError: (
      cb: (payload: { requestId: number; message: string }) => void,
    ) => {
      const fn = (
        _: unknown,
        payload: { requestId: number; message: string },
      ) => cb(payload);
      ipcRenderer.on("ai:chat:error", fn);
      return () => ipcRenderer.off("ai:chat:error", fn);
    },
    onAgentEvent: (cb: (payload: AIAgentRendererEvent) => void) => {
      const fn = (_: unknown, payload: AIAgentRendererEvent) => cb(payload);
      ipcRenderer.on("ai:agent:event", fn);
      return () => ipcRenderer.off("ai:agent:event", fn);
    },
    onTextFormatProgress: (
      cb: (payload: AISmartFormatProgressEvent) => void,
    ) => {
      const fn = (_: unknown, payload: AISmartFormatProgressEvent) =>
        cb(payload);
      ipcRenderer.on("ai:text-format:progress", fn);
      return () => ipcRenderer.off("ai:text-format:progress", fn);
    },
  },
  /** 主进程 ragContext 向阅读器索取章节原文 */
  onChapterPlainRequest: (
    cb: (payload: {
      replyChannel: string;
      chapterIndex: number;
      maxChars: number;
    }) => void,
  ) => {
    const fn = (
      _: unknown,
      payload: {
        replyChannel: string;
        chapterIndex: number;
        maxChars: number;
      },
    ) => cb(payload);
    ipcRenderer.on("ai:chapter-plain-request", fn);
    return () => ipcRenderer.off("ai:chapter-plain-request", fn);
  },
  replyChapterPlainText: (replyChannel: string, text: string) => {
    ipcRenderer.send(replyChannel, text);
  },
  bookSourceList: () =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.list) as ReturnType<
      BookSourceIpcApi["bookSourceList"]
    >,
  bookSourceGet: (url: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.get, url) as ReturnType<
      BookSourceIpcApi["bookSourceGet"]
    >,
  bookSourceSave: (source: Parameters<BookSourceIpcApi["bookSourceSave"]>[0]) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.save, source) as ReturnType<
      BookSourceIpcApi["bookSourceSave"]
    >,
  bookSourceDelete: (urls: string[]) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.delete, urls) as ReturnType<
      BookSourceIpcApi["bookSourceDelete"]
    >,
  bookSourceToggle: (url: string, enabled: boolean) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.toggle, url, enabled) as ReturnType<
      BookSourceIpcApi["bookSourceToggle"]
    >,
  bookSourceImportPreview: (
    sources: Parameters<BookSourceIpcApi["bookSourceImportPreview"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.importPreview, sources) as ReturnType<
      BookSourceIpcApi["bookSourceImportPreview"]
    >,
  bookSourceImportCommit: (
    payload: Parameters<BookSourceIpcApi["bookSourceImportCommit"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.importCommit, payload) as ReturnType<
      BookSourceIpcApi["bookSourceImportCommit"]
    >,
  bookSourceFetchUrl: (url: string, options?: { requestId?: number }) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.fetchUrl, url, options) as ReturnType<
      BookSourceIpcApi["bookSourceFetchUrl"]
    >,
  bookSourceFetchUrlAbort: (requestId: number) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.fetchUrlAbort, requestId) as ReturnType<
      BookSourceIpcApi["bookSourceFetchUrlAbort"]
    >,
  bookSourceReadFile: (filePath: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.readFile, filePath) as ReturnType<
      BookSourceIpcApi["bookSourceReadFile"]
    >,
  bookSourceSearch: (key: string, options?: { sourceUrls?: string[]; precisionSearch?: boolean }) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.search, key, options) as ReturnType<
      BookSourceIpcApi["bookSourceSearch"]
    >,
  bookSourceSearchCancel: (searchId: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.searchCancel, searchId),
  bookSourceSearchLoadMore: (searchId: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.searchLoadMore, searchId) as ReturnType<
      BookSourceIpcApi["bookSourceSearchLoadMore"]
    >,
  onBookSourceSearchEvent: (cb: (ev: import("@shared/bookSource/types").BookSourceSearchEvent) => void) => {
    const fn = (_: unknown, payload: import("@shared/bookSource/types").BookSourceSearchEvent) =>
      cb(payload);
    ipcRenderer.on(BOOK_SOURCE_IPC.searchEvent, fn);
    return () => ipcRenderer.off(BOOK_SOURCE_IPC.searchEvent, fn);
  },
  bookSourceDownload: (
    req: Parameters<BookSourceIpcApi["bookSourceDownload"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.download, req) as ReturnType<
      BookSourceIpcApi["bookSourceDownload"]
    >,
  bookSourceDownloadCancel: (downloadId: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.downloadCancel, downloadId),
  onBookSourceDownloadEvent: (cb: (ev: import("@shared/bookSource/types").BookSourceDownloadEvent) => void) => {
    const fn = (_: unknown, payload: import("@shared/bookSource/types").BookSourceDownloadEvent) =>
      cb(payload);
    ipcRenderer.on(BOOK_SOURCE_IPC.downloadEvent, fn);
    return () => ipcRenderer.off(BOOK_SOURCE_IPC.downloadEvent, fn);
  },
  bookSourceGetLoginInfo: (url: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getLoginInfo, url) as ReturnType<
      BookSourceIpcApi["bookSourceGetLoginInfo"]
    >,
  bookSourceSetLoginInfo: (url: string, info: Record<string, string>) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.setLoginInfo, url, info) as ReturnType<
      BookSourceIpcApi["bookSourceSetLoginInfo"]
    >,
  bookSourceGetLoginUi: (sourceUrl: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getLoginUi, sourceUrl) as ReturnType<
      BookSourceIpcApi["bookSourceGetLoginUi"]
    >,
  bookSourceBrowserLogin: (sourceUrl: string, title?: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.browserLogin, sourceUrl, title) as ReturnType<
      BookSourceIpcApi["bookSourceBrowserLogin"]
    >,
  bookSourceLogin: (
    sourceUrl: string,
    loginData: Record<string, string>,
    options?: import("@shared/bookSource/ipc").BookSourceLoginOptions,
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.login, sourceUrl, loginData, options) as ReturnType<
      BookSourceIpcApi["bookSourceLogin"]
    >,
  bookSourcePayAction: (
    payload: Parameters<BookSourceIpcApi["bookSourcePayAction"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.payAction, payload) as ReturnType<
      BookSourceIpcApi["bookSourcePayAction"]
    >,
  bookSourceGetLoginHeader: (sourceUrl: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getLoginHeader, sourceUrl) as ReturnType<
      BookSourceIpcApi["bookSourceGetLoginHeader"]
    >,
  bookSourceRemoveLoginHeader: (sourceUrl: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.removeLoginHeader, sourceUrl) as ReturnType<
      BookSourceIpcApi["bookSourceRemoveLoginHeader"]
    >,
  bookSourceClearCookie: (sourceUrl: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.clearCookie, sourceUrl) as ReturnType<
      BookSourceIpcApi["bookSourceClearCookie"]
    >,
  bookSourceReorder: (url: string, position: "top" | "bottom") =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.reorder, url, position) as ReturnType<
      BookSourceIpcApi["bookSourceReorder"]
    >,
  bookSourceApplyCustomOrders: (
    updates: Array<{ url: string; customOrder: number }>,
  ) =>
    ipcRenderer.invoke(
      BOOK_SOURCE_IPC.applyCustomOrders,
      updates,
    ) as ReturnType<BookSourceIpcApi["bookSourceApplyCustomOrders"]>,
  bookSourceExploreKinds: (sourceUrl: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.exploreKinds, sourceUrl) as ReturnType<
      BookSourceIpcApi["bookSourceExploreKinds"]
    >,
  bookSourceExploreBooks: (
    payload: Parameters<BookSourceIpcApi["bookSourceExploreBooks"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.exploreBooks, payload) as ReturnType<
      BookSourceIpcApi["bookSourceExploreBooks"]
    >,
  bookSourceExploreClearKindsCache: (sourceUrl: string) =>
    ipcRenderer.invoke(
      BOOK_SOURCE_IPC.exploreClearKindsCache,
      sourceUrl,
    ) as ReturnType<BookSourceIpcApi["bookSourceExploreClearKindsCache"]>,
  bookSourceGetBookInfo: (
    payload: Parameters<BookSourceIpcApi["bookSourceGetBookInfo"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getBookInfo, payload) as ReturnType<
      BookSourceIpcApi["bookSourceGetBookInfo"]
    >,
  bookSourceResolveCoverDisplay: (
    payload: Parameters<BookSourceIpcApi["bookSourceResolveCoverDisplay"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.resolveCoverDisplay, payload) as ReturnType<
      BookSourceIpcApi["bookSourceResolveCoverDisplay"]
    >,
  bookSourceGetChapterList: (
    payload: Parameters<BookSourceIpcApi["bookSourceGetChapterList"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getChapterList, payload) as ReturnType<
      BookSourceIpcApi["bookSourceGetChapterList"]
    >,
  bookSourceGetChapterContent: (
    payload: Parameters<BookSourceIpcApi["bookSourceGetChapterContent"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getChapterContent, payload) as ReturnType<
      BookSourceIpcApi["bookSourceGetChapterContent"]
    >,
  bookSourceChapterCacheStatus: (payload: {
    name: string;
    bookUrl: string;
    chapterUrls: string[];
    cacheDir?: string;
  }) =>
    ipcRenderer.invoke(
      BOOK_SOURCE_IPC.chapterCacheStatus,
      payload,
    ) as ReturnType<BookSourceIpcApi["bookSourceChapterCacheStatus"]>,
  bookSourceSaveChapterCache: (payload: {
    name: string;
    bookUrl: string;
    chapterUrl: string;
    content: string;
    cacheDir?: string;
  }) =>
    ipcRenderer.invoke(
      BOOK_SOURCE_IPC.saveChapterCache,
      payload,
    ) as ReturnType<BookSourceIpcApi["bookSourceSaveChapterCache"]>,
  bookSourceClearChapterCache: (payload: {
    name: string;
    bookUrl: string;
    cacheDir?: string;
  }) =>
    ipcRenderer.invoke(
      BOOK_SOURCE_IPC.clearChapterCache,
      payload,
    ) as ReturnType<BookSourceIpcApi["bookSourceClearChapterCache"]>,
  bookSourceClearAllChapterCache: (payload?: { cacheDir?: string }) =>
    ipcRenderer.invoke(
      BOOK_SOURCE_IPC.clearAllChapterCache,
      payload,
    ) as ReturnType<BookSourceIpcApi["bookSourceClearAllChapterCache"]>,
  bookSourceGetSourceVariable: (sourceUrl: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getSourceVariable, sourceUrl) as ReturnType<
      BookSourceIpcApi["bookSourceGetSourceVariable"]
    >,
  bookSourceSetSourceVariable: (
    sourceUrl: string,
    variable: string,
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.setSourceVariable, {
      sourceUrl,
      variable,
    }) as ReturnType<BookSourceIpcApi["bookSourceSetSourceVariable"]>,
  bookSourceGetBookVariable: (bookUrl: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getBookVariable, bookUrl) as ReturnType<
      BookSourceIpcApi["bookSourceGetBookVariable"]
    >,
  bookSourceSetBookVariable: (bookUrl: string, variable: string) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.setBookVariable, {
      bookUrl,
      variable,
    }) as ReturnType<BookSourceIpcApi["bookSourceSetBookVariable"]>,
  onBookSourceCaptchaRequest: (
    cb: (payload: import("@shared/bookSource/ipc").BookSourceCaptchaRequest) => void,
  ) => {
    const fn = (
      _: unknown,
      payload: import("@shared/bookSource/ipc").BookSourceCaptchaRequest,
    ) => cb(payload);
    ipcRenderer.on(BOOK_SOURCE_IPC.captchaRequest, fn);
    return () => ipcRenderer.off(BOOK_SOURCE_IPC.captchaRequest, fn);
  },
  onBookSourceCaptchaDismiss: (cb: (payload: { requestId: string }) => void) => {
    const fn = (_: unknown, payload: { requestId: string }) => cb(payload);
    ipcRenderer.on(BOOK_SOURCE_IPC.captchaDismiss, fn);
    return () => ipcRenderer.off(BOOK_SOURCE_IPC.captchaDismiss, fn);
  },
  onBookSourceToast: (
    cb: (ev: import("@shared/bookSource/ipc").BookSourceToastEvent) => void,
  ) => {
    const fn = (
      _: unknown,
      payload: import("@shared/bookSource/ipc").BookSourceToastEvent,
    ) => cb(payload);
    ipcRenderer.on(BOOK_SOURCE_IPC.toast, fn);
    return () => ipcRenderer.off(BOOK_SOURCE_IPC.toast, fn);
  },
  bookSourceCaptchaReply: (
    payload: import("@shared/bookSource/ipc").BookSourceCaptchaReply,
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.captchaReply, payload) as ReturnType<
      BookSourceIpcApi["bookSourceCaptchaReply"]
    >,
  bookSourceCheckStart: (
    sourceUrls: string[],
    options?: { keyword?: string },
  ) =>
    ipcRenderer.invoke(
      BOOK_SOURCE_IPC.checkStart,
      sourceUrls,
      options,
    ) as ReturnType<BookSourceIpcApi["bookSourceCheckStart"]>,
  bookSourceCheckCancel: () =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.checkCancel) as ReturnType<
      BookSourceIpcApi["bookSourceCheckCancel"]
    >,
  bookSourceCheckGetConfig: () =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.checkGetConfig) as ReturnType<
      BookSourceIpcApi["bookSourceCheckGetConfig"]
    >,
  bookSourceCheckSetConfig: (
    patch: Parameters<BookSourceIpcApi["bookSourceCheckSetConfig"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.checkSetConfig, patch) as ReturnType<
      BookSourceIpcApi["bookSourceCheckSetConfig"]
    >,
  bookSourceSetHttpProxy: (proxy: string | null) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.setHttpProxy, proxy) as ReturnType<
      BookSourceIpcApi["bookSourceSetHttpProxy"]
    >,
  bookSourceGetHttpProxy: () =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.getHttpProxy) as ReturnType<
      BookSourceIpcApi["bookSourceGetHttpProxy"]
    >,
  bookSourceTestHttpProxy: (
    payload: Parameters<BookSourceIpcApi["bookSourceTestHttpProxy"]>[0],
  ) =>
    ipcRenderer.invoke(BOOK_SOURCE_IPC.testHttpProxy, payload) as ReturnType<
      BookSourceIpcApi["bookSourceTestHttpProxy"]
    >,
  onBookSourceCheckEvent: (
    cb: (ev: import("@shared/bookSource/ipc").BookSourceCheckEvent) => void,
  ) => {
    const fn = (
      _: unknown,
      payload: import("@shared/bookSource/ipc").BookSourceCheckEvent,
    ) => cb(payload);
    ipcRenderer.on(BOOK_SOURCE_IPC.checkEvent, fn);
    return () => ipcRenderer.off(BOOK_SOURCE_IPC.checkEvent, fn);
  },
  getDefaultBookSourceDownloadDir: () => {
    const ud = getPathFromMainSync("userData");
    if (!ud) return "";
    return joinUserDataSubdir(ud, "DownloadedBooks");
  },
  getDefaultBookSourceChapterCacheDir: () => {
    const ud = getPathFromMainSync("userData");
    if (!ud) return "";
    return joinUserDataSubdir(ud, "book_cache");
  },
  getDefaultDictionariesDir: () => {
    const ud = getPathFromMainSync("userData");
    if (!ud) return "";
    return joinUserDataSubdir(ud, "dictionaries");
  },
  dictionaryLookup: (payload: DictionaryLookupRequest) =>
    ipcRenderer.invoke(
      DICTIONARY_IPC.lookup,
      payload,
    ) as Promise<DictionaryLookupResponse>,
  dictionaryImport: (payload: DictionaryImportRequest) =>
    ipcRenderer.invoke(
      DICTIONARY_IPC.import,
      payload,
    ) as Promise<DictionaryImportResponse>,
  dictionaryRemove: (payload: DictionaryRemoveRequest) =>
    ipcRenderer.invoke(
      DICTIONARY_IPC.remove,
      payload,
    ) as Promise<DictionaryRemoveResponse>,
  translate: (payload: TranslationRequest) =>
    ipcRenderer.invoke(
      TRANSLATION_IPC.translate,
      payload,
    ) as Promise<TranslationResponse>,
};

contextBridge.exposeInMainWorld("colorTxt", api);

export type ColorTxtApi = typeof api;
