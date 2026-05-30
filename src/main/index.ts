import { app, BrowserWindow, protocol } from "electron";
import { registerColortxtLocalProtocol } from "./colortxtLocalProtocol";
import { registerMainIpcHandlers } from "./ipcHandlers";
import { setupLaunchTxtHandlers } from "./launchTxtHandlers";
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from "./globalShortcuts";
import { registerUpdaterIpc, setupAutoUpdater } from "./updater";
import { markAppQuittingForClose } from "./windowCloseGuard";
import { createMainWindowFactory } from "./windowFactory";

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

const createWindow = createMainWindowFactory({
  shouldRestoreSessionByWindowId,
  pendingOpenTxtByWindowId,
});

registerMainIpcHandlers({
  createWindow,
  shouldRestoreSessionByWindowId,
  pendingOpenTxtByWindowId,
});

const launchTxtHandlers = setupLaunchTxtHandlers({ createWindow });

app.whenReady().then(async () => {
  registerColortxtLocalProtocol();
  setupAutoUpdater();
  const launchTxt = launchTxtHandlers.resolveLaunchTxtForStartup(process.argv);
  createWindow({ openTxtPath: launchTxt });
  launchTxtHandlers.openRemainingMacPendingTxtPaths();
  registerGlobalShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow({});
  });
});

app.on("will-quit", () => {
  unregisterGlobalShortcuts();
});

app.on("window-all-closed", () => {
  // 末窗关闭后须再次 quit；macOS 上 Cmd+Q 首次 quit 常被关窗拦截 cancel，靠此路径收尾
  markAppQuittingForClose();
  app.quit();
});
