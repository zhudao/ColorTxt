import { BrowserWindow } from "electron";
import { isBackstageWebViewWindow } from "./bookSource/engine/backstageWebView";
import { isEyedropperWindow } from "./eyedropper";
import { isStealthReaderWindow } from "./stealthReader";
import { isStealthSettingsWindow } from "./stealthSettingsWindow";
import type { CreateMainWindow } from "./windowFactory";

/** 可读主窗口：排除找书窗与后台 webView */
export function listMainReaderWindows(
  findBookWindowByWindowId: Map<number, boolean>,
): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (w) =>
      !w.isDestroyed() &&
      !findBookWindowByWindowId.get(w.id) &&
      !isBackstageWebViewWindow(w) &&
      !isEyedropperWindow(w) &&
      !isStealthReaderWindow(w) &&
      !isStealthSettingsWindow(w),
  );
}

/** 找书窗口列表 */
export function listFindBookWindows(
  findBookWindowByWindowId: Map<number, boolean>,
): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (w) => !w.isDestroyed() && findBookWindowByWindowId.get(w.id) === true,
  );
}

function pickPreferredMainWindow(
  mains: BrowserWindow[],
  mainWindowFocusState: { lastId: number | null },
): BrowserWindow {
  const preferred = mainWindowFocusState.lastId
    ? mains.find((w) => w.id === mainWindowFocusState.lastId)
    : undefined;
  return preferred ?? mains[mains.length - 1]!;
}

function pickPreferredFindBookWindow(findBooks: BrowserWindow[]): BrowserWindow {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && findBooks.some((w) => w.id === focused.id)) {
    return focused;
  }
  return findBooks[findBooks.length - 1]!;
}

/** 聚焦已有主窗口；若无则新建 */
export function focusOrOpenMainReaderWindow(options: {
  createWindow: CreateMainWindow;
  findBookWindowByWindowId: Map<number, boolean>;
  mainWindowFocusState: { lastId: number | null };
}): void {
  const { createWindow, findBookWindowByWindowId, mainWindowFocusState } =
    options;
  const mains = listMainReaderWindows(findBookWindowByWindowId);
  if (mains.length === 0) {
    createWindow({});
    return;
  }
  const target = pickPreferredMainWindow(mains, mainWindowFocusState);
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  mainWindowFocusState.lastId = target.id;
}

/** 聚焦已有找书窗口；若无则新建 */
export function focusOrOpenFindBookWindow(options: {
  createWindow: CreateMainWindow;
  findBookWindowByWindowId: Map<number, boolean>;
}): void {
  const { createWindow, findBookWindowByWindowId } = options;
  const findBooks = listFindBookWindows(findBookWindowByWindowId);
  if (findBooks.length === 0) {
    createWindow({ openFindBook: true });
    return;
  }
  const target = pickPreferredFindBookWindow(findBooks);
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}

/** 在主阅读窗口打开 txt；无主窗口时新建并带上路径 */
export function openTxtInMainWindow(options: {
  filePath: string;
  createWindow: CreateMainWindow;
  findBookWindowByWindowId: Map<number, boolean>;
  mainWindowFocusState: { lastId: number | null };
}): void {
  const {
    filePath,
    createWindow,
    findBookWindowByWindowId,
    mainWindowFocusState,
  } = options;
  const mains = listMainReaderWindows(findBookWindowByWindowId);
  if (mains.length === 0) {
    createWindow({ openTxtPath: filePath });
    return;
  }
  const target = pickPreferredMainWindow(mains, mainWindowFocusState);
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  mainWindowFocusState.lastId = target.id;
  target.webContents.send("app:open-txt-path", filePath);
}
