<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { StyleValue } from "vue";
import AppModal from "./AppModal.vue";
import ColorSchemeHighlightPanel, {
  type HighlightColorRow,
} from "./ColorSchemeHighlightPanel.vue";
import ColorSchemeLineationPanel, {
  type LineationColorRow,
} from "./ColorSchemeLineationPanel.vue";
import ColorSchemeReaderPanel, {
  type ColorSchemeReaderPane,
} from "./ColorSchemeReaderPanel.vue";
import ColorSchemePresetList from "./ColorSchemePresetList.vue";
import ColorSchemeTabBar, {
  type ColorSchemeTabId,
} from "./ColorSchemeTabBar.vue";
import AppShellMenuTeleport from "./AppShellMenuTeleport.vue";
import RangeSlider from "./RangeSlider.vue";
import RadioGroup from "./RadioGroup.vue";
import SwitchToggle from "./SwitchToggle.vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import ColorSchemeBackgroundAlignPad from "./ColorSchemeBackgroundAlignPad.vue";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";
import { useColorSchemeBackgroundDraft } from "../composables/useColorSchemeBackgroundDraft";
import { useColorSchemePackIo } from "../composables/useColorSchemePackIo";
import { useColorSchemePresetDraft } from "../composables/useColorSchemePresetDraft";
import {
  defaultReaderPaletteColorEnabled,
  defaultReaderPaletteDark,
  defaultReaderPaletteLight,
  mergeReaderPaletteColorEnabled,
  resolveEffectiveReaderPalette,
  type ReaderBackgroundState,
  type ReaderSurfaceColorEnabled,
  type ReaderSurfacePalette,
} from "../constants/appUi";
import {
  cloneReaderBackgroundState,
  defaultReaderBackgroundState,
  READER_BACKGROUND_BLEND_OPTIONS,
  READER_BACKGROUND_SIZE_OPTIONS,
  isReaderBackgroundEnabled,
} from "../constants/readerBackground";
import { READER_BACKGROUND_NONE_ID } from "../constants/readerBuiltins";
import {
  serializeReaderPaletteUserPresets,
  type ReaderPalettePreset,
  type ReaderPaletteWithTexture,
} from "../constants/readerPalettePresets";
import {
  DEFAULT_HIGHLIGHT_COLORS_DARK,
  DEFAULT_HIGHLIGHT_COLORS_LIGHT,
  MIN_HIGHLIGHT_COLORS,
} from "../constants/highlightColors";
import {
  DEFAULT_LINEATION_COLORS_DARK,
  DEFAULT_LINEATION_COLORS_LIGHT,
  MIN_LINEATION_COLORS,
} from "../constants/lineationColors";
import { icons } from "../icons";
import { appConfirm } from "../services/appDialog";

/** 配色「应用」一次提交；字段随 visibleTabs 出现 */
export type ColorSchemeApplyPayload = {
  reader?: {
    colorEnabled: ReaderSurfaceColorEnabled;
    userPresets: ReaderPalettePreset[];
    selectedIdLight: string;
    selectedIdDark: string;
    background: ReaderBackgroundState;
  };
  highlight?: { light: string[]; dark: string[] };
  lineation?: { light: string[]; dark: string[] };
};

const props = withDefaults(
  defineProps<{
    currentTheme: string;
    readerPaletteColorEnabled: ReaderSurfaceColorEnabled;
    monacoFontFamily: string;
    highlightColorsLight?: string[];
    highlightColorsDark?: string[];
    lineationColorsLight?: string[];
    lineationColorsDark?: string[];
    readerPaletteUserPresets?: ReaderPalettePreset[];
    readerPaletteSelectedIdLight?: string;
    readerPaletteSelectedIdDark?: string;
    readerBackground?: ReaderBackgroundState;
    /** 显示的标签；找书窗口仅传 `['reader']` */
    visibleTabs?: ColorSchemeTabId[];
  }>(),
  {
    highlightColorsLight: () => [...DEFAULT_HIGHLIGHT_COLORS_LIGHT],
    highlightColorsDark: () => [...DEFAULT_HIGHLIGHT_COLORS_DARK],
    lineationColorsLight: () => [...DEFAULT_LINEATION_COLORS_LIGHT],
    lineationColorsDark: () => [...DEFAULT_LINEATION_COLORS_DARK],
    readerPaletteUserPresets: () => [],
    readerPaletteSelectedIdLight: "",
    readerPaletteSelectedIdDark: "",
    readerBackground: () => cloneReaderBackgroundState(defaultReaderBackgroundState),
    visibleTabs: () => ["reader", "highlight", "lineation"],
  },
);

const emit = defineEmits<{
  apply: [payload: ColorSchemeApplyPayload];
  changeTheme: [theme: "vs" | "vs-dark"];
}>();

const modelValue = defineModel<boolean>({ default: false });

const activeTab = ref<ColorSchemeTabId>("reader");

function ensureActiveTabInVisible() {
  if (!props.visibleTabs.includes(activeTab.value)) {
    activeTab.value = props.visibleTabs[0] ?? "reader";
  }
}

const draftLight = ref<ReaderPaletteWithTexture>({
  ...defaultReaderPaletteLight,
  textureId: READER_BACKGROUND_NONE_ID,
});
const draftDark = ref<ReaderPaletteWithTexture>({
  ...defaultReaderPaletteDark,
  textureId: READER_BACKGROUND_NONE_ID,
});
const draftColorEnabled = ref<ReaderSurfaceColorEnabled>({
  ...defaultReaderPaletteColorEnabled,
});
let closingAfterApply = false;

const readerPane = ref<ColorSchemeReaderPane>("list");

function openBackgroundPane() {
  readerPane.value = "bg";
}

function onReaderPaneBack() {
  if (readerPane.value === "bg") {
    readerPane.value = "colors";
    return;
  }
  readerPane.value = "list";
}

const readerPaneBackLabel = computed(() =>
  readerPane.value === "bg" ? "返回配色" : "返回",
);

const {
  draftBackground,
  backgroundCustomUrlById,
  currentBackgroundTextureId,
  canEditBgOptions,
  bgOptionsBtnTitle,
  canDuplicateBackground,
  previewTextureStyle,
  overlayStyleForTexture,
  bgBlendSelectLabel,
  bgOpacityPercent,
  bgSizeModel,
  bgPositionModel,
  bgRepeatModel,
  bgBlendModel,
  syncFromApplied: syncBackgroundFromApplied,
  persistFiles: persistBackgroundFiles,
  discardSessionImports,
  refreshCustomUrls: refreshBackgroundCustomUrls,
  onSelectBackground,
  onBlendSelect,
  onBackgroundEnabledUpdate,
  importBackground,
  duplicateBackground,
  deleteBackground,
  installPackTextures,
  mergeGallery: mergeImportedBackgroundGallery,
} = useColorSchemeBackgroundDraft({
  currentTheme: () => props.currentTheme,
  readerPane,
  draftLight,
  draftDark,
  onManualEdit: () => markManualEdit(),
  closeOptionsMenu: () => closeBgOptionsMenu(),
  onGalleryChanged: async () => {
    await nextTick();
    await readerPanelRef.value?.scrollBackgroundToBottom();
  },
});

const highlightPanelRef = ref<{ scrollToBottom: () => void | Promise<void> } | null>(
  null,
);
const lineationPanelRef = ref<{ scrollToBottom: () => void | Promise<void> } | null>(
  null,
);
const presetListRef = ref<{
  scheduleScrollActiveIntoView: () => Promise<void>;
} | null>(null);
const readerPanelRef = ref<{
  scrollBackgroundToBottom: () => void | Promise<void>;
  bgOptionsTableBtnEl: HTMLElement | null;
} | null>(null);

const {
  draftUserPresets,
  activePresetKeyLight,
  activePresetKeyDark,
  activePresetKey,
  isUserPreset,
  canOpenColorEditor,
  colorEditorBtnTitle,
  createSchemeBtnLabel,
  presetListRows,
  isEditingUserPreset,
  writeDraftIntoUserPreset,
  flushSelectedUserPresetPalettes,
  markManualEdit,
  syncFromProps: syncPresetDraftFromApplied,
  syncSelection,
  mergeImportedUserPresets,
  cloneNamedPreset,
  isBuiltinSelected,
  onSelectPreset,
  onRenamePreset,
  onCreateScheme,
  onDeletePreset,
} = useColorSchemePresetDraft({
  currentTheme: () => props.currentTheme,
  draftLight,
  draftDark,
  readerPane,
  overlayStyleForTexture,
  presetListRef,
});

let draftBaselineJson = "";

const bgOptionsFooterBtnRef = ref<HTMLElement | null>(null);
const bgOptionsBtnRef = ref<HTMLElement | null>(null);
const {
  open: bgOptionsOpen,
  left: bgOptionsLeft,
  top: bgOptionsTop,
  toggleMenu: toggleBgOptionsMenu,
  closeMenu: closeBgOptionsMenu,
  panelRef: bgOptionsPanelRef,
} = useAnchoredAppShellMenu({
  anchor: bgOptionsBtnRef,
  placement: "above-center",
  widthPx: 300,
  gap: 6,
  zIndex: 7300,
  disabled: computed(() => !canEditBgOptions.value),
});

function bindBgOptionsPanel(el: HTMLElement | null) {
  bgOptionsPanelRef.value = el;
}

const bgBlendSelectRef = ref<{ closePanel: () => void } | null>(null);
const bgBlendSelectItems: CustomSelectItem[] = READER_BACKGROUND_BLEND_OPTIONS.map(
  (opt) => ({ kind: "item", id: opt.id, label: opt.label }),
);
const emptySelectItems: CustomSelectItem[] = [];

watch(bgOptionsOpen, (open) => {
  if (!open) bgBlendSelectRef.value?.closePanel();
});

let highlightRowIdSeq = 0;

function newHighlightRowId(): string {
  highlightRowIdSeq += 1;
  return `hl-${Date.now()}-${highlightRowIdSeq}`;
}

let lineationRowIdSeq = 0;

function newLineationRowId(): string {
  lineationRowIdSeq += 1;
  return `ln-${Date.now()}-${lineationRowIdSeq}`;
}

function colorsToDraftRows(colors: readonly string[]): HighlightColorRow[] {
  return colors.map((color) => ({ id: newHighlightRowId(), color }));
}

function lineationColorsToDraftRows(colors: readonly string[]): LineationColorRow[] {
  return colors.map((color) => ({ id: newLineationRowId(), color }));
}

const draftHighlightLight = ref<HighlightColorRow[]>(
  colorsToDraftRows(DEFAULT_HIGHLIGHT_COLORS_LIGHT),
);
const draftHighlightDark = ref<HighlightColorRow[]>(
  colorsToDraftRows(DEFAULT_HIGHLIGHT_COLORS_DARK),
);

const draftLineationLight = ref<LineationColorRow[]>(
  lineationColorsToDraftRows(DEFAULT_LINEATION_COLORS_LIGHT),
);
const draftLineationDark = ref<LineationColorRow[]>(
  lineationColorsToDraftRows(DEFAULT_LINEATION_COLORS_DARK),
);

const pickerLive = ref<Partial<Record<keyof ReaderSurfacePalette, string>>>({});

const highlightPickerLive = ref<Partial<Record<number, string>>>({});
const lineationPickerLive = ref<Partial<Record<number, string>>>({});

const isLightShell = computed(() => props.currentTheme === "vs");

const activeDraft = computed(() =>
  isLightShell.value ? draftLight.value : draftDark.value,
);

function toggleBgOptionsFrom(kind: "footer" | "table") {
  bgOptionsBtnRef.value =
    kind === "table"
      ? (readerPanelRef.value?.bgOptionsTableBtnEl ?? null)
      : bgOptionsFooterBtnRef.value;
  void toggleBgOptionsMenu();
}

const displaySurface = computed((): ReaderSurfacePalette => {
  const palette = {
    ...activeDraft.value,
    ...pickerLive.value,
  };
  if (readerPane.value === "colors") return palette;
  return resolveEffectiveReaderPalette(palette, draftColorEnabled.value);
});

const previewBoxStyle = computed(
  (): StyleValue => ({
    backgroundColor: displaySurface.value.readerBg,
    fontFamily: props.monacoFontFamily,
    fontSize: "18px",
    lineHeight: 1.5,
  }),
);

const activeLineationList = computed(() =>
  isLightShell.value ? draftLineationLight.value : draftLineationDark.value,
);

const lineationPreviewHexes = computed(() =>
  activeLineationList.value.map((row, i) =>
    lineationPreviewHex(i, row.color),
  ),
);

const lineationReaderBg = computed(() =>
  isLightShell.value ? draftLight.value.readerBg : draftDark.value.readerBg,
);

const activeHighlightList = computed(() =>
  isLightShell.value ? draftHighlightLight.value : draftHighlightDark.value,
);

const highlightPreviewHexes = computed(() =>
  activeHighlightList.value.map((row, i) => highlightPreviewHex(i, row.color)),
);

const highlightReaderBg = computed(() =>
  isLightShell.value ? draftLight.value.readerBg : draftDark.value.readerBg,
);

const bodyTextForHighlightPreview = computed(
  () => displaySurface.value.bodyText,
);


function captureDraftBaseline() {
  draftBaselineJson = serializeDraftForCompare();
}

function serializeDraftForCompare(): string {
  return JSON.stringify({
    reader: props.visibleTabs.includes("reader")
      ? {
          light: draftLight.value,
          dark: draftDark.value,
          colorEnabled: draftColorEnabled.value,
          userPresets: draftUserPresets.value,
          selectedIdLight: activePresetKeyLight.value,
          selectedIdDark: activePresetKeyDark.value,
          background: draftBackground.value,
        }
      : null,
    highlight: props.visibleTabs.includes("highlight")
      ? {
          light: draftHighlightLight.value.map((r) => r.color),
          dark: draftHighlightDark.value.map((r) => r.color),
        }
      : null,
    lineation: props.visibleTabs.includes("lineation")
      ? {
          light: draftLineationLight.value.map((r) => r.color),
          dark: draftLineationDark.value.map((r) => r.color),
        }
      : null,
  });
}

function isDraftDirty(): boolean {
  if (Object.keys(pickerLive.value).length) return true;
  if (Object.keys(highlightPickerLive.value).length) return true;
  if (Object.keys(lineationPickerLive.value).length) return true;
  return serializeDraftForCompare() !== draftBaselineJson;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!isDraftDirty()) return true;
  return appConfirm("配色已修改，确定要放弃这些改动吗？", "修改未保存");
}

function syncDraftFromProps() {
  draftColorEnabled.value = mergeReaderPaletteColorEnabled(
    props.readerPaletteColorEnabled,
  );
  syncBackgroundFromApplied(props.readerBackground);
}

function syncPresetDraftFromProps() {
  syncPresetDraftFromApplied(
    props.readerPaletteUserPresets,
    props.readerPaletteSelectedIdLight,
    props.readerPaletteSelectedIdDark,
  );
}

function syncHighlightDraftFromProps() {
  draftHighlightLight.value = colorsToDraftRows(props.highlightColorsLight);
  draftHighlightDark.value = colorsToDraftRows(props.highlightColorsDark);
}

function syncLineationDraftFromProps() {
  draftLineationLight.value = lineationColorsToDraftRows(props.lineationColorsLight);
  draftLineationDark.value = lineationColorsToDraftRows(props.lineationColorsDark);
}

function onPickerUpdate(key: keyof ReaderSurfacePalette, color: string) {
  const hex = color.startsWith("#") ? color : `#${color}`;
  const current = isLightShell.value
    ? draftLight.value[key]
    : draftDark.value[key];
  if (current.toLowerCase() === hex.toLowerCase()) return;
  if (isLightShell.value) {
    draftLight.value = { ...draftLight.value, [key]: hex };
  } else {
    draftDark.value = { ...draftDark.value, [key]: hex };
  }
  markManualEdit();
}

function onPickerDraftHex(key: keyof ReaderSurfacePalette, hex: string) {
  const v = hex.startsWith("#") ? hex : `#${hex}`;
  pickerLive.value = { ...pickerLive.value, [key]: v };
}

function onPickerDraftEnd() {
  pickerLive.value = {};
}

function onColorEnabledUpdate(
  key: keyof ReaderSurfaceColorEnabled,
  enabled: boolean,
) {
  if (draftColorEnabled.value[key] === enabled) return;
  draftColorEnabled.value = {
    ...draftColorEnabled.value,
    [key]: enabled,
  };
}

function onApplyAll() {
  const payload: ColorSchemeApplyPayload = {};
  if (props.visibleTabs.includes("reader")) {
    const background = persistBackgroundFiles(props.readerBackground);
    flushSelectedUserPresetPalettes();
    payload.reader = {
      colorEnabled: { ...draftColorEnabled.value },
      userPresets: serializeReaderPaletteUserPresets(draftUserPresets.value),
      selectedIdLight: activePresetKeyLight.value,
      selectedIdDark: activePresetKeyDark.value,
      background,
    };
  }
  if (props.visibleTabs.includes("highlight")) {
    payload.highlight = {
      light: draftHighlightLight.value.map((r) => r.color),
      dark: draftHighlightDark.value.map((r) => r.color),
    };
  }
  if (props.visibleTabs.includes("lineation")) {
    payload.lineation = {
      light: draftLineationLight.value.map((r) => r.color),
      dark: draftLineationDark.value.map((r) => r.color),
    };
  }
  emit("apply", payload);
  closingAfterApply = true;
  modelValue.value = false;
}

function onCancel() {
  void confirmDiscardIfDirty().then((ok) => {
    if (ok) {
      discardSessionImports(props.readerBackground.custom);
      modelValue.value = false;
    }
  });
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

function onAddHighlightClick() {
  addHighlightRow();
  void highlightPanelRef.value?.scrollToBottom();
}

function onResetHighlightDefaults() {
  draftHighlightLight.value = colorsToDraftRows(DEFAULT_HIGHLIGHT_COLORS_LIGHT);
  draftHighlightDark.value = colorsToDraftRows(DEFAULT_HIGHLIGHT_COLORS_DARK);
}

function mutActiveLineationDraft(updater: (arr: LineationColorRow[]) => void) {
  if (isLightShell.value) {
    const n = [...draftLineationLight.value];
    updater(n);
    draftLineationLight.value = n;
  } else {
    const n = [...draftLineationDark.value];
    updater(n);
    draftLineationDark.value = n;
  }
}

function onLineationColorUpdate(rowIndex: number, color: string) {
  const hex = color.startsWith("#") ? color : `#${color}`;
  mutActiveLineationDraft((arr) => {
    if (rowIndex >= 0 && rowIndex < arr.length) {
      arr[rowIndex] = { ...arr[rowIndex]!, color: hex };
    }
  });
}

function onLineationPickerDraftHex(rowIndex: number, hex: string) {
  const v = hex.startsWith("#") ? hex : `#${hex}`;
  lineationPickerLive.value = { ...lineationPickerLive.value, [rowIndex]: v };
}

function onLineationPickerDraftEnd() {
  lineationPickerLive.value = {};
}

function lineationPreviewHex(rowIndex: number, committedHex: string): string {
  const live = lineationPickerLive.value[rowIndex];
  if (live) return live;
  return committedHex.startsWith("#") ? committedHex : `#${committedHex}`;
}

function reorderLineation(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;
  mutActiveLineationDraft((arr) => {
    const [item] = arr.splice(fromIndex, 1);
    if (!item) return;
    arr.splice(toIndex, 0, item);
  });
}

function removeLineationRow(index: number) {
  mutActiveLineationDraft((arr) => {
    if (arr.length <= MIN_LINEATION_COLORS) return;
    arr.splice(index, 1);
  });
}

function addLineationRow() {
  mutActiveLineationDraft((arr) => {
    const last = arr[arr.length - 1]?.color ?? "#999999";
    arr.push({ id: newLineationRowId(), color: last });
  });
}

function onAddLineationClick() {
  addLineationRow();
  void lineationPanelRef.value?.scrollToBottom();
}

function onResetLineationDefaults() {
  draftLineationLight.value = lineationColorsToDraftRows(
    DEFAULT_LINEATION_COLORS_LIGHT,
  );
  draftLineationDark.value = lineationColorsToDraftRows(
    DEFAULT_LINEATION_COLORS_DARK,
  );
}

const {
  onExportCurrentColorScheme,
  onExportAllColorSchemes,
  onImportColorScheme,
} = useColorSchemePackIo({
  visibleTabs: () => props.visibleTabs,
  isUserPreset,
  isEditingUserPreset,
  writeDraftIntoUserPreset,
  activePresetKey,
  activePresetKeyLight,
  activePresetKeyDark,
  cloneNamedPreset,
  isBuiltinSelected,
  draftLight,
  draftDark,
  draftColorEnabled,
  draftUserPresets,
  draftBackground,
  mergeImportedUserPresets,
  syncSelection,
  installPackTextures,
  mergeGallery: mergeImportedBackgroundGallery,
  refreshCustomUrls: refreshBackgroundCustomUrls,
  applyImportedHighlight: (light, dark) => {
    draftHighlightLight.value = colorsToDraftRows(light);
    draftHighlightDark.value = colorsToDraftRows(dark);
    highlightPickerLive.value = {};
  },
  applyImportedLineation: (light, dark) => {
    draftLineationLight.value = lineationColorsToDraftRows(light);
    draftLineationDark.value = lineationColorsToDraftRows(dark);
    lineationPickerLive.value = {};
  },
  highlightColors: () => ({
    light: draftHighlightLight.value.map((r) => r.color),
    dark: draftHighlightDark.value.map((r) => r.color),
  }),
  lineationColors: () => ({
    light: draftLineationLight.value.map((r) => r.color),
    dark: draftLineationDark.value.map((r) => r.color),
  }),
  clearReaderPickerLive: () => {
    pickerLive.value = {};
  },
});


watch(modelValue, (open) => {
  if (!open) {
    closeBgOptionsMenu();
    // 保留 activeTab：同窗口再次打开配色时回到上次标签（不持久化）
    pickerLive.value = {};
    highlightPickerLive.value = {};
    lineationPickerLive.value = {};
    if (!closingAfterApply) {
      discardSessionImports(props.readerBackground.custom);
    }
    closingAfterApply = false;
    return;
  }
  ensureActiveTabInVisible();
  syncDraftFromProps();
  syncPresetDraftFromProps();
  if (props.visibleTabs.includes("highlight")) syncHighlightDraftFromProps();
  if (props.visibleTabs.includes("lineation")) syncLineationDraftFromProps();
  captureDraftBaseline();
});

watch(activeTab, (tab) => {
  if (tab !== "reader") readerPane.value = "list";
  if (tab !== "highlight") highlightPickerLive.value = {};
  if (tab !== "lineation") lineationPickerLive.value = {};
});

watch(readerPane, () => {
  closeBgOptionsMenu();
});

watch(canEditBgOptions, (ok) => {
  if (!ok) closeBgOptionsMenu();
});

function clearPickerLive() {
  pickerLive.value = {};
  highlightPickerLive.value = {};
  lineationPickerLive.value = {};
}

watch(
  () => props.currentTheme,
  () => {
    clearPickerLive();
    if (readerPane.value === "list") {
      void presetListRef.value?.scheduleScrollActiveIntoView();
    }
  },
);

const themeLocked = computed(
  () =>
    modelValue.value &&
    activeTab.value === "reader" &&
    (readerPane.value === "colors" || readerPane.value === "bg"),
);

function onChangeTheme(theme: "vs" | "vs-dark") {
  if (themeLocked.value) return;
  if ((theme === "vs") === isLightShell.value) return;
  clearPickerLive();
  emit("changeTheme", theme);
}

defineExpose({
  isThemeLocked: () => themeLocked.value,
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
    :before-close="confirmDiscardIfDirty"
  >
    <div class="colorSchemeLayout">
      <ColorSchemeTabBar
        :active-tab="activeTab"
        :visible-tabs="visibleTabs"
        :current-theme="currentTheme"
        :panel-open="modelValue"
        :theme-locked="themeLocked"
        :can-export-current-scheme="isUserPreset"
        @update:active-tab="activeTab = $event"
        @change-theme="onChangeTheme"
        @export-current-color-scheme="void onExportCurrentColorScheme()"
        @export-all-color-schemes="void onExportAllColorSchemes()"
        @import-color-scheme="void onImportColorScheme()"
      />

      <div class="colorSchemeScroll">
        <ColorSchemeReaderPanel
          v-show="activeTab === 'reader'"
          ref="readerPanelRef"
          :display-surface="displaySurface"
          :editing-surface="activeDraft"
          :color-enabled="draftColorEnabled"
          :preview-box-style="previewBoxStyle"
          :preview-texture-style="previewTextureStyle"
          :reader-pane="readerPane"
          :background-texture-id="currentBackgroundTextureId"
          :background-custom="draftBackground.custom"
          :background-custom-url-by-id="backgroundCustomUrlById"
          :background-enabled="isReaderBackgroundEnabled(draftBackground)"
          :can-edit-bg-options="canEditBgOptions"
          :bg-options-btn-title="bgOptionsBtnTitle"
          :bg-options-open="bgOptionsOpen"
          @update-surface-key="onPickerUpdate"
          @update-color-enabled="onColorEnabledUpdate"
          @update-background-enabled="onBackgroundEnabledUpdate"
          @draft-hex="onPickerDraftHex"
          @draft-end="onPickerDraftEnd"
          @select-background="onSelectBackground"
          @delete-background="void deleteBackground($event)"
          @open-background="openBackgroundPane"
          @toggle-bg-options="toggleBgOptionsFrom('table')"
        >
          <template #presetList>
            <ColorSchemePresetList
              ref="presetListRef"
              :rows="presetListRows"
              :active-key="activePresetKey"
              @select="onSelectPreset"
              @rename="onRenamePreset"
              @remove="onDeletePreset"
            />
          </template>
        </ColorSchemeReaderPanel>

        <ColorSchemeHighlightPanel
          v-show="activeTab === 'highlight'"
          ref="highlightPanelRef"
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
        />

        <ColorSchemeLineationPanel
          v-show="activeTab === 'lineation'"
          ref="lineationPanelRef"
          :rows="activeLineationList"
          :preview-hexes="lineationPreviewHexes"
          :lineation-reader-bg="lineationReaderBg"
          :body-text-color="bodyTextForHighlightPreview"
          :monaco-font-family="monacoFontFamily"
          :min-lineation-colors="MIN_LINEATION_COLORS"
          @update-color="onLineationColorUpdate"
          @draft-hex="onLineationPickerDraftHex"
          @draft-end="onLineationPickerDraftEnd"
          @reorder="reorderLineation"
          @remove="removeLineationRow"
        />
      </div>
    </div>

    <template #footer>
      <div class="colorSchemePanelFooter">
        <div v-if="activeTab === 'reader'" class="colorSchemePanelFooterStart">
          <button
            v-if="readerPane !== 'list'"
            type="button"
            class="btn"
            size="large"
            @click="onReaderPaneBack"
          >
            <span
              class="colorSchemeFooterBtnIcon"
              aria-hidden="true"
              v-html="icons.back"
            />
            {{ readerPaneBackLabel }}
          </button>
          <template v-else>
            <button
              type="button"
              class="btn"
              size="large"
              @click="readerPane = 'switches'"
            >
              <span
                class="colorSchemeFooterBtnIcon"
                aria-hidden="true"
                v-html="icons.switch"
              />
              开关
            </button>
            <button
              type="button"
              class="btn btnIconColorful"
              size="large"
              :disabled="!canOpenColorEditor"
              :title="colorEditorBtnTitle"
              @click="readerPane = 'colors'"
            >
              <span
                class="colorSchemeFooterBtnIcon"
                aria-hidden="true"
                v-html="icons.palette"
              />
              配色
            </button>
            <button
              type="button"
              class="btn"
              size="large"
              @click="onCreateScheme"
            >
              <span
                class="colorSchemeFooterBtnIcon"
                aria-hidden="true"
                v-html="icons.add"
              />
              {{ createSchemeBtnLabel }}
            </button>
          </template>
          <template v-if="readerPane === 'bg'">
            <div class="colorSchemeBgOptionsWrap">
              <button
                ref="bgOptionsFooterBtnRef"
                type="button"
                class="btn"
                size="large"
                aria-haspopup="dialog"
                :aria-expanded="bgOptionsOpen"
                :aria-pressed="bgOptionsOpen"
                :disabled="!canEditBgOptions"
                :title="bgOptionsBtnTitle"
                @click="toggleBgOptionsFrom('footer')"
              >
                <span
                  class="colorSchemeFooterBtnIcon"
                  aria-hidden="true"
                  v-html="icons.options"
                />
                选项
              </button>
            </div>
            <button
              type="button"
              class="btn"
              size="large"
              :disabled="!canDuplicateBackground"
              :title="
                canDuplicateBackground ? undefined : '请先选择一张背景图'
              "
              @click="void duplicateBackground()"
            >
              <span
                class="colorSchemeFooterBtnIcon"
                aria-hidden="true"
                v-html="icons.copy"
              />
              生成副本
            </button>
            <button
              type="button"
              class="btn"
              size="large"
              @click="void importBackground()"
            >
              <span
                class="colorSchemeFooterBtnIcon"
                aria-hidden="true"
                v-html="icons.add"
              />
              导入图片
            </button>
          </template>
        </div>
        <div
          v-else-if="activeTab === 'highlight'"
          class="colorSchemePanelFooterStart"
        >
          <button
            type="button"
            class="btn"
            size="large"
            @click="onResetHighlightDefaults"
          >
            恢复默认高亮配色
          </button>
          <button
            type="button"
            class="btn"
            size="large"
            @click="onAddHighlightClick"
          >
            <span
              class="colorSchemeFooterBtnIcon"
              aria-hidden="true"
              v-html="icons.add"
            />
            新增高亮色
          </button>
        </div>
        <div v-else class="colorSchemePanelFooterStart">
          <button
            type="button"
            class="btn"
            size="large"
            @click="onResetLineationDefaults"
          >
            恢复默认标注配色
          </button>
          <button
            type="button"
            class="btn"
            size="large"
            @click="onAddLineationClick"
          >
            <span
              class="colorSchemeFooterBtnIcon"
              aria-hidden="true"
              v-html="icons.add"
            />
            新增标注色
          </button>
        </div>
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
        <AppShellMenuTeleport
          v-model:open="bgOptionsOpen"
          :left="bgOptionsLeft"
          :top="bgOptionsTop"
          :z-index="7300"
          :width="280"
          aria-label="背景图选项"
          :on-panel-mount="bindBgOptionsPanel"
        >
          <div class="bgOptionsPanel">
            <div class="bgOptionsRow">
              <span class="bgOptionsLabel">混合模式</span>
              <AppCustomSelect
                ref="bgBlendSelectRef"
                class="bgOptionsSelect"
                :model-value="bgBlendModel"
                :display-label="bgBlendSelectLabel"
                :fixed-top-items="emptySelectItems"
                :scroll-items="bgBlendSelectItems"
                :fixed-bottom-items="emptySelectItems"
                :scroll-max-height="220"
                :panel-z-index="7400"
                ariaLabel="背景图混合模式"
                @update:model-value="onBlendSelect"
              />
            </div>
            <div class="bgOptionsRow">
              <span class="bgOptionsLabel">不透明度</span>
              <RangeSlider
                v-model="bgOpacityPercent"
                :min="0"
                :max="100"
                :step="5"
                aria-label="背景图不透明度"
              />
            </div>
            <div class="bgOptionsRow">
              <span class="bgOptionsLabel">填充方式</span>
              <RadioGroup
                v-model="bgSizeModel"
                size="sm"
                aria-label="背景图填充方式"
                :options="READER_BACKGROUND_SIZE_OPTIONS"
              />
            </div>
            <div class="bgOptionsRow">
              <span class="bgOptionsLabel">平铺方式</span>
              <SwitchToggle
                v-model="bgRepeatModel"
                size="sm"
                aria-label="背景图平铺"
              />
            </div>
            <div class="bgOptionsRow bgOptionsRow--align">
              <span class="bgOptionsLabel">对齐方式</span>
              <ColorSchemeBackgroundAlignPad v-model="bgPositionModel" />
            </div>
          </div>
        </AppShellMenuTeleport>
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

.colorSchemePanelFooterStart {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.colorSchemeBgOptionsWrap {
  position: relative;
}

.colorSchemeFooterBtnIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.colorSchemeFooterBtnIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.bgOptionsPanel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px 8px 8px;
  min-width: 0;
}

.bgOptionsRow {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bgOptionsLabel {
  flex: 0 0 68px;
  font-size: 13px;
  color: var(--fg);
}

.bgOptionsRow :deep(.rangeSlider) {
  flex: 1 1 auto;
  min-width: 0;
}

.bgOptionsRow :deep(.radioGroup) {
  flex: 1 1 auto;
  min-width: 0;
}

.bgOptionsSelect {
  flex: 1 1 auto;
  min-width: 0;
}

.bgOptionsRow--align {
  align-items: flex-start;
}

.bgOptionsRow--align .bgOptionsLabel {
  padding-top: 6px;
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
  height: 608px;
  min-width: 610px;
}
</style>
