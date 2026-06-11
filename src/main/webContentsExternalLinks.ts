import type { WebContents } from "electron";
import { shell } from "electron";

/** Monaco hover / 编辑器内链点击会 `window.open`；在 Electron 中改走系统浏览器 */
export function isShellOpenExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "http:" ||
      u.protocol === "https:" ||
      u.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function openInSystemBrowser(url: string): void {
  if (!isShellOpenExternalUrl(url)) return;
  void shell.openExternal(url);
}

/** 拦截 `window.open` 与顶层 `will-navigate`，避免在应用内嵌窗口打开外链 */
export function attachWebContentsExternalLinkPolicy(
  webContents: WebContents,
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isShellOpenExternalUrl(url)) {
      openInSystemBrowser(url);
    }
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isShellOpenExternalUrl(navigationUrl)) return;
    let appOrigin = "";
    try {
      appOrigin = new URL(webContents.getURL()).origin;
    } catch {
      appOrigin = "";
    }
    try {
      if (new URL(navigationUrl).origin === appOrigin) return;
    } catch {
      return;
    }
    event.preventDefault();
    openInSystemBrowser(navigationUrl);
  });
}
