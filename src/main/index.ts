import { app, BrowserWindow, protocol } from "electron";
import { registerColortxtLocalProtocol } from "./colortxtLocalProtocol";
import { registerMainIpcHandlers } from "./ipcHandlers";
import { setupLaunchTxtHandlers } from "./launchTxtHandlers";
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from "./globalShortcuts";
import { registerUpdaterIpc, setupAutoUpdater } from "./updater";
import { markAppQuittingForClose } from "./windowCloseGuard";
import { createMainWindowFactory } from "./windowFactory";
import {
  argvHasFindBookFlag,
  openFindBookLaunchWindow,
} from "./findBookLaunch";
import {
  destroyAllBackstageWebViews,
  isBackstageWebViewWindow,
} from "./bookSource/engine/backstageWebView";
import { destroyEyedropperOverlays, isEyedropperWindow } from "./eyedropper";
import {
  destroyStealthReaderWindow,
  isStealthReaderWindow,
} from "./stealthReader";
import { isStealthSettingsWindow } from "./stealthSettingsWindow";

// 开发态 DevTools 会对「无 CSP / 含 unsafe-eval」的渲染进程刷安全警告；
// 主界面 CSP 需 unsafe-eval（文本替换 @js:），登录验证窗还会加载第三方页——无法也不应强行收紧。
// 打包后 Electron 本就不显示该警告；此处仅消除 unpackaged 控制台噪音。
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

/** 须在 `app.ready` 之前注册，否则自定义协议无法在渲染进程用于 `<img>` 等 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "colortxt-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

registerUpdaterIpc();

const shouldRestoreSessionByWindowId = new Map<number, boolean>();
/** 从资源管理器 / 命令行启动时待打开的 txt，由渲染进程 pull 一次 */
const pendingOpenTxtByWindowId = new Map<number, string>();
/** 找书专用窗口（加载 find-book.html） */
const findBookWindowByWindowId = new Map<number, boolean>();
/** 找书窗初始标签（桌面快捷方式 → bookshelf） */
const findBookInitialTabByWindowId = new Map<number, "bookshelf" | "search">();
/** 最近一次获得焦点的阅读主窗口 id（非找书窗） */
const mainWindowFocusState = { lastId: null as number | null };

const createWindow = createMainWindowFactory({
  shouldRestoreSessionByWindowId,
  pendingOpenTxtByWindowId,
  findBookWindowByWindowId,
  findBookInitialTabByWindowId,
  onMainWindowFocused: (id) => {
    mainWindowFocusState.lastId = id;
  },
});

registerMainIpcHandlers({
  createWindow,
  shouldRestoreSessionByWindowId,
  pendingOpenTxtByWindowId,
  findBookWindowByWindowId,
  findBookInitialTabByWindowId,
  mainWindowFocusState,
});

const launchTxtHandlers = setupLaunchTxtHandlers({
  createWindow,
  findBookWindowByWindowId,
  mainWindowFocusState,
  onSecondInstance: (argv) => {
    if (!argvHasFindBookFlag(argv)) return false;
    openFindBookLaunchWindow(createWindow, "bookshelf");
    return true;
  },
});

app.whenReady().then(async () => {
  registerColortxtLocalProtocol();
  setupAutoUpdater();
  if (argvHasFindBookFlag(process.argv)) {
    openFindBookLaunchWindow(createWindow, "bookshelf");
  } else {
    const launchTxt = launchTxtHandlers.resolveLaunchTxtForStartup(process.argv);
    createWindow({ openTxtPath: launchTxt });
    launchTxtHandlers.openRemainingMacPendingTxtPaths();
  }
  registerGlobalShortcuts();

  app.on("activate", () => {
    const userWindows = BrowserWindow.getAllWindows().filter(
      (w) =>
        !w.isDestroyed() &&
        !isBackstageWebViewWindow(w) &&
        !isEyedropperWindow(w) &&
        !isStealthReaderWindow(w) &&
        !isStealthSettingsWindow(w),
    );
    if (userWindows.length === 0) createWindow({});
  });
});

app.on("before-quit", () => {
  destroyStealthReaderWindow();
  destroyEyedropperOverlays();
  destroyAllBackstageWebViews();
});

app.on("will-quit", () => {
  unregisterGlobalShortcuts();
});

app.on("window-all-closed", () => {
  destroyStealthReaderWindow();
  destroyEyedropperOverlays();
  destroyAllBackstageWebViews();
  // 末窗关闭后须再次 quit；macOS 上 Cmd+Q 首次 quit 常被关窗拦截 cancel，靠此路径收尾
  markAppQuittingForClose();
  app.quit();
});
