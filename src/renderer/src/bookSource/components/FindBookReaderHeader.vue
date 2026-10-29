<script setup lang="ts">
import { computed, ref } from "vue";
import IconButton from "../../components/IconButton.vue";
import MinimalistViewButton from "../../components/MinimalistViewButton.vue";
import HeaderFontToolbar from "../../components/HeaderFontToolbar.vue";
import HeaderFormatToolbar from "../../components/HeaderFormatToolbar.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import { useAppHeaderLayout } from "../../composables/useAppHeaderLayout";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import {
  FIND_BOOK_READER_COMPACT_FONT_BREAKPOINT,
  FIND_BOOK_READER_COMPACT_FORMAT_BREAKPOINT,
} from "../../constants/appHeaderLayout";
import { icons } from "../../icons";
import {
  readingRulerButtonTitle,
  readerClickModeButtonTitle,
  readerClickModeButtonTitleWithRuler,
  readerSelectModeButtonTitle,
  readerSelectModeButtonTitleWithRuler,
} from "../../constants/appUi";
import type {
  TextConvertWidthMode,
  TextConvertZhMode,
} from "@shared/textConvertTypes";
import type { ShortcutBindingMap } from "../../services/shortcutRegistry";
import { titleWithShortcut, acceleratorToDisplayText } from "../../services/shortcutUtils";

const props = withDefaults(
  defineProps<{
    currentTheme: string;
    inFullscreen?: boolean;
    inMinimalist?: boolean;
    canIncreaseFont: boolean;
    canDecreaseFont: boolean;
    canIncreaseLineHeight: boolean;
    canDecreaseLineHeight: boolean;
    readerFontSize: number;
    readerLineHeightMultiple: number;
    monacoFontFamily: string;
    pinnedOtherFonts?: string[];
    monacoAdvancedWrapping: boolean;
    monacoCustomHighlight: boolean;
    compressBlankLines: boolean;
    leadIndentFullWidth: boolean;
    textConvertZh?: TextConvertZhMode;
    textConvertLetter?: TextConvertWidthMode;
    textConvertDigit?: TextConvertWidthMode;
    voiceReadActive?: boolean;
    canVoiceRead?: boolean;
    timedScrollActive?: boolean;
    canTimedScroll?: boolean;
    voiceReadHeaderLocked?: boolean;
    inBookshelf?: boolean;
    /** 设置菜单项右侧快捷键文案（如 F5） */
    settingsShortcutLabel?: string;
    /** 配色菜单项右侧快捷键文案（如 F6） */
    colorSchemeShortcutLabel?: string;
    /** 查找菜单项右侧快捷键文案 */
    findShortcutLabel?: string;
    /** 切换主题色按钮 title 中的快捷键文案（如 F2） */
    themeShortcutLabel?: string;
    readerEditMode?: boolean;
    /** 阅读器点击翻页模式（false = 可选模式）；传入生效值（含按住 Alt 的临时反转） */
    readerClickMode?: boolean;
    /** 按住 Alt 临时切换交互模式 */
    readerClickModeAltHeld?: boolean;
    /** 阅读尺（聚焦行淡化） */
    readingRulerEnabled?: boolean;
    canEnterReaderEditMode?: boolean;
    /** 保存章节缓存中 */
    readerChapterSaving?: boolean;
    /** 有已启用的文本替换规则时工具栏按钮为激活态 */
    textReplaceActive?: boolean;
    /** 当前有正文可进入摸鱼模式 */
    canEnterStealth?: boolean;
    shortcutBindings: ShortcutBindingMap;
  }>(),
  {
    inFullscreen: false,
    inMinimalist: false,
    pinnedOtherFonts: () => [],
    textConvertZh: "off",
    textConvertLetter: "off",
    textConvertDigit: "off",
    voiceReadActive: false,
    canVoiceRead: true,
    timedScrollActive: false,
    canTimedScroll: true,
    voiceReadHeaderLocked: false,
    inBookshelf: false,
    settingsShortcutLabel: "",
    colorSchemeShortcutLabel: "",
    findShortcutLabel: "",
    themeShortcutLabel: "",
    readerEditMode: false,
    readerClickMode: false,
    readerClickModeAltHeld: false,
    readingRulerEnabled: false,
    canEnterReaderEditMode: false,
    readerChapterSaving: false,
    textReplaceActive: false,
    canEnterStealth: false,
  },
);

const emit = defineEmits<{
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
  formatEditCompressBlankLines: [];
  formatEditLeadIndentFullWidth: [];
  selectTextConvertZhRead: [mode: TextConvertZhMode];
  selectTextConvertLetterRead: [mode: TextConvertWidthMode];
  selectTextConvertDigitRead: [mode: TextConvertWidthMode];
  applyTextConvertZhEdit: [mode: Exclude<TextConvertZhMode, "off">];
  applyTextConvertLetterEdit: [mode: Exclude<TextConvertWidthMode, "off">];
  applyTextConvertDigitEdit: [mode: Exclude<TextConvertWidthMode, "off">];
  toggleMonacoAdvancedWrapping: [];
  toggleMonacoCustomHighlight: [];
  voiceReadToggle: [];
  timedScrollToggle: [];
  openSettings: [];
  openColorScheme: [];
  toggleFind: [];
  toggleBookshelf: [];
  toggleReaderEdit: [];
  toggleReaderClickMode: [];
  toggleReadingRuler: [];
  saveReaderChapter: [];
  openTextReplace: [];
  enterStealthReader: [];
}>();

const vrFormatLock = computed(() => props.voiceReadHeaderLocked);
const isMacPlatform = /mac|iphone|ipad|ipod/i.test(navigator.platform || "");
const themeToggleTitle = computed(() =>
  titleWithShortcut(
    props.currentTheme === "vs"
      ? "当前亮色，点击切换暗色"
      : "当前暗色，点击切换亮色",
    props.shortcutBindings.toggleTheme,
    isMacPlatform,
  ),
);
const editModeTitle = computed(() =>
  titleWithShortcut(
    "编辑模式",
    props.shortcutBindings.toggleReaderEdit,
    isMacPlatform,
  ),
);
const readingRulerTitle = computed(() =>
  props.voiceReadActive
    ? `${readingRulerButtonTitle}\n\n语音朗读中不可使用阅读尺`
    : readingRulerButtonTitle,
);
const readingRulerRuntimeOn = computed(
  () => props.readingRulerEnabled === true && !props.voiceReadActive,
);
const fullscreenTitle = computed(() =>
  titleWithShortcut(
    props.inFullscreen ? "退出全屏" : "全屏阅读",
    props.shortcutBindings.toggleFullscreen,
    isMacPlatform,
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
const { compactFontToolbar, compactFormatToolbar } = useAppHeaderLayout({
  compactFontBreakpoint: FIND_BOOK_READER_COMPACT_FONT_BREAKPOINT,
  compactFormatBreakpoint: FIND_BOOK_READER_COMPACT_FORMAT_BREAKPOINT,
});
const showFontToolbarInHeader = computed(() => !compactFontToolbar.value);
const showFormatToolbarInHeader = computed(() => !compactFormatToolbar.value);
const showToolbarInMoreMenu = computed(
  () => compactFontToolbar.value || compactFormatToolbar.value,
);
const bookshelfBtnLabel = computed(() =>
  props.inBookshelf ? "从书架移除" : "放入书架",
);

const moreBtnRef = ref<HTMLElement | null>(null);
const moreMenu = useAnchoredAppShellMenu({
  anchor: moreBtnRef,
  placement: "below-end",
  widthPx: 320,
  gap: 6,
});
const {
  open: moreMenuOpen,
  left: moreMenuLeft,
  top: moreMenuTop,
  toggleMenu: toggleMoreMenu,
  closeMenu: closeMoreMenu,
  panelRef: moreMenuPanelRef,
  availableMaxHeight: moreMenuMaxHeight,
} = moreMenu;

function bindMoreMenuPanel(el: HTMLElement | null) {
  moreMenuPanelRef.value = el;
}

function onOpenSettingsFromToolbar() {
  closeMoreMenu();
  emit("openSettings");
}

function onOpenColorSchemeFromToolbar() {
  closeMoreMenu();
  emit("openColorScheme");
}

function onToggleFindFromToolbar() {
  closeMoreMenu();
  emit("toggleFind");
}

function onOpenTextReplace() {
  closeMoreMenu();
  emit("openTextReplace");
}

function onEnterStealthReader() {
  closeMoreMenu();
  emit("enterStealthReader");
}

const stealthShortcutLabel = computed(() =>
  acceleratorToDisplayText(
    props.shortcutBindings.enterStealthReader,
    isMacPlatform,
  ),
);
</script>

<template>
  <header class="findBookReaderHeader">
    <div class="findBookReaderHeaderStart">
      <button
        type="button"
        class="btn findBookReaderBookshelfBtn"
        size="large"
        :class="{ 'findBookReaderBookshelfBtn--remove': inBookshelf }"
        :aria-label="bookshelfBtnLabel"
        @click="emit('toggleBookshelf')"
      >
        <span
          class="findBookReaderBookshelfBtnIcon"
          aria-hidden="true"
          v-html="icons.bookshelf"
        />
        {{ bookshelfBtnLabel }}
      </button>
      <IconButton
        :icon-html="icons.edit"
        :active="readerEditMode"
        :pressed="readerEditMode"
        :title="editModeTitle"
        :aria-label="editModeTitle"
        :disabled="!readerEditMode && !canEnterReaderEditMode"
        @click="emit('toggleReaderEdit')"
      />
      <span
        v-if="!readerEditMode"
        class="toolbarDivider"
        aria-hidden="true"
      />
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
        title="保存到缓存"
        aria-label="保存到缓存"
        :disabled="readerChapterSaving"
        @click="emit('saveReaderChapter')"
      />
    </div>
    <div class="themePicker">
      <div class="headerQuickRow">
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
        />
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
        />
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
          @select-text-convert-letter-read="emit('selectTextConvertLetterRead', $event)"
          @select-text-convert-digit-read="emit('selectTextConvertDigitRead', $event)"
          @apply-text-convert-zh-edit="emit('applyTextConvertZhEdit', $event)"
          @apply-text-convert-letter-edit="emit('applyTextConvertLetterEdit', $event)"
          @apply-text-convert-digit-edit="emit('applyTextConvertDigitEdit', $event)"
          @toggle-compress-blank-lines="emit('toggleCompressBlankLines')"
          @toggle-lead-indent-full-width="emit('toggleLeadIndentFullWidth')"
          @format-edit-compress-blank-lines="emit('formatEditCompressBlankLines')"
          @format-edit-lead-indent-full-width="emit('formatEditLeadIndentFullWidth')"
          @toggle-monaco-advanced-wrapping="emit('toggleMonacoAdvancedWrapping')"
          @open-text-replace="onOpenTextReplace"
        />
        <span class="toolbarDivider" aria-hidden="true" />
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
          @click="emit('changeTheme', currentTheme === 'vs' ? 'vs-dark' : 'vs')"
        />
        <MinimalistViewButton
          :minimalist="inMinimalist"
          :disabled="inFullscreen"
          :shortcut-bindings="shortcutBindings"
          @toggle-minimalist="emit('toggleMinimalist')"
        />
        <IconButton
          :icon-html="inFullscreen ? icons.leaveFullscreen : icons.enterFullscreen"
          :title="fullscreenTitle"
          :aria-label="fullscreenTitle"
          @click="emit('toggleFullscreen')"
        />
        <div ref="moreBtnRef" class="findBookReaderMoreWrap">
          <IconButton
            :icon-html="icons.more"
            :active="moreMenuOpen"
            :pressed="moreMenuOpen"
            title="更多"
            aria-label="更多"
            aria-haspopup="menu"
            :aria-expanded="moreMenuOpen"
            @click="toggleMoreMenu"
          />
        </div>
      </div>
    </div>
    <AppShellMenuTeleport
      v-model:open="moreMenuOpen"
      :min-width="120"
      :left="moreMenuLeft"
      :top="moreMenuTop"
      caret="end"
      :fullscreen-header-float="inFullscreen || inMinimalist"
      :max-height="moreMenuMaxHeight"
      :on-panel-mount="bindMoreMenuPanel"
    >
      <div v-if="showToolbarInMoreMenu" class="findBookReaderMorePanel">
        <HeaderFontToolbar
          v-if="compactFontToolbar"
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
          @set-monaco-font="(fontFamily) => { emit('setMonacoFont', fontFamily); closeMoreMenu(); }"
          @toggle-pin-other-font="(fontName) => emit('togglePinOtherFont', fontName)"
          @increase-font-size="emit('increaseFontSize')"
          @decrease-font-size="emit('decreaseFontSize')"
          @increase-line-height="emit('increaseLineHeight')"
          @decrease-line-height="emit('decreaseLineHeight')"
        />
        <HeaderFormatToolbar
          v-if="compactFormatToolbar"
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
          @select-text-convert-letter-read="emit('selectTextConvertLetterRead', $event)"
          @select-text-convert-digit-read="emit('selectTextConvertDigitRead', $event)"
          @apply-text-convert-zh-edit="emit('applyTextConvertZhEdit', $event)"
          @apply-text-convert-letter-edit="emit('applyTextConvertLetterEdit', $event)"
          @apply-text-convert-digit-edit="emit('applyTextConvertDigitEdit', $event)"
          @toggle-compress-blank-lines="emit('toggleCompressBlankLines')"
          @toggle-lead-indent-full-width="emit('toggleLeadIndentFullWidth')"
          @format-edit-compress-blank-lines="emit('formatEditCompressBlankLines')"
          @format-edit-lead-indent-full-width="emit('formatEditLeadIndentFullWidth')"
          @toggle-monaco-advanced-wrapping="emit('toggleMonacoAdvancedWrapping')"
          @open-text-replace="onOpenTextReplace"
        />
      </div>
      <div
        v-if="showToolbarInMoreMenu"
        class="appShellMenuDivider"
        role="separator"
      />
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onToggleFindFromToolbar"
      >
        <span class="appShellMenuIconSlot" v-html="icons.find" />
        <span class="appShellMenuLabel">查找</span>
        <span v-if="findShortcutLabel" class="appShellMenuShortcut">{{
          findShortcutLabel
        }}</span>
      </button>
      <div class="appShellMenuDivider" role="separator" />
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onOpenSettingsFromToolbar"
      >
        <span class="appShellMenuIconSlot" v-html="icons.setting" />
        <span class="appShellMenuLabel">设置</span>
        <span v-if="settingsShortcutLabel" class="appShellMenuShortcut">{{
          settingsShortcutLabel
        }}</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onOpenColorSchemeFromToolbar"
      >
        <span
          class="appShellMenuIconSlot appShellMenuIconSlot--colorful"
          v-html="icons.palette"
        />
        <span class="appShellMenuLabel">配色</span>
        <span v-if="colorSchemeShortcutLabel" class="appShellMenuShortcut">{{
          colorSchemeShortcutLabel
        }}</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="!canEnterStealth"
        @click="onEnterStealthReader"
      >
        <span
          class="appShellMenuIconSlot appShellMenuIconSlot--colorful"
          v-html="icons.stealthMode"
        />
        <span class="appShellMenuLabel">摸鱼模式</span>
        <span v-if="stealthShortcutLabel" class="appShellMenuShortcut">{{
          stealthShortcutLabel
        }}</span>
      </button>
    </AppShellMenuTeleport>
  </header>
</template>

<style scoped>
.findBookReaderHeader {
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
.findBookReaderHeaderStart {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}
.findBookReaderBookshelfBtnIcon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.findBookReaderBookshelfBtnIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.findBookReaderBookshelfBtnIcon :deep(svg path) {
  fill: currentColor;
}
.findBookReaderBookshelfBtn--remove:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
  background: var(--danger-bg);
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
}
.findBookReaderMoreWrap {
  display: inline-flex;
}
.findBookReaderMorePanel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 4px 4px 0;
  overflow: visible;
  flex-shrink: 0;
}
.findBookReaderMorePanel :deep(.headerFontToolbar),
.findBookReaderMorePanel :deep(.headerFormatToolbar) {
  justify-content: center;
}
.hdrLockable {
  display: inline-flex;
  align-items: center;
}
</style>
