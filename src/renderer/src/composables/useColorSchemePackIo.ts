/**
 * 配色弹窗：zip 导入 / 导出。
 */
import { toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from "vue";
import type { ColorSchemeTabId } from "../components/ColorSchemeTabBar.vue";
import type {
  ReaderBackgroundState,
  ReaderCustomBackground,
} from "../constants/readerBackground";
import {
  cloneReaderPalettePreset,
  serializeReaderPaletteUserPresets,
  type ReaderPalettePreset,
  type ReaderPaletteWithTexture,
} from "../constants/readerPalettePresets";
import type { ReaderSurfaceColorEnabled } from "../constants/readerPalette";
import { appConfirm } from "../services/appDialog";
import { appToast } from "../services/appToast";
import {
  buildColorSchemeExportPayload,
  buildColorSchemeExportZip,
  collectColorSchemeExportTextureIds,
  customFilesFromExportTextures,
  pickAndReadColorSchemeFile,
  readCustomBackgroundFiles,
  saveColorSchemeExportZip,
  sliceBackgroundGalleryForExport,
  colorSchemeExportZipFileName,
  COLOR_SCHEME_EXPORT_DEFAULT_NAME,
  type ColorSchemeExportV1,
} from "../utils/readerColorSchemeExport";

export function useColorSchemePackIo(opts: {
  visibleTabs: MaybeRefOrGetter<readonly ColorSchemeTabId[]>;
  isUserPreset: ComputedRef<boolean>;
  isEditingUserPreset: () => boolean;
  writeDraftIntoUserPreset: (id: string) => void;
  activePresetKey: ComputedRef<string>;
  activePresetKeyLight: Ref<string>;
  activePresetKeyDark: Ref<string>;
  cloneNamedPreset: (id: string) => ReaderPalettePreset | undefined;
  isBuiltinSelected: (id: string) => boolean;
  draftLight: Ref<ReaderPaletteWithTexture>;
  draftDark: Ref<ReaderPaletteWithTexture>;
  draftColorEnabled: Ref<ReaderSurfaceColorEnabled>;
  draftUserPresets: Ref<ReaderPalettePreset[]>;
  draftBackground: Ref<ReaderBackgroundState>;
  mergeImportedUserPresets: (incoming: readonly ReaderPalettePreset[]) => void;
  syncSelection: (selectedIdLight: string, selectedIdDark: string) => void;
  installPackTextures: (
    custom: readonly { id: string; fileName: string }[],
    textures: ReadonlyMap<string, Uint8Array>,
  ) => Promise<void>;
  mergeGallery: (incoming: {
    custom?: readonly ReaderCustomBackground[];
  }) => void;
  refreshCustomUrls: (
    custom: readonly ReaderCustomBackground[],
  ) => void | Promise<void>;
  applyImportedHighlight?: (light: string[], dark: string[]) => void;
  applyImportedLineation?: (light: string[], dark: string[]) => void;
  highlightColors: () => { light: string[]; dark: string[] } | null;
  lineationColors: () => { light: string[]; dark: string[] } | null;
  clearReaderPickerLive: () => void;
}) {
  function visibleTabs() {
    return toValue(opts.visibleTabs);
  }

  async function exportColorScheme(scope: "current" | "all") {
    const includeReader = visibleTabs().includes("reader");
    if (includeReader && scope === "current" && opts.isEditingUserPreset()) {
      opts.writeDraftIntoUserPreset(opts.activePresetKey.value);
    }
    const named = includeReader
      ? opts.cloneNamedPreset(opts.activePresetKey.value)
      : undefined;
    const userPresets =
      scope === "current"
        ? named && !opts.isBuiltinSelected(named.id)
          ? [cloneReaderPalettePreset(named)]
          : []
        : opts.draftUserPresets.value;
    const referencedIds = includeReader
      ? collectColorSchemeExportTextureIds({
          light: opts.draftLight.value,
          dark: opts.draftDark.value,
          userPresets,
        })
      : new Set<string>();
    const gallery = includeReader
      ? sliceBackgroundGalleryForExport(opts.draftBackground.value, referencedIds)
      : {};
    const highlight = opts.highlightColors();
    const lineation = opts.lineationColors();
    const payload = buildColorSchemeExportPayload({
      ...(includeReader
        ? {
            reader: {
              light: { ...opts.draftLight.value },
              dark: { ...opts.draftDark.value },
              colorEnabled: { ...opts.draftColorEnabled.value },
              userPresets,
              selectedIdLight: opts.activePresetKeyLight.value,
              selectedIdDark: opts.activePresetKeyDark.value,
              ...gallery,
            },
          }
        : {}),
      ...(scope === "all" && visibleTabs().includes("highlight") && highlight
        ? { highlight }
        : {}),
      ...(scope === "all" && visibleTabs().includes("lineation") && lineation
        ? { lineation }
        : {}),
    });
    const textures = await readCustomBackgroundFiles(
      customFilesFromExportTextures(gallery.textures),
    );
    const zipBuffer = await buildColorSchemeExportZip(payload, textures);
    const saved = await saveColorSchemeExportZip(zipBuffer, {
      title: scope === "current" ? "导出当前配色方案" : "导出配色",
      defaultPath:
        scope === "current"
          ? colorSchemeExportZipFileName(named?.name ?? "配色方案")
          : COLOR_SCHEME_EXPORT_DEFAULT_NAME,
    });
    if ("cancelled" in saved && saved.cancelled) return;
    if (!saved.ok) {
      appToast(("error" in saved && saved.error) || "导出失败", {
        kind: "warning",
      });
      return;
    }
    appToast(scope === "current" ? "已导出配色方案" : "已导出配色", {
      kind: "success",
    });
  }

  function applyImportedColorScheme(data: ColorSchemeExportV1) {
    let applied = 0;
    if (data.reader && visibleTabs().includes("reader")) {
      opts.draftColorEnabled.value = { ...data.reader.colorEnabled };
      opts.mergeImportedUserPresets(
        serializeReaderPaletteUserPresets(data.reader.userPresets),
      );
      opts.mergeGallery(data.reader);
      opts.syncSelection(
        data.reader.selectedIdLight ?? "",
        data.reader.selectedIdDark ?? "",
      );
      opts.clearReaderPickerLive();
      applied += 1;
    }
    if (data.highlight && visibleTabs().includes("highlight")) {
      opts.applyImportedHighlight?.(data.highlight.light, data.highlight.dark);
      applied += 1;
    }
    if (data.lineation && visibleTabs().includes("lineation")) {
      opts.applyImportedLineation?.(data.lineation.light, data.lineation.dark);
      applied += 1;
    }
    return applied;
  }

  async function onExportCurrentColorScheme() {
    if (!opts.isUserPreset.value) return;
    await exportColorScheme("current");
  }

  async function onExportAllColorSchemes() {
    await exportColorScheme("all");
  }

  async function onImportColorScheme() {
    const picked = await pickAndReadColorSchemeFile("导入配色");
    if (!picked.ok) {
      if ("error" in picked) {
        appToast(picked.error || "读取文件失败", { kind: "warning" });
      }
      return;
    }
    const ok = await appConfirm(
      "导入将写入当前配色草稿（点「应用」后才会保存），是否继续？",
    );
    if (!ok) return;
    if (visibleTabs().includes("reader") && picked.pack.data.reader) {
      await opts.installPackTextures(
        picked.pack.data.reader.custom ?? [],
        picked.pack.textures,
      );
    }
    const applied = applyImportedColorScheme(picked.pack.data);
    if (!applied) {
      appToast("文件中没有可导入到当前面板的配色", { kind: "warning" });
      return;
    }
    if (applied && picked.pack.data.reader) {
      void opts.refreshCustomUrls(opts.draftBackground.value.custom);
    }
    appToast("已导入配色（点「应用」后生效）", { kind: "success" });
  }

  return {
    onExportCurrentColorScheme,
    onExportAllColorSchemes,
    onImportColorScheme,
  };
}
