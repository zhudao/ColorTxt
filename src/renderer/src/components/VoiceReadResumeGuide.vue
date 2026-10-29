<script setup lang="ts">
import { icons } from "../icons";

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  resume: [];
}>();
</script>

<template>
  <div
    v-if="visible"
    class="voiceReadResumeGuide"
    role="presentation"
    aria-hidden="false"
  >
    <div class="voiceReadResumeGuideRow">
      <div class="voiceReadResumeGuideLine" aria-hidden="true" />
      <button
        type="button"
        class="voiceReadResumeGuidePlay"
        title="从该行开始播放"
        aria-label="从视口中心行开始播放"
        @click="emit('resume')"
      >
        <span class="voiceReadResumeGuidePlayIcon" v-html="icons.play" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.voiceReadResumeGuide {
  position: absolute;
  inset: 0;
  z-index: 55;
  pointer-events: none;
}

.voiceReadResumeGuideRow {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
}

.voiceReadResumeGuideLine {
  flex: 1;
  min-width: 0;
  height: 0;
  border-top: 2px dotted var(--primary);
}

.voiceReadResumeGuidePlay {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 2px 10px color-mix(in srgb, #000 18%, transparent);
  cursor: pointer;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.16s ease,
    transform 0.12s ease;
}

.voiceReadResumeGuidePlay:hover {
  background: var(--primary-hover);
  transform: scale(1.06);
}

.voiceReadResumeGuidePlayIcon {
  width: 18px;
  height: 18px;
  display: inline-flex;
  color: #ffffff;
}

.voiceReadResumeGuidePlayIcon :deep(svg) {
  width: 18px;
  height: 18px;
  display: block;
}

.voiceReadResumeGuidePlayIcon :deep(svg path) {
  fill: currentColor;
}
</style>
