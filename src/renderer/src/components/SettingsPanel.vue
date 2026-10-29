<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, useTemplateRef, watch } from "vue";
import {
  applyAllActiveProfilesToConfig,
} from "@shared/aiEndpointProfiles";
import type { AIConfig } from "@shared/aiTypes";
import {
  defaultAIConfig,
  normalizeEmbeddingEndpoint,
} from "@shared/aiTypes";
import type { AiCustomSkill, AiSkillUserOverride } from "@shared/aiSkills";
import {
  defaultAiSmartFormatSettings,
  mergeAiSmartFormatSettings,
  type AiSmartFormatSettings,
} from "@shared/aiSmartFormatTypes";
import {
  mergeAiCustomSkills,
  mergeAiSkillOverrides,
  mergeAiSkillsEnabled,
} from "@shared/aiSkills";
import AppModal from "./AppModal.vue";
import SettingsTabBar, { type SettingsTabId } from "./SettingsTabBar.vue";
import SettingsGeneralPanel from "./SettingsGeneralPanel.vue";
import SettingsReadingPanel from "./SettingsReadingPanel.vue";
import SettingsEditPanel from "./SettingsEditPanel.vue";
import SettingsAIPanel from "./SettingsAIPanel.vue";
import SettingsVectorModelPanel from "./SettingsVectorModelPanel.vue";
import SettingsTxt2ImgPanel from "./SettingsTxt2ImgPanel.vue";
import SettingsSkillsPanel from "./SettingsSkillsPanel.vue";
import SettingsVoiceReadPanel from "./SettingsVoiceReadPanel.vue";
import SettingsWebDavPanel from "./SettingsWebDavPanel.vue";
import FindBookSettingsProxyPanel from "../bookSource/components/FindBookSettingsProxyPanel.vue";
import {
  DEFAULT_FIND_BOOK_PROXY_SETTINGS,
  findBookProxyChangedEvent,
  findBookSettingsKey,
  type FindBookProxyType,
} from "../bookSource/constants/findBookSettings";
import {
  loadFindBookProxySettings,
  saveFindBookProxySettingsAndSync,
} from "../bookSource/services/findBookSettingsStore";
import {
  clampLineHeightMultipleForFontSize,
  defaultChapterMinCharCount,
  defaultCompressBlankKeepOneBlank,
  defaultChapterTitleBlankMode,
  defaultFullscreenReaderWidthPercent,
  defaultFullscreenShowSystemTime,
  defaultMonacoCjkWrapOptimize,
  defaultMonacoSmoothScrolling,
  defaultScrollbarTrackBehavior,
  defaultMouseWheelScrollSensitivity,
  defaultFastScrollSensitivity,
  clampMouseWheelScrollSensitivity,
  clampFastScrollSensitivity,
  defaultStickyChapterTitleEnabled,
  defaultReadingRulerEnabled,
  defaultReadingRulerFocusLines,
  defaultReadingRulerDimOpacity,
  defaultReadingRulerDimStickyTitle,
  defaultReadingRulerTransitionEnabled,
  clampReadingRulerFocusLines,
  clampReadingRulerDimOpacity,
  defaultMarkdownImageHeightPx,
  clampMarkdownImageHeightPx,
  defaultChapterNavToolbarEnabled,
  defaultChapterCharCountExact,
  defaultReaderEditShowLineNumbers,
  defaultReaderEditMinimap,
  defaultEditAutoRefreshChapterList,
  defaultReaderFontSize,
  defaultReaderLineHeightMultiple,
  defaultLineSpacingPx,
  clampLineSpacingPx,
  defaultLetterSpacingPx,
  clampLetterSpacingPx,
  defaultReaderHorizontalInsetPx,
  clampReaderHorizontalInsetPx,
  defaultRecentFilesHistoryLimit,
  defaultRestoreSessionOnStartup,
  defaultSyncCurrentFile,
  defaultTxtrDelimitedMatchCrossLine,
  maxLineHeightMultipleForFontSize,
  persistKey,
  fontPickerDistinguishWeightsKey,
  fontPickerListModeResetEvent,
  systemFontFacePinsKey,
  skipUnloadPersistenceSessionKey,
  APP_DISPLAY_NAME,
  type ChapterTitleBlankMode,
} from "../constants/appUi";
import {
  defaultTimedScrollIntervalMs,
  defaultTimedScrollRange,
  mergeTimedScrollSettings,
  type TimedScrollSettings,
} from "../constants/timedScroll";
import {
  defaultPomodoroFocusMinutes,
  defaultPomodoroLongBreakMinutes,
  defaultPomodoroShortBreakMinutes,
  defaultPomodoroEnabled,
  mergePomodoroSettings,
  type PomodoroSettings,
} from "../constants/pomodoro";
import {
  defaultSelectionToolbarButtons,
  mergeSelectionToolbarButtons,
  type SelectionToolbarButtons,
} from "../constants/selectionToolbar";
import { appAlert } from "../services/appDialog";
import { READER_EDITOR_DEFAULT_FONT_FAMILY } from "../monaco/readerEditorOptions";
import { getBuiltinEmbeddingBlockMessage } from "../ai/embeddingReady";
import { icons } from "../icons";
import {
  resolveDefaultBuiltinModelCacheDirSync,
  resolveDefaultCharacterPortraitCacheDirSync,
  resolveDefaultEbookConvertOutputDirSync,
  resolveDefaultUnpackedBooksDirSync,
  resolveEffectiveAiDataCacheDir,
  resolveEffectiveBuiltinModelCacheDir,
} from "../utils/defaultCacheDirs";
import type { VoiceReadSettings } from "../constants/voiceRead";
import type { CharacterRosterEntry } from "@shared/characterTypes";
import {
  mergeVoiceReadSettings,
  voiceReadDashScopeRequiresApiKey,
} from "../constants/voiceRead";
import type { VoiceReadProfile } from "@shared/voiceReadProfiles";
import { migrateVoiceReadFromPersisted, cloneVoiceReadProfiles } from "../services/voiceRead/voiceReadProfileState";

type SettingsVoiceReadPanelExpose = {
  cancelPreview?: () => void;
  finalizeVoiceReadProfiles?: () => void;
  initVoiceReadProfiles?: () => void;
  resetCurrentVoiceReadProfile?: () => void;
};

type SettingsAIPanelExpose = {
  finalizeChatProfiles?: () => void;
  initChatProfiles?: () => void;
  resetCurrentChatProfile?: () => void;
  resetAiPageDraft?: () => void;
};

type SettingsTxt2ImgPanelExpose = {
  finalizeTxt2ImgProfiles?: () => void;
  initTxt2ImgProfiles?: () => void;
  resetCurrentTxt2ImgProfile?: () => void;
};

export type SettingsApplyPayload = {
  restoreSessionOnStartup: boolean;
  syncCurrentFile: boolean;
  recentFilesHistoryLimit: number;
  chapterMinCharCount: number;
  fullscreenReaderWidthPercent: number;
  fullscreenShowSystemTime: boolean;
  monacoSmoothScrolling: boolean;
  scrollbarTrackBehavior: import("../constants/appUi").ScrollbarTrackBehavior;
  monacoCjkWrapOptimize: boolean;
  mouseWheelScrollSensitivity: number;
  fastScrollSensitivity: number;
  stickyChapterTitleEnabled: boolean;
  readingRulerEnabled: boolean;
  readingRulerFocusLines: number;
  readingRulerDimOpacity: number;
  readingRulerDimStickyTitle: boolean;
  readingRulerTransitionEnabled: boolean;
  markdownImageHeightPx: number;
  chapterNavToolbarEnabled: boolean;
  chapterCharCountExact: boolean;
  readerEditShowLineNumbers: boolean;
  readerEditMinimap: boolean;
  editAutoRefreshChapterList: boolean;
  aiSmartFormat: AiSmartFormatSettings;
  fontSize: number;
  fontFamily: string;
  lineHeightMultiple: number;
  lineSpacingPx: number;
  letterSpacingPx: number;
  readerHorizontalInsetPx: number;
  chapterTitleBlankMode: ChapterTitleBlankMode;
  compressBlankKeepOneBlank: boolean;
  txtrDelimitedMatchCrossLine: boolean;
  timedScroll: TimedScrollSettings;
  pomodoro: PomodoroSettings;
  selectionToolbarButtons: SelectionToolbarButtons;
  ebookConvertOutputDir: string;
  bookPackUnpackDir: string;
  bookPackPassword: string;
  webDavEnabled: boolean;
  webDavUrl: string;
  webDavUsername: string;
  webDavRemoteDir: string;
  characterPortraitCacheDir: string;
  aiSkillsEnabled: Record<string, boolean>;
  aiSkillOverrides: Record<string, AiSkillUserOverride>;
  aiCustomSkills: AiCustomSkill[];
  voiceRead: VoiceReadSettings;
  voiceReadProfiles: VoiceReadProfile[];
  activeVoiceReadProfileId: string;
};

const modelValue = defineModel<boolean>({ default: false });

const props = defineProps<{
  restoreSessionOnStartup: boolean;
  syncCurrentFile: boolean;
  recentFilesHistoryLimit: number;
  chapterMinCharCount: number;
  fullscreenReaderWidthPercent: number;
  fullscreenShowSystemTime: boolean;
  readerFontSize: number;
  monacoFontFamily: string;
  pinnedOtherFonts: string[];
  readerLineHeightMultiple: number;
  readerLineSpacingPx: number;
  readerLetterSpacingPx: number;
  readerHorizontalInsetPx: number;
  monacoSmoothScrolling: boolean;
  scrollbarTrackBehavior: import("../constants/appUi").ScrollbarTrackBehavior;
  monacoCjkWrapOptimize: boolean;
  mouseWheelScrollSensitivity: number;
  fastScrollSensitivity: number;
  stickyChapterTitleEnabled: boolean;
  readingRulerEnabled: boolean;
  readingRulerFocusLines: number;
  readingRulerDimOpacity: number;
  readingRulerDimStickyTitle: boolean;
  readingRulerTransitionEnabled: boolean;
  markdownImageHeightPx: number;
  chapterNavToolbarEnabled: boolean;
  chapterCharCountExact: boolean;
  readerEditShowLineNumbers: boolean;
  readerEditMinimap: boolean;
  editAutoRefreshChapterList: boolean;
  aiSmartFormat: AiSmartFormatSettings;
  chapterTitleBlankMode: ChapterTitleBlankMode;
  compressBlankKeepOneBlank: boolean;
  monacoCustomHighlight: boolean;
  txtrDelimitedMatchCrossLine: boolean;
  timedScrollSettings: TimedScrollSettings;
  pomodoroSettings: PomodoroSettings;
  selectionToolbarButtons: SelectionToolbarButtons;
  ebookConvertOutputDir: string;
  bookPackUnpackDir: string;
  bookPackPassword: string;
  webDavEnabled: boolean;
  webDavUrl: string;
  webDavUsername: string;
  webDavRemoteDir: string;
  characterPortraitCacheDir: string;
  aiSkillsEnabled: Record<string, boolean>;
  aiSkillOverrides: Record<string, AiSkillUserOverride>;
  aiCustomSkills: AiCustomSkill[];
  voiceReadSettings: VoiceReadSettings;
  voiceReadProfiles: VoiceReadProfile[];
  activeVoiceReadProfileId: string;
  characterRoster: CharacterRosterEntry[];
}>();

const emit = defineEmits<{
  apply: [payload: SettingsApplyPayload];
  togglePinOtherFont: [fontName: string];
  openReadingData: [];
  openDictionaryManage: [];
  openWebSearchManage: [];
  openTranslateManage: [];
  openSpeakSettings: [];
}>();

const activeTab = ref<SettingsTabId>("general");
const settingsTabScrollerEl = useTemplateRef<HTMLElement>(
  "settingsTabScrollerEl",
);

type SettingsSkillsPanelExpose = { openCreateSkill: () => void };
const skillsPanelRef =
  useTemplateRef<SettingsSkillsPanelExpose>("skillsPanelRef");
const aiPanelRef = useTemplateRef<SettingsAIPanelExpose>("aiPanelRef");
const txt2imgPanelRef =
  useTemplateRef<SettingsTxt2ImgPanelExpose>("txt2imgPanelRef");
const voiceReadPanelRef =
  useTemplateRef<SettingsVoiceReadPanelExpose>("voiceReadPanelRef");

function onAddSkillClick() {
  skillsPanelRef.value?.openCreateSkill();
}

const draftRestore = ref(true);
const draftSyncCurrentFile = ref(false);
const draftRecentLimit = ref(20);
const draftChapterMinCharCount = ref(defaultChapterMinCharCount);
const draftFullscreenReaderWidthPercent = ref(50);
const draftFullscreenShowSystemTime = ref(defaultFullscreenShowSystemTime);
const draftFontSize = ref(14);
const draftFontFamily = ref(READER_EDITOR_DEFAULT_FONT_FAMILY);
const draftLineHeightMultiple = ref(1.5);
const draftLineSpacingPx = ref(defaultLineSpacingPx);
const draftLetterSpacingPx = ref(defaultLetterSpacingPx);
const draftReaderHorizontalInsetPx = ref(defaultReaderHorizontalInsetPx);
const draftMonacoSmoothScrolling = ref(true);
const draftScrollbarTrackBehavior = ref(defaultScrollbarTrackBehavior);
const draftMonacoCjkWrapOptimize = ref(defaultMonacoCjkWrapOptimize);
const draftMouseWheelScrollSensitivity = ref(
  defaultMouseWheelScrollSensitivity,
);
const draftFastScrollSensitivity = ref(defaultFastScrollSensitivity);
const draftStickyChapterTitleEnabled = ref(defaultStickyChapterTitleEnabled);
const draftReadingRulerEnabled = ref(defaultReadingRulerEnabled);
const draftReadingRulerFocusLines = ref(defaultReadingRulerFocusLines);
const draftReadingRulerDimOpacity = ref(defaultReadingRulerDimOpacity);
const draftReadingRulerDimStickyTitle = ref(defaultReadingRulerDimStickyTitle);
const draftReadingRulerTransitionEnabled = ref(
  defaultReadingRulerTransitionEnabled,
);
const draftMarkdownImageHeightPx = ref(defaultMarkdownImageHeightPx);
const draftChapterNavToolbarEnabled = ref(defaultChapterNavToolbarEnabled);
const draftChapterCharCountExact = ref(defaultChapterCharCountExact);
const draftReaderEditShowLineNumbers = ref(defaultReaderEditShowLineNumbers);
const draftReaderEditMinimap = ref(defaultReaderEditMinimap);
const draftEditAutoRefreshChapterList = ref(defaultEditAutoRefreshChapterList);
const draftAiSmartFormat = ref<AiSmartFormatSettings>({
  ...defaultAiSmartFormatSettings,
});
const draftChapterTitleBlankMode = ref(
  defaultChapterTitleBlankMode,
);
const draftCompressBlankKeepOneBlank = ref(false);
const draftTxtrDelimitedMatchCrossLine = ref(
  defaultTxtrDelimitedMatchCrossLine,
);
const draftTimedScrollRange = ref(defaultTimedScrollRange);
const draftTimedScrollIntervalMs = ref(defaultTimedScrollIntervalMs);
const draftPomodoroEnabled = ref(defaultPomodoroEnabled);
const draftPomodoroFocusMinutes = ref(defaultPomodoroFocusMinutes);
const draftPomodoroShortBreakMinutes = ref(defaultPomodoroShortBreakMinutes);
const draftPomodoroLongBreakMinutes = ref(defaultPomodoroLongBreakMinutes);
const draftSelectionToolbarButtons = ref<SelectionToolbarButtons>(
  mergeSelectionToolbarButtons(undefined),
);
const draftEbookConvertOutputDir = ref("");
const draftBookPackUnpackDir = ref("");
const draftBookPackPassword = ref("");
const draftWebDavEnabled = ref(false);
const draftWebDavUrl = ref("");
const draftWebDavUsername = ref("");
const draftWebDavPassword = ref("");
const draftWebDavRemoteDir = ref("ColorTxt");
const draftCharacterPortraitCacheDir = ref("");
const showBookPackPassword = ref(false);
const draftProxyEnabled = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.enabled);
const draftProxyType = ref<FindBookProxyType>(DEFAULT_FIND_BOOK_PROXY_SETTINGS.type);
const draftProxyHost = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.host);
const draftProxyPort = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.port);
const draftProxyUsername = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.username);
const draftProxyPassword = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.password);

const draftAi = ref<AIConfig>(structuredClone(defaultAIConfig));
const showAiExtensionTabs = computed(() => draftAi.value.aiEnabled);
const loadedAiDimension = ref(1536);
const loadedAiDataCacheDir = ref("");
const loadedBuiltinModelCacheDir = ref("");
const draftAiSkillsEnabled = ref<Record<string, boolean>>(
  mergeAiSkillsEnabled(undefined, []),
);
const draftAiSkillOverrides = ref<Record<string, AiSkillUserOverride>>(
  mergeAiSkillOverrides(undefined),
);
const draftAiCustomSkills = ref<AiCustomSkill[]>([]);

const draftVoiceRead = ref<VoiceReadSettings>(
  mergeVoiceReadSettings(undefined),
);
const draftVoiceReadProfiles = ref<VoiceReadProfile[]>(
  migrateVoiceReadFromPersisted(undefined).profiles,
);
const draftActiveVoiceReadProfileId = ref(
  migrateVoiceReadFromPersisted(undefined).activeProfileId,
);

function syncDraftFromProps() {
  draftRestore.value = props.restoreSessionOnStartup;
  draftSyncCurrentFile.value = props.syncCurrentFile;
  draftRecentLimit.value = props.recentFilesHistoryLimit;
  draftChapterMinCharCount.value = props.chapterMinCharCount;
  draftFullscreenReaderWidthPercent.value = props.fullscreenReaderWidthPercent;
  draftFullscreenShowSystemTime.value = props.fullscreenShowSystemTime;
  draftFontSize.value = props.readerFontSize;
  draftFontFamily.value = props.monacoFontFamily;
  draftLineHeightMultiple.value = clampLineHeightMultipleForFontSize(
    props.readerFontSize,
    props.readerLineHeightMultiple,
  );
  draftLineSpacingPx.value = clampLineSpacingPx(props.readerLineSpacingPx);
  draftLetterSpacingPx.value = clampLetterSpacingPx(props.readerLetterSpacingPx);
  draftReaderHorizontalInsetPx.value = clampReaderHorizontalInsetPx(
    props.readerHorizontalInsetPx,
  );
  draftMonacoSmoothScrolling.value = props.monacoSmoothScrolling;
  draftScrollbarTrackBehavior.value = props.scrollbarTrackBehavior;
  draftMonacoCjkWrapOptimize.value = props.monacoCjkWrapOptimize;
  draftMouseWheelScrollSensitivity.value = clampMouseWheelScrollSensitivity(
    props.mouseWheelScrollSensitivity,
  );
  draftFastScrollSensitivity.value = clampFastScrollSensitivity(
    props.fastScrollSensitivity,
  );
  draftStickyChapterTitleEnabled.value = props.stickyChapterTitleEnabled;
  draftReadingRulerEnabled.value = props.readingRulerEnabled;
  draftReadingRulerFocusLines.value = clampReadingRulerFocusLines(
    props.readingRulerFocusLines,
  );
  draftReadingRulerDimOpacity.value = clampReadingRulerDimOpacity(
    props.readingRulerDimOpacity,
  );
  draftReadingRulerDimStickyTitle.value = props.readingRulerDimStickyTitle;
  draftReadingRulerTransitionEnabled.value =
    props.readingRulerTransitionEnabled;
  draftMarkdownImageHeightPx.value = clampMarkdownImageHeightPx(
    props.markdownImageHeightPx,
  );
  draftChapterNavToolbarEnabled.value = props.chapterNavToolbarEnabled;
  draftChapterCharCountExact.value = props.chapterCharCountExact;
  draftReaderEditShowLineNumbers.value = props.readerEditShowLineNumbers;
  draftReaderEditMinimap.value = props.readerEditMinimap;
  draftEditAutoRefreshChapterList.value = props.editAutoRefreshChapterList;
  draftAiSmartFormat.value = mergeAiSmartFormatSettings(props.aiSmartFormat);
  draftChapterTitleBlankMode.value =
    props.chapterTitleBlankMode;
  draftCompressBlankKeepOneBlank.value = props.compressBlankKeepOneBlank;
  draftTxtrDelimitedMatchCrossLine.value = props.txtrDelimitedMatchCrossLine;
  const timedScrollMerged = mergeTimedScrollSettings(props.timedScrollSettings);
  draftTimedScrollRange.value = timedScrollMerged.range;
  draftTimedScrollIntervalMs.value = timedScrollMerged.intervalMs;
  const pomodoroMerged = mergePomodoroSettings(props.pomodoroSettings);
  draftPomodoroEnabled.value = pomodoroMerged.enabled;
  draftPomodoroFocusMinutes.value = pomodoroMerged.focusMinutes;
  draftPomodoroShortBreakMinutes.value = pomodoroMerged.shortBreakMinutes;
  draftPomodoroLongBreakMinutes.value = pomodoroMerged.longBreakMinutes;
  draftSelectionToolbarButtons.value = mergeSelectionToolbarButtons(
    props.selectionToolbarButtons,
  );
  draftEbookConvertOutputDir.value = props.ebookConvertOutputDir;
  draftBookPackUnpackDir.value = props.bookPackUnpackDir;
  draftBookPackPassword.value = props.bookPackPassword;
  draftWebDavEnabled.value = props.webDavEnabled === true;
  draftWebDavUrl.value = props.webDavUrl;
  draftWebDavUsername.value = props.webDavUsername;
  draftWebDavRemoteDir.value = props.webDavRemoteDir.trim() || "ColorTxt";
  draftCharacterPortraitCacheDir.value = props.characterPortraitCacheDir;
  draftAiSkillOverrides.value = mergeAiSkillOverrides(props.aiSkillOverrides);
  draftAiCustomSkills.value = mergeAiCustomSkills(props.aiCustomSkills ?? []);
  draftAiSkillsEnabled.value = mergeAiSkillsEnabled(
    props.aiSkillsEnabled,
    draftAiCustomSkills.value.map((s) => s.id),
  );
  draftVoiceRead.value = mergeVoiceReadSettings(props.voiceReadSettings);
  draftVoiceReadProfiles.value = cloneVoiceReadProfiles(props.voiceReadProfiles);
  draftActiveVoiceReadProfileId.value = props.activeVoiceReadProfileId;
  syncProxyDraftFromDisk();
}

function syncProxyDraftFromDisk() {
  const proxy = loadFindBookProxySettings();
  draftProxyEnabled.value = proxy.enabled;
  draftProxyType.value = proxy.type;
  draftProxyHost.value = proxy.host;
  draftProxyPort.value = proxy.port;
  draftProxyUsername.value = proxy.username;
  draftProxyPassword.value = proxy.password;
}

function resetProxyDraft() {
  draftProxyEnabled.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.enabled;
  draftProxyType.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.type;
  draftProxyHost.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.host;
  draftProxyPort.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.port;
  draftProxyUsername.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.username;
  draftProxyPassword.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.password;
}

async function syncAiFromMain() {
  try {
    const c = await window.colorTxt.ai.configGet();
    draftAi.value = structuredClone(c);
    draftAi.value.embedding = normalizeEmbeddingEndpoint(draftAi.value.embedding);
    applyAllActiveProfilesToConfig(draftAi.value);
    loadedAiDimension.value = c.embedding.dimension;
    loadedAiDataCacheDir.value = await resolveEffectiveAiDataCacheDir(
      c.aiDataCacheDir,
    );
    loadedBuiltinModelCacheDir.value =
      await resolveEffectiveBuiltinModelCacheDir(
        c.embedding.builtinModelCacheDir,
      );
  } catch {
    draftAi.value = structuredClone(defaultAIConfig);
    loadedAiDimension.value = defaultAIConfig.embedding.dimension;
    loadedAiDataCacheDir.value = await resolveEffectiveAiDataCacheDir("");
    loadedBuiltinModelCacheDir.value =
      await resolveEffectiveBuiltinModelCacheDir("");
  }
  await nextTick();
  aiPanelRef.value?.initChatProfiles?.();
  txt2imgPanelRef.value?.initTxt2ImgProfiles?.();
}

async function loadWebDavPasswordDraft() {
  try {
    const r = await window.colorTxt.secrets.getWebDavPassword();
    draftWebDavPassword.value = r.password ?? "";
  } catch {
    draftWebDavPassword.value = "";
  }
}

watch(modelValue, (open) => {
  if (!open) {
    voiceReadPanelRef.value?.cancelPreview?.();
    // 保留 activeTab：同窗口再次打开设置时回到上次标签（不持久化）
    return;
  }
  draftAi.value.embedding = normalizeEmbeddingEndpoint(draftAi.value.embedding);
  applyAllActiveProfilesToConfig(draftAi.value);
  syncDraftFromProps();
  void loadWebDavPasswordDraft();
  void nextTick(() => {
    voiceReadPanelRef.value?.initVoiceReadProfiles?.();
  });
  void syncAiFromMain();
});

function onProxyExternalChange() {
  if (!modelValue.value) return;
  syncProxyDraftFromDisk();
}

function onProxyStorageSync(ev: StorageEvent) {
  if (ev.storageArea !== window.localStorage) return;
  if (ev.key !== null && ev.key !== findBookSettingsKey) return;
  onProxyExternalChange();
}

watch(
  modelValue,
  (open) => {
    if (open) {
      window.addEventListener("storage", onProxyStorageSync);
      window.addEventListener(findBookProxyChangedEvent, onProxyExternalChange);
    } else {
      window.removeEventListener("storage", onProxyStorageSync);
      window.removeEventListener(
        findBookProxyChangedEvent,
        onProxyExternalChange,
      );
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.removeEventListener("storage", onProxyStorageSync);
  window.removeEventListener(findBookProxyChangedEvent, onProxyExternalChange);
});

watch(draftFontSize, (fs) => {
  const cap = maxLineHeightMultipleForFontSize(fs);
  if (draftLineHeightMultiple.value > cap + 1e-6) {
    draftLineHeightMultiple.value = cap;
  }
});

watch(activeTab, (tab, prev) => {
  if (prev === "voiceRead" && tab !== "voiceRead") {
    voiceReadPanelRef.value?.cancelPreview?.();
  }
  if (tab === "webDav") {
    void loadWebDavPasswordDraft();
  }
  void nextTick(() => {
    const el = settingsTabScrollerEl.value;
    if (el) el.scrollTop = 0;
  });
});

watch(
  () => draftAi.value.aiEnabled,
  (en) => {
    if (
      !en &&
      (activeTab.value === "vectorModel" ||
        activeTab.value === "txt2img" ||
        activeTab.value === "skills")
    ) {
      activeTab.value = "ai";
    }
  },
);

function resetGeneralDraft() {
  draftRestore.value = defaultRestoreSessionOnStartup;
  draftSyncCurrentFile.value = defaultSyncCurrentFile;
  draftRecentLimit.value = defaultRecentFilesHistoryLimit;
  draftChapterMinCharCount.value = defaultChapterMinCharCount;
  draftChapterCharCountExact.value = defaultChapterCharCountExact;
  draftEbookConvertOutputDir.value = resolveDefaultEbookConvertOutputDirSync();
  draftBookPackUnpackDir.value = resolveDefaultUnpackedBooksDirSync();
  draftBookPackPassword.value = "";
}

function resetReadingDraft() {
  draftFontSize.value = defaultReaderFontSize;
  draftFontFamily.value = READER_EDITOR_DEFAULT_FONT_FAMILY;
  draftLineHeightMultiple.value = clampLineHeightMultipleForFontSize(
    defaultReaderFontSize,
    defaultReaderLineHeightMultiple,
  );
  draftLineSpacingPx.value = defaultLineSpacingPx;
  draftLetterSpacingPx.value = defaultLetterSpacingPx;
  draftReaderHorizontalInsetPx.value = defaultReaderHorizontalInsetPx;
  draftMonacoSmoothScrolling.value = defaultMonacoSmoothScrolling;
  draftScrollbarTrackBehavior.value = defaultScrollbarTrackBehavior;
  draftMonacoCjkWrapOptimize.value = defaultMonacoCjkWrapOptimize;
  draftMouseWheelScrollSensitivity.value = defaultMouseWheelScrollSensitivity;
  draftFastScrollSensitivity.value = defaultFastScrollSensitivity;
  draftStickyChapterTitleEnabled.value = defaultStickyChapterTitleEnabled;
  draftReadingRulerEnabled.value = defaultReadingRulerEnabled;
  draftReadingRulerFocusLines.value = defaultReadingRulerFocusLines;
  draftReadingRulerDimOpacity.value = defaultReadingRulerDimOpacity;
  draftReadingRulerDimStickyTitle.value = defaultReadingRulerDimStickyTitle;
  draftReadingRulerTransitionEnabled.value =
    defaultReadingRulerTransitionEnabled;
  draftMarkdownImageHeightPx.value = defaultMarkdownImageHeightPx;
  draftChapterNavToolbarEnabled.value = defaultChapterNavToolbarEnabled;
  draftChapterTitleBlankMode.value =
    defaultChapterTitleBlankMode;
  draftCompressBlankKeepOneBlank.value = defaultCompressBlankKeepOneBlank;
  draftTxtrDelimitedMatchCrossLine.value = defaultTxtrDelimitedMatchCrossLine;
  draftFullscreenReaderWidthPercent.value = defaultFullscreenReaderWidthPercent;
  draftFullscreenShowSystemTime.value = defaultFullscreenShowSystemTime;
  draftPomodoroEnabled.value = defaultPomodoroEnabled;
  draftPomodoroFocusMinutes.value = defaultPomodoroFocusMinutes;
  draftPomodoroShortBreakMinutes.value = defaultPomodoroShortBreakMinutes;
  draftPomodoroLongBreakMinutes.value = defaultPomodoroLongBreakMinutes;
  draftTimedScrollRange.value = defaultTimedScrollRange;
  draftTimedScrollIntervalMs.value = defaultTimedScrollIntervalMs;
  draftSelectionToolbarButtons.value = { ...defaultSelectionToolbarButtons };
  try {
    localStorage.setItem(fontPickerDistinguishWeightsKey, "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(fontPickerListModeResetEvent));
}

function resetEditDraft() {
  draftReaderEditShowLineNumbers.value = defaultReaderEditShowLineNumbers;
  draftReaderEditMinimap.value = defaultReaderEditMinimap;
  draftEditAutoRefreshChapterList.value = defaultEditAutoRefreshChapterList;
  draftAiSmartFormat.value = { ...defaultAiSmartFormatSettings };
}

function resetAiDraft() {
  aiPanelRef.value?.resetAiPageDraft?.();
}

function resetVectorModelDraft() {
  const def = defaultAIConfig;
  const prevEmbeddingEnabled = draftAi.value.embeddingEnabled;
  draftAi.value = {
    ...draftAi.value,
    embeddingEnabled: prevEmbeddingEnabled,
    embedding: {
      ...structuredClone(def.embedding),
      builtinModelCacheDir: resolveDefaultBuiltinModelCacheDirSync(),
    },
    ragTopK: def.ragTopK,
  };
}

function resetTxt2ImgDraft() {
  txt2imgPanelRef.value?.resetCurrentTxt2ImgProfile?.();
  draftCharacterPortraitCacheDir.value =
    resolveDefaultCharacterPortraitCacheDirSync();
}

function resetSkillsDraft() {
  draftAiSkillOverrides.value = mergeAiSkillOverrides(undefined);
  draftAiCustomSkills.value = [];
  draftAiSkillsEnabled.value = mergeAiSkillsEnabled(undefined, []);
}

function resetVoiceReadDraft() {
  voiceReadPanelRef.value?.resetCurrentVoiceReadProfile?.();
}

function resetWebDavDraft() {
  draftWebDavEnabled.value = false;
  draftWebDavUrl.value = "";
  draftWebDavUsername.value = "";
  draftWebDavPassword.value = "";
  draftWebDavRemoteDir.value = "ColorTxt";
}

function onResetCurrentTab() {
  if (activeTab.value === "general") resetGeneralDraft();
  else if (activeTab.value === "reading") resetReadingDraft();
  else if (activeTab.value === "edit") resetEditDraft();
  else if (activeTab.value === "ai") resetAiDraft();
  else if (activeTab.value === "vectorModel") resetVectorModelDraft();
  else if (activeTab.value === "txt2img") resetTxt2ImgDraft();
  else if (activeTab.value === "skills") resetSkillsDraft();
  else if (activeTab.value === "voiceRead") resetVoiceReadDraft();
  else if (activeTab.value === "proxy") resetProxyDraft();
  else if (activeTab.value === "webDav") resetWebDavDraft();
}

function onCancel() {
  modelValue.value = false;
}

async function onConfirm() {
  if (!window.colorTxt) return;

  const builtinEmbedBlock = await getBuiltinEmbeddingBlockMessage(draftAi.value);
  if (builtinEmbedBlock) {
    await appAlert(builtinEmbedBlock);
    return;
  }

  if (draftAi.value.embedding.dimension !== loadedAiDimension.value) {
    const r = await window.colorTxt.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      buttons: ["取消", "保存"],
      defaultId: 1,
      cancelId: 0,
      message:
        "向量维度已修改，保存后将清空所有已构建的书籍向量索引，是否继续？",
      noLink: true,
    });
    if (r.response !== 1) return;
  }

  const nextDataCacheDir = await resolveEffectiveAiDataCacheDir(
    draftAi.value.aiDataCacheDir,
  );
  const prevDataCacheDir = loadedAiDataCacheDir.value.trim();
  if (
    prevDataCacheDir &&
    nextDataCacheDir &&
    prevDataCacheDir !== nextDataCacheDir
  ) {
    const r = await window.colorTxt.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      buttons: ["取消", "继续迁移并保存"],
      defaultId: 1,
      cancelId: 0,
      message:
        "AI 数据缓存目录已变更，保存后将迁移 AI 配置（含 API 密钥）与向量库/对话记录。",
      detail: `从：${prevDataCacheDir}\n到：${nextDataCacheDir}`,
      noLink: true,
    });
    if (r.response !== 1) return;
    const mig = await window.colorTxt.ai.migrateDataCacheRoot({
      from: prevDataCacheDir,
      to: nextDataCacheDir,
    });
    if (!mig.ok) {
      await appAlert(mig.error ?? "迁移 AI 数据缓存失败，已保留原目录。");
      return;
    }
  }

  if (draftAi.value.embedding.provider === "builtin") {
    const nextModelCacheDir = await resolveEffectiveBuiltinModelCacheDir(
      draftAi.value.embedding.builtinModelCacheDir,
    );
    const prevModelCacheDir = loadedBuiltinModelCacheDir.value.trim();
    if (
      prevModelCacheDir &&
      nextModelCacheDir &&
      prevModelCacheDir !== nextModelCacheDir
    ) {
      const r = await window.colorTxt.showMessageBox({
        type: "warning",
        title: APP_DISPLAY_NAME,
        buttons: ["取消", "继续迁移并保存"],
        defaultId: 1,
        cancelId: 0,
        message: "模型缓存目录已变更，保存后将迁移已下载/放置的内置模型文件。",
        detail: `从：${prevModelCacheDir}\n到：${nextModelCacheDir}`,
        noLink: true,
      });
      if (r.response !== 1) return;
      const mig = await window.colorTxt.ai.migrateBuiltinModelCacheRoot({
        from: prevModelCacheDir,
        to: nextModelCacheDir,
      });
      if (!mig.ok) {
        await appAlert(mig.error ?? "迁移模型缓存失败，已保留原目录。");
        return;
      }
    }
  }

  if (voiceReadDashScopeRequiresApiKey(draftVoiceRead.value)) {
    await appAlert("「语音朗读」阿里云通义（DashScope）需要 API 密钥");
    return;
  }

  try {
    await window.colorTxt.secrets.setWebDavPassword(draftWebDavPassword.value);
  } catch (e) {
    await appAlert(
      e instanceof Error ? e.message : "保存 WebDAV 密码失败",
    );
    return;
  }

  saveFindBookProxySettingsAndSync({
    enabled: draftProxyEnabled.value,
    type: draftProxyType.value,
    host: draftProxyHost.value.trim(),
    port: draftProxyPort.value.trim(),
    username: draftProxyUsername.value.trim(),
    password: draftProxyPassword.value,
  });

  aiPanelRef.value?.finalizeChatProfiles?.();
  txt2imgPanelRef.value?.finalizeTxt2ImgProfiles?.();
  voiceReadPanelRef.value?.finalizeVoiceReadProfiles?.();
  applyAllActiveProfilesToConfig(draftAi.value);

  const aiPayload = JSON.parse(
    JSON.stringify(toRaw(draftAi.value)),
  ) as AIConfig;
  const aiRes = await window.colorTxt.ai.configSet(aiPayload);
  if (!aiRes.ok) {
    await appAlert(aiRes.error ?? "保存 AI 配置失败");
    return;
  }
  loadedAiDimension.value = draftAi.value.embedding.dimension;
  loadedAiDataCacheDir.value = nextDataCacheDir;
  if (draftAi.value.embedding.provider === "builtin") {
    loadedBuiltinModelCacheDir.value =
      await resolveEffectiveBuiltinModelCacheDir(
        draftAi.value.embedding.builtinModelCacheDir,
      );
  }

  emit("apply", {
    restoreSessionOnStartup: draftRestore.value,
    syncCurrentFile: draftSyncCurrentFile.value,
    recentFilesHistoryLimit: draftRecentLimit.value,
    chapterMinCharCount: draftChapterMinCharCount.value,
    fullscreenReaderWidthPercent: draftFullscreenReaderWidthPercent.value,
    fullscreenShowSystemTime: draftFullscreenShowSystemTime.value,
    monacoSmoothScrolling: draftMonacoSmoothScrolling.value,
    scrollbarTrackBehavior: draftScrollbarTrackBehavior.value,
    monacoCjkWrapOptimize: draftMonacoCjkWrapOptimize.value,
    mouseWheelScrollSensitivity: clampMouseWheelScrollSensitivity(
      draftMouseWheelScrollSensitivity.value,
    ),
    fastScrollSensitivity: clampFastScrollSensitivity(
      draftFastScrollSensitivity.value,
    ),
    stickyChapterTitleEnabled: draftStickyChapterTitleEnabled.value,
    readingRulerEnabled: draftReadingRulerEnabled.value,
    readingRulerFocusLines: clampReadingRulerFocusLines(
      draftReadingRulerFocusLines.value,
    ),
    readingRulerDimOpacity: clampReadingRulerDimOpacity(
      draftReadingRulerDimOpacity.value,
    ),
    readingRulerDimStickyTitle: draftReadingRulerDimStickyTitle.value,
    readingRulerTransitionEnabled: draftReadingRulerTransitionEnabled.value,
    markdownImageHeightPx: clampMarkdownImageHeightPx(
      draftMarkdownImageHeightPx.value,
    ),
    chapterNavToolbarEnabled: draftChapterNavToolbarEnabled.value,
    chapterCharCountExact: draftChapterCharCountExact.value,
    readerEditShowLineNumbers: draftReaderEditShowLineNumbers.value,
    readerEditMinimap: draftReaderEditMinimap.value,
    editAutoRefreshChapterList: draftEditAutoRefreshChapterList.value,
    aiSmartFormat: { ...draftAiSmartFormat.value },
    fontSize: draftFontSize.value,
    fontFamily: draftFontFamily.value,
    lineHeightMultiple: draftLineHeightMultiple.value,
    lineSpacingPx: clampLineSpacingPx(draftLineSpacingPx.value),
    letterSpacingPx: clampLetterSpacingPx(draftLetterSpacingPx.value),
    readerHorizontalInsetPx: clampReaderHorizontalInsetPx(
      draftReaderHorizontalInsetPx.value,
    ),
    chapterTitleBlankMode: draftChapterTitleBlankMode.value,
    compressBlankKeepOneBlank: draftCompressBlankKeepOneBlank.value,
    txtrDelimitedMatchCrossLine: draftTxtrDelimitedMatchCrossLine.value,
    timedScroll: mergeTimedScrollSettings({
      range: draftTimedScrollRange.value,
      intervalMs: draftTimedScrollIntervalMs.value,
    }),
    pomodoro: mergePomodoroSettings({
      enabled: draftPomodoroEnabled.value,
      focusMinutes: draftPomodoroFocusMinutes.value,
      shortBreakMinutes: draftPomodoroShortBreakMinutes.value,
      longBreakMinutes: draftPomodoroLongBreakMinutes.value,
    }),
    selectionToolbarButtons: mergeSelectionToolbarButtons(
      draftSelectionToolbarButtons.value,
    ),
    ebookConvertOutputDir: draftEbookConvertOutputDir.value.trim(),
    bookPackUnpackDir: draftBookPackUnpackDir.value.trim(),
    bookPackPassword: draftBookPackPassword.value,
    webDavEnabled: draftWebDavEnabled.value,
    webDavUrl: draftWebDavUrl.value.trim(),
    webDavUsername: draftWebDavUsername.value.trim(),
    webDavRemoteDir: draftWebDavRemoteDir.value.trim() || "ColorTxt",
    characterPortraitCacheDir: draftCharacterPortraitCacheDir.value.trim(),
    aiSkillsEnabled: mergeAiSkillsEnabled(
      draftAiSkillsEnabled.value,
      draftAiCustomSkills.value.map((s) => s.id),
    ),
    aiSkillOverrides: mergeAiSkillOverrides(draftAiSkillOverrides.value),
    aiCustomSkills: mergeAiCustomSkills(draftAiCustomSkills.value),
    voiceRead: mergeVoiceReadSettings(draftVoiceRead.value),
    voiceReadProfiles: cloneVoiceReadProfiles(draftVoiceReadProfiles.value),
    activeVoiceReadProfileId: draftActiveVoiceReadProfileId.value.trim(),
  });
}

async function onClearCache() {
  const r = await window.colorTxt.showMessageBox({
    type: "warning",
    title: APP_DISPLAY_NAME,
    buttons: ["取消", "清除"],
    defaultId: 1,
    cancelId: 0,
    message: "是否清除应用缓存？",
    detail: [
      "将清除会话、最近打开、文件列表、收藏高亮词、阅读数据等本地缓存；",
      "不会删除电子书转换的 .md 文件、书包解压的文件、找书下载的文件；",
      "不影响界面相关的设置（字号、主题、配色等）；",
      "清除后窗口会重新加载。",
    ].join("\n"),
    noLink: true,
  });
  if (r.response !== 1) return;
  try {
    sessionStorage.setItem(skipUnloadPersistenceSessionKey, "1");
  } catch {
    // ignore
  }

  try {
    await window.colorTxt.ai.threadDeleteAll();
  } catch {
    /* 库未初始化或删除失败不阻断清除 */
  }
  try {
    await window.colorTxt.ai.indexDeleteAll();
  } catch {
    /* 库未初始化或删除失败不阻断清除 */
  }

  // 删除角色立绘缓存根目录（含各书立绘与草稿）
  try {
    const root =
      props.characterPortraitCacheDir.trim() ||
      resolveDefaultCharacterPortraitCacheDirSync();
    if (root) {
      await window.colorTxt.removePath(root);
    }
  } catch {
    /* 目录不存在或删除失败不阻断清除 */
  }

  let saved = localStorage.getItem(persistKey);
  if (saved !== null) {
    try {
      const obj = JSON.parse(saved) as Record<string, unknown>;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        delete obj.highlightWordsByIndexGlobal;
        saved = JSON.stringify(obj);
      }
    } catch {
      // 保留原 settings 字符串
    }
  }
  /** 与界面设置同类的独立 UI 偏好，清缓存后仍保留 */
  let savedFontListMode: string | null = null;
  let savedFontPins: string | null = null;
  try {
    savedFontListMode = localStorage.getItem(fontPickerDistinguishWeightsKey);
    savedFontPins = localStorage.getItem(systemFontFacePinsKey);
  } catch {
    /* ignore */
  }
  try {
    localStorage.clear();
    if (saved !== null) localStorage.setItem(persistKey, saved);
    if (savedFontListMode !== null) {
      localStorage.setItem(fontPickerDistinguishWeightsKey, savedFontListMode);
    }
    if (savedFontPins !== null) {
      localStorage.setItem(systemFontFacePinsKey, savedFontPins);
    }
  } catch {
    // ignore
  }
  window.location.reload();
}
</script>

<template>
  <AppModal
    v-model="modelValue"
    title="设置"
    max-width="700px"
    panel-class="settingsPanelModal"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="false"
  >
    <div class="settingsLayout">
      <SettingsTabBar
        v-model:active-tab="activeTab"
        :show-ai-extension-tabs="showAiExtensionTabs"
      />

      <div class="settingsScroll">
        <div ref="settingsTabScrollerEl" class="settingsTabScroller">
          <div class="settingsTabContent">
            <SettingsGeneralPanel
              v-show="activeTab === 'general'"
              v-model:draft-restore="draftRestore"
              v-model:draft-sync-current-file="draftSyncCurrentFile"
              v-model:draft-recent-limit="draftRecentLimit"
              v-model:draft-chapter-min-char-count="draftChapterMinCharCount"
              v-model:draft-chapter-char-count-exact="
                draftChapterCharCountExact
              "
              v-model:draft-ebook-convert-output-dir="
                draftEbookConvertOutputDir
              "
              v-model:draft-book-pack-unpack-dir="draftBookPackUnpackDir"
              v-model:draft-book-pack-password="draftBookPackPassword"
              v-model:show-book-pack-password="showBookPackPassword"
              @open-reading-data="emit('openReadingData')"
              @clear-cache="onClearCache"
            />

            <SettingsReadingPanel
              v-show="activeTab === 'reading'"
              v-model:draft-font-family="draftFontFamily"
              :pinned-other-fonts="pinnedOtherFonts"
              v-model:draft-font-size="draftFontSize"
              v-model:draft-line-height-multiple="draftLineHeightMultiple"
              v-model:draft-line-spacing-px="draftLineSpacingPx"
              v-model:draft-letter-spacing-px="draftLetterSpacingPx"
              v-model:draft-reader-horizontal-inset-px="
                draftReaderHorizontalInsetPx
              "
              v-model:draft-monaco-smooth-scrolling="draftMonacoSmoothScrolling"
              v-model:draft-scrollbar-track-behavior="draftScrollbarTrackBehavior"
              v-model:draft-monaco-cjk-wrap-optimize="draftMonacoCjkWrapOptimize"
              v-model:draft-mouse-wheel-scroll-sensitivity="
                draftMouseWheelScrollSensitivity
              "
              v-model:draft-fast-scroll-sensitivity="draftFastScrollSensitivity"
              v-model:draft-sticky-chapter-title-enabled="
                draftStickyChapterTitleEnabled
              "
              v-model:draft-reading-ruler-enabled="draftReadingRulerEnabled"
              v-model:draft-reading-ruler-focus-lines="
                draftReadingRulerFocusLines
              "
              v-model:draft-reading-ruler-dim-opacity="
                draftReadingRulerDimOpacity
              "
              v-model:draft-reading-ruler-dim-sticky-title="
                draftReadingRulerDimStickyTitle
              "
              v-model:draft-reading-ruler-transition-enabled="
                draftReadingRulerTransitionEnabled
              "
              v-model:draft-markdown-image-height-px="draftMarkdownImageHeightPx"
              v-model:draft-chapter-nav-toolbar-enabled="
                draftChapterNavToolbarEnabled
              "
              v-model:draft-chapter-title-blank-mode="
                draftChapterTitleBlankMode
              "
              v-model:draft-compress-blank-keep-one-blank="
                draftCompressBlankKeepOneBlank
              "
              v-model:draft-txtr-delimited-match-cross-line="
                draftTxtrDelimitedMatchCrossLine
              "
              v-model:draft-fullscreen-reader-width-percent="
                draftFullscreenReaderWidthPercent
              "
              v-model:draft-fullscreen-show-system-time="
                draftFullscreenShowSystemTime
              "
              v-model:draft-pomodoro-enabled="draftPomodoroEnabled"
              v-model:draft-pomodoro-focus-minutes="draftPomodoroFocusMinutes"
              v-model:draft-pomodoro-short-break-minutes="
                draftPomodoroShortBreakMinutes
              "
              v-model:draft-pomodoro-long-break-minutes="
                draftPomodoroLongBreakMinutes
              "
              v-model:draft-timed-scroll-range="draftTimedScrollRange"
              v-model:draft-timed-scroll-interval-ms="
                draftTimedScrollIntervalMs
              "
              v-model:draft-selection-toolbar-buttons="
                draftSelectionToolbarButtons
              "
              :monaco-custom-highlight="monacoCustomHighlight"
              @toggle-pin-other-font="emit('togglePinOtherFont', $event)"
              @open-dictionary-manage="emit('openDictionaryManage')"
              @open-web-search-manage="emit('openWebSearchManage')"
              @open-translate-manage="emit('openTranslateManage')"
            />

            <SettingsEditPanel
              v-show="activeTab === 'edit'"
              :ai-features-enabled="showAiExtensionTabs"
              v-model:draft-reader-edit-show-line-numbers="
                draftReaderEditShowLineNumbers
              "
              v-model:draft-reader-edit-minimap="draftReaderEditMinimap"
              v-model:draft-edit-auto-refresh-chapter-list="
                draftEditAutoRefreshChapterList
              "
              v-model:draft-ai-smart-format="draftAiSmartFormat"
            />

            <SettingsVoiceReadPanel
              ref="voiceReadPanelRef"
              v-show="activeTab === 'voiceRead'"
              v-model="draftVoiceRead"
              v-model:profiles="draftVoiceReadProfiles"
              v-model:active-profile-id="draftActiveVoiceReadProfileId"
              :ai-enabled="draftAi.aiEnabled"
              :character-roster="characterRoster"
              @open-speak-settings="emit('openSpeakSettings')"
            />

            <SettingsAIPanel
              ref="aiPanelRef"
              v-show="activeTab === 'ai'"
              v-model="draftAi"
            />

            <SettingsVectorModelPanel
              v-show="activeTab === 'vectorModel'"
              v-model="draftAi"
            />

            <SettingsTxt2ImgPanel
              ref="txt2imgPanelRef"
              v-show="activeTab === 'txt2img'"
              v-model="draftAi"
              v-model:character-portrait-cache-dir="
                draftCharacterPortraitCacheDir
              "
            />

            <SettingsSkillsPanel
              ref="skillsPanelRef"
              v-show="activeTab === 'skills'"
              v-model:enabled="draftAiSkillsEnabled"
              v-model:overrides="draftAiSkillOverrides"
              v-model:custom-skills="draftAiCustomSkills"
            />

            <FindBookSettingsProxyPanel
              v-show="activeTab === 'proxy'"
              v-model:draft-proxy-enabled="draftProxyEnabled"
              v-model:draft-proxy-type="draftProxyType"
              v-model:draft-proxy-host="draftProxyHost"
              v-model:draft-proxy-port="draftProxyPort"
              v-model:draft-proxy-username="draftProxyUsername"
              v-model:draft-proxy-password="draftProxyPassword"
            />

            <SettingsWebDavPanel
              v-show="activeTab === 'webDav'"
              context="main"
              v-model:draft-web-dav-enabled="draftWebDavEnabled"
              v-model:draft-web-dav-url="draftWebDavUrl"
              v-model:draft-web-dav-username="draftWebDavUsername"
              v-model:draft-web-dav-password="draftWebDavPassword"
              v-model:draft-web-dav-remote-dir="draftWebDavRemoteDir"
            />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="settingsFooter">
        <div class="settingsFooterStart">
          <button
            class="btn"
            type="button"
            size="large"
            @click="onResetCurrentTab"
          >
            重置当前页
          </button>
          <button
            v-show="activeTab === 'skills'"
            class="btn settingsFooterAddBtn"
            type="button"
            size="large"
            @click="onAddSkillClick"
          >
            <span
              class="settingsFooterAddIcon"
              aria-hidden="true"
              v-html="icons.add"
            />
            添加技能
          </button>
        </div>
        <div class="settingsFooterActions">
          <button class="btn" type="button" size="large" @click="onCancel">
            取消
          </button>
          <button
            class="btn primary"
            type="button"
            size="large"
            @click="onConfirm"
          >
            确定
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.settingsLayout {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.settingsScroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/**
 * 滚动条贴齐内容区右缘（不受正文左右 padding 影响）；
 * 可滚动高度由 flex 链 `min-height: 0` 约束。
 */
.settingsTabScroller {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 16px 8px 8px 0;
}

/** 仅标签页正文内边距（不含顶部分类标签栏） */
.settingsTabContent {
  box-sizing: border-box;
}

.resetHint {
  margin: 8px 4px 0;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.4;
}

.settingsFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
}

.settingsFooterStart {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.settingsFooterAddBtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.settingsFooterAddIcon {
  display: inline-flex;
  line-height: 0;
  flex-shrink: 0;
}

.settingsFooterAddIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.settingsFooterAddIcon :deep(svg path) {
  fill: currentColor;
}

.settingsFooterActions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: auto;
}
</style>

<style>
/* 非 scoped：与配色面板一致拔高模态高度 */
.settingsPanelModal {
  height: min(640px, calc(100vh - 48px));
}
</style>
