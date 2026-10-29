import { computed, ref, toValue, type MaybeRefOrGetter, type Ref } from "vue";
import type { StyleValue } from "vue";
import type { ReaderPaletteWithTexture } from "../constants/readerPalettePresets";
import {
  getBuiltinReaderTexture,
  isBuiltinReaderTextureId,
  READER_BACKGROUND_NONE_ID,
  resolveBuiltinReaderTextureUrl,
} from "../constants/readerBuiltins";
import {
  cloneReaderBackgroundState,
  cloneReaderCustomBackground,
  copyReaderBackgroundSettingsToId,
  defaultReaderBackgroundState,
  isReaderBackgroundBlend,
  isReaderBackgroundEnabled,
  makeReaderCustomBackground,
  mergeReaderBackgroundGallery,
  newReaderCustomBackgroundId,
  patchReaderBackgroundLayerSettings,
  READER_BACKGROUND_BLEND_OPTIONS,
  readerBackgroundOverlayStyle,
  readerBackgroundPreviewUrl,
  readerBackgroundThemeSide,
  resolveCustomBackgroundPreviewUrl,
  resolveReaderBackgroundLayerSettings,
  resolveReaderTextureIdForTheme,
  serializeReaderBackgroundState,
  type ReaderBackgroundLayerSettings,
  type ReaderBackgroundState,
  type ReaderCustomBackground,
} from "../constants/readerBackground";
import { appConfirm, appPrompt } from "../services/appDialog";
import { appToast } from "../services/appToast";

async function deleteBackgroundFile(fileName: string) {
  try {
    await window.colorTxt.readerBackground.deleteFile(fileName);
  } catch {
    /* ignore */
  }
}

export function useColorSchemeBackgroundDraft(opts: {
  currentTheme: MaybeRefOrGetter<string>;
  readerPane: Ref<"list" | "colors" | "switches" | "bg">;
  draftLight: Ref<ReaderPaletteWithTexture>;
  draftDark: Ref<ReaderPaletteWithTexture>;
  onManualEdit: () => void;
  onGalleryChanged?: () => void | Promise<void>;
  closeOptionsMenu: () => void;
}) {
  const draftBackground = ref<ReaderBackgroundState>(
    cloneReaderBackgroundState(defaultReaderBackgroundState),
  );
  const backgroundCustomUrlById = ref<Record<string, string>>({});
  const sessionImportedFileNames = new Set<string>();

  const currentBackgroundTextureId = computed(() =>
    resolveReaderTextureIdForTheme(
      toValue(opts.currentTheme),
      opts.draftLight.value.textureId,
      opts.draftDark.value.textureId,
    ),
  );

  const currentBgThemeSide = computed(() =>
    readerBackgroundThemeSide(toValue(opts.currentTheme)),
  );

  const canEditBgOptions = computed(() => {
    const id = currentBackgroundTextureId.value;
    return (
      id !== READER_BACKGROUND_NONE_ID && !isBuiltinReaderTextureId(id)
    );
  });

  const bgOptionsBtnTitle = computed(() => {
    if (canEditBgOptions.value) return undefined;
    if (currentBackgroundTextureId.value === READER_BACKGROUND_NONE_ID) {
      return "当前未选择背景图";
    }
    return "内置背景图不支持改选项；要单独调节请先「生成副本」";
  });

  const canDuplicateBackground = computed(
    () => currentBackgroundTextureId.value !== READER_BACKGROUND_NONE_ID,
  );

  const currentBgLayer = computed(() =>
    resolveReaderBackgroundLayerSettings(
      draftBackground.value,
      currentBackgroundTextureId.value,
      currentBgThemeSide.value,
    ),
  );

  function patchCurrentBgLayer(patch: Partial<ReaderBackgroundLayerSettings>) {
    if (!canEditBgOptions.value) return;
    draftBackground.value = patchReaderBackgroundLayerSettings(
      draftBackground.value,
      currentBackgroundTextureId.value,
      currentBgThemeSide.value,
      patch,
    );
  }

  const bgBlendSelectLabel = computed(() => {
    const id = currentBgLayer.value.blend;
    return (
      READER_BACKGROUND_BLEND_OPTIONS.find((o) => o.id === id)?.label ?? "正常"
    );
  });

  const bgOpacityPercent = computed({
    get: () => Math.round(currentBgLayer.value.opacity * 100),
    set: (v: number) => patchCurrentBgLayer({ opacity: v / 100 }),
  });

  const bgSizeModel = computed({
    get: () => currentBgLayer.value.size,
    set: (v: string) =>
      patchCurrentBgLayer({
        size: v as ReaderBackgroundLayerSettings["size"],
      }),
  });

  const bgPositionModel = computed({
    get: () => currentBgLayer.value.position,
    set: (v: ReaderBackgroundLayerSettings["position"]) =>
      patchCurrentBgLayer({ position: v }),
  });

  const bgRepeatModel = computed({
    get: () => currentBgLayer.value.repeat,
    set: (v: boolean) => patchCurrentBgLayer({ repeat: v }),
  });

  const bgBlendModel = computed({
    get: () => currentBgLayer.value.blend,
    set: (v: string) =>
      patchCurrentBgLayer({
        blend: v as ReaderBackgroundLayerSettings["blend"],
      }),
  });

  function overlayStyleForTexture(
    textureId: string,
    options?: { originalAsContain?: boolean },
  ): Record<string, string> | undefined {
    const url = readerBackgroundPreviewUrl(
      textureId,
      backgroundCustomUrlById.value,
    );
    if (!url) return undefined;
    const layer = resolveReaderBackgroundLayerSettings(
      draftBackground.value,
      textureId,
      currentBgThemeSide.value,
    );
    return readerBackgroundOverlayStyle(url, layer, options);
  }

  const previewTextureStyle = computed((): StyleValue => {
    const showOverlay =
      opts.readerPane.value === "colors" ||
      opts.readerPane.value === "bg" ||
      isReaderBackgroundEnabled(draftBackground.value);
    if (!showOverlay) {
      return { backgroundImage: "none", opacity: 0 };
    }
    const textureId = currentBackgroundTextureId.value;
    if (textureId === READER_BACKGROUND_NONE_ID) {
      return { backgroundImage: "none", opacity: 0 };
    }
    return (
      overlayStyleForTexture(textureId) ?? {
        backgroundImage: "none",
        opacity: 0,
      }
    );
  });

  async function refreshCustomUrls(
    custom: readonly { id: string; fileName: string }[],
  ) {
    const prev = backgroundCustomUrlById.value;
    const urlByFileName: Record<string, string> = {};
    for (const c of custom) {
      const url = prev[c.id];
      if (url) urlByFileName[c.fileName] = url;
    }
    const next: Record<string, string> = {};
    for (const c of custom) {
      let url = urlByFileName[c.fileName];
      if (!url) {
        url = (await resolveCustomBackgroundPreviewUrl(c.fileName)) ?? "";
        if (url) urlByFileName[c.fileName] = url;
      }
      if (url) next[c.id] = url;
    }
    backgroundCustomUrlById.value = next;
  }

  async function cleanupSessionImports(keep: readonly { fileName: string }[]) {
    const keepNames = new Set(keep.map((c) => c.fileName));
    for (const fileName of sessionImportedFileNames) {
      if (!keepNames.has(fileName)) {
        await deleteBackgroundFile(fileName);
      }
    }
    sessionImportedFileNames.clear();
  }

  function syncFromApplied(state: ReaderBackgroundState) {
    draftBackground.value = cloneReaderBackgroundState(state);
    void refreshCustomUrls(draftBackground.value.custom);
  }

  function persistFiles(previous: ReaderBackgroundState): ReaderBackgroundState {
    const next = serializeReaderBackgroundState(draftBackground.value);
    const keepNames = new Set(next.custom.map((c) => c.fileName));
    for (const c of previous.custom) {
      if (!keepNames.has(c.fileName)) {
        void deleteBackgroundFile(c.fileName);
      }
    }
    void cleanupSessionImports(next.custom);
    return next;
  }

  function discardSessionImports(keep: readonly { fileName: string }[]) {
    void cleanupSessionImports(keep);
  }

  function patchDraftTextureId(id: string) {
    if (toValue(opts.currentTheme) === "vs-dark") {
      opts.draftDark.value = { ...opts.draftDark.value, textureId: id };
    } else {
      opts.draftLight.value = { ...opts.draftLight.value, textureId: id };
    }
  }

  function onSelectBackground(id: string) {
    if (currentBackgroundTextureId.value === id) return;
    patchDraftTextureId(id);
    opts.onManualEdit();
  }

  function onBlendSelect(id: string) {
    if (!isReaderBackgroundBlend(id)) return;
    patchCurrentBgLayer({ blend: id });
  }

  function onBackgroundEnabledUpdate(enabled: boolean) {
    if (isReaderBackgroundEnabled(draftBackground.value) === enabled) return;
    draftBackground.value = { ...draftBackground.value, enabled };
  }

  async function importBackground() {
    opts.closeOptionsMenu();
    const r = await window.colorTxt.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (r.canceled || r.filePaths.length === 0) return;
    const picked = r.filePaths.map((p) => p.trim()).filter(Boolean);
    if (picked.length === 0) return;

    const custom = [...draftBackground.value.custom];
    const errors: string[] = [];
    let added = 0;
    for (const filePath of picked) {
      const imported =
        await window.colorTxt.readerBackground.importFromPath(filePath);
      if (!imported.ok) {
        errors.push(imported.error || "导入失败");
        continue;
      }
      sessionImportedFileNames.add(imported.fileName);
      custom.push(
        makeReaderCustomBackground(imported.id, imported.name, imported.fileName),
      );
      added += 1;
    }
    if (added === 0) {
      appToast(errors[0] || "导入失败", { kind: "warning" });
      return;
    }
    draftBackground.value = { ...draftBackground.value, custom };
    await refreshCustomUrls(custom);
    await opts.onGalleryChanged?.();
    if (errors.length > 0) {
      appToast(
        `已导入 ${picked.length - errors.length} 张，${errors.length} 张失败`,
        { kind: "warning" },
      );
    }
  }

  async function duplicateBackground() {
    opts.closeOptionsMenu();
    const sourceId = currentBackgroundTextureId.value;
    if (sourceId === READER_BACKGROUND_NONE_ID) return;

    const builtin = getBuiltinReaderTexture(sourceId);
    const customSrc = draftBackground.value.custom.find((c) => c.id === sourceId);
    const sourceName = builtin?.name || customSrc?.name || "背景图";
    const defaultName = `${sourceName} 副本`;
    const input = await appPrompt("", {
      title: "图片名称",
      defaultValue: defaultName,
      placeholder: defaultName,
    });
    if (input === null) return;
    const name = input.trim() || defaultName;

    if (customSrc) {
      const copy = cloneReaderCustomBackground(customSrc);
      copy.id = newReaderCustomBackgroundId();
      copy.name = name;
      const custom = [...draftBackground.value.custom, copy];
      draftBackground.value = { ...draftBackground.value, custom };
      patchDraftTextureId(copy.id);
      opts.onManualEdit();
      await refreshCustomUrls(custom);
      await opts.onGalleryChanged?.();
      return;
    }

    let imported: Awaited<
      ReturnType<typeof window.colorTxt.readerBackground.importFromBytes>
    >;
    if (builtin?.url) {
      try {
        const res = await fetch(resolveBuiltinReaderTextureUrl(builtin.url));
        if (!res.ok) {
          appToast("无法读取内置背景图", { kind: "warning" });
          return;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        imported = await window.colorTxt.readerBackground.importFromBytes({
          bytes,
          ext: ".png",
          name,
        });
      } catch {
        appToast("无法读取内置背景图", { kind: "warning" });
        return;
      }
    } else {
      appToast("无法复制当前背景图", { kind: "warning" });
      return;
    }
    if (!imported.ok) {
      appToast(imported.error || "生成副本失败", { kind: "warning" });
      return;
    }

    sessionImportedFileNames.add(imported.fileName);
    const custom = [
      ...draftBackground.value.custom,
      makeReaderCustomBackground(imported.id, name, imported.fileName),
    ];
    draftBackground.value = copyReaderBackgroundSettingsToId(
      { ...draftBackground.value, custom },
      sourceId,
      imported.id,
    );
    patchDraftTextureId(imported.id);
    opts.onManualEdit();
    await refreshCustomUrls(custom);
    await opts.onGalleryChanged?.();
  }

  async function deleteBackground(id: string) {
    const item = draftBackground.value.custom.find((c) => c.id === id);
    if (!item) return;
    const ok = await appConfirm(`移除背景图「${item.name}」`);
    if (!ok) return;
    const custom = draftBackground.value.custom.filter((c) => c.id !== id);
    if (opts.draftLight.value.textureId === id) {
      opts.draftLight.value = {
        ...opts.draftLight.value,
        textureId: READER_BACKGROUND_NONE_ID,
      };
    }
    if (opts.draftDark.value.textureId === id) {
      opts.draftDark.value = {
        ...opts.draftDark.value,
        textureId: READER_BACKGROUND_NONE_ID,
      };
    }
    draftBackground.value = { ...draftBackground.value, custom };
    const urls = { ...backgroundCustomUrlById.value };
    delete urls[id];
    backgroundCustomUrlById.value = urls;
    opts.onManualEdit();
  }

  async function installPackTextures(
    custom: readonly { id: string; fileName: string }[],
    textures: ReadonlyMap<string, Uint8Array>,
  ) {
    const seen = new Set<string>();
    for (const c of custom) {
      if (seen.has(c.fileName)) continue;
      seen.add(c.fileName);
      const bytes = textures.get(c.fileName);
      if (!bytes || bytes.byteLength === 0) continue;
      const installed = await window.colorTxt.readerBackground.installFile({
        id: c.id,
        fileName: c.fileName,
        bytes,
      });
      if (!installed.ok) continue;
      if (!installed.existed) sessionImportedFileNames.add(installed.fileName);
    }
  }

  function mergeGallery(incoming: {
    custom?: readonly ReaderCustomBackground[];
  }) {
    draftBackground.value = mergeReaderBackgroundGallery(
      draftBackground.value,
      incoming,
    );
  }

  return {
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
    syncFromApplied,
    persistFiles,
    discardSessionImports,
    refreshCustomUrls,
    onSelectBackground,
    onBlendSelect,
    onBackgroundEnabledUpdate,
    importBackground,
    duplicateBackground,
    deleteBackground,
    installPackTextures,
    mergeGallery,
  };
}
