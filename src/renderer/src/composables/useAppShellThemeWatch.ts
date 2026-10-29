import { nextTick, watch, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  APP_DISPLAY_NAME,
  applyReaderBackgroundForPalettes,
  applyReaderSurfaceToDocument,
  type ReaderBackgroundState,
  type ReaderSurfacePalette,
} from "../constants/appUi";

function syncAppTheme(
  theme: string,
  lightPalette: ReaderSurfacePalette,
  darkPalette: ReaderSurfacePalette,
) {
  const root = document.documentElement;
  const isDark = theme !== "vs";
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  applyReaderSurfaceToDocument(theme, lightPalette, darkPalette);
}

export function useAppShellThemeWatch(deps: {
  currentTheme: Ref<string>;
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  readerSurfaceLight: Ref<ReaderSurfacePalette & { textureId?: string }>;
  readerSurfaceDark: Ref<ReaderSurfacePalette & { textureId?: string }>;
  readerBackground: Ref<ReaderBackgroundState>;
  skipNextThemeNativeIpc: Ref<boolean>;
  persistSettings: () => void;
  showChapterCounts: Ref<boolean>;
  currentFile: Ref<string | null>;
  /** 阅读器编辑模式：未保存 dirty 时标题加 `*` */
  readerEditMode?: Ref<boolean>;
  readerEditorDirty?: Ref<boolean>;
  isFullscreenView: Ref<boolean>;
  showFullscreenSidebar: Ref<boolean>;
  pulseChapterListCenter: (smooth: boolean) => void;
}) {
  function applyReaderDocumentAndMonaco(theme: string) {
    syncAppTheme(
      theme,
      deps.readerSurfaceLight.value,
      deps.readerSurfaceDark.value,
    );
    void applyReaderBackgroundForPalettes(
      theme,
      deps.readerBackground.value,
      deps.readerSurfaceLight.value,
      deps.readerSurfaceDark.value,
    );
    deps.readerRef.value?.setTheme(theme);
  }

  watch(
    () => deps.currentTheme.value,
    (theme) => {
      applyReaderDocumentAndMonaco(theme);
      if (deps.skipNextThemeNativeIpc.value) {
        deps.skipNextThemeNativeIpc.value = false;
      } else {
        window.colorTxt.setNativeTheme(theme);
      }
      deps.persistSettings();
    },
    { immediate: true },
  );

  /** 其它窗口改配色后本窗只更新了内存；CSS 变量（背景/章节标题）需单独灌入 document */
  watch(
    () =>
      [deps.readerSurfaceLight.value, deps.readerSurfaceDark.value] as const,
    () => {
      applyReaderSurfaceToDocument(
        deps.currentTheme.value,
        deps.readerSurfaceLight.value,
        deps.readerSurfaceDark.value,
      );
      void applyReaderBackgroundForPalettes(
        deps.currentTheme.value,
        deps.readerBackground.value,
        deps.readerSurfaceLight.value,
        deps.readerSurfaceDark.value,
      );
    },
    { deep: true },
  );

  watch(
    () => deps.readerBackground.value,
    () => {
      void applyReaderBackgroundForPalettes(
        deps.currentTheme.value,
        deps.readerBackground.value,
        deps.readerSurfaceLight.value,
        deps.readerSurfaceDark.value,
      );
    },
    { deep: true },
  );

  watch(deps.showChapterCounts, () => {
    deps.persistSettings();
  });

  watch(
    () =>
      [
        deps.currentFile.value,
        deps.readerEditMode?.value ?? false,
        deps.readerEditorDirty?.value ?? false,
      ] as const,
    ([fp, editMode, dirty]) => {
      if (!fp) {
        window.colorTxt.setWindowTitle(APP_DISPLAY_NAME);
        return;
      }
      const fileName = fp.split(/[\\/]/).pop() || fp;
      const star = editMode && dirty ? "* " : "";
      window.colorTxt.setWindowTitle(`${star}${fileName} - ${APP_DISPLAY_NAME}`);
    },
    { immediate: true },
  );

  watch(
    () => deps.isFullscreenView.value && deps.showFullscreenSidebar.value,
    (visible) => {
      if (!visible) return;
      void nextTick(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            deps.pulseChapterListCenter(false);
          });
        });
      });
    },
  );
}
