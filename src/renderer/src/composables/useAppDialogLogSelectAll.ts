import { onBeforeUnmount, onMounted } from "vue";

let listenerRefCount = 0;
let keydownHandler: ((ev: KeyboardEvent) => void) | null = null;
let pointerHandler: ((ev: MouseEvent) => void) | null = null;
/** 最近一次在日志框内按下指针；用于取消选区后 Ctrl/Cmd+A 仍能限定在日志区 */
let lastAppDialogLogEl: HTMLElement | null = null;

function appDialogLogFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const start =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  const el = start?.closest(".appDialogLog");
  return el instanceof HTMLElement ? el : null;
}

function isUsableAppDialogLog(el: HTMLElement | null): el is HTMLElement {
  return Boolean(el?.isConnected && el.closest(".appModalBackdrop"));
}

function findAppDialogLogSelectAllTarget(): HTMLElement | null {
  const sel = window.getSelection();
  if (sel?.rangeCount) {
    const fromSel = appDialogLogFromNode(sel.anchorNode);
    if (fromSel) return fromSel;
  }

  const ae = document.activeElement;
  if (ae instanceof HTMLElement) {
    const fromAe = appDialogLogFromNode(ae);
    if (fromAe) return fromAe;
  }

  if (isUsableAppDialogLog(lastAppDialogLogEl)) {
    return lastAppDialogLogEl;
  }
  return null;
}

function onWindowCaptureAppDialogLogPointer(ev: MouseEvent) {
  const log = appDialogLogFromNode(ev.target as Node);
  if (log) {
    lastAppDialogLogEl = log;
    return;
  }
  lastAppDialogLogEl = null;
}

function onWindowCaptureAppDialogLogSelectAll(ev: KeyboardEvent) {
  if (ev.key !== "a" && ev.key !== "A") return;
  if (!ev.ctrlKey && !ev.metaKey) return;
  if (ev.altKey) return;

  const ae = document.activeElement;
  if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) {
    return;
  }

  const content = findAppDialogLogSelectAllTarget();
  if (!content) return;

  ev.preventDefault();
  ev.stopImmediatePropagation();
  const range = document.createRange();
  range.selectNodeContents(content);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function registerAppDialogLogSelectAllListener(): void {
  listenerRefCount += 1;
  if (listenerRefCount === 1) {
    keydownHandler = onWindowCaptureAppDialogLogSelectAll;
    pointerHandler = onWindowCaptureAppDialogLogPointer;
    window.addEventListener("keydown", keydownHandler, true);
    window.addEventListener("mousedown", pointerHandler, true);
  }
}

function unregisterAppDialogLogSelectAllListener(): void {
  listenerRefCount -= 1;
  if (listenerRefCount <= 0) {
    listenerRefCount = 0;
    lastAppDialogLogEl = null;
    if (keydownHandler) {
      window.removeEventListener("keydown", keydownHandler, true);
      keydownHandler = null;
    }
    if (pointerHandler) {
      window.removeEventListener("mousedown", pointerHandler, true);
      pointerHandler = null;
    }
  }
}

/** 由 `AppDialogHost` 引用计数挂载：焦点或选区在日志正文内时 Ctrl/Cmd+A 仅全选该日志区 */
export function useAppDialogLogSelectAll(): void {
  onMounted(registerAppDialogLogSelectAllListener);
  onBeforeUnmount(unregisterAppDialogLogSelectAllListener);
}
