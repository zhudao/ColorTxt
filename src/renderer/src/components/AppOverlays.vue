<script setup lang="ts">
import {
  computed,
  inject,
  ref,
  type ComponentPublicInstance,
} from "vue";
import type { ChapterMatchRule } from "../chapter";
import type { AiCustomSkill, AiSkillUserOverride } from "@shared/aiSkills";
import type { VoiceReadSettings } from "../constants/voiceRead";
import type { TimedScrollSettings } from "../constants/timedScroll";
import type { PomodoroSettings } from "../constants/pomodoro";
import type { VoiceReadProfile } from "@shared/voiceReadProfiles";
import type { ChapterTitleBlankMode, ReaderBackgroundState } from "../constants/appUi";
import type { CharacterRosterEntry } from "@shared/characterTypes";
import { bookmarkNoteInputRefKey } from "../injectionKeys";
import type { FileBookmarkItem } from "../stores/fileMetaStore";
import AboutPanel from "./AboutPanel.vue";
import AppModal from "./AppModal.vue";
import ColorSchemePanel, {
  type ColorSchemeApplyPayload,
} from "./ColorSchemePanel.vue";
import AppUpdateFlow from "./AppUpdateFlow.vue";
import ChapterRulePanel from "./ChapterRulePanel.vue";
import ReadingDataPanel from "./ReadingDataPanel.vue";
import ReplaceRulePanel from "../bookSource/components/ReplaceRulePanel.vue";
import type { ReplaceRule } from "@shared/bookSource/replaceRule";
import SettingsPanel, { type SettingsApplyPayload } from "./SettingsPanel.vue";
import DictionaryManageModal from "./DictionaryManageModal.vue";
import WebSearchManageModal from "./WebSearchManageModal.vue";
import TranslateManageModal from "./TranslateManageModal.vue";
import VoiceReadSpeakSettingsPanel from "./VoiceReadSpeakSettingsPanel.vue";
import type { DictionarySettings } from "@shared/dictionaryTypes";
import type { WebSearchSettings } from "@shared/webSearchTypes";
import type { TranslationSettings } from "@shared/translationTypes";
import ShortcutPanel from "./ShortcutPanel.vue";
import type { ShortcutBindingMap } from "../services/shortcutRegistry";
import type { ReaderSurfaceColorEnabled } from "../constants/readerPalette";
import type { ReaderPalettePreset } from "../constants/readerPalettePresets";
import { readerEbookConvertingHintText, readerBookPackUnpackingHintText } from "../constants/appUi";
import LoadingDotsBounce from "./LoadingDotsBounce.vue";

const bookmarkNoteInputRef = inject(bookmarkNoteInputRefKey)!;

const props = defineProps<{
  restoreSessionOnStartup: boolean;
  syncCurrentFile: boolean;
  recentFilesHistoryLimit: number;
  chapterMinCharCount: number;
  fullscreenReaderWidthPercent: number;
  fullscreenShowSystemTime: boolean;
  readerFontSize: number;
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
  aiSmartFormat: import("@shared/aiSmartFormatTypes").AiSmartFormatSettings;
  chapterTitleBlankMode: ChapterTitleBlankMode;
  compressBlankKeepOneBlank: boolean;
  monacoCustomHighlight: boolean;
  txtrDelimitedMatchCrossLine: boolean;
  timedScrollSettings: TimedScrollSettings;
  pomodoroSettings: PomodoroSettings;
  selectionToolbarButtons: import("../constants/selectionToolbar").SelectionToolbarButtons;
  dictionarySettings: DictionarySettings;
  webSearchSettings: WebSearchSettings;
  translationSettings: import("@shared/translationTypes").TranslationSettings;
  chapterRules: ChapterMatchRule[];
  chapterRuleErrorText: string;
  /** 编辑态打开文本替换时面板主按钮为「应用」 */
  readerEditMode?: boolean;
  /** 主窗口文本替换「当前书名」建议：打开文件的文件名；无打开文件则空 */
  replaceRuleScopeBookName?: string;
  editingBookmarkLine: number | null;
  /** 编辑书签时「更新为当前行」是否可用（与顶栏书签一致：有文件、非加载、有正文行） */
  canBookmark: boolean;
  /** 添加/编辑书签弹窗：在备注框上方展示的章节名与正文预览（与侧栏书签列表逻辑一致） */
  addBookmarkDialogPreview: {
    chapterTitle?: string;
    content: string;
  } | null;
  activeBookmarkInViewport: FileBookmarkItem | null;
  dirListScanning: boolean;
  dirListCurrentName: string;
  ebookParsing: boolean;
  /** PDF 页进度，如 `12/480` */
  ebookConvertProgressText?: string;
  /** 彩读书包解包 / 解析中 */
  bookPackUnpacking?: boolean;
  shortcutBindings: ShortcutBindingMap;
  defaultShortcutBindings: ShortcutBindingMap;
  currentTheme: string;
  readerPaletteColorEnabled: ReaderSurfaceColorEnabled;
  readerPaletteUserPresets: ReaderPalettePreset[];
  readerPaletteSelectedIdLight: string;
  readerPaletteSelectedIdDark: string;
  readerBackground: ReaderBackgroundState;
  monacoFontFamily: string;
  pinnedOtherFonts: string[];
  highlightColorsLight: string[];
  highlightColorsDark: string[];
  lineationColorsLight: string[];
  lineationColorsDark: string[];
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
  /** 有可清除阅读数据的文件列表（阅读数据面板） */
  readingDataItems: {
    path: string;
    fileName: string;
    progress?: number;
    lastOpenedAt?: number;
  }[];
}>();

const emit = defineEmits<{
  applySettings: [payload: SettingsApplyPayload];
  togglePinOtherFont: [fontName: string];
  applyChapterRules: [payload: { rules: ChapterMatchRule[] }];
  confirmAddBookmark: [];
  updateBookmarkToCurrentViewportLine: [];
  confirmRemoveActiveBookmark: [];
  applyShortcutBindings: [payload: ShortcutBindingMap];
  applyColorScheme: [payload: ColorSchemeApplyPayload];
  changeTheme: [theme: string];
  applyReplaceRuleFormat: [rules: ReplaceRule[]];
  openReadingData: [];
  clearReadingDataPaths: [paths: string[]];
  clearAllReadingData: [];
  removeMissingReadingDataFiles: [];
  openReadingDataPath: [path: string];
  openDictionaryManage: [];
  openWebSearchManage: [];
  openTranslateManage: [];
  "update:dictionarySettings": [v: DictionarySettings];
  "update:webSearchSettings": [v: WebSearchSettings];
  "update:translationSettings": [v: TranslationSettings];
}>();

const showAboutPanel = defineModel<boolean>("showAboutPanel", {
  default: false,
});
const showShortcutPanel = defineModel<boolean>("showShortcutPanel", {
  default: false,
});
const showSettingsPanel = defineModel<boolean>("showSettingsPanel", {
  default: false,
});
const showChapterRulePanel = defineModel<boolean>("showChapterRulePanel", {
  default: false,
});
const showReadingDataPanel = defineModel<boolean>("showReadingDataPanel", {
  default: false,
});
const showDictionaryManagePanel = defineModel<boolean>(
  "showDictionaryManagePanel",
  {
    default: false,
  },
);
const showWebSearchManagePanel = defineModel<boolean>(
  "showWebSearchManagePanel",
  {
    default: false,
  },
);
const showTranslateManagePanel = defineModel<boolean>(
  "showTranslateManagePanel",
  {
    default: false,
  },
);
const showVoiceReadSpeakSettingsPanel = defineModel<boolean>(
  "showVoiceReadSpeakSettingsPanel",
  {
    default: false,
  },
);
const showReplaceRulePanel = defineModel<boolean>("showReplaceRulePanel", {
  default: false,
});
const showColorSchemePanel = defineModel<boolean>("showColorSchemePanel", {
  default: false,
});
const addBookmarkOpen = defineModel<boolean>("addBookmarkOpen", {
  default: false,
});
const removeBookmarkOpen = defineModel<boolean>("removeBookmarkOpen", {
  default: false,
});
const bookmarkNoteInput = defineModel<string>("bookmarkNoteInput", {
  default: "",
});

const appUpdateFlowRef = ref<InstanceType<typeof AppUpdateFlow> | null>(null);
const colorSchemePanelRef = ref<InstanceType<typeof ColorSchemePanel> | null>(
  null,
);

defineExpose({
  checkForUpdates: () => appUpdateFlowRef.value?.checkForUpdates(),
  isColorSchemeThemeLocked: () =>
    colorSchemePanelRef.value?.isThemeLocked() === true,
});

function bindBookmarkInput(el: Element | ComponentPublicInstance | null) {
  const node =
    el && typeof el === "object" && "$el" in el
      ? (el as ComponentPublicInstance).$el
      : el;
  bookmarkNoteInputRef.value = node as HTMLTextAreaElement | null;
}

function onBookmarkNoteKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  emit("confirmAddBookmark");
}

const showBusyOverlay = computed(
  () =>
    props.dirListScanning ||
    props.ebookParsing ||
    Boolean(props.bookPackUnpacking),
);

const busyOverlayText = computed(() => {
  if (props.ebookParsing) {
    const progress = props.ebookConvertProgressText?.trim();
    return progress
      ? `${readerEbookConvertingHintText} ${progress}`
      : readerEbookConvertingHintText;
  }
  if (props.bookPackUnpacking) return readerBookPackUnpackingHintText;
  return props.dirListCurrentName || "准备中";
});
</script>

<template>
  <AppUpdateFlow ref="appUpdateFlowRef" />

  <AboutPanel v-model="showAboutPanel" />
  <ShortcutPanel
    v-model="showShortcutPanel"
    panel-context="main"
    :shortcut-bindings="shortcutBindings"
    :default-shortcut-bindings="defaultShortcutBindings"
    @apply="emit('applyShortcutBindings', $event)"
  />
  <SettingsPanel
    v-model="showSettingsPanel"
    :restore-session-on-startup="restoreSessionOnStartup"
    :sync-current-file="syncCurrentFile"
    :recent-files-history-limit="recentFilesHistoryLimit"
    :chapter-min-char-count="chapterMinCharCount"
    :fullscreen-reader-width-percent="fullscreenReaderWidthPercent"
    :fullscreen-show-system-time="fullscreenShowSystemTime"
    :reader-font-size="readerFontSize"
    :monaco-font-family="monacoFontFamily"
    :pinned-other-fonts="pinnedOtherFonts"
    :reader-line-height-multiple="readerLineHeightMultiple"
    :reader-line-spacing-px="readerLineSpacingPx"
    :reader-letter-spacing-px="readerLetterSpacingPx"
    :reader-horizontal-inset-px="readerHorizontalInsetPx"
    :monaco-smooth-scrolling="monacoSmoothScrolling"
    :scrollbar-track-behavior="scrollbarTrackBehavior"
    :monaco-cjk-wrap-optimize="monacoCjkWrapOptimize"
    :mouse-wheel-scroll-sensitivity="mouseWheelScrollSensitivity"
    :fast-scroll-sensitivity="fastScrollSensitivity"
    :sticky-chapter-title-enabled="stickyChapterTitleEnabled"
    :reading-ruler-enabled="readingRulerEnabled"
    :reading-ruler-focus-lines="readingRulerFocusLines"
    :reading-ruler-dim-opacity="readingRulerDimOpacity"
    :reading-ruler-dim-sticky-title="readingRulerDimStickyTitle"
    :reading-ruler-transition-enabled="readingRulerTransitionEnabled"
    :markdown-image-height-px="markdownImageHeightPx"
    :chapter-nav-toolbar-enabled="chapterNavToolbarEnabled"
    :chapter-char-count-exact="chapterCharCountExact"
    :reader-edit-show-line-numbers="readerEditShowLineNumbers"
    :reader-edit-minimap="readerEditMinimap"
    :edit-auto-refresh-chapter-list="editAutoRefreshChapterList"
    :ai-smart-format="aiSmartFormat"
    :chapter-title-blank-mode="chapterTitleBlankMode"
    :compress-blank-keep-one-blank="compressBlankKeepOneBlank"
    :monaco-custom-highlight="monacoCustomHighlight"
    :txtr-delimited-match-cross-line="txtrDelimitedMatchCrossLine"
    :timed-scroll-settings="timedScrollSettings"
    :pomodoro-settings="pomodoroSettings"
    :selection-toolbar-buttons="selectionToolbarButtons"
    :ebook-convert-output-dir="ebookConvertOutputDir"
    :book-pack-unpack-dir="bookPackUnpackDir"
    :book-pack-password="bookPackPassword"
    :web-dav-enabled="webDavEnabled"
    :web-dav-url="webDavUrl"
    :web-dav-username="webDavUsername"
    :web-dav-remote-dir="webDavRemoteDir"
    :character-portrait-cache-dir="characterPortraitCacheDir"
    :ai-skills-enabled="aiSkillsEnabled"
    :ai-skill-overrides="aiSkillOverrides"
    :ai-custom-skills="aiCustomSkills"
    :voice-read-settings="voiceReadSettings"
    :voice-read-profiles="voiceReadProfiles"
    :active-voice-read-profile-id="activeVoiceReadProfileId"
    :character-roster="characterRoster"
    @apply="emit('applySettings', $event)"
    @toggle-pin-other-font="emit('togglePinOtherFont', $event)"
    @open-reading-data="emit('openReadingData')"
    @open-dictionary-manage="emit('openDictionaryManage')"
    @open-web-search-manage="emit('openWebSearchManage')"
    @open-translate-manage="emit('openTranslateManage')"
    @open-speak-settings="showVoiceReadSpeakSettingsPanel = true"
  />
  <VoiceReadSpeakSettingsPanel v-model="showVoiceReadSpeakSettingsPanel" />
  <DictionaryManageModal
    v-model="showDictionaryManagePanel"
    :settings="dictionarySettings"
    @update:settings="emit('update:dictionarySettings', $event)"
  />
  <WebSearchManageModal
    v-model="showWebSearchManagePanel"
    :settings="webSearchSettings"
    @update:settings="emit('update:webSearchSettings', $event)"
  />
  <TranslateManageModal
    v-model="showTranslateManagePanel"
    :settings="translationSettings"
    @update:settings="emit('update:translationSettings', $event)"
  />
  <ReadingDataPanel
    v-model="showReadingDataPanel"
    :items="readingDataItems"
    @clear-paths="emit('clearReadingDataPaths', $event)"
    @clear-all-reading-data="emit('clearAllReadingData')"
    @remove-missing-files="emit('removeMissingReadingDataFiles')"
    @open-path="emit('openReadingDataPath', $event)"
  />
  <ChapterRulePanel
    v-model="showChapterRulePanel"
    :rules="chapterRules"
    :error-text="chapterRuleErrorText"
    @apply="emit('applyChapterRules', $event)"
  />
  <ReplaceRulePanel
    v-model="showReplaceRulePanel"
    bucket="app"
    :edit-format-mode="readerEditMode === true"
    :scope-book-name="replaceRuleScopeBookName ?? ''"
    @apply-format="emit('applyReplaceRuleFormat', $event)"
  />

  <ColorSchemePanel
    ref="colorSchemePanelRef"
    v-model="showColorSchemePanel"
    :current-theme="currentTheme"
    :reader-palette-color-enabled="readerPaletteColorEnabled"
    :reader-palette-user-presets="readerPaletteUserPresets"
    :reader-palette-selected-id-light="readerPaletteSelectedIdLight"
    :reader-palette-selected-id-dark="readerPaletteSelectedIdDark"
    :reader-background="readerBackground"
    :monaco-font-family="monacoFontFamily"
    :highlight-colors-light="highlightColorsLight"
    :highlight-colors-dark="highlightColorsDark"
    :lineation-colors-light="lineationColorsLight"
    :lineation-colors-dark="lineationColorsDark"
    @apply="emit('applyColorScheme', $event)"
    @change-theme="emit('changeTheme', $event)"
  />

  <AppModal
    v-model="addBookmarkOpen"
    :title="editingBookmarkLine == null ? '添加书签' : '编辑书签'"
    max-width="480px"
  >
    <div class="bookmarkModalBody">
      <div v-if="addBookmarkDialogPreview" class="bookmarkModalPreview">
        <div
          v-if="addBookmarkDialogPreview.chapterTitle"
          class="bookmarkModalChapter"
          :title="addBookmarkDialogPreview.chapterTitle"
        >
          {{ addBookmarkDialogPreview.chapterTitle }}
        </div>
        <div
          class="bookmarkModalExcerpt"
          :class="{
            bookmarkModalExcerptPlaceholder:
              !addBookmarkDialogPreview.content.trim(),
          }"
          :title="addBookmarkDialogPreview.content.trim() || undefined"
        >
          {{ addBookmarkDialogPreview.content.trim() || "（空行）" }}
        </div>
      </div>
      <textarea
        :ref="bindBookmarkInput"
        v-model="bookmarkNoteInput"
        class="bookmarkNoteInput"
        rows="3"
        wrap="soft"
        placeholder="输入备注（可选）"
        @keydown="onBookmarkNoteKeydown"
      />
    </div>
    <template #footer>
      <div class="bookmarkModalFooter">
        <div class="bookmarkModalFooterStart">
          <button
            v-if="editingBookmarkLine != null"
            type="button"
            class="btn"
            size="large"
            :disabled="!canBookmark"
            @click="emit('updateBookmarkToCurrentViewportLine')"
          >
            更新为当前行
          </button>
        </div>
        <div class="bookmarkModalFooterEnd">
          <button class="btn" size="large" @click="addBookmarkOpen = false">
            取消
          </button>
          <button
            class="btn primary"
            size="large"
            @click="emit('confirmAddBookmark')"
          >
            {{ editingBookmarkLine == null ? "添加" : "保存" }}
          </button>
        </div>
      </div>
    </template>
  </AppModal>

  <AppModal v-model="removeBookmarkOpen" title="移除书签" max-width="480px">
    <div class="bookmarkModalBody">
      <p class="bookmarkModalText">
        {{ activeBookmarkInViewport?.note || "无备注" }}
      </p>
    </div>
    <template #footer>
      <div class="bookmarkModalFooter">
        <button class="btn" size="large" @click="removeBookmarkOpen = false">
          取消
        </button>
        <button
          class="btn danger"
          size="large"
          @click="emit('confirmRemoveActiveBookmark')"
        >
          移除
        </button>
      </div>
    </template>
  </AppModal>

  <Transition name="dirScanOverlay">
    <div
      v-if="showBusyOverlay"
      class="dirScanOverlay"
      aria-live="polite"
      aria-busy="true"
    >
      <p class="dirScanLine" :title="dirListCurrentName">
        <span class="dirScanHint">
          {{ busyOverlayText }}<LoadingDotsBounce />
        </span>
      </p>
    </div>
  </Transition>
</template>

<style scoped>
.dirScanOverlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.dirScanLine {
  margin: 0;
  max-width: min(92vw, 720px);
  padding: 6px 10px;
  border-radius: 4px;
  background-color: var(--bg);
  color: var(--fg);
  font-size: 12px;
  text-align: center;
}

.dirScanHint {
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
}

.dirScanOverlay-enter-active,
.dirScanOverlay-leave-active {
  transition: opacity 0.2s ease;
}

.dirScanOverlay-enter-from,
.dirScanOverlay-leave-to {
  opacity: 0;
}

.bookmarkModalBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.bookmarkModalPreview {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  width: 100%;
  color: var(--list-item-fg);
}

.bookmarkModalChapter {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  opacity: 0.78;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  width: 100%;
  color: var(--list-item-fg);
}

.bookmarkModalExcerpt {
  margin: 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  font-size: 11px;
  font-style: italic;
  line-height: 1.35;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--list-item-fg);
}

.bookmarkModalExcerpt.bookmarkModalExcerptPlaceholder {
  opacity: 0.42;
}

.bookmarkModalText {
  margin: 0;
  font-size: 13px;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.bookmarkNoteInput {
  width: 100%;
  font-size: 14px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.bookmarkModalFooter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}

.bookmarkModalFooterEnd {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}
</style>
