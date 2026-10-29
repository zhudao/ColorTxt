<script setup lang="ts">
import { computed } from "vue";
import { icons } from "../icons";
import type { PomodoroDisplayMode, PomodoroPhase } from "../composables/usePomodoroTimer";

const props = defineProps<{
  phase: PomodoroPhase;
  displayMode: PomodoroDisplayMode;
  progress: number;
  countdownText: string;
  pauseResumeLabel: string;
  paused: boolean;
}>();

const emit = defineEmits<{
  start: [];
  toggleDisplayMode: [];
  togglePause: [];
  stop: [];
}>();

/** 已流逝比例从 12 点顺时针增长，剩余扇区随之顺时针缩小 */
const pieStyle = computed(() => {
  const remainingPct = Math.min(100, Math.max(0, props.progress * 100));
  const elapsedPct = 100 - remainingPct;
  return {
    background: `conic-gradient(var(--border) ${elapsedPct}%, var(--accent) 0)`,
  };
});

function onPieClick() {
  emit("toggleDisplayMode");
}
</script>

<template>
  <div class="pomodoroFooterControl" @click.stop>
    <button
      v-if="phase === 'idle'"
      type="button"
      class="pomodoroStartBtn"
      title="开始番茄时钟"
      aria-label="开始番茄时钟"
      @click="emit('start')"
    >
      <span class="pomodoroStartIcon" v-html="icons.history" />
    </button>
    <template v-else>
      <button
        type="button"
        class="pomodoroPieBtn"
        :title="displayMode === 'pie' ? '展开番茄时钟' : '收起番茄时钟'"
        :aria-label="displayMode === 'pie' ? '展开番茄时钟' : '收起番茄时钟'"
        @click="onPieClick"
      >
        <span class="pomodoroPie" :style="pieStyle" :class="{ paused }" />
      </button>
      <Transition name="pomodoroExpand">
        <div
          v-if="displayMode === 'expanded'"
          class="pomodoroExpanded"
        >
          <span class="pomodoroCountdown">{{ countdownText }}</span>
          <button
            type="button"
            class="link pomodoroAction"
            :class="paused ? 'pomodoroAction--primary' : 'pomodoroAction--warning'"
            @click="emit('togglePause')"
          >
            {{ pauseResumeLabel }}
          </button>
          <button
            type="button"
            class="link pomodoroAction pomodoroAction--danger"
            @click="emit('stop')"
          >
            停止
          </button>
          <span class="pomodoroDivider" aria-hidden="true" />
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.pomodoroFooterControl {
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
  font-size: 12px;
  color: var(--muted);
}

.pomodoroStartBtn,
.pomodoroPieBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
}

.pomodoroStartBtn:hover,
.pomodoroPieBtn:hover {
  color: var(--accent);
}

.pomodoroStartIcon {
  display: inline-flex;
  width: 16px;
  height: 16px;
}

.pomodoroStartIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.pomodoroStartIcon :deep(path) {
  fill: currentColor;
}

.pomodoroPie {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: block;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 80%, transparent);
}

.pomodoroPie.paused {
  opacity: 0.55;
}

.pomodoroExpanded {
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  gap: 8px;
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  white-space: nowrap;
}

.pomodoroExpand-enter-active,
.pomodoroExpand-leave-active {
  transition:
    max-width 220ms ease,
    opacity 180ms ease,
    margin-left 220ms ease;
}

.pomodoroExpand-enter-from,
.pomodoroExpand-leave-to {
  max-width: 0;
  opacity: 0;
  margin-left: -8px;
}

.pomodoroCountdown {
  font-variant-numeric: tabular-nums;
  color: var(--fg);
  flex-shrink: 0;
}

.pomodoroAction {
  font-size: 12px;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
}

.pomodoroAction--warning {
  color: var(--warning);
}

.pomodoroAction--warning:not(:disabled):hover {
  color: var(--warning-hover);
}

.pomodoroAction--primary {
  color: var(--accent);
}

.pomodoroAction--primary:not(:disabled):hover {
  color: var(--accent-hover);
}

.pomodoroAction--danger {
  color: var(--danger);
}

.pomodoroAction--danger:not(:disabled):hover {
  color: var(--danger-hover);
}

.pomodoroDivider {
  width: 1px;
  align-self: stretch;
  background: var(--border);
  flex-shrink: 0;
  margin-left: 2px;
}
</style>
