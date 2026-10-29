import {
  DEFAULT_STEALTH_NAV_SHORTCUTS,
  LEGACY_STEALTH_NAV_SHORTCUTS,
  STEALTH_NAV_SHORTCUT_IDS,
  defaultStealthNavShortcuts,
  isDarwinStealthNavPlatform,
  normalizeStealthNavShortcuts,
  type StealthNavShortcutId,
  type StealthNavShortcutMap,
} from "@shared/stealthNavShortcuts";
import {
  lineHeightMultipleStep,
  maxFontSize,
  minFontSize,
  minLineHeightMultiple,
  normalizeLineHeightMultiple,
} from "../constants/appUi";
import {
  defaultTimedScrollSettings,
  mergeTimedScrollSettings,
  type TimedScrollSettings,
} from "../constants/timedScroll";
import { quoteFontFamily } from "./fontFamilyCss";
import type { StealthBounds } from "@shared/stealthReaderIpc";

export const STEALTH_SETTINGS_KEY = "colorTxt.stealth.settings";

/** 系统 UI 字体（标题栏 / 任务栏 / 菜单等同款），Chromium 映射 `system-ui`。 */
export const STEALTH_SYSTEM_UI_FONT = "system-ui";

/**
 * 「终端默认」在设置里存的哨兵串；真正渲染前会换成解析到的等宽族名栈。
 * 用 `ui-monospace` 作首项，便于识别且仍有合理回退。
 */
export const STEALTH_TERMINAL_FONT_MARKER = "ui-monospace";

/** 摸鱼窗 CSS `line-height` 倍数默认（与原先常量一致）。 */
export const DEFAULT_STEALTH_LINE_HEIGHT = 1.4;
/** DOM 分页无 Monaco 上限；给一个实用封顶。 */
export const maxStealthLineHeight = 3;

export type StealthShortcutId = StealthNavShortcutId;
export type StealthShortcutMap = StealthNavShortcutMap;

export const STEALTH_SHORTCUT_IDS = STEALTH_NAV_SHORTCUT_IDS;

export const STEALTH_SHORTCUT_LABELS: Record<StealthShortcutId, string> = {
  pagePrev: "上一页（全局）",
  pageNext: "下一页（全局）",
  chapterPrev: "上一章（全局）",
  chapterNext: "下一章（全局）",
};

export const DEFAULT_STEALTH_SHORTCUTS: StealthShortcutMap = {
  ...DEFAULT_STEALTH_NAV_SHORTCUTS,
};

export type StealthReaderSettings = {
  fontFamily: string;
  fontSize: number;
  /** CSS line-height 倍数 */
  lineHeight: number;
  /** CSS font-weight: bold */
  fontBold: boolean;
  /** CSS font-style: italic */
  fontItalic: boolean;
  color: string;
  fontOpacity: number;
  bgColor: string;
  bgOpacity: number;
  /** 鼠标离开时正文与背景均不可见；移入再显示（不销毁窗口） */
  hideOnMouseLeave: boolean;
  /** 「其他字体」固定到外层列表的名称 */
  pinnedOtherFonts: string[];
  shortcuts: StealthShortcutMap;
  /** 与主窗 `colorTxt.ui.settings.timedScroll` 同结构，单独落盘、不互通 */
  timedScroll: TimedScrollSettings;
  bounds: StealthBounds | null;
};

const DEFAULT_COLOR = "#000000";
const DEFAULT_BG_COLOR = "#ffffff";

function firstFontFamilyToken(fontFamilyCss: string): string {
  return (fontFamilyCss.split(",")[0] ?? fontFamilyCss)
    .trim()
    .replace(/^["']|["']$/g, "");
}

export function isStealthSystemUiFont(fontFamilyCss: string): boolean {
  return firstFontFamilyToken(fontFamilyCss).toLowerCase() === "system-ui";
}

export function isStealthTerminalFont(fontFamilyCss: string): boolean {
  return firstFontFamilyToken(fontFamilyCss).toLowerCase() === "ui-monospace";
}

/** 由解析到的终端族名生成 CSS font-family（含回退；泛型族不加引号）。 */
export function stealthTerminalFontCss(face: string): string {
  const name = face.trim() || "Cascadia Mono";
  return [
    quoteFontFamily(name),
    "ui-monospace",
    quoteFontFamily("Cascadia Mono"),
    quoteFontFamily("Consolas"),
    quoteFontFamily("Menlo"),
    "monospace",
  ].join(", ");
}

/**
 * 设置里若存的是终端哨兵，展开为可渲染的栈；否则原样返回。
 */
export function resolveStealthFontFamilyCss(
  fontFamilyCss: string,
  terminalFace: string | null,
): string {
  if (!isStealthTerminalFont(fontFamilyCss)) return fontFamilyCss;
  return stealthTerminalFontCss(terminalFace ?? "Cascadia Mono");
}

export function clampStealthLineHeight(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_STEALTH_LINE_HEIGHT;
  return normalizeLineHeightMultiple(
    Math.max(minLineHeightMultiple, Math.min(maxStealthLineHeight, n)),
  );
}

export function defaultStealthReaderSettings(): StealthReaderSettings {
  return {
    fontFamily: STEALTH_SYSTEM_UI_FONT,
    fontSize: 16,
    lineHeight: DEFAULT_STEALTH_LINE_HEIGHT,
    fontBold: false,
    fontItalic: false,
    color: DEFAULT_COLOR,
    fontOpacity: 1,
    bgColor: DEFAULT_BG_COLOR,
    bgOpacity: 0.5,
    hideOnMouseLeave: false,
    pinnedOtherFonts: [],
    shortcuts: { ...DEFAULT_STEALTH_NAV_SHORTCUTS },
    timedScroll: { ...defaultTimedScrollSettings },
    bounds: null,
  };
}

function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return 16;
  return Math.min(maxFontSize, Math.max(minFontSize, Math.round(n)));
}

function clampOpacity(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

function parsePinnedOtherFonts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function parseBounds(raw: unknown): StealthBounds | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const width = Number(o.width);
  const height = Number(o.height);
  if (
    ![x, y, width, height].every((n) => Number.isFinite(n)) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function parseHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : fallback;
}

/** 已把仍停在旧默认上的 Mac 快捷键升过一次；之后用户改回 Ctrl+方向键会保留。 */
const MAC_NAV_SHORTCUT_REV = 1;

function shortcutsMatch(
  a: StealthShortcutMap,
  b: StealthShortcutMap,
): boolean {
  return STEALTH_NAV_SHORTCUT_IDS.every((id) => a[id] === b[id]);
}

function parseShortcuts(raw: unknown): StealthShortcutMap {
  return normalizeStealthNavShortcuts(raw);
}

/**
 * Mac 上四键仍是旧默认（Ctrl+方向键），或还没存过快捷键时，升到 Ctrl+Option+方向键。
 * 已经改成其它组合则不动。
 */
function upgradeMacNavShortcuts(
  raw: unknown,
  rev: unknown,
): { shortcuts: StealthShortcutMap; migrated: boolean } {
  const parsed = parseShortcuts(raw);
  if (!isDarwinStealthNavPlatform() || rev === MAC_NAV_SHORTCUT_REV) {
    return { shortcuts: parsed, migrated: false };
  }
  if (raw != null && !shortcutsMatch(parsed, LEGACY_STEALTH_NAV_SHORTCUTS)) {
    return { shortcuts: parsed, migrated: false };
  }
  return { shortcuts: defaultStealthNavShortcuts(), migrated: true };
}

export function loadStealthReaderSettings(): StealthReaderSettings {
  const fallback = defaultStealthReaderSettings();
  try {
    const raw = localStorage.getItem(STEALTH_SETTINGS_KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const fontFamily =
      typeof data.fontFamily === "string" && data.fontFamily.trim()
        ? data.fontFamily
        : fallback.fontFamily;
    const settings: StealthReaderSettings = {
      fontFamily,
      fontSize: clampFontSize(Number(data.fontSize)),
      lineHeight:
        data.lineHeight === undefined
          ? fallback.lineHeight
          : clampStealthLineHeight(Number(data.lineHeight)),
      fontBold:
        typeof data.fontBold === "boolean"
          ? data.fontBold
          : fallback.fontBold,
      fontItalic:
        typeof data.fontItalic === "boolean"
          ? data.fontItalic
          : fallback.fontItalic,
      color: parseHexColor(data.color, fallback.color),
      fontOpacity:
        data.fontOpacity === undefined
          ? fallback.fontOpacity
          : clampOpacity(Number(data.fontOpacity)),
      bgColor: parseHexColor(
        data.bgColor ?? data.backgroundColor,
        fallback.bgColor,
      ),
      bgOpacity: clampOpacity(Number(data.bgOpacity)),
      hideOnMouseLeave:
        typeof data.hideOnMouseLeave === "boolean"
          ? data.hideOnMouseLeave
          : fallback.hideOnMouseLeave,
      pinnedOtherFonts: parsePinnedOtherFonts(data.pinnedOtherFonts),
      shortcuts: upgradeMacNavShortcuts(
        data.shortcuts,
        data.macNavShortcutRev,
      ).shortcuts,
      timedScroll: mergeTimedScrollSettings(
        data.timedScroll && typeof data.timedScroll === "object"
          ? (data.timedScroll as Partial<TimedScrollSettings>)
          : undefined,
      ),
      bounds: parseBounds(data.bounds),
    };
    persistMacNavShortcutUpgrade(settings);
    return settings;
  } catch {
    return fallback;
  }
}

function persistMacNavShortcutUpgrade(settings: StealthReaderSettings): void {
  if (!isDarwinStealthNavPlatform()) return;
  try {
    const raw = localStorage.getItem(STEALTH_SETTINGS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.macNavShortcutRev === MAC_NAV_SHORTCUT_REV) return;
    const upgraded = upgradeMacNavShortcuts(
      data.shortcuts,
      data.macNavShortcutRev,
    );
    if (!upgraded.migrated) return;
    saveStealthReaderSettings({ ...settings, shortcuts: upgraded.shortcuts });
  } catch {
    /* 下次进入再试 */
  }
}

export function saveStealthReaderSettings(
  settings: StealthReaderSettings,
): void {
  try {
    localStorage.setItem(
      STEALTH_SETTINGS_KEY,
      JSON.stringify({
        fontFamily: settings.fontFamily,
        fontSize: clampFontSize(settings.fontSize),
        lineHeight: clampStealthLineHeight(settings.lineHeight),
        fontBold: Boolean(settings.fontBold),
        fontItalic: Boolean(settings.fontItalic),
        color: parseHexColor(settings.color, DEFAULT_COLOR),
        fontOpacity: clampOpacity(settings.fontOpacity),
        bgColor: parseHexColor(settings.bgColor, DEFAULT_BG_COLOR),
        bgOpacity: clampOpacity(settings.bgOpacity),
        hideOnMouseLeave: Boolean(settings.hideOnMouseLeave),
        pinnedOtherFonts: parsePinnedOtherFonts(settings.pinnedOtherFonts),
        shortcuts: parseShortcuts(settings.shortcuts),
        ...(isDarwinStealthNavPlatform()
          ? { macNavShortcutRev: MAC_NAV_SHORTCUT_REV }
          : {}),
        timedScroll: mergeTimedScrollSettings(settings.timedScroll),
        bounds: settings.bounds,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

/** `#rrggbb` + 0..1 → `rgba(...)` */
export function hexToRgbaCss(hex: string, alpha: number): string {
  const s = hex.trim().toLowerCase();
  const m = /^#([0-9a-f]{6})$/.exec(s);
  const a = clampOpacity(alpha);
  if (!m) return `rgba(0, 0, 0, ${a})`;
  const n = Number.parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export { lineHeightMultipleStep, minLineHeightMultiple };
