/** 摸鱼翻页/切章全局快捷键（主进程注册用；与渲染设置字段对齐）。 */

export type StealthNavShortcutId =
  | "pagePrev"
  | "pageNext"
  | "chapterPrev"
  | "chapterNext";

export type StealthNavShortcutMap = Record<StealthNavShortcutId, string>;

/** 旧默认。macOS 上与调度中心冲突（⌃↑↓ 调度中心，⌃←→ 切换桌面）。 */
export const LEGACY_STEALTH_NAV_SHORTCUTS: StealthNavShortcutMap = {
  pagePrev: "Control+Up",
  pageNext: "Control+Down",
  chapterPrev: "Control+Left",
  chapterNext: "Control+Right",
};

/**
 * macOS 默认多一个 Option，避开调度中心。
 * Windows 不用 Ctrl+Alt+方向键：不少显卡驱动用它旋转屏幕。
 */
const MAC_STEALTH_NAV_SHORTCUTS: StealthNavShortcutMap = {
  pagePrev: "Control+Alt+Up",
  pageNext: "Control+Alt+Down",
  chapterPrev: "Control+Alt+Left",
  chapterNext: "Control+Alt+Right",
};

export function isDarwinStealthNavPlatform(): boolean {
  if (typeof navigator !== "undefined" && navigator.platform) {
    return (
      /mac/i.test(navigator.platform) ||
      /Macintosh/.test(navigator.userAgent || "")
    );
  }
  return typeof process !== "undefined" && process.platform === "darwin";
}

export function defaultStealthNavShortcuts(): StealthNavShortcutMap {
  return {
    ...(isDarwinStealthNavPlatform()
      ? MAC_STEALTH_NAV_SHORTCUTS
      : LEGACY_STEALTH_NAV_SHORTCUTS),
  };
}

export const DEFAULT_STEALTH_NAV_SHORTCUTS: StealthNavShortcutMap =
  defaultStealthNavShortcuts();

export const STEALTH_NAV_SHORTCUT_IDS: readonly StealthNavShortcutId[] = [
  "pagePrev",
  "pageNext",
  "chapterPrev",
  "chapterNext",
] as const;

export function normalizeStealthNavShortcuts(
  raw: unknown,
): StealthNavShortcutMap {
  const out: StealthNavShortcutMap = { ...DEFAULT_STEALTH_NAV_SHORTCUTS };
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  for (const id of STEALTH_NAV_SHORTCUT_IDS) {
    const v = o[id];
    if (typeof v === "string" && v.trim()) out[id] = v.trim();
  }
  return out;
}
