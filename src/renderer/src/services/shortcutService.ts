export type AppShortcutActions = {
  openSettings: () => void | Promise<void>;
  openColorScheme: () => void | Promise<void>;
  openFindBook: () => void | Promise<void>;
  openBookSource: () => void | Promise<void>;
  toggleFullscreen: () => void | Promise<void>;
  increaseFontSize: () => void | Promise<void>;
  decreaseFontSize: () => void | Promise<void>;
  increaseLineHeight: () => void | Promise<void>;
  decreaseLineHeight: () => void | Promise<void>;
  increaseLetterSpacing: () => void | Promise<void>;
  decreaseLetterSpacing: () => void | Promise<void>;
  increaseParagraphSpacing: () => void | Promise<void>;
  decreaseParagraphSpacing: () => void | Promise<void>;
  increaseHorizontalInset: () => void | Promise<void>;
  decreaseHorizontalInset: () => void | Promise<void>;
  toggleSidebar: () => void | Promise<void>;
  toggleMinimalistView: () => void | Promise<void>;
  toggleTheme: () => void | Promise<void>;
  openNewWindow: () => void | Promise<void>;
  enterStealthReader: () => void | Promise<void>;
  openFile: () => void | Promise<void>;
  pickTxtDirectory: () => void | Promise<void>;
  openChapterRules: () => void | Promise<void>;
  toggleBookmark: () => void | Promise<void>;
  jumpToPrevChapter: () => void | Promise<void>;
  jumpToNextChapter: () => void | Promise<void>;
  toggleFind: () => void | Promise<void>;
  openSidebarSearch: () => void | Promise<void>;
  openSidebarFiles: () => void | Promise<void>;
  openSidebarChapters: () => void | Promise<void>;
  openSidebarAiAssistant: () => void | Promise<void>;
  toggleReaderEdit: () => void | Promise<void>;
  editSelectedText: () => void | Promise<void>;
  scrollDownLine: () => void | Promise<void>;
  scrollUpLine: () => void | Promise<void>;
  scrollPageUp: () => void | Promise<void>;
  scrollPageDown: () => void | Promise<void>;
};

import type { ShortcutBindingMap } from "./shortcutRegistry";
import { keyboardEventToAccelerator, normalizeAccelerator } from "./shortcutUtils";
import { hasDismissibleOverlay } from "../utils/dismissibleOverlayStack";
import { keyboardEventFromReaderSidebar } from "../utils/readerSidebarKeyboard";

type ActionKey = keyof AppShortcutActions;

/**
 * 快捷键面板正在录制时由 ShortcutPanel 挂上。
 * 必须在 bindAppShortcuts 的 window 捕获监听里先处理并 stopImmediatePropagation，
 * 否则已绑定的 Ctrl+F 等会先触发动作，录制框只收到修饰键。
 */
let windowShortcutRecordingHandler: ((ev: KeyboardEvent) => void) | null = null;

export function setWindowShortcutRecordingHandler(
  handler: ((ev: KeyboardEvent) => void) | null,
): void {
  windowShortcutRecordingHandler = handler;
}

const ACTION_BY_ID: Record<string, ActionKey> = {
  openFile: "openFile",
  pickTxtDirectory: "pickTxtDirectory",
  scrollDownLine: "scrollDownLine",
  scrollUpLine: "scrollUpLine",
  scrollPageUp: "scrollPageUp",
  scrollPageDown: "scrollPageDown",
  jumpPrevChapter: "jumpToPrevChapter",
  jumpNextChapter: "jumpToNextChapter",
  decreaseFontSize: "decreaseFontSize",
  increaseFontSize: "increaseFontSize",
  decreaseLineHeight: "decreaseLineHeight",
  increaseLineHeight: "increaseLineHeight",
  decreaseLetterSpacing: "decreaseLetterSpacing",
  increaseLetterSpacing: "increaseLetterSpacing",
  decreaseParagraphSpacing: "decreaseParagraphSpacing",
  increaseParagraphSpacing: "increaseParagraphSpacing",
  decreaseHorizontalInset: "decreaseHorizontalInset",
  increaseHorizontalInset: "increaseHorizontalInset",
  toggleFind: "toggleFind",
  openSidebarSearch: "openSidebarSearch",
  openSidebarFiles: "openSidebarFiles",
  openSidebarChapters: "openSidebarChapters",
  openSidebarAiAssistant: "openSidebarAiAssistant",
  toggleReaderEdit: "toggleReaderEdit",
  editSelectedText: "editSelectedText",
  openChapterRules: "openChapterRules",
  toggleBookmark: "toggleBookmark",
  toggleSidebar: "toggleSidebar",
  toggleMinimalistView: "toggleMinimalistView",
  toggleFullscreen: "toggleFullscreen",
  toggleTheme: "toggleTheme",
  openSettings: "openSettings",
  openColorScheme: "openColorScheme",
  openFindBook: "openFindBook",
  openBookSource: "openBookSource",
  openNewWindow: "openNewWindow",
  enterStealthReader: "enterStealthReader",
};

/** 编辑模式下焦点在 Monaco 内时，应交给编辑器处理的窗口快捷键（滚屏/查找等） */
export const EDIT_MODE_MONACO_DEFERRED_ACTIONS: ReadonlySet<ActionKey> =
  new Set([
    "scrollDownLine",
    "scrollUpLine",
    "scrollPageUp",
    "scrollPageDown",
    "toggleFind",
  ]);

/** 语音朗读播放中：仍吞掉行滚/页滚/章节跳转/查找；空格与左右由朗读键接管 */
export const VOICE_READ_SCROLL_BLOCKED_ACTIONS: ReadonlySet<ActionKey> =
  new Set([
    "scrollDownLine",
    "scrollUpLine",
    "scrollPageUp",
    "scrollPageDown",
    "jumpToPrevChapter",
    "jumpToNextChapter",
    "toggleFind",
  ]);

/** 会带动阅读器滚动或切章；蒙版打开时不拦截，交给弹层自己处理方向键/翻页 */
export const READER_SCROLL_SHORTCUT_ACTIONS: ReadonlySet<ActionKey> = new Set([
  "scrollDownLine",
  "scrollUpLine",
  "scrollPageUp",
  "scrollPageDown",
  "jumpToPrevChapter",
  "jumpToNextChapter",
]);

export type VoiceReadReaderKeyHandlers = {
  isActive: () => boolean;
  togglePlayPause: () => void;
  playPrevLine: () => void;
  playNextLine: () => void;
};

export type VoiceReadReaderKeyKind = "toggle" | "prev" | "next";

/** 朗读态：空格暂停/播放，左右换行（无修饰键） */
export function voiceReadReaderKeyKind(
  ev: KeyboardEvent,
): VoiceReadReaderKeyKind | null {
  if (ev.isComposing || ev.keyCode === 229) return null;
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return null;
  if (ev.key === " " || ev.code === "Space") return "toggle";
  if (ev.key === "ArrowLeft") return "prev";
  if (ev.key === "ArrowRight") return "next";
  return null;
}

/** 查找栏、音量滑块、备注框等：不要抢走空格/方向键 */
function keyboardEventBlocksVoiceReadRemap(ev: KeyboardEvent): boolean {
  const t = ev.target;
  if (!(t instanceof Element)) return false;
  if (t.closest(".find-widget")) return true;
  if (t.closest(".monaco-editor")) return false;
  if (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    t instanceof HTMLButtonElement
  ) {
    return true;
  }
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  const role = t.getAttribute("role");
  return role === "slider" || role === "spinbutton" || role === "textbox";
}

function isUnmodifiedSpaceKey(ev: KeyboardEvent): boolean {
  if (ev.isComposing || ev.keyCode === 229) return false;
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return false;
  return ev.key === " " || ev.code === "Space";
}

/**
 * 空格在输入面上应打字，不要翻页。
 * 只读 Monaco 仍翻页（textarea.inputarea 在 `.monaco-editor` 内）。
 * 编辑态用 Native EditContext（`div.native-edit-context`），须在 monaco 例外之前让出。
 */
function keyboardEventBlocksReaderSpacePageDown(ev: KeyboardEvent): boolean {
  const t = ev.target;
  if (!(t instanceof Element)) return false;
  if (t.closest(".find-widget")) return true;
  if (t.closest(".native-edit-context")) return true;
  if (
    t.closest(".content--readerEdit") &&
    (t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.isContentEditable) ||
      t.getAttribute("role") === "textbox")
  ) {
    return true;
  }
  if (t.closest(".monaco-editor")) return false;
  if (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  const role = t.getAttribute("role");
  return role === "slider" || role === "spinbutton" || role === "textbox";
}

function matchActionFromBindings(
  bindings: ShortcutBindingMap,
  eventAccel: string,
): ActionKey | null {
  for (const [actionId, binding] of Object.entries(bindings)) {
    const normalized = normalizeAccelerator(binding);
    if (!normalized || normalized !== eventAccel) continue;
    const actionKey = ACTION_BY_ID[actionId];
    if (actionKey) return actionKey;
  }
  return null;
}

function dispatchVoiceReadReaderKey(
  kind: VoiceReadReaderKeyKind,
  handlers: VoiceReadReaderKeyHandlers,
): void {
  if (kind === "toggle") handlers.togglePlayPause();
  else if (kind === "prev") handlers.playPrevLine();
  else handlers.playNextLine();
}

export function bindAppShortcuts(
  actions: AppShortcutActions,
  getBindings: () => ShortcutBindingMap,
  shouldHandleEvent?: (ev: KeyboardEvent) => boolean,
  shouldDeferAction?: (action: ActionKey, ev: KeyboardEvent) => boolean,
  shouldConsumeAction?: (action: ActionKey, ev: KeyboardEvent) => boolean,
  voiceReadReaderKeys?: VoiceReadReaderKeyHandlers,
  /** 只读空格翻页；找书主面板没有阅读器时应关 */
  mapUnmodifiedSpaceToPageDown = true,
  /** 编辑态：空格不翻页；焦点不在输入面时直接吞掉 */
  isReaderEditMode?: () => boolean,
): () => void {
  const onShortcutKeyDown = (ev: KeyboardEvent) => {
    if (windowShortcutRecordingHandler) {
      windowShortcutRecordingHandler(ev);
      return;
    }
    // 弹出菜单开着时不派发（侧栏因焦点仍在侧栏内本来就会让出；顶栏/底栏 Teleport 菜单不会）。Esc 不在绑定表里，仍由菜单自己关。
    if (hasDismissibleOverlay()) return;
    if (shouldHandleEvent && !shouldHandleEvent(ev)) return;
    if (voiceReadReaderKeys?.isActive()) {
      const kind = voiceReadReaderKeyKind(ev);
      if (kind && !keyboardEventBlocksVoiceReadRemap(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!ev.repeat) dispatchVoiceReadReaderKey(kind, voiceReadReaderKeys);
        return;
      }
    }
    if (
      mapUnmodifiedSpaceToPageDown &&
      isUnmodifiedSpaceKey(ev) &&
      !keyboardEventBlocksReaderSpacePageDown(ev)
    ) {
      const spaceAccel = keyboardEventToAccelerator(ev);
      const spaceBound = spaceAccel
        ? matchActionFromBindings(getBindings(), spaceAccel)
        : null;
      // 用户把空格绑到其它动作时走绑定表；未绑定或绑的是下一屏则当翻页。
      if (!spaceBound || spaceBound === "scrollPageDown") {
        if (
          !(
            voiceReadReaderKeys?.isActive() &&
            keyboardEventBlocksVoiceReadRemap(ev)
          )
        ) {
          if (isReaderEditMode?.()) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          if (shouldConsumeAction?.("scrollPageDown", ev)) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          // 侧栏列表仍把 PageDown 留给列表翻页；空格不是列表键，点过侧栏后应与顶栏一样翻阅读器。
          const deferPage =
            shouldDeferAction?.("scrollPageDown", ev) === true &&
            !keyboardEventFromReaderSidebar(ev);
          if (!deferPage) {
            ev.preventDefault();
            ev.stopPropagation();
            void actions.scrollPageDown();
            return;
          }
        }
      }
    }
    const eventAccel = keyboardEventToAccelerator(ev);
    if (!eventAccel) return;
    const matchedAction = matchActionFromBindings(getBindings(), eventAccel);
    if (!matchedAction) return;
    if (shouldConsumeAction?.(matchedAction, ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (shouldDeferAction?.(matchedAction, ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    void actions[matchedAction]();
  };

  window.addEventListener("keydown", onShortcutKeyDown, true);
  return () => window.removeEventListener("keydown", onShortcutKeyDown, true);
}
