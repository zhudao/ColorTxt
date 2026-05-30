import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type WebContents,
} from "electron";
import { createReadStream, watch as fsWatchFile } from "node:fs";
import type { FSWatcher } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getFonts } from "font-list";
import iconv from "iconv-lite";
import { detectTextFileEncoding } from "./detectTextEncoding";
import { EBOOK_DOT_EXTENSIONS } from "@shared/ebookExtensions";
import type { ColorTxtShowMessageBoxResult } from "@shared/colorTxtShowMessageBox";
import { parseShowMessageBoxOptions } from "./messageBoxInvoke";
import {
  parseShowOpenDialogOptions,
  parseShowSaveDialogOptions,
} from "./dialogInvoke";
import type { CreateMainWindow } from "./windowFactory";
import { registerLocalFileForColortxtUrl } from "./colortxtLocalProtocol";
import {
  markAppQuittingForClose,
  registerWindowCloseGuardIpc,
} from "./windowCloseGuard";
import {
  getToggleVisibilityShortcut,
  resumeGlobalShortcutsAfterRecording,
  setToggleVisibilityShortcut,
  suspendGlobalShortcutsForRecording,
  validateGlobalShortcut,
} from "./globalShortcuts";
import { registerAiIpcHandlers } from "./registerAiIpc";
import { registerSecretsIpcHandlers } from "./registerSecretsIpc";
import {
  copyImageToAbsolutePath,
  migrateCharacterPortraitCacheRoot,
} from "./characterPortraitFs";
import { synthesizeEdgeTtsMp3 } from "./voiceReadEdgeTts";
import type { VoiceReadEdgeTtsRequest } from "@shared/voiceReadEdgeIpc";

type TxtFileItem = { name: string; path: string; size: number };
type DirListScanProgress = (item: { name: string; path: string }) => void;

function isTxtOrEbookFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt")) return true;
  if (lower.endsWith(".md")) return true;
  return EBOOK_DOT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type RegisterMainIpcHandlersOptions = {
  createWindow: CreateMainWindow;
  shouldRestoreSessionByWindowId: Map<number, boolean>;
  pendingOpenTxtByWindowId: Map<number, string>;
};

let cachedSystemFonts: string[] | null = null;

/**
 * 迭代遍历子目录，避免符号链接 / 目录联接成环导致递归栈溢出；
 * 用 realpath 去重已访问目录。
 */
async function collectTxtFilesUnderRoot(
  rootDir: string,
  onProgress?: DirListScanProgress,
): Promise<TxtFileItem[]> {
  const files: TxtFileItem[] = [];
  const visitedDirs = new Set<string>();
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    let dirReal: string;
    try {
      dirReal = await realpath(currentDir);
    } catch {
      continue;
    }
    if (visitedDirs.has(dirReal)) continue;
    visitedDirs.add(dirReal);

    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const subdirs: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        subdirs.push(fullPath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        try {
          const st = await stat(fullPath);
          if (st.isDirectory()) {
            subdirs.push(fullPath);
          } else if (st.isFile() && isTxtOrEbookFileName(entry.name)) {
            const relativePath = path
              .relative(rootDir, fullPath)
              .replaceAll("\\", "/");
            onProgress?.({ name: relativePath, path: fullPath });
            files.push({
              name: relativePath,
              path: fullPath,
              size: st.size,
            });
          }
        } catch {
          // 失效链接等
        }
        continue;
      }

      if (!entry.isFile() || !isTxtOrEbookFileName(entry.name)) {
        continue;
      }

      const relativePath = path
        .relative(rootDir, fullPath)
        .replaceAll("\\", "/");
      onProgress?.({ name: relativePath, path: fullPath });
      let fileStat;
      try {
        fileStat = await stat(fullPath);
      } catch {
        continue;
      }
      files.push({
        name: relativePath,
        path: fullPath,
        size: fileStat.size,
      });
    }

    for (let i = subdirs.length - 1; i >= 0; i--) {
      stack.push(subdirs[i]);
    }
  }

  return files;
}

async function detectEncoding(filePath: string): Promise<string> {
  return detectTextFileEncoding(filePath, app.getLocale());
}

export function registerMainIpcHandlers(
  options: RegisterMainIpcHandlersOptions,
) {
  registerWindowCloseGuardIpc();
  const {
    createWindow,
    shouldRestoreSessionByWindowId,
    pendingOpenTxtByWindowId,
  } = options;
  const activeStreamBySenderId = new Map<
    number,
    ReturnType<typeof createReadStream>
  >();
  const streamRequestSeqBySenderId = new Map<number, number>();

  type CurrentFileWatchEntry = {
    watcher: FSWatcher;
    lastMtimeMs: number;
    debounceTimer: ReturnType<typeof setTimeout> | null;
  };
  const currentFileWatchBySenderId = new Map<number, CurrentFileWatchEntry>();
  const currentFileWatchDestroyHooked = new WeakSet<WebContents>();

  function stopCurrentFileWatch(senderId: number) {
    const entry = currentFileWatchBySenderId.get(senderId);
    if (!entry) return;
    if (entry.debounceTimer != null) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    try {
      entry.watcher.close();
    } catch {
      // ignore
    }
    currentFileWatchBySenderId.delete(senderId);
  }

  ipcMain.removeHandler("file:watchCurrent");
  ipcMain.handle("file:watchCurrent", async (evt, rawPath: unknown) => {
    const sender = evt.sender;
    const senderId = sender.id;
    stopCurrentFileWatch(senderId);

    if (rawPath === null || rawPath === undefined) {
      return;
    }
    if (typeof rawPath !== "string") {
      return;
    }
    const trimmed = rawPath.trim();
    if (!trimmed) {
      return;
    }

    let st;
    try {
      st = await stat(trimmed);
    } catch {
      return;
    }
    if (!st.isFile()) {
      return;
    }

    const entry: CurrentFileWatchEntry = {
      watcher: null as unknown as FSWatcher,
      lastMtimeMs: st.mtimeMs,
      debounceTimer: null,
    };

    const flushChange = async () => {
      entry.debounceTimer = null;
      if (sender.isDestroyed()) {
        stopCurrentFileWatch(senderId);
        return;
      }
      try {
        const st2 = await stat(trimmed);
        if (!st2.isFile()) return;
        if (st2.mtimeMs <= entry.lastMtimeMs + 0.5) return;
        entry.lastMtimeMs = st2.mtimeMs;
        if (sender.isDestroyed()) {
          stopCurrentFileWatch(senderId);
          return;
        }
        sender.send("file:disk-changed", {
          path: trimmed,
          mtimeMs: st2.mtimeMs,
        });
      } catch {
        // ignore
      }
    };

    const scheduleFlush = () => {
      if (entry.debounceTimer != null) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        void flushChange();
      }, 280);
    };

    let watcher: FSWatcher;
    try {
      watcher = fsWatchFile(trimmed, scheduleFlush);
    } catch {
      return;
    }
    entry.watcher = watcher;
    currentFileWatchBySenderId.set(senderId, entry);

    if (!currentFileWatchDestroyHooked.has(sender)) {
      currentFileWatchDestroyHooked.add(sender);
      sender.once("destroyed", () => {
        stopCurrentFileWatch(sender.id);
      });
    }
  });

  ipcMain.handle("shell:openExternal", async (_evt, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("shell:showItemInFolder", async (_evt, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  /** 在系统文件管理器中打开路径（目录会先 `mkdir -p` 再打开） */
  ipcMain.handle(
    "shell:openPath",
    async (
      _evt,
      targetPathRaw: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const raw =
        typeof targetPathRaw === "string" ? targetPathRaw.trim() : "";
      if (!raw) return { ok: false, error: "路径为空" };
      const resolved = path.resolve(raw);
      if (!resolved) return { ok: false, error: "路径无效" };
      try {
        await mkdir(resolved, { recursive: true });
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      const err = await shell.openPath(resolved);
      if (err) return { ok: false, error: err };
      return { ok: true };
    },
  );

  ipcMain.on("app:quit", () => {
    markAppQuittingForClose();
    app.quit();
  });

  ipcMain.on("window:new", (_evt, openTxtPath?: unknown) => {
    const targetPath =
      typeof openTxtPath === "string" && openTxtPath.trim()
        ? openTxtPath.trim()
        : null;
    createWindow({ openTxtPath: targetPath });
  });

  ipcMain.handle("window:toggleDevTools", (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return;
    win.webContents.toggleDevTools();
  });

  ipcMain.handle("window:shouldRestoreSession", (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return false;
    return shouldRestoreSessionByWindowId.get(win.id) === true;
  });

  /** 首屏侧栏 tab：同步返回本窗口是否会加载文件（恢复会话 / 待打开路径） */
  ipcMain.on("window:getInitialLoadIntent", (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) {
      evt.returnValue = {
        shouldRestoreSession: false,
        hasPendingOpenTxt: false,
      };
      return;
    }
    evt.returnValue = {
      shouldRestoreSession:
        shouldRestoreSessionByWindowId.get(win.id) === true,
      hasPendingOpenTxt: pendingOpenTxtByWindowId.has(win.id),
    };
  });

  ipcMain.handle("window:consumePendingOpenTxtPath", (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return null;
    const p = pendingOpenTxtByWindowId.get(win.id);
    if (!p) return null;
    pendingOpenTxtByWindowId.delete(win.id);
    return p;
  });

  ipcMain.removeHandler("dialog:openTxt");
  ipcMain.removeHandler("dialog:openFilePlain");
  ipcMain.removeHandler("dialog:openDirectoryPlain");
  ipcMain.removeHandler("dialog:openTxtDirectory");

  ipcMain.removeHandler("dialog:showOpenDialog");
  ipcMain.handle("dialog:showOpenDialog", async (evt, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    const options = parseShowOpenDialogOptions(raw);
    return win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
  });

  ipcMain.removeHandler("dialog:showSaveDialog");
  ipcMain.handle("dialog:showSaveDialog", async (evt, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    const options = parseShowSaveDialogOptions(raw);
    return win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
  });

  ipcMain.removeHandler("dialog:confirmClearRecentFiles");
  ipcMain.removeHandler("dialog:confirmClearFileList");
  ipcMain.removeHandler("dialog:confirmClearFileListCategory");
  ipcMain.removeHandler("dialog:confirmClearBookmarks");
  ipcMain.removeHandler("dialog:confirmClearHighlightTerms");
  ipcMain.removeHandler("dialog:confirmClearAppCache");
  ipcMain.removeHandler("dialog:confirmResetUiSettings");

  ipcMain.removeHandler("dialog:showMessageBox");
  ipcMain.handle("dialog:showMessageBox", async (evt, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    const options = parseShowMessageBoxOptions(raw);
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    return {
      response: result.response,
      checkboxChecked: result.checkboxChecked,
    } satisfies ColorTxtShowMessageBoxResult;
  });

  ipcMain.handle("file:stat", async (_evt, filePath: string) => {
    try {
      const resolved = path.resolve(filePath);
      const s = await stat(resolved);
      return {
        size: s.size,
        mtimeMs: s.mtimeMs,
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        return {
          size: 0,
          mtimeMs: 0,
          isFile: false,
          isDirectory: false,
        };
      }
      throw e;
    }
  });

  ipcMain.handle("app:getPath", (_evt, name: string) => {
    try {
      return app.getPath(name as Parameters<typeof app.getPath>[0]);
    } catch {
      return null;
    }
  });

  /** preload 等不可依赖 `electron.app` 时，由主进程代为 `getPath`（仅白名单键名） */
  const APP_GET_PATH_SYNC_ALLOW = new Set([
    "userData",
    "home",
    "appData",
    "temp",
    "sessionData",
    "desktop",
    "documents",
    "downloads",
  ]);
  ipcMain.on("app:getPathSync", (event, nameRaw: unknown) => {
    try {
      const key = typeof nameRaw === "string" ? nameRaw.trim() : "";
      if (!APP_GET_PATH_SYNC_ALLOW.has(key)) {
        event.returnValue = "";
        return;
      }
      event.returnValue = app.getPath(key as Parameters<typeof app.getPath>[0]);
    } catch {
      event.returnValue = "";
    }
  });

  ipcMain.handle("path:toFileUrl", (_evt, filePath: string) => {
    try {
      return pathToFileURL(path.resolve(filePath)).href;
    } catch {
      return null;
    }
  });

  ipcMain.handle("colortxtLocal:registerPath", async (_evt, filePath: string) => {
    return registerLocalFileForColortxtUrl(String(filePath ?? ""));
  });

  ipcMain.handle("file:readFileAsBuffer", async (_evt, filePath: string) => {
    return readFile(path.resolve(filePath));
  });

  ipcMain.handle(
    "file:writeUtf8File",
    async (_evt, filePath: string, utf8: string) => {
      const resolved = path.resolve(filePath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, utf8, "utf8");
      return { ok: true as const };
    },
  );

  ipcMain.handle("file:readWholeTextFile", async (_evt, filePath: string) => {
    const resolved = path.resolve(String(filePath ?? "").trim());
    if (!resolved) {
      return { ok: false as const, message: "路径为空" };
    }
    try {
      const st = await stat(resolved);
      if (!st.isFile()) {
        return { ok: false as const, message: "路径不是可读文件" };
      }
    } catch (e) {
      return {
        ok: false as const,
        message: e instanceof Error ? e.message : "文件不存在或不可访问",
      };
    }
    try {
      const encoding = await detectEncoding(resolved);
      const buf = await readFile(resolved);
      const text = iconv.decode(buf, encoding);
      return { ok: true as const, text, encoding };
    } catch (e) {
      return {
        ok: false as const,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.handle(
    "file:writeTextFile",
    async (
      _evt,
      filePath: string,
      content: string,
      encodingRaw: unknown,
    ) => {
      const resolved = path.resolve(String(filePath ?? "").trim());
      if (!resolved) {
        return { ok: false as const, message: "路径为空" };
      }
      const encoding =
        typeof encodingRaw === "string" && encodingRaw.trim()
          ? encodingRaw.trim()
          : "utf8";
      try {
        const buf = iconv.encode(content, encoding);
        await mkdir(path.dirname(resolved), { recursive: true });
        await writeFile(resolved, buf);
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    "file:writeBinaryFile",
    async (_evt, filePath: string, base64: string) => {
      const resolved = path.resolve(filePath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, Buffer.from(base64, "base64"));
      return { ok: true as const };
    },
  );

  ipcMain.handle("fs:emptyDir", async (_evt, dirPath: string) => {
    const resolved = path.resolve(dirPath);
    await rm(resolved, { recursive: true, force: true });
    await mkdir(resolved, { recursive: true });
    return { ok: true as const };
  });

  /** 删除文件或目录（不存在则忽略）；无插图转换时用于移除残留的 `{basename}.Images/` */
  ipcMain.handle("fs:removePath", async (_evt, targetPath: string) => {
    const resolved = path.resolve(targetPath);
    await rm(resolved, { recursive: true, force: true });
    return { ok: true as const };
  });

  ipcMain.handle("fs:mkdir", async (_evt, dirPath: string) => {
    await mkdir(path.resolve(dirPath), { recursive: true });
    return { ok: true as const };
  });

  ipcMain.handle(
    "fs:renamePath",
    async (_evt, fromPath: string, toPath: string) => {
      const from = path.resolve(String(fromPath ?? ""));
      const to = path.resolve(String(toPath ?? ""));
      if (!from || !to) {
        return {
          ok: false as const,
          message: "路径不能为空",
          code: "EINVAL",
        };
      }
      try {
        await rename(from, to);
        const st = await stat(to);
        return {
          ok: true as const,
          path: to,
          size: st.isFile() ? st.size : 0,
        };
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        return {
          ok: false as const,
          message: err?.message || "重命名失败",
          code: err?.code ?? "UNKNOWN",
        };
      }
    },
  );

  ipcMain.handle(
    "characterPortrait:migrateCacheRoot",
    async (_evt, payloadRaw: unknown) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return { ok: false as const, error: "无效参数" };
      }
      const o = payloadRaw as Record<string, unknown>;
      const from = typeof o.from === "string" ? o.from : "";
      const to = typeof o.to === "string" ? o.to : "";
      if (!from.trim() || !to.trim()) {
        return { ok: false as const, error: "无效路径" };
      }
      return migrateCharacterPortraitCacheRoot(from, to);
    },
  );

  ipcMain.handle(
    "characterPortrait:copyFileTo",
    async (_evt, payloadRaw: unknown) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return { ok: false as const, error: "无效参数" };
      }
      const o = payloadRaw as Record<string, unknown>;
      const from = typeof o.from === "string" ? o.from : "";
      const to = typeof o.to === "string" ? o.to : "";
      if (!from.trim() || !to.trim()) {
        return { ok: false as const, error: "无效路径" };
      }
      return copyImageToAbsolutePath(from, to);
    },
  );

  ipcMain.handle("dir:listTxtFiles", async (evt, dirPath: string) => {
    const sender = evt.sender;
    sender.send("dir:listTxtFiles:scan", {
      phase: "start",
      dirPath,
    } satisfies { phase: "start"; dirPath: string });
    const files = (
      await collectTxtFilesUnderRoot(dirPath, (item) => {
        sender.send("dir:listTxtFiles:scan", {
          phase: "progress",
          name: item.name,
        } satisfies { phase: "progress"; name: string });
      })
    ).sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    return { dirPath, files };
  });

  ipcMain.handle("fonts:listSystemFonts", async () => {
    if (cachedSystemFonts) return cachedSystemFonts;

    try {
      const fonts = await getFonts({ disableQuoting: true });
      cachedSystemFonts = Array.from(new Set(fonts)).sort((a, b) =>
        a.localeCompare(b, "zh-Hans-CN"),
      );
    } catch {
      cachedSystemFonts = [];
    }

    return cachedSystemFonts;
  });

  ipcMain.on("window:setTitle", (evt, title: string) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    win?.setTitle(title);
  });

  ipcMain.handle("window:setFullscreen", (evt, value: boolean) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return false;
    win.setFullScreen(Boolean(value));
    return win.isFullScreen();
  });

  ipcMain.handle("shortcut:getGlobalToggle", () => {
    return getToggleVisibilityShortcut();
  });
  ipcMain.handle(
    "shortcut:validateGlobalToggle",
    (_evt, accelerator: string) => {
      return validateGlobalShortcut(accelerator);
    },
  );
  ipcMain.handle("shortcut:setGlobalToggle", (_evt, accelerator: string) => {
    return setToggleVisibilityShortcut(accelerator);
  });
  ipcMain.handle("shortcut:suspendForRecording", () => {
    suspendGlobalShortcutsForRecording();
  });
  ipcMain.handle("shortcut:resumeAfterRecording", () => {
    resumeGlobalShortcutsAfterRecording();
  });

  ipcMain.on("theme:set", (_evt, theme: string) => {
    if (theme !== "vs" && theme !== "vs-dark") return;
    const isLight = theme === "vs";
    nativeTheme.themeSource = isLight ? "light" : "dark";
    const bg = isLight ? "#ffffff" : "#1e1e1e";
    for (const win of BrowserWindow.getAllWindows()) {
      win.setBackgroundColor(bg);
      win.webContents.send("theme:sync", theme);
    }
  });

  // Stream file content to renderer in chunks. Renderer assembles text + detects chapters.
  ipcMain.on("file:stream", async (evt, arg: unknown) => {
    const physicalPath =
      typeof arg === "string"
        ? arg
        : arg &&
            typeof arg === "object" &&
            "physicalPath" in arg &&
            typeof (arg as { physicalPath: unknown }).physicalPath === "string"
          ? (arg as { physicalPath: string }).physicalPath
          : "";
    const sessionFilePathRaw =
      arg &&
      typeof arg === "object" &&
      "sessionFilePath" in arg &&
      typeof (arg as { sessionFilePath: unknown }).sessionFilePath === "string"
        ? (arg as { sessionFilePath: string }).sessionFilePath.trim()
        : "";
    const sessionFilePath =
      sessionFilePathRaw.length > 0 ? sessionFilePathRaw : undefined;

    if (!physicalPath) return;

    const sender = evt.sender;
    const senderId = sender.id;
    const prevStream = activeStreamBySenderId.get(senderId);
    if (prevStream) {
      // 切换文件时立即终止上一个读取流，避免旧 chunk 继续涌入。
      prevStream.destroy();
      activeStreamBySenderId.delete(senderId);
    }
    const requestId = (streamRequestSeqBySenderId.get(senderId) ?? 0) + 1;
    streamRequestSeqBySenderId.set(senderId, requestId);

    const streamMeta = {
      filePath: physicalPath,
      ...(sessionFilePath != null ? { sessionFilePath } : {}),
    };

    let totalBytes = 0;
    try {
      const st = await stat(physicalPath);
      if (!st.isFile()) {
        sender.send("file:stream-error", {
          requestId,
          ...streamMeta,
          message: "路径不是可读文件",
        });
        return;
      }
      totalBytes = st.size;
    } catch (err) {
      sender.send("file:stream-error", {
        requestId,
        ...streamMeta,
        message:
          err instanceof Error ? err.message : "文件不存在或不可访问",
      });
      return;
    }

    try {
      const encoding = await detectEncoding(physicalPath);
      const decoder = iconv.getDecoder(encoding);
      const fileStream = createReadStream(physicalPath, {
        highWaterMark: 1024 * 256,
      });
      activeStreamBySenderId.set(senderId, fileStream);

      sender.send("file:stream-start", {
        requestId,
        ...streamMeta,
        encoding,
        totalBytes,
      });

      let readBytes = 0;
      fileStream.on("data", (chunk: string | Buffer) => {
        if (streamRequestSeqBySenderId.get(senderId) !== requestId) return;
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        readBytes += buf.length;
        const text = decoder.write(buf);
        sender.send("file:stream-chunk", {
          requestId,
          ...streamMeta,
          text,
          readBytes,
          totalBytes,
        });
      });
      fileStream.on("end", () => {
        if (streamRequestSeqBySenderId.get(senderId) !== requestId) return;
        const tail = decoder.end();
        if (tail) {
          sender.send("file:stream-chunk", {
            requestId,
            ...streamMeta,
            text: tail,
            readBytes,
            totalBytes,
          });
        }
        activeStreamBySenderId.delete(senderId);
        sender.send("file:stream-end", { requestId, ...streamMeta });
      });
      fileStream.on("error", (err) => {
        if (streamRequestSeqBySenderId.get(senderId) !== requestId) return;
        activeStreamBySenderId.delete(senderId);
        sender.send("file:stream-error", {
          requestId,
          ...streamMeta,
          message: err?.message ?? String(err),
        });
      });
    } catch (err) {
      sender.send("file:stream-error", {
        requestId,
        ...streamMeta,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ipcMain.handle(
    "voiceRead:edgeTts",
    async (_evt, raw: unknown): Promise<
      | { ok: true; mp3: ArrayBuffer }
      | { ok: false; error: string }
    > => {
      if (!raw || typeof raw !== "object") {
        return { ok: false, error: "无效请求" };
      }
      const o = raw as Record<string, unknown>;
      const text = typeof o.text === "string" ? o.text : "";
      const voice = typeof o.voice === "string" ? o.voice : "";
      const lang = typeof o.lang === "string" ? o.lang : "zh-CN";
      const rate = typeof o.rate === "number" && Number.isFinite(o.rate) ? o.rate : 1;
      const pitch =
        typeof o.pitch === "number" && Number.isFinite(o.pitch) ? o.pitch : 1;
      const req: VoiceReadEdgeTtsRequest = { text, voice, lang, rate, pitch };
      try {
        const mp3 = await synthesizeEdgeTtsMp3(req);
        return { ok: true, mp3 };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  registerAiIpcHandlers();
  registerSecretsIpcHandlers();
}
