import { BrowserWindow, ipcMain } from "electron";

const allowNextClose = new WeakSet<BrowserWindow>();

/** `app.quit()` 进行中：须绕过关窗拦截，否则 macOS 上 quit 会被 cancel 且进程残留 */
let appIsQuitting = false;

let ipcRegistered = false;

export function markAppQuittingForClose(): void {
  appIsQuitting = true;
}

export function registerWindowCloseGuardIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on("window:proceedClose", (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return;
    allowNextClose.add(win);
    win.close();
  });
}

/**
 * 首次用户关窗时由渲染进程决定是否 `preventDefault`；确认后通过 `window:proceedClose` 再次 `close()`。
 * 须在 `registerWindowCloseGuardIpc()` 之后、窗口创建时调用。
 */
export function attachWindowCloseRequestGuard(win: BrowserWindow) {
  win.on("close", (e) => {
    if (allowNextClose.has(win)) {
      allowNextClose.delete(win);
      return;
    }
    if (appIsQuitting) return;
    e.preventDefault();
    if (!win.webContents.isDestroyed()) {
      win.webContents.send("window:requestClose");
    }
  });
}
