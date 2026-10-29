import { computed } from "vue";
import {
  defaultChapterMinCharCount,
  maxFontSize,
  maxLineHeightMultipleForFontSize,
  mergeReaderPaletteColorEnabled,
  minFontSize,
  minLineHeightMultiple,
  persistKey,
  resolveEffectiveReaderPalette,
  cloneReaderBackgroundState,
  parseReaderBackgroundState,
  type ReaderSurfaceColorEnabled,
} from "../../constants/appUi";
import {
  parseReaderPaletteSelectedId,
  parseReaderPaletteUserPresets,
  toPersistedReaderPaletteState,
  resolveReaderPaletteBySelectedId,
  type ReaderPalettePreset,
} from "../../constants/readerPalettePresets";
import {
  DEFAULT_HIGHLIGHT_COLORS_DARK,
  DEFAULT_HIGHLIGHT_COLORS_LIGHT,
  mergeHighlightColors,
  parseHighlightColorsArray,
} from "../../constants/highlightColors";
import {
  DEFAULT_LINEATION_COLORS_DARK,
  DEFAULT_LINEATION_COLORS_LIGHT,
  mergeLineationColors,
  parseLineationColorsArray,
} from "../../constants/lineationColors";
import {
  mergeVoiceReadSettings,
  type VoiceReadSettings,
} from "../../constants/voiceRead";
import type { VoiceReadProfile } from "@shared/voiceReadProfiles";
import {
  stripVoiceReadProfileApiKeysForDisk,
  stripVoiceReadSettingsApiKeysForDisk,
} from "@shared/voiceReadProfiles";
import type { HighlightWordsByIndex } from "../../stores/fileMetaStore";
import { normalizeHighlightWordsByIndex } from "../../stores/fileMetaStore";
import { loadPersistedSettingsData } from "../../stores/cacheStore";
import { patchPersistedMainSettings } from "../services/findBookSettingsStore";
import {
  cloneVoiceReadProfiles,
  migrateVoiceReadFromPersisted,
  normalizeVoiceReadProfilesForSave,
} from "../../services/voiceRead/voiceReadProfileState";
import { hydrateVoiceReadProfilesWithSecrets } from "../../services/voiceRead/voiceReadSecretsHydration";
import {
  applyTranslationSecrets,
  mergeTranslationSettings,
  parseTranslationSecretsBlob,
} from "../../constants/translationSettings";
import { ref } from "vue";
import { useFindBookSettings } from "./useFindBookSettings";

function loadMainSettingsData() {
  return loadPersistedSettingsData(localStorage, persistKey)?.data ?? {};
}

let store: ReturnType<typeof createFindBookReaderSettingsStore> | null = null;

function createFindBookReaderSettingsStore() {
  const fb = useFindBookSettings();
  const mainData = loadMainSettingsData();

  const currentTheme = ref<"vs" | "vs-dark">(
    mainData.theme === "vs-dark" ? "vs-dark" : "vs",
  );

  const chapterMinCharCount = ref(
    typeof mainData.chapterMinCharCount === "number"
      ? mainData.chapterMinCharCount
      : defaultChapterMinCharCount,
  );
  const aiFeaturesEnabled = ref(false);

  const readerPaletteColorEnabledOverrides = ref(
    mainData.readerPaletteColorEnabledOverrides
      ? { ...mainData.readerPaletteColorEnabledOverrides }
      : {},
  );
  const readerBackground = ref(
    parseReaderBackgroundState(mainData.readerBackground),
  );
  const readerPaletteUserPresets = ref<ReaderPalettePreset[]>(
    parseReaderPaletteUserPresets(mainData.readerPaletteUserPresets),
  );
  const readerPaletteSelectedIdLight = ref(
    parseReaderPaletteSelectedId(mainData.readerPaletteSelectedIdLight),
  );
  const readerPaletteSelectedIdDark = ref(
    parseReaderPaletteSelectedId(mainData.readerPaletteSelectedIdDark),
  );

  const readerSurfaceLight = computed(() =>
    resolveReaderPaletteBySelectedId(
      readerPaletteSelectedIdLight.value,
      "light",
      readerPaletteUserPresets.value,
    ),
  );
  const readerSurfaceDark = computed(() =>
    resolveReaderPaletteBySelectedId(
      readerPaletteSelectedIdDark.value,
      "dark",
      readerPaletteUserPresets.value,
    ),
  );
  const readerPaletteColorEnabled = computed(() =>
    mergeReaderPaletteColorEnabled(
      readerPaletteColorEnabledOverrides.value,
    ),
  );
  const effectiveReaderSurfaceLight = computed(() =>
    resolveEffectiveReaderPalette(
      readerSurfaceLight.value,
      readerPaletteColorEnabled.value,
    ),
  );
  const effectiveReaderSurfaceDark = computed(() =>
    resolveEffectiveReaderPalette(
      readerSurfaceDark.value,
      readerPaletteColorEnabled.value,
    ),
  );

  const highlightColorsLight = ref(
    mergeHighlightColors(
      DEFAULT_HIGHLIGHT_COLORS_LIGHT,
      parseHighlightColorsArray(mainData.highlightColorsLight),
    ),
  );
  const highlightColorsDark = ref(
    mergeHighlightColors(
      DEFAULT_HIGHLIGHT_COLORS_DARK,
      parseHighlightColorsArray(mainData.highlightColorsDark),
    ),
  );
  const lineationColorsLight = ref(
    mergeLineationColors(
      DEFAULT_LINEATION_COLORS_LIGHT,
      parseLineationColorsArray(mainData.lineationColorsLight),
    ),
  );
  const lineationColorsDark = ref(
    mergeLineationColors(
      DEFAULT_LINEATION_COLORS_DARK,
      parseLineationColorsArray(mainData.lineationColorsDark),
    ),
  );
  const highlightWordsByIndexGlobal = ref<HighlightWordsByIndex | undefined>(
    normalizeHighlightWordsByIndex(mainData.highlightWordsByIndexGlobal),
  );

  const voiceReadProfiles = ref<VoiceReadProfile[]>([]);
  const activeVoiceReadProfileId = ref("");
  const voiceReadSettings = ref<VoiceReadSettings>(
    mergeVoiceReadSettings(undefined),
  );
  let voiceReadProfileBaselineIds = new Set<string>();
  /** 语音落盘基线：未改则保留磁盘；磁盘合并结果不灌回本窗内存 */
  const voiceReadPersistBaseline: Record<string, unknown> = {};

  function setVoiceReadProfileBaseline(profiles: readonly VoiceReadProfile[]) {
    voiceReadProfileBaselineIds = new Set(
      profiles.map((p) => p.id).filter(Boolean),
    );
  }

  function setVoiceReadPersistBaseline(payload: Record<string, unknown>) {
    Object.keys(voiceReadPersistBaseline).forEach((k) => {
      delete voiceReadPersistBaseline[k];
    });
    Object.assign(
      voiceReadPersistBaseline,
      JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
    );
  }

  async function applyVoiceReadFromPersisted(
    raw: Parameters<typeof migrateVoiceReadFromPersisted>[0],
  ) {
    const bundle = migrateVoiceReadFromPersisted(raw);
    voiceReadProfiles.value = cloneVoiceReadProfiles(bundle.profiles);
    activeVoiceReadProfileId.value = bundle.activeProfileId;
    const hydrated = await hydrateVoiceReadProfilesWithSecrets(
      voiceReadProfiles.value,
      activeVoiceReadProfileId.value,
    );
    voiceReadSettings.value = mergeVoiceReadSettings(
      hydrated ?? bundle.activeSettings,
    );
    setVoiceReadProfileBaseline(voiceReadProfiles.value);
    const profilesForDisk = stripVoiceReadProfileApiKeysForDisk(
      normalizeVoiceReadProfilesForSave(voiceReadProfiles.value),
    );
    const voiceReadMerged = stripVoiceReadSettingsApiKeysForDisk(
      mergeVoiceReadSettings(voiceReadSettings.value),
    );
    const rawObj =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    setVoiceReadPersistBaseline({
      activeProfileId: activeVoiceReadProfileId.value,
      profiles: profilesForDisk,
      ...voiceReadMerged,
      aiSpeakerTokenUsage: rawObj.aiSpeakerTokenUsage,
      aiSpeakerTokenUsageAvailable: rawObj.aiSpeakerTokenUsageAvailable,
    });
  }

  void applyVoiceReadFromPersisted(
    mainData.voiceRead as Parameters<typeof migrateVoiceReadFromPersisted>[0],
  );

  void (async () => {
    try {
      const res = await window.colorTxt.secrets.getTranslationProviderKeys();
      const secrets = parseTranslationSecretsBlob(res.keys ?? "");
      fb.translationSettings.value = applyTranslationSecrets(
        mergeTranslationSettings(fb.translationSettings.value),
        secrets,
      );
    } catch {
      /* ignore */
    }
  })();

  const highlightColorsForReader = computed(() =>
    currentTheme.value === "vs"
      ? highlightColorsLight.value
      : highlightColorsDark.value,
  );
  const readerPaletteColorEnabledForReader = computed(
    () => readerPaletteColorEnabled.value,
  );

  const canIncreaseFont = computed(() => fb.readerFontSize.value < maxFontSize);
  const canDecreaseFont = computed(() => fb.readerFontSize.value > minFontSize);
  const canIncreaseLineHeight = computed(
    () =>
      fb.readerLineHeightMultiple.value <
      maxLineHeightMultipleForFontSize(fb.readerFontSize.value) - 1e-6,
  );
  const canDecreaseLineHeight = computed(
    () => fb.readerLineHeightMultiple.value > minLineHeightMultiple + 1e-6,
  );

  function syncThemeFromMain() {
    const data = loadMainSettingsData();
    currentTheme.value = data.theme === "vs-dark" ? "vs-dark" : "vs";
  }

  function syncPaletteFromMain() {
    const data = loadMainSettingsData();
    readerPaletteColorEnabledOverrides.value =
      data.readerPaletteColorEnabledOverrides
        ? { ...data.readerPaletteColorEnabledOverrides }
        : {};
    readerBackground.value = parseReaderBackgroundState(data.readerBackground);
    readerPaletteUserPresets.value = parseReaderPaletteUserPresets(
      data.readerPaletteUserPresets,
    );
    readerPaletteSelectedIdLight.value = parseReaderPaletteSelectedId(
      data.readerPaletteSelectedIdLight,
    );
    readerPaletteSelectedIdDark.value = parseReaderPaletteSelectedId(
      data.readerPaletteSelectedIdDark,
    );
    highlightColorsLight.value = mergeHighlightColors(
      DEFAULT_HIGHLIGHT_COLORS_LIGHT,
      parseHighlightColorsArray(data.highlightColorsLight),
    );
    highlightColorsDark.value = mergeHighlightColors(
      DEFAULT_HIGHLIGHT_COLORS_DARK,
      parseHighlightColorsArray(data.highlightColorsDark),
    );
    lineationColorsLight.value = mergeLineationColors(
      DEFAULT_LINEATION_COLORS_LIGHT,
      parseLineationColorsArray(data.lineationColorsLight),
    );
    lineationColorsDark.value = mergeLineationColors(
      DEFAULT_LINEATION_COLORS_DARK,
      parseLineationColorsArray(data.lineationColorsDark),
    );
    highlightWordsByIndexGlobal.value = normalizeHighlightWordsByIndex(
      data.highlightWordsByIndexGlobal,
    );
    if (
      typeof data.chapterMinCharCount === "number" &&
      Number.isFinite(data.chapterMinCharCount)
    ) {
      chapterMinCharCount.value = data.chapterMinCharCount;
    }
  }

  function syncVoiceReadFromMain() {
    void applyVoiceReadFromPersisted(
      loadMainSettingsData().voiceRead as Parameters<
        typeof migrateVoiceReadFromPersisted
      >[0],
    );
  }

  function syncSharedSettingsFromMain() {
    syncThemeFromMain();
    syncPaletteFromMain();
    // 阅读/编辑/语音与主窗口一样：各窗内存独立，仅启动时从 LS 加载
  }

  function applyReaderPalettes(payload: {
    colorEnabled: ReaderSurfaceColorEnabled;
    userPresets: ReaderPalettePreset[];
    selectedIdLight: string;
    selectedIdDark: string;
    background?: import("../../constants/readerBackground").ReaderBackgroundState;
  }) {
    const persisted = toPersistedReaderPaletteState(payload);
    readerPaletteColorEnabledOverrides.value =
      persisted.readerPaletteColorEnabledOverrides;
    readerPaletteUserPresets.value = persisted.readerPaletteUserPresets;
    readerPaletteSelectedIdLight.value = persisted.readerPaletteSelectedIdLight;
    readerPaletteSelectedIdDark.value = persisted.readerPaletteSelectedIdDark;
    const patch: Record<string, unknown> = {
      readerPaletteColorEnabledOverrides:
        persisted.readerPaletteColorEnabledOverrides,
      readerPaletteUserPresets: persisted.readerPaletteUserPresets,
      readerPaletteSelectedIdLight: persisted.readerPaletteSelectedIdLight,
      readerPaletteSelectedIdDark: persisted.readerPaletteSelectedIdDark,
    };
    if (payload.background) {
      readerBackground.value = cloneReaderBackgroundState(payload.background);
      patch.readerBackground = payload.background;
    }
    patchPersistedMainSettings(patch);
  }

  return {
    currentTheme,
    sidebarWidth: fb.sidebarWidth,
    readerFontSize: fb.readerFontSize,
    readerLineHeightMultiple: fb.readerLineHeightMultiple,
    readerLineSpacingPx: fb.readerLineSpacingPx,
    readerLetterSpacingPx: fb.readerLetterSpacingPx,
    readerHorizontalInsetPx: fb.readerHorizontalInsetPx,
    monacoFontFamily: fb.monacoFontFamily,
    pinnedOtherFonts: fb.pinnedOtherFonts,
    monacoCustomHighlight: fb.monacoCustomHighlight,
    txtrDelimitedMatchCrossLine: fb.txtrDelimitedMatchCrossLine,
    compressBlankLines: fb.compressBlankLines,
    compressBlankKeepOneBlank: fb.compressBlankKeepOneBlank,
    chapterTitleBlankMode: fb.chapterTitleBlankMode,
    leadIndentFullWidth: fb.leadIndentFullWidth,
    textConvertZh: fb.textConvertZh,
    textConvertLetter: fb.textConvertLetter,
    textConvertDigit: fb.textConvertDigit,
    monacoAdvancedWrapping: fb.monacoAdvancedWrapping,
    monacoCjkWrapOptimize: fb.monacoCjkWrapOptimize,
    monacoSmoothScrolling: fb.monacoSmoothScrolling,
    scrollbarTrackBehavior: fb.scrollbarTrackBehavior,
    mouseWheelScrollSensitivity: fb.mouseWheelScrollSensitivity,
    fastScrollSensitivity: fb.fastScrollSensitivity,
    stickyChapterTitleEnabled: fb.stickyChapterTitleEnabled,
    readerClickMode: fb.readerClickMode,
    readingRulerEnabled: fb.readingRulerEnabled,
    readingRulerFocusLines: fb.readingRulerFocusLines,
    readingRulerDimOpacity: fb.readingRulerDimOpacity,
    readingRulerDimStickyTitle: fb.readingRulerDimStickyTitle,
    readingRulerTransitionEnabled: fb.readingRulerTransitionEnabled,
    markdownImageHeightPx: fb.markdownImageHeightPx,
    chapterNavToolbarEnabled: fb.chapterNavToolbarEnabled,
    findBookChapterAdvanceEnabled: fb.findBookChapterAdvanceEnabled,
    selectionToolbarButtons: fb.selectionToolbarButtons,
    dictionarySettings: fb.dictionarySettings,
    webSearchSettings: fb.webSearchSettings,
    translationSettings: fb.translationSettings,
    readerEditShowLineNumbers: fb.readerEditShowLineNumbers,
    readerEditMinimap: fb.readerEditMinimap,
    fullscreenReaderWidthPercent: fb.fullscreenReaderWidthPercent,
    fullscreenShowSystemTime: fb.fullscreenShowSystemTime,
    chapterMinCharCount,
    timedScrollSettings: fb.timedScrollSettings,
    aiFeaturesEnabled,
    readerSurfaceLight,
    readerSurfaceDark,
    readerPaletteColorEnabled,
    readerPaletteUserPresets,
    readerPaletteSelectedIdLight,
    readerPaletteSelectedIdDark,
    readerBackground,
    effectiveReaderSurfaceLight,
    effectiveReaderSurfaceDark,
    highlightColorsForReader,
    lineationColorsLight,
    lineationColorsDark,
    readerPaletteColorEnabledForReader,
    highlightWordsByIndexGlobal,
    voiceReadProfiles,
    activeVoiceReadProfileId,
    voiceReadSettings,
    getVoiceReadProfileBaselineIds: () => voiceReadProfileBaselineIds,
    setVoiceReadProfileBaseline,
    voiceReadPersistBaseline,
    setVoiceReadPersistBaseline,
    canIncreaseFont,
    canDecreaseFont,
    canIncreaseLineHeight,
    canDecreaseLineHeight,
    persistReaderUiPrefs: fb.persistReaderUiPrefs,
    applyReaderPalettes,
    syncThemeFromMain,
    syncPaletteFromMain,
    syncVoiceReadFromMain,
    syncSharedSettingsFromMain,
  };
}

export function useFindBookReaderSettings() {
  if (!store) store = createFindBookReaderSettingsStore();
  return store;
}

export function resetFindBookReaderSettingsStoreForTests() {
  store = null;
}
