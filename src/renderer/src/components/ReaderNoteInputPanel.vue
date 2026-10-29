<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { icons } from "../icons";
import { registerModal } from "../utils/modalStack";

const props = defineProps<{
  open: boolean;
  draft: string;
  sourceText: string;
  editing: boolean;
  monacoFontFamily: string;
}>();

const emit = defineEmits<{
  confirm: [content: string];
  close: [];
  deleteNote: [];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const localDraft = ref("");
const localSourceText = ref("");
const panelZIndex = ref(20);
let modalUnregister: (() => void) | null = null;

const displaySourceText = computed(() => localSourceText.value);

watch(
  () => props.open,
  async (open) => {
    if (open) {
      const reg = registerModal({
        close: () => emit("close"),
        getEscClosable: () => true,
        setZIndex: (z) => {
          panelZIndex.value = z;
        },
      });
      panelZIndex.value = reg.zIndex;
      modalUnregister = reg.unregister;
      localDraft.value = props.draft;
      localSourceText.value = props.sourceText;
      await focusInput();
    } else {
      modalUnregister?.();
      modalUnregister = null;
    }
  },
);

onBeforeUnmount(() => {
  modalUnregister?.();
});

watch(
  () => props.draft,
  (v) => {
    if (props.open) localDraft.value = v;
  },
);

watch(
  () => props.sourceText,
  (v) => {
    if (!props.open) return;
    localSourceText.value = v;
    void focusInput();
  },
);

function onConfirm() {
  const text = localDraft.value.trim();
  if (!text) return;
  emit("confirm", text);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}

async function focusInput() {
  await nextTick();
  textareaRef.value?.focus();
}
</script>

<template>
  <Transition name="notePanel">
    <div
      v-if="open"
      class="notePanelRoot"
      :style="{ zIndex: panelZIndex }"
    >
      <div class="notePanel" role="dialog" aria-label="记笔记">
      <div
        v-if="displaySourceText"
        class="notePanelQuote"
        :title="displaySourceText"
      >
        <span class="notePanelQuoteIcon" aria-hidden="true" v-html="icons.quote"></span>
        <span
          class="notePanelQuoteText"
          :style="{ fontFamily: monacoFontFamily }"
        >{{ displaySourceText }}</span>
      </div>
      <div class="notePanelBody">
        <span class="notePanelIcon" aria-hidden="true" v-html="icons.note"></span>
        <textarea
          ref="textareaRef"
          v-model="localDraft"
          class="notePanelInput"
          rows="3"
          placeholder="写下你的想法…"
          @keydown="onKeydown"
        />
      </div>
      <div class="notePanelFooter">
        <div v-if="editing" class="notePanelFooterStart">
          <span class="notePanelFooterIconSpacer" aria-hidden="true" />
          <button
            type="button"
            class="btn warning"
            @click="emit('deleteNote')"
          >
            删除笔记
          </button>
        </div>
        <span v-else class="notePanelSpacer" />
        <div class="notePanelActions">
          <button type="button" class="btn" @click="emit('close')">
            取消
          </button>
          <button
            type="button"
            class="btn primary"
            :disabled="!localDraft.trim()"
            @click="onConfirm"
          >
            确定
          </button>
        </div>
      </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.notePanelRoot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  padding: 0 12px 12px;
  pointer-events: none;
}

.notePanel {
  pointer-events: auto;
  position: relative;
  width: min(520px, 100%);
  margin: 0;
  padding: 15px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  box-shadow: 0 4px 16px color-mix(in srgb, #000 18%, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.notePanelBody {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.notePanelQuote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  min-width: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}

.notePanelQuoteIcon {
  flex-shrink: 0;
  display: inline-flex;
  width: 20px;
  height: 20px;
  color: var(--muted);
}

.notePanelQuoteIcon :deep(svg) {
  width: 20px;
  height: 20px;
  display: block;
}

.notePanelQuoteIcon :deep(svg path) {
  fill: currentColor;
}

.notePanelQuoteText {
  min-width: 0;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notePanelIcon {
  flex-shrink: 0;
  display: inline-flex;
  width: 20px;
  height: 20px;
  margin-top: 5px;
  color: var(--muted);
}

.notePanelIcon :deep(svg) {
  width: 20px;
  height: 20px;
  display: block;
}

.notePanelIcon :deep(svg path) {
  fill: currentColor;
}

.notePanelInput {
  flex: 1 1 auto;
  min-width: 0;
  min-height: calc(1.45em * 3 + 16px);
  max-height: 168px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--fg);
  font-size: 13px;
  line-height: 1.45;
  font-family: inherit;
  resize: none;
  outline: none;
  user-select: text;
  -webkit-user-select: text;
  transition: border-color 0.12s ease;
}

.notePanelInput:focus {
  border-color: var(--accent);
}

.notePanelFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notePanelFooterStart {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.notePanelFooterIconSpacer {
  flex-shrink: 0;
  width: 20px;
}

.notePanelSpacer {
  flex: 1;
}

.notePanelActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  flex-shrink: 0;
  margin-left: auto;
}

.notePanel-enter-active,
.notePanel-leave-active {
  transition: opacity 0.22s ease;
}

.notePanel-enter-active .notePanel,
.notePanel-leave-active .notePanel {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.notePanel-enter-from,
.notePanel-leave-to {
  opacity: 0;
}

.notePanel-enter-from .notePanel,
.notePanel-leave-to .notePanel {
  opacity: 0;
  transform: translateY(10px);
}

.notePanel-leave-active .notePanel {
  pointer-events: none;
}
</style>
