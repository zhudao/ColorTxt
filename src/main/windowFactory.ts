import { app, BrowserWindow } from "electron";
import { stat } from "node:fs/promises";
import path from "node:path";
import { isSupportedShellOpenPath } from "@shared/ebookExtensions";
import { APP_DISPLAY_NAME } from "@shared/packageDerived";
import { FIND_BOOK_WINDOW_TITLE } from "@shared/findBookWindowTitle";
import {
  resolveInitialWindowBounds,
  saveWindowBounds,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
} from "./windowBounds";
import { attachWindowCloseRequestGuard } from "./windowCloseGuard";
import { attachWebContentsExternalLinkPolicy } from "./webContentsExternalLinks";
import { attachEditableContextMenu } from "./editableContextMenu";
import {
  destroyAllBackstageWebViews,
  isBackstageWebViewWindow,
} from "./bookSource/engine/backstageWebView";
import {
  destroyEyedropperOverlays,
  isEyedropperWindow,
} from "./eyedropper";
import { isStealthReaderWindow } from "./stealthReader";
import { isStealthSettingsWindow } from "./stealthSettingsWindow";

export type CreateMainWindow = (options?: {
  openTxtPath?: string | null;
  openFindBook?: boolean;
  /** 找书窗初始标签；默认 search（主界面入口），桌面快捷方式用 bookshelf */
  findBookInitialTab?: "bookshelf" | "search";
}) => BrowserWindow;

type MainWindowMaps = {
  shouldRestoreSessionByWindowId: Map<number, boolean>;
  pendingOpenTxtByWindowId: Map<number, string>;
  findBookWindowByWindowId: Map<number, boolean>;
  findBookInitialTabByWindowId: Map<number, "bookshelf" | "search">;
  onMainWindowFocused?: (windowId: number) => void;
};

export function createMainWindowFactory(maps: MainWindowMaps): CreateMainWindow {
  const {
    shouldRestoreSessionByWindowId,
    pendingOpenTxtByWindowId,
    findBookWindowByWindowId,
    findBookInitialTabByWindowId,
    onMainWindowFocused,
  } = maps;

  return function createWindow(options?: {
    openTxtPath?: string | null;
    openFindBook?: boolean;
    findBookInitialTab?: "bookshelf" | "search";
  }) {
    const openTxtPath = options?.openTxtPath ?? null;
    const openFindBook = options?.openFindBook === true;
    const findBookInitialTab =
      options?.findBookInitialTab === "bookshelf" ? "bookshelf" : "search";
    const hasOtherMainWindow = BrowserWindow.getAllWindows().some(
      (w) =>
        !w.isDestroyed() &&
        !findBookWindowByWindowId.get(w.id) &&
        !isEyedropperWindow(w) &&
        !isStealthReaderWindow(w) &&
        !isStealthSettingsWindow(w),
    );
    const shouldRestoreSession =
      !hasOtherMainWindow && !openTxtPath && !openFindBook;
    const initialBounds = resolveInitialWindowBounds();
    const SAVE_DEBOUNCE_MS = 300;
    const iconFileName = openFindBook
      ? process.platform === "win32"
        ? "icon_find.ico"
        : "icon_find.png"
      : process.platform === "win32"
        ? "icon.ico"
        : "icon.png";
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, iconFileName)
      : path.join(app.getAppPath(), "resources", iconFileName);
    const win = new BrowserWindow({
      show: false,
      width: initialBounds.width,
      height: initialBounds.height,
      x: initialBounds.x,
      y: initialBounds.y,
      minWidth: WINDOW_MIN_WIDTH,
      minHeight: WINDOW_MIN_HEIGHT,
      icon: iconPath,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setMenuBarVisibility(false);
    win.removeMenu();
    attachWebContentsExternalLinkPolicy(win.webContents);
    attachEditableContextMenu(win);
    shouldRestoreSessionByWindowId.set(win.id, shouldRestoreSession);
    if (openFindBook) {
      findBookWindowByWindowId.set(win.id, true);
      findBookInitialTabByWindowId.set(win.id, findBookInitialTab);
    } else {
      win.on("focus", () => {
        onMainWindowFocused?.(win.id);
      });
    }
    win.on("closed", () => {
      shouldRestoreSessionByWindowId.delete(win.id);
      pendingOpenTxtByWindowId.delete(win.id);
      findBookWindowByWindowId.delete(win.id);
      findBookInitialTabByWindowId.delete(win.id);
      // 后台 webView 是 show:false 的 BrowserWindow；若不拆掉，关可见窗后进程不退
      const stillUserWindows = BrowserWindow.getAllWindows().some(
        (w) =>
          !w.isDestroyed() &&
          !isBackstageWebViewWindow(w) &&
          !isEyedropperWindow(w) &&
          !isStealthReaderWindow(w) &&
          !isStealthSettingsWindow(w),
      );
      if (!stillUserWindows) {
        destroyEyedropperOverlays();
        destroyAllBackstageWebViews();
      }
    });

    const findBookTitle = FIND_BOOK_WINDOW_TITLE;
    const findBookQuery =
      openFindBook && findBookInitialTab === "bookshelf"
        ? "?tab=bookshelf"
        : "";
    if (process.env.ELECTRON_RENDERER_URL) {
      const base = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, "");
      win.loadURL(
        openFindBook
          ? `${base}/find-book.html${findBookQuery}`
          : base,
      );
    } else {
      win.loadFile(
        path.join(
          __dirname,
          "../renderer",
          openFindBook ? "find-book.html" : "index.html",
        ),
        openFindBook && findBookInitialTab === "bookshelf"
          ? { search: "tab=bookshelf" }
          : undefined,
      );
    }
    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      win.show();
      // Ensure the newly created window is frontmost and focused.
      win.focus();
    });

    win.webContents.on("before-input-event", (event, input) => {
      // 全屏下 ESC 不在此拦截，否则按键无法到达渲染进程，模态弹框无法先于退出全屏响应 ESC。
      const isToggleDevToolsKey =
        input.type === "keyDown" &&
        (input.key === "F12" ||
          ((input.control || input.meta) &&
            input.shift &&
            input.key.toLowerCase() === "i"));
      if (!isToggleDevToolsKey) return;
      event.preventDefault();
      if (!app.isPackaged) {
        win.webContents.toggleDevTools();
      }
    });

    win.setTitle(openFindBook ? findBookTitle : APP_DISPLAY_NAME);

    if (openTxtPath) {
      const resolved = path.resolve(openTxtPath);
      pendingOpenTxtByWindowId.set(win.id, resolved);
      void (async () => {
        try {
          const st = await stat(resolved);
          if (!st.isFile() || !isSupportedShellOpenPath(resolved)) {
            pendingOpenTxtByWindowId.delete(win.id);
          }
        } catch {
          pendingOpenTxtByWindowId.delete(win.id);
        }
      })();
    }

    win.on("enter-full-screen", () => {
      win.webContents.send("window:fullscreen-changed", { isFullscreen: true });
    });
    win.on("leave-full-screen", () => {
      win.webContents.send("window:fullscreen-changed", { isFullscreen: false });
    });

    // `resize` / `move` 会在拖拽过程中高频触发，写文件会产生不必要的 IO。
    // 对普通窗口态保存做 debounce，`close` 时仍做一次立即保存兜底。
    let saveWindowBoundsTimer: NodeJS.Timeout | null = null;
    const requestSaveWindowBounds = (immediate: boolean) => {
      if (win.isDestroyed()) return;
      if (saveWindowBoundsTimer) {
        clearTimeout(saveWindowBoundsTimer);
        saveWindowBoundsTimer = null;
      }
      if (immediate) {
        saveWindowBounds(win);
        return;
      }
      saveWindowBoundsTimer = setTimeout(() => {
        saveWindowBoundsTimer = null;
        saveWindowBounds(win);
      }, SAVE_DEBOUNCE_MS);
    };

    win.on("resize", () => {
      requestSaveWindowBounds(false);
    });
    win.on("move", () => {
      requestSaveWindowBounds(false);
    });
    win.on("close", () => {
      requestSaveWindowBounds(true);
    });
    attachWindowCloseRequestGuard(win);

    return win;
  };
}
