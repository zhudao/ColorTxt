/**
 * 多窗口共用、但不实时同步的配置项：落盘时读磁盘最新值，仅把本窗「相对基线有改动」的字段盖上去；
 * 读到的磁盘值只用于拼写回盘，不合并进本窗内存。
 */

import { persistKey } from "../constants/appUi";

export function clonePersistBaselineValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return value;
  }
}

export function settingsPersistValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** 与主窗/找书窗各自内存独立、不随 storage 事件灌入内存的字段 */
export const WINDOW_LOCAL_MAIN_SETTING_KEYS: ReadonlySet<string> = new Set([
  "fontSize",
  "lineHeightMultiple",
  "lineSpacingPx",
  "letterSpacingPx",
  "readerHorizontalInsetPx",
  "fontFamily",
  "pinnedOtherFonts",
  "monacoCustomHighlight",
  "compressBlankLines",
  "compressBlankKeepOneBlank",
  "chapterTitleBlankMode",
  "txtrDelimitedMatchCrossLine",
  "leadIndentFullWidth",
  "textConvertZh",
  "textConvertLetter",
  "textConvertDigit",
  "monacoAdvancedWrapping",
  "monacoCjkWrapOptimize",
  "monacoSmoothScrolling",
  "scrollbarTrackBehavior",
  "mouseWheelScrollSensitivity",
  "fastScrollSensitivity",
  "stickyChapterTitleEnabled",
  "readerClickMode",
  "readingRulerEnabled",
  "readingRulerFocusLines",
  "readingRulerDimOpacity",
  "readingRulerDimStickyTitle",
  "readingRulerTransitionEnabled",
  "markdownImageHeightPx",
  "chapterNavToolbarEnabled",
  "readerEditShowLineNumbers",
  "readerEditMinimap",
  "editAutoRefreshChapterList",
  "aiSmartFormat",
  "fullscreenReaderWidthPercent",
  "fullscreenShowSystemTime",
  "timedScroll",
  "pomodoro",
  "selectionToolbarButtons",
  "dictionarySettings",
  "webSearchSettings",
  "translationSettings",
  "voiceRead",
  "sidebarWidth",
  "showSidebar",
  "isMinimalistView",
]);

export function readPersistedMainSettingsObject(): Record<string, unknown> {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(persistKey)
        : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * 将本窗 patch 合并进磁盘快照：window-local 且相对 baseline 未变 → 保留磁盘；
 * 其余字段用本窗值。
 */
export function mergeLocalPatchOntoDiskSettings(options: {
  disk: Record<string, unknown>;
  patch: Record<string, unknown>;
  baseline: Record<string, unknown>;
  windowLocalKeys?: ReadonlySet<string>;
  /** 这些键跳过通用比较（由调用方单独处理，如 voiceRead） */
  skipKeys?: ReadonlySet<string>;
}): {
  next: Record<string, unknown>;
  writtenKeys: string[];
} {
  const windowLocalKeys =
    options.windowLocalKeys ?? WINDOW_LOCAL_MAIN_SETTING_KEYS;
  const skipKeys = options.skipKeys ?? new Set<string>();
  const next: Record<string, unknown> = { ...options.disk };
  const writtenKeys: string[] = [];

  for (const [key, value] of Object.entries(options.patch)) {
    if (value === undefined) continue;
    if (skipKeys.has(key)) continue;
    if (
      windowLocalKeys.has(key) &&
      settingsPersistValuesEqual(value, options.baseline[key])
    ) {
      continue;
    }
    next[key] = value;
    writtenKeys.push(key);
  }

  delete next.readerPaletteColorEnabledOverridesLight;
  delete next.readerPaletteColorEnabledOverridesDark;
  delete next.readerPaletteSelectedPresetId;
  delete next.readerPaletteOverridesLight;
  delete next.readerPaletteOverridesDark;

  return { next, writtenKeys };
}

export function applyBaselineUpdates(
  baseline: Record<string, unknown>,
  patch: Record<string, unknown>,
  keys: Iterable<string>,
): void {
  for (const key of keys) {
    if (!(key in patch) || patch[key] === undefined) continue;
    baseline[key] = clonePersistBaselineValue(patch[key]);
  }
}
