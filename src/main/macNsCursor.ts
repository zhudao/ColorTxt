/**
 * macOS 上，不可聚焦的透明窗不会成为 key window，
 * AppKit 因此忽略 CSS cursor（Windows 无此限制）。
 * 摸鱼窗边缘悬停时直接 `[NSCursor set]`。
 * 其它应用在前台时，还要打开连接属性 SetsCursorInBackground，
 * 否则系统光标不会跟着变，也不能把摸鱼窗做成 key（那会抢走前台）。
 */
import { createRequire } from "node:module";
import type { StealthHoverCursor } from "@shared/stealthReaderIpc";

const require = createRequire(import.meta.url);

/** kCFStringEncodingUTF8 */
const CF_STRING_UTF8 = 0x08000100;

type KoffiLib = {
  func: (signature: string) => (...args: unknown[]) => unknown;
  symbol: (name: string) => unknown;
};

type KoffiModule = {
  load: (library: string) => KoffiLib;
  decode: (value: unknown, type: string) => unknown;
};

/** 私有窗口缩放光标（无中间横杠）；失败时退回公开的行列缩放光标。 */
const CURSOR_SELECTORS: Record<StealthHoverCursor, readonly [string, string]> = {
  arrow: ["arrowCursor", "arrowCursor"],
  ns: ["_windowResizeNorthSouthCursor", "resizeUpDownCursor"],
  ew: ["_windowResizeEastWestCursor", "resizeLeftRightCursor"],
  nesw: ["_windowResizeNorthEastSouthWestCursor", "resizeLeftRightCursor"],
  nwse: ["_windowResizeNorthWestSouthEastCursor", "resizeLeftRightCursor"],
};

let msgSend: ((receiver: unknown, sel: unknown) => unknown) | null = null;
let selRegister: ((name: string) => unknown) | null = null;
let nsCursorClass: unknown = null;
let setSelector: unknown = null;
const cursorBySelector = new Map<string, unknown>();
let loadFailed = false;
let lastKind: StealthHoverCursor | null = null;
let backgroundCursorReady = false;

/**
 * `[NSCursor set]` 在应用未激活时只改 currentCursor，不改屏幕上的系统光标。
 * SkyLight 私有属性 SetsCursorInBackground 让这次 set 作用到系统光标。
 * koffi.symbol 拿到的是全局变量地址，CFBooleanRef 还要再解一层。
 */
function allowCursorInBackground(koffi: KoffiModule): void {
  if (backgroundCursorReady) return;
  const sky = koffi.load(
    "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
  );
  const cf = koffi.load(
    "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
  );
  const mainID = sky.func("int32 CGSMainConnectionID()") as () => number;
  const setProp = sky.func(
    "int32 CGSSetConnectionProperty(int32 cid, int32 target, void *key, void *value)",
  ) as (
    cid: number,
    target: number,
    key: unknown,
    value: unknown,
  ) => number;
  const makeStr = cf.func(
    "void *CFStringCreateWithCString(void *alloc, const char *cStr, uint32 encoding)",
  ) as (alloc: null, text: string, encoding: number) => unknown;
  const boolTrue = koffi.decode(cf.symbol("kCFBooleanTrue"), "void *");
  const cid = mainID();
  const key = makeStr(null, "SetsCursorInBackground", CF_STRING_UTF8);
  const err = setProp(cid, cid, key, boolTrue);
  if (err !== 0) {
    console.warn("[stealthReader] SetsCursorInBackground 失败", err);
    return;
  }
  backgroundCursorReady = true;
}

function ensureMacCursor(): boolean {
  if (process.platform !== "darwin") return false;
  if (msgSend && nsCursorClass && setSelector) return true;
  if (loadFailed) return false;
  try {
    const koffi = require("koffi") as KoffiModule;
    try {
      koffi.load("/System/Library/Frameworks/AppKit.framework/AppKit");
    } catch {
      /* Electron 主进程通常已经链接 AppKit */
    }
    try {
      allowCursorInBackground(koffi);
    } catch (err) {
      console.warn("[stealthReader] 无法在后台更新 macOS 光标", err);
    }
    const objc = koffi.load("/usr/lib/libobjc.A.dylib");
    const objcGetClass = objc.func(
      "void *objc_getClass(const char *name)",
    ) as (name: string) => unknown;
    selRegister = objc.func(
      "void *sel_registerName(const char *name)",
    ) as (name: string) => unknown;
    msgSend = objc.func("void *objc_msgSend(void *self, void *cmd)") as (
      receiver: unknown,
      sel: unknown,
    ) => unknown;
    nsCursorClass = objcGetClass("NSCursor");
    setSelector = selRegister("set");
    if (!nsCursorClass || !setSelector) {
      loadFailed = true;
      msgSend = null;
      return false;
    }
    return true;
  } catch (err) {
    loadFailed = true;
    console.warn("[stealthReader] 无法设置 macOS 缩放光标", err);
    return false;
  }
}

function nsCursor(selector: string): unknown {
  const cached = cursorBySelector.get(selector);
  if (cached) return cached;
  if (!msgSend || !selRegister || !nsCursorClass) return null;
  const sel = selRegister(selector);
  // 首次向 NSCursor 发消息可能先跑 +initialize，返回值偶发为空，再取一次。
  let cursor = msgSend(nsCursorClass, sel);
  if (!cursor) cursor = msgSend(nsCursorClass, sel);
  if (!cursor) return null;
  cursorBySelector.set(selector, cursor);
  return cursor;
}

export function warmMacHoverCursor(): void {
  if (!ensureMacCursor()) return;
  for (const [primary, fallback] of Object.values(CURSOR_SELECTORS)) {
    nsCursor(primary);
    if (fallback !== primary) nsCursor(fallback);
  }
}

export function setMacHoverCursor(kind: StealthHoverCursor): void {
  if (!ensureMacCursor() || !msgSend || !setSelector) return;
  // 箭头已经是当前设置时不要再 set，避免盖掉鼠标下方其它应用的光标。
  if (kind === "arrow" && (lastKind === "arrow" || lastKind == null)) {
    lastKind = "arrow";
    return;
  }
  const [primary, fallback] = CURSOR_SELECTORS[kind];
  const cursor = nsCursor(primary) ?? nsCursor(fallback);
  if (!cursor) return;
  msgSend(cursor, setSelector);
  lastKind = kind;
}

/** 窗口隐藏或退出时，仅在我们改过缩放光标时恢复箭头。 */
export function releaseMacHoverCursor(): void {
  if (!lastKind || lastKind === "arrow") return;
  setMacHoverCursor("arrow");
}
