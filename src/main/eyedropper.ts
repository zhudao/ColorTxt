import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  ipcMain,
  screen,
  type Display,
  type Rectangle,
} from "electron";
import path from "node:path";
import {
  EYEDROPPER_IPC,
  type EyedropperFormat,
  type EyedropperInitPayload,
  type EyedropperPointerPayload,
} from "@shared/eyedropperIpc";
import {
  prepareStealthForEyedropper,
  restoreStealthAfterEyedropper,
} from "./stealthReader";

/** 标记全屏取色覆盖层，避免被当成用户窗挡 quit / 隐身热键误关 */
const EYEDROPPER_FLAG = "__colortxtEyedropper";

export function isEyedropperWindow(win: BrowserWindow): boolean {
  return (
    (win as unknown as Record<string, unknown>)[EYEDROPPER_FLAG] === true
  );
}

type Shot = {
  display: Display;
  dataUrl: string;
  physWidth: number;
  physHeight: number;
};

type Session = {
  resolve: (hex: string | null) => void;
  windows: BrowserWindow[];
  format: EyedropperFormat;
  lastLabel: string;
  activeSenderId: number;
};

let session: Session | null = null;
/** 进程内记住上次 HEX/RGB，下次进入全屏取色沿用 */
let rememberedFormat: EyedropperFormat = "hex";
const overlayBoundsByWin = new WeakMap<BrowserWindow, Rectangle>();

function finish(result: string | null): void {
  const s = session;
  session = null;
  if (!s) return;
  for (const win of s.windows) {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      /* ignore */
    }
  }
  restoreStealthAfterEyedropper();
  s.resolve(result);
}

export function destroyEyedropperOverlays(): void {
  finish(null);
}

function parseSubmitHex(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

function parseCopyLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length === 0 || t.length > 64) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return `#${t.slice(1).toLowerCase()}`;
  if (/^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(t)) return t;
  return null;
}

function sendToOverlays(channel: string, payload: unknown): void {
  if (!session) return;
  for (const win of session.windows) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

function pointerPayloadForWin(
  win: BrowserWindow,
): EyedropperPointerPayload | null {
  const pt = screen.getCursorScreenPoint();
  const b = win.getBounds();
  if (
    pt.x < b.x ||
    pt.x >= b.x + b.width ||
    pt.y < b.y ||
    pt.y >= b.y + b.height
  ) {
    return null;
  }
  return {
    clientX: pt.x - b.x,
    clientY: pt.y - b.y,
    screenX: pt.x,
    screenY: pt.y,
  };
}

function physicalSize(display: Display): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
  };
}

function physicalOrigin(display: Display): { x: number; y: number } {
  const { bounds, scaleFactor } = display;
  try {
    if (typeof screen.dipToScreenPoint === "function") {
      return screen.dipToScreenPoint({ x: bounds.x, y: bounds.y });
    }
  } catch {
    /* macOS 可能没有 dipToScreenPoint */
  }
  return {
    x: Math.round(bounds.x * scaleFactor),
    y: Math.round(bounds.y * scaleFactor),
  };
}

function isSessionSender(sender: Electron.WebContents): boolean {
  return !!session?.windows.some(
    (w) => !w.isDestroyed() && w.webContents.id === sender.id,
  );
}

async function captureDisplay(display: Display): Promise<Shot | null> {
  const { width: physW, height: physH } = physicalSize(display);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: physW, height: physH },
  });
  const idStr = String(display.id);
  let source = sources.find((s) => s.display_id === idStr);
  if (!source) {
    source = sources.find((s) => {
      const sz = s.thumbnail.getSize();
      return sz.width === physW && sz.height === physH && !s.thumbnail.isEmpty();
    });
  }
  if (!source || source.thumbnail.isEmpty()) return null;
  let img = source.thumbnail;
  const sz = img.getSize();
  if (sz.width !== physW || sz.height !== physH) {
    img = img.resize({ width: physW, height: physH });
  }
  return {
    display,
    dataUrl: img.toDataURL(),
    physWidth: physW,
    physHeight: physH,
  };
}

async function captureAllDisplays(): Promise<Shot[]> {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return [];
  const shots = await Promise.all(displays.map((d) => captureDisplay(d)));
  return shots.filter((s): s is Shot => s != null);
}

function coverDisplay(win: BrowserWindow, bounds: Rectangle): void {
  win.setBounds(bounds, false);
  if (process.platform === "win32") {
    /** 无框窗在 Windows 会被裁到工作区，真全屏才能盖住任务栏 */
    win.setFullScreen(true);
  }
  win.setAlwaysOnTop(true, "screen-saver");
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    /* linux 可能不支持 */
  }
}

function createOverlay(shot: Shot): BrowserWindow {
  const { bounds } = shot.display;
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    backgroundColor: "#000000",
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: true,
    enableLargerThanScreen: true,
    hasShadow: false,
    thickFrame: false,
    show: false,
    alwaysOnTop: true,
    focusable: true,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  (win as unknown as Record<string, unknown>)[EYEDROPPER_FLAG] = true;
  overlayBoundsByWin.set(win, bounds);
  win.setMenuBarVisibility(false);
  win.removeMenu();

  const origin = physicalOrigin(shot.display);
  const payload: EyedropperInitPayload = {
    dataUrl: shot.dataUrl,
    format: session?.format ?? rememberedFormat,
    originX: origin.x,
    originY: origin.y,
    physWidth: shot.physWidth,
    physHeight: shot.physHeight,
  };

  win.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.webContents.send(EYEDROPPER_IPC.init, payload);
  });
  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, _desc, _url, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return;
      finish(null);
    },
  );

  win.on("closed", () => {
    if (session?.windows.includes(win)) finish(null);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, "");
    void win.loadURL(`${base}/eyedropper.html`);
  } else {
    void win.loadFile(
      path.join(__dirname, "../renderer/eyedropper.html"),
    );
  }

  return win;
}

export function registerEyedropperIpc(): void {
  ipcMain.removeHandler(EYEDROPPER_IPC.pick);
  ipcMain.handle(EYEDROPPER_IPC.pick, async () => {
    if (session) finish(null);
    prepareStealthForEyedropper();
    let shots: Shot[] = [];
    try {
      shots = await captureAllDisplays();
    } catch {
      restoreStealthAfterEyedropper();
      return null;
    }
    if (shots.length === 0) {
      restoreStealthAfterEyedropper();
      return null;
    }
    return await new Promise<string | null>((resolve) => {
      session = {
        resolve,
        windows: [],
        format: rememberedFormat,
        lastLabel: "",
        activeSenderId: 0,
      };
      session.windows = shots.map((shot) => createOverlay(shot));
    });
  });

  ipcMain.removeAllListeners(EYEDROPPER_IPC.ready);
  ipcMain.on(EYEDROPPER_IPC.ready, (event) => {
    if (!isSessionSender(event.sender)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    const bounds = overlayBoundsByWin.get(win);
    if (bounds) coverDisplay(win, bounds);
    const pointer = pointerPayloadForWin(win);
    if (pointer) {
      win.focus();
      win.webContents.send(EYEDROPPER_IPC.pointer, pointer);
    }
  });

  ipcMain.removeAllListeners(EYEDROPPER_IPC.submit);
  ipcMain.on(EYEDROPPER_IPC.submit, (event, raw: unknown) => {
    if (!isSessionSender(event.sender)) return;
    const hex = parseSubmitHex(raw);
    if (!hex) return;
    finish(hex);
  });

  ipcMain.removeAllListeners(EYEDROPPER_IPC.cancel);
  ipcMain.on(EYEDROPPER_IPC.cancel, (event) => {
    if (!isSessionSender(event.sender)) return;
    finish(null);
  });

  ipcMain.removeAllListeners(EYEDROPPER_IPC.sample);
  ipcMain.on(EYEDROPPER_IPC.sample, (event, text: unknown) => {
    if (!isSessionSender(event.sender) || !session) return;
    if (
      session.activeSenderId !== 0 &&
      event.sender.id !== session.activeSenderId
    ) {
      return;
    }
    const label = parseCopyLabel(text);
    if (!label) return;
    session.lastLabel = label;
  });

  ipcMain.removeAllListeners(EYEDROPPER_IPC.copy);
  ipcMain.on(EYEDROPPER_IPC.copy, (event) => {
    if (!isSessionSender(event.sender) || !session) return;
    const out = session.lastLabel;
    if (!out) return;
    clipboard.writeText(out);
    sendToOverlays(EYEDROPPER_IPC.copied, null);
  });

  ipcMain.removeAllListeners(EYEDROPPER_IPC.toggleFormat);
  ipcMain.on(EYEDROPPER_IPC.toggleFormat, (event) => {
    if (!isSessionSender(event.sender) || !session) return;
    rememberedFormat = session.format =
      session.format === "hex" ? "rgb" : "hex";
    sendToOverlays(EYEDROPPER_IPC.format, session.format);
  });

  ipcMain.removeAllListeners(EYEDROPPER_IPC.hover);
  ipcMain.on(EYEDROPPER_IPC.hover, (event) => {
    if (!isSessionSender(event.sender) || !session) return;
    session.activeSenderId = event.sender.id;
    const senderId = event.sender.id;
    for (const win of session.windows) {
      if (win.isDestroyed() || win.webContents.id === senderId) continue;
      win.webContents.send(EYEDROPPER_IPC.inactive);
    }
  });
}
