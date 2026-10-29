<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    /** 是否显示系统时间 */
    visible: boolean;
    /** 是否显示番茄倒计时饼图（纯展示） */
    pomodoroVisible?: boolean;
    pomodoroProgress?: number;
    pomodoroPaused?: boolean;
  }>(),
  {
    pomodoroVisible: false,
    pomodoroProgress: 0,
    pomodoroPaused: false,
  },
);

const timeText = ref("");
let alignTimer: number | null = null;
let minuteTimer: number | null = null;

const showRoot = computed(() => props.visible || props.pomodoroVisible);

const pieStyle = computed(() => {
  const remainingPct = Math.min(100, Math.max(0, props.pomodoroProgress * 100));
  const elapsedPct = 100 - remainingPct;
  return {
    background: `conic-gradient(
      color-mix(in srgb, var(--reader-body-text) 22%, transparent) ${elapsedPct}%,
      color-mix(in srgb, var(--reader-body-text) 50%, transparent) 0
    )`,
  };
});

function formatNow(): string {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function tick() {
  timeText.value = formatNow();
}

function clearTimers() {
  if (alignTimer != null) {
    window.clearTimeout(alignTimer);
    alignTimer = null;
  }
  if (minuteTimer != null) {
    window.clearInterval(minuteTimer);
    minuteTimer = null;
  }
}

function start() {
  tick();
  clearTimers();
  const msToNextMinute = 60_000 - (Date.now() % 60_000);
  alignTimer = window.setTimeout(() => {
    alignTimer = null;
    tick();
    minuteTimer = window.setInterval(tick, 60_000);
  }, msToNextMinute);
}

function stop() {
  clearTimers();
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) start();
    else stop();
  },
  { immediate: true },
);

onUnmounted(stop);
</script>

<template>
  <div
    v-if="showRoot"
    class="fullscreenSystemClock"
    aria-hidden="true"
  >
    <span
      v-if="pomodoroVisible"
      class="fullscreenPomodoroPie"
      :class="{ paused: pomodoroPaused }"
      :style="pieStyle"
    />
    <span v-if="visible" class="fullscreenSystemClockText">{{ timeText }}</span>
  </div>
</template>

<style scoped>
.fullscreenSystemClock {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 40;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  background: transparent;
  color: color-mix(in srgb, var(--reader-body-text) 50%, transparent);
  user-select: none;
}

.fullscreenPomodoroPie {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--reader-body-text) 18%, transparent);
}

.fullscreenPomodoroPie.paused {
  opacity: 0.55;
}

.fullscreenSystemClockText {
  flex-shrink: 0;
}
</style>
