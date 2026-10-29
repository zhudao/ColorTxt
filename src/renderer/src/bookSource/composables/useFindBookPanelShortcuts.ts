import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import {
  persistKey,
  persistedSettingsChangedEvent,
} from "../../constants/appUi";
import {
  loadPersistedSettingsData,
  patchPersistedMainSettings,
} from "../../stores/cacheStore";
import {
  createDefaultShortcutBindings,
  type ShortcutBindingMap,
} from "../../services/shortcutRegistry";
import {
  bindAppShortcuts,
  type AppShortcutActions,
} from "../../services/shortcutService";
import {
  mergeShortcutBindings,
  shortcutBindingOverridesForPersist,
} from "../../services/shortcutUtils";
import { appAlert } from "../../services/appDialog";
import type { FindBookSettingsTabId } from "../components/FindBookSettingsTabBar.vue";

const defaultShortcutBindings = createDefaultShortcutBindings(
  /mac|iphone|ipad|ipod/i.test(navigator.platform || ""),
);

/** 阅读器打开时仍由找书面板处理的快捷键（其余交给 useFindBookReaderShortcuts） */
const PANEL_ACTIONS_WHEN_READER_OPEN = new Set<keyof AppShortcutActions>([
  "openSettings",
  "openColorScheme",
  "openFindBook",
  "openNewWindow",
  "openBookSource",
  "toggleTheme",
]);

function loadMainShortcutBindings():
  | Partial<ShortcutBindingMap>
  | undefined {
  return loadPersistedSettingsData(localStorage, persistKey)?.data
    ?.shortcutBindings;
}

/** 找书窗口：设置 / 配色 / 主界面 / 新窗口 / 书源管理快捷键在找书面板内始终可用（与主界面同一套绑定） */
export function useFindBookPanelShortcuts(deps: {
  showBookReader: Ref<boolean>;
  openSettings: (tab?: FindBookSettingsTabId) => void;
  openColorScheme: () => void;
  openBookSources: () => void;
  /** 找书窗内：同一绑定（默认 F7）→ 主界面 */
  goMain: () => void;
  openNewWindow: () => void;
  toggleTheme: () => void;
}) {
  const shortcutBindings = ref<ShortcutBindingMap>(
    mergeShortcutBindings(defaultShortcutBindings, loadMainShortcutBindings()),
  );

  let unbindShortcuts: (() => void) | null = null;

  /** 把「隐藏/显示阅读器」等系统级全局快捷键同步到主进程（找书独立启动时主窗口不会挂载） */
  async function applyGlobalShortcutFromBindings() {
    const accel = shortcutBindings.value.toggleAllWindowsVisibility?.trim();
    if (!accel || !window.colorTxt?.setGlobalShortcut) return;
    const r = await window.colorTxt.setGlobalShortcut(accel);
    if (!r.ok) {
      await appAlert(r.message || "系统级快捷键设置失败");
    }
  }

  async function applyShortcutBindings(next: ShortcutBindingMap) {
    const merged = mergeShortcutBindings(defaultShortcutBindings, next);
    const globalResult = await window.colorTxt.setGlobalShortcut(
      merged.toggleAllWindowsVisibility,
    );
    if (!globalResult.ok) {
      await appAlert(globalResult.message || "系统级快捷键设置失败");
      return;
    }
    shortcutBindings.value = merged;
    patchPersistedMainSettings({
      shortcutBindings: shortcutBindingOverridesForPersist(
        defaultShortcutBindings,
        merged,
      ),
    });
  }

  function syncShortcutBindingsFromMain() {
    shortcutBindings.value = mergeShortcutBindings(
      defaultShortcutBindings,
      loadMainShortcutBindings(),
    );
    void applyGlobalShortcutFromBindings();
  }

  function bindShortcuts() {
    if (unbindShortcuts) return;
    unbindShortcuts = bindAppShortcuts(
      {
        openSettings: () => {
          deps.openSettings();
        },
        openBookSource: () => {
          deps.openBookSources();
        },
        openColorScheme: () => {
          deps.openColorScheme();
        },
        openFindBook: () => {
          deps.goMain();
        },
        enterStealthReader: () => {},
        toggleFullscreen: () => {},
        increaseFontSize: () => {},
        decreaseFontSize: () => {},
        increaseLineHeight: () => {},
        decreaseLineHeight: () => {},
        increaseLetterSpacing: () => {},
        decreaseLetterSpacing: () => {},
        increaseParagraphSpacing: () => {},
        decreaseParagraphSpacing: () => {},
        increaseHorizontalInset: () => {},
        decreaseHorizontalInset: () => {},
        toggleSidebar: () => {},
        toggleMinimalistView: () => {},
        toggleTheme: () => {
          deps.toggleTheme();
        },
        openNewWindow: () => {
          deps.openNewWindow();
        },
        openFile: () => {},
        pickTxtDirectory: () => {},
        openChapterRules: () => {},
        toggleBookmark: () => {},
        jumpToPrevChapter: () => {},
        jumpToNextChapter: () => {},
        toggleFind: () => {},
        openSidebarSearch: () => {},
        openSidebarFiles: () => {},
        openSidebarChapters: () => {},
        openSidebarAiAssistant: () => {},
        toggleReaderEdit: () => {},
        editSelectedText: () => {},
        scrollDownLine: () => {},
        scrollUpLine: () => {},
        scrollPageUp: () => {},
        scrollPageDown: () => {},
      },
      () => shortcutBindings.value,
      undefined,
      (action) =>
        deps.showBookReader.value &&
        !PANEL_ACTIONS_WHEN_READER_OPEN.has(action),
      undefined,
      undefined,
      false,
    );
  }

  function onStorageSync(ev: StorageEvent) {
    if (ev.storageArea !== localStorage || ev.key !== persistKey) return;
    syncShortcutBindingsFromMain();
  }

  onMounted(() => {
    syncShortcutBindingsFromMain();
    bindShortcuts();
    window.addEventListener("storage", onStorageSync);
    window.addEventListener(
      persistedSettingsChangedEvent,
      syncShortcutBindingsFromMain,
    );
  });

  onBeforeUnmount(() => {
    unbindShortcuts?.();
    unbindShortcuts = null;
    window.removeEventListener("storage", onStorageSync);
    window.removeEventListener(
      persistedSettingsChangedEvent,
      syncShortcutBindingsFromMain,
    );
  });

  return {
    shortcutBindings,
    defaultShortcutBindings,
    applyShortcutBindings,
  };
}
