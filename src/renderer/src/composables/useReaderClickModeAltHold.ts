import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import {
  getModalStackDepth,
  hasEscBeforeModalLayers,
  subscribeModalStackChange,
} from "../utils/modalStack";

function isAltOnlyModifier(ev: KeyboardEvent): boolean {
  return ev.altKey && !ev.ctrlKey && !ev.metaKey;
}

function isAltKey(ev: KeyboardEvent): boolean {
  return ev.key === "Alt" || ev.code === "AltLeft" || ev.code === "AltRight";
}

function isNonReaderTextInput(ev: Event): boolean {
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return false;
  if (t.closest(".monaco-editor")) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(t.closest('[contenteditable="true"]'));
}

/**
 * 按住 Alt 时临时反转可选/点击模式（不改持久化偏好）。
 * 编辑模式、更上层模态、灯箱、或焦点在阅读器以外的输入框时不启用。
 * 找书阅读器本身是 AppModal：只把「比挂载时更深」的模态当阻断，避免整窗失效。
 * 左键已按下后再按 Alt：本轮不切模式（可选模式下仍可走 Monaco 列选）。
 */
export function useReaderClickModeAltHold(deps: {
  persistedClickMode: Ref<boolean>;
  readerEditMode: Ref<boolean>;
  /** 阅读器未展示时不启用（找书关闭阅读器后组件可能仍挂着） */
  enabled?: Ref<boolean>;
}) {
  const altHold = ref(false);
  let primaryButtonDown = false;
  /** 左键按住期间按下的 Alt：直到松开 Alt 都不切模式 */
  let suppressAltHoldUntilRelease = false;
  /** 挂载/阅读器打开时的模态深度；仅更深的层（设置、词典等）才屏蔽 */
  let overlayBaselineDepth = 0;

  const effectiveClickMode = computed(() => {
    if (deps.readerEditMode.value) return deps.persistedClickMode.value;
    return altHold.value
      ? !deps.persistedClickMode.value
      : deps.persistedClickMode.value;
  });

  const clickModeAltHeld = computed(
    () =>
      altHold.value &&
      !deps.readerEditMode.value &&
      (deps.enabled?.value ?? true),
  );

  function clearAltHold() {
    altHold.value = false;
    suppressAltHoldUntilRelease = false;
  }

  function captureOverlayBaseline() {
    overlayBaselineDepth = getModalStackDepth();
  }

  function isBlockedByOverlay(): boolean {
    if (deps.enabled && !deps.enabled.value) return true;
    if (hasEscBeforeModalLayers()) return true;
    return getModalStackDepth() > overlayBaselineDepth;
  }

  function onPrimaryPointerDown(ev: PointerEvent) {
    if (ev.pointerType === "touch") return;
    if (ev.button === 0) primaryButtonDown = true;
  }

  function onPrimaryPointerUp(ev: PointerEvent) {
    if (ev.pointerType === "touch") return;
    if (ev.button === 0) primaryButtonDown = false;
  }

  function onPrimaryPointerCancel(ev: PointerEvent) {
    if (ev.pointerType === "touch") return;
    if (ev.isPrimary) primaryButtonDown = false;
  }

  function syncFromEvent(ev: KeyboardEvent) {
    if (deps.readerEditMode.value || isBlockedByOverlay()) {
      clearAltHold();
      return;
    }
    if (!isAltOnlyModifier(ev)) {
      altHold.value = false;
      if (!ev.altKey || (ev.type === "keyup" && isAltKey(ev))) {
        suppressAltHoldUntilRelease = false;
      }
      return;
    }
    if (suppressAltHoldUntilRelease) return;
    if (primaryButtonDown && !altHold.value) {
      suppressAltHoldUntilRelease = true;
      return;
    }
    if (isNonReaderTextInput(ev) && !altHold.value) return;
    altHold.value = true;
  }

  function onVisibilityChange() {
    if (document.visibilityState !== "visible") {
      primaryButtonDown = false;
      clearAltHold();
    }
  }

  function onWindowBlur() {
    primaryButtonDown = false;
    clearAltHold();
  }

  let unsubModal: (() => void) | null = null;

  watch(
    () => deps.enabled?.value ?? true,
    (on) => {
      if (on) captureOverlayBaseline();
      else clearAltHold();
    },
  );

  onMounted(() => {
    captureOverlayBaseline();
    window.addEventListener("keydown", syncFromEvent, true);
    window.addEventListener("keyup", syncFromEvent, true);
    window.addEventListener("pointerdown", onPrimaryPointerDown, true);
    window.addEventListener("pointerup", onPrimaryPointerUp, true);
    window.addEventListener("pointercancel", onPrimaryPointerCancel, true);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    unsubModal = subscribeModalStackChange(() => {
      if (isBlockedByOverlay()) clearAltHold();
    });
  });

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", syncFromEvent, true);
    window.removeEventListener("keyup", syncFromEvent, true);
    window.removeEventListener("pointerdown", onPrimaryPointerDown, true);
    window.removeEventListener("pointerup", onPrimaryPointerUp, true);
    window.removeEventListener("pointercancel", onPrimaryPointerCancel, true);
    window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unsubModal?.();
    unsubModal = null;
    primaryButtonDown = false;
    clearAltHold();
  });

  return {
    effectiveClickMode,
    clickModeAltHeld,
  };
}
