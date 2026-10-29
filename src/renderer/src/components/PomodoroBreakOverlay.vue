<script setup lang="ts">
defineProps<{
  visible: boolean;
  countdownText: string;
}>();

defineEmits<{
  finish: [];
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="pomodoroBreakFade">
      <div
        v-if="visible"
        class="pomodoroBreakOverlay"
        role="dialog"
        aria-modal="true"
        aria-label="休息一下"
      >
        <div class="pomodoroBreakPanel">
          <div class="pomodoroBreakTitle">休息一下</div>
          <div class="pomodoroBreakCountdown">{{ countdownText }}</div>
          <button
            type="button"
            class="link pomodoroBreakFinish"
            @click="$emit('finish')"
          >
            我休息好了
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pomodoroBreakOverlay {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 45%, transparent);
  backdrop-filter: blur(14px) saturate(1.1);
  -webkit-backdrop-filter: blur(14px) saturate(1.1);
  user-select: none;
}

.pomodoroBreakPanel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}

.pomodoroBreakTitle {
  font-size: 28px;
  font-weight: 600;
  color: var(--fg);
  line-height: 1.2;
}

.pomodoroBreakCountdown {
  font-size: 40px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--fg);
  line-height: 1.1;
}

.pomodoroBreakFinish {
  font-size: 16px;
  line-height: 1.2;
}

.pomodoroBreakFade-enter-active,
.pomodoroBreakFade-leave-active {
  transition:
    opacity 320ms ease,
    backdrop-filter 320ms ease,
    -webkit-backdrop-filter 320ms ease;
}

.pomodoroBreakFade-enter-active .pomodoroBreakPanel,
.pomodoroBreakFade-leave-active .pomodoroBreakPanel {
  transition:
    opacity 320ms ease,
    transform 320ms ease;
}

.pomodoroBreakFade-enter-from,
.pomodoroBreakFade-leave-to {
  opacity: 0;
  backdrop-filter: blur(0) saturate(1);
  -webkit-backdrop-filter: blur(0) saturate(1);
}

.pomodoroBreakFade-enter-from .pomodoroBreakPanel,
.pomodoroBreakFade-leave-to .pomodoroBreakPanel {
  opacity: 0;
  transform: translateY(8px);
}
</style>
