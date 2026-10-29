<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BOOK_SOURCE_HIGHLIGHT_DEBOUNCE_MS,
  BOOK_SOURCE_HIGHLIGHT_MAX_LEN,
  computeAutoIndentAfterNewline,
  escapeHtml,
  highlightBookSourceCode,
} from "../bookSource/highlightBookSourceCode";

const props = withDefaults(
  defineProps<{
    /** 自动增高上限（px）；超出后固定高度并在框内滚动 */
    maxHeight?: number;
    /** 为 false 时仅作普通自动增高 textarea（无叠层着色） */
    highlight?: boolean;
    placeholder?: string;
  }>(),
  {
    maxHeight: undefined,
    highlight: true,
    placeholder: "",
  },
);

const modelValue = defineModel<string>({ default: "" });

const overlayRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const highlightedHtml = ref("\n");
const focused = ref(false);
/** IME 合成期间显示原生文字，避免透明字导致候选不可见 */
const composing = ref(false);

let resizeObserver: ResizeObserver | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

/** 短文本立即着色；超过此长度时先明文再防抖着色，避免粘贴大段卡顿 */
const COLOR_DEBOUNCE_MIN_LEN = 2048;

function paintPlain(text: string) {
  highlightedHtml.value = `${escapeHtml(text)}\n`;
}

function paintColored(text: string) {
  if (!props.highlight) return;
  if (text && text.length <= BOOK_SOURCE_HIGHLIGHT_MAX_LEN) {
    highlightedHtml.value = `${highlightBookSourceCode(text)}\n`;
  } else {
    paintPlain(text);
  }
}

function clearHighlightTimer() {
  if (highlightTimer != null) {
    clearTimeout(highlightTimer);
    highlightTimer = null;
  }
}

/**
 * 输入即时可见：先画明文叠层；着色可同步（短）或防抖（长）。
 * 透明 textarea 本身看不见字，必须同步更新叠层。
 */
function scheduleHighlight(text: string) {
  if (!props.highlight) return;
  clearHighlightTimer();

  if (!text || text.length > BOOK_SOURCE_HIGHLIGHT_MAX_LEN) {
    paintPlain(text);
    return;
  }

  if (text.length <= COLOR_DEBOUNCE_MIN_LEN) {
    paintColored(text);
    return;
  }

  // 长文本：立刻明文，防抖后再着色
  paintPlain(text);
  highlightTimer = setTimeout(() => {
    highlightTimer = null;
    paintColored(text);
  }, BOOK_SOURCE_HIGHLIGHT_DEBOUNCE_MS);
}

function applyHighlight(text: string) {
  clearHighlightTimer();
  paintColored(text);
}

function syncOverlayScroll() {
  const ta = textareaRef.value;
  const ov = overlayRef.value;
  if (!ta || !ov) return;
  ov.scrollTop = ta.scrollTop;
  ov.scrollLeft = ta.scrollLeft;
}

/**
 * 将光标行滚入 textarea 视口（支持 pre-wrap 自动换行）。
 * resize 时 height 重置会打乱 scrollTop，换行后须显式对齐。
 */
function scrollCaretIntoView() {
  const ta = textareaRef.value;
  if (!ta) return;

  if (ta.scrollHeight <= ta.clientHeight + 1) {
    ta.scrollTop = 0;
    syncOverlayScroll();
    return;
  }

  const style = getComputedStyle(ta);
  const mirror = document.createElement("div");
  const ms = mirror.style;
  ms.position = "absolute";
  ms.visibility = "hidden";
  ms.overflow = "hidden";
  ms.whiteSpace = "pre-wrap";
  ms.overflowWrap = "break-word";
  ms.wordBreak = "break-word";
  ms.boxSizing = "border-box";
  ms.width = `${ta.clientWidth}px`;
  ms.padding = style.padding;
  ms.border = style.border;
  ms.font = style.font;
  ms.letterSpacing = style.letterSpacing;
  ms.lineHeight = style.lineHeight;
  ms.tabSize = style.tabSize;

  mirror.appendChild(document.createTextNode(ta.value.slice(0, ta.selectionEnd)));
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);

  const caretTop = mark.offsetTop;
  const lineHeight =
    mark.offsetHeight ||
    parseFloat(style.lineHeight) ||
    parseFloat(style.fontSize) * 1.45;
  mirror.remove();

  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  const viewTop = ta.scrollTop;
  const viewBottom = viewTop + ta.clientHeight - paddingBottom;

  if (caretTop < viewTop) {
    ta.scrollTop = caretTop;
  } else if (caretTop + lineHeight > viewBottom) {
    ta.scrollTop = caretTop + lineHeight - ta.clientHeight + paddingBottom;
  }
  syncOverlayScroll();
}

function resize() {
  const el = textareaRef.value;
  if (!el) return;
  const selStart = el.selectionStart;
  const selEnd = el.selectionEnd;

  el.style.overflowY = "hidden";
  el.style.height = "auto";
  const scrollHeight = el.scrollHeight;
  const maxHeight = props.maxHeight;
  if (maxHeight != null && scrollHeight > maxHeight) {
    el.style.height = `${maxHeight}px`;
    el.style.overflowY = "auto";
  } else {
    el.style.height = `${scrollHeight}px`;
    el.style.overflowY = "hidden";
  }

  // 测高可能打乱选区 / scrollTop；恢复选区后再滚到光标
  if (document.activeElement === el) {
    el.setSelectionRange(selStart, selEnd);
    scrollCaretIntoView();
  } else {
    syncOverlayScroll();
  }
}

function onInput() {
  void nextTick(resize);
}

function onScroll() {
  syncOverlayScroll();
}

function onCompositionStart() {
  composing.value = true;
}

function onCompositionEnd() {
  composing.value = false;
  applyHighlight(modelValue.value);
  void nextTick(resize);
}

/** Enter：插入换行并复制当前行缩进（对齐 legado-E CodeView） */
function onKeydown(ev: KeyboardEvent) {
  if (ev.key !== "Enter" || ev.isComposing || composing.value) return;
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;

  const ta = textareaRef.value;
  if (!ta) return;

  ev.preventDefault();
  const value = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const indent = computeAutoIndentAfterNewline(value, start);
  const insert = `\n${indent}`;
  const next = value.slice(0, start) + insert + value.slice(end);
  const caret = start + insert.length;

  modelValue.value = next;
  void nextTick(() => {
    ta.setSelectionRange(caret, caret);
    resize();
    // resize 末尾已 scrollCaretIntoView；再跑一帧以防布局未稳定
    requestAnimationFrame(() => {
      if (document.activeElement === ta) scrollCaretIntoView();
    });
  });
}

watch(
  modelValue,
  (text) => {
    scheduleHighlight(text);
    void nextTick(resize);
  },
  { immediate: true },
);

watch(
  () => props.highlight,
  () => {
    applyHighlight(modelValue.value);
    void nextTick(resize);
  },
);

watch(
  () => props.maxHeight,
  () => {
    void nextTick(resize);
  },
);

onMounted(() => {
  applyHighlight(modelValue.value);
  void nextTick(resize);
  const el = textareaRef.value;
  if (!el || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(el);
});

onBeforeUnmount(() => {
  clearHighlightTimer();
  resizeObserver?.disconnect();
  resizeObserver = null;
});

function focus() {
  textareaRef.value?.focus();
}

defineExpose({ resize, focus, textareaRef });
</script>

<template>
  <div
    class="highlightedCodeTextarea"
    :class="{
      'highlightedCodeTextarea--highlight': highlight,
      'highlightedCodeTextarea--focused': focused,
      'highlightedCodeTextarea--composing': composing,
    }"
  >
    <pre
      v-if="highlight"
      ref="overlayRef"
      class="highlightedCodeTextareaOverlay"
      aria-hidden="true"
    ><code v-html="highlightedHtml"></code></pre>
    <textarea
      ref="textareaRef"
      v-model="modelValue"
      class="highlightedCodeTextareaInput"
      rows="1"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      :placeholder="placeholder"
      @input="onInput"
      @keydown="onKeydown"
      @scroll="onScroll"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @focus="focused = true"
      @blur="focused = false"
    />
  </div>
</template>

<style scoped>
/*
  边框/背景只画在外壳上；textarea 与 pre 共用同一套内边距与字体度量，
  避免 border-box / content-box 不一致导致叠层偏移重影。
*/
.highlightedCodeTextarea {
  --hl-pad-y: 8px;
  --hl-pad-x: 10px;
  --hl-font-size: 13px;
  --hl-line-height: 1.45;

  position: relative;
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 6px;
  background: var(--input-bg, var(--panel, #fff));
}

.highlightedCodeTextarea--focused {
  border-color: var(--accent);
}

.highlightedCodeTextareaOverlay,
.highlightedCodeTextareaInput {
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: var(--hl-pad-y) var(--hl-pad-x) !important;
  border: 0 !important;
  border-radius: 0 !important;
  font-family: inherit !important;
  font-size: var(--hl-font-size) !important;
  font-style: normal;
  font-variant-ligatures: none;
  font-weight: 400;
  letter-spacing: normal;
  word-spacing: normal;
  line-height: var(--hl-line-height) !important;
  text-align: left;
  text-indent: 0;
  text-transform: none;
  text-rendering: auto;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  white-space: pre-wrap !important;
  overflow-wrap: break-word;
  word-break: break-word;
  tab-size: 2;
}

.highlightedCodeTextareaOverlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  color: var(--fg);
  background: transparent;
}

.highlightedCodeTextareaOverlay code {
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  word-spacing: inherit;
  line-height: inherit;
  white-space: inherit;
  overflow-wrap: inherit;
  word-break: inherit;
  tab-size: inherit;
}

.highlightedCodeTextareaInput {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  min-height: calc(
    var(--hl-font-size) * var(--hl-line-height) + 2 * var(--hl-pad-y)
  );
  background: transparent !important;
  color: var(--fg);
  caret-color: var(--fg);
  resize: none !important;
  overflow: hidden;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  user-select: text;
  -webkit-user-select: text;
}

.highlightedCodeTextarea--highlight .highlightedCodeTextareaInput {
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.highlightedCodeTextarea--highlight.highlightedCodeTextarea--composing
  .highlightedCodeTextareaInput {
  color: var(--fg);
  -webkit-text-fill-color: var(--fg);
}

.highlightedCodeTextarea--highlight.highlightedCodeTextarea--composing
  .highlightedCodeTextareaOverlay {
  visibility: hidden;
}

.highlightedCodeTextareaInput::selection {
  background: color-mix(in srgb, var(--accent) 35%, transparent);
  color: transparent;
  -webkit-text-fill-color: transparent;
}

/* 对齐 legado-E CodeView 色系，并用 CSS 变量适配亮暗主题 */
.highlightedCodeTextareaOverlay :deep(.bsHl-legado) {
  color: var(--bs-hl-legado, #e65100);
}
.highlightedCodeTextareaOverlay :deep(.bsHl-json) {
  color: var(--bs-hl-json, #1565c0);
}
.highlightedCodeTextareaOverlay :deep(.bsHl-jsWrap) {
  color: var(--bs-hl-js-wrap, #78909c);
}
.highlightedCodeTextareaOverlay :deep(.bsHl-jsOp) {
  color: var(--bs-hl-js-op, #e65100);
}
.highlightedCodeTextareaOverlay :deep(.bsHl-jsKw) {
  color: var(--bs-hl-js-kw, #039be5);
}
</style>
