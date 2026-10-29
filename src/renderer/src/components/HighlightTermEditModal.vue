<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { icons } from "../icons";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";
import { useSortableReorder } from "../composables/useSortableReorder";
import { normalizeHighlightGroup, parseHighlightInputTerms } from "../utils/highlightWords";
import AppModal from "./AppModal.vue";
import AppCheckbox from "./AppCheckbox.vue";

const HL_SWATCH_SIZE = 26;
const HL_SWATCH_GAP = 8;
const HL_PICKER_PAD = 10;
const HL_PICKER_COLS = 5;
const HIGHLIGHT_COLOR_PICKER_W =
  HL_PICKER_PAD * 2 +
  HL_PICKER_COLS * HL_SWATCH_SIZE +
  (HL_PICKER_COLS - 1) * HL_SWATCH_GAP;
/** 须高于 AppModal（6000+），与 AppShellMenuTeleport 默认一致 */
const HIGHLIGHT_COLOR_PICKER_Z = 7200;

export type HighlightTermEditCommit = {
  mode: "add" | "edit";
  scope: "global" | "book";
  colorIndex: number;
  terms: string[];
  replaceStoredTerms?: string[];
};

const open = defineModel<boolean>("open", { default: false });

const props = withDefaults(
  defineProps<{
    mode: "add" | "edit";
    /** 编辑时原 scope；添加固定为 book */
    scope?: "global" | "book";
    initialTerms?: string[];
    initialColorIndex?: number;
    highlightColors: readonly string[];
    highlightPreviewBg?: string;
    monacoFontFamily?: string;
  }>(),
  {
    scope: "book",
    initialTerms: () => [],
    initialColorIndex: 0,
    highlightPreviewBg: "var(--reader-bg, var(--bg))",
    monacoFontFamily: "",
  },
);

const emit = defineEmits<{
  commit: [payload: HighlightTermEditCommit];
}>();

const draftTerms = ref<string[]>([]);
const draftColorIndex = ref(0);
const draftInput = ref("");
const splitOnCommit = ref(true);
const inputEl = ref<HTMLInputElement | null>(null);
const tagInputRef = ref<HTMLElement | null>(null);
const colorBtnRef = ref<HTMLButtonElement | null>(null);
const tagCount = computed(() => draftTerms.value.length);

useSortableReorder({
  containerRef: tagInputRef,
  draggable: ".hlTag",
  handle: false,
  filter: ".hlTagRemove, .hlTagField",
  preferDraggableIndex: true,
  active: open,
  itemCount: tagCount,
  enabled: computed(() => draftTerms.value.length > 1),
  onReorder(from, to) {
    if (from === to) return;
    const arr = draftTerms.value.slice();
    const [item] = arr.splice(from, 1);
    if (!item) return;
    arr.splice(to, 0, item);
    draftTerms.value = arr;
  },
});

const title = computed(() =>
  props.mode === "add" ? "添加高亮词" : "编辑高亮词",
);

const draftColor = computed(() => {
  const colors = props.highlightColors;
  const i = draftColorIndex.value;
  if (i >= 0 && i < colors.length) return colors[i]!;
  return "var(--fg)";
});

const canConfirm = computed(() => {
  if (props.mode === "add") {
    return normalizeHighlightGroup(draftTerms.value) != null;
  }
  // 编辑：空词组表示删除，允许确定
  return true;
});

const colorPicker = useAnchoredAppShellMenu({
  anchor: colorBtnRef,
  placement: "below-center",
  widthPx: HIGHLIGHT_COLOR_PICKER_W,
  gap: 6,
  zIndex: HIGHLIGHT_COLOR_PICKER_Z,
});
const {
  open: colorPickerOpen,
  left: colorPickerLeft,
  top: colorPickerTop,
  panelRef: colorPickerPanelRef,
  closeMenu: closeColorPicker,
  toggleMenu: toggleColorPicker,
} = colorPicker;

function bindColorPickerPanel(el: Element | { $el?: unknown } | null) {
  const node =
    el instanceof HTMLElement
      ? el
      : el &&
          typeof el === "object" &&
          "$el" in el &&
          el.$el instanceof HTMLElement
        ? el.$el
        : null;
  colorPickerPanelRef.value = node;
}

watch(open, (v) => {
  if (!v) {
    closeColorPicker();
    return;
  }
  draftTerms.value = [...props.initialTerms];
  const maxIdx = Math.max(0, props.highlightColors.length - 1);
  draftColorIndex.value = Math.min(
    Math.max(0, Math.floor(props.initialColorIndex)),
    maxIdx,
  );
  draftInput.value = "";
  splitOnCommit.value = true;
  void nextTick(() => inputEl.value?.focus());
});

function tryCommitInput() {
  const parts = parseHighlightInputTerms(draftInput.value, {
    split: splitOnCommit.value,
  });
  if (!parts.length) return;
  const next = draftTerms.value.slice();
  for (const t of parts) {
    if (!next.includes(t)) next.push(t);
  }
  draftTerms.value = next;
  draftInput.value = "";
}

function removeTag(index: number) {
  draftTerms.value = draftTerms.value.filter((_, i) => i !== index);
}

function onInputKeydown(ev: KeyboardEvent) {
  if (ev.isComposing) return;
  if (ev.key === "Enter" || ev.key === "Tab") {
    ev.preventDefault();
    tryCommitInput();
    return;
  }
  if (ev.key === "Backspace" && !draftInput.value && draftTerms.value.length) {
    ev.preventDefault();
    draftTerms.value = draftTerms.value.slice(0, -1);
  }
}

function onInputBlur() {
  tryCommitInput();
}

async function onColorBtnClick(ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  await toggleColorPicker();
}

function onPickColor(i: number) {
  if (i < 0 || i >= props.highlightColors.length) return;
  draftColorIndex.value = i;
}

function close() {
  open.value = false;
}

function onConfirm() {
  if (!canConfirm.value) return;
  const terms = normalizeHighlightGroup(draftTerms.value) ?? [];
  if (props.mode === "add" && terms.length === 0) return;
  emit("commit", {
    mode: props.mode,
    scope: props.mode === "add" ? "book" : props.scope,
    colorIndex: draftColorIndex.value,
    terms,
    replaceStoredTerms:
      props.mode === "edit" ? [...props.initialTerms] : undefined,
  });
  close();
}

function focusInput() {
  inputEl.value?.focus();
}
</script>

<template>
  <AppModal
    v-model="open"
    :title="title"
    max-width="480px"
    :mask-closable="false"
    :body-scroll="false"
  >
    <div class="hlEditRow">
      <div
        ref="tagInputRef"
        class="hlTagInput"
        :style="{ fontFamily: monacoFontFamily || undefined }"
        @click="focusInput"
      >
        <span
          v-for="(term, i) in draftTerms"
          :key="term"
          class="hlTag"
          :style="{
            backgroundColor: highlightPreviewBg,
            color: draftColor,
          }"
          :title="draftTerms.length > 1 ? '拖动调整顺序' : undefined"
        >
          <span class="hlTagText">{{ term }}</span>
          <button
            type="button"
            class="hlTagRemove"
            :style="{ color: draftColor }"
            title="移除"
            aria-label="移除"
            @click.stop="removeTag(i)"
          >
            <span class="hlTagRemoveIcon" aria-hidden="true" v-html="icons.close" />
          </button>
        </span>
        <input
          ref="inputEl"
          v-model="draftInput"
          class="hlTagField"
          type="text"
          :placeholder="
            draftTerms.length
              ? ''
              : '输入高亮词，回车或 Tab 添加'
          "
          @keydown="onInputKeydown"
          @blur="onInputBlur"
        />
      </div>
      <button
        ref="colorBtnRef"
        type="button"
        class="hlEditColorBtn"
        title="高亮色"
        aria-label="高亮色"
        :aria-expanded="colorPickerOpen ? 'true' : 'false'"
        @click="onColorBtnClick"
      >
        <span
          class="hlEditColorIcon"
          aria-hidden="true"
          v-html="icons.palette"
        />
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="colorPickerOpen"
        :ref="bindColorPickerPanel"
        class="hlEditColorPicker"
        data-fullscreen-sidebar-float
        role="dialog"
        aria-label="选择高亮色"
        :style="{
          left: `${colorPickerLeft}px`,
          top: `${colorPickerTop}px`,
          zIndex: HIGHLIGHT_COLOR_PICKER_Z,
          width: `${HIGHLIGHT_COLOR_PICKER_W}px`,
        }"
        @click.stop
      >
        <div class="hlEditSwatchRow">
          <button
            v-for="(c, i) in highlightColors"
            :key="i"
            type="button"
            class="hlEditSwatch"
            :class="{ 'hlEditSwatch--selected': draftColorIndex === i }"
            :style="{ backgroundColor: c }"
            :aria-label="`使用高亮色 ${i + 1}`"
            :title="`高亮色 ${i + 1}`"
            :aria-pressed="draftColorIndex === i ? 'true' : 'false'"
            @click="onPickColor(i)"
          />
        </div>
      </div>
    </Teleport>

    <template #footer>
      <div class="hlEditFooter">
        <AppCheckbox v-model="splitOnCommit" class="hlEditSplitCheck">
          <template #label>
            按
            <code class="hlEditSplitCode">、</code>
            <code class="hlEditSplitCode">,</code>
            <code class="hlEditSplitCode">，</code>
            <code class="hlEditSplitCode">;</code>
            <code class="hlEditSplitCode">；</code>
            切分
          </template>
        </AppCheckbox>
        <div class="hlEditFooterActions">
          <button class="btn" type="button" size="large" @click="close">
            取消
          </button>
          <button
            class="btn primary"
            type="button"
            size="large"
            :disabled="!canConfirm"
            @click="onConfirm"
          >
            确定
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.hlEditRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
}

.hlTagInput {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 36px;
  max-height: min(52vh, 420px);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  cursor: text;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
}

.hlTagInput:focus-within {
  border-color: var(--accent, var(--primary));
}

.hlTag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  padding: 2px 4px 2px 8px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.3;
  box-sizing: border-box;
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.hlTag:active {
  cursor: grabbing;
}

.hlTag.sortableRowGhost {
  opacity: 0.35;
  outline: 1px dashed var(--accent, var(--primary));
  outline-offset: 1px;
}

.hlTag.sortableRowChosen {
  opacity: 0.92;
}

.hlTag.sortableRowDrag {
  opacity: 0.88;
  box-shadow: 0 4px 12px color-mix(in srgb, #000 18%, transparent);
  cursor: grabbing;
}

.hlTagText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hlTagRemove {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.7;
}

.hlTagRemove:hover {
  opacity: 1;
}

.hlTagRemoveIcon {
  display: inline-flex;
  width: 10px;
  height: 10px;
}

.hlTagRemoveIcon :deep(svg) {
  width: 10px;
  height: 10px;
  display: block;
}

.hlTagRemoveIcon :deep(svg path) {
  fill: currentColor;
}

.hlTagField {
  flex: 1 1 80px;
  min-width: 80px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--fg);
  font-size: 14px;
  line-height: 1.4;
  padding: 2px 0;
  font-family: inherit;
}

.hlTagField::placeholder {
  font-family: var(--font-family) !important;
}

.hlEditColorBtn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.85;
}

.hlEditColorBtn:hover,
.hlEditColorBtn[aria-expanded="true"] {
  opacity: 1;
}

.hlEditColorIcon {
  display: inline-flex;
  width: 18px;
  height: 18px;
}

.hlEditColorIcon :deep(svg) {
  width: 18px;
  height: 18px;
  display: block;
}

.hlEditFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.hlEditSplitCheck {
  flex: 0 0 auto;
  width: fit-content;
  max-width: 100%;
  font-size: 13px;
  color: var(--fg);
}

.hlEditSplitCheck :deep(.appCheckbox) {
  width: fit-content;
  max-width: 100%;
}

.hlEditSplitCheck :deep(.appCheckbox__label) {
  font-size: 13px;
  line-height: 1.4;
  user-select: none;
}

.hlEditSplitCode {
  font-family: inherit;
  font-size: 12px;
  padding: 0 2px;
  margin: 0 4px;
  width: 18px;
  text-align: center;
  border-radius: 3px;
  background: color-mix(in srgb, var(--border) 55%, transparent);
  color: var(--fg);
  user-select: none;
}

.hlEditSplitCode + .hlEditSplitCode {
  margin-left: 0;
}

.hlEditFooterActions {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

.hlEditColorPicker {
  position: fixed;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 4px 16px color-mix(in srgb, #000 18%, transparent);
  box-sizing: border-box;
}

.hlEditSwatchRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: calc(5 * 26px + 4 * 8px);
}

.hlEditSwatch {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 2px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
}

.hlEditSwatch:hover {
  transform: scale(1.08);
}

.hlEditSwatch--selected {
  border-color: var(--bg);
  box-shadow: 0 0 0 2px var(--accent);
}
</style>
