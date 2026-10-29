<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import HexColorPickerField from "./HexColorPickerField.vue";
import IconButton from "./IconButton.vue";
import { icons } from "../icons";
import {
  SORTABLE_ROW_HANDLE_CLASS,
  useSortableReorder,
} from "../composables/useSortableReorder";

export type LineationColorRow = { id: string; color: string };

const props = defineProps<{
  rows: LineationColorRow[];
  previewHexes: string[];
  lineationReaderBg: string;
  bodyTextColor: string;
  monacoFontFamily: string;
  minLineationColors: number;
}>();

const emit = defineEmits<{
  "update-color": [index: number, color: string];
  "draft-hex": [index: number, hex: string];
  "draft-end": [];
  reorder: [fromIndex: number, toIndex: number];
  remove: [index: number];
}>();

const tableScrollEl = ref<HTMLElement | null>(null);
const tableBodyRef = ref<HTMLElement | null>(null);
const rowCount = computed(() => props.rows.length);

const { remount: remountLineationSortable } = useSortableReorder({
  containerRef: tableBodyRef,
  itemCount: rowCount,
  enabled: computed(() => props.rows.length > 1),
  onReorder(from, to) {
    emit("reorder", from, to);
    remountLineationSortable();
  },
});

async function scrollToBottom() {
  await nextTick();
  const el = tableScrollEl.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

defineExpose({ scrollToBottom });

function markerStyle(hex: string) {
  return {
    backgroundColor: `color-mix(in srgb, ${hex} 35%, transparent)`,
    borderRadius: "2px",
  };
}

function wavyStyle(hex: string) {
  return {
    textDecoration: `underline wavy ${hex}`,
    textDecorationThickness: "2px",
    textUnderlineOffset: "4px",
  };
}

function straightStyle(hex: string) {
  return {
    textDecoration: `underline solid ${hex}`,
    textDecorationThickness: "2px",
    textUnderlineOffset: "4px",
  };
}
</script>

<template>
  <div class="colorSchemeLineation" role="tabpanel">
    <div ref="tableScrollEl" class="schemePanelTableScroll">
      <table class="lineationTable" :class="{ hasScrollBar: rows.length >= 8 }">
        <tbody ref="tableBodyRef">
          <tr v-for="(row, rowIdx) in rows" :key="row.id">
            <td class="lnColLabel colorSchemeRowLabel">
              标注色 {{ rowIdx + 1 }}
            </td>
            <td class="lnColPicker">
              <HexColorPickerField
                :model-value="row.color"
                @update:model-value="emit('update-color', rowIdx, $event)"
                @draft-hex="emit('draft-hex', rowIdx, $event)"
                @draft-end="emit('draft-end')"
              />
            </td>
            <td class="lnColPreview">
              <div
                class="lnPreviewBox"
                :style="{
                  backgroundColor: lineationReaderBg,
                  fontFamily: monacoFontFamily,
                  color: bodyTextColor,
                }"
              >
                <span class="lnPreviewItem" :style="markerStyle(previewHexes[rowIdx]!)">
                  马克笔
                </span>
                <span class="lnPreviewSep" aria-hidden="true">　</span>
                <span class="lnPreviewItem" :style="wavyStyle(previewHexes[rowIdx]!)">
                  波浪线
                </span>
                <span class="lnPreviewSep" aria-hidden="true">　</span>
                <span class="lnPreviewItem" :style="straightStyle(previewHexes[rowIdx]!)">
                  直线
                </span>
              </div>
            </td>
            <td class="lnColActions">
              <div class="lnActionsInner">
                <IconButton
                  :class="SORTABLE_ROW_HANDLE_CLASS"
                  :icon-html="icons.move"
                  aria-label="拖动排序"
                  title="拖动排序"
                  :disabled="rows.length <= 1"
                />
                <IconButton
                  :class="{ invisible: rows.length <= minLineationColors }"
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
  </div>
</template>

<style scoped>
.colorSchemeRowLabel {
  font-weight: normal;
  color: var(--fg);
}

.colorSchemeLineation {
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

.lineationTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  table-layout: fixed;
}

.lineationTable td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.lineationTable.hasScrollBar tbody tr:last-child td {
  border-bottom: none;
}

.lnColLabel {
  width: 20%;
  white-space: nowrap;
}

.lnColPicker {
  width: 20%;
}

.lnColPreview {
  min-width: 0;
}

.lnPreviewBox {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0;
  padding: 8px 14px;
  font-size: 18px;
  line-height: 1.5;
}

.lnPreviewItem {
  white-space: nowrap;
}

.lnPreviewSep {
  user-select: none;
}

.lnColActions {
  width: 84px;
  text-align: right;
}

.invisible {
  visibility: hidden;
}

.lnActionsInner {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
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
