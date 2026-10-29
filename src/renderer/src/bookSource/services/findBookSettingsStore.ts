import {
  clampLineHeightMultipleForFontSize,
  defaultCompressBlankKeepOneBlank,
  parseChapterTitleBlankMode,
  defaultCompressBlankLines,
  defaultChapterNavToolbarEnabled,
  defaultFullscreenReaderWidthPercent,
  defaultFullscreenShowSystemTime,
  defaultShowSidebar,
  defaultIsMinimalistView,
  defaultLeadIndentFullWidth,
  defaultMonacoAdvancedWrapping,
  defaultMonacoCjkWrapOptimize,
  defaultMonacoCustomHighlight,
  defaultMonacoSmoothScrolling,
  parseScrollbarTrackBehavior,
  defaultMouseWheelScrollSensitivity,
  defaultFastScrollSensitivity,
  clampMouseWheelScrollSensitivity,
  clampFastScrollSensitivity,
  defaultReaderEditMinimap,
  defaultReaderEditShowLineNumbers,
  defaultReaderFontSize,
  defaultReaderLineHeightMultiple,
  defaultLineSpacingPx,
  clampLineSpacingPx,
  defaultLetterSpacingPx,
  clampLetterSpacingPx,
  defaultReaderHorizontalInsetPx,
  clampReaderHorizontalInsetPx,
  defaultStickyChapterTitleEnabled,
  defaultReaderClickMode,
  defaultReadingRulerEnabled,
  defaultReadingRulerFocusLines,
  defaultReadingRulerDimOpacity,
  defaultReadingRulerDimStickyTitle,
  defaultReadingRulerTransitionEnabled,
  clampReadingRulerFocusLines,
  clampReadingRulerDimOpacity,
  defaultMarkdownImageHeightPx,
  clampMarkdownImageHeightPx,
  defaultTxtrDelimitedMatchCrossLine,
  FIND_BOOK_SIDEBAR_MIN_WIDTH,
  normalizeLineHeightMultiple,
  persistKey,
  SIDEBAR_ACTIVITY_BAR_WIDTH,
  type ChapterTitleBlankMode,
} from "../../constants/appUi";
import {
  defaultTimedScrollIntervalMs,
  defaultTimedScrollRange,
  mergeTimedScrollSettings,
  type TimedScrollSettings,
} from "../../constants/timedScroll";
import {
  mergePomodoroSettings,
  type PomodoroSettings,
} from "../../constants/pomodoro";
import {
  mergeSelectionToolbarButtons,
  type SelectionToolbarButtons,
} from "../../constants/selectionToolbar";
import { mergeDictionarySettings } from "../../constants/dictionarySettings";
import { mergeWebSearchSettings } from "../../constants/webSearchSettings";
import {
  mergeTranslationSettings,
  stripTranslationSecretsForDisk,
} from "../../constants/translationSettings";
import type { TranslationSettings } from "@shared/translationTypes";
import type { DictionarySettings } from "@shared/dictionaryTypes";
import type { WebSearchSettings } from "@shared/webSearchTypes";
import { READER_EDITOR_DEFAULT_FONT_FAMILY } from "../../monaco/readerEditorOptions";
import { DEFAULT_FIND_BOOK_CHAPTER_ADVANCE_ENABLED } from "../../constants/findBookChapterAdvance";
import {
  resolveDefaultBookSourceDownloadDirSync,
  resolveDefaultBookSourceChapterCacheDirSync,
} from "../../utils/defaultCacheDirs";
import type {
  TextConvertWidthMode,
  TextConvertZhMode,
} from "@shared/textConvertTypes";
import {
  DEFAULT_FIND_BOOK_DOWNLOAD_AFTER_ACTION,
  DEFAULT_FIND_BOOK_DOWNLOAD_CATEGORY,
  DEFAULT_FIND_BOOK_PROXY_SETTINGS,
  defaultFindBookShowChapterTag,
  findBookProxyChangedEvent,
  findBookSettingsKey,
  isFindBookDownloadAfterAction,
  normalizeFindBookProxySettings,
  buildFindBookProxyUrl,
  type FindBookDownloadAfterAction,
  type FindBookProxySettings,
  type PersistedFindBookSettings,
} from "../constants/findBookSettings";
import {
  loadPersistedSettingsData,
  type PersistedSettingsData,
} from "../../stores/cacheStore";

export { patchPersistedMainSettings } from "../../stores/cacheStore";

function safeParseFindBookSettings(raw: string | null): PersistedFindBookSettings {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PersistedFindBookSettings;
  } catch {
    return {};
  }
}

function loadRawFindBookSettings(): PersistedFindBookSettings {
  try {
    return safeParseFindBookSettings(localStorage.getItem(findBookSettingsKey));
  } catch {
    return {};
  }
}

export function loadPersistedFindBookSettings(): PersistedFindBookSettings {
  return loadRawFindBookSettings();
}

/** 整份替换找书专属设置（去掉旧版阅读/编辑孤儿键） */
export function persistFindBookSettings(data: PersistedFindBookSettings) {
  try {
    localStorage.setItem(findBookSettingsKey, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function loadFindBookProxySettings(): FindBookProxySettings {
  return normalizeFindBookProxySettings(
    loadPersistedFindBookSettings().proxy ?? DEFAULT_FIND_BOOK_PROXY_SETTINGS,
  );
}

/** 合并写入找书设置中的 proxy，并同步主进程默认代理；同窗派发事件便于实时刷新草稿 */
export function saveFindBookProxySettingsAndSync(
  proxy: FindBookProxySettings,
): FindBookProxySettings {
  const normalized = normalizeFindBookProxySettings(proxy);
  const current = loadPersistedFindBookSettings();
  persistFindBookSettings({
    ...current,
    proxy: normalized,
  });
  const url = buildFindBookProxyUrl(normalized);
  void window.colorTxt?.bookSourceSetHttpProxy(url || null);
  try {
    window.dispatchEvent(new CustomEvent(findBookProxyChangedEvent));
  } catch {
    // ignore
  }
  return normalized;
}

/** 主界面 / 找书启动：把已持久化的代理推到主进程 */
export function syncPersistedFindBookProxyToMain(): void {
  const url = buildFindBookProxyUrl(loadFindBookProxySettings());
  void window.colorTxt?.bookSourceSetHttpProxy(url || null);
}

export function loadMainSettingsData(): PersistedSettingsData {
  return loadPersistedSettingsData(localStorage, persistKey)?.data ?? {};
}

export function snapshotFindBookOnlySettingsFromStore(state: {
  cacheDir: string;
  downloadDir: string;
  downloadAfterAction: FindBookDownloadAfterAction;
  downloadAddToMainFileList: boolean;
  downloadDefaultCategory: string;
  proxy: FindBookProxySettings;
  showSidebar: boolean;
  isMinimalistView: boolean;
  sidebarWidth: number;
  showChapterTag: boolean;
}): PersistedFindBookSettings {
  return {
    cacheDir: state.cacheDir.trim(),
    downloadDir: state.downloadDir.trim(),
    downloadAfterAction: state.downloadAfterAction,
    downloadAddToMainFileList: state.downloadAddToMainFileList,
    downloadDefaultCategory: state.downloadDefaultCategory.trim(),
    proxy: normalizeFindBookProxySettings(state.proxy),
    showSidebar: state.showSidebar,
    isMinimalistView: state.isMinimalistView,
    sidebarWidth: state.sidebarWidth,
    showChapterTag: state.showChapterTag,
  };
}

export type SharedReaderSettingsSnapshot = {
  readerFontSize: number;
  readerLineHeightMultiple: number;
  readerLineSpacingPx: number;
  readerLetterSpacingPx: number;
  readerHorizontalInsetPx: number;
  monacoFontFamily: string;
  pinnedOtherFonts: string[];
  monacoCustomHighlight: boolean;
  txtrDelimitedMatchCrossLine: boolean;
  compressBlankLines: boolean;
  compressBlankKeepOneBlank: boolean;
  chapterTitleBlankMode: ChapterTitleBlankMode;
  leadIndentFullWidth: boolean;
  textConvertZh: TextConvertZhMode;
  textConvertLetter: TextConvertWidthMode;
  textConvertDigit: TextConvertWidthMode;
  monacoAdvancedWrapping: boolean;
  monacoCjkWrapOptimize: boolean;
  monacoSmoothScrolling: boolean;
  scrollbarTrackBehavior: import("../../constants/appUi").ScrollbarTrackBehavior;
  mouseWheelScrollSensitivity: number;
  fastScrollSensitivity: number;
  stickyChapterTitleEnabled: boolean;
  readerClickMode: boolean;
  readingRulerEnabled: boolean;
  readingRulerFocusLines: number;
  readingRulerDimOpacity: number;
  readingRulerDimStickyTitle: boolean;
  readingRulerTransitionEnabled: boolean;
  markdownImageHeightPx: number;
  chapterNavToolbarEnabled: boolean;
  findBookChapterAdvanceEnabled: boolean;
  readerEditShowLineNumbers: boolean;
  readerEditMinimap: boolean;
  fullscreenReaderWidthPercent: number;
  fullscreenShowSystemTime: boolean;
  timedScrollSettings: TimedScrollSettings;
  pomodoroSettings: PomodoroSettings;
  selectionToolbarButtons: SelectionToolbarButtons;
  dictionarySettings: DictionarySettings;
  webSearchSettings: WebSearchSettings;
  translationSettings: TranslationSettings;
};

export function sharedReaderSettingsFromMainData(
  data: PersistedSettingsData,
): SharedReaderSettingsSnapshot {
  return {
    readerFontSize:
      typeof data.fontSize === "number" && Number.isFinite(data.fontSize)
        ? data.fontSize
        : defaultReaderFontSize,
    readerLineHeightMultiple:
      typeof data.lineHeightMultiple === "number"
        ? normalizeLineHeightMultiple(data.lineHeightMultiple)
        : normalizeLineHeightMultiple(defaultReaderLineHeightMultiple),
    readerLineSpacingPx:
      typeof data.lineSpacingPx === "number"
        ? clampLineSpacingPx(data.lineSpacingPx)
        : defaultLineSpacingPx,
    readerLetterSpacingPx:
      typeof data.letterSpacingPx === "number"
        ? clampLetterSpacingPx(data.letterSpacingPx)
        : defaultLetterSpacingPx,
    readerHorizontalInsetPx:
      typeof data.readerHorizontalInsetPx === "number"
        ? clampReaderHorizontalInsetPx(data.readerHorizontalInsetPx)
        : defaultReaderHorizontalInsetPx,
    monacoFontFamily:
      typeof data.fontFamily === "string" && data.fontFamily.trim()
        ? data.fontFamily.trim()
        : READER_EDITOR_DEFAULT_FONT_FAMILY,
    pinnedOtherFonts: Array.isArray(data.pinnedOtherFonts)
      ? data.pinnedOtherFonts.filter((f) => typeof f === "string" && f.trim())
      : [],
    monacoCustomHighlight:
      typeof data.monacoCustomHighlight === "boolean"
        ? data.monacoCustomHighlight
        : defaultMonacoCustomHighlight,
    txtrDelimitedMatchCrossLine:
      typeof data.txtrDelimitedMatchCrossLine === "boolean"
        ? data.txtrDelimitedMatchCrossLine
        : defaultTxtrDelimitedMatchCrossLine,
    compressBlankLines:
      typeof data.compressBlankLines === "boolean"
        ? data.compressBlankLines
        : defaultCompressBlankLines,
    compressBlankKeepOneBlank:
      typeof data.compressBlankKeepOneBlank === "boolean"
        ? data.compressBlankKeepOneBlank
        : defaultCompressBlankKeepOneBlank,
    chapterTitleBlankMode: parseChapterTitleBlankMode(
      data.chapterTitleBlankMode,
    ),
    leadIndentFullWidth:
      typeof data.leadIndentFullWidth === "boolean"
        ? data.leadIndentFullWidth
        : defaultLeadIndentFullWidth,
    textConvertZh: (data.textConvertZh as TextConvertZhMode | undefined) ?? "off",
    textConvertLetter:
      (data.textConvertLetter as TextConvertWidthMode | undefined) ?? "off",
    textConvertDigit:
      (data.textConvertDigit as TextConvertWidthMode | undefined) ?? "off",
    monacoAdvancedWrapping:
      typeof data.monacoAdvancedWrapping === "boolean"
        ? data.monacoAdvancedWrapping
        : defaultMonacoAdvancedWrapping,
    monacoCjkWrapOptimize:
      typeof data.monacoCjkWrapOptimize === "boolean"
        ? data.monacoCjkWrapOptimize
        : defaultMonacoCjkWrapOptimize,
    monacoSmoothScrolling:
      typeof data.monacoSmoothScrolling === "boolean"
        ? data.monacoSmoothScrolling
        : defaultMonacoSmoothScrolling,
    scrollbarTrackBehavior: parseScrollbarTrackBehavior(
      data.scrollbarTrackBehavior,
      data.disableScrollbarTrackJump,
    ),
    mouseWheelScrollSensitivity: clampMouseWheelScrollSensitivity(
      typeof data.mouseWheelScrollSensitivity === "number"
        ? data.mouseWheelScrollSensitivity
        : defaultMouseWheelScrollSensitivity,
    ),
    fastScrollSensitivity: clampFastScrollSensitivity(
      typeof data.fastScrollSensitivity === "number"
        ? data.fastScrollSensitivity
        : defaultFastScrollSensitivity,
    ),
    stickyChapterTitleEnabled:
      typeof data.stickyChapterTitleEnabled === "boolean"
        ? data.stickyChapterTitleEnabled
        : defaultStickyChapterTitleEnabled,
    readerClickMode:
      typeof data.readerClickMode === "boolean"
        ? data.readerClickMode
        : defaultReaderClickMode,
    readingRulerEnabled:
      typeof data.readingRulerEnabled === "boolean"
        ? data.readingRulerEnabled
        : defaultReadingRulerEnabled,
    readingRulerFocusLines: clampReadingRulerFocusLines(
      typeof data.readingRulerFocusLines === "number"
        ? data.readingRulerFocusLines
        : defaultReadingRulerFocusLines,
    ),
    readingRulerDimOpacity: clampReadingRulerDimOpacity(
      typeof data.readingRulerDimOpacity === "number"
        ? data.readingRulerDimOpacity
        : defaultReadingRulerDimOpacity,
    ),
    readingRulerDimStickyTitle:
      typeof data.readingRulerDimStickyTitle === "boolean"
        ? data.readingRulerDimStickyTitle
        : defaultReadingRulerDimStickyTitle,
    readingRulerTransitionEnabled:
      typeof data.readingRulerTransitionEnabled === "boolean"
        ? data.readingRulerTransitionEnabled
        : defaultReadingRulerTransitionEnabled,
    markdownImageHeightPx: clampMarkdownImageHeightPx(
      typeof data.markdownImageHeightPx === "number"
        ? data.markdownImageHeightPx
        : defaultMarkdownImageHeightPx,
    ),
    chapterNavToolbarEnabled:
      typeof data.chapterNavToolbarEnabled === "boolean"
        ? data.chapterNavToolbarEnabled
        : defaultChapterNavToolbarEnabled,
    findBookChapterAdvanceEnabled:
      typeof data.findBookChapterAdvanceEnabled === "boolean"
        ? data.findBookChapterAdvanceEnabled
        : DEFAULT_FIND_BOOK_CHAPTER_ADVANCE_ENABLED,
    readerEditShowLineNumbers:
      typeof data.readerEditShowLineNumbers === "boolean"
        ? data.readerEditShowLineNumbers
        : defaultReaderEditShowLineNumbers,
    readerEditMinimap:
      typeof data.readerEditMinimap === "boolean"
        ? data.readerEditMinimap
        : defaultReaderEditMinimap,
    fullscreenReaderWidthPercent:
      typeof data.fullscreenReaderWidthPercent === "number"
        ? data.fullscreenReaderWidthPercent
        : defaultFullscreenReaderWidthPercent,
    fullscreenShowSystemTime:
      typeof data.fullscreenShowSystemTime === "boolean"
        ? data.fullscreenShowSystemTime
        : defaultFullscreenShowSystemTime,
    timedScrollSettings: mergeTimedScrollSettings(data.timedScroll),
    pomodoroSettings: mergePomodoroSettings(data.pomodoro),
    selectionToolbarButtons: mergeSelectionToolbarButtons(
      data.selectionToolbarButtons,
    ),
    dictionarySettings: mergeDictionarySettings(data.dictionarySettings),
    webSearchSettings: mergeWebSearchSettings(data.webSearchSettings),
    translationSettings: stripTranslationSecretsForDisk(
      mergeTranslationSettings(data.translationSettings),
    ),
  };
}

export function snapshotSharedReaderSettingsForMain(
  state: SharedReaderSettingsSnapshot,
): Record<string, unknown> {
  return {
    fontSize: state.readerFontSize,
    lineHeightMultiple: state.readerLineHeightMultiple,
    lineSpacingPx: state.readerLineSpacingPx,
    letterSpacingPx: state.readerLetterSpacingPx,
    readerHorizontalInsetPx: state.readerHorizontalInsetPx,
    fontFamily: state.monacoFontFamily,
    pinnedOtherFonts: [...state.pinnedOtherFonts],
    monacoCustomHighlight: state.monacoCustomHighlight,
    txtrDelimitedMatchCrossLine: state.txtrDelimitedMatchCrossLine,
    compressBlankLines: state.compressBlankLines,
    compressBlankKeepOneBlank: state.compressBlankKeepOneBlank,
    chapterTitleBlankMode: state.chapterTitleBlankMode,
    leadIndentFullWidth: state.leadIndentFullWidth,
    textConvertZh: state.textConvertZh,
    textConvertLetter: state.textConvertLetter,
    textConvertDigit: state.textConvertDigit,
    monacoAdvancedWrapping: state.monacoAdvancedWrapping,
    monacoCjkWrapOptimize: state.monacoCjkWrapOptimize,
    monacoSmoothScrolling: state.monacoSmoothScrolling,
    scrollbarTrackBehavior: state.scrollbarTrackBehavior,
    mouseWheelScrollSensitivity: state.mouseWheelScrollSensitivity,
    fastScrollSensitivity: state.fastScrollSensitivity,
    stickyChapterTitleEnabled: state.stickyChapterTitleEnabled,
    readerClickMode: state.readerClickMode,
    readingRulerEnabled: state.readingRulerEnabled,
    readingRulerFocusLines: state.readingRulerFocusLines,
    readingRulerDimOpacity: state.readingRulerDimOpacity,
    readingRulerDimStickyTitle: state.readingRulerDimStickyTitle,
    readingRulerTransitionEnabled: state.readingRulerTransitionEnabled,
    markdownImageHeightPx: state.markdownImageHeightPx,
    chapterNavToolbarEnabled: state.chapterNavToolbarEnabled,
    findBookChapterAdvanceEnabled: state.findBookChapterAdvanceEnabled,
    readerEditShowLineNumbers: state.readerEditShowLineNumbers,
    readerEditMinimap: state.readerEditMinimap,
    fullscreenReaderWidthPercent: state.fullscreenReaderWidthPercent,
    fullscreenShowSystemTime: state.fullscreenShowSystemTime,
    timedScroll: state.timedScrollSettings,
    pomodoro: state.pomodoroSettings,
    selectionToolbarButtons: state.selectionToolbarButtons,
    dictionarySettings: state.dictionarySettings,
    webSearchSettings: state.webSearchSettings,
    translationSettings: stripTranslationSecretsForDisk(
      state.translationSettings,
    ),
  };
}

export function createInitialFindBookSettingsState() {
  const data = loadPersistedFindBookSettings();
  const shared = sharedReaderSettingsFromMainData(loadMainSettingsData());
  return {
    cacheDir:
      typeof data.cacheDir === "string" && data.cacheDir.trim()
        ? data.cacheDir.trim()
        : resolveDefaultBookSourceChapterCacheDirSync(),
    downloadDir:
      typeof data.downloadDir === "string" && data.downloadDir.trim()
        ? data.downloadDir.trim()
        : resolveDefaultBookSourceDownloadDirSync(),
    downloadAfterAction: isFindBookDownloadAfterAction(data.downloadAfterAction)
      ? data.downloadAfterAction
      : DEFAULT_FIND_BOOK_DOWNLOAD_AFTER_ACTION,
    downloadAddToMainFileList: data.downloadAddToMainFileList !== false,
    downloadDefaultCategory:
      data.downloadDefaultCategory === undefined
        ? DEFAULT_FIND_BOOK_DOWNLOAD_CATEGORY
        : typeof data.downloadDefaultCategory === "string"
          ? data.downloadDefaultCategory.trim()
          : "",
    proxy: normalizeFindBookProxySettings(
      data.proxy ?? DEFAULT_FIND_BOOK_PROXY_SETTINGS,
    ),
    showSidebar:
      typeof data.showSidebar === "boolean"
        ? data.showSidebar
        : defaultShowSidebar,
    isMinimalistView:
      typeof data.isMinimalistView === "boolean"
        ? data.isMinimalistView
        : defaultIsMinimalistView,
    sidebarWidth:
      typeof data.sidebarWidth === "number" && Number.isFinite(data.sidebarWidth)
        ? Math.max(
            FIND_BOOK_SIDEBAR_MIN_WIDTH,
            Math.floor(data.sidebarWidth),
          )
        : 270 - SIDEBAR_ACTIVITY_BAR_WIDTH,
    showChapterTag:
      typeof data.showChapterTag === "boolean"
        ? data.showChapterTag
        : defaultFindBookShowChapterTag,
    ...shared,
  };
}

export function clampFindBookReaderLineHeight(
  fontSize: number,
  lineHeight: number,
): number {
  return clampLineHeightMultipleForFontSize(fontSize, lineHeight);
}

export {
  defaultTimedScrollIntervalMs,
  defaultTimedScrollRange,
};
