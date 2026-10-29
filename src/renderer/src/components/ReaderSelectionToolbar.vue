<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { lineationColorAt } from "../constants/annotationColors";
import type { SelectionToolbarButtons } from "../constants/selectionToolbar";
import { icons } from "../icons";
import type {
  ReaderLineationType,
  ReaderAnnotationRecord,
} from "../stores/fileMetaStore";

type ToolbarAction =
  | "copy"
  | "highlight"
  | "marker"
  | "wavy"
  | "straight"
  | "note"
  | "find"
  | "dictionary"
  | "translate"
  | "askAi";

const props = withDefaults(
  defineProps<{
    toolbarVisible: boolean;
    colorPickerMode: null | "highlight" | "lineation";
    lineationPickerType: ReaderLineationType | null;
    floatCenterX: number;
    floatRootTop: number;
    openDownward: boolean;
    highlightColors: readonly string[];
    lineationColors: readonly string[];
    showHighlightRemoveRow: boolean;
    existingHighlightColorIndex: number | null;
    activeLineation?: ReaderAnnotationRecord["lineation"];
    lineationPickerSelectedIndex: number | null;
    monacoCustomHighlight: boolean;
    /**
     * 是否展示高亮词 / 划线 / 笔记按钮。
     * 找书阅读器为 false。
     */
    showSelectionAnnotationTools?: boolean;
    aiFeaturesEnabled: boolean;
    selectionToolbarButtons: SelectionToolbarButtons;
    hasLineation: boolean;
    hasNote: boolean;
  }>(),
  {
    showSelectionAnnotationTools: true,
  },
);

const floatRootEl = ref<HTMLElement | null>(null);
/** 色盘相对工具条中心的水平偏移，使色盘对准对应按钮 */
const pickerOffsetX = ref(0);
const PICKER_EDGE_MARGIN = 8;

function pickerAnchorAction(): string | null {
  if (props.colorPickerMode === "highlight") return "highlight";
  if (props.colorPickerMode === "lineation" && props.lineationPickerType) {
    return props.lineationPickerType;
  }
  return null;
}

function updatePickerOffset() {
  const root = floatRootEl.value;
  const action = pickerAnchorAction();
  if (!root || !action || !props.toolbarVisible || !props.colorPickerMode) {
    pickerOffsetX.value = 0;
    return;
  }
  const btn = root.querySelector(`[data-sel-action="${action}"]`);
  const picker = root.querySelector(".selPicker");
  if (!(btn instanceof HTMLElement) || !(picker instanceof HTMLElement)) {
    pickerOffsetX.value = 0;
    return;
  }
  const btnRect = btn.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  if (btnRect.width <= 0 || pickerRect.width <= 0) {
    pickerOffsetX.value = 0;
    return;
  }
  /**
   * 色盘在 flex 里相对根节点水平居中；`left` 为相对该自然位置的偏移。
   * 用「当前几何 − 已有 left」还原自然中心，避免重复叠加。
   */
  const pickerCenter = pickerRect.left + pickerRect.width / 2;
  const naturalCenter = pickerCenter - pickerOffsetX.value;
  const btnCenter = btnRect.left + btnRect.width / 2;
  let offset = btnCenter - naturalCenter;
  /** 钳制色盘不超出视口左右边 */
  const half = pickerRect.width / 2;
  const minCenter = PICKER_EDGE_MARGIN + half;
  const maxCenter = window.innerWidth - PICKER_EDGE_MARGIN - half;
  const desiredCenter = naturalCenter + offset;
  const clampedCenter = Math.min(maxCenter, Math.max(minCenter, desiredCenter));
  pickerOffsetX.value = clampedCenter - naturalCenter;
}

/** 父级 `v-if` 会整棵挂载；须 immediate，否则首次弹出不会算偏移 */
function schedulePickerOffsetUpdate() {
  void nextTick(() => {
    updatePickerOffset();
    requestAnimationFrame(() => {
      updatePickerOffset();
      requestAnimationFrame(() => updatePickerOffset());
    });
  });
}

watch(
  () =>
    [
      props.colorPickerMode,
      props.lineationPickerType,
      props.toolbarVisible,
      props.floatCenterX,
      props.showHighlightRemoveRow,
      props.hasLineation,
      props.highlightColors.length,
      props.lineationColors.length,
    ] as const,
  schedulePickerOffsetUpdate,
  { flush: "post", immediate: true },
);

onMounted(() => {
  schedulePickerOffsetUpdate();
});

const emit = defineEmits<{
  action: [action: ToolbarAction];
  highlightPickConfirm: [colorIndex: number];
  highlightPickRemove: [];
  lineationPickConfirm: [colorIndex: number];
  lineationPickRemove: [];
}>();

const showPickerRemove = computed(
  () =>
    (props.colorPickerMode === "highlight" && props.showHighlightRemoveRow) ||
    (props.colorPickerMode === "lineation" && props.hasLineation),
);

const lineationActions: Array<{
  id: "marker" | "wavy" | "straight";
  label: string;
  type: ReaderLineationType;
  shortcut: string;
}> = [
  { id: "marker", label: "马克笔", type: "marker", shortcut: "3" },
  { id: "wavy", label: "波浪线", type: "wavy", shortcut: "4" },
  { id: "straight", label: "直线", type: "straight", shortcut: "5" },
];

const pickerVisible = computed(
  () => props.toolbarVisible && props.colorPickerMode !== null,
);

const floatVisible = computed(
  () => props.toolbarVisible || pickerVisible.value,
);

function isLineationActive(type: ReaderLineationType): boolean {
  return props.activeLineation?.type === type;
}

function lineationAccent(type: ReaderLineationType): string | undefined {
  if (!isLineationActive(type)) return undefined;
  return lineationColorAt(
    props.activeLineation!.colorIndex ?? 0,
    props.lineationColors,
  );
}

function isHighlightActive(): boolean {
  const idx = props.existingHighlightColorIndex;
  return (
    props.colorPickerMode === "highlight" ||
    (idx != null && idx < props.highlightColors.length)
  );
}

function noteIconAccentStyle(): Record<string, string> | undefined {
  if (!props.hasNote || !props.activeLineation) return undefined;
  const color = lineationColorAt(
    props.activeLineation.colorIndex ?? 0,
    props.lineationColors,
  );
  return { color };
}

function onLineationAction(type: ReaderLineationType) {
  if (type === "marker") emit("action", "marker");
  else if (type === "wavy") emit("action", "wavy");
  else emit("action", "straight");
}

function isPickerSwatchSelected(index: number): boolean {
  if (props.colorPickerMode === "highlight") {
    return (
      props.existingHighlightColorIndex === index &&
      props.existingHighlightColorIndex < props.highlightColors.length
    );
  }
  return (
    props.lineationPickerSelectedIndex != null &&
    props.lineationPickerSelectedIndex === index
  );
}
</script>

<template>
  <div
    ref="floatRootEl"
    v-show="floatVisible"
    class="selFloatRoot"
    :class="{ selFloatRootDown: openDownward }"
    :style="{
      top: `${floatRootTop}px`,
      left: `${floatCenterX}px`,
    }"
  >
    <div
      v-show="pickerVisible"
      class="selPicker"
      :style="{
        '--picker-offset-x': `${pickerOffsetX}px`,
      }"
    >
      <div
        class="selPickerBody"
        :class="{ 'selPickerBody--withRemove': showPickerRemove }"
      >
        <div v-if="showPickerRemove" class="selPickerRemoveCol">
          <button
            type="button"
            class="selSwatch selRemoveKeyword"
            :aria-label="
              colorPickerMode === 'highlight' ? '移除该高亮词' : '移除划线'
            "
            @click="
              colorPickerMode === 'highlight'
                ? emit('highlightPickRemove')
                : emit('lineationPickRemove')
            "
          >
            <span
              class="selRemoveKeywordInner"
              aria-hidden="true"
              v-html="icons.clear"
            ></span>
          </button>
        </div>
        <div class="selSwatchRow selPickerColorsCol">
          <button
            v-for="(c, i) in colorPickerMode === 'highlight'
              ? highlightColors
              : lineationColors"
            :key="i"
            type="button"
            class="selSwatch"
            :aria-pressed="isPickerSwatchSelected(i)"
            :style="{ backgroundColor: c }"
            :aria-label="`使用颜色 ${i + 1}`"
            @click="
              colorPickerMode === 'highlight'
                ? emit('highlightPickConfirm', i)
                : emit('lineationPickConfirm', i)
            "
          >
            <span
              v-if="isPickerSwatchSelected(i)"
              class="selSwatchCheck"
              aria-hidden="true"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M3.5 8.2 6.5 11.2 12.5 4.8"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </div>

    <div v-show="toolbarVisible" class="selToolbar">
      <button
        v-if="selectionToolbarButtons.copy"
        type="button"
        class="selAction"
        aria-label="复制"
        @pointerdown.prevent="emit('action', 'copy')"
      >
        <span class="selActionShortcut" aria-hidden="true">1</span>
        <span class="selActionIcon" aria-hidden="true" v-html="icons.copy"></span>
        <span class="selActionLabel">复制</span>
      </button>
      <button
        v-if="showSelectionAnnotationTools && monacoCustomHighlight"
        type="button"
        class="selAction selAction--colorIcon"
        data-sel-action="highlight"
        :class="{ 'selAction--highlightActive': isHighlightActive() }"
        aria-label="高亮词"
        @pointerdown.prevent="emit('action', 'highlight')"
      >
        <span class="selActionShortcut" aria-hidden="true">2</span>
        <span
          class="selActionIcon"
          aria-hidden="true"
          v-html="icons.highlightMark"
        ></span>
        <span class="selActionLabel">高亮词</span>
      </button>
      <template v-if="showSelectionAnnotationTools">
        <button
          v-for="item in lineationActions"
          :key="item.id"
          type="button"
          class="selAction"
          :data-sel-action="item.type"
          :class="{ 'selAction--lineationActive': isLineationActive(item.type) }"
          :style="
            isLineationActive(item.type)
              ? ({ '--lineation-accent': lineationAccent(item.type) } as Record<
                  string,
                  string
                >)
              : undefined
          "
          :aria-label="item.label"
          @pointerdown.prevent="onLineationAction(item.type)"
        >
          <span class="selActionShortcut" aria-hidden="true">{{
            item.shortcut
          }}</span>
          <span
            class="selActionIcon selLineationIcon"
            :class="{
              'selLineationIcon--active': isLineationActive(item.type),
              'selLineationIcon--marker': item.type === 'marker',
              'selLineationIcon--wavy': item.type === 'wavy',
              'selLineationIcon--straight': item.type === 'straight',
            }"
            aria-hidden="true"
          >
            <span
              v-if="item.type === 'marker'"
              class="selLineationMarkerBg"
            ></span>
            <span
              v-if="item.type === 'wavy' || item.type === 'straight'"
              class="selLineationGlyphWrap"
            >
              <span class="selLineationGlyph" v-html="icons.fontFamily"></span>
              <svg
                v-if="item.type === 'wavy'"
                class="selLineationDeco selLineationDeco--wavy"
                viewBox="0 0 18 4"
                width="18"
                height="3"
                aria-hidden="true"
              >
                <path
                  d="M0 3Q1.8 1 3.6 3T7.2 3T10.8 3T14.4 3T18 3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <svg
                v-if="item.type === 'straight'"
                class="selLineationDeco selLineationDeco--straight"
                viewBox="0 0 16 2"
                width="16"
                height="2"
                aria-hidden="true"
              >
                <line
                  x1="0"
                  y1="1"
                  x2="16"
                  y2="1"
                  stroke="currentColor"
                  stroke-width="1.2"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <span
              v-else
              class="selLineationGlyph"
              v-html="icons.fontFamily"
            ></span>
          </span>
          <span class="selActionLabel">{{ item.label }}</span>
        </button>
        <button
          type="button"
          class="selAction"
          :class="{ 'selAction--noteActive': hasNote }"
          aria-label="记笔记"
          @pointerdown.prevent="emit('action', 'note')"
        >
          <span class="selActionShortcut" aria-hidden="true">6</span>
          <span
            class="selActionIcon"
            :style="noteIconAccentStyle()"
            aria-hidden="true"
            v-html="icons.note"
          ></span>
          <span class="selActionLabel">记笔记</span>
        </button>
      </template>
      <button
        v-if="selectionToolbarButtons.find"
        type="button"
        class="selAction"
        aria-label="查找"
        @pointerdown.prevent="emit('action', 'find')"
      >
        <span class="selActionShortcut" aria-hidden="true">7</span>
        <span
          class="selActionIcon"
          aria-hidden="true"
          v-html="icons.find"
        ></span>
        <span class="selActionLabel">查找</span>
      </button>
      <button
        v-if="selectionToolbarButtons.dictionary"
        type="button"
        class="selAction"
        aria-label="词典"
        @pointerdown.prevent="emit('action', 'dictionary')"
      >
        <span class="selActionShortcut" aria-hidden="true">8</span>
        <span
          class="selActionIcon"
          aria-hidden="true"
          v-html="icons.dictionary"
        ></span>
        <span class="selActionLabel">词典</span>
      </button>
      <button
        v-if="selectionToolbarButtons.translate"
        type="button"
        class="selAction"
        aria-label="翻译"
        @pointerdown.prevent="emit('action', 'translate')"
      >
        <span class="selActionShortcut" aria-hidden="true">9</span>
        <span
          class="selActionIcon"
          aria-hidden="true"
          v-html="icons.translate"
        ></span>
        <span class="selActionLabel">翻译</span>
      </button>
      <button
        v-if="aiFeaturesEnabled && selectionToolbarButtons.askAi"
        type="button"
        class="selAction"
        aria-label="问 AI"
        @pointerdown.prevent="emit('action', 'askAi')"
      >
        <span class="selActionShortcut" aria-hidden="true">0</span>
        <span class="selActionIcon" aria-hidden="true" v-html="icons.aiChat"></span>
        <span class="selActionLabel">问 AI</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.selFloatRoot {
  position: fixed;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  transform: translate(-50%, -100%);
}

.selFloatRootDown {
  flex-direction: column-reverse;
  transform: translate(-50%, 0);
}

.selToolbar,
.selPicker {
  pointer-events: auto;
}

.selToolbar,
.selPicker {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 4px 16px color-mix(in srgb, #000 18%, transparent);
}

.selToolbar {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
}

.selPicker {
  position: relative;
  left: var(--picker-offset-x, 0px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: fit-content;
  padding: 10px 12px;
}

.selPickerBody--withRemove {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  width: fit-content;
}

.selPickerRemoveCol {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.selPickerColorsCol {
  flex: 0 0 auto;
}

.selAction {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 44px;
  padding: 4px 2px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}

.selActionShortcut {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: var(--fg);
  color: var(--bg);
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  pointer-events: none;
  user-select: none;
}

.selAction:hover:not(:disabled) {
  background: var(--icon-btn-bg-hover);
}

.selAction--lineationActive,
.selAction--lineationActive:hover:not(:disabled),
.selAction--highlightActive,
.selAction--highlightActive:hover:not(:disabled),
.selAction--noteActive,
.selAction--noteActive:hover:not(:disabled) {
  background: var(--icon-btn-bg-hover);
}

.selAction:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.selActionIcon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  color: var(--fg);
  pointer-events: none;
}

.selActionIcon:not(.selLineationIcon) :deep(svg) {
  width: 20px;
  height: 20px;
  display: block;
}

.selAction:not(.selAction--colorIcon) .selActionIcon:not(.selLineationIcon) :deep(svg path) {
  fill: currentColor;
}

.selActionLabel {
  font-size: 10px;
  line-height: 1.1;
  white-space: nowrap;
  pointer-events: none;
}

.selLineationIcon {
  position: relative;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.selLineationIcon--wavy,
.selLineationIcon--straight {
  justify-content: center;
}

.selLineationMarkerBg {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: 3px;
  background: color-mix(in srgb, var(--icon-btn-bg-hover) 45%, var(--bg));
}

.selLineationIcon--active.selLineationIcon--marker .selLineationMarkerBg {
  background: color-mix(in srgb, var(--lineation-accent) 45%, transparent);
}

.selLineationGlyph {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: var(--fg);
}

.selLineationGlyph :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.selLineationGlyphWrap {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  line-height: 0;
  flex: 0 0 auto;
}

.selLineationIcon--wavy .selLineationGlyph :deep(svg),
.selLineationIcon--straight .selLineationGlyph :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
}

.selLineationGlyph :deep(svg path) {
  fill: currentColor;
}

.selLineationDeco {
  display: block;
  flex: 0 0 auto;
  width: 16px;
  color: var(--fg);
  overflow: visible;
}

.selLineationDeco--wavy {
  width: 18px;
  height: 3px;
  margin-top: -1px;
}

.selLineationDeco--straight {
  height: 2px;
}

.selLineationDeco path,
.selLineationDeco line {
  fill: none;
  stroke: currentColor;
  vector-effect: non-scaling-stroke;
}

.selLineationIcon--active .selLineationDeco {
  color: var(--lineation-accent);
}

/** 5 列色块：26×5 + 8×4 = 162px；超出则换行，width:fit-content 避免未满行时右侧空带 */
.selSwatchRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: fit-content;
  max-width: 162px;
}

.selSwatch {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 2px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
}

.selSwatch:hover {
  transform: scale(1.08);
}

/** 与色盘背景同色，视觉上等同镂空 */
.selSwatchCheck {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--bg);
  pointer-events: none;
}

.selSwatchCheck svg {
  width: 100%;
  height: 100%;
  display: block;
}

.selSwatch.selRemoveKeyword {
  border: none;
  padding: 0;
  overflow: hidden;
  background: var(--bg);
}

.selSwatch.selRemoveKeyword .selRemoveKeywordInner {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  pointer-events: none;
}

.selSwatch.selRemoveKeyword .selRemoveKeywordInner :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.selSwatch.selRemoveKeyword .selRemoveKeywordInner :deep(svg path) {
  fill: var(--danger);
}
</style>
