import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  clampTimedScrollIntervalMs,
  type TimedScrollSettings,
} from "../constants/timedScroll";

export function useAppTimedScroll(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  timedScrollSettings: Ref<TimedScrollSettings>;
  currentFile: Ref<string | null>;
  loading: Ref<boolean>;
  readerEditMode: Ref<boolean>;
  viewportAtBottom: Ref<boolean>;
  isVoiceReadActive: Ref<boolean>;
  /**
   * 找书等场景：到达底部时不停止，改由 onAtBottomTick 处理（如切下一章）。
   * 仍须在最后一章/无法续读时自行停止。
   */
  continueAtBottom?: boolean;
  onAtBottomTick?: () => void | Promise<void>;
  /** 为 true 时即使 viewportAtBottom 也允许开启（如非末章且内容过短无滚动条） */
  canStartDespiteBottom?: () => boolean;
  /** 加载中暂停计时并保持 active，加载完成后自动重启计时 */
  pauseOnLoading?: boolean;
}) {
  const active = ref(false);
  let timerId: ReturnType<typeof setInterval> | null = null;

  function clearTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function stopTimedScroll() {
    active.value = false;
    clearTimer();
  }

  function startTimer() {
    clearTimer();
    const ms = clampTimedScrollIntervalMs(
      deps.timedScrollSettings.value.intervalMs,
    );
    timerId = setInterval(tick, ms);
  }

  /** 手动滚动/翻页后重新计满间隔，避免刚操作完立刻再自动滚。 */
  function nudgeTimedScrollTimer() {
    if (!active.value) return;
    if (deps.pauseOnLoading && deps.loading.value) return;
    startTimer();
  }

  function startTimedScroll() {
    if (!canStartTimedScroll.value) return;
    if (deps.isVoiceReadActive.value) return;
    active.value = true;
    startTimer();
  }

  function toggleTimedScroll() {
    if (active.value) {
      stopTimedScroll();
      return;
    }
    startTimedScroll();
  }

  function tick() {
    if (!active.value) return;
    if (deps.viewportAtBottom.value) {
      if (deps.continueAtBottom && deps.onAtBottomTick) {
        if (deps.loading.value) return;
        void Promise.resolve(deps.onAtBottomTick());
        return;
      }
      stopTimedScroll();
      return;
    }
    const reader = deps.readerRef.value;
    if (!reader) return;
    if (deps.timedScrollSettings.value.range === "line") {
      reader.scrollByLineStep?.(1);
    } else {
      reader.scrollByPageStep?.(1);
    }
  }

  const canStartTimedScroll = computed(() => {
    if (!deps.currentFile.value?.trim()) return false;
    if (deps.loading.value) return false;
    if (deps.readerEditMode.value) return false;
    if (deps.isVoiceReadActive.value) return false;
    if (deps.viewportAtBottom.value && !deps.canStartDespiteBottom?.()) {
      return false;
    }
    const n = deps.readerRef.value?.getModelLineCount?.() ?? 0;
    return n > 0;
  });

  watch(
    () => deps.timedScrollSettings.value,
    () => {
      if (active.value) startTimer();
    },
    { deep: true },
  );

  watch(deps.currentFile, (file, prev) => {
    // 找书续章：未缓存章会先清空 content key；由 loading watch 暂停/恢复，勿退出定时滚动
    if (deps.pauseOnLoading && active.value) return;
    if (file === prev) return;
    stopTimedScroll();
  });
  watch(deps.readerEditMode, (ed) => {
    if (ed) stopTimedScroll();
  });
  watch(deps.loading, (ld) => {
    if (deps.pauseOnLoading && active.value) {
      if (ld) {
        clearTimer();
      } else {
        startTimer();
      }
      return;
    }
    if (ld) stopTimedScroll();
  });
  watch(deps.isVoiceReadActive, (vr) => {
    if (vr) stopTimedScroll();
  });
  watch(deps.viewportAtBottom, (atBottom) => {
    if (!atBottom || !active.value) return;
    if (deps.continueAtBottom && deps.canStartDespiteBottom?.()) return;
    stopTimedScroll();
  });

  onBeforeUnmount(() => stopTimedScroll());

  return {
    isTimedScrollActive: active,
    canStartTimedScroll,
    toggleTimedScroll,
    stopTimedScroll,
    nudgeTimedScrollTimer,
  };
}
