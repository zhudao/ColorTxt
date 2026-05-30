<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { StyleValue } from "vue";
import AppModal from "./AppModal.vue";
import ColorSchemeHighlightPanel, {
  type HighlightColorRow,
} from "./ColorSchemeHighlightPanel.vue";
import ColorSchemeReaderPanel from "./ColorSchemeReaderPanel.vue";
import ColorSchemeTabBar from "./ColorSchemeTabBar.vue";
import {
  defaultReaderPaletteDark,
  defaultReaderPaletteLight,
  type ReaderSurfacePalette,
} from "../constants/appUi";
import {
  DEFAULT_HIGHLIGHT_COLORS_DARK,
  DEFAULT_HIGHLIGHT_COLORS_LIGHT,
  MIN_HIGHLIGHT_COLORS,
} from "../constants/highlightColors";

const props = defineProps<{
  currentTheme: string;
  readerSurfaceLight: ReaderSurfacePalette;
  readerSurfaceDark: ReaderSurfacePalette;
  monacoFontFamily: string;
  highlightColorsLight: string[];
  highlightColorsDark: string[];
}>();

const emit = defineEmits<{
  applyReaderPalettes: [
    payload: { light: ReaderSurfacePalette; dark: ReaderSurfacePalette },
  ];
  applyHighlightColors: [payload: { light: string[]; dark: string[] }];
}>();

const modelValue = defineModel<boolean>({ default: false });

const activeTab = ref<"reader" | "highlight">("reader");

const draftLight = ref<ReaderSurfacePalette>({ ...defaultReaderPaletteLight });
const draftDark = ref<ReaderSurfacePalette>({ ...defaultReaderPaletteDark });

let highlightRowIdSeq = 0;

function newHighlightRowId(): string {
  highlightRowIdSeq += 1;
  return `hl-${Date.now()}-${highlightRowIdSeq}`;
}

function colorsToDraftRows(colors: readonly string[]): HighlightColorRow[] {
  return colors.map((color) => ({ id: newHighlightRowId(), color }));
}

const draftHighlightLight = ref<HighlightColorRow[]>(
  colorsToDraftRows(DEFAULT_HIGHLIGHT_COLORS_LIGHT),
);
const draftHighlightDark = ref<HighlightColorRow[]>(
  colorsToDraftRows(DEFAULT_HIGHLIGHT_COLORS_DARK),
);

const isLightShell = computed(() => props.currentTheme === "vs");

const activeDraft = computed(() =>
  isLightShell.value ? draftLight.value : draftDark.value,
);

const pickerLive = ref<Partial<Record<keyof ReaderSurfacePalette, string>>>({});

const highlightPickerLive = ref<Partial<Record<number, string>>>({});

const displaySurface = computed(
  (): ReaderSurfacePalette => ({
    ...activeDraft.value,
    ...pickerLive.value,
  }),
);

const previewBoxStyle = computed(
  (): StyleValue => ({
    backgroundColor: displaySurface.value.readerBg,
    fontFamily: props.monacoFontFamily,
    fontSize: "18px",
    lineHeight: 1.5,
  }),
);

const highlightReaderBg = computed(() =>
  isLightShell.value ? draftLight.value.readerBg : draftDark.value.readerBg,
);

const activeHighlightList = computed(() =>
  isLightShell.value ? draftHighlightLight.value : draftHighlightDark.value,
);

const highlightPreviewHexes = computed(() =>
  activeHighlightList.value.map((row, i) => highlightPreviewHex(i, row.color)),
);

const bodyTextForHighlightPreview = computed(
  () => displaySurface.value.bodyText,
);

function syncDraftFromProps() {
  draftLight.value = { ...props.readerSurfaceLight };
  draftDark.value = { ...props.readerSurfaceDark };
}

function syncHighlightDraftFromProps() {
  draftHighlightLight.value = colorsToDraftRows(props.highlightColorsLight);
  draftHighlightDark.value = colorsToDraftRows(props.highlightColorsDark);
}

function onPickerUpdate(key: keyof ReaderSurfacePalette, color: string) {
  const hex = color.startsWith("#") ? color : `#${color}`;
  if (isLightShell.value) {
    draftLight.value = { ...draftLight.value, [key]: hex };
  } else {
    draftDark.value = { ...draftDark.value, [key]: hex };
  }
}

function onPickerDraftHex(key: keyof ReaderSurfacePalette, hex: string) {
  const v = hex.startsWith("#") ? hex : `#${hex}`;
  pickerLive.value = { ...pickerLive.value, [key]: v };
}

function onPickerDraftEnd() {
  pickerLive.value = {};
}

function onApplyAll() {
  emit("applyReaderPalettes", {
    light: { ...draftLight.value },
    dark: { ...draftDark.value },
  });
  emit("applyHighlightColors", {
    light: draftHighlightLight.value.map((r) => r.color),
    dark: draftHighlightDark.value.map((r) => r.color),
  });
  modelValue.value = false;
}

function onCancel() {
  modelValue.value = false;
}

function onResetReaderDefaults() {
  draftLight.value = { ...defaultReaderPaletteLight };
  draftDark.value = { ...defaultReaderPaletteDark };
}

function mutActiveHighlightDraft(updater: (arr: HighlightColorRow[]) => void) {
  if (isLightShell.value) {
    const n = [...draftHighlightLight.value];
    updater(n);
    draftHighlightLight.value = n;
  } else {
    const n = [...draftHighlightDark.value];
    updater(n);
    draftHighlightDark.value = n;
  }
}

function onHighlightColorUpdate(rowIndex: number, color: string) {
  const hex = color.startsWith("#") ? color : `#${color}`;
  mutActiveHighlightDraft((arr) => {
    if (rowIndex >= 0 && rowIndex < arr.length) {
      arr[rowIndex] = { ...arr[rowIndex]!, color: hex };
    }
  });
}

function onHighlightPickerDraftHex(rowIndex: number, hex: string) {
  const v = hex.startsWith("#") ? hex : `#${hex}`;
  highlightPickerLive.value = { ...highlightPickerLive.value, [rowIndex]: v };
}

function onHighlightPickerDraftEnd() {
  highlightPickerLive.value = {};
}

function highlightPreviewHex(rowIndex: number, committedHex: string): string {
  const live = highlightPickerLive.value[rowIndex];
  if (live) return live;
  return committedHex.startsWith("#") ? committedHex : `#${committedHex}`;
}

function reorderHighlight(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;
  mutActiveHighlightDraft((arr) => {
    const [item] = arr.splice(fromIndex, 1);
    if (!item) return;
    arr.splice(toIndex, 0, item);
  });
}

function removeHighlightRow(index: number) {
  mutActiveHighlightDraft((arr) => {
    if (arr.length <= MIN_HIGHLIGHT_COLORS) return;
    arr.splice(index, 1);
  });
}

function addHighlightRow() {
  mutActiveHighlightDraft((arr) => {
    const last = arr[arr.length - 1]?.color ?? "#999999";
    arr.push({ id: newHighlightRowId(), color: last });
  });
}

function onResetHighlightDefaults() {
  draftHighlightLight.value = colorsToDraftRows(DEFAULT_HIGHLIGHT_COLORS_LIGHT);
  draftHighlightDark.value = colorsToDraftRows(DEFAULT_HIGHLIGHT_COLORS_DARK);
}

watch(modelValue, (open) => {
  if (!open) {
    activeTab.value = "reader";
    pickerLive.value = {};
    highlightPickerLive.value = {};
    return;
  }
  syncDraftFromProps();
  syncHighlightDraftFromProps();
});

watch(activeTab, (tab) => {
  if (tab !== "highlight") highlightPickerLive.value = {};
});
</script>

<template>
  <AppModal
    v-model="modelValue"
    title="配色"
    max-width="720px"
    panel-class="colorSchemePanel"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="false"
  >
    <div class="colorSchemeLayout">
      <ColorSchemeTabBar
        :active-tab="activeTab"
        @update:active-tab="activeTab = $event"
      />

      <div class="colorSchemeScroll">
        <ColorSchemeReaderPanel
          v-show="activeTab === 'reader'"
          :display-surface="displaySurface"
          :editing-surface="activeDraft"
          :preview-box-style="previewBoxStyle"
          @update-surface-key="onPickerUpdate"
          @draft-hex="onPickerDraftHex"
          @draft-end="onPickerDraftEnd"
        />

        <ColorSchemeHighlightPanel
          v-show="activeTab === 'highlight'"
          :rows="activeHighlightList"
          :preview-hexes="highlightPreviewHexes"
          :highlight-reader-bg="highlightReaderBg"
          :body-text-color="bodyTextForHighlightPreview"
          :monaco-font-family="monacoFontFamily"
          :min-highlight-colors="MIN_HIGHLIGHT_COLORS"
          @update-color="onHighlightColorUpdate"
          @draft-hex="onHighlightPickerDraftHex"
          @draft-end="onHighlightPickerDraftEnd"
          @reorder="reorderHighlight"
          @remove="removeHighlightRow"
          @add="addHighlightRow"
        />
      </div>
    </div>

    <template #footer>
      <div class="colorSchemePanelFooter">
        <button
          v-if="activeTab === 'reader'"
          type="button"
          class="btn"
          size="large"
          @click="onResetReaderDefaults"
        >
          恢复默认阅读器配色
        </button>
        <button
          v-else
          type="button"
          class="btn"
          size="large"
          @click="onResetHighlightDefaults"
        >
          恢复默认高亮配色
        </button>
        <div class="colorSchemePanelFooterEnd">
          <button type="button" class="btn" size="large" @click="onCancel">
            取消
          </button>
          <button
            type="button"
            class="btn primary"
            size="large"
            @click="onApplyAll"
          >
            应用
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.colorSchemeLayout {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.colorSchemeScroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
}

.colorSchemePanelFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
}

.colorSchemePanelFooterEnd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>

<style>
.colorSchemePanel {
  height: 560px;
}
</style>
