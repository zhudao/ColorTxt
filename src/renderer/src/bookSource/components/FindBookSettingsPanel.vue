<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from "vue";
import AppModal from "../../components/AppModal.vue";
import SettingsReadingPanel from "../../components/SettingsReadingPanel.vue";
import DictionaryManageModal from "../../components/DictionaryManageModal.vue";
import WebSearchManageModal from "../../components/WebSearchManageModal.vue";
import TranslateManageModal from "../../components/TranslateManageModal.vue";
import SettingsEditPanel from "../../components/SettingsEditPanel.vue";
import { mergeDictionarySettings } from "../../constants/dictionarySettings";
import { mergeWebSearchSettings } from "../../constants/webSearchSettings";
import {
  mergeTranslationSettings,
  resolveTranslationSecretsWritePayload,
} from "../../constants/translationSettings";
import type { DictionarySettings } from "@shared/dictionaryTypes";
import type { WebSearchSettings } from "@shared/webSearchTypes";
import type { TranslationSettings } from "@shared/translationTypes";
import SettingsVoiceReadPanel from "../../components/SettingsVoiceReadPanel.vue";
import FindBookSettingsTabBar, {
  type FindBookSettingsTabId,
} from "./FindBookSettingsTabBar.vue";
import FindBookSettingsDownloadPanel from "./FindBookSettingsDownloadPanel.vue";
import FindBookSettingsProxyPanel from "./FindBookSettingsProxyPanel.vue";
import SettingsWebDavPanel from "../../components/SettingsWebDavPanel.vue";
import {
  clampFindBookReaderLineHeight,
  defaultTimedScrollIntervalMs,
  defaultTimedScrollRange,
  loadMainSettingsData,
  patchPersistedMainSettings,
} from "../services/findBookSettingsStore";
import {
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
  defaultChapterNavToolbarEnabled,
  maxLineHeightMultipleForFontSize,
} from "../../constants/appUi";
import { mergeTimedScrollSettings } from "../../constants/timedScroll";
import type { TimedScrollRange } from "../../constants/timedScroll";
import {
  defaultPomodoroEnabled,
  defaultPomodoroFocusMinutes,
  defaultPomodoroLongBreakMinutes,
  defaultPomodoroShortBreakMinutes,
  mergePomodoroSettings,
} from "../../constants/pomodoro";
import {
  defaultSelectionToolbarButtons,
  mergeSelectionToolbarButtons,
  type SelectionToolbarButtons,
} from "../../constants/selectionToolbar";
import {
  mergeVoiceReadSettings,
  voiceReadDashScopeRequiresApiKey,
  type VoiceReadSettings,
} from "../../constants/voiceRead";
import type { VoiceReadProfile } from "@shared/voiceReadProfiles";
import {
  mergeVoiceReadProfileSecretsForSave,
  stripVoiceReadProfileApiKeysForDisk,
  stripVoiceReadSettingsApiKeysForDisk,
} from "@shared/voiceReadProfiles";
import {
  parseProfileSecretsBlob,
  serializeProfileSecretsBlob,
} from "@shared/voiceReadEngineConfig";
import {
  cloneVoiceReadProfiles,
  mergeVoiceReadProfilesForPersist,
  migrateVoiceReadFromPersisted,
  normalizeVoiceReadProfilesForSave,
  type PersistedVoiceReadRaw,
} from "../../services/voiceRead/voiceReadProfileState";
import { hydrateVoiceReadProfilesWithSecrets } from "../../services/voiceRead/voiceReadSecretsHydration";
import { settingsPersistValuesEqual } from "../../services/settingsPersistMerge";
import { useFindBookSettings } from "../composables/useFindBookSettings";
import { useFindBookReaderSettings } from "../composables/useFindBookReaderSettings";
import {
  DEFAULT_FIND_BOOK_DOWNLOAD_AFTER_ACTION,
  DEFAULT_FIND_BOOK_DOWNLOAD_CATEGORY,
  DEFAULT_FIND_BOOK_PROXY_SETTINGS,
  type FindBookDownloadAfterAction,
  type FindBookProxyType,
} from "../constants/findBookSettings";
import {
  resolveDefaultBookSourceChapterCacheDirSync,
  resolveDefaultBookSourceDownloadDirSync,
} from "../../utils/defaultCacheDirs";
import { confirmClearAllChapterCache } from "../services/clearBookChapterCache";
import { appAlert } from "../../services/appDialog";
import { READER_EDITOR_DEFAULT_FONT_FAMILY } from "../../monaco/readerEditorOptions";
import type { CharacterRosterEntry } from "@shared/characterTypes";
import "../../styles/settingsPanel.css";

type SettingsVoiceReadPanelExpose = {
  cancelPreview?: () => void;
  finalizeVoiceReadProfiles?: () => void;
  initVoiceReadProfiles?: () => void;
  resetCurrentVoiceReadProfile?: () => void;
};

const modelValue = defineModel<boolean>({ default: false });

const props = withDefaults(
  defineProps<{
    initialTab?: FindBookSettingsTabId;
  }>(),
  { initialTab: "download" },
);

const emit = defineEmits<{
  chapterCacheCleared: [];
  openSpeakSettings: [];
}>();

const fb = useFindBookSettings();
const fbReaderSettings = useFindBookReaderSettings();
const activeTab = ref<FindBookSettingsTabId>("download");
const voiceReadPanelRef =
  useTemplateRef<SettingsVoiceReadPanelExpose>("voiceReadPanelRef");

const draftCacheDir = ref("");
const draftDownloadDir = ref("");
const draftDownloadAfterAction = ref<FindBookDownloadAfterAction>(
  DEFAULT_FIND_BOOK_DOWNLOAD_AFTER_ACTION,
);
const draftDownloadAddToMainFileList = ref(true);
const draftDownloadDefaultCategory = ref(DEFAULT_FIND_BOOK_DOWNLOAD_CATEGORY);
const draftProxyEnabled = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.enabled);
const draftProxyType = ref<FindBookProxyType>(DEFAULT_FIND_BOOK_PROXY_SETTINGS.type);
const draftProxyHost = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.host);
const draftProxyPort = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.port);
const draftProxyUsername = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.username);
const draftProxyPassword = ref(DEFAULT_FIND_BOOK_PROXY_SETTINGS.password);
const draftWebDavEnabled = ref(false);
const draftWebDavUrl = ref("");
const draftWebDavUsername = ref("");
const draftWebDavPassword = ref("");
const draftWebDavRemoteDir = ref("ColorTxt");
const draftFontSize = ref(defaultReaderFontSize);
const draftFontFamily = ref(READER_EDITOR_DEFAULT_FONT_FAMILY);
const draftLineHeightMultiple = ref(defaultReaderLineHeightMultiple);
const draftLineSpacingPx = ref(defaultLineSpacingPx);
const draftLetterSpacingPx = ref(defaultLetterSpacingPx);
const draftReaderHorizontalInsetPx = ref(defaultReaderHorizontalInsetPx);
const draftMonacoSmoothScrolling = ref(defaultMonacoSmoothScrolling);
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
const draftFindBookChapterAdvanceEnabled = ref(fbReaderSettings.findBookChapterAdvanceEnabled.value);
const draftReaderEditShowLineNumbers = ref(defaultReaderEditShowLineNumbers);
const draftReaderEditMinimap = ref(defaultReaderEditMinimap);
const draftChapterTitleBlankMode = ref(
  defaultChapterTitleBlankMode,
);
const draftCompressBlankKeepOneBlank = ref(defaultCompressBlankKeepOneBlank);
const draftTxtrDelimitedMatchCrossLine = ref(defaultTxtrDelimitedMatchCrossLine);
const draftFullscreenReaderWidthPercent = ref(defaultFullscreenReaderWidthPercent);
const draftFullscreenShowSystemTime = ref(defaultFullscreenShowSystemTime);
const draftPomodoroEnabled = ref(defaultPomodoroEnabled);
const draftPomodoroFocusMinutes = ref(defaultPomodoroFocusMinutes);
const draftPomodoroShortBreakMinutes = ref(defaultPomodoroShortBreakMinutes);
const draftPomodoroLongBreakMinutes = ref(defaultPomodoroLongBreakMinutes);
const draftTimedScrollRange = ref<TimedScrollRange>(defaultTimedScrollRange);
const draftTimedScrollIntervalMs = ref(defaultTimedScrollIntervalMs);
const draftSelectionToolbarButtons = ref<SelectionToolbarButtons>(
  mergeSelectionToolbarButtons(undefined),
);
const showDictionaryManagePanel = ref(false);
const showWebSearchManagePanel = ref(false);
const showTranslateManagePanel = ref(false);

function openTranslateManageFromSettings() {
  showTranslateManagePanel.value = true;
}

async function onTranslationSettingsUpdate(v: TranslationSettings) {
  fb.translationSettings.value = mergeTranslationSettings(v);
  try {
    const payload = await resolveTranslationSecretsWritePayload(
      fb.translationSettings.value,
      async () => {
        const res = await window.colorTxt.secrets.getTranslationProviderKeys();
        return res.keys ?? "";
      },
    );
    if (payload) {
      await window.colorTxt.secrets.setTranslationSecrets(payload);
    }
  } catch {
    /* ignore */
  }
  fb.persistReaderUiPrefs();
}

const draftVoiceRead = ref<VoiceReadSettings>(mergeVoiceReadSettings(undefined));
const draftVoiceReadProfiles = ref<VoiceReadProfile[]>([]);
const draftActiveVoiceReadProfileId = ref("");
const draftAiEnabled = ref(false);
const emptyCharacterRoster: CharacterRosterEntry[] = [];

function syncFindBookOnlyDraftFromStore() {
  draftCacheDir.value = fb.cacheDir.value;
  draftDownloadDir.value = fb.downloadDir.value;
  draftDownloadAfterAction.value = fb.downloadAfterAction.value;
  draftDownloadAddToMainFileList.value = fb.downloadAddToMainFileList.value;
  draftDownloadDefaultCategory.value = fb.downloadDefaultCategory.value;
  draftProxyEnabled.value = fb.proxy.value.enabled;
  draftProxyType.value = fb.proxy.value.type;
  draftProxyHost.value = fb.proxy.value.host;
  draftProxyPort.value = fb.proxy.value.port;
  draftProxyUsername.value = fb.proxy.value.username;
  draftProxyPassword.value = fb.proxy.value.password;
}

function syncWebDavDraftFromMainSettings() {
  const main = loadMainSettingsData();
  draftWebDavEnabled.value = main.webDavEnabled === true;
  draftWebDavUrl.value =
    typeof main.webDavUrl === "string" ? main.webDavUrl : "";
  draftWebDavUsername.value =
    typeof main.webDavUsername === "string" ? main.webDavUsername : "";
  draftWebDavRemoteDir.value =
    typeof main.webDavRemoteDir === "string" && main.webDavRemoteDir.trim()
      ? main.webDavRemoteDir.trim()
      : "ColorTxt";
}

async function loadWebDavPasswordDraft() {
  try {
    const r = await window.colorTxt.secrets.getWebDavPassword();
    draftWebDavPassword.value = r.password ?? "";
  } catch {
    draftWebDavPassword.value = "";
  }
}

function togglePinOtherFont(fontName: string) {
  const normalized = fontName.trim();
  if (!normalized) return;
  const list = fb.pinnedOtherFonts.value;
  const idx = list.findIndex((f) => f.trim() === normalized);
  if (idx >= 0) {
    fb.pinnedOtherFonts.value = list.filter((_, i) => i !== idx);
  } else {
    fb.pinnedOtherFonts.value = [...list, normalized];
  }
  fb.persistReaderUiPrefs();
}

function syncSharedReaderDraftFromStore() {
  draftFontSize.value = fb.readerFontSize.value;
  draftFontFamily.value = fb.monacoFontFamily.value;
  draftLineHeightMultiple.value = clampFindBookReaderLineHeight(
    fb.readerFontSize.value,
    fb.readerLineHeightMultiple.value,
  );
  draftLineSpacingPx.value = clampLineSpacingPx(fb.readerLineSpacingPx.value);
  draftLetterSpacingPx.value = clampLetterSpacingPx(
    fb.readerLetterSpacingPx.value,
  );
  draftReaderHorizontalInsetPx.value = clampReaderHorizontalInsetPx(
    fb.readerHorizontalInsetPx.value,
  );
  draftMonacoSmoothScrolling.value = fb.monacoSmoothScrolling.value;
  draftScrollbarTrackBehavior.value = fb.scrollbarTrackBehavior.value;
  draftMonacoCjkWrapOptimize.value = fb.monacoCjkWrapOptimize.value;
  draftMouseWheelScrollSensitivity.value = clampMouseWheelScrollSensitivity(
    fb.mouseWheelScrollSensitivity.value,
  );
  draftFastScrollSensitivity.value = clampFastScrollSensitivity(
    fb.fastScrollSensitivity.value,
  );
  draftStickyChapterTitleEnabled.value = fb.stickyChapterTitleEnabled.value;
  draftReadingRulerEnabled.value = fb.readingRulerEnabled.value;
  draftReadingRulerFocusLines.value = clampReadingRulerFocusLines(
    fb.readingRulerFocusLines.value,
  );
  draftReadingRulerDimOpacity.value = clampReadingRulerDimOpacity(
    fb.readingRulerDimOpacity.value,
  );
  draftReadingRulerDimStickyTitle.value = fb.readingRulerDimStickyTitle.value;
  draftReadingRulerTransitionEnabled.value =
    fb.readingRulerTransitionEnabled.value;
  draftMarkdownImageHeightPx.value = clampMarkdownImageHeightPx(
    fb.markdownImageHeightPx.value,
  );
  draftChapterNavToolbarEnabled.value = fb.chapterNavToolbarEnabled.value;
  draftFindBookChapterAdvanceEnabled.value = fb.findBookChapterAdvanceEnabled.value;
  draftReaderEditShowLineNumbers.value = fb.readerEditShowLineNumbers.value;
  draftReaderEditMinimap.value = fb.readerEditMinimap.value;
  draftChapterTitleBlankMode.value =
    fb.chapterTitleBlankMode.value;
  draftCompressBlankKeepOneBlank.value = fb.compressBlankKeepOneBlank.value;
  draftTxtrDelimitedMatchCrossLine.value = fb.txtrDelimitedMatchCrossLine.value;
  draftFullscreenReaderWidthPercent.value = fb.fullscreenReaderWidthPercent.value;
  draftFullscreenShowSystemTime.value = fb.fullscreenShowSystemTime.value;
  const pomodoroMerged = mergePomodoroSettings(fb.pomodoroSettings.value);
  draftPomodoroEnabled.value = pomodoroMerged.enabled;
  draftPomodoroFocusMinutes.value = pomodoroMerged.focusMinutes;
  draftPomodoroShortBreakMinutes.value = pomodoroMerged.shortBreakMinutes;
  draftPomodoroLongBreakMinutes.value = pomodoroMerged.longBreakMinutes;
  const timedScrollMerged = mergeTimedScrollSettings(fb.timedScrollSettings.value);
  draftTimedScrollRange.value = timedScrollMerged.range;
  draftTimedScrollIntervalMs.value = timedScrollMerged.intervalMs;
  draftSelectionToolbarButtons.value = mergeSelectionToolbarButtons(
    fb.selectionToolbarButtons.value,
  );
}

async function syncVoiceDraftFromStore() {
  draftVoiceReadProfiles.value = cloneVoiceReadProfiles(
    fbReaderSettings.voiceReadProfiles.value,
  );
  draftActiveVoiceReadProfileId.value =
    fbReaderSettings.activeVoiceReadProfileId.value;
  draftVoiceRead.value = mergeVoiceReadSettings(
    fbReaderSettings.voiceReadSettings.value,
  );
  try {
    const c = await window.colorTxt.ai.configGet();
    draftAiEnabled.value = c.aiEnabled === true;
  } catch {
    draftAiEnabled.value = false;
  }
}

async function syncAllDraftsFromStores() {
  // 阅读/编辑/语音均用本窗内存（与多主窗口一致）
  syncFindBookOnlyDraftFromStore();
  syncSharedReaderDraftFromStore();
  syncWebDavDraftFromMainSettings();
  await loadWebDavPasswordDraft();
  await syncVoiceDraftFromStore();
  await nextTick();
  voiceReadPanelRef.value?.initVoiceReadProfiles?.();
}

function resetDownloadDraft() {
  draftCacheDir.value = resolveDefaultBookSourceChapterCacheDirSync();
  draftDownloadDir.value = resolveDefaultBookSourceDownloadDirSync();
  draftDownloadAfterAction.value = DEFAULT_FIND_BOOK_DOWNLOAD_AFTER_ACTION;
  draftDownloadAddToMainFileList.value = true;
  draftDownloadDefaultCategory.value = DEFAULT_FIND_BOOK_DOWNLOAD_CATEGORY;
}

function resetProxyDraft() {
  draftProxyEnabled.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.enabled;
  draftProxyType.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.type;
  draftProxyHost.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.host;
  draftProxyPort.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.port;
  draftProxyUsername.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.username;
  draftProxyPassword.value = DEFAULT_FIND_BOOK_PROXY_SETTINGS.password;
}

function resetWebDavDraft() {
  draftWebDavEnabled.value = false;
  draftWebDavUrl.value = "";
  draftWebDavUsername.value = "";
  draftWebDavPassword.value = "";
  draftWebDavRemoteDir.value = "ColorTxt";
}

function resetReadingDraft() {
  draftFontSize.value = defaultReaderFontSize;
  draftFontFamily.value = READER_EDITOR_DEFAULT_FONT_FAMILY;
  draftLineHeightMultiple.value = defaultReaderLineHeightMultiple;
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
}

function resetEditDraft() {
  draftReaderEditShowLineNumbers.value = defaultReaderEditShowLineNumbers;
  draftReaderEditMinimap.value = defaultReaderEditMinimap;
}

function resetVoiceReadDraft() {
  voiceReadPanelRef.value?.resetCurrentVoiceReadProfile?.();
}

function onResetCurrentTab() {
  if (activeTab.value === "download") resetDownloadDraft();
  else if (activeTab.value === "edit") resetEditDraft();
  else if (activeTab.value === "proxy") resetProxyDraft();
  else if (activeTab.value === "webDav") resetWebDavDraft();
  else if (activeTab.value === "voiceRead") resetVoiceReadDraft();
  else resetReadingDraft();
}

function onCancel() {
  voiceReadPanelRef.value?.cancelPreview?.();
  modelValue.value = false;
}

async function persistVoiceDraftToMain() {
  const profiles = normalizeVoiceReadProfilesForSave(
    draftVoiceReadProfiles.value,
  );
  const main = loadMainSettingsData();
  const prevVoice = main.voiceRead;
  const activeLocal =
    profiles.find((p) => p.id === draftActiveVoiceReadProfileId.value) ??
    profiles[0];
  const voiceReadMergedLocal = stripVoiceReadSettingsApiKeysForDisk(
    mergeVoiceReadSettings(
      activeLocal?.settings ?? draftVoiceRead.value,
    ),
  );
  const profilesForCompare = stripVoiceReadProfileApiKeysForDisk(profiles);
  const localVoicePayload: Record<string, unknown> = {
    activeProfileId: draftActiveVoiceReadProfileId.value,
    profiles: profilesForCompare,
    ...voiceReadMergedLocal,
    aiSpeakerTokenUsage: prevVoice?.aiSpeakerTokenUsage,
    aiSpeakerTokenUsageAvailable: prevVoice?.aiSpeakerTokenUsageAvailable,
  };

  try {
    const existingRes = await window.colorTxt.secrets.getVoiceReadProfileKeys();
    const existingVault = parseProfileSecretsBlob(existingRes.keys ?? "");
    const mergedSecrets = mergeVoiceReadProfileSecretsForSave(
      profiles,
      existingVault,
    );
    await window.colorTxt.secrets.setVoiceReadSecrets({
      profileKeys: serializeProfileSecretsBlob(mergedSecrets),
    });
  } catch {
    // ignore vault failures; still persist non-secret settings
  }

  const voiceDirty = !settingsPersistValuesEqual(
    localVoicePayload,
    fbReaderSettings.voiceReadPersistBaseline,
  );
  if (voiceDirty) {
    const diskVoice = migrateVoiceReadFromPersisted(
      prevVoice as PersistedVoiceReadRaw | undefined,
    );
    const mergedVoice = mergeVoiceReadProfilesForPersist({
      localProfiles: profiles,
      diskProfiles: diskVoice.profiles,
      baselineKnownIds: fbReaderSettings.getVoiceReadProfileBaselineIds(),
      localActiveProfileId: draftActiveVoiceReadProfileId.value,
      diskActiveProfileId: diskVoice.activeProfileId,
    });
    const profilesForDisk = stripVoiceReadProfileApiKeysForDisk(
      mergedVoice.profiles,
    );
    patchPersistedMainSettings({
      voiceRead: {
        activeProfileId: mergedVoice.activeProfileId,
        profiles: profilesForDisk,
        ...voiceReadMergedLocal,
        aiSpeakerTokenUsage: prevVoice?.aiSpeakerTokenUsage,
        aiSpeakerTokenUsageAvailable: prevVoice?.aiSpeakerTokenUsageAvailable,
      },
    });
    fbReaderSettings.setVoiceReadPersistBaseline(localVoicePayload);
  }

  // 本窗内存只跟本窗草稿；磁盘合并结果不灌回
  fbReaderSettings.voiceReadProfiles.value = cloneVoiceReadProfiles(profiles);
  fbReaderSettings.activeVoiceReadProfileId.value =
    draftActiveVoiceReadProfileId.value;
  const hydrated = await hydrateVoiceReadProfilesWithSecrets(
    fbReaderSettings.voiceReadProfiles.value,
    fbReaderSettings.activeVoiceReadProfileId.value,
  );
  fbReaderSettings.voiceReadSettings.value = mergeVoiceReadSettings(
    hydrated ?? activeLocal?.settings ?? draftVoiceRead.value,
  );
  fbReaderSettings.setVoiceReadProfileBaseline(
    fbReaderSettings.voiceReadProfiles.value,
  );
  draftVoiceReadProfiles.value = cloneVoiceReadProfiles(
    fbReaderSettings.voiceReadProfiles.value,
  );
  draftActiveVoiceReadProfileId.value =
    fbReaderSettings.activeVoiceReadProfileId.value;
  draftVoiceRead.value = mergeVoiceReadSettings(
    fbReaderSettings.voiceReadSettings.value,
  );
}

async function onConfirm() {
  voiceReadPanelRef.value?.finalizeVoiceReadProfiles?.();
  if (voiceReadDashScopeRequiresApiKey(draftVoiceRead.value)) {
    await appAlert("「语音朗读」阿里云通义（DashScope）需要 API 密钥");
    return;
  }

  fb.cacheDir.value = draftCacheDir.value.trim();
  fb.downloadDir.value = draftDownloadDir.value.trim();
  fb.downloadAfterAction.value = draftDownloadAfterAction.value;
  fb.downloadAddToMainFileList.value = draftDownloadAddToMainFileList.value;
  fb.downloadDefaultCategory.value = draftDownloadDefaultCategory.value.trim();
  fb.proxy.value = {
    enabled: draftProxyEnabled.value,
    type: draftProxyType.value,
    host: draftProxyHost.value.trim(),
    port: draftProxyPort.value.trim(),
    username: draftProxyUsername.value.trim(),
    password: draftProxyPassword.value,
  };
  fb.readerFontSize.value = draftFontSize.value;
  fb.monacoFontFamily.value =
    draftFontFamily.value.trim() || fb.monacoFontFamily.value;
  fb.readerLineHeightMultiple.value = clampFindBookReaderLineHeight(
    draftFontSize.value,
    draftLineHeightMultiple.value,
  );
  fb.readerLineSpacingPx.value = clampLineSpacingPx(draftLineSpacingPx.value);
  fb.readerLetterSpacingPx.value = clampLetterSpacingPx(
    draftLetterSpacingPx.value,
  );
  fb.readerHorizontalInsetPx.value = clampReaderHorizontalInsetPx(
    draftReaderHorizontalInsetPx.value,
  );
  fb.monacoSmoothScrolling.value = draftMonacoSmoothScrolling.value;
  fb.scrollbarTrackBehavior.value = draftScrollbarTrackBehavior.value;
  fb.monacoCjkWrapOptimize.value = draftMonacoCjkWrapOptimize.value;
  fb.mouseWheelScrollSensitivity.value = clampMouseWheelScrollSensitivity(
    draftMouseWheelScrollSensitivity.value,
  );
  fb.fastScrollSensitivity.value = clampFastScrollSensitivity(
    draftFastScrollSensitivity.value,
  );
  fb.stickyChapterTitleEnabled.value = draftStickyChapterTitleEnabled.value;
  fb.readingRulerEnabled.value = draftReadingRulerEnabled.value;
  fb.readingRulerFocusLines.value = clampReadingRulerFocusLines(
    draftReadingRulerFocusLines.value,
  );
  fb.readingRulerDimOpacity.value = clampReadingRulerDimOpacity(
    draftReadingRulerDimOpacity.value,
  );
  fb.readingRulerDimStickyTitle.value = draftReadingRulerDimStickyTitle.value;
  fb.readingRulerTransitionEnabled.value =
    draftReadingRulerTransitionEnabled.value;
  fb.markdownImageHeightPx.value = clampMarkdownImageHeightPx(
    draftMarkdownImageHeightPx.value,
  );
  fb.chapterNavToolbarEnabled.value = draftChapterNavToolbarEnabled.value;
  fb.findBookChapterAdvanceEnabled.value = draftFindBookChapterAdvanceEnabled.value;
  fb.readerEditShowLineNumbers.value = draftReaderEditShowLineNumbers.value;
  fb.readerEditMinimap.value = draftReaderEditMinimap.value;
  fb.chapterTitleBlankMode.value =
    draftChapterTitleBlankMode.value;
  fb.compressBlankKeepOneBlank.value = draftCompressBlankKeepOneBlank.value;
  fb.txtrDelimitedMatchCrossLine.value = draftTxtrDelimitedMatchCrossLine.value;
  fb.fullscreenReaderWidthPercent.value = draftFullscreenReaderWidthPercent.value;
  fb.fullscreenShowSystemTime.value = draftFullscreenShowSystemTime.value;
  fb.pomodoroSettings.value = mergePomodoroSettings({
    enabled: draftPomodoroEnabled.value,
    focusMinutes: draftPomodoroFocusMinutes.value,
    shortBreakMinutes: draftPomodoroShortBreakMinutes.value,
    longBreakMinutes: draftPomodoroLongBreakMinutes.value,
  });
  fb.timedScrollSettings.value = mergeTimedScrollSettings({
    range: draftTimedScrollRange.value,
    intervalMs: draftTimedScrollIntervalMs.value,
  });
  fb.selectionToolbarButtons.value = mergeSelectionToolbarButtons(
    draftSelectionToolbarButtons.value,
  );

  fb.persistAll();
  fb.persistReaderUiPrefs();

  try {
    await window.colorTxt.secrets.setWebDavPassword(draftWebDavPassword.value);
  } catch (e) {
    await appAlert(
      e instanceof Error ? e.message : "保存 WebDAV 密码失败",
    );
    return;
  }
  patchPersistedMainSettings({
    webDavEnabled: draftWebDavEnabled.value,
    webDavUrl: draftWebDavUrl.value.trim(),
    webDavUsername: draftWebDavUsername.value.trim(),
    webDavRemoteDir: draftWebDavRemoteDir.value.trim() || "ColorTxt",
  });

  await persistVoiceDraftToMain();

  modelValue.value = false;
  voiceReadPanelRef.value?.cancelPreview?.();
}

async function onClearCache() {
  const cleared = await confirmClearAllChapterCache({
    cacheDir: draftCacheDir.value.trim() || undefined,
  });
  if (cleared) emit("chapterCacheCleared");
}

watch(
  () => modelValue.value,
  (open) => {
    if (!open) {
      voiceReadPanelRef.value?.cancelPreview?.();
      // 保留 activeTab：同窗口再次打开设置时回到上次标签（不持久化）
      return;
    }
    void syncAllDraftsFromStores();
  },
);

/** 主界面改代理后跨窗 storage / 同窗事件会更新 fb.proxy，设置面板打开时同步草稿 */
watch(
  () => fb.proxy.value,
  () => {
    if (!modelValue.value) return;
    syncFindBookOnlyDraftFromStore();
  },
  { deep: true },
);

watch(
  () => props.initialTab,
  (tab) => {
    // 外部显式指定标签时才跳转（面板已打开，或打开瞬间写入）
    activeTab.value = tab;
  },
);

watch(activeTab, (tab, prev) => {
  if (prev === "voiceRead" && tab !== "voiceRead") {
    voiceReadPanelRef.value?.cancelPreview?.();
  }
  if (tab === "webDav") {
    void loadWebDavPasswordDraft();
  }
});

watch(draftFontSize, (size) => {
  const cap = maxLineHeightMultipleForFontSize(size);
  if (draftLineHeightMultiple.value > cap + 1e-6) {
    draftLineHeightMultiple.value = cap;
  }
});
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
      <FindBookSettingsTabBar v-model:active-tab="activeTab" />

      <div class="settingsScroll">
        <div class="settingsTabScroller">
          <div class="settingsTabContent">
            <FindBookSettingsDownloadPanel
              v-show="activeTab === 'download'"
              v-model:draft-cache-dir="draftCacheDir"
              v-model:draft-download-dir="draftDownloadDir"
              v-model:draft-download-after-action="draftDownloadAfterAction"
              v-model:draft-download-add-to-main-file-list="
                draftDownloadAddToMainFileList
              "
              v-model:draft-download-default-category="draftDownloadDefaultCategory"
              @clear-cache="onClearCache"
            />

            <SettingsReadingPanel
              v-show="activeTab === 'reading'"
              v-model:draft-font-family="draftFontFamily"
              :pinned-other-fonts="fb.pinnedOtherFonts.value"
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
              v-model:draft-sticky-chapter-title-enabled="draftStickyChapterTitleEnabled"
              v-model:draft-reading-ruler-enabled="draftReadingRulerEnabled"
              v-model:draft-reading-ruler-focus-lines="draftReadingRulerFocusLines"
              v-model:draft-reading-ruler-dim-opacity="draftReadingRulerDimOpacity"
              v-model:draft-reading-ruler-dim-sticky-title="draftReadingRulerDimStickyTitle"
              v-model:draft-reading-ruler-transition-enabled="draftReadingRulerTransitionEnabled"
              v-model:draft-markdown-image-height-px="draftMarkdownImageHeightPx"
              v-model:draft-chapter-nav-toolbar-enabled="draftChapterNavToolbarEnabled"
              v-model:draft-find-book-chapter-advance-enabled="draftFindBookChapterAdvanceEnabled"
              v-model:draft-chapter-title-blank-mode="draftChapterTitleBlankMode"
              v-model:draft-compress-blank-keep-one-blank="draftCompressBlankKeepOneBlank"
              v-model:draft-txtr-delimited-match-cross-line="draftTxtrDelimitedMatchCrossLine"
              v-model:draft-fullscreen-reader-width-percent="draftFullscreenReaderWidthPercent"
              v-model:draft-fullscreen-show-system-time="draftFullscreenShowSystemTime"
              v-model:draft-pomodoro-enabled="draftPomodoroEnabled"
              v-model:draft-pomodoro-focus-minutes="draftPomodoroFocusMinutes"
              v-model:draft-pomodoro-short-break-minutes="draftPomodoroShortBreakMinutes"
              v-model:draft-pomodoro-long-break-minutes="draftPomodoroLongBreakMinutes"
              v-model:draft-timed-scroll-range="draftTimedScrollRange"
              v-model:draft-timed-scroll-interval-ms="draftTimedScrollIntervalMs"
              v-model:draft-selection-toolbar-buttons="
                draftSelectionToolbarButtons
              "
              :show-find-target-option="false"
              :show-annotation-tools="false"
              :show-ask-ai="false"
              :show-find-book-chapter-advance-option="true"
              :monaco-custom-highlight="fb.monacoCustomHighlight.value"
              @toggle-pin-other-font="togglePinOtherFont"
              @open-dictionary-manage="showDictionaryManagePanel = true"
              @open-web-search-manage="showWebSearchManagePanel = true"
              @open-translate-manage="openTranslateManageFromSettings"
            />

            <SettingsEditPanel
              v-show="activeTab === 'edit'"
              :show-main-only-edit-options="false"
              v-model:draft-reader-edit-show-line-numbers="
                draftReaderEditShowLineNumbers
              "
              v-model:draft-reader-edit-minimap="draftReaderEditMinimap"
            />

            <SettingsVoiceReadPanel
              ref="voiceReadPanelRef"
              v-show="activeTab === 'voiceRead'"
              v-model="draftVoiceRead"
              v-model:profiles="draftVoiceReadProfiles"
              v-model:active-profile-id="draftActiveVoiceReadProfileId"
              :ai-enabled="draftAiEnabled"
              :character-roster="emptyCharacterRoster"
              @open-speak-settings="emit('openSpeakSettings')"
            />

            <FindBookSettingsProxyPanel
              v-show="activeTab === 'proxy'"
              v-model:draft-proxy-enabled="draftProxyEnabled"
              v-model:draft-proxy-type="draftProxyType"
              v-model:draft-proxy-host="draftProxyHost"
              v-model:draft-proxy-port="draftProxyPort"
              v-model:draft-proxy-username="draftProxyUsername"
              v-model:draft-proxy-password="draftProxyPassword"
              show-book-source-proxy-hint
            />

            <SettingsWebDavPanel
              v-show="activeTab === 'webDav'"
              context="findBook"
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
  <DictionaryManageModal
    v-model="showDictionaryManagePanel"
    :settings="fb.dictionarySettings.value"
    @update:settings="
      (v: DictionarySettings) => {
        fb.dictionarySettings.value = mergeDictionarySettings(v);
        fb.persistReaderUiPrefs();
      }
    "
  />
  <WebSearchManageModal
    v-model="showWebSearchManagePanel"
    :settings="fb.webSearchSettings.value"
    @update:settings="
      (v: WebSearchSettings) => {
        fb.webSearchSettings.value = mergeWebSearchSettings(v);
        fb.persistReaderUiPrefs();
      }
    "
  />
  <TranslateManageModal
    v-model="showTranslateManagePanel"
    :settings="fb.translationSettings.value"
    @update:settings="onTranslationSettingsUpdate"
  />
</template>

<style>
.settingsPanelModal {
  height: min(640px, calc(100vh - 48px));
}
</style>

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

.settingsTabScroller {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 16px 8px 8px 0;
}

.settingsTabContent {
  box-sizing: border-box;
}

.settingsFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.settingsFooterStart {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settingsFooterActions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: auto;
}
</style>
