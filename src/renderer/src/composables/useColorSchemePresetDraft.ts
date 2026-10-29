/**
 * 配色弹窗：用户方案草稿 CRUD，以及按 id 选中（找不到则回退「默认」）。
 */
import { computed, ref, toValue, type MaybeRefOrGetter, type Ref } from "vue";
import type { ColorSchemePresetListRow } from "../components/ColorSchemePresetList.vue";
import type { ColorSchemeReaderPane } from "../components/ColorSchemeReaderPanel.vue";
import { READER_SURFACE_PRESET_CARD_SWATCH_KEYS } from "../constants/appUi";
import {
  DEFAULT_READER_PALETTE_PRESET_ID,
  DEFAULT_READER_PALETTE_PRESET_ID_DARK,
  isBuiltinReaderPalettePresetId,
  listBuiltinReaderPalettePresets,
} from "../constants/readerBuiltins";
import { parseReaderTextureId } from "../constants/readerBackground";
import {
  cloneReaderPaletteWithTexture,
  DEFAULT_USER_READER_PALETTE_PRESET_NAME,
  findNamedReaderPalettePreset,
  newUserReaderPalettePresetId,
  resolveNamedReaderPalettePreset,
  serializeReaderPaletteUserPresets,
  type ReaderPalettePreset,
  type ReaderPaletteWithTexture,
} from "../constants/readerPalettePresets";
import { appConfirm, appPrompt } from "../services/appDialog";

export function useColorSchemePresetDraft(opts: {
  currentTheme: MaybeRefOrGetter<string>;
  draftLight: Ref<ReaderPaletteWithTexture>;
  draftDark: Ref<ReaderPaletteWithTexture>;
  readerPane: Ref<ColorSchemeReaderPane>;
  overlayStyleForTexture: (
    textureId: string,
    options?: { originalAsContain?: boolean },
  ) => Record<string, string> | undefined;
  presetListRef: Ref<{ scheduleScrollActiveIntoView: () => Promise<void> } | null>;
}) {
  const activePresetKeyLight = ref(DEFAULT_READER_PALETTE_PRESET_ID);
  const activePresetKeyDark = ref(DEFAULT_READER_PALETTE_PRESET_ID_DARK);
  const draftUserPresets = ref<ReaderPalettePreset[]>([]);

  const isLightShell = computed(() => toValue(opts.currentTheme) === "vs");
  const activePresetKey = computed(() =>
    isLightShell.value ? activePresetKeyLight.value : activePresetKeyDark.value,
  );

  function currentThemeSide(): "light" | "dark" {
    return isLightShell.value ? "light" : "dark";
  }

  function applyCurrentSideToDraft(named: ReaderPalettePreset) {
    if (named.theme !== currentThemeSide()) return;
    if (isLightShell.value) {
      opts.draftLight.value = cloneReaderPaletteWithTexture(named.palette);
      activePresetKeyLight.value = named.id;
    } else {
      opts.draftDark.value = cloneReaderPaletteWithTexture(named.palette);
      activePresetKeyDark.value = named.id;
    }
  }

  function isEditingUserPreset(): boolean {
    return draftUserPresets.value.some((p) => p.id === activePresetKey.value);
  }

  const createSchemeBtnLabel = computed(() =>
    isLightShell.value ? "新增亮色配色方案" : "新增暗色配色方案",
  );
  const isUserPreset = computed(() => isEditingUserPreset());
  const canOpenColorEditor = computed(() => isUserPreset.value);
  const colorEditorBtnTitle = computed(() => {
    if (isUserPreset.value) return undefined;
    return `内置方案不支持改色，可「${createSchemeBtnLabel.value}」来自定义配色`;
  });

  function syncSelection(selectedIdLight: string, selectedIdDark: string) {
    const selectedLight = resolveNamedReaderPalettePreset(
      selectedIdLight,
      draftUserPresets.value,
      "light",
    );
    const selectedDark = resolveNamedReaderPalettePreset(
      selectedIdDark,
      draftUserPresets.value,
      "dark",
    );
    activePresetKeyLight.value = selectedLight.id;
    activePresetKeyDark.value = selectedDark.id;
    opts.draftLight.value = cloneReaderPaletteWithTexture(selectedLight.palette);
    opts.draftDark.value = cloneReaderPaletteWithTexture(selectedDark.palette);
  }

  function writeDraftIntoUserPreset(id: string) {
    const idx = draftUserPresets.value.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const current = draftUserPresets.value[idx]!;
    if (current.theme !== currentThemeSide()) return;
    const next = [...draftUserPresets.value];
    next[idx] = {
      ...current,
      palette: cloneReaderPaletteWithTexture(
        isLightShell.value ? opts.draftLight.value : opts.draftDark.value,
      ),
    };
    draftUserPresets.value = next;
  }

  function flushSelectedUserPresetPalettes() {
    const next = [...draftUserPresets.value];
    let changed = false;
    const flush = (
      id: string,
      theme: "light" | "dark",
      palette: ReaderPaletteWithTexture,
    ) => {
      const idx = next.findIndex((p) => p.id === id);
      if (idx < 0) return;
      const current = next[idx]!;
      if (current.theme !== theme) return;
      next[idx] = {
        ...current,
        palette: cloneReaderPaletteWithTexture(palette),
      };
      changed = true;
    };
    flush(activePresetKeyLight.value, "light", opts.draftLight.value);
    flush(activePresetKeyDark.value, "dark", opts.draftDark.value);
    if (changed) draftUserPresets.value = next;
  }

  function markManualEdit() {
    if (isEditingUserPreset()) {
      writeDraftIntoUserPreset(activePresetKey.value);
    }
  }

  function presetListRowFromPalette(
    key: string,
    name: string,
    palette: ReaderPaletteWithTexture,
    custom: boolean,
  ): ColorSchemePresetListRow {
    const textureId = parseReaderTextureId(palette.textureId);
    const textureStyle = opts.overlayStyleForTexture(textureId, {
      originalAsContain: true,
    });
    return {
      key,
      name,
      bg: palette.readerBg,
      bodyText: palette.bodyText,
      swatches: READER_SURFACE_PRESET_CARD_SWATCH_KEYS.map((k) => palette[k]),
      custom,
      ...(textureStyle ? { textureStyle } : {}),
    };
  }

  const presetListRows = computed((): ColorSchemePresetListRow[] => {
    const theme = currentThemeSide();
    const rows: ColorSchemePresetListRow[] = [];
    for (const p of listBuiltinReaderPalettePresets(theme)) {
      rows.push(presetListRowFromPalette(p.id, p.name, p.palette, false));
    }
    for (const p of draftUserPresets.value) {
      if (p.theme !== theme) continue;
      rows.push(presetListRowFromPalette(p.id, p.name, p.palette, true));
    }
    return rows;
  });

  function syncFromProps(
    userPresets: readonly ReaderPalettePreset[],
    selectedIdLight: string,
    selectedIdDark: string,
  ) {
    draftUserPresets.value = serializeReaderPaletteUserPresets(userPresets);
    syncSelection(selectedIdLight, selectedIdDark);
    opts.readerPane.value = "list";
  }

  function mergeImportedUserPresets(incoming: readonly ReaderPalettePreset[]) {
    const next = serializeReaderPaletteUserPresets(incoming);
    const byId = new Map(draftUserPresets.value.map((p) => [p.id, p]));
    for (const p of next) byId.set(p.id, p);
    draftUserPresets.value = [...byId.values()];
  }

  function onSelectPreset(key: string) {
    const named = findNamedReaderPalettePreset(key, draftUserPresets.value);
    if (!named) return;
    applyCurrentSideToDraft(named);
  }

  async function onRenamePreset(id: string) {
    const idx = draftUserPresets.value.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const current = draftUserPresets.value[idx]!;
    const input = await appPrompt("", {
      title: "方案名称",
      defaultValue: current.name,
      placeholder: DEFAULT_USER_READER_PALETTE_PRESET_NAME,
    });
    if (input === null) return;
    const name = input.trim() || DEFAULT_USER_READER_PALETTE_PRESET_NAME;
    const next = [...draftUserPresets.value];
    next[idx] = { ...current, name };
    draftUserPresets.value = next;
  }

  async function onDuplicatePreset(id: string) {
    const source = findNamedReaderPalettePreset(id, draftUserPresets.value);
    if (!source) return;
    const defaultName = `${source.name} 副本`;
    const input = await appPrompt("", {
      title: "方案名称",
      defaultValue: defaultName,
      placeholder: defaultName,
    });
    if (input === null) return;
    const name = input.trim() || defaultName;
    const palette =
      activePresetKey.value === id
        ? cloneReaderPaletteWithTexture(
            isLightShell.value ? opts.draftLight.value : opts.draftDark.value,
          )
        : cloneReaderPaletteWithTexture(source.palette);
    const copy: ReaderPalettePreset = {
      id: newUserReaderPalettePresetId(),
      name,
      theme: source.theme,
      palette,
    };
    const userIdx = draftUserPresets.value.findIndex((p) => p.id === id);
    const next = [...draftUserPresets.value];
    if (userIdx >= 0) next.splice(userIdx + 1, 0, copy);
    else next.push(copy);
    draftUserPresets.value = next;
    applyCurrentSideToDraft(copy);
    await opts.presetListRef.value?.scheduleScrollActiveIntoView();
    opts.readerPane.value = "colors";
  }

  function onCreateScheme() {
    void onDuplicatePreset(activePresetKey.value);
  }

  async function onDeletePreset(id: string) {
    const current = draftUserPresets.value.find((p) => p.id === id);
    if (!current) return;
    const ok = await appConfirm(`确定要删除配色方案「${current.name}」吗？`);
    if (!ok) return;
    const wasLight = activePresetKeyLight.value === id;
    const wasDark = activePresetKeyDark.value === id;
    const wasCurrent = activePresetKey.value === id;
    draftUserPresets.value = draftUserPresets.value.filter((p) => p.id !== id);
    if (wasLight) {
      const fallback = resolveNamedReaderPalettePreset(
        DEFAULT_READER_PALETTE_PRESET_ID,
        draftUserPresets.value,
        "light",
      );
      opts.draftLight.value = cloneReaderPaletteWithTexture(fallback.palette);
      activePresetKeyLight.value = fallback.id;
    }
    if (wasDark) {
      const fallback = resolveNamedReaderPalettePreset(
        DEFAULT_READER_PALETTE_PRESET_ID_DARK,
        draftUserPresets.value,
        "dark",
      );
      opts.draftDark.value = cloneReaderPaletteWithTexture(fallback.palette);
      activePresetKeyDark.value = fallback.id;
    }
    if ((wasLight || wasDark) && wasCurrent) opts.readerPane.value = "list";
  }

  return {
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
    syncFromProps,
    syncSelection,
    mergeImportedUserPresets,
    cloneNamedPreset: (id: string) =>
      findNamedReaderPalettePreset(id, draftUserPresets.value),
    isBuiltinSelected: (id: string) => isBuiltinReaderPalettePresetId(id),
    onSelectPreset,
    onRenamePreset,
    onDuplicatePreset,
    onCreateScheme,
    onDeletePreset,
  };
}
