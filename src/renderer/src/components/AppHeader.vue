<script setup lang="ts">
import { computed } from "vue";
import IconButton from "./IconButton.vue";
import MinimalistViewButton from "./MinimalistViewButton.vue";
import MoreMenu from "./MoreMenu.vue";
import HeaderFontToolbar from "./HeaderFontToolbar.vue";
import HeaderFormatToolbar from "./HeaderFormatToolbar.vue";
import { useAppHeaderLayout } from "../composables/useAppHeaderLayout";
import { icons } from "../icons";
import {
  readingRulerButtonTitle,
  readerClickModeButtonTitle,
  readerClickModeButtonTitleWithRuler,
  readerSelectModeButtonTitle,
  readerSelectModeButtonTitleWithRuler,
} from "../constants/appUi";
import type { ShortcutBindingMap } from "../services/shortcutRegistry";
import { titleWithShortcut } from "../services/shortcutUtils";
import type {
  TextConvertWidthMode,
  TextConvertZhMode,
} from "@shared/textConvertTypes";

/** 仅路径；阅读进度由 `file.meta` 提供（菜单侧由父组件合并） */
export type RecentFileItem = { path: string; progress?: number };

const props = withDefaults(
  defineProps<{
    currentTheme: string;
    canIncreaseFont: boolean;
    canDecreaseFont: boolean;
    canIncreaseLineHeight: boolean;
    canDecreaseLineHeight: boolean;
    readerFontSize: number;
    readerLineHeightMultiple: number;
    monacoFontFamily: string;
    /** 钉在外层列表的「其他字体」 */
    pinnedOtherFonts?: string[];
    /** Monaco 高级换行策略（wrappingStrategy: advanced）是否开启 */
    monacoAdvancedWrapping: boolean;
    /** Monaco 自定义语法着色是否开启 */
    monacoCustomHighlight: boolean;
    /** 有启用中的文本替换规则时工具栏按钮为激活态 */
    textReplaceActive?: boolean;
    /** 是否在加载时过滤空行 */
    compressBlankLines: boolean;
    /** 是否将正文行首统一为两个全角空格（章节标题与空行除外） */
    leadIndentFullWidth: boolean;
    /** 阅读模式：简繁展示转换 */
    textConvertZh?: TextConvertZhMode;
    textConvertLetter?: TextConvertWidthMode;
    textConvertDigit?: TextConvertWidthMode;
    /** 当前是否处于全屏阅读（全屏浮动顶栏为 true，用于全屏按钮图标与提示） */
    inFullscreen?: boolean;
    /** 当前是否处于极简视图（顶栏极简按钮激活态 / 浮动顶栏浮层标记） */
    inMinimalist?: boolean;
    /** 最近打开的文件（含阅读进度），最多 20 条 */
    recentFiles?: RecentFileItem[];
    /** 书钉是否已记录阅读位置 */
    pinActive?: boolean;
    /** 是否允许钉住（无文件、加载中或空文件时为 false） */
    canPin?: boolean;
    bookmarkActive?: boolean;
    canBookmark?: boolean;
    /** 语音朗读模式已开启 */
    voiceReadActive?: boolean;
    canVoiceRead?: boolean;
    /** 定时滚动已开启 */
    timedScrollActive?: boolean;
    canTimedScroll?: boolean;
    /** 朗读模式中：禁用编辑/字体/行间距/压缩空行/缩进/高级换行 */
    voiceReadHeaderLocked?: boolean;
    /** 阅读器是否处于可编辑模式 */
    readerEditMode: boolean;
    /** 阅读器点击翻页模式（false = 可选模式）；传入生效值（含按住 Alt 的临时反转） */
    readerClickMode?: boolean;
    /** 按住 Alt 临时切换交互模式 */
    readerClickModeAltHeld?: boolean;
    /** 阅读尺（聚焦行淡化） */
    readingRulerEnabled?: boolean;
    /** 是否允许进入编辑（有文件且加载完成等，由父组件计算） */
    canEnterReaderEditMode: boolean;
    /** 与快捷键面板、按键处理一致，用于「更多」菜单旁展示的快捷键 */
    shortcutBindings: ShortcutBindingMap;
    canEnterStealth?: boolean;
    /** Markdown 文件：禁用章节正则规则（使用 # 标题） */
    chapterRulesDisabled?: boolean;
    aiFeaturesEnabled?: boolean;
    canUseAiSmartFormat?: boolean;
    aiSmartFormatRunning?: boolean;
    /** 智能排版 Diff 预览中：禁止退出编辑模式 */
    smartFormatReviewActive?: boolean;
    /** 整文件写盘中：禁用保存按钮 */
    readerFileSaving?: boolean;
  }>(),
  {
    inFullscreen: false,
    inMinimalist: false,
    recentFiles: () => [],
    pinActive: false,
    canPin: true,
    bookmarkActive: false,
    canBookmark: true,
    voiceReadActive: false,
    canVoiceRead: true,
    timedScrollActive: false,
    canTimedScroll: true,
    voiceReadHeaderLocked: false,
    readerEditMode: false,
    readerClickMode: false,
    readerClickModeAltHeld: false,
    readingRulerEnabled: false,
    canEnterReaderEditMode: false,
    canEnterStealth: false,
    chapterRulesDisabled: false,
    textReplaceActive: false,
    aiFeaturesEnabled: false,
    canUseAiSmartFormat: false,
    aiSmartFormatRunning: false,
    smartFormatReviewActive: false,
    readerFileSaving: false,
    pinnedOtherFonts: () => [],
    textConvertZh: "off",
    textConvertLetter: "off",
    textConvertDigit: "off",
  },
);

const emit = defineEmits<{
  openFile: [];
  changeTheme: [theme: string];
  toggleMinimalist: [];
  toggleFullscreen: [];
  setMonacoFont: [fontFamily: string];
  togglePinOtherFont: [fontName: string];
  increaseFontSize: [];
  decreaseFontSize: [];
  increaseLineHeight: [];
  decreaseLineHeight: [];
  toggleCompressBlankLines: [];
  toggleLeadIndentFullWidth: [];
  /** 编辑模式：对当前全文执行压缩空行 */
  formatEditCompressBlankLines: [];
  /** 编辑模式：对当前全文执行行首缩进 */
  formatEditLeadIndentFullWidth: [];
  selectTextConvertZhRead: [mode: TextConvertZhMode];
  selectTextConvertLetterRead: [mode: TextConvertWidthMode];
  selectTextConvertDigitRead: [mode: TextConvertWidthMode];
  applyTextConvertZhEdit: [mode: Exclude<TextConvertZhMode, "off">];
  applyTextConvertLetterEdit: [mode: Exclude<TextConvertWidthMode, "off">];
  applyTextConvertDigitEdit: [mode: Exclude<TextConvertWidthMode, "off">];
  toggleMonacoAdvancedWrapping: [];
  toggleMonacoCustomHighlight: [];
  toggleFind: [];
  openChapterRules: [];
  openTextReplace: [];
  openGithub: [];
  checkForUpdates: [];
  openShortcuts: [];
  openSettings: [];
  openColorScheme: [];
  openFindBook: [];
  enterStealthReader: [];
  openNewWindow: [];
  openAbout: [];
  quitApp: [];
  openRecentFile: [filePath: string];
  clearRecentFiles: [];
  pinClick: [];
  goBackFromPin: [];
  bookmarkClick: [];
  toggleReaderEdit: [];
  toggleReaderClickMode: [];
  toggleReadingRuler: [];
  saveReaderFile: [];
  aiSmartFormatFull: [];
  voiceReadToggle: [];
  timedScrollToggle: [];
}>();

const vrFormatLock = computed(() => props.voiceReadHeaderLocked);
const isMacPlatform = /mac|iphone|ipad|ipod/i.test(navigator.platform || "");
function titleAccel(
  label: string,
  action: keyof ShortcutBindingMap,
): string {
  return titleWithShortcut(
    label,
    props.shortcutBindings[action],
    isMacPlatform,
  );
}
const themeToggleTitle = computed(() =>
  titleAccel(
    props.currentTheme === "vs"
      ? "当前亮色，点击切换暗色"
      : "当前暗色，点击切换亮色",
    "toggleTheme",
  ),
);
const editModeTitle = computed(() => {
  if (props.smartFormatReviewActive) return "排版预览中，请先应用或放弃";
  return titleAccel("编辑模式", "toggleReaderEdit");
});
const readingRulerTitle = computed(() =>
  props.voiceReadActive
    ? `${readingRulerButtonTitle}\n\n语音朗读中不可使用阅读尺`
    : readingRulerButtonTitle,
);
const readingRulerRuntimeOn = computed(
  () => props.readingRulerEnabled === true && !props.voiceReadActive,
);
const bookmarkTitle = computed(() =>
  titleAccel(
    props.bookmarkActive ? "移除书签" : "添加书签",
    "toggleBookmark",
  ),
);
const chapterRulesTitle = computed(() => {
  if (props.chapterRulesDisabled) return "Markdown 文件使用 # 标题识别章节";
  return titleAccel("章节匹配规则", "openChapterRules");
});
const fullscreenTitle = computed(() =>
  titleAccel(
    props.inFullscreen ? "退出全屏" : "全屏阅读",
    "toggleFullscreen",
  ),
);
const readerClickModeTitle = computed(() =>
  props.readerClickMode
    ? readingRulerRuntimeOn.value
      ? readerClickModeButtonTitleWithRuler
      : readerClickModeButtonTitle
    : readingRulerRuntimeOn.value
      ? readerSelectModeButtonTitleWithRuler
      : readerSelectModeButtonTitle,
);
const readerClickModeAriaLabel = computed(() => {
  const base = props.readerClickMode
    ? "当前为「点击模式」，点击切换「可选模式」"
    : "当前为「可选模式」，点击切换「点击模式」";
  return props.readerClickModeAltHeld ? `${base}（按住 Alt 临时）` : base;
});

const { compactFontToolbar, compactFormatToolbar } = useAppHeaderLayout();

const showFontToolbarInHeader = computed(() => !compactFontToolbar.value);
const showFormatToolbarInHeader = computed(() => !compactFormatToolbar.value);
const showFontToolbarInMore = computed(() => compactFontToolbar.value);
const showFormatToolbarInMore = computed(() => compactFormatToolbar.value);
</script>

<template>
  <header class="header">
    <button class="btn primary" size="large" @click="$emit('openFile')">
      打开文件
    </button>
    <IconButton
      :icon-html="icons.edit"
      :active="readerEditMode"
      :pressed="readerEditMode"
      :title="editModeTitle"
      aria-label="切换编辑模式"
      :disabled="
        vrFormatLock ||
        smartFormatReviewActive ||
        (!readerEditMode && !canEnterReaderEditMode)
      "
      @click="emit('toggleReaderEdit')"
    />
    <span
      v-if="!readerEditMode"
      class="toolbarDivider"
      aria-hidden="true"
    ></span>
    <IconButton
      v-if="!readerEditMode"
      :icon-html="icons.readingRuler"
      :active="readingRulerRuntimeOn"
      :pressed="readingRulerRuntimeOn"
      :title="readingRulerTitle"
      aria-label="切换阅读尺"
      :disabled="voiceReadActive"
      @click="emit('toggleReadingRuler')"
    />
    <IconButton
      v-if="!readerEditMode"
      :icon-html="readerClickMode ? icons.clickMode : icons.selectMode"
      :title="readerClickModeTitle"
      :aria-label="readerClickModeAriaLabel"
      :warning="readerClickModeAltHeld"
      @click="emit('toggleReaderClickMode')"
    />
    <IconButton
      v-if="readerEditMode"
      :icon-html="icons.save"
      title="保存"
      aria-label="保存"
      :disabled="
        readerFileSaving || aiSmartFormatRunning || smartFormatReviewActive
      "
      @click="emit('saveReaderFile')"
    />
    <template
      v-if="readerEditMode && aiFeaturesEnabled && canUseAiSmartFormat"
    >
      <span class="toolbarDivider" aria-hidden="true"></span>
      <IconButton
        :icon-html="icons.aiCompose"
        title="AI 智能排版"
        aria-label="AI 智能排版"
        :disabled="vrFormatLock || aiSmartFormatRunning"
        @click="emit('aiSmartFormatFull')"
      />
    </template>
    <div class="themePicker">
      <div class="headerQuickRow">
        <IconButton
          v-if="pinActive"
          :icon-html="icons.back"
          title="回到之前记住的位置"
          aria-label="回到之前记住的位置"
          @click="emit('goBackFromPin')"
        />
        <IconButton
          :icon-html="pinActive ? icons.pinActive : icons.pin"
          :active="pinActive"
          :pressed="pinActive"
          :title="pinActive ? '清除书钉' : '书钉：记住当前的位置'"
          :aria-label="pinActive ? '清除书钉' : '书钉：记住当前的位置'"
          :disabled="!pinActive && !canPin"
          @click="emit('pinClick')"
        />
        <IconButton
          :icon-html="bookmarkActive ? icons.bookmarkActive : icons.bookmark"
          :active="bookmarkActive"
          :pressed="bookmarkActive"
          :title="bookmarkTitle"
          :aria-label="bookmarkTitle"
          :disabled="!bookmarkActive && !canBookmark"
          @click="emit('bookmarkClick')"
        />
        <span class="toolbarDivider" aria-hidden="true"></span>
        <IconButton
          class="timedScrollBtn"
          :icon-html="icons.play"
          :active="timedScrollActive"
          :pressed="timedScrollActive"
          title="定时滚动"
          aria-label="定时滚动"
          :disabled="!timedScrollActive && !canTimedScroll"
          @click="emit('timedScrollToggle')"
        />
        <IconButton
          class="voiceReadBtn"
          :icon-html="icons.reading"
          :active="voiceReadActive"
          :pressed="voiceReadActive"
          title="语音朗读"
          aria-label="语音朗读"
          :disabled="!voiceReadActive && (!canVoiceRead || timedScrollActive)"
          @click="emit('voiceReadToggle')"
        />
        <span
          v-if="showFontToolbarInHeader || showFormatToolbarInHeader"
          class="toolbarDivider"
          aria-hidden="true"
        ></span>
        <HeaderFontToolbar
          v-if="showFontToolbarInHeader"
          class="hdrLockable"
          :monaco-font-family="monacoFontFamily"
          :pinned-other-fonts="pinnedOtherFonts"
          :disabled="vrFormatLock"
          :can-increase-font="canIncreaseFont"
          :can-decrease-font="canDecreaseFont"
          :can-increase-line-height="canIncreaseLineHeight"
          :can-decrease-line-height="canDecreaseLineHeight"
          :font-size="readerFontSize"
          :line-height-multiple="readerLineHeightMultiple"
          :shortcut-bindings="shortcutBindings"
          @set-monaco-font="(fontFamily) => emit('setMonacoFont', fontFamily)"
          @toggle-pin-other-font="(fontName) => emit('togglePinOtherFont', fontName)"
          @increase-font-size="emit('increaseFontSize')"
          @decrease-font-size="emit('decreaseFontSize')"
          @increase-line-height="emit('increaseLineHeight')"
          @decrease-line-height="emit('decreaseLineHeight')"
        />
        <span
          v-if="showFontToolbarInHeader && showFormatToolbarInHeader"
          class="toolbarDivider"
          aria-hidden="true"
        ></span>
        <HeaderFormatToolbar
          v-if="showFormatToolbarInHeader"
          class="hdrLockable"
          :reader-edit-mode="readerEditMode"
          :disabled="vrFormatLock"
          :text-convert-zh="textConvertZh"
          :text-convert-letter="textConvertLetter"
          :text-convert-digit="textConvertDigit"
          :compress-blank-lines="compressBlankLines"
          :lead-indent-full-width="leadIndentFullWidth"
          :monaco-advanced-wrapping="monacoAdvancedWrapping"
          show-text-replace
          :text-replace-active="textReplaceActive"
          @select-text-convert-zh-read="emit('selectTextConvertZhRead', $event)"
          @select-text-convert-letter-read="
            emit('selectTextConvertLetterRead', $event)
          "
          @select-text-convert-digit-read="
            emit('selectTextConvertDigitRead', $event)
          "
          @apply-text-convert-zh-edit="emit('applyTextConvertZhEdit', $event)"
          @apply-text-convert-letter-edit="
            emit('applyTextConvertLetterEdit', $event)
          "
          @apply-text-convert-digit-edit="emit('applyTextConvertDigitEdit', $event)"
          @toggle-compress-blank-lines="emit('toggleCompressBlankLines')"
          @toggle-lead-indent-full-width="emit('toggleLeadIndentFullWidth')"
          @format-edit-compress-blank-lines="emit('formatEditCompressBlankLines')"
          @format-edit-lead-indent-full-width="emit('formatEditLeadIndentFullWidth')"
          @toggle-monaco-advanced-wrapping="emit('toggleMonacoAdvancedWrapping')"
          @open-text-replace="emit('openTextReplace')"
        />
      </div>
      <span class="toolbarDivider" aria-hidden="true"></span>
      <IconButton
        :icon-html="icons.regExp"
        :disabled="chapterRulesDisabled || vrFormatLock"
        :title="chapterRulesTitle"
        @click="!chapterRulesDisabled && $emit('openChapterRules')"
      />
      <IconButton
        :icon-html="icons.palette"
        multicolor
        :active="monacoCustomHighlight"
        :pressed="monacoCustomHighlight"
        title="内容上色"
        aria-label="内容上色"
        :disabled="vrFormatLock"
        @click="emit('toggleMonacoCustomHighlight')"
      />
      <IconButton
        :icon-html="currentTheme === 'vs' ? icons.light : icons.dark"
        :title="themeToggleTitle"
        :aria-label="themeToggleTitle"
        @click="$emit('changeTheme', currentTheme === 'vs' ? 'vs-dark' : 'vs')"
      />
      <MinimalistViewButton
        :minimalist="inMinimalist"
        :disabled="inFullscreen"
        :shortcut-bindings="shortcutBindings"
        @toggle-minimalist="$emit('toggleMinimalist')"
      />
      <IconButton
        :icon-html="
          inFullscreen ? icons.leaveFullscreen : icons.enterFullscreen
        "
        :title="fullscreenTitle"
        :aria-label="fullscreenTitle"
        @click="$emit('toggleFullscreen')"
      />
      <div class="moreMenuWrap">
        <MoreMenu
          :recent-files="recentFiles"
          :shortcut-bindings="shortcutBindings"
          :in-minimalist="inMinimalist"
          :in-fullscreen="inFullscreen"
          :can-enter-stealth="canEnterStealth"
          @toggle-find="emit('toggleFind')"
          @open-github="emit('openGithub')"
          @check-for-updates="emit('checkForUpdates')"
          @open-shortcuts="emit('openShortcuts')"
          @open-settings="emit('openSettings')"
          @open-color-scheme="emit('openColorScheme')"
          @open-find-book="emit('openFindBook')"
          @enter-stealth-reader="emit('enterStealthReader')"
          @open-new-window="emit('openNewWindow')"
          @open-about="emit('openAbout')"
          @quit-app="emit('quitApp')"
          @open-recent-file="(filePath) => emit('openRecentFile', filePath)"
          @clear-recent-files="emit('clearRecentFiles')"
        >
          <template
            v-if="showFontToolbarInMore || showFormatToolbarInMore"
            #toolbar
          >
            <HeaderFontToolbar
              v-if="showFontToolbarInMore"
              :monaco-font-family="monacoFontFamily"
              :pinned-other-fonts="pinnedOtherFonts"
              :disabled="vrFormatLock"
              :can-increase-font="canIncreaseFont"
              :can-decrease-font="canDecreaseFont"
              :can-increase-line-height="canIncreaseLineHeight"
              :can-decrease-line-height="canDecreaseLineHeight"
              :font-size="readerFontSize"
              :line-height-multiple="readerLineHeightMultiple"
              :shortcut-bindings="shortcutBindings"
              @set-monaco-font="(fontFamily) => emit('setMonacoFont', fontFamily)"
              @toggle-pin-other-font="
                (fontName) => emit('togglePinOtherFont', fontName)
              "
              @increase-font-size="emit('increaseFontSize')"
              @decrease-font-size="emit('decreaseFontSize')"
              @increase-line-height="emit('increaseLineHeight')"
              @decrease-line-height="emit('decreaseLineHeight')"
            />
            <HeaderFormatToolbar
              v-if="showFormatToolbarInMore"
              :reader-edit-mode="readerEditMode"
              :disabled="vrFormatLock"
              :text-convert-zh="textConvertZh"
              :text-convert-letter="textConvertLetter"
              :text-convert-digit="textConvertDigit"
              :compress-blank-lines="compressBlankLines"
              :lead-indent-full-width="leadIndentFullWidth"
              :monaco-advanced-wrapping="monacoAdvancedWrapping"
              show-text-replace
              :text-replace-active="textReplaceActive"
              @select-text-convert-zh-read="
                emit('selectTextConvertZhRead', $event)
              "
              @select-text-convert-letter-read="
                emit('selectTextConvertLetterRead', $event)
              "
              @select-text-convert-digit-read="
                emit('selectTextConvertDigitRead', $event)
              "
              @apply-text-convert-zh-edit="emit('applyTextConvertZhEdit', $event)"
              @apply-text-convert-letter-edit="
                emit('applyTextConvertLetterEdit', $event)
              "
              @apply-text-convert-digit-edit="
                emit('applyTextConvertDigitEdit', $event)
              "
              @toggle-compress-blank-lines="emit('toggleCompressBlankLines')"
              @toggle-lead-indent-full-width="emit('toggleLeadIndentFullWidth')"
              @format-edit-compress-blank-lines="
                emit('formatEditCompressBlankLines')
              "
              @format-edit-lead-indent-full-width="
                emit('formatEditLeadIndentFullWidth')
              "
              @toggle-monaco-advanced-wrapping="
                emit('toggleMonacoAdvancedWrapping')
              "
              @open-text-replace="emit('openTextReplace')"
            />
          </template>
        </MoreMenu>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  min-height: 0;
  overflow: visible;
}

.themePicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;
}

.headerQuickRow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.toolbarDivider {
  width: 1px;
  height: 22px;
  background: var(--border);
  flex-shrink: 0;
  /* margin: 0 10px; */
}

.moreMenuWrapLocked {
  pointer-events: none;
  opacity: 0.45;
}

.moreMenuToolbar :deep(.headerFontToolbar),
.moreMenuToolbar :deep(.headerFormatToolbar) {
  justify-content: center;
}

.hdrLockable {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.voiceReadBtn.iconBtn.active,
.timedScrollBtn.iconBtn.active {
  background: var(--primary);
}

.voiceReadBtn.iconBtn.active:hover,
.timedScrollBtn.iconBtn.active:hover {
  background: var(--primary-hover);
}

.voiceReadBtn.iconBtn.active :deep(.icon),
.timedScrollBtn.iconBtn.active :deep(.icon) {
  color: #ffffff;
}
</style>
