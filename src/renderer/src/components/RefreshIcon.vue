<script setup lang="ts">
import { computed } from "vue";
import refreshIcon from "../assets/refresh.svg?raw";

const props = withDefaults(
  defineProps<{
    /** 宽高，数字视为 px */
    size?: string | number;
    /** 旋转态（加载中） */
    spinning?: boolean;
  }>(),
  { size: 16, spinning: false },
);

const sizeCss = computed(() =>
  typeof props.size === "number" ? `${props.size}px` : props.size,
);
</script>

<template>
  <span
    class="refreshIcon"
    :class="{ 'refreshIcon--spinning': spinning }"
    :style="{ width: sizeCss, height: sizeCss }"
    aria-hidden="true"
    v-html="refreshIcon"
  />
</template>

<style scoped>
.refreshIcon {
  display: inline-flex;
  flex-shrink: 0;
  color: inherit;
}
.refreshIcon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.refreshIcon :deep(svg path) {
  fill: currentColor;
}
.refreshIcon--spinning :deep(svg) {
  animation: refreshIconSpin 0.65s linear infinite;
}
@keyframes refreshIconSpin {
  to {
    transform: rotate(360deg);
  }
}
</style>
