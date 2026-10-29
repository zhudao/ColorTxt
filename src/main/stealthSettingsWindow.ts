import { BrowserWindow, app, ipcMain, screen } from "electron";
import path from "node:path";
import { STEALTH_SETTINGS_IPC } from "@shared/stealthSettingsIpc";

const STEALTH_SETTINGS_FLAG = "__colortxtStealthSettings";

const SETTINGS_WIDTH = 620;
const SETTINGS_HEIGHT = 490;
const SETTINGS_MIN_WIDTH = 620;
const SETTINGS_MIN_HEIGHT = 490;

/**
 * 不把透明摸鱼窗设为 parent（Windows 上会直接丢掉透明）。
 * 设置窗用较低的 alwaysOnTop 档，避免与覆盖层同为 screen-saver 抢 DWM。
 */
let settingsWin: BrowserWindow | null = null;
let ipcRegistered = false;

/** 确认仍在摸鱼会话中。 */
let resolveOverlayParent: (() => BrowserWindow | null) | null = null;
/** 由 stealthReader 注入：重申透明（不改窗高）。 */
let refreshOverlayTransparency: (() => void) | null = null;
/** 设置窗关闭时回调（如恢复录制时暂停的全局快捷键）。 */
let onSettingsWindowClosed: (() => void) | null = null;

export function isStealthSettingsWindow(win: BrowserWindow): boolean {
  return (win as unknown as Record<string, unknown>)[STEALTH_SETTINGS_FLAG] === true;
}

export function setStealthSettingsOverlayParentResolver(
  fn: () => BrowserWindow | null,
): void {
  resolveOverlayParent = fn;
}

export function setStealthOverlayTransparencyRefresher(fn: () => void): void {
  refreshOverlayTransparency = fn;
}

export function setStealthSettingsClosedHandler(fn: () => void): void {
  onSettingsWindowClosed = fn;
}

function resolveStealthSettingsIconPath(): string {
  const fileName =
    process.platform === "win32" ? "emituofo.ico" : "emituofo.png";
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(app.getAppPath(), "resources", fileName);
}

function loadSettingsHtml(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/stealth-settings.html`);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/stealth-settings.html"));
  }
}

/** 用户主动打开设置时居中到指针所在屏的工作区。 */
function centerOnScreen(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { workArea } = display;
  const b = win.getBounds();
  const x = Math.round(workArea.x + (workArea.width - b.width) / 2);
  const y = Math.round(workArea.y + (workArea.height - b.height) / 2);
  win.setBounds({
    x,
    y,
    width: b.width,
    height: b.height,
  });
}

function showSettingsWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  centerOnScreen(win);
  // floating 低于 screen-saver：盖住普通窗即可，不与摸鱼覆盖层抢同一 DWM 档
  win.setAlwaysOnTop(true, "floating");
  win.show();
  win.focus();
  // 抢焦点后摸鱼窗易被 DWM 垫实心底；水平微移重申透明（不改高度）
  refreshOverlayTransparency?.();
}

export function openStealthSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    showSettingsWindow(settingsWin);
    return;
  }

  const overlay = resolveOverlayParent?.() ?? null;
  if (!overlay || overlay.isDestroyed()) {
    console.warn("[stealthSettings] 无摸鱼覆盖层，无法打开设置窗");
    return;
  }

  const win = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    minWidth: SETTINGS_MIN_WIDTH,
    minHeight: SETTINGS_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    title: "摸鱼设置",
    icon: resolveStealthSettingsIconPath(),
    // 故意不设 parent：透明覆盖层作 parent 会在 Windows 上变成白/灰实心底
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  (win as unknown as Record<string, unknown>)[STEALTH_SETTINGS_FLAG] = true;
  settingsWin = win;
  win.setMenuBarVisibility(false);
  win.removeMenu();

  win.on("closed", () => {
    if (settingsWin === win) settingsWin = null;
    // 录制弹层未关就关窗时，渲染进程可能来不及 resume，由主进程兜底。
    onSettingsWindowClosed?.();
    refreshOverlayTransparency?.();
  });

  win.once("ready-to-show", () => {
    showSettingsWindow(win);
  });

  loadSettingsHtml(win);
}

export function closeStealthSettingsWindow(): void {
  const win = settingsWin;
  settingsWin = null;
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
  refreshOverlayTransparency?.();
}

export function registerStealthSettingsIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.handle(STEALTH_SETTINGS_IPC.open, () => {
    openStealthSettingsWindow();
  });
  ipcMain.handle(STEALTH_SETTINGS_IPC.close, () => {
    closeStealthSettingsWindow();
  });
}
