import {
  ref,
  shallowRef,
  watch,
  triggerRef,
  nextTick,
  type Ref,
  type ShallowRef,
} from "vue";
import type { RecentFileItem } from "../components/AppHeader.vue";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  getChapterMatchRules,
  normalizeLoadedChapterRules,
  setChapterMatchRules,
  type ChapterMatchRule,
} from "../chapter";
import {
  mergeAiSmartFormatSettings,
  type AiSmartFormatSettings,
} from "@shared/aiSmartFormatTypes";
import {
  parseTextConvertWidthMode,
  parseTextConvertZhMode,
} from "@shared/textConvertTypes";
import {
  loadPersistedSettingsData,
  loadSessionSnapshot,
  loadTxtFileListSnapshot,
  patchPersistedMainSettings,
  persistSessionSnapshot,
  persistSettingsData,
  persistTxtFileListSnapshot,
  type PersistedSettingsData,
  type TxtFileItem,
} from "../stores/cacheStore";
import {
  applyBaselineUpdates,
  clonePersistBaselineValue,
  mergeLocalPatchOntoDiskSettings,
  readPersistedMainSettingsObject,
  settingsPersistValuesEqual,
  WINDOW_LOCAL_MAIN_SETTING_KEYS,
} from "../services/settingsPersistMerge";
import {
  resolveDefaultCharacterPortraitCacheDirSync,
  resolveDefaultUnpackedBooksDirSync,
} from "../utils/defaultCacheDirs";
import type {
  FileCategoryDefinition,
  FileListViewMode,
  FileSortMode,
} from "../constants/fileCategories";
import {
  cloneDefaultFileCategoryCatalog,
  DEFAULT_FILE_LIST_VIEW_MODE,
  DEFAULT_FILE_SORT,
  isFileSortMode,
  normalizeCategoryFilter,
  parseFileListViewMode,
} from "../constants/fileCategories";
import {
  fileHistoryKey,
  loadRecentFileRecords,
  persistRecentFileRecords,
  removeRecentFileRecord,
  upsertRecentFileRecord,
} from "../stores/recentHistoryStore";
import {
  clearBookmarksForFile,
  findFileMetaRecord,
  loadFileMetaRecords,
  mergeFileMetaRecords,
  normalizeFileMetaPathKey,
  normalizeHighlightWordsByIndex,
  persistFileMetaRecords,
  removeBookmarkForFile,
  upsertBookmarkForFile,
  upsertFileMetaRecord,
  type FileMetaRecord,
  type HighlightWordsByIndex,
  type PersistedEditorViewState,
} from "../stores/fileMetaStore";
import {
  DEFAULT_HIGHLIGHT_COLORS_DARK,
  DEFAULT_HIGHLIGHT_COLORS_LIGHT,
  DEFAULT_HIGHLIGHT_LAST_COLOR,
  clampHighlightLastColorToCount,
  mergeHighlightColors,
  parseHighlightColorsArray,
  parseHighlightLastColor,
} from "../constants/highlightColors";
import {
  DEFAULT_LINEATION_COLORS_DARK,
  DEFAULT_LINEATION_COLORS_LIGHT,
  mergeLineationColors,
  parseLineationColorsArray,
} from "../constants/lineationColors";
import {
  clampLineationLastColorsToCount,
  DEFAULT_LINEATION_LAST_COLORS,
  parseLineationLastColors,
  type LineationLastColorPrefs,
} from "../constants/annotationColors";
import {
  defaultChapterMinCharCount,
  defaultFullscreenReaderWidthPercent,
  defaultFullscreenShowSystemTime,
  defaultRecentFilesHistoryLimit,
  maxFullscreenReaderWidthPercent,
  clampLineHeightMultipleForFontSize,
  clampLineSpacingPx,
  clampLetterSpacingPx,
  clampReaderHorizontalInsetPx,
  maxFontSize,
  maxChapterMinCharCount,
  maxRecentFilesHistoryLimit,
  minFullscreenReaderWidthPercent,
  minFontSize,
  minChapterMinCharCount,
  clampMouseWheelScrollSensitivity,
  clampFastScrollSensitivity,
  clampReadingRulerFocusLines,
  clampReadingRulerDimOpacity,
  clampMarkdownImageHeightPx,
  parseScrollbarTrackBehavior,
  defaultMouseWheelScrollSensitivity,
  defaultFastScrollSensitivity,
  fileListKey,
  fileMetaKey,
  persistKey,
  parseChapterTitleBlankMode,
  recentFilesKey,
  sessionKey,
  skipSettingsPersistenceSessionKey,
  skipUnloadPersistenceSessionKey,
  APP_DISPLAY_NAME,
  type ChapterTitleBlankMode,
  type ReaderBackgroundState,
} from "../constants/appUi";
import {
  parseReaderBackgroundState,
  serializeReaderBackgroundState,
} from "../constants/readerBackground";
import {
  parseReaderPaletteSelectedId,
  parseReaderPaletteUserPresets,
  serializeReaderPaletteUserPresets,
  type ReaderPalettePreset,
} from "../constants/readerPalettePresets";
import { EBOOK_CONVERT_DEFAULT_SUBDIR } from "@shared/ebookConvertPaths";
import type { ShortcutBindingMap } from "../services/shortcutRegistry";
import {
  mergeShortcutBindings,
  shortcutBindingOverridesForPersist,
} from "../services/shortcutUtils";
import { joinFs } from "../ebook/pathUtils";
import { resolveDefaultEbookConvertOutputDirSync } from "../utils/defaultCacheDirs";
import type { AiCustomSkill, AiSkillUserOverride } from "@shared/aiSkills";
import {
  mergeVoiceReadSettings,
  type VoiceReadSettings,
} from "../constants/voiceRead";
import {
  mergeTimedScrollSettings,
  type TimedScrollSettings,
} from "../constants/timedScroll";
import { mergePomodoroSettings } from "../constants/pomodoro";
import {
  mergeSelectionToolbarButtons,
  type SelectionToolbarButtons,
} from "../constants/selectionToolbar";
import { mergeDictionarySettings } from "../constants/dictionarySettings";
import type { DictionarySettings } from "@shared/dictionaryTypes";
import { mergeWebSearchSettings } from "../constants/webSearchSettings";
import type { WebSearchSettings } from "@shared/webSearchTypes";
import {
  applyTranslationSecrets,
  mergeTranslationSettings,
  parseTranslationSecretsBlob,
  resolveTranslationSecretsWritePayload,
  stripTranslationSecretsForDisk,
} from "../constants/translationSettings";
import type { TranslationSettings } from "@shared/translationTypes";
import {
  collectVoiceReadProfileApiKeys,
  hydrateVoiceReadProfilesApiKeys,
  mergeVoiceReadProfileSecretsForSave,
  stripVoiceReadProfileApiKeysForDisk,
  stripVoiceReadSettingsApiKeysForDisk,
  type VoiceReadProfile,
} from "@shared/voiceReadProfiles";
import { DEPRECATED_SECRET_SLOT_VOICE_READ_DASHSCOPE_API_KEY } from "@shared/secretSlots";
import { parseProfileKeysBlob } from "@shared/aiEndpointProfiles";
import { parseProfileSecretsBlob, serializeProfileSecretsBlob } from "@shared/voiceReadEngineConfig";
import {
  mergeVoiceReadProfilesForPersist,
  migrateVoiceReadFromPersisted,
  normalizeVoiceReadProfilesForSave,
  type PersistedVoiceReadRaw,
} from "../services/voiceRead/voiceReadProfileState";
import {
  hydrateVoiceReadAiSpeakerTokenUsage,
  voiceReadAiSpeakerTokenUsagePersistPayload,
} from "../services/voiceRead/voiceReadAiSpeakerTokenUsage";
import type { WordcloudAngleMode } from "../constants/wordcloudUi";
import type { WordcloudPaletteId } from "../constants/wordcloudPalettes";
import {
  mergeAiCustomSkills,
  mergeAiSkillOverrides,
  mergeAiSkillsEnabled,
} from "@shared/aiSkills";
import {
  normalizeCharacterCardTextureEffect,
  type CharacterCardTextureEffectId,
} from "@shared/characterCardTextureEffects";

/** 同步路径优先；仍为空时用主进程 IPC（极早启动 preload 未就绪等） */
async function resolveDefaultEbookConvertOutputDir(): Promise<string> {
  const sync = resolveDefaultEbookConvertOutputDirSync();
  if (sync) return sync;
  try {
    const q = await window.colorTxt?.getPath?.("userData");
    if (typeof q === "string") {
      const t = q.trim();
      if (t) return joinFs(t, EBOOK_CONVERT_DEFAULT_SUBDIR);
    }
  } catch {
    // ignore
  }
  return "";
}

type StreamApi = {
  viewportDisplayLineToPhysicalLine: (displayLine: number) => number;
};

export function useAppPersistence(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  stream: StreamApi;
  lastProbeLine: Ref<number>;
  viewportEndLine: Ref<number>;
  txtFiles: Ref<TxtFileItem[]>;
  currentFile: Ref<string | null>;
  /**
   * 当前打开文件是否已完成「加载 + 阅读位置同步」（流结束并完成跳转/滚动，或无需恢复时）。
   * 为 false 时不写 colorTxt.file.meta，避免未稳定进度覆盖磁盘；无打开文件时应为 true。
   */
  readingProgressSynced: Ref<boolean>;
  sidebarWidth: Ref<number>;
  showSidebar: Ref<boolean>;
  isMinimalistView: Ref<boolean>;
  currentTheme: Ref<string>;
  monacoCustomHighlight: Ref<boolean>;
  compressBlankLines: Ref<boolean>;
  compressBlankKeepOneBlank: Ref<boolean>;
  chapterTitleBlankMode: Ref<ChapterTitleBlankMode>;
  /** 与「内容上色」同时生效：成对引号/括号是否跨行 */
  txtrDelimitedMatchCrossLine: Ref<boolean>;
  leadIndentFullWidth: Ref<boolean>;
  textConvertZh: Ref<import("@shared/textConvertTypes").TextConvertZhMode>;
  textConvertLetter: Ref<import("@shared/textConvertTypes").TextConvertWidthMode>;
  textConvertDigit: Ref<import("@shared/textConvertTypes").TextConvertWidthMode>;
  showChapterCounts: Ref<boolean>;
  chapterCharCountExact: Ref<boolean>;
  readerFontSize: Ref<number>;
  readerLineHeightMultiple: Ref<number>;
  readerLineSpacingPx: Ref<number>;
  readerLetterSpacingPx: Ref<number>;
  readerHorizontalInsetPx: Ref<number>;
  monacoFontFamily: Ref<string>;
  pinnedOtherFonts: Ref<string[]>;
  chapterRuleState: Ref<{ rules: ChapterMatchRule[] }>;
  recentFiles: Ref<RecentFileItem[]>;
  restoreSessionOnStartup: Ref<boolean>;
  recentFilesHistoryLimit: Ref<number>;
  chapterMinCharCount: Ref<number>;
  monacoAdvancedWrapping: Ref<boolean>;
  monacoCjkWrapOptimize: Ref<boolean>;
  monacoSmoothScrolling: Ref<boolean>;
  scrollbarTrackBehavior: Ref<
    import("../constants/appUi").ScrollbarTrackBehavior
  >;
  mouseWheelScrollSensitivity: Ref<number>;
  fastScrollSensitivity: Ref<number>;
  stickyChapterTitleEnabled: Ref<boolean>;
  readerClickMode: Ref<boolean>;
  readingRulerEnabled: Ref<boolean>;
  readingRulerFocusLines: Ref<number>;
  readingRulerDimOpacity: Ref<number>;
  readingRulerDimStickyTitle: Ref<boolean>;
  readingRulerTransitionEnabled: Ref<boolean>;
  markdownImageHeightPx: Ref<number>;
  chapterNavToolbarEnabled: Ref<boolean>;
  readerEditShowLineNumbers: Ref<boolean>;
  readerEditMinimap: Ref<boolean>;
  editAutoRefreshChapterList: Ref<boolean>;
  aiSmartFormat: Ref<AiSmartFormatSettings>;
  fullscreenReaderWidthPercent: Ref<number>;
  fullscreenShowSystemTime: Ref<boolean>;
  timedScrollSettings: Ref<TimedScrollSettings>;
  pomodoroSettings: Ref<import("../constants/pomodoro").PomodoroSettings>;
  selectionToolbarButtons: Ref<SelectionToolbarButtons>;
  dictionarySettings: Ref<DictionarySettings>;
  webSearchSettings: Ref<WebSearchSettings>;
  translationSettings: Ref<TranslationSettings>;
  fileMetaRecords: Ref<FileMetaRecord[]>;
  shortcutBindings: Ref<ShortcutBindingMap>;
  defaultShortcutBindings: ShortcutBindingMap;
  readerPaletteColorEnabledOverrides: Ref<
    Partial<import("../constants/readerPalette").ReaderSurfaceColorEnabled>
  >;
  readerPaletteUserPresets: Ref<ReaderPalettePreset[]>;
  readerPaletteSelectedIdLight: Ref<string>;
  readerPaletteSelectedIdDark: Ref<string>;
  readerBackground: Ref<ReaderBackgroundState>;
  highlightColorsLight: Ref<string[]>;
  highlightColorsDark: Ref<string[]>;
  lineationColorsLight: Ref<string[]>;
  lineationColorsDark: Ref<string[]>;
  highlightWordsByIndexGlobal: Ref<HighlightWordsByIndex | undefined>;
  lineationLastColors: Ref<LineationLastColorPrefs>;
  highlightLastColor: Ref<number>;
  /** 电子书转换输出目录；空字符串表示与源文件同目录；无持久化键时默认 userData/ConvertedTxt */
  ebookConvertOutputDir: Ref<string>;
  /** 彩读书包解压目录；空串运行时回退 userData/UnpackedBooks；无键时首次写入默认路径 */
  bookPackUnpackDir: Ref<string>;
  /** 彩读书包默认密码；空串表示不加密 */
  bookPackPassword: Ref<string>;
  /** 是否启用 WebDAV 同步入口 */
  webDavEnabled: Ref<boolean>;
  /** WebDAV 服务地址 */
  webDavUrl: Ref<string>;
  /** WebDAV 用户名 */
  webDavUsername: Ref<string>;
  /** WebDAV 应用根目录名（默认 ColorTxt） */
  webDavRemoteDir: Ref<string>;
  /** 角色立绘缓存根目录（绝对路径）；无键时默认 userData/CharacterPortrait */
  characterPortraitCacheDir: Ref<string>;
  /** 角色卡纹理/全息效果（全局） */
  characterCardTextureEffect: Ref<CharacterCardTextureEffectId>;
  fileCategory: Ref<string>;
  fileSort: Ref<FileSortMode>;
  fileListViewMode: Ref<FileListViewMode>;
  fileCategoryCatalog: Ref<FileCategoryDefinition[]>;
  /** 侧栏文件列表「编辑」模式：为 true 时跳过文件列表 localStorage 写入，退出并保存时由 App 再落盘 */
  fileListEditing: Ref<boolean>;
  /** 监控当前打开文件，磁盘变更后自动重新加载 */
  syncCurrentFile: Ref<boolean>;
  /** 内置技能启用状态 */
  aiSkillsEnabled: Ref<Record<string, boolean>>;
  aiSkillOverrides: Ref<Record<string, AiSkillUserOverride>>;
  aiCustomSkills: Ref<AiCustomSkill[]>;
  aiAssistantDeepThinking: Ref<boolean>;
  aiAssistantSpoilerSafe: Ref<boolean>;
  wordcloudFontFamily: Ref<string>;
  wordcloudAngleMode: Ref<WordcloudAngleMode>;
  wordcloudPaletteId: Ref<WordcloudPaletteId>;
  voiceReadSettings: Ref<VoiceReadSettings>;
  voiceReadProfiles: Ref<VoiceReadProfile[]>;
  activeVoiceReadProfileId: Ref<string>;
}) {
  const settingsLoaded = ref(false);
  /** 本窗启动/加载时已知的朗读方案 id；保存合并时用于区分「本窗删除」与「它窗新增」 */
  let voiceReadProfileBaselineIds = new Set<string>();
  /**
   * 多窗不实时同步字段的落盘基线：相对基线未改则保留磁盘最新值；
   * 读磁盘只用于拼写回盘，不合并进本窗内存。
   */
  const settingsPersistBaseline: Record<string, unknown> = {};
  /** 防止 persistSettings 写回 voice 触发 watch 再入 */
  let persistingSettings = false;
  /** 已调度到 nextTick 的落盘（同 tick 多次调用合并为一次，用最终内存写盘） */
  let persistSettingsQueued = false;
  /** 落盘执行中又有请求时置位，清锁后再补写 */
  let persistSettingsPending = false;

  function setVoiceReadProfileBaseline(
    profiles: readonly VoiceReadProfile[],
  ) {
    voiceReadProfileBaselineIds = new Set(
      profiles.map((p) => p.id).filter(Boolean),
    );
  }

  function buildVoiceReadPersistPayload(): Record<string, unknown> {
    const voiceReadMerged = stripVoiceReadSettingsApiKeysForDisk(
      mergeVoiceReadSettings(deps.voiceReadSettings.value),
    );
    const profilesForDisk = stripVoiceReadProfileApiKeysForDisk(
      normalizeVoiceReadProfilesForSave(deps.voiceReadProfiles.value),
    );
    const voiceReadTokenPayload = voiceReadAiSpeakerTokenUsagePersistPayload();
    return {
      activeProfileId: deps.activeVoiceReadProfileId.value,
      profiles: profilesForDisk,
      ...voiceReadMerged,
      aiSpeakerTokenUsage: voiceReadTokenPayload.usage,
      aiSpeakerTokenUsageAvailable: voiceReadTokenPayload.available,
    };
  }

  function buildSettingsPersistPatch(
    voiceReadPayload: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      theme: deps.currentTheme.value === "vs" ? "vs" : "vs-dark",
      sidebarWidth: deps.sidebarWidth.value,
      showSidebar: deps.showSidebar.value,
      isMinimalistView: deps.isMinimalistView.value,
      fontSize: deps.readerFontSize.value,
      lineHeightMultiple: deps.readerLineHeightMultiple.value,
      lineSpacingPx: deps.readerLineSpacingPx.value,
      letterSpacingPx: deps.readerLetterSpacingPx.value,
      readerHorizontalInsetPx: deps.readerHorizontalInsetPx.value,
      fontFamily: deps.monacoFontFamily.value,
      pinnedOtherFonts: [...deps.pinnedOtherFonts.value],
      monacoCustomHighlight: deps.monacoCustomHighlight.value,
      compressBlankLines: deps.compressBlankLines.value,
      compressBlankKeepOneBlank: deps.compressBlankKeepOneBlank.value,
      chapterTitleBlankMode: deps.chapterTitleBlankMode.value,
      txtrDelimitedMatchCrossLine: deps.txtrDelimitedMatchCrossLine.value,
      leadIndentFullWidth: deps.leadIndentFullWidth.value,
      textConvertZh: deps.textConvertZh.value,
      textConvertLetter: deps.textConvertLetter.value,
      textConvertDigit: deps.textConvertDigit.value,
      showChapterCounts: deps.showChapterCounts.value,
      chapterCharCountExact: deps.chapterCharCountExact.value,
      chapterRules: deps.chapterRuleState.value.rules,
      restoreSessionOnStartup: deps.restoreSessionOnStartup.value,
      syncCurrentFile: deps.syncCurrentFile.value,
      recentFilesHistoryLimit: recentLimit(),
      chapterMinCharCount: deps.chapterMinCharCount.value,
      monacoAdvancedWrapping: deps.monacoAdvancedWrapping.value,
      monacoCjkWrapOptimize: deps.monacoCjkWrapOptimize.value,
      monacoSmoothScrolling: deps.monacoSmoothScrolling.value,
      scrollbarTrackBehavior: deps.scrollbarTrackBehavior.value,
      mouseWheelScrollSensitivity: deps.mouseWheelScrollSensitivity.value,
      fastScrollSensitivity: deps.fastScrollSensitivity.value,
      stickyChapterTitleEnabled: deps.stickyChapterTitleEnabled.value,
      readerClickMode: deps.readerClickMode.value,
      readingRulerEnabled: deps.readingRulerEnabled.value,
      readingRulerFocusLines: deps.readingRulerFocusLines.value,
      readingRulerDimOpacity: deps.readingRulerDimOpacity.value,
      readingRulerDimStickyTitle: deps.readingRulerDimStickyTitle.value,
      readingRulerTransitionEnabled: deps.readingRulerTransitionEnabled.value,
      markdownImageHeightPx: deps.markdownImageHeightPx.value,
      chapterNavToolbarEnabled: deps.chapterNavToolbarEnabled.value,
      readerEditShowLineNumbers: deps.readerEditShowLineNumbers.value,
      readerEditMinimap: deps.readerEditMinimap.value,
      editAutoRefreshChapterList: deps.editAutoRefreshChapterList.value,
      aiSmartFormat: deps.aiSmartFormat.value,
      fullscreenReaderWidthPercent: deps.fullscreenReaderWidthPercent.value,
      fullscreenShowSystemTime: deps.fullscreenShowSystemTime.value,
      timedScroll: deps.timedScrollSettings.value,
      pomodoro: deps.pomodoroSettings.value,
      selectionToolbarButtons: deps.selectionToolbarButtons.value,
      dictionarySettings: deps.dictionarySettings.value,
      webSearchSettings: deps.webSearchSettings.value,
      translationSettings: stripTranslationSecretsForDisk(
        deps.translationSettings.value,
      ),
      shortcutBindings: shortcutBindingOverridesForPersist(
        deps.defaultShortcutBindings,
        deps.shortcutBindings.value,
      ),
      readerPaletteColorEnabledOverrides: {
        ...deps.readerPaletteColorEnabledOverrides.value,
      },
      readerPaletteUserPresets: serializeReaderPaletteUserPresets(
        deps.readerPaletteUserPresets.value,
      ),
      readerPaletteSelectedIdLight: parseReaderPaletteSelectedId(
        deps.readerPaletteSelectedIdLight.value,
      ),
      readerPaletteSelectedIdDark: parseReaderPaletteSelectedId(
        deps.readerPaletteSelectedIdDark.value,
      ),
      readerBackground: serializeReaderBackgroundState(
        deps.readerBackground.value,
      ),
      // 始终写入完整数组：PersistPayload 在与默认相同时返回 undefined，合并会跳过并保留磁盘旧表
      highlightColorsLight: [...deps.highlightColorsLight.value],
      highlightColorsDark: [...deps.highlightColorsDark.value],
      lineationColorsLight: [...deps.lineationColorsLight.value],
      lineationColorsDark: [...deps.lineationColorsDark.value],
      // 空表也要写入：合并落盘时若用 undefined 会跳过，磁盘上旧收藏无法清除
      highlightWordsByIndexGlobal: deps.highlightWordsByIndexGlobal.value ?? {},
      lineationLastColors:
        deps.lineationLastColors.value.marker ===
          DEFAULT_LINEATION_LAST_COLORS.marker &&
        deps.lineationLastColors.value.wavy ===
          DEFAULT_LINEATION_LAST_COLORS.wavy &&
        deps.lineationLastColors.value.straight ===
          DEFAULT_LINEATION_LAST_COLORS.straight
          ? undefined
          : { ...deps.lineationLastColors.value },
      highlightLastColor:
        deps.highlightLastColor.value === DEFAULT_HIGHLIGHT_LAST_COLOR
          ? undefined
          : deps.highlightLastColor.value,
      ebookConvertOutputDir: deps.ebookConvertOutputDir.value,
      bookPackUnpackDir: deps.bookPackUnpackDir.value.trim(),
      bookPackPassword: deps.bookPackPassword.value,
      webDavEnabled: deps.webDavEnabled.value,
      webDavUrl: deps.webDavUrl.value,
      webDavUsername: deps.webDavUsername.value,
      webDavRemoteDir: deps.webDavRemoteDir.value.trim() || "ColorTxt",
      characterPortraitCacheDir: deps.characterPortraitCacheDir.value.trim(),
      characterCardTextureEffect: deps.characterCardTextureEffect.value,
      fileCategory: deps.fileCategory.value,
      fileSort: deps.fileSort.value,
      fileListViewMode: deps.fileListViewMode.value,
      fileCategoryCatalog: deps.fileCategoryCatalog.value,
      aiSkillsEnabled: deps.aiSkillsEnabled.value,
      aiSkillOverrides:
        Object.keys(deps.aiSkillOverrides.value).length > 0
          ? deps.aiSkillOverrides.value
          : undefined,
      aiCustomSkills:
        deps.aiCustomSkills.value.length > 0
          ? deps.aiCustomSkills.value
          : undefined,
      aiAssistantDeepThinking: deps.aiAssistantDeepThinking.value,
      aiAssistantSpoilerSafe: deps.aiAssistantSpoilerSafe.value,
      wordcloudFontFamily: deps.wordcloudFontFamily.value,
      wordcloudAngleMode: deps.wordcloudAngleMode.value,
      wordcloudPaletteId: deps.wordcloudPaletteId.value,
      voiceRead: voiceReadPayload,
    };
  }

  function captureSettingsPersistBaselineFromMemory() {
    const patch = buildSettingsPersistPatch(buildVoiceReadPersistPayload());
    for (const key of WINDOW_LOCAL_MAIN_SETTING_KEYS) {
      if (key in patch && patch[key] !== undefined) {
        settingsPersistBaseline[key] = clonePersistBaselineValue(patch[key]);
      } else if (key === "pinnedOtherFonts") {
        settingsPersistBaseline[key] = [];
      }
    }
  }
  let storageSyncBound = false;

  /** 合并短时间内的 file.meta 写盘，避免换书 / 恢复 / 拖入打开时主线程长时间 JSON.stringify */
  const FILE_META_DISK_DEBOUNCE_MS = 420;
  let fileMetaWriteTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFileMetaWrite: "gated" | "forced" | null = null;

  function mergePendingFileMetaMode(
    prev: "gated" | "forced" | null,
    next: "gated" | "forced",
  ): "gated" | "forced" {
    if (prev === "forced" || next === "forced") return "forced";
    return "gated";
  }

  function cancelScheduledFileMetaWrite() {
    if (fileMetaWriteTimer !== null) {
      clearTimeout(fileMetaWriteTimer);
      fileMetaWriteTimer = null;
    }
    pendingFileMetaWrite = null;
  }

  /**
   * 写盘前与磁盘态按路径合并，避免多窗口整表 setItem 互相覆盖未在本窗打开的文件进度。
   * 正在阅读的文件保留本窗 progress / 视图状态。
   */
  function mergeFileMetaWithDiskAndPersist(tieBreak: "local" | "remote") {
    const disk = loadFileMetaRecords(window.localStorage, fileMetaKey);
    const merged = mergeFileMetaRecords(deps.fileMetaRecords.value, disk, {
      preferLocalReadingPath: deps.currentFile.value,
      tieBreak,
    });
    deps.fileMetaRecords.value = merged;
    rebuildMetaProgressMap();
    persistFileMetaRecords(window.localStorage, fileMetaKey, merged);
  }

  /**
   * 清除阅读数据：内存删除 → 取消防抖 → 以当前内存直接覆盖写盘（不合并）。
   * setItem 会触发他窗 storage，他窗按磁盘重载；可选同时移出最近打开。
   */
  function removeFileMetaPaths(
    pathKeys: Iterable<string>,
    opts?: { removeFromRecent?: boolean },
  ) {
    const keys = new Set<string>();
    for (const raw of pathKeys) {
      const k = normalizeFileMetaPathKey(raw);
      if (k) keys.add(k);
    }
    if (keys.size === 0) return;

    deps.fileMetaRecords.value = deps.fileMetaRecords.value.filter(
      (m) => !keys.has(normalizeFileMetaPathKey(m.path)),
    );
    for (const k of keys) {
      if (metaProgressByPathKey.value.has(k)) {
        const m = new Map(metaProgressByPathKey.value);
        m.delete(k);
        metaProgressByPathKey.value = m;
      }
    }

    if (opts?.removeFromRecent !== false) {
      deps.recentFiles.value = deps.recentFiles.value.filter(
        (r) => !keys.has(fileHistoryKey(r.path)),
      ) as typeof deps.recentFiles.value;
      persistRecentFiles();
    }

    cancelScheduledFileMetaWrite();
    persistFileMetaRecords(
      window.localStorage,
      fileMetaKey,
      deps.fileMetaRecords.value,
    );
    rebuildMetaProgressMap();
  }

  function runScheduledFileMetaWrite() {
    fileMetaWriteTimer = null;
    const mode = pendingFileMetaWrite;
    pendingFileMetaWrite = null;
    if (mode === null) return;
    if (mode === "gated") {
      if (deps.currentFile.value && !deps.readingProgressSynced.value) return;
    }
    mergeFileMetaWithDiskAndPersist("local");
  }

  function scheduleFileMetaDiskWrite(mode: "gated" | "forced") {
    pendingFileMetaWrite = mergePendingFileMetaMode(pendingFileMetaWrite, mode);
    if (fileMetaWriteTimer !== null) clearTimeout(fileMetaWriteTimer);
    fileMetaWriteTimer = setTimeout(
      runScheduledFileMetaWrite,
      FILE_META_DISK_DEBOUNCE_MS,
    );
  }

  /** 从 file.meta 构建的进度映射；仅在 meta 结构变化时整表重建，避免滚动时 O(列表长度) */
  const metaProgressByPathKey: ShallowRef<Map<string, number>> = shallowRef(
    new Map(),
  );
  /** 当前打开文件的实时阅读进度（%），滚动 probe 更新；切书/落盘 meta 后清除 */
  const liveReadingProgress = ref<number | undefined>(undefined);

  function rebuildMetaProgressMap() {
    const m = new Map<string, number>();
    for (const r of deps.fileMetaRecords.value) {
      if (typeof r.progress !== "number" || !Number.isFinite(r.progress)) {
        continue;
      }
      m.set(fileHistoryKey(r.path), r.progress);
    }
    metaProgressByPathKey.value = m;
  }

  /** 换书前仅更新一条路径的进度映射，避免 `rebuildMetaProgressMap` 整表 O(M) 扫描拖慢打开 */
  function patchMetaProgressForPath(path: string, progress: number) {
    if (!Number.isFinite(progress)) return;
    const key = fileHistoryKey(path);
    const m = metaProgressByPathKey.value;
    if (m.get(key) === progress) return;
    m.set(key, progress);
    triggerRef(metaProgressByPathKey);
  }

  /** 避免每次写文件列表缓存都重写相同 JSON */
  let lastPersistedTxtFilesJson = (() => {
    try {
      return window.localStorage.getItem(fileListKey) ?? "";
    } catch {
      return "";
    }
  })();

  function persistFileListCache(opts?: { force?: boolean }) {
    if (deps.fileListEditing.value && !opts?.force) return;
    const next = deps.txtFiles.value as TxtFileItem[];
    let json: string;
    try {
      json = JSON.stringify(next);
    } catch {
      return;
    }
    if (json === lastPersistedTxtFilesJson) return;
    persistTxtFileListSnapshot(window.localStorage, fileListKey, next);
    lastPersistedTxtFilesJson = json;
  }

  function recentLimit(): number {
    const n = Math.floor(deps.recentFilesHistoryLimit.value);
    return Math.max(0, Math.min(maxRecentFilesHistoryLimit, n));
  }

  function persistRecentFiles() {
    persistRecentFileRecords(
      window.localStorage,
      recentFilesKey,
      deps.recentFiles.value,
    );
  }

  function loadRecentFiles() {
    deps.recentFiles.value = loadRecentFileRecords(
      window.localStorage,
      recentFilesKey,
      recentLimit(),
    ) as RecentFileItem[];
  }

  function persistFileMeta() {
    scheduleFileMetaDiskWrite("gated");
  }

  /** 取消防抖并不受阅读进度同步门控，立即写入 file.meta（关窗等场景须落盘进度/书签/视图状态等） */
  function persistFileMetaImmediate() {
    cancelScheduledFileMetaWrite();
    // 滚动原地改 progress 不刷新 updatedAt；关窗落盘前抬一下，便于与他窗合并时本窗进度胜出
    const openPath = deps.currentFile.value?.trim();
    if (openPath && deps.readingProgressSynced.value) {
      const cur = findFileMetaRecord(deps.fileMetaRecords.value, openPath);
      if (cur) cur.updatedAt = Date.now();
    }
    mergeFileMetaWithDiskAndPersist("local");
  }

  /** 将内存中的最近文件与 file meta 写入 localStorage（窗口关闭时与内存中滚动等未落盘状态对齐） */
  function flushRecentFilesAndFileMetaToDisk() {
    persistRecentFiles();
    persistFileMetaImmediate();
  }

  function loadFileMeta() {
    deps.fileMetaRecords.value = loadFileMetaRecords(
      window.localStorage,
      fileMetaKey,
    );
    rebuildMetaProgressMap();
  }

  /**
   * 他窗写入 file.meta 后：以磁盘为权威重载内存。
   * 若本窗正在读的书仍在磁盘上，仅把本窗未落盘的进度/视口盖回去，避免滚动被冲掉；
   * 若磁盘已无该书（他窗已清除），则不再保留本窗旧 meta。
   */
  function syncFileMetaFromOtherWindow() {
    const disk = loadFileMetaRecords(window.localStorage, fileMetaKey);
    const openPath = deps.currentFile.value?.trim() ?? "";
    if (!openPath) {
      deps.fileMetaRecords.value = disk;
      rebuildMetaProgressMap();
      return;
    }
    const localCur = findFileMetaRecord(deps.fileMetaRecords.value, openPath);
    const diskCur = findFileMetaRecord(disk, openPath);
    if (!localCur || !diskCur) {
      deps.fileMetaRecords.value = disk;
      rebuildMetaProgressMap();
      return;
    }
    const openKey = normalizeFileMetaPathKey(openPath);
    const without = disk.filter(
      (m) => normalizeFileMetaPathKey(m.path) !== openKey,
    );
    deps.fileMetaRecords.value = [
      {
        ...diskCur,
        progress: localCur.progress,
        editorViewState: localCur.editorViewState,
        viewportTopPhysicalLine: localCur.viewportTopPhysicalLine,
      },
      ...without,
    ];
    rebuildMetaProgressMap();
  }

  /** 多窗口：其它窗口写 localStorage 后，本窗口按 key 增量重载内存态。 */
  function onStorageSync(ev: StorageEvent) {
    if (ev.storageArea !== window.localStorage) return;
    if (ev.key === null) {
      // clear()：按当前配置保留既有加载流程，做最小必要重载
      loadRecentFiles();
      loadFileMeta();
      deps.txtFiles.value = loadTxtFileListSnapshot(
        window.localStorage,
        fileListKey,
      );
      return;
    }
    if (ev.key === fileListKey) {
      deps.txtFiles.value = loadTxtFileListSnapshot(
        window.localStorage,
        fileListKey,
      );
      try {
        lastPersistedTxtFilesJson =
          window.localStorage.getItem(fileListKey) ?? "";
      } catch {
        lastPersistedTxtFilesJson = "";
      }
      return;
    }
    if (ev.key === fileMetaKey) {
      syncFileMetaFromOtherWindow();
      return;
    }
    if (ev.key === recentFilesKey) {
      loadRecentFiles();
      return;
    }
    if (ev.key === persistKey) {
      // 侧栏开关/宽度、阅读/编辑/语音朗读相关 UI 按窗口独立；其它设置仍跨窗同步
      loadPersistedSettings({
        applySidebarWidth: false,
        applyShowSidebar: false,
        applyMinimalistView: false,
        applyReaderUiPrefs: false,
      });
    }
  }

  /** 设置中的历史条数变更后：裁剪列表并写盘 */
  function applyRecentFilesHistoryLimitFromSettings() {
    const lim = recentLimit();
    if (lim <= 0) {
      deps.recentFiles.value = [];
    } else {
      deps.recentFiles.value = deps.recentFiles.value.slice(
        0,
        lim,
      ) as RecentFileItem[];
    }
    persistRecentFiles();
  }

  /**
   * 同步更新内存中的 recent（仅路径顺序）与 file meta（进度 + Monaco 视图状态）。
   * - persistRecent：写入 colorTxt.recent.files
   * - persistMeta：写入 colorTxt.file.meta（关窗前等；受 readingProgressSynced 门控见 persistFileMeta）
   * - updateMeta：为 false 时（滚动 probe）不替换 meta 数组，仅原地改当前条，降低开销
   * - rebuildProgressMap：仅在与 `updateMeta: false` 联用且需刷新 `metaProgressByPathKey` 时设为 true（如换书前落盘）；滚动 probe 切勿开启，否则每帧整表重建映射会卡死滚动。
   * 未传 `editorViewState` 且 `currentFile === path` 时从阅读器 `saveViewState` 取快照。
   */
  function touchRecentFile(
    path: string,
    moveToTop: boolean,
    opts?: {
      persistRecent?: boolean;
      persistMeta?: boolean;
      updateMeta?: boolean;
      /** 原地写 progress 后是否重建进度映射（默认 false） */
      rebuildProgressMap?: boolean;
      progress?: number;
      editorViewState?: unknown;
    },
  ) {
    if (recentLimit() <= 0) return;
    deps.recentFiles.value = upsertRecentFileRecord(
      deps.recentFiles.value,
      path,
      recentLimit(),
      moveToTop,
    ) as RecentFileItem[];

    const progress = opts?.progress;
    /**
     * 流结束并完成视口恢复前 `readingProgressSynced === false`：编辑器常仍在顶部，
     * 此时勿用 live viewState / 视口覆盖 meta（否则会冲掉书包导入的 viewportTopPhysicalLine）。
     * 显式传入 `editorViewState` 时仍照常写入。
     */
    const canCaptureLiveViewport =
      deps.readingProgressSynced.value && deps.currentFile.value === path;
    const viewStateRaw =
      opts?.editorViewState !== undefined
        ? opts.editorViewState
        : canCaptureLiveViewport
          ? (deps.readerRef.value?.getSerializedEditorViewState?.() ??
            undefined)
          : undefined;
    const viewState: PersistedEditorViewState | undefined =
      viewStateRaw != null &&
      typeof viewStateRaw === "object" &&
      !Array.isArray(viewStateRaw)
        ? (viewStateRaw as PersistedEditorViewState)
        : undefined;

    const viewportTopPhysicalLine =
      viewState !== undefined &&
      canCaptureLiveViewport &&
      deps.readerRef.value?.getViewportTopLine
        ? deps.stream.viewportDisplayLineToPhysicalLine(
            deps.readerRef.value.getViewportTopLine(),
          )
        : undefined;

    const updateMeta = opts?.updateMeta !== false;
    if (updateMeta) {
      deps.fileMetaRecords.value = upsertFileMetaRecord(
        deps.fileMetaRecords.value,
        path,
        () => ({
          ...(typeof progress === "number" ? { progress } : {}),
          ...(viewState !== undefined ? { editorViewState: viewState } : {}),
          ...(viewportTopPhysicalLine !== undefined
            ? { viewportTopPhysicalLine }
            : {}),
        }),
      );
      rebuildMetaProgressMap();
      liveReadingProgress.value = undefined;
    } else {
      const prev = findFileMetaRecord(deps.fileMetaRecords.value, path);
      if (prev) {
        if (typeof progress === "number") prev.progress = progress;
        if (viewState !== undefined) prev.editorViewState = viewState;
        if (viewportTopPhysicalLine !== undefined) {
          prev.viewportTopPhysicalLine = viewportTopPhysicalLine;
        }
        if (opts?.rebuildProgressMap === true && typeof progress === "number") {
          rebuildMetaProgressMap();
        }
      } else if (typeof progress === "number" || viewState !== undefined) {
        deps.fileMetaRecords.value = upsertFileMetaRecord(
          deps.fileMetaRecords.value,
          path,
          () => ({
            ...(typeof progress === "number" ? { progress } : {}),
            ...(viewState !== undefined ? { editorViewState: viewState } : {}),
            ...(viewportTopPhysicalLine !== undefined
              ? { viewportTopPhysicalLine }
              : {}),
          }),
        );
        rebuildMetaProgressMap();
      }
      liveReadingProgress.value =
        typeof progress === "number" ? progress : undefined;
    }

    if (opts?.persistRecent) persistRecentFiles();
    if (opts?.persistMeta) persistFileMeta();
  }

  function removeRecentFile(path: string) {
    deps.recentFiles.value = removeRecentFileRecord(
      deps.recentFiles.value,
      path,
    ) as RecentFileItem[];
    persistRecentFiles();
  }

  function getFileMeta(path: string) {
    return findFileMetaRecord(deps.fileMetaRecords.value, path);
  }

  function setEbookConvertedMeta(
    bookPath: string,
    convertedMdPath: string,
    sourceMtimeMs: number,
  ) {
    deps.fileMetaRecords.value = upsertFileMetaRecord(
      deps.fileMetaRecords.value,
      bookPath,
      () => ({
        convertedMdPath,
        sourceMtimeMsAtConvert: sourceMtimeMs,
      }),
    );
    rebuildMetaProgressMap();
  }

  /** 仅更新「最后打开时间」；写盘与换书落盘合并防抖，避免每次打开都同步 stringify 整份 meta */
  function touchFileLastOpened(path: string) {
    const p = path.trim();
    if (!p) return;
    const now = Date.now();
    const prev = findFileMetaRecord(deps.fileMetaRecords.value, p);
    if (prev) {
      prev.lastOpenedAt = now;
      prev.updatedAt = now;
    } else {
      deps.fileMetaRecords.value = upsertFileMetaRecord(
        deps.fileMetaRecords.value,
        p,
        () => ({ lastOpenedAt: now }),
      );
    }
    scheduleFileMetaDiskWrite("forced");
  }

  watch(
    () => deps.readingProgressSynced.value,
    (synced, wasSynced) => {
      if (synced && wasSynced === false) {
        const p = deps.currentFile.value?.trim();
        if (p) {
          touchFileLastOpened(p);
          // 恢复视口后补一次位置快照（书包仅有锚点、用户未再滚动时也能落盘 viewState）
          touchRecentFile(p, false, { updateMeta: false });
        }
        scheduleFileMetaDiskWrite("gated");
      }
    },
  );

  function upsertBookmark(path: string, line: number, note: string) {
    deps.fileMetaRecords.value = upsertBookmarkForFile(
      deps.fileMetaRecords.value,
      path,
      Math.max(1, Math.floor(line)),
      note,
    );
    rebuildMetaProgressMap();
  }

  function removeBookmark(path: string, line: number) {
    deps.fileMetaRecords.value = removeBookmarkForFile(
      deps.fileMetaRecords.value,
      path,
      Math.max(1, Math.floor(line)),
    );
    rebuildMetaProgressMap();
  }

  function clearBookmarks(path: string) {
    deps.fileMetaRecords.value = clearBookmarksForFile(
      deps.fileMetaRecords.value,
      path,
    );
    rebuildMetaProgressMap();
  }

  async function clearRecentFiles() {
    const r = await window.colorTxt.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      buttons: ["取消", "清除"],
      defaultId: 1,
      cancelId: 0,
      message: "是否要清除最近打开的所有文件？",
      detail: "此操作不可逆！",
      noLink: true,
    });
    if (r.response !== 1) return;
    deps.recentFiles.value = [];
    persistRecentFiles();
  }

  async function hydrateTranslationSecretsFromVault(): Promise<void> {
    try {
      const res = await window.colorTxt.secrets.getTranslationProviderKeys();
      const secrets = parseTranslationSecretsBlob(res.keys ?? "");
      deps.translationSettings.value = applyTranslationSecrets(
        mergeTranslationSettings(deps.translationSettings.value),
        secrets,
      );
    } catch {
      // ignore
    }
  }

  async function persistTranslationSecretsToVault() {
    const payload = await resolveTranslationSecretsWritePayload(
      deps.translationSettings.value,
      async () => {
        const res = await window.colorTxt.secrets.getTranslationProviderKeys();
        return res.keys ?? "";
      },
    );
    if (!payload) return;
    await window.colorTxt.secrets.setTranslationSecrets(payload);
  }

  async function hydrateVoiceReadSecretsFromVault(): Promise<boolean> {
    let migrated = false;
    try {
      const profileKeysRes =
        await window.colorTxt.secrets.getVoiceReadProfileKeys();
      const profileKeysBlob = profileKeysRes.keys ?? "";
      const profileKeys = parseProfileKeysBlob(profileKeysBlob);
      const activeId = deps.activeVoiceReadProfileId.value.trim();
      if (
        hydrateVoiceReadProfilesApiKeys(
          deps.voiceReadProfiles.value,
          profileKeys,
          profileKeysBlob,
          activeId,
        )
      ) {
        migrated = true;
      }

      const legacyRes = await window.colorTxt.secrets.getDeprecated(
        DEPRECATED_SECRET_SLOT_VOICE_READ_DASHSCOPE_API_KEY,
      );
      const legacyKey = legacyRes.ok ? legacyRes.value.trim() : "";
      const activeProfile =
        deps.voiceReadProfiles.value.find((p) => p.id === activeId) ??
        deps.voiceReadProfiles.value[0];
      if (
        legacyKey &&
        activeProfile &&
        !activeProfile.settings.dashscopeApiKey.trim()
      ) {
        activeProfile.settings.dashscopeApiKey = legacyKey;
        if (!activeProfile.settings.engineConfig.dashscopeApiKey?.trim()) {
          activeProfile.settings.engineConfig.dashscopeApiKey = legacyKey;
        }
        migrated = true;
      }

      if (activeProfile) {
        deps.voiceReadSettings.value = mergeVoiceReadSettings(
          activeProfile.settings,
        );
      }

      const flatLegacyKey = deps.voiceReadSettings.value.dashscopeApiKey.trim();
      if (!legacyKey && flatLegacyKey) {
        migrated = true;
      }
      if (!profileKeysBlob.trim() && deps.voiceReadProfiles.value.length > 0) {
        const collected = collectVoiceReadProfileApiKeys(
          deps.voiceReadProfiles.value,
        );
        if (Object.keys(collected).length > 0) {
          migrated = true;
        }
      } else if (migrated && profileKeysBlob.trim()) {
        migrated = true;
      }

      if (migrated) {
        await persistVoiceReadSecretsToVault();
      }
    } catch {
      // ignore
    }
    return migrated;
  }

  async function persistVoiceReadSecretsToVault() {
    const profiles = normalizeVoiceReadProfilesForSave(
      deps.voiceReadProfiles.value,
    );
    const existingRes = await window.colorTxt.secrets.getVoiceReadProfileKeys();
    const existingVault = parseProfileSecretsBlob(existingRes.keys ?? "");
    const mergedSecrets = mergeVoiceReadProfileSecretsForSave(
      profiles,
      existingVault,
    );
    const profileKeysBlob = serializeProfileSecretsBlob(mergedSecrets);
    await window.colorTxt.secrets.setVoiceReadSecrets({
      profileKeys: profileKeysBlob,
    });
  }

  function loadPersistedSettings(options?: {
    /** 为 false 时不覆盖本窗口侧栏宽度（多窗口 storage 同步） */
    applySidebarWidth?: boolean;
    /** 为 false 时不覆盖本窗口侧栏开关（多窗口 storage 同步） */
    applyShowSidebar?: boolean;
    /** 为 false 时不覆盖本窗口极简视图（多窗口 storage 同步） */
    applyMinimalistView?: boolean;
    /**
     * 为 false 时不覆盖本窗口阅读/编辑/语音朗读相关 UI。
     * 多窗口 storage 同步时使用，避免「界面仍是本窗值、打开设置却是别窗刚存的值」。
     */
    applyReaderUiPrefs?: boolean;
  }): {
    ebookConvertOutputDirKeyPresent: boolean;
    bookPackUnpackDirKeyPresent: boolean;
    characterPortraitCacheDirKeyPresent: boolean;
  } {
    const applySidebarWidth = options?.applySidebarWidth !== false;
    const applyShowSidebar = options?.applyShowSidebar !== false;
    const applyMinimalistView = options?.applyMinimalistView !== false;
    const applyReaderUiPrefs = options?.applyReaderUiPrefs !== false;
    const loaded = loadPersistedSettingsData(
      typeof window !== "undefined" ? window.localStorage : undefined,
      persistKey,
    );
    if (!loaded) {
      return {
        ebookConvertOutputDirKeyPresent: false,
        bookPackUnpackDirKeyPresent: false,
        characterPortraitCacheDirKeyPresent: false,
      };
    }
    const {
      data,
      ebookConvertOutputDirKeyPresent,
      bookPackUnpackDirKeyPresent,
      characterPortraitCacheDirKeyPresent,
    } = loaded;

    if (data.theme) deps.currentTheme.value = data.theme;

    if (
      applySidebarWidth &&
      typeof data.sidebarWidth === "number" &&
      Number.isFinite(data.sidebarWidth)
    ) {
      deps.sidebarWidth.value = Math.max(0, Math.floor(data.sidebarWidth));
    }

    if (applyShowSidebar && typeof data.showSidebar === "boolean") {
      deps.showSidebar.value = data.showSidebar;
    }

    if (applyMinimalistView && typeof data.isMinimalistView === "boolean") {
      deps.isMinimalistView.value = data.isMinimalistView;
    }

    if (applyReaderUiPrefs) {
      if (typeof data.monacoCustomHighlight === "boolean") {
        deps.monacoCustomHighlight.value = data.monacoCustomHighlight;
      }

      if (typeof data.compressBlankLines === "boolean") {
        deps.compressBlankLines.value = data.compressBlankLines;
      }

      if (typeof data.compressBlankKeepOneBlank === "boolean") {
        deps.compressBlankKeepOneBlank.value = data.compressBlankKeepOneBlank;
      }

      if (data.chapterTitleBlankMode !== undefined) {
        deps.chapterTitleBlankMode.value = parseChapterTitleBlankMode(
          data.chapterTitleBlankMode,
        );
      }

      if (typeof data.txtrDelimitedMatchCrossLine === "boolean") {
        deps.txtrDelimitedMatchCrossLine.value =
          data.txtrDelimitedMatchCrossLine;
      }

      if (typeof data.leadIndentFullWidth === "boolean") {
        deps.leadIndentFullWidth.value = data.leadIndentFullWidth;
      }

      if (data.textConvertZh != null) {
        deps.textConvertZh.value = parseTextConvertZhMode(data.textConvertZh);
      }
      if (data.textConvertLetter != null) {
        deps.textConvertLetter.value = parseTextConvertWidthMode(
          data.textConvertLetter,
        );
      }
      if (data.textConvertDigit != null) {
        deps.textConvertDigit.value = parseTextConvertWidthMode(
          data.textConvertDigit,
        );
      }
    }

    if (typeof data.showChapterCounts === "boolean") {
      deps.showChapterCounts.value = data.showChapterCounts;
    }
    if (typeof data.chapterCharCountExact === "boolean") {
      deps.chapterCharCountExact.value = data.chapterCharCountExact;
    }

    if (applyReaderUiPrefs) {
      if (typeof data.fontSize === "number") {
        deps.readerFontSize.value = Math.max(
          minFontSize,
          Math.min(maxFontSize, Math.round(data.fontSize)),
        );
      }

      if (typeof data.lineHeightMultiple === "number") {
        deps.readerLineHeightMultiple.value = clampLineHeightMultipleForFontSize(
          deps.readerFontSize.value,
          data.lineHeightMultiple,
        );
      }

      if (typeof data.lineSpacingPx === "number") {
        deps.readerLineSpacingPx.value = clampLineSpacingPx(data.lineSpacingPx);
      }

      if (typeof data.letterSpacingPx === "number") {
        deps.readerLetterSpacingPx.value = clampLetterSpacingPx(
          data.letterSpacingPx,
        );
      }

      if (typeof data.readerHorizontalInsetPx === "number") {
        deps.readerHorizontalInsetPx.value = clampReaderHorizontalInsetPx(
          data.readerHorizontalInsetPx,
        );
      }

      if (typeof data.fontFamily === "string" && data.fontFamily.trim()) {
        deps.monacoFontFamily.value = data.fontFamily;
      }
      if (Array.isArray(data.pinnedOtherFonts)) {
        deps.pinnedOtherFonts.value = data.pinnedOtherFonts
          .map((f) => f.trim())
          .filter(Boolean);
      }
    }

    if (typeof data.restoreSessionOnStartup === "boolean") {
      deps.restoreSessionOnStartup.value = data.restoreSessionOnStartup;
    }

    if (typeof data.syncCurrentFile === "boolean") {
      deps.syncCurrentFile.value = data.syncCurrentFile;
    }

    if (
      typeof data.recentFilesHistoryLimit === "number" &&
      Number.isFinite(data.recentFilesHistoryLimit)
    ) {
      deps.recentFilesHistoryLimit.value = Math.max(
        0,
        Math.min(
          maxRecentFilesHistoryLimit,
          Math.floor(data.recentFilesHistoryLimit),
        ),
      );
    } else {
      deps.recentFilesHistoryLimit.value = defaultRecentFilesHistoryLimit;
    }
    if (
      typeof data.chapterMinCharCount === "number" &&
      Number.isFinite(data.chapterMinCharCount)
    ) {
      deps.chapterMinCharCount.value = Math.max(
        minChapterMinCharCount,
        Math.min(maxChapterMinCharCount, Math.floor(data.chapterMinCharCount)),
      );
    } else {
      deps.chapterMinCharCount.value = defaultChapterMinCharCount;
    }

    if (applyReaderUiPrefs) {
      if (typeof data.monacoAdvancedWrapping === "boolean") {
        deps.monacoAdvancedWrapping.value = data.monacoAdvancedWrapping;
      }
      if (typeof data.monacoCjkWrapOptimize === "boolean") {
        deps.monacoCjkWrapOptimize.value = data.monacoCjkWrapOptimize;
      }
      if (typeof data.monacoSmoothScrolling === "boolean") {
        deps.monacoSmoothScrolling.value = data.monacoSmoothScrolling;
      }
      deps.scrollbarTrackBehavior.value = parseScrollbarTrackBehavior(
        data.scrollbarTrackBehavior,
        data.disableScrollbarTrackJump,
      );
      if (
        typeof data.mouseWheelScrollSensitivity === "number" &&
        Number.isFinite(data.mouseWheelScrollSensitivity)
      ) {
        deps.mouseWheelScrollSensitivity.value =
          clampMouseWheelScrollSensitivity(data.mouseWheelScrollSensitivity);
      } else {
        deps.mouseWheelScrollSensitivity.value =
          defaultMouseWheelScrollSensitivity;
      }
      if (
        typeof data.fastScrollSensitivity === "number" &&
        Number.isFinite(data.fastScrollSensitivity)
      ) {
        deps.fastScrollSensitivity.value = clampFastScrollSensitivity(
          data.fastScrollSensitivity,
        );
      } else {
        deps.fastScrollSensitivity.value = defaultFastScrollSensitivity;
      }
      if (typeof data.stickyChapterTitleEnabled === "boolean") {
        deps.stickyChapterTitleEnabled.value = data.stickyChapterTitleEnabled;
      }
      if (typeof data.readerClickMode === "boolean") {
        deps.readerClickMode.value = data.readerClickMode;
      }
      if (typeof data.readingRulerEnabled === "boolean") {
        deps.readingRulerEnabled.value = data.readingRulerEnabled;
      }
      if (
        typeof data.readingRulerFocusLines === "number" &&
        Number.isFinite(data.readingRulerFocusLines)
      ) {
        deps.readingRulerFocusLines.value = clampReadingRulerFocusLines(
          data.readingRulerFocusLines,
        );
      }
      if (
        typeof data.readingRulerDimOpacity === "number" &&
        Number.isFinite(data.readingRulerDimOpacity)
      ) {
        deps.readingRulerDimOpacity.value = clampReadingRulerDimOpacity(
          data.readingRulerDimOpacity,
        );
      }
      if (typeof data.readingRulerDimStickyTitle === "boolean") {
        deps.readingRulerDimStickyTitle.value = data.readingRulerDimStickyTitle;
      }
      if (typeof data.readingRulerTransitionEnabled === "boolean") {
        deps.readingRulerTransitionEnabled.value =
          data.readingRulerTransitionEnabled;
      }
      if (
        typeof data.markdownImageHeightPx === "number" &&
        Number.isFinite(data.markdownImageHeightPx)
      ) {
        deps.markdownImageHeightPx.value = clampMarkdownImageHeightPx(
          data.markdownImageHeightPx,
        );
      }
      if (typeof data.chapterNavToolbarEnabled === "boolean") {
        deps.chapterNavToolbarEnabled.value = data.chapterNavToolbarEnabled;
      }
      if (typeof data.readerEditShowLineNumbers === "boolean") {
        deps.readerEditShowLineNumbers.value = data.readerEditShowLineNumbers;
      }
      if (typeof data.readerEditMinimap === "boolean") {
        deps.readerEditMinimap.value = data.readerEditMinimap;
      }
      if (typeof data.editAutoRefreshChapterList === "boolean") {
        deps.editAutoRefreshChapterList.value =
          data.editAutoRefreshChapterList;
      }
      deps.aiSmartFormat.value = mergeAiSmartFormatSettings(data.aiSmartFormat);
      if (
        typeof data.fullscreenReaderWidthPercent === "number" &&
        Number.isFinite(data.fullscreenReaderWidthPercent)
      ) {
        deps.fullscreenReaderWidthPercent.value = Math.max(
          minFullscreenReaderWidthPercent,
          Math.min(
            maxFullscreenReaderWidthPercent,
            Math.floor(data.fullscreenReaderWidthPercent),
          ),
        );
      } else {
        deps.fullscreenReaderWidthPercent.value =
          defaultFullscreenReaderWidthPercent;
      }
      if (typeof data.fullscreenShowSystemTime === "boolean") {
        deps.fullscreenShowSystemTime.value = data.fullscreenShowSystemTime;
      } else {
        deps.fullscreenShowSystemTime.value = defaultFullscreenShowSystemTime;
      }
      deps.timedScrollSettings.value = mergeTimedScrollSettings(
        data.timedScroll,
      );
      deps.pomodoroSettings.value = mergePomodoroSettings(data.pomodoro);
      deps.selectionToolbarButtons.value = mergeSelectionToolbarButtons(
        data.selectionToolbarButtons,
      );
      deps.dictionarySettings.value = mergeDictionarySettings(
        data.dictionarySettings,
      );
      deps.webSearchSettings.value = mergeWebSearchSettings(
        data.webSearchSettings,
      );
      const mergedTranslation = mergeTranslationSettings(
        data.translationSettings,
      );
      deps.translationSettings.value = stripTranslationSecretsForDisk(
        mergedTranslation,
      );
    }
    deps.shortcutBindings.value = mergeShortcutBindings(
      deps.defaultShortcutBindings,
      data.shortcutBindings,
    );

    deps.readerPaletteColorEnabledOverrides.value =
      data.readerPaletteColorEnabledOverrides
        ? { ...data.readerPaletteColorEnabledOverrides }
        : {};
    deps.readerBackground.value = parseReaderBackgroundState(
      data.readerBackground,
    );
    const loadedUserPresets = parseReaderPaletteUserPresets(
      data.readerPaletteUserPresets,
    );
    deps.readerPaletteUserPresets.value = loadedUserPresets;
    deps.readerPaletteSelectedIdLight.value = parseReaderPaletteSelectedId(
      data.readerPaletteSelectedIdLight,
    );
    deps.readerPaletteSelectedIdDark.value = parseReaderPaletteSelectedId(
      data.readerPaletteSelectedIdDark,
    );

    const parsedHL = parseHighlightColorsArray(data.highlightColorsLight);
    deps.highlightColorsLight.value = mergeHighlightColors(
      DEFAULT_HIGHLIGHT_COLORS_LIGHT,
      parsedHL,
    );
    const parsedHD = parseHighlightColorsArray(data.highlightColorsDark);
    deps.highlightColorsDark.value = mergeHighlightColors(
      DEFAULT_HIGHLIGHT_COLORS_DARK,
      parsedHD,
    );

    const parsedLL = parseLineationColorsArray(data.lineationColorsLight);
    deps.lineationColorsLight.value = mergeLineationColors(
      DEFAULT_LINEATION_COLORS_LIGHT,
      parsedLL,
    );
    const parsedLD = parseLineationColorsArray(data.lineationColorsDark);
    deps.lineationColorsDark.value = mergeLineationColors(
      DEFAULT_LINEATION_COLORS_DARK,
      parsedLD,
    );

    deps.highlightWordsByIndexGlobal.value = normalizeHighlightWordsByIndex(
      data.highlightWordsByIndexGlobal,
    );

    deps.lineationLastColors.value = clampLineationLastColorsToCount(
      parseLineationLastColors(data.lineationLastColors),
      deps.lineationColorsLight.value.length,
    );

    deps.highlightLastColor.value = clampHighlightLastColorToCount(
      parseHighlightLastColor(data.highlightLastColor),
      deps.highlightColorsLight.value.length,
    );

    const normalizedRules = normalizeLoadedChapterRules(data.chapterRules);
    if (normalizedRules) {
      try {
        setChapterMatchRules(normalizedRules);
        deps.chapterRuleState.value = getChapterMatchRules();
      } catch {
        // ignore invalid persisted patterns
      }
    }

    if (typeof data.ebookConvertOutputDir === "string") {
      deps.ebookConvertOutputDir.value = data.ebookConvertOutputDir;
    }

    if (typeof data.bookPackUnpackDir === "string") {
      deps.bookPackUnpackDir.value = data.bookPackUnpackDir.trim();
    }

    if (typeof data.bookPackPassword === "string") {
      deps.bookPackPassword.value = data.bookPackPassword;
    }

    if (typeof data.webDavEnabled === "boolean") {
      deps.webDavEnabled.value = data.webDavEnabled;
    }
    if (typeof data.webDavUrl === "string") {
      deps.webDavUrl.value = data.webDavUrl;
    }
    if (typeof data.webDavUsername === "string") {
      deps.webDavUsername.value = data.webDavUsername;
    }
    if (typeof data.webDavRemoteDir === "string") {
      deps.webDavRemoteDir.value = data.webDavRemoteDir.trim() || "ColorTxt";
    }

    if (typeof data.characterPortraitCacheDir === "string") {
      deps.characterPortraitCacheDir.value =
        data.characterPortraitCacheDir.trim();
    }

    deps.characterCardTextureEffect.value = normalizeCharacterCardTextureEffect(
      data.characterCardTextureEffect,
    );

    deps.fileCategory.value = normalizeCategoryFilter(data.fileCategory);
    deps.fileSort.value = isFileSortMode(data.fileSort)
      ? data.fileSort
      : DEFAULT_FILE_SORT;
    deps.fileListViewMode.value =
      data.fileListViewMode !== undefined
        ? parseFileListViewMode(data.fileListViewMode)
        : DEFAULT_FILE_LIST_VIEW_MODE;
    if (data.fileCategoryCatalog && data.fileCategoryCatalog.length > 0) {
      deps.fileCategoryCatalog.value = data.fileCategoryCatalog.map((c) => ({
        ...c,
      }));
    } else {
      deps.fileCategoryCatalog.value = cloneDefaultFileCategoryCatalog();
    }

    deps.aiSkillOverrides.value = mergeAiSkillOverrides(data.aiSkillOverrides);
    deps.aiCustomSkills.value = data.aiCustomSkills?.length
      ? mergeAiCustomSkills(data.aiCustomSkills)
      : [];

    const customIds = deps.aiCustomSkills.value.map((s) => s.id);
    deps.aiSkillsEnabled.value = mergeAiSkillsEnabled(
      data.aiSkillsEnabled,
      customIds,
    );

    if (typeof data.aiAssistantDeepThinking === "boolean") {
      deps.aiAssistantDeepThinking.value = data.aiAssistantDeepThinking;
    }
    if (typeof data.aiAssistantSpoilerSafe === "boolean") {
      deps.aiAssistantSpoilerSafe.value = data.aiAssistantSpoilerSafe;
    }

    if (
      typeof data.wordcloudFontFamily === "string" &&
      data.wordcloudFontFamily.trim()
    ) {
      deps.wordcloudFontFamily.value = data.wordcloudFontFamily.trim();
    }
    if (data.wordcloudAngleMode) {
      deps.wordcloudAngleMode.value = data.wordcloudAngleMode;
    }
    if (data.wordcloudPaletteId) {
      deps.wordcloudPaletteId.value = data.wordcloudPaletteId;
    }

    if (applyReaderUiPrefs) {
      const voiceReadBundle = migrateVoiceReadFromPersisted(
        data.voiceRead as PersistedVoiceReadRaw | undefined,
      );
      deps.voiceReadProfiles.value = voiceReadBundle.profiles;
      deps.activeVoiceReadProfileId.value = voiceReadBundle.activeProfileId;
      deps.voiceReadSettings.value = mergeVoiceReadSettings(
        voiceReadBundle.activeSettings,
      );
      const vrRaw = data.voiceRead as PersistedVoiceReadRaw | undefined;
      hydrateVoiceReadAiSpeakerTokenUsage({
        usage: vrRaw?.aiSpeakerTokenUsage,
        available: vrRaw?.aiSpeakerTokenUsageAvailable === true,
      });
      setVoiceReadProfileBaseline(deps.voiceReadProfiles.value);
    }

    if (applyReaderUiPrefs) {
      captureSettingsPersistBaselineFromMemory();
    } else {
      if (applySidebarWidth) {
        settingsPersistBaseline.sidebarWidth = deps.sidebarWidth.value;
      }
      if (applyShowSidebar) {
        settingsPersistBaseline.showSidebar = deps.showSidebar.value;
      }
      if (applyMinimalistView) {
        settingsPersistBaseline.isMinimalistView =
          deps.isMinimalistView.value;
      }
    }

    return {
      ebookConvertOutputDirKeyPresent,
      bookPackUnpackDirKeyPresent,
      characterPortraitCacheDirKeyPresent,
    };
  }

  function flushPersistSettings() {
    if (!settingsLoaded.value) return;
    if (persistingSettings) {
      persistSettingsPending = true;
      return;
    }
    try {
      if (
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem(skipSettingsPersistenceSessionKey) === "1"
      ) {
        return;
      }
    } catch {
      // ignore
    }

    persistingSettings = true;
    try {
      const localVoicePayload = buildVoiceReadPersistPayload();
      const patch = buildSettingsPersistPatch(localVoicePayload);
      const disk = readPersistedMainSettingsObject();
      const voiceSkip = new Set<string>(["voiceRead"]);
      const { next, writtenKeys } = mergeLocalPatchOntoDiskSettings({
        disk,
        patch,
        baseline: settingsPersistBaseline,
        skipKeys: voiceSkip,
      });
      applyBaselineUpdates(settingsPersistBaseline, patch, writtenKeys);

      const voiceDirty = !settingsPersistValuesEqual(
        localVoicePayload,
        settingsPersistBaseline.voiceRead,
      );
      if (voiceDirty) {
        const diskVoice = migrateVoiceReadFromPersisted(
          disk.voiceRead as PersistedVoiceReadRaw | undefined,
        );
        const mergedVoice = mergeVoiceReadProfilesForPersist({
          localProfiles: deps.voiceReadProfiles.value,
          diskProfiles: diskVoice.profiles,
          baselineKnownIds: voiceReadProfileBaselineIds,
          localActiveProfileId: deps.activeVoiceReadProfileId.value,
          diskActiveProfileId: diskVoice.activeProfileId,
        });
        const voiceReadMerged = stripVoiceReadSettingsApiKeysForDisk(
          mergeVoiceReadSettings(deps.voiceReadSettings.value),
        );
        const profilesForDisk = stripVoiceReadProfileApiKeysForDisk(
          normalizeVoiceReadProfilesForSave(mergedVoice.profiles),
        );
        const voiceReadTokenPayload =
          voiceReadAiSpeakerTokenUsagePersistPayload();
        next.voiceRead = {
          activeProfileId: mergedVoice.activeProfileId,
          profiles: profilesForDisk,
          ...voiceReadMerged,
          aiSpeakerTokenUsage: voiceReadTokenPayload.usage,
          aiSpeakerTokenUsageAvailable: voiceReadTokenPayload.available,
        };
        // 基线只记本窗内存；磁盘合并结果不灌回本窗
        settingsPersistBaseline.voiceRead =
          clonePersistBaselineValue(localVoicePayload);
        setVoiceReadProfileBaseline(deps.voiceReadProfiles.value);
      }

      persistSettingsData(
        window.localStorage,
        persistKey,
        next as PersistedSettingsData,
      );
    } finally {
      // watch(voiceRead*) 在当前 tick 结束后触发，延后清标志避免再入死循环
      void nextTick(() => {
        persistingSettings = false;
        if (persistSettingsPending) {
          persistSettingsPending = false;
          persistSettings();
        }
      });
    }
  }

  function persistSettings() {
    if (!settingsLoaded.value) return;
    // 配色「应用」会同步连调多次；先合并到 nextTick，用最终内存写盘，避免中途旧色表落盘
    if (persistSettingsQueued) return;
    persistSettingsQueued = true;
    void nextTick(() => {
      persistSettingsQueued = false;
      flushPersistSettings();
    });
  }

  /** 仅写入侧栏宽度（相对基线有改动时），不整份回写阅读等设置 */
  function persistSidebarWidth() {
    if (!settingsLoaded.value) return;
    patchPersistedMainSettings(
      { sidebarWidth: deps.sidebarWidth.value },
      { baseline: settingsPersistBaseline },
    );
  }

  function clearPersistedSession() {
    const session = loadSessionSnapshot(window.localStorage, sessionKey);
    if (!session) return;
    persistSessionSnapshot(window.localStorage, sessionKey, {
      currentFile: null,
      viewportTopLine: 1,
      viewportBottomLine: 1,
    });
  }

  /** 仅写入 colorTxt.session（窗口卸载前调用；与文件列表、meta、recent 解耦） */
  function persistReadingSessionSnapshot() {
    const viewportTopDisplayLine =
      deps.readerRef.value?.getViewportTopLine?.() ?? deps.lastProbeLine.value;
    const physicalTopLine = deps.stream.viewportDisplayLineToPhysicalLine(
      viewportTopDisplayLine,
    );
    const physicalBottomLine = deps.stream.viewportDisplayLineToPhysicalLine(
      deps.viewportEndLine.value,
    );
    const restoreOnStartup = deps.restoreSessionOnStartup.value;
    persistSessionSnapshot(window.localStorage, sessionKey, {
      currentFile: restoreOnStartup ? deps.currentFile.value : null,
      viewportTopLine: restoreOnStartup ? physicalTopLine : 1,
      viewportBottomLine: restoreOnStartup ? physicalBottomLine : 1,
    });
  }

  /** 窗口关闭/隐藏前：会话快照 + 文件列表缓存 + 未落盘的 recent / file.meta */
  function persistWindowUnloadState() {
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(skipUnloadPersistenceSessionKey) === "1"
    ) {
      return;
    }
    // 侧栏开关等已排队的设置须同步落盘；nextTick 在关窗路径上可能来不及跑
    if (persistSettingsQueued || persistSettingsPending) {
      persistSettingsQueued = false;
      persistSettingsPending = false;
      flushPersistSettings();
    }
    persistReadingSessionSnapshot();
    persistFileListCache({ force: true });
    flushRecentFilesAndFileMetaToDisk();
  }

  async function initPersistenceBootstrap() {
    try {
      sessionStorage.removeItem(skipUnloadPersistenceSessionKey);
      sessionStorage.removeItem(skipSettingsPersistenceSessionKey);
    } catch {
      // ignore
    }
    const {
      ebookConvertOutputDirKeyPresent,
      bookPackUnpackDirKeyPresent,
      characterPortraitCacheDirKeyPresent,
    } = loadPersistedSettings();
    /**
     * 须在首次 `await` 之前同步加载：设置里的「打开时间」排序会立刻触发侧栏快照；
     * 若等 hydrate 之后再 loadFileMeta，会在空 meta 上拍快照，启动后顺序错乱。
     */
    loadRecentFiles();
    loadFileMeta();
    await hydrateVoiceReadSecretsFromVault();
    await hydrateTranslationSecretsFromVault();
    settingsLoaded.value = true;
    let needDefaultSettingsPersist = false;
    if (!ebookConvertOutputDirKeyPresent) {
      try {
        const ud = await resolveDefaultEbookConvertOutputDir();
        if (ud) deps.ebookConvertOutputDir.value = ud;
      } catch {
        // ignore
      }
      needDefaultSettingsPersist = true;
    }
    if (!bookPackUnpackDirKeyPresent) {
      const unpackDir = resolveDefaultUnpackedBooksDirSync();
      if (unpackDir) {
        deps.bookPackUnpackDir.value = unpackDir;
      }
      needDefaultSettingsPersist = true;
    }
    if (!characterPortraitCacheDirKeyPresent) {
      const portraitDir = resolveDefaultCharacterPortraitCacheDirSync();
      if (portraitDir) {
        deps.characterPortraitCacheDir.value = portraitDir;
      }
      needDefaultSettingsPersist = true;
    }
    if (needDefaultSettingsPersist) {
      persistSettings();
    }
    if (!storageSyncBound) {
      window.addEventListener("storage", onStorageSync);
      storageSyncBound = true;
    }
  }

  return {
    settingsLoaded,
    persistRecentFiles,
    loadRecentFiles,
    applyRecentFilesHistoryLimitFromSettings,
    touchRecentFile,
    removeRecentFile,
    clearRecentFiles,
    loadFileMeta,
    persistFileMeta,
    persistFileMetaImmediate,
    removeFileMetaPaths,
    getFileMeta,
    setEbookConvertedMeta,
    touchFileLastOpened,
    upsertBookmark,
    removeBookmark,
    clearBookmarks,
    loadPersistedSettings,
    persistSettings,
    persistSidebarWidth,
    persistVoiceReadSecretsToVault,
    persistTranslationSecretsToVault,
    persistReadingSessionSnapshot,
    persistWindowUnloadState,
    persistFileListCache,
    metaProgressByPathKey,
    patchMetaProgressForPath,
    liveReadingProgress,
    clearPersistedSession,
    initPersistenceBootstrap,
    loadSessionSnapshot,
    loadTxtFileListSnapshot,
    sessionKey,
    fileListKey,
  };
}
