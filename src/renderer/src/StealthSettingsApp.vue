<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import AppModal from "./components/AppModal.vue";
import FontPicker from "./components/FontPicker.vue";
import HexColorPickerField from "./components/HexColorPickerField.vue";
import IconButton from "./components/IconButton.vue";
import NumericInput from "./components/NumericInput.vue";
import RadioGroup from "./components/RadioGroup.vue";
import RangeSlider from "./components/RangeSlider.vue";
import SwitchToggle from "./components/SwitchToggle.vue";
import { maxFontSize, minFontSize } from "./constants/appUi";
import {
  TIMED_SCROLL_RANGE_OPTIONS,
  maxTimedScrollIntervalMs,
  mergeTimedScrollSettings,
  minTimedScrollIntervalMs,
  type TimedScrollRange,
} from "./constants/timedScroll";
import { icons } from "./icons";
import { setWindowShortcutRecordingHandler } from "./services/shortcutService";
import {
  acceleratorToDisplayKeys,
  acceleratorToDisplayText,
  keyboardEventToAccelerator,
  normalizeAccelerator,
} from "./services/shortcutUtils";
import {
  detectFontPickerSelection,
  getPresetLabel,
} from "./utils/presetFontDefinitions";
import {
  applyAppShellTheme,
  listenPersistedSettingsSync,
  readPersistedAppShellTheme,
} from "./utils/appShellThemeSync";
import {
  clampStealthLineHeight,
  DEFAULT_STEALTH_SHORTCUTS,
  isStealthSystemUiFont,
  isStealthTerminalFont,
  lineHeightMultipleStep,
  maxStealthLineHeight,
  minLineHeightMultiple,
  STEALTH_SETTINGS_KEY,
  STEALTH_SHORTCUT_IDS,
  STEALTH_SHORTCUT_LABELS,
  loadStealthReaderSettings,
  saveStealthReaderSettings,
  type StealthReaderSettings,
  type StealthShortcutId,
  type StealthShortcutMap,
} from "./utils/stealthReaderSettings";

type TabId = "general" | "timedScroll" | "shortcuts";

const FONT_PICKER_Z = 9000;

const tab = ref<TabId>("general");
const settings = ref<StealthReaderSettings>(loadStealthReaderSettings());

const isMac = computed(() =>
  /mac|iphone|ipad|ipod/i.test(navigator.platform || ""),
);

/** 与主窗设置「阅读」页字体行一致：旁路展示当前字体名 */
const fontDisplayLabel = computed(() => {
  const ff = settings.value.fontFamily;
  if (isStealthSystemUiFont(ff)) return "系统默认";
  if (isStealthTerminalFont(ff)) return "终端默认";
  const sel = detectFontPickerSelection(ff);
  return sel.key === "other"
    ? sel.otherName || "系统字体"
    : getPresetLabel(sel.key);
});

const editingId = ref<StealthShortcutId | null>(null);
const pendingRecordedAccel = ref("");
const recordError = ref("");
const recordInputRef = ref<HTMLElement | null>(null);
const pendingRecordedDisplayText = computed(() =>
  acceleratorToDisplayText(pendingRecordedAccel.value, isMac.value),
);

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let offThemeSync: (() => void) | null = null;

function syncThemeFromStorage() {
  applyAppShellTheme(readPersistedAppShellTheme());
}

function pushNavShortcuts(map: StealthShortcutMap): void {
  window.colorTxt.stealthReaderSetNavShortcuts({ ...map });
}

function persistSoon(): void {
  if (persistTimer != null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    saveStealthReaderSettings(settings.value);
    pushNavShortcuts(settings.value.shortcuts);
  }, 120);
}

function patchSettings(partial: Partial<StealthReaderSettings>): void {
  settings.value = { ...settings.value, ...partial };
  persistSoon();
}

function togglePinOtherFont(fontName: string): void {
  const normalized = fontName.trim();
  if (!normalized) return;
  const list = settings.value.pinnedOtherFonts;
  const idx = list.findIndex((f) => f.trim() === normalized);
  patchSettings({
    pinnedOtherFonts:
      idx >= 0
        ? list.filter((_, i) => i !== idx)
        : [...list, normalized],
  });
}

function reloadFromStorage(): void {
  settings.value = loadStealthReaderSettings();
  pushNavShortcuts(settings.value.shortcuts);
}

function onStorage(ev: StorageEvent): void {
  if (ev.key === STEALTH_SETTINGS_KEY) reloadFromStorage();
}

function displayKeys(accel: string) {
  return acceleratorToDisplayKeys(accel, isMac.value);
}

function collectStealthConflicts(map: StealthShortcutMap): string[] {
  const seen = new Map<string, StealthShortcutId>();
  const dup: string[] = [];
  for (const id of STEALTH_SHORTCUT_IDS) {
    const accel = normalizeAccelerator(map[id] || "");
    if (!accel) continue;
    const prev = seen.get(accel);
    if (prev) dup.push(accel);
    else seen.set(accel, id);
  }
  return dup;
}

async function openEditModal(id: StealthShortcutId) {
  const firstOpen = editingId.value === null;
  editingId.value = id;
  pendingRecordedAccel.value = "";
  recordError.value = "";
  if (firstOpen) {
    setWindowShortcutRecordingHandler(onRecordInputKeydown);
    await window.colorTxt.suspendGlobalShortcutsForRecording();
  }
  void nextTick(() => {
    recordInputRef.value?.focus();
  });
}

async function closeEditModal() {
  const wasOpen = editingId.value !== null;
  if (wasOpen) {
    setWindowShortcutRecordingHandler(null);
  }
  editingId.value = null;
  pendingRecordedAccel.value = "";
  recordError.value = "";
  if (wasOpen) {
    await window.colorTxt.resumeGlobalShortcutsAfterRecording();
  }
}

function applyShortcutDraft(next: StealthShortcutMap): boolean {
  if (collectStealthConflicts(next).length > 0) return false;
  settings.value = { ...settings.value, shortcuts: { ...next } };
  saveStealthReaderSettings(settings.value);
  pushNavShortcuts(settings.value.shortcuts);
  return true;
}

function resetShortcuts(): void {
  applyShortcutDraft({ ...DEFAULT_STEALTH_SHORTCUTS });
}

async function onRecordInputKeydown(ev: KeyboardEvent) {
  if (!editingId.value) return;
  if (ev.isComposing || ev.key === "Process" || ev.key === "Dead") {
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }

  if (ev.key === "Enter") {
    ev.preventDefault();
    ev.stopPropagation();
    const nextAccel = normalizeAccelerator(pendingRecordedAccel.value);
    if (!nextAccel) {
      void closeEditModal();
      return;
    }
    const next = {
      ...settings.value.shortcuts,
      [editingId.value]: nextAccel,
    };
    if (collectStealthConflicts(next).length > 0) {
      recordError.value = "该快捷键已被占用";
      return;
    }
    const probe = await window.colorTxt.validateGlobalShortcut(nextAccel);
    if (!probe.ok) {
      recordError.value = "该快捷键不可用，可能被系统或其他程序占用";
      return;
    }
    if (applyShortcutDraft(next)) void closeEditModal();
    return;
  }

  if (ev.key === "Escape") {
    if (pendingRecordedAccel.value) {
      ev.preventDefault();
      ev.stopPropagation();
      pendingRecordedAccel.value = "";
      recordError.value = "";
    }
    return;
  }

  ev.preventDefault();
  ev.stopPropagation();
  pendingRecordedAccel.value = keyboardEventToAccelerator(ev);
  const preview = {
    ...settings.value.shortcuts,
    [editingId.value]: pendingRecordedAccel.value,
  };
  recordError.value =
    collectStealthConflicts(preview).length > 0 ? "该快捷键已被占用" : "";
}

const fontSizeModel = computed({
  get: () => settings.value.fontSize,
  set: (v: number) => patchSettings({ fontSize: v }),
});

const lineHeightModel = computed({
  get: () => settings.value.lineHeight,
  set: (v: number) => patchSettings({ lineHeight: clampStealthLineHeight(v) }),
});

const fontOpacityPct = computed({
  get: () => Math.round(settings.value.fontOpacity * 100),
  set: (v: number) => patchSettings({ fontOpacity: v / 100 }),
});

const bgOpacityPct = computed({
  get: () => Math.round(settings.value.bgOpacity * 100),
  set: (v: number) => patchSettings({ bgOpacity: v / 100 }),
});

const hideOnMouseLeaveModel = computed({
  get: () => settings.value.hideOnMouseLeave,
  set: (v: boolean) => patchSettings({ hideOnMouseLeave: v }),
});

const timedScrollRangeModel = computed({
  get: () => settings.value.timedScroll.range,
  set: (v: TimedScrollRange) =>
    patchSettings({
      timedScroll: mergeTimedScrollSettings({
        ...settings.value.timedScroll,
        range: v,
      }),
    }),
});

const timedScrollIntervalMsModel = computed({
  get: () => settings.value.timedScroll.intervalMs,
  set: (v: number) =>
    patchSettings({
      timedScroll: mergeTimedScrollSettings({
        ...settings.value.timedScroll,
        intervalMs: v,
      }),
    }),
});

onMounted(() => {
  syncThemeFromStorage();
  offThemeSync = listenPersistedSettingsSync(syncThemeFromStorage);
  window.addEventListener("storage", onStorage);
  pushNavShortcuts(settings.value.shortcuts);
  window.colorTxt.setWindowTitle("摸鱼设置");
});

onBeforeUnmount(() => {
  if (persistTimer != null) clearTimeout(persistTimer);
  offThemeSync?.();
  window.removeEventListener("storage", onStorage);
  void closeEditModal();
});
</script>

<template>
  <div class="stealthSettingsRoot">
    <div class="stealthSettingsTabs" role="tablist" aria-label="摸鱼设置分类">
      <button
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: tab === 'general' }"
        :aria-selected="tab === 'general'"
        @click="tab = 'general'"
      >
        常规
      </button>
      <button
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: tab === 'timedScroll' }"
        :aria-selected="tab === 'timedScroll'"
        @click="tab = 'timedScroll'"
      >
        定时滚动
      </button>
      <button
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: tab === 'shortcuts' }"
        :aria-selected="tab === 'shortcuts'"
        @click="tab = 'shortcuts'"
      >
        快捷键
      </button>
    </div>

    <div v-if="tab === 'general'" class="stealthSettingsBody settingsBody">
      <section class="aiSection aiSection--compact">
        <div class="aiSectionTitleRow">
          <h3 class="aiSectionTitle">文字</h3>
          <div class="settingsFontControl">
            <span
              class="settingsFontValue"
              :style="{ fontFamily: settings.fontFamily }"
              :title="fontDisplayLabel"
              >{{ fontDisplayLabel }}</span
            >
            <FontPicker
              :monaco-font-family="settings.fontFamily"
              :pinned-other-fonts="settings.pinnedOtherFonts"
              :menu-z-index="FONT_PICKER_Z"
              show-stealth-defaults
              @set-monaco-font="(f) => patchSettings({ fontFamily: f })"
              @toggle-pin-other-font="togglePinOtherFont"
            />
            <IconButton
              :icon-html="icons.bold"
              :active="settings.fontBold"
              :pressed="settings.fontBold"
              title="加粗"
              aria-label="加粗"
              @click="patchSettings({ fontBold: !settings.fontBold })"
            />
            <IconButton
              :icon-html="icons.italic"
              :active="settings.fontItalic"
              :pressed="settings.fontItalic"
              title="斜体"
              aria-label="斜体"
              @click="patchSettings({ fontItalic: !settings.fontItalic })"
            />
            <HexColorPickerField
              :model-value="settings.color"
              :popover-z-index="FONT_PICKER_Z"
              @update:model-value="(c) => patchSettings({ color: c })"
            />
          </div>
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain">
            <span class="settingsLabel short"
              >字号（{{ fontSizeModel }} px）</span
            >
            <RangeSlider
              v-model="fontSizeModel"
              :min="minFontSize"
              :max="maxFontSize"
              :step="1"
              :show-percent="false"
              aria-label="字号"
            />
          </div>
          <p class="settingsHint">
            窗口上 <code>Ctrl + 滚轮</code> 可快速调整字体大小。
          </p>
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain">
            <span class="settingsLabel short"
              >行间距（{{ lineHeightModel.toFixed(1) }}）</span
            >
            <RangeSlider
              v-model="lineHeightModel"
              :min="minLineHeightMultiple"
              :max="maxStealthLineHeight"
              :step="lineHeightMultipleStep"
              :show-percent="false"
              aria-label="行间距"
            />
          </div>
          <p class="settingsHint">
            窗口上 <code>Ctrl + Alt + 滚轮</code> 可快速调整行间距。
          </p>
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain">
            <span class="settingsLabel short"
              >字体不透明度（{{ fontOpacityPct }}%）</span
            >
            <RangeSlider
              v-model="fontOpacityPct"
              :min="0"
              :max="100"
              :step="1"
              :show-percent="false"
              aria-label="字体不透明度"
            />
          </div>
          <p class="settingsHint">
            窗口上 <code>Shift + 滚轮</code> 可快速调整字体不透明度。
          </p>
        </div>
      </section>

      <section class="aiSection aiSection--compact">
        <div class="aiSectionTitleRow">
          <h3 class="aiSectionTitle">背景</h3>
          <HexColorPickerField
            :model-value="settings.bgColor"
            :popover-z-index="FONT_PICKER_Z"
            @update:model-value="(c) => patchSettings({ bgColor: c })"
          />
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain">
            <span class="settingsLabel short"
              >背景不透明度（{{ bgOpacityPct }}%）</span
            >
            <RangeSlider
              v-model="bgOpacityPct"
              :min="0"
              :max="100"
              :step="1"
              :show-percent="false"
              aria-label="背景不透明度"
            />
          </div>
          <p class="settingsHint">
            窗口上 <code>Alt + 滚轮</code> 可快速调整背景不透明度。
          </p>
        </div>
      </section>

      <section class="aiSection aiSection--compact">
        <div class="aiSectionTitleRow">
          <h3 class="aiSectionTitle">鼠标离开时隐藏</h3>
          <SwitchToggle
            v-model="hideOnMouseLeaveModel"
            aria-label="鼠标离开时隐藏"
          />
        </div>
        <div class="settingsRow">
          <p class="settingsHint">
            开启后鼠标移开窗口时内容不可见，移入再显示。
          </p>
        </div>
      </section>
    </div>

    <div
      v-else-if="tab === 'timedScroll'"
      class="stealthSettingsBody settingsBody"
    >
      <section class="aiSection aiSection--compact">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel">范围</span>
            <RadioGroup
              v-model="timedScrollRangeModel"
              :options="TIMED_SCROLL_RANGE_OPTIONS"
              aria-label="定时滚动范围"
            />
          </div>
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel">间隔（毫秒）</span>
            <NumericInput
              v-model="timedScrollIntervalMsModel"
              :min="minTimedScrollIntervalMs"
              :max="maxTimedScrollIntervalMs"
              integer
              aria-label="定时滚动间隔毫秒"
            />
          </div>
        </div>
      </section>
    </div>

    <div v-else class="stealthSettingsBody">
      <div class="shortcutTableWrap">
        <table class="shortcutTable">
          <thead>
            <tr>
              <th class="colDesc">功能</th>
              <th class="colKeys">快捷键</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="id in STEALTH_SHORTCUT_IDS"
              :key="id"
              class="shortcutRow shortcutRow--clickable"
              role="button"
              tabindex="0"
              title="点击修改快捷键"
              @click="openEditModal(id)"
              @keydown.enter.prevent="openEditModal(id)"
              @keydown.space.prevent="openEditModal(id)"
            >
              <td class="shortcutDesc">{{ STEALTH_SHORTCUT_LABELS[id] }}</td>
              <td class="shortcutKeysCell">
                <kbd
                  v-for="key in displayKeys(settings.shortcuts[id])"
                  :key="`${id}-${key}`"
                  class="shortcutKey"
                  >{{ key }}</kbd
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="stealthShortcutActions">
        <button class="btn" type="button" size="large" @click="resetShortcuts">
          还原默认
        </button>
      </div>
    </div>

    <AppModal
      :model-value="editingId != null"
      max-width="520px"
      :esc-closable="!pendingRecordedAccel"
      @update:model-value="(v) => !v && void closeEditModal()"
    >
      <div v-if="editingId" class="shortcutEditBody">
        <p class="shortcutHintMain">先按所需的组合快捷键，再按 Enter 键确认</p>
        <!-- 用不可编辑的聚焦区域代替 input，避免中文 IME 在控件内上屏全角标点 -->
        <div
          ref="recordInputRef"
          class="shortcutRecordInput"
          role="textbox"
          tabindex="0"
          aria-readonly="true"
          aria-label="快捷键录制"
          :class="{ 'shortcutRecordInput--error': Boolean(recordError) }"
          @keydown="onRecordInputKeydown"
        >
          <span class="shortcutRecordText">{{
            pendingRecordedDisplayText
          }}</span>
          <span class="shortcutRecordCaret" aria-hidden="true" />
        </div>
        <p v-if="recordError" class="shortcutError">{{ recordError }}</p>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.stealthSettingsRoot {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--panel);
  color: var(--fg);
  user-select: none;
  -webkit-user-select: none;
}

.stealthSettingsTabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}

.tabBtn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
}

.tabBtn.active {
  color: var(--fg);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--accent, #3b82f6);
}

.stealthSettingsBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px 24px;
}

.settingsSectionTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

.settingsSectionTitle--timedScroll {
  margin-bottom: 10px;
}

.settingsIcon {
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  vertical-align: -3px;
}

.settingsIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.settingsIcon :deep(svg path) {
  fill: currentColor;
}

.aiSectionTitleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.aiSectionTitleRow .aiSectionTitle {
  flex: 0 0 auto;
}

.settingsFontControl {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 1 1 0;
  min-width: 0;
  width: 100%;
}

.settingsFontValue {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.shortcutTableWrap {
  padding: 0 2px;
}

.shortcutTable {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.shortcutTable th,
.shortcutTable td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.shortcutTable thead th {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.colDesc {
  text-align: left;
}

.colKeys {
  width: 46%;
  text-align: right;
}

.shortcutKeysCell {
  text-align: right;
  white-space: nowrap;
}

.shortcutKey + .shortcutKey {
  margin-left: 16px;
}

.shortcutKey + .shortcutKey::before {
  content: "+";
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.shortcutDesc {
  color: var(--fg);
  font-size: 13px;
}

.shortcutRow--clickable:hover,
.shortcutRow--clickable:focus-visible {
  background: color-mix(in srgb, var(--fg) 6%, transparent);
}

.stealthShortcutActions {
  margin-top: 16px;
}

.shortcutEditBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shortcutHintMain {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.shortcutRecordInput {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--fg);
  text-align: center;
  font-size: 14px;
  line-height: 1.4;
  outline: none;
  user-select: none;
  cursor: text;
}

.shortcutRecordText {
  min-height: 1em;
}

.shortcutRecordCaret {
  display: inline-block;
  width: 1px;
  height: 1.1em;
  margin-left: 1px;
  flex-shrink: 0;
  background: currentColor;
  opacity: 0;
}

.shortcutRecordInput:focus .shortcutRecordCaret {
  opacity: 1;
  animation: shortcutCaretBlink 1.05s step-end infinite;
}

@media (prefers-reduced-motion: reduce) {
  .shortcutRecordInput:focus .shortcutRecordCaret {
    animation: none;
    opacity: 1;
  }
}

@keyframes shortcutCaretBlink {
  50% {
    opacity: 0;
  }
}

.shortcutRecordInput:focus {
  border-color: var(--accent);
}

.shortcutRecordInput.shortcutRecordInput--error {
  border-color: var(--danger);
  background: var(--danger-bg);
}

.shortcutError {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
