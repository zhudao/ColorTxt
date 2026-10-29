import { BrowserWindow } from "electron";
import { BOOK_SOURCE_IPC, type BookSourceToastEvent } from "@shared/bookSource/ipc";

function isAppRendererWindow(win: BrowserWindow): boolean {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
  const url = win.webContents.getURL();
  return !url.startsWith("data:") && url !== "about:blank";
}

/** 主进程 → 各应用渲染窗口：`java.toast` / `java.longToast` → `appToast` */
export function emitBookSourceToast(message: string, long = false): void {
  const text = String(message ?? "").trim();
  if (!text) return;
  const payload: BookSourceToastEvent = { message: text, long };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isAppRendererWindow(win)) continue;
    win.webContents.send(BOOK_SOURCE_IPC.toast, payload);
  }
}
