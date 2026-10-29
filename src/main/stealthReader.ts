import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  type MenuItemConstructorOptions,
} from "electron";
import path from "node:path";
import {
  STEALTH_READER_IPC,
  type StealthBounds,
  type StealthCommand,
  type StealthEnterPayload,
  type StealthHoverCursor,
  type StealthPagePayload,
} from "@shared/stealthReaderIpc";
import {
  releaseMacHoverCursor,
  setMacHoverCursor,
  warmMacHoverCursor,
} from "./macNsCursor";
import {
  DEFAULT_STEALTH_NAV_SHORTCUTS,
  normalizeStealthNavShortcuts,
  STEALTH_NAV_SHORTCUT_IDS,
  type StealthNavShortcutMap,
} from "@shared/stealthNavShortcuts";
import {
  closeStealthSettingsWindow,
  openStealthSettingsWindow,
  setStealthOverlayTransparencyRefresher,
  setStealthSettingsOverlayParentResolver,
} from "./stealthSettingsWindow";

const STEALTH_FLAG = "__colortxtStealthReader";

const STEALTH_HOVER_CURSORS = new Set<StealthHoverCursor>([
  "arrow",
  "ns",
  "ew",
  "nesw",
  "nwse",
]);

function isStealthHoverCursor(raw: unknown): raw is StealthHoverCursor {
  return typeof raw === "string" && STEALTH_HOVER_CURSORS.has(raw as StealthHoverCursor);
}

const DEFAULT_EXIT_ACCEL = "F9";

type Session = {
  overlay: BrowserWindow;
  owner: BrowserWindow;
  lastLine: number;
  payload: StealthPagePayload | null;
  /** 热换章待覆盖层拉取；与 boot 用的 payload 分开 */
  pendingPayload: StealthPagePayload | null;
  overlayHiddenByStealthHotkey: boolean;
  onOwnerClosed: () => void;
};

let session: Session | null = null;
let tearingDown = false;
let ipcRegistered = false;
/** 当前摸鱼会话已注册的导航键（可变，设置窗可改）。 */
let navShortcuts: StealthNavShortcutMap = { ...DEFAULT_STEALTH_NAV_SHORTCUTS };
let exitAccelerator = DEFAULT_EXIT_ACCEL;
/** 会话快捷键是否已注册（录制暂停时为 false）。 */
let sessionShortcutsRegistered = false;
/** 渲染进程 updateMinSize 同步过来的字号最小尺寸（setBounds 兜底） */
let overlayMinWidth = 8;
let overlayMinHeight = 8;
/**
 * 逻辑窗位（渲染进程 / 持久化用）。Windows 无边框窗 OS 最小高度约标题栏高（~39px），
 * 小于该值时 OS 会撑高；用 setShape 裁出逻辑尺寸，getBounds 仍回逻辑值。
 */
let overlayLogicalBounds: StealthBounds | null = null;
/** 右键菜单打开时勿 moveTop，避免盖住菜单 */
let overlayMenuOpen = false;
/** 指针在任务栏条带内时的快速重申 */
let stealthTaskbarWatchTimer: ReturnType<typeof setInterval> | null = null;
/** 关窗等 shell 重排时的周期兜底重申 */
let stealthZOrderFallbackTimer: ReturnType<typeof setInterval> | null = null;
let stealthCursorWasOverTaskbar = false;
/** 取消过期的置顶重申（进出任务栏可能连续触发） */
let stealthZOrderReassertGen = 0;
/** macOS：非 key 窗收不到 mouseMoved，改由主进程按屏幕坐标设系统光标。 */
let macHoverCursorTimer: ReturnType<typeof setInterval> | null = null;

const STEALTH_AOT_LEVEL = "screen-saver" as const;
/** 相对同级再抬一层，减轻被任务栏盖住 */
const STEALTH_AOT_RELATIVE = 1;
/** 关窗/任务栏抢层等无法用指针感知的场景，周期兜底 */
const STEALTH_ZORDER_FALLBACK_MS = 700;

export function isStealthReaderWindow(win: BrowserWindow): boolean {
  return (win as unknown as Record<string, unknown>)[STEALTH_FLAG] === true;
}

export function isStealthModeActive(): boolean {
  return session != null && !session.overlay.isDestroyed();
}

/** 当前摸鱼会话的源窗（已 hide，全局显隐热键勿再 show）。 */
export function isStealthSessionOwner(win: BrowserWindow): boolean {
  const s = session;
  return Boolean(s && !s.owner.isDestroyed() && s.owner === win);
}

export function getStealthOverlayWindow(): BrowserWindow | null {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return null;
  return s.overlay;
}

/**
 * 重申透明。`nudge` 时水平微移逼 DWM 重绘（不改宽高）。
 * 悬停仅 setBackgroundColor，避免每次移入都抖一下。
 */
export function refreshStealthOverlayTransparency(opts?: {
  nudge?: boolean;
}): void {
  const win = getStealthOverlayWindow();
  if (!win || win.isDestroyed()) return;
  try {
    win.setBackgroundColor("#00000000");
    if (opts?.nudge) {
      const b = win.getBounds();
      if (b.width > 0 && b.height > 0) {
        win.setBounds({ ...b, x: b.x + 1 }, false);
        win.setBounds(b, false);
        // setBounds 可能冲掉 shape，按逻辑尺寸再裁一次
        applyOverlayShape(win);
      }
    }
    assertStealthOverlayAlwaysOnTop(win);
  } catch {
    /* ignore */
  }
}

/** 重申摸鱼覆盖层置顶（含相对层级）；Win 上必要时 moveTop。 */
function assertStealthOverlayAlwaysOnTop(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  try {
    win.setAlwaysOnTop(true, STEALTH_AOT_LEVEL, STEALTH_AOT_RELATIVE);
    if (process.platform === "win32") {
      try {
        win.moveTop();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** 与摸鱼窗 CSS 边缘热区一致：四边 4px，四角 6px。 */
const MAC_EDGE_PX = 4;
const MAC_CORNER_PX = 6;

function macHoverCursorAtPoint(
  px: number,
  py: number,
  b: StealthBounds,
): StealthHoverCursor | null {
  if (px < b.x || py < b.y || px >= b.x + b.width || py >= b.y + b.height) {
    return null;
  }
  const left = px - b.x;
  const top = py - b.y;
  const right = b.x + b.width - px;
  const bottom = b.y + b.height - py;
  if (left < MAC_CORNER_PX && top < MAC_CORNER_PX) return "nwse";
  if (right < MAC_CORNER_PX && top < MAC_CORNER_PX) return "nesw";
  if (left < MAC_CORNER_PX && bottom < MAC_CORNER_PX) return "nesw";
  if (right < MAC_CORNER_PX && bottom < MAC_CORNER_PX) return "nwse";
  if (top < MAC_EDGE_PX || bottom < MAC_EDGE_PX) return "ns";
  if (left < MAC_EDGE_PX || right < MAC_EDGE_PX) return "ew";
  return "arrow";
}

function stopMacHoverCursorWatch(): void {
  if (macHoverCursorTimer != null) {
    clearInterval(macHoverCursorTimer);
    macHoverCursorTimer = null;
  }
  releaseMacHoverCursor();
}

/**
 * 其它应用在前台时，摸鱼窗收不到 mouseMoved，渲染进程里的光标同步不会跑。
 * 主进程按屏幕坐标判断边缘，并设置系统光标；不把窗口变成 key，避免抢走前台。
 */
function startMacHoverCursorWatch(win: BrowserWindow): void {
  stopMacHoverCursorWatch();
  if (process.platform !== "darwin" || win.isDestroyed()) return;
  macHoverCursorTimer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    const bounds = overlayLogicalBounds ?? win.getBounds();
    const point = screen.getCursorScreenPoint();
    const hit = macHoverCursorAtPoint(point.x, point.y, bounds);
    if (hit && hit !== "arrow") {
      setMacHoverCursor(hit);
      return;
    }
    if (hit === "arrow") setMacHoverCursor("arrow");
    else releaseMacHoverCursor();
  }, 16);
}

function stopStealthZOrderWatch(): void {
  stealthZOrderReassertGen += 1;
  stealthCursorWasOverTaskbar = false;
  if (stealthTaskbarWatchTimer != null) {
    clearInterval(stealthTaskbarWatchTimer);
    stealthTaskbarWatchTimer = null;
  }
  if (stealthZOrderFallbackTimer != null) {
    clearInterval(stealthZOrderFallbackTimer);
    stealthZOrderFallbackTimer = null;
  }
}

/**
 * 工作区外、显示器 bounds 内 = 任务栏/侧栏等 shell 条带。
 * 摸鱼窗 focusable:false，点任务栏不会再走失活事件，靠指针位置做快速路径。
 */
function isCursorOverTaskbarStrip(): boolean {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { bounds, workArea } = display;
  if (
    point.x < bounds.x ||
    point.y < bounds.y ||
    point.x >= bounds.x + bounds.width ||
    point.y >= bounds.y + bounds.height
  ) {
    return false;
  }
  return (
    point.x < workArea.x ||
    point.y < workArea.y ||
    point.x >= workArea.x + workArea.width ||
    point.y >= workArea.y + workArea.height
  );
}

function tryAssertStealthOverlayZOrder(): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;
  if (s.overlayHiddenByStealthHotkey || overlayMenuOpen) return;
  if (!s.overlay.isVisible()) return;
  assertStealthOverlayAlwaysOnTop(s.overlay);
}

/**
 * Windows：shell 常把覆盖层压到任务栏下（点任务栏、关其它窗后的层级重排等）。
 * - 指针进入任务栏条带：立刻分拍重申（快路径）
 * - 周期兜底：盖住关窗等指针感知不到的场景
 * 真·事件驱动需 SetWinEventHook（额外 FFI），目前不引入。
 */
function scheduleStealthZOrderReassert(): void {
  const gen = ++stealthZOrderReassertGen;
  for (const ms of [0, 80, 250]) {
    setTimeout(() => {
      if (gen !== stealthZOrderReassertGen) return;
      tryAssertStealthOverlayZOrder();
    }, ms);
  }
}

function onStealthTaskbarWatchTick(): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;
  if (s.overlayHiddenByStealthHotkey || overlayMenuOpen) return;
  if (!s.overlay.isVisible()) return;
  const over = isCursorOverTaskbarStrip();
  if (over && !stealthCursorWasOverTaskbar) {
    scheduleStealthZOrderReassert();
  } else if (over) {
    assertStealthOverlayAlwaysOnTop(s.overlay);
  } else if (!over && stealthCursorWasOverTaskbar) {
    scheduleStealthZOrderReassert();
  }
  stealthCursorWasOverTaskbar = over;
}

function startStealthZOrderWatch(_overlay: BrowserWindow): void {
  stopStealthZOrderWatch();
  if (process.platform !== "win32" || _overlay.isDestroyed()) return;
  stealthTaskbarWatchTimer = setInterval(onStealthTaskbarWatchTick, 200);
  stealthZOrderFallbackTimer = setInterval(
    tryAssertStealthOverlayZOrder,
    STEALTH_ZORDER_FALLBACK_MS,
  );
}

function clearOverlayShape(win: BrowserWindow): void {
  try {
    if (typeof win.setShape === "function") {
      win.setShape([]);
    }
  } catch {
    /* macOS 等不支持 */
  }
}

/** OS 窗大于逻辑尺寸时裁剪可视/点击区域（Windows 最小高度绕过）。 */
function applyOverlayShape(win: BrowserWindow): void {
  const logical = overlayLogicalBounds;
  if (!logical || win.isDestroyed()) return;
  if (typeof win.setShape !== "function") return;
  try {
    const after = win.getBounds();
    const needShape =
      after.width > logical.width + 1 || after.height > logical.height + 1;
    if (needShape) {
      win.setShape([
        {
          x: 0,
          y: 0,
          width: Math.max(1, logical.width),
          height: Math.max(1, logical.height),
        },
      ]);
    } else {
      win.setShape([]);
    }
  } catch {
    /* ignore */
  }
}

function applyOverlayLogicalBounds(
  win: BrowserWindow,
  bounds: StealthBounds,
): void {
  const next = clampBoundsToDisplay(bounds);
  overlayLogicalBounds = next;
  win.setMinimumSize(overlayMinWidth, overlayMinHeight);
  win.setBounds(next);
  // 部分 Windows/DPI 下 setBounds 会悄悄小于 min，读回再钉死（仅钉逻辑下限）
  const after = win.getBounds();
  if (after.width < overlayMinWidth || after.height < overlayMinHeight) {
    const repaired = clampBoundsToDisplay({
      x: after.x,
      y: after.y,
      width: Math.max(after.width, overlayMinWidth),
      height: Math.max(after.height, overlayMinHeight),
    });
    overlayLogicalBounds = repaired;
    win.setBounds(repaired);
  }
  applyOverlayShape(win);
}

function sendCommand(command: StealthCommand, extra?: string): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;
  s.overlay.webContents.send(STEALTH_READER_IPC.command, command, extra ?? "");
}

function navShortcutEntries(): { accel: string; command: StealthCommand }[] {
  return STEALTH_NAV_SHORTCUT_IDS.map((id) => ({
    accel: navShortcuts[id],
    command: id,
  }));
}

function unregisterPageShortcuts(): void {
  for (const { accel } of navShortcutEntries()) {
    if (!accel) continue;
    try {
      globalShortcut.unregister(accel);
    } catch {
      /* ignore */
    }
  }
  if (exitAccelerator) {
    try {
      globalShortcut.unregister(exitAccelerator);
    } catch {
      /* ignore */
    }
  }
  sessionShortcutsRegistered = false;
}

function registerPageShortcuts(): void {
  if (!session || session.overlay.isDestroyed()) return;
  unregisterPageShortcuts();
  const seen = new Set<string>();
  for (const { accel, command } of navShortcutEntries()) {
    if (!accel || seen.has(accel)) continue;
    seen.add(accel);
    const ok = globalShortcut.register(accel, () => {
      sendCommand(command);
    });
    if (!ok) {
      console.warn(`[stealthReader] 无法注册全局快捷键 ${accel}`);
    }
  }
  if (exitAccelerator && !seen.has(exitAccelerator)) {
    const exitOk = globalShortcut.register(exitAccelerator, () => {
      sendCommand("exit");
    });
    if (!exitOk) {
      console.warn(`[stealthReader] 无法注册全局快捷键 ${exitAccelerator}`);
    }
  }
  sessionShortcutsRegistered = true;
}

/** 录制快捷键时暂停摸鱼全局键，避免无法录入。 */
export function suspendStealthSessionShortcuts(): void {
  if (!sessionShortcutsRegistered) return;
  unregisterPageShortcuts();
}

/** 录制结束后若仍在摸鱼模式则恢复。 */
export function resumeStealthSessionShortcuts(): void {
  if (!isStealthModeActive()) return;
  registerPageShortcuts();
}

export function applyStealthNavShortcuts(raw: unknown): void {
  navShortcuts = normalizeStealthNavShortcuts(raw);
  if (isStealthModeActive()) {
    registerPageShortcuts();
  }
}

/** 取色前让摸鱼覆盖层退至取色层之下（保持可见，便于对着正文取样）。 */
export function prepareStealthForEyedropper(): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;
  s.overlay.setAlwaysOnTop(false);
}

export function restoreStealthAfterEyedropper(): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;
  if (s.overlayHiddenByStealthHotkey) return;
  s.overlay.setFocusable(false);
  s.overlay.showInactive();
  assertStealthOverlayAlwaysOnTop(s.overlay);
}

function clampBoundsToDisplay(bounds: StealthBounds): StealthBounds {
  const { x, y, width, height } = bounds;
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  });
  // 用整屏 bounds（含任务栏区域），摸鱼窗可拖到任务栏上；z-order 用 screen-saver。
  const area = display.bounds;
  const minW = Math.max(8, overlayMinWidth);
  const minH = Math.max(8, overlayMinHeight);
  const w = Math.max(minW, Math.round(width));
  const h = Math.max(minH, Math.round(height));
  const maxX = area.x + Math.max(0, area.width - w);
  const maxY = area.y + Math.max(0, area.height - h);
  return {
    x: Math.min(maxX, Math.max(area.x, Math.round(x))),
    y: Math.min(maxY, Math.max(area.y, Math.round(y))),
    width: Math.min(w, area.width),
    height: Math.min(h, area.height),
  };
}

function defaultBounds(): StealthBounds {
  const area = screen.getPrimaryDisplay().bounds;
  const width = Math.min(320, area.width);
  const height = Math.min(180, area.height);
  return {
    x: area.x + Math.max(0, area.width - width - 24),
    y: area.y + 24,
    width,
    height,
  };
}

function loadStealthHtml(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, "");
    void win.loadURL(`${base}/stealth-reader.html`);
    return;
  }
  void win.loadFile(
    path.join(__dirname, "../renderer/stealth-reader.html"),
  );
}

/** 空标题，避免偶发系统 chrome 露出应用名。 */
function lockEmptyWindowTitle(win: BrowserWindow): void {
  win.setTitle("");
  win.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    if (!win.isDestroyed()) win.setTitle("");
  });
}

function createOverlayWindow(bounds: StealthBounds): BrowserWindow {
  const b = clampBoundsToDisplay(bounds);
  const opts: Electron.BrowserWindowConstructorOptions = {
    show: false,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 8,
    minHeight: 8,
    title: "",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    thickFrame: false,
    // Electron 文档：透明窗设 resizable:true 在部分平台会异常；缩放走 setBounds。
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    // 失焦时避免 DWM 给透明区填实心底（部分 Win11 + Electron）
    backgroundMaterial: "none",
    // 点击不激活；翻页键走全局快捷键。
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (process.platform === "win32") {
    opts.type = "toolbar";
  }
  const win = new BrowserWindow(opts);
  (win as unknown as Record<string, unknown>)[STEALTH_FLAG] = true;
  overlayLogicalBounds = b;
  assertStealthOverlayAlwaysOnTop(win);
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    /* 部分平台不支持 */
  }
  win.setMenuBarVisibility(false);
  win.removeMenu();
  win.setBackgroundColor("#00000000");
  win.setFocusable(false);
  win.setResizable(false);
  lockEmptyWindowTitle(win);
  applyOverlayShape(win);
  warmMacHoverCursor();

  win.webContents.on("before-input-event", (event, input) => {
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

  loadStealthHtml(win);
  return win;
}

/**
 * 覆盖层 `setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })` 在 macOS 上会
 * `DockHide`（进程变成 UIElement），程序坞图标消失。关窗不会自动 DockShow。
 * 应用未激活时 `dock.show()` 只改回前台策略，不会把应用抢到前面。
 */
function restoreDarwinDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  try {
    if (!app.dock.isVisible()) void app.dock.show();
  } catch {
    /* 退出过程中可能已不可调 */
  }
}

function restoreOwner(owner: BrowserWindow, line: number): void {
  if (owner.isDestroyed()) return;
  owner.setSkipTaskbar(false);
  owner.show();
  owner.focus();
  if (!owner.webContents.isDestroyed()) {
    owner.webContents.send(STEALTH_READER_IPC.ownerProgress, {
      line,
      focus: true,
    });
  }
}

function teardown(restore: boolean): void {
  if (tearingDown) return;
  tearingDown = true;
  stopMacHoverCursorWatch();
  const s = session;
  session = null;
  stopStealthZOrderWatch();
  overlayMenuOpen = false;
  unregisterPageShortcuts();
  closeStealthSettingsWindow();
  const line = s?.lastLine ?? 1;
  if (s && !s.owner.isDestroyed()) {
    s.owner.removeListener("closed", s.onOwnerClosed);
  }
  const overlay = s?.overlay;
  if (overlay && !overlay.isDestroyed()) {
    clearOverlayShape(overlay);
    overlay.destroy();
  }
  overlayLogicalBounds = null;
  restoreDarwinDockIcon();
  if (restore && s && !s.owner.isDestroyed()) {
    restoreOwner(s.owner, line);
  }
  tearingDown = false;
}

export function destroyStealthReaderWindow(): void {
  teardown(false);
}

/** Ctrl+`：显隐覆盖层；不把源窗口 show 回来。 */
export function toggleStealthOverlayVisibility(): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;
  setStealthOverlayHiddenByHotkey(!s.overlayHiddenByStealthHotkey && s.overlay.isVisible());
}

/** 与全局「显示/隐藏阅读器」同向：hidden=true 藏覆盖层。 */
export function setStealthOverlayHiddenByHotkey(hidden: boolean): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;
  if (hidden) {
    s.overlay.hide();
    s.overlayHiddenByStealthHotkey = true;
    stopStealthZOrderWatch();
    stopMacHoverCursorWatch();
    return;
  }
  s.overlayHiddenByStealthHotkey = false;
  s.overlay.setFocusable(false);
  s.overlay.showInactive();
  assertStealthOverlayAlwaysOnTop(s.overlay);
  startStealthZOrderWatch(s.overlay);
  startMacHoverCursorWatch(s.overlay);
}

function enterFromOwner(
  owner: BrowserWindow,
  payload: StealthEnterPayload,
): { ok: boolean; message?: string } {
  if (session && !session.overlay.isDestroyed()) {
    if (session.owner === owner) {
      if (session.overlayHiddenByStealthHotkey) {
        toggleStealthOverlayVisibility();
      }
      return { ok: false, message: "已在摸鱼模式中" };
    }
    // 单例：其它窗口抢占时先退出并恢复当前源窗
    teardown(true);
  }
  const text = typeof payload.text === "string" ? payload.text : "";
  if (!text) {
    return { ok: false, message: "没有可阅读的正文" };
  }
  const startLine = Math.max(1, Math.floor(Number(payload.startLine) || 1));
  const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const bounds =
    payload.bounds &&
    Number.isFinite(payload.bounds.width) &&
    Number.isFinite(payload.bounds.height)
      ? clampBoundsToDisplay(payload.bounds)
      : defaultBounds();

  const overlay = createOverlayWindow(bounds);
  const onOwnerClosed = () => {
    if (session?.owner === owner) teardown(false);
  };
  const exitRaw =
    typeof payload.exitAccelerator === "string"
      ? payload.exitAccelerator.trim()
      : "";
  exitAccelerator = exitRaw || DEFAULT_EXIT_ACCEL;
  navShortcuts = normalizeStealthNavShortcuts(payload.navShortcuts);
  const pagePayload: StealthPagePayload = {
    text,
    startLine,
    chapters,
  };
  if (typeof payload.hasPrevChapter === "boolean") {
    pagePayload.hasPrevChapter = payload.hasPrevChapter;
  }
  if (typeof payload.hasNextChapter === "boolean") {
    pagePayload.hasNextChapter = payload.hasNextChapter;
  }
  session = {
    overlay,
    owner,
    lastLine: startLine,
    payload: pagePayload,
    pendingPayload: null,
    overlayHiddenByStealthHotkey: false,
    onOwnerClosed,
  };

  overlay.on("closed", () => {
    if (session?.overlay === overlay) {
      teardown(true);
    }
  });
  owner.on("closed", onOwnerClosed);

  overlay.once("ready-to-show", () => {
    if (overlay.isDestroyed() || !session) return;
    if (!owner.isDestroyed()) {
      owner.setSkipTaskbar(true);
      owner.hide();
    }
    overlay.setFocusable(false);
    overlay.showInactive();
    assertStealthOverlayAlwaysOnTop(overlay);
    registerPageShortcuts();
    startStealthZOrderWatch(overlay);
    startMacHoverCursorWatch(overlay);
  });

  return { ok: true };
}

function setMenuOpen(open: boolean): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;
  overlayMenuOpen = open;
  s.overlay.webContents.send(STEALTH_READER_IPC.menuOpen, open);
  // 菜单关掉后立刻抢回置顶，避免点任务栏场景下长时间被压住
  if (!open && !s.overlayHiddenByStealthHotkey) {
    assertStealthOverlayAlwaysOnTop(s.overlay);
  }
}

function popupContextMenu(timedScrollActive: boolean): void {
  const s = session;
  if (!s || s.overlay.isDestroyed()) return;

  const template: MenuItemConstructorOptions[] = [
    {
      label: "定时滚动",
      type: "checkbox",
      checked: timedScrollActive,
      click: () => sendCommand("toggleTimedScroll"),
    },
    { type: "separator" },
    {
      label: "设置",
      click: () => {
        setMenuOpen(false);
        openStealthSettingsWindow();
      },
    },
    { type: "separator" },
    {
      label: "退出摸鱼模式",
      // 仅展示；实际退出已由 globalShortcut 注册，避免菜单再抢一次
      ...(exitAccelerator
        ? { accelerator: exitAccelerator, registerAccelerator: false }
        : {}),
      click: () => sendCommand("exit"),
    },
  ];

  setMenuOpen(true);
  const menu = Menu.buildFromTemplate(template);
  menu.popup({
    window: s.overlay,
    callback: () => setMenuOpen(false),
  });
}

export function registerStealthReaderIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  setStealthSettingsOverlayParentResolver(() => getStealthOverlayWindow());
  setStealthOverlayTransparencyRefresher(() =>
    refreshStealthOverlayTransparency({ nudge: true }),
  );

  ipcMain.handle(STEALTH_READER_IPC.enter, (evt, raw: unknown) => {
    const owner = BrowserWindow.fromWebContents(evt.sender);
    if (!owner || owner.isDestroyed()) {
      return { ok: false, message: "窗口已关闭" };
    }
    const payload = (raw ?? {}) as StealthEnterPayload;
    return enterFromOwner(owner, payload);
  });

  ipcMain.handle(STEALTH_READER_IPC.getPayload, (evt) => {
    const s = session;
    if (!s || s.overlay.webContents !== evt.sender) return null;
    const payload = s.payload;
    s.payload = null;
    return payload;
  });

  ipcMain.on(STEALTH_READER_IPC.ownerChapterNav, (evt, raw: unknown) => {
    const s = session;
    if (!s || s.overlay.webContents !== evt.sender) return;
    let direction: "prev" | "next" | null = null;
    let anchor: "start" | "end" = "start";
    if (raw === "prev" || raw === "next") {
      direction = raw;
    } else if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      const d = o.direction;
      if (d === "prev" || d === "next") direction = d;
      if (o.anchor === "end") anchor = "end";
    }
    if (!direction) return;
    if (s.owner.isDestroyed() || s.owner.webContents.isDestroyed()) return;
    s.owner.webContents.send(STEALTH_READER_IPC.ownerChapterNav, {
      direction,
      anchor,
    });
  });

  ipcMain.handle(STEALTH_READER_IPC.updatePayload, (evt, raw: unknown) => {
    const s = session;
    const senderWin = BrowserWindow.fromWebContents(evt.sender);
    if (!s || !senderWin || senderWin !== s.owner) {
      return { ok: false, message: "不在摸鱼模式或非源窗" };
    }
    if (s.overlay.isDestroyed()) {
      return { ok: false, message: "摸鱼窗已关闭" };
    }
    const o = (raw ?? {}) as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : "";
    if (!text) {
      return { ok: false, message: "没有可阅读的正文" };
    }
    const startLine = Math.max(1, Math.floor(Number(o.startLine) || 1));
    const chapters = Array.isArray(o.chapters) ? o.chapters : [];
    const anchor = o.anchor === "end" ? "end" : "start";
    const page: StealthPagePayload = {
      text,
      startLine,
      chapters: chapters as StealthPagePayload["chapters"],
      anchor,
    };
    if (typeof o.hasPrevChapter === "boolean") {
      page.hasPrevChapter = o.hasPrevChapter;
    }
    if (typeof o.hasNextChapter === "boolean") {
      page.hasNextChapter = o.hasNextChapter;
    }
    s.lastLine = startLine;
    s.pendingPayload = page;
    // 只走 pending + command，避免大正文双通道 IPC
    s.overlay.webContents.send(
      STEALTH_READER_IPC.command,
      "reloadPayload" satisfies StealthCommand,
      "",
    );
    return { ok: true };
  });

  ipcMain.handle(STEALTH_READER_IPC.getPendingPayload, (evt) => {
    const s = session;
    if (!s || s.overlay.webContents !== evt.sender) return null;
    const payload = s.pendingPayload;
    s.pendingPayload = null;
    return payload;
  });

  ipcMain.on(STEALTH_READER_IPC.chapterNavSettled, (evt) => {
    const s = session;
    if (!s || s.owner.webContents !== evt.sender) return;
    // 成功热换会先写入 pending；有 pending 时由 reloadPayload 收尾
    if (s.pendingPayload) return;
    if (s.overlay.isDestroyed()) return;
    s.overlay.webContents.send(
      STEALTH_READER_IPC.command,
      "chapterNavSettled" satisfies StealthCommand,
      "",
    );
  });

  ipcMain.on(STEALTH_READER_IPC.exit, (evt, line: unknown) => {
    const s = session;
    if (!s || s.overlay.webContents !== evt.sender) return;
    const n = Math.max(1, Math.floor(Number(line) || s.lastLine));
    s.lastLine = n;
    teardown(true);
  });

  ipcMain.on(STEALTH_READER_IPC.popupMenu, (evt, raw: unknown) => {
    const s = session;
    if (!s || s.overlay.webContents !== evt.sender) return;
    const timedScrollActive =
      raw != null &&
      typeof raw === "object" &&
      (raw as { timedScrollActive?: unknown }).timedScrollActive === true;
    popupContextMenu(timedScrollActive);
  });

  ipcMain.on(STEALTH_READER_IPC.setNavShortcuts, (_evt, raw: unknown) => {
    applyStealthNavShortcuts(raw);
  });

  ipcMain.handle(STEALTH_READER_IPC.getBounds, (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return null;
    // 优先逻辑尺寸：Windows 上 OS getBounds 可能被系统最小高度撑高
    if (overlayLogicalBounds) return { ...overlayLogicalBounds };
    return win.getBounds();
  });

  ipcMain.on(STEALTH_READER_IPC.getCursorScreenPoint, (evt) => {
    const p = screen.getCursorScreenPoint();
    evt.returnValue = { x: p.x, y: p.y };
  });

  ipcMain.on(STEALTH_READER_IPC.setHoverCursor, (evt, raw: unknown) => {
    evt.returnValue = null;
    if (process.platform !== "darwin") return;
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return;
    if (!(win as unknown as Record<string, unknown>)[STEALTH_FLAG]) return;
    if (!isStealthHoverCursor(raw)) return;
    setMacHoverCursor(raw);
  });

  ipcMain.on(STEALTH_READER_IPC.setBounds, (evt, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed() || !raw || typeof raw !== "object") return;
    const o = raw as Record<string, unknown>;
    const bounds = {
      x: Number(o.x),
      y: Number(o.y),
      width: Number(o.width),
      height: Number(o.height),
    };
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height)
    ) {
      return;
    }
    applyOverlayLogicalBounds(win, bounds);
  });

  ipcMain.on(STEALTH_READER_IPC.setPosition, (evt, x: unknown, y: unknown) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return;
    const nx = Math.round(Number(x));
    const ny = Math.round(Number(y));
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    // Win11 上纯 setPosition 可能清掉 setShape，或让 HWND 宽高漂移；
    // 有逻辑窗位时改走 setBounds，钉死宽高并重裁 shape。
    if (overlayLogicalBounds) {
      applyOverlayLogicalBounds(win, {
        ...overlayLogicalBounds,
        x: nx,
        y: ny,
      });
      return;
    }
    win.setPosition(nx, ny);
  });

  ipcMain.on(STEALTH_READER_IPC.setMinSize, (evt, w: unknown, h: unknown) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return;
    const width = Math.max(1, Math.round(Number(w) || 1));
    const height = Math.max(1, Math.round(Number(h) || 1));
    overlayMinWidth = width;
    overlayMinHeight = height;
    win.setMinimumSize(width, height);
    // 仅 setMinimumSize 不会抬高已偏小的窗；字号变大时要把当前高度/宽度撑到能显示一行
    const b = overlayLogicalBounds ?? win.getBounds();
    if (b.width >= width && b.height >= height) {
      applyOverlayShape(win);
      return;
    }
    applyOverlayLogicalBounds(win, {
      x: b.x,
      y: b.y,
      width: Math.max(b.width, width),
      height: Math.max(b.height, height),
    });
  });

  ipcMain.on(STEALTH_READER_IPC.blur, (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return;
    win.setFocusable(false);
    win.blur();
  });

  ipcMain.on(STEALTH_READER_IPC.refreshTransparency, (evt, nudge: unknown) => {
    const s = session;
    if (!s || s.overlay.webContents !== evt.sender) return;
    refreshStealthOverlayTransparency({ nudge: nudge === true });
  });

  ipcMain.handle(STEALTH_READER_IPC.prepareEyedropper, () => {
    prepareStealthForEyedropper();
  });

  ipcMain.handle(STEALTH_READER_IPC.restoreEyedropper, () => {
    restoreStealthAfterEyedropper();
  });
}
