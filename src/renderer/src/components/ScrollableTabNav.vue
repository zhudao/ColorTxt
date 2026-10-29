<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { icons } from "../icons";

const props = defineProps<{
  /** 当前激活项；变更时滚入可视区 */
  activeKey?: string | number | boolean | null;
  /** 标签内容变化时触发重新测量（如显隐 AI 扩展页） */
  contentKey?: string | number | boolean | null;
}>();

const navRef = useTemplateRef<HTMLElement>("navRef");
const isOverflow = ref(false);
const canScrollPrev = ref(false);
const canScrollNext = ref(false);

let resizeObserver: ResizeObserver | null = null;

function updateScrollState() {
  const el = navRef.value;
  if (!el) return;
  const { scrollLeft, scrollWidth, clientWidth } = el;
  isOverflow.value = scrollWidth > clientWidth + 1;
  canScrollPrev.value = scrollLeft > 1;
  canScrollNext.value = scrollLeft + clientWidth < scrollWidth - 1;
}

function scrollByPage(dir: -1 | 1) {
  const el = navRef.value;
  if (!el) return;
  const delta = Math.max(80, Math.floor(el.clientWidth * 0.75)) * dir;
  el.scrollBy({ left: delta, behavior: "smooth" });
}

function scrollActiveIntoView() {
  const el = navRef.value;
  if (!el) return;
  const active = el.querySelector<HTMLElement>(
    '[aria-selected="true"], .tabBtn.active',
  );
  if (!active) return;
  const navRect = el.getBoundingClientRect();
  const tabRect = active.getBoundingClientRect();
  const pad = 8;
  if (tabRect.left < navRect.left + pad) {
    el.scrollBy({
      left: tabRect.left - navRect.left - pad,
      behavior: "smooth",
    });
  } else if (tabRect.right > navRect.right - pad) {
    el.scrollBy({
      left: tabRect.right - navRect.right + pad,
      behavior: "smooth",
    });
  }
}

function onWheel(e: WheelEvent) {
  const el = navRef.value;
  if (!el || !isOverflow.value) return;
  // 纵向滚轮转为横向，便于窄宽下浏览标签
  if (Math.abs(e.deltaY) >= Math.abs(e.deltaX) && e.deltaY !== 0) {
    e.preventDefault();
    el.scrollLeft += e.deltaY;
    updateScrollState();
  }
}

function bindObservers() {
  resizeObserver?.disconnect();
  const el = navRef.value;
  if (!el) return;
  resizeObserver = new ResizeObserver(() => {
    updateScrollState();
  });
  resizeObserver.observe(el);
  const inner = el.firstElementChild;
  if (inner) resizeObserver.observe(inner);
  updateScrollState();
}

onMounted(() => {
  bindObservers();
  void nextTick(() => {
    updateScrollState();
    scrollActiveIntoView();
  });
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

watch(
  () => [props.activeKey, props.contentKey] as const,
  async () => {
    await nextTick();
    bindObservers();
    updateScrollState();
    scrollActiveIntoView();
  },
);
</script>

<template>
  <div
    class="scrollableTabNav"
    :class="{ 'scrollableTabNav--scrollable': isOverflow }"
  >
    <button
      v-show="isOverflow"
      type="button"
      class="scrollableTabNav__arrow"
      :disabled="!canScrollPrev"
      aria-label="向前滚动标签"
      title="向前"
      @click="scrollByPage(-1)"
    >
      <span
        class="scrollableTabNav__icon scrollableTabNav__icon--prev"
        v-html="icons.foldChevron"
      />
    </button>
    <div
      ref="navRef"
      class="scrollableTabNav__scroll"
      @scroll="updateScrollState"
      @wheel="onWheel"
    >
      <slot />
    </div>
    <button
      v-show="isOverflow"
      type="button"
      class="scrollableTabNav__arrow"
      :disabled="!canScrollNext"
      aria-label="向后滚动标签"
      title="向后"
      @click="scrollByPage(1)"
    >
      <span
        class="scrollableTabNav__icon scrollableTabNav__icon--next"
        v-html="icons.foldChevron"
      />
    </button>
  </div>
</template>

<style scoped>
.scrollableTabNav {
  display: flex;
  align-items: stretch;
  min-width: 0;
  width: 100%;
}

.scrollableTabNav__scroll {
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.scrollableTabNav__scroll::-webkit-scrollbar {
  display: none;
}

.scrollableTabNav__arrow {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  padding: 0;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--tab-fg, var(--fg));
  cursor: pointer;
}

.scrollableTabNav__arrow:hover:not(:disabled) {
  color: var(--tab-fg-hover, var(--accent));
}

.scrollableTabNav__arrow:disabled {
  opacity: 0.35;
  cursor: default;
}

.scrollableTabNav__icon {
  display: inline-flex;
  line-height: 0;
}

.scrollableTabNav__icon :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}

.scrollableTabNav__icon :deep(svg path) {
  fill: currentColor;
}

.scrollableTabNav__icon--prev :deep(svg) {
  transform: rotate(90deg);
}

.scrollableTabNav__icon--next :deep(svg) {
  transform: rotate(-90deg);
}
</style>
