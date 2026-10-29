<script setup lang="ts">
import { computed } from "vue";
import loadingIcon from "../assets/loading_dots_rotate.svg?raw";

const props = withDefaults(
  defineProps<{
    /** 宽高，数字视为 px */
    size?: string | number;
  }>(),
  { size: 14 },
);

const sizeCss = computed(() =>
  typeof props.size === "number" ? `${props.size}px` : props.size,
);
</script>

<template>
  <span
    class="loadingDotsRotate"
    :style="{ width: sizeCss, height: sizeCss }"
    aria-hidden="true"
    v-html="loadingIcon"
  />
</template>

<style scoped>
.loadingDotsRotate {
  display: inline-flex;
  flex-shrink: 0;
  color: inherit;
}
.loadingDotsRotate :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.loadingDotsRotate :deep(svg circle) {
  fill: currentColor;
}
</style>
