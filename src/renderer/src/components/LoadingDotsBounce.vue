<script setup lang="ts">
import { computed } from "vue";
import loadingBounceIcon from "../assets/loading_dots_bounce.svg?raw";

const props = withDefaults(
  defineProps<{
    /** 宽高，数字视为 px；默认与正文字号贴近 */
    size?: string | number;
  }>(),
  { size: "1.15em" },
);

const sizeCss = computed(() =>
  typeof props.size === "number" ? `${props.size}px` : props.size,
);
</script>

<template>
  <span
    class="loadingDotsBounce"
    :style="{ width: sizeCss, height: sizeCss }"
    aria-hidden="true"
    v-html="loadingBounceIcon"
  />
</template>

<style scoped>
.loadingDotsBounce {
  display: inline-flex;
  flex-shrink: 0;
  color: inherit;
}
.loadingDotsBounce :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.loadingDotsBounce :deep(svg circle) {
  fill: currentColor;
}
</style>
