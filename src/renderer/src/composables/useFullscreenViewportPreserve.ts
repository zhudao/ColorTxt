import { nextTick, onBeforeUnmount, ref, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";

type ReaderRef = Ref<InstanceType<typeof ReaderMain> | null>;

/** 全屏尺寸动画未真正退出时的解冻兜底（macOS Space 过渡约 0.5s） */
const FALSE_ALARM_UNFREEZE_MS = 1200;
/** leave-full-screen 后 chrome 回文档流再等一拍，避免按未稳定布局恢复 */
const POST_LEAVE_CHROME_SETTLE_MS = 32;

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = navigator.platform || "";
  if (p === "MacIntel" || p === "MacARM") return true;
  return /mac|iphone|ipad|ipod/i.test(p);
}

function noopFullscreenViewportPreserve() {
  return {
    enabled: false as const,
    suppressViewportProgressUpdates: ref(false),
    noteStableAnchor: () => {},
    prepareFullscreenExit: () => {},
    onPossibleFullscreenTransitionResize: () => {},
    ensureExitAnchorBeforeChromeChange: () => {},
    restoreAfterLeave: async () => {},
    onFullscreenEntered: () => {},
  };
}

/**
 * 仅 macOS：原生全屏进出带 Space 缩放动画，过渡帧里 Monaco 视口底行会漂，
 * 进度（按底行）会被写成更靠后。退出前用 `saveViewState` 冻结视口，
 * 过渡期间不更新进度，chrome 稳定后再 `restoreViewState`。
 * 全屏进出不改展示行映射，故直接用 Monaco 原生 viewState 即可。
 * Windows / Linux 无此 Space 过渡，空操作，避免改动原有行为。
 */
export function useFullscreenViewportPreserve(deps: {
  readerRef: ReaderRef;
  isFullscreenView: Ref<boolean>;
}) {
  if (!isMacPlatform()) return noopFullscreenViewportPreserve();

  const suppressViewportProgressUpdates = ref(false);
  let lastStableViewState: unknown | null = null;
  let exitViewState: unknown | null = null;
  let frozen = false;
  let falseAlarmTimer: ReturnType<typeof setTimeout> | null = null;
  let restoreGen = 0;

  function clearFalseAlarm() {
    if (falseAlarmTimer) {
      clearTimeout(falseAlarmTimer);
      falseAlarmTimer = null;
    }
  }

  function captureViewState(): unknown | null {
    return deps.readerRef.value?.captureEditorViewState?.() ?? null;
  }

  function noteStableAnchor() {
    if (frozen || suppressViewportProgressUpdates.value) return;
    const vs = captureViewState();
    if (vs != null) lastStableViewState = vs;
  }

  function beginFreeze(captureExit: boolean) {
    if (captureExit) {
      exitViewState = captureViewState() ?? lastStableViewState;
    }
    frozen = true;
    suppressViewportProgressUpdates.value = true;
    clearFalseAlarm();
  }

  /** 应用内退出全屏：在 `setFullscreen(false)` 之前调用 */
  function prepareFullscreenExit() {
    beginFreeze(true);
  }

  /**
   * 仍处于全屏 UI 时窗口尺寸变化（含系统绿灯退出动画、进入全屏动画）。
   * 冻结「上一帧稳定 viewState」，避免过渡帧污染。
   */
  function onPossibleFullscreenTransitionResize() {
    if (!deps.isFullscreenView.value || frozen) return;
    beginFreeze(false);
    falseAlarmTimer = setTimeout(() => {
      falseAlarmTimer = null;
      if (!deps.isFullscreenView.value) return;
      frozen = false;
      suppressViewportProgressUpdates.value = false;
      exitViewState = null;
    }, FALSE_ALARM_UNFREEZE_MS);
  }

  /**
   * 切换全屏 chrome 之前调用：若尚未冻结（瞬时退出），在全屏布局下再采一次。
   */
  function ensureExitAnchorBeforeChromeChange() {
    if (!frozen) beginFreeze(true);
  }

  async function restoreAfterLeave() {
    const gen = ++restoreGen;
    const viewState = exitViewState ?? lastStableViewState;
    exitViewState = null;
    clearFalseAlarm();
    await nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    if (POST_LEAVE_CHROME_SETTLE_MS > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, POST_LEAVE_CHROME_SETTLE_MS);
      });
    }
    if (gen !== restoreGen) return;
    const reader = deps.readerRef.value;
    if (viewState != null) {
      reader?.restoreEditorViewState?.(viewState);
    }
    if (gen !== restoreGen) return;
    // 恢复过程中仍抑制进度；落稳后再放开并强制同步一帧
    frozen = false;
    suppressViewportProgressUpdates.value = false;
    reader?.emitProbeLine?.(false);
  }

  /** 进入全屏完成：解冻并刷新稳定 viewState */
  function onFullscreenEntered() {
    clearFalseAlarm();
    frozen = false;
    suppressViewportProgressUpdates.value = false;
    exitViewState = null;
    void nextTick(() => {
      requestAnimationFrame(() => noteStableAnchor());
    });
  }

  onBeforeUnmount(() => {
    clearFalseAlarm();
    restoreGen += 1;
  });

  return {
    enabled: true as const,
    suppressViewportProgressUpdates,
    noteStableAnchor,
    prepareFullscreenExit,
    onPossibleFullscreenTransitionResize,
    ensureExitAnchorBeforeChromeChange,
    restoreAfterLeave,
    onFullscreenEntered,
  };
}
