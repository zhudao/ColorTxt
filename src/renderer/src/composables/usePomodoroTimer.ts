import { computed, onUnmounted, ref, watch, type Ref } from "vue";
import {
  mergePomodoroSettings,
  pomodoroLongBreakEvery,
  type PomodoroSettings,
} from "../constants/pomodoro";

export type PomodoroPhase = "idle" | "focus" | "break";
export type PomodoroDisplayMode = "pie" | "expanded";

export function formatPomodoroCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function usePomodoroTimer(settings: Ref<PomodoroSettings>) {
  const phase = ref<PomodoroPhase>("idle");
  const paused = ref(false);
  const displayMode = ref<PomodoroDisplayMode>("pie");
  /** 已完成的阅读轮数（进入休息前 +1；长休息后清零） */
  const completedFocusCount = ref(0);
  const remainingMs = ref(0);
  const totalMs = ref(0);
  const breakIsLong = ref(false);

  let endsAtMs = 0;
  let tickTimer: number | null = null;

  const isRunning = computed(() => phase.value !== "idle");
  const showBreakOverlay = computed(() => phase.value === "break");
  const progress = computed(() => {
    const total = totalMs.value;
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, remainingMs.value / total));
  });
  const countdownText = computed(() => formatPomodoroCountdown(remainingMs.value));
  const pauseResumeLabel = computed(() => (paused.value ? "继续" : "暂停"));

  function clearTick() {
    if (tickTimer != null) {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function syncRemainingFromClock() {
    if (paused.value || phase.value === "idle") return;
    remainingMs.value = Math.max(0, endsAtMs - Date.now());
    if (remainingMs.value <= 0) {
      remainingMs.value = 0;
      onSegmentEnded();
    }
  }

  function startTick() {
    clearTick();
    tickTimer = window.setInterval(syncRemainingFromClock, 250);
  }

  function beginSegment(next: "focus" | "break", durationMinutes: number) {
    const ms = Math.max(1, durationMinutes) * 60_000;
    phase.value = next;
    paused.value = false;
    totalMs.value = ms;
    remainingMs.value = ms;
    endsAtMs = Date.now() + ms;
    startTick();
  }

  function onSegmentEnded() {
    clearTick();
    if (phase.value === "focus") {
      completedFocusCount.value += 1;
      const useLong =
        completedFocusCount.value % pomodoroLongBreakEvery === 0;
      breakIsLong.value = useLong;
      const s = mergePomodoroSettings(settings.value);
      beginSegment(
        "break",
        useLong ? s.longBreakMinutes : s.shortBreakMinutes,
      );
      if (useLong) completedFocusCount.value = 0;
      return;
    }
    if (phase.value === "break") {
      resetToIdle();
    }
  }

  function resetToIdle() {
    clearTick();
    phase.value = "idle";
    paused.value = false;
    remainingMs.value = 0;
    totalMs.value = 0;
    endsAtMs = 0;
    breakIsLong.value = false;
    displayMode.value = "pie";
  }

  function start() {
    if (!settings.value.enabled) return;
    if (phase.value !== "idle") return;
    const s = mergePomodoroSettings(settings.value);
    beginSegment("focus", s.focusMinutes);
  }

  function pause() {
    if (phase.value === "idle" || paused.value) return;
    paused.value = true;
    remainingMs.value = Math.max(0, endsAtMs - Date.now());
    clearTick();
  }

  function resume() {
    if (phase.value === "idle" || !paused.value) return;
    paused.value = false;
    endsAtMs = Date.now() + remainingMs.value;
    startTick();
  }

  function togglePause() {
    if (paused.value) resume();
    else pause();
  }

  function stop() {
    resetToIdle();
  }

  function toggleDisplayMode() {
    if (phase.value === "idle") return;
    displayMode.value = displayMode.value === "pie" ? "expanded" : "pie";
  }

  /** 休息覆盖层：「我休息好了」——结束休息回到空闲 */
  function finishBreakEarly() {
    if (phase.value !== "break") return;
    resetToIdle();
  }

  watch(
    () => settings.value.enabled,
    (enabled) => {
      if (!enabled) stop();
    },
  );

  onUnmounted(() => {
    clearTick();
  });

  return {
    phase,
    paused,
    displayMode,
    completedFocusCount,
    remainingMs,
    totalMs,
    breakIsLong,
    isRunning,
    showBreakOverlay,
    progress,
    countdownText,
    pauseResumeLabel,
    start,
    pause,
    resume,
    togglePause,
    stop,
    toggleDisplayMode,
    finishBreakEarly,
  };
}
