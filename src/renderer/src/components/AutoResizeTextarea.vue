<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    /** 自动增高上限（px）；超出后固定高度并在框内滚动 */
    maxHeight?: number;
  }>(),
  {
    maxHeight: undefined,
  },
);

const modelValue = defineModel<string>({ default: "" });

const textareaRef = ref<HTMLTextAreaElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

function resize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.overflowY = "hidden";
  el.style.height = "0px";
  const scrollHeight = el.scrollHeight;
  const maxHeight = props.maxHeight;
  if (maxHeight != null && scrollHeight > maxHeight) {
    el.style.height = `${maxHeight}px`;
    el.style.overflowY = "auto";
  } else {
    el.style.height = `${scrollHeight}px`;
    el.style.overflowY = "hidden";
  }
}

watch(modelValue, () => {
  void nextTick(resize);
});

watch(
  () => props.maxHeight,
  () => {
    void nextTick(resize);
  },
);

onMounted(() => {
  void nextTick(resize);
  const el = textareaRef.value;
  if (!el || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(el);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

function focus() {
  textareaRef.value?.focus();
}

defineExpose({ resize, focus, textareaRef });
</script>

<template>
  <textarea
    ref="textareaRef"
    v-model="modelValue"
    class="autoResizeTextarea"
    rows="1"
    @input="resize"
  />
</template>

<style scoped>
.autoResizeTextarea {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: calc(1.45em + 16px);
  padding: 8px 10px;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 6px;
  background: var(--input-bg, var(--panel, #fff));
  color: var(--fg);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
  resize: none;
  overflow: hidden;
  outline: none;
  user-select: text;
  -webkit-user-select: text;
}

.autoResizeTextarea:focus {
  border-color: var(--accent);
}
</style>
