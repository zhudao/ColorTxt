<script setup lang="ts">
import { icons } from "../icons";

withDefaults(
  defineProps<{
    visible?: boolean;
    canGoPrev: boolean;
    canGoNext: boolean;
    disabled?: boolean;
    /** 全屏时固定于视口底部（找书阅读器正文区内使用） */
    fixed?: boolean;
  }>(),
  {
    visible: true,
    disabled: false,
    fixed: false,
  },
);

defineEmits<{
  prev: [];
  next: [];
  mouseleave: [MouseEvent];
}>();
</script>

<template>
  <footer
    v-show="visible"
    class="readerChapterNav"
    :class="{ 'readerChapterNav--fixed': fixed }"
    @mouseleave="$emit('mouseleave', $event)"
  >
    <div class="readerChapterNavInner">
      <button
        type="button"
        class="link readerChapterNavBtn readerChapterNavBtn--prev"
        :disabled="!canGoPrev || disabled"
        @click="$emit('prev')"
      >
        <span
          class="svg readerChapterNavBtnIcon"
          aria-hidden="true"
          v-html="icons.foldChevron"
        />
        <span class="readerChapterNavBtnLabel">上一章</span>
      </button>
      <span class="toolbarDivider" aria-hidden="true" />
      <button
        type="button"
        class="link readerChapterNavBtn readerChapterNavBtn--next"
        :disabled="!canGoNext || disabled"
        @click="$emit('next')"
      >
        <span class="readerChapterNavBtnLabel">下一章</span>
        <span
          class="svg readerChapterNavBtnIcon"
          aria-hidden="true"
          v-html="icons.foldChevron"
        />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.readerChapterNav {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: var(--bg);
  user-select: none;
}

.readerChapterNav--fixed {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3400;
  animation: readerChapterNavFixedIn 140ms ease-out;
}

.readerChapterNavInner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  width: 100%;
  box-sizing: border-box;
}

.readerChapterNavBtn {
  padding: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 14px;
}

.readerChapterNavBtn:not(:disabled):hover {
  text-decoration: none;
}

.readerChapterNavBtn .svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.readerChapterNavBtnIcon :deep(svg) {
  width: 16px;
  height: 16px;
}

.readerChapterNavBtn--prev .readerChapterNavBtnIcon :deep(svg) {
  transform: rotate(90deg);
}

.readerChapterNavBtn--next .readerChapterNavBtnIcon :deep(svg) {
  transform: rotate(-90deg);
}

.toolbarDivider {
  width: 1px;
  height: 22px;
  background: var(--border);
  flex-shrink: 0;
}

@keyframes readerChapterNavFixedIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
