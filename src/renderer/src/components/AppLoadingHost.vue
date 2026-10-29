<script setup lang="ts">
import { appLoadingModel } from "../services/appLoading";
import LoadingDotsBounce from "./LoadingDotsBounce.vue";

/** 高于常规 AppModal（6000+），与目录扫描蒙层同级，挡住操作防重复点击 */
const Z_INDEX = 10000;
</script>

<template>
  <Transition name="appLoadingOverlay">
    <div
      v-if="appLoadingModel.open"
      class="appLoadingOverlay"
      :style="{ zIndex: Z_INDEX }"
      aria-live="polite"
      aria-busy="true"
      role="status"
    >
      <p class="appLoadingLine">
        <span class="appLoadingHint">
          {{ appLoadingModel.message }}<LoadingDotsBounce />
        </span>
      </p>
    </div>
  </Transition>
</template>

<style scoped>
.appLoadingOverlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.appLoadingLine {
  margin: 0;
  max-width: min(92vw, 720px);
  padding: 6px 10px;
  border-radius: 4px;
  background-color: var(--bg);
  color: var(--fg);
  font-size: 12px;
  text-align: center;
}

.appLoadingHint {
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
}

.appLoadingOverlay-enter-active,
.appLoadingOverlay-leave-active {
  transition: opacity 0.2s ease;
}
.appLoadingOverlay-enter-from,
.appLoadingOverlay-leave-to {
  opacity: 0;
}
</style>
