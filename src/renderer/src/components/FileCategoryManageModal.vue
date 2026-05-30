<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppModal from "./AppModal.vue";
import HexColorPickerField from "./HexColorPickerField.vue";
import IconButton from "./IconButton.vue";
import type { FileCategoryDefinition } from "../constants/fileCategories";
import type { CategoryEditorRow } from "../constants/fileCategories";
import { appAlert } from "../services/appDialog";
import { normalizeLooseHex6 } from "../utils/color";
import { icons } from "../icons";
import {
  SORTABLE_ROW_HANDLE_CLASS,
  useSortableReorder,
} from "../composables/useSortableReorder";

const props = defineProps<{
  catalog: FileCategoryDefinition[];
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  apply: [
    payload: {
      initial: CategoryEditorRow[];
      draft: CategoryEditorRow[];
      catalog: FileCategoryDefinition[];
    },
  ];
}>();

const manageDraft = ref<CategoryEditorRow[]>([]);
const manageInitial = ref<CategoryEditorRow[]>([]);
const tableScrollEl = ref<HTMLElement | null>(null);
const tableBodyRef = ref<HTMLElement | null>(null);
const rowCount = computed(() => manageDraft.value.length);

useSortableReorder({
  containerRef: tableBodyRef,
  active: open,
  itemCount: rowCount,
  enabled: computed(() => manageDraft.value.length > 1),
  onReorder(from, to) {
    reorderManageRow(from, to);
  },
});

watch(open, (isOpen) => {
  if (!isOpen) {
    manageDraft.value = [];
    manageInitial.value = [];
    return;
  }
  manageDraft.value = props.catalog.map((c, i) => ({
    key: `init-${i}`,
    name: c.name,
    color: c.color,
  }));
  manageInitial.value = manageDraft.value.map((r) => ({ ...r }));
});

async function addManageRow() {
  manageDraft.value.push({
    key: `new-${Date.now()}`,
    name: "",
    color: "#7C3AED",
  });
  await nextTick();
  const el = tableScrollEl.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

function reorderManageRow(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;
  const arr = manageDraft.value.slice();
  const [item] = arr.splice(fromIndex, 1);
  if (!item) return;
  arr.splice(toIndex, 0, item);
  manageDraft.value = arr;
}

function removeManageRow(idx: number) {
  manageDraft.value = manageDraft.value.filter((_, i) => i !== idx);
}

function confirmManageModal() {
  const seen = new Set<string>();
  for (const r of manageDraft.value) {
    const n = r.name.trim();
    if (!n) {
      void appAlert("分类名称不能为空");
      return;
    }
    if (seen.has(n)) {
      void appAlert("分类名称不能重复");
      return;
    }
    seen.add(n);
    const hex = normalizeLooseHex6(r.color);
    if (!hex) {
      void appAlert(`颜色格式无效：${r.name}`);
      return;
    }
    r.color = hex;
  }
  const catalog: FileCategoryDefinition[] = manageDraft.value.map((r) => ({
    name: r.name.trim(),
    color: r.color,
  }));
  emit("apply", {
    initial: manageInitial.value.map((r) => ({ ...r })),
    draft: manageDraft.value.map((r) => ({ ...r })),
    catalog,
  });
  open.value = false;
}

function cancelManageModal() {
  open.value = false;
}
</script>

<template>
  <AppModal
    v-model="open"
    title="分类管理"
    max-width="480px"
    panel-class="fileCategoryManagePanel"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="false"
  >
    <div class="manageCatLayout">
      <div ref="tableScrollEl" class="schemePanelTableScroll">
        <table
          class="highlightTable manageCatTable"
          :class="{ hasScrollBar: manageDraft.length >= 5 }"
        >
          <colgroup>
            <col />
            <col class="manageCatColPicker" />
            <col class="manageCatColActions" />
          </colgroup>
          <tbody ref="tableBodyRef">
            <tr v-for="(row, idx) in manageDraft" :key="row.key">
              <td class="catColName">
                <input
                  v-model="row.name"
                  class="manageCatNameInput"
                  type="text"
                  spellcheck="false"
                  placeholder="分类名称"
                />
              </td>
              <td class="hlColPicker">
                <HexColorPickerField v-model="row.color" />
              </td>
              <td class="hlColActions">
                <div class="hlActionsInner">
                  <IconButton
                    large
                    :class="SORTABLE_ROW_HANDLE_CLASS"
                    :icon-html="icons.move"
                    aria-label="拖动排序"
                    title="拖动排序"
                    :disabled="manageDraft.length <= 1"
                  />
                  <IconButton
                    large
                    :icon-html="icons.remove"
                    aria-label="删除"
                    title="删除"
                    @click="removeManageRow(idx)"
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
        aria-label="新增分类"
        title="新增分类"
        @click="addManageRow"
      >
        <span
          class="highlightAddBtnIcon"
          aria-hidden="true"
          v-html="icons.add"
        />
      </button>
    </div>

    <template #footer>
      <div class="manageCatModalFooter">
        <div class="manageCatModalFooterEnd">
          <button
            type="button"
            class="btn"
            size="large"
            @click="cancelManageModal"
          >
            取消
          </button>
          <button
            type="button"
            class="btn primary"
            size="large"
            @click="confirmManageModal"
          >
            确定
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
:deep(.fileCategoryManagePanel) {
  max-height: min(90vh, 560px);
}

.manageCatLayout {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.schemePanelTableScroll {
  overflow-x: hidden;
  overflow-y: scroll;
  flex: 0 1 auto;
  height: 251px;
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

/* 第 2、3 列固定列宽，首列吃满剩余 */
.manageCatTable col.manageCatColPicker {
  /* 32px 触发器 + 边框 + 单元格左右 padding */
  width: 56px;
}

.manageCatTable col.manageCatColActions {
  width: 84px;
}

.catColName {
  width: 100%;
  min-width: 0;
}

.manageCatNameInput {
  width: 100%;
  font-size: 14px;
  line-height: 1.35;
}

.hlColPicker {
  width: 56px;
  white-space: nowrap;
  vertical-align: middle;
}

.hlColActions {
  width: 84px;
  max-width: 84px;
  text-align: right;
  vertical-align: middle;
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

.manageCatModalFooter {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 100%;
}

.manageCatModalFooterEnd {
  display: flex;
  align-items: center;
  gap: 8px;
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
