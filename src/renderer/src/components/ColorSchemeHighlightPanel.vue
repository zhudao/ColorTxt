<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import HexColorPickerField from "./HexColorPickerField.vue";
import IconButton from "./IconButton.vue";
import { icons } from "../icons";
import {
  SORTABLE_ROW_HANDLE_CLASS,
  useSortableReorder,
} from "../composables/useSortableReorder";

export type HighlightColorRow = { id: string; color: string };

const props = defineProps<{
  rows: HighlightColorRow[];
  previewHexes: string[];
  highlightReaderBg: string;
  bodyTextColor: string;
  monacoFontFamily: string;
  minHighlightColors: number;
}>();

const emit = defineEmits<{
  "update-color": [index: number, color: string];
  "draft-hex": [index: number, hex: string];
  "draft-end": [];
  reorder: [fromIndex: number, toIndex: number];
  remove: [index: number];
  add: [];
}>();

const tableScrollEl = ref<HTMLElement | null>(null);
const tableBodyRef = ref<HTMLElement | null>(null);
const rowCount = computed(() => props.rows.length);

const { remount: remountHighlightSortable } = useSortableReorder({
  containerRef: tableBodyRef,
  itemCount: rowCount,
  enabled: computed(() => props.rows.length > 1),
  onReorder(from, to) {
    emit("reorder", from, to);
    remountHighlightSortable();
  },
});

async function onAddClick() {
  emit("add");
  await nextTick();
  const el = tableScrollEl.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}
</script>

<template>
  <div class="colorSchemeHighlight" role="tabpanel">
    <div ref="tableScrollEl" class="schemePanelTableScroll">
      <table class="highlightTable" :class="{ 'hasScrollBar': rows.length >= 6 }">
        <tbody ref="tableBodyRef">
          <tr v-for="(row, rowIdx) in rows" :key="row.id">
            <td class="hlColLabel colorSchemeRowLabel">
              高亮色 {{ rowIdx + 1 }}
            </td>
            <td class="hlColPicker">
              <HexColorPickerField
                :model-value="row.color"
                @update:model-value="emit('update-color', rowIdx, $event)"
                @draft-hex="emit('draft-hex', rowIdx, $event)"
                @draft-end="emit('draft-end')"
              />
            </td>
            <td class="hlColPreview">
              <div
                class="hlPreviewBox"
                :style="{
                  backgroundColor: highlightReaderBg,
                  fontFamily: monacoFontFamily,
                }"
              >
                <span :style="{ color: bodyTextColor }">这是</span
                ><span :style="{ color: previewHexes[rowIdx] }">高亮</span
                ><span :style="{ color: bodyTextColor }">示例</span>
              </div>
            </td>
            <td class="hlColActions">
              <div class="hlActionsInner">
                <IconButton
                  :class="SORTABLE_ROW_HANDLE_CLASS"
                  :icon-html="icons.move"
                  aria-label="拖动排序"
                  title="拖动排序"
                  :disabled="rows.length <= 1"
                />
                <IconButton
                  :class="{ invisible: rows.length <= minHighlightColors }"
                  :icon-html="icons.remove"
                  aria-label="删除"
                  title="删除"
                  @click="emit('remove', rowIdx)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button
      type="button"
      class="btn highlightAddBtn"
      size="large"
      aria-label="新增高亮色"
      title="新增高亮色"
      @click="onAddClick"
    >
      <span class="highlightAddBtnIcon" aria-hidden="true" v-html="icons.add"></span>
    </button>
  </div>
</template>

<style scoped>
.colorSchemeRowLabel {
  font-weight: normal;
  color: var(--fg);
}

.colorSchemeHighlight {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.schemePanelTableScroll {
  overflow-x: hidden;
  overflow-y: scroll;
  flex: 1 1 auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.highlightTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  table-layout: fixed;
}

.highlightTable td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.highlightTable.hasScrollBar tbody tr:last-child td {
  border-bottom: none;
}

.hlColLabel {
  width: 22%;
  white-space: nowrap;
}

.hlColPicker {
  width: 22%;
}

.hlColPreview {
  min-width: 0;
}

.hlPreviewBox {
  display: inline-block;
  padding: 8px 14px;
  font-size: 18px;
  line-height: 1.4;
}

.hlColActions {
  /* width 30×2 + gap 4 + padding 10×2 */
  width: 84px;
  text-align: right;
}

.invisible {
  visibility: hidden;
}

.hlActionsInner {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.highlightAddBtn {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.highlightAddBtnIcon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
}

.highlightAddBtnIcon :deep(svg) {
  width: 18px;
  height: 18px;
  display: block;
}

.highlightAddBtnIcon :deep(path) {
  fill: currentColor;
}

:deep(tr.sortableRowGhost) {
  opacity: 0.45;
}

:deep(tr.sortableRowChosen) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

:deep(.sortableRowHandle) {
  cursor: grab;
}

:deep(.sortableRowHandle:active) {
  cursor: grabbing;
}
</style>
