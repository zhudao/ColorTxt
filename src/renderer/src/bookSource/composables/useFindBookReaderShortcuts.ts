import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type ReaderMain from "../../components/ReaderMain.vue";
import {
  persistKey,
  persistedSettingsChangedEvent,
} from "../../constants/appUi";
import { loadPersistedSettingsData } from "../../stores/cacheStore";
import {
  createDefaultShortcutBindings,
  type ShortcutBindingMap,
} from "../../services/shortcutRegistry";
import {
  bindAppShortcuts,
  EDIT_MODE_MONACO_DEFERRED_ACTIONS,
  READER_SCROLL_SHORTCUT_ACTIONS,
  VOICE_READ_SCROLL_BLOCKED_ACTIONS,
} from "../../services/shortcutService";
import { mergeShortcutBindings } from "../../services/shortcutUtils";
import {
  getModalStackDepth,
  hasEscBeforeModalLayers,
} from "../../utils/modalStack";
import { shouldDeferShortcutForReaderSidebar } from "../../utils/readerSidebarKeyboard";

function keyboardTargetInsideFindWidget(ev: KeyboardEvent): boolean {
  const t = ev.target;
  return t instanceof Element && !!t.closest(".find-widget");
}

function keyboardTargetInsideReaderMonacoEditor(
  ev: KeyboardEvent,
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>,
): boolean {
  const t = ev.target;
  if (!(t instanceof Node)) return false;
  if (t instanceof Element && t.closest(".content--readerEdit")) return true;
  const root = readerRef.value?.getReaderEditorDomNode?.() ?? null;
  return Boolean(root && root.contains(t));
}

const defaultShortcutBindings = createDefaultShortcutBindings(
  /mac|iphone|ipad|ipod/i.test(navigator.platform || ""),
);

function loadMainShortcutBindings():
  | Partial<ShortcutBindingMap>
  | undefined {
  return loadPersistedSettingsData(localStorage, persistKey)?.data
    ?.shortcutBindings;
}

export function useFindBookReaderShortcuts(deps: {
  readerOpen: Ref<boolean>;
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  increaseLineHeight: () => void;
  decreaseLineHeight: () => void;
  increaseLetterSpacing: () => void;
  decreaseLetterSpacing: () => void;
  increaseParagraphSpacing: () => void;
  decreaseParagraphSpacing: () => void;
  increaseHorizontalInset: () => void;
  decreaseHorizontalInset: () => void;
  jumpToPrevChapter: () => void;
  jumpToNextChapter: () => void;
  toggleSidebar: () => void;
  toggleMinimalistView: () => void;
  toggleFullscreen: () => void | Promise<void>;
  isVoiceReadScrollLocked?: Ref<boolean>;
  isVoiceReadBlocksFind?: Ref<boolean>;
  isVoiceReadActive?: Ref<boolean>;
  onVoiceReadTogglePlayPause?: () => void;
  onVoiceReadPlayPrevLine?: () => void;
  onVoiceReadPlayNextLine?: () => void;
  toggleReaderEdit: () => void | Promise<void>;
  readerEditMode?: Ref<boolean>;
  /**
   * 已在章节边界时再次翻页/逐行滚动：切章并返回 true，调用方不再滚动正文。
   */
  tryAdvanceChapterOnScroll?: (direction: 1 | -1) => boolean;
  enterStealthReader?: () => void;
}) {
  const shortcutBindings = ref<ShortcutBindingMap>(
    mergeShortcutBindings(defaultShortcutBindings, loadMainShortcutBindings()),
  );

  let unbindShortcuts: (() => void) | null = null;
  /** 阅读器打开时的模态栈深度（含找书面板/阅读器自身 AppModal）；仅更上层模态（设置等）才屏蔽快捷键 */
  let shortcutsBaselineModalDepth = 0;

  function syncShortcutBindingsFromMain() {
    shortcutBindings.value = mergeShortcutBindings(
      defaultShortcutBindings,
      loadMainShortcutBindings(),
    );
  }

  function findBookReaderShortcutsShouldHandle(): boolean {
    return deps.readerOpen.value;
  }

  function findBookReaderHasNestedOverlay(): boolean {
    if (hasEscBeforeModalLayers()) return true;
    return getModalStackDepth() > shortcutsBaselineModalDepth;
  }

  function bindShortcuts() {
    if (unbindShortcuts) return;
    shortcutsBaselineModalDepth = getModalStackDepth();
    unbindShortcuts = bindAppShortcuts(
      {
        openSettings: () => {},
        openColorScheme: () => {},
        openFindBook: () => {},
        enterStealthReader: () => {
          deps.enterStealthReader?.();
        },
        openBookSource: () => {},
        toggleFullscreen: deps.toggleFullscreen,
        increaseFontSize: deps.increaseFontSize,
        decreaseFontSize: deps.decreaseFontSize,
        increaseLineHeight: deps.increaseLineHeight,
        decreaseLineHeight: deps.decreaseLineHeight,
        increaseLetterSpacing: deps.increaseLetterSpacing,
        decreaseLetterSpacing: deps.decreaseLetterSpacing,
        increaseParagraphSpacing: deps.increaseParagraphSpacing,
        decreaseParagraphSpacing: deps.decreaseParagraphSpacing,
        increaseHorizontalInset: deps.increaseHorizontalInset,
        decreaseHorizontalInset: deps.decreaseHorizontalInset,
        toggleSidebar: deps.toggleSidebar,
        toggleMinimalistView: deps.toggleMinimalistView,
        toggleTheme: () => {},
        openNewWindow: () => {},
        openFile: () => {},
        pickTxtDirectory: () => {},
        openChapterRules: () => {},
        toggleBookmark: () => {},
        jumpToPrevChapter: deps.jumpToPrevChapter,
        jumpToNextChapter: deps.jumpToNextChapter,
        toggleFind: () => {
          if (deps.isVoiceReadBlocksFind?.value) return;
          deps.readerRef.value?.toggleFindWidget?.();
        },
        openSidebarSearch: () => {},
        openSidebarFiles: () => {},
        openSidebarChapters: () => {},
        openSidebarAiAssistant: () => {},
        toggleReaderEdit: () => {
          void deps.toggleReaderEdit();
        },
        editSelectedText: () => {
          deps.readerRef.value?.tryOpenPartialEditFromSelection?.();
        },
        scrollDownLine: () => {
          if (deps.tryAdvanceChapterOnScroll?.(1)) return;
          deps.readerRef.value?.scrollByLineStep?.(1);
        },
        scrollUpLine: () => {
          if (deps.tryAdvanceChapterOnScroll?.(-1)) return;
          deps.readerRef.value?.scrollByLineStep?.(-1);
        },
        scrollPageUp: () => {
          deps.readerRef.value?.scrollByPageStep?.(-1);
        },
        scrollPageDown: () => {
          deps.readerRef.value?.scrollByPageStep?.(1);
        },
      },
      () => shortcutBindings.value,
      findBookReaderShortcutsShouldHandle,
      (action, ev) => {
        if (shouldDeferShortcutForReaderSidebar(action, ev)) return true;
        if (
          findBookReaderHasNestedOverlay() &&
          READER_SCROLL_SHORTCUT_ACTIONS.has(action)
        ) {
          return true;
        }
        if (
          keyboardTargetInsideFindWidget(ev) &&
          (action === "scrollUpLine" || action === "scrollDownLine")
        ) {
          return true;
        }
        return (
          deps.readerEditMode?.value === true &&
          keyboardTargetInsideReaderMonacoEditor(ev, deps.readerRef) &&
          EDIT_MODE_MONACO_DEFERRED_ACTIONS.has(action)
        );
      },
      (action) =>
        Boolean(deps.isVoiceReadScrollLocked?.value) &&
        VOICE_READ_SCROLL_BLOCKED_ACTIONS.has(action),
      {
        isActive: () =>
          Boolean(deps.isVoiceReadActive?.value) &&
          !findBookReaderHasNestedOverlay(),
        togglePlayPause: () => deps.onVoiceReadTogglePlayPause?.(),
        playPrevLine: () => deps.onVoiceReadPlayPrevLine?.(),
        playNextLine: () => deps.onVoiceReadPlayNextLine?.(),
      },
      true,
      () => deps.readerEditMode?.value === true,
    );
  }

  function teardownShortcuts() {
    unbindShortcuts?.();
    unbindShortcuts = null;
  }

  function onStorageSync(ev: StorageEvent) {
    if (ev.storageArea !== localStorage || ev.key !== persistKey) return;
    syncShortcutBindingsFromMain();
  }

  watch(
    () => deps.readerOpen.value,
    (open) => {
      if (open) {
        void nextTick(() => bindShortcuts());
      } else {
        teardownShortcuts();
      }
    },
    { immediate: true },
  );

  onMounted(() => {
    syncShortcutBindingsFromMain();
    window.addEventListener("storage", onStorageSync);
    window.addEventListener(
      persistedSettingsChangedEvent,
      syncShortcutBindingsFromMain,
    );
  });

  onBeforeUnmount(() => {
    teardownShortcuts();
    window.removeEventListener("storage", onStorageSync);
    window.removeEventListener(
      persistedSettingsChangedEvent,
      syncShortcutBindingsFromMain,
    );
  });

  return { shortcutBindings };
}
