<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppModal from "./AppModal.vue";

const MIN_ROWS = 3;
const MAX_ROWS = 10;

const props = defineProps<{
  open: boolean;
  draft: string;
  monacoFontFamily: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  confirm: [content: string];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const localDraft = ref("");
const openModel = ref(false);

function syncTextareaHeight() {
  const el = textareaRef.value;
  if (!el) return;
  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 14;
  const lineHeightPx =
    style.lineHeight === "normal"
      ? fontSize * 1.55
      : parseFloat(style.lineHeight) || fontSize * 1.55;
  const padY =
    (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const borderY =
    (parseFloat(style.borderTopWidth) || 0) +
    (parseFloat(style.borderBottomWidth) || 0);
  const minH = lineHeightPx * MIN_ROWS + padY + borderY;
  const maxH = lineHeightPx * MAX_ROWS + padY + borderY;

  el.style.overflowY = "hidden";
  el.style.height = "0px";
  const contentH = el.scrollHeight;
  const next = Math.min(maxH, Math.max(minH, contentH));
  el.style.height = `${next}px`;
  el.style.overflowY = contentH > maxH + 0.5 ? "auto" : "hidden";
}

watch(
  () => props.open,
  async (open) => {
    openModel.value = open;
    if (!open) return;
    localDraft.value = props.draft;
    await nextTick();
    syncTextareaHeight();
    const el = textareaRef.value;
    if (!el) return;
    el.focus();
    el.select();
  },
);

watch(localDraft, async () => {
  if (!openModel.value) return;
  await nextTick();
  syncTextareaHeight();
});

watch(openModel, (open) => {
  if (open !== props.open) emit("update:open", open);
});

onBeforeUnmount(() => {
  openModel.value = false;
});

function onConfirm() {
  emit("confirm", localDraft.value);
}

function onTextareaKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    onConfirm();
  }
}
</script>

<template>
  <AppModal
    v-model="openModel"
    title="编辑选中文本"
    max-width="560px"
    :mask-closable="false"
    :esc-closable="true"
  >
    <div class="partialEditBody">
      <textarea
        ref="textareaRef"
        v-model="localDraft"
        class="partialEditInput"
        :rows="MIN_ROWS"
        spellcheck="false"
        :style="{ fontFamily: monacoFontFamily }"
        aria-label="编辑选中文本"
        @keydown="onTextareaKeydown"
      />
    </div>
    <template #footer>
      <div class="partialEditFooter">
        <button type="button" class="btn" size="large" @click="openModel = false">
          取消
        </button>
        <button
          type="button"
          class="btn primary"
          size="large"
          @click="onConfirm"
        >
          确定
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.partialEditBody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 0;
}

.partialEditInput {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  overflow-x: hidden;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 14px;
  line-height: 1.55;
  outline: none;
}

.partialEditInput:focus {
  border-color: var(--accent, var(--focus-border, #0e639c));
}

.partialEditFooter {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
