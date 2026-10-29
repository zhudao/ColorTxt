<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppModal from "../../components/AppModal.vue";
import AppCheckbox from "../../components/AppCheckbox.vue";
import IconButton from "../../components/IconButton.vue";
import { icons } from "../../icons";
import EditBookSourcePanel from "./EditBookSourcePanel.vue";
import BookSourceCenterState from "./BookSourceCenterState.vue";
import { useBookSourceApi } from "../composables/useBookSource";
import { useListSelectionHotkeys } from "../../composables/useListSelectionHotkeys";
import type {
  BookSourceImportPreviewItem,
  BookSourceRecord,
} from "@shared/bookSource/types";
import "../bookSourceToolbar.css";

const emit = defineEmits<{
  done: [];
}>();

const modelValue = defineModel<boolean>({ default: false });
const items = defineModel<BookSourceImportPreviewItem[]>("items", {
  default: () => [],
});
const { commitImport } = useBookSourceApi();

const filter = ref("");
const selected = ref<Set<number>>(new Set());
/** Shift 连选锚点（与侧栏文件列表 / 书架管理一致） */
const lastSelectedIndex = ref<number | null>(null);
const showEdit = ref(false);
const editIndex = ref(0);
const listFocusRef = ref<HTMLElement | null>(null);

type FilteredEntry = {
  item: BookSourceImportPreviewItem;
  index: number;
};

const filteredEntries = computed((): FilteredEntry[] => {
  const q = filter.value.trim().toLowerCase();
  const list = items.value.map((item, index) => ({ item, index }));
  if (!q) return list;
  return list.filter(({ item }) =>
    item.source.bookSourceName.toLowerCase().includes(q),
  );
});

/** 当前列表（筛选后）中勾选的数量；被过滤掉的不计入 */
const selectedCount = computed(() => {
  let n = 0;
  for (const { index } of filteredEntries.value) {
    if (selected.value.has(index)) n += 1;
  }
  return n;
});
const allFilteredSelected = computed(
  () =>
    filteredEntries.value.length > 0 &&
    filteredEntries.value.every(({ index }) => selected.value.has(index)),
);
const selectAllLabel = computed(() =>
  allFilteredSelected.value ? "取消全选" : "全选",
);
const selectAllIndeterminate = computed(
  () => selectedCount.value > 0 && !allFilteredSelected.value,
);
const listEmptyText = computed(() =>
  items.value.length === 0 ? "暂无书源" : "无匹配的书源",
);

function defaultSelectedIndices(items: BookSourceImportPreviewItem[]): Set<number> {
  return new Set(
    items
      .map((item, i) => (item.status === "new" || item.status === "update" ? i : -1))
      .filter((i) => i >= 0),
  );
}

function applySelection(next: Set<number>, anchor?: number | null) {
  selected.value = next;
  if (anchor !== undefined) {
    lastSelectedIndex.value = anchor;
    return;
  }
  if (lastSelectedIndex.value != null && !next.has(lastSelectedIndex.value)) {
    lastSelectedIndex.value =
      next.size > 0 ? Math.max(...next) : null;
  }
}

watch(
  items,
  (list, prev) => {
    const structuralChange =
      !prev ||
      list.length !== prev.length ||
      list.some(
        (it, i) => it.source.bookSourceUrl !== prev[i]?.source.bookSourceUrl,
      );
    if (structuralChange) {
      const next = defaultSelectedIndices(list);
      applySelection(
        next,
        next.size > 0 ? Math.max(...next) : null,
      );
    }
  },
  { immediate: true },
);

function statusLabel(status: BookSourceImportPreviewItem["status"]) {
  if (status === "new") return "新增";
  if (status === "update") return "更新";
  return "已有";
}

/** 与资源管理器一致：单击单选、Ctrl 多选、Shift 连选 */
function onRowClick(originalIndex: number, listIndex: number, ev: MouseEvent) {
  const list = filteredEntries.value;
  const toggleMod = ev.ctrlKey || ev.metaKey;
  const rangeMod = ev.shiftKey;

  if (rangeMod) {
    const anchor = lastSelectedIndex.value;
    if (anchor == null) {
      applySelection(new Set([originalIndex]), originalIndex);
      focusList();
      return;
    }
    const anchorListIdx = list.findIndex((e) => e.index === anchor);
    if (anchorListIdx < 0 || listIndex < 0) {
      applySelection(new Set([originalIndex]), originalIndex);
      focusList();
      return;
    }
    const start = Math.min(anchorListIdx, listIndex);
    const end = Math.max(anchorListIdx, listIndex);
    const next = new Set<number>();
    for (let i = start; i <= end; i++) next.add(list[i]!.index);
    applySelection(next);
    focusList();
    return;
  }

  if (toggleMod) {
    const next = new Set(selected.value);
    if (next.has(originalIndex)) next.delete(originalIndex);
    else next.add(originalIndex);
    applySelection(next, originalIndex);
    focusList();
    return;
  }

  applySelection(new Set([originalIndex]), originalIndex);
  focusList();
}

function selectAll() {
  const indices = filteredEntries.value.map((e) => e.index);
  applySelection(
    new Set(indices),
    indices.length > 0 ? indices[indices.length - 1]! : null,
  );
}

function clearSelection() {
  applySelection(new Set(), null);
}

function invertSelect() {
  const visibleKeys = filteredEntries.value.map((e) => e.index);
  const visible = new Set(visibleKeys);
  const next = new Set<number>();
  for (const i of selected.value) {
    if (!visible.has(i)) next.add(i);
  }
  for (const i of visibleKeys) {
    if (!selected.value.has(i)) next.add(i);
  }
  applySelection(next, next.size > 0 ? Math.max(...next) : null);
}

function onToggleSelectAll(checked: boolean) {
  if (checked) selectAll();
  else clearSelection();
}

const { onListKeydown, focusList } = useListSelectionHotkeys({
  listEl: listFocusRef,
  enabled: () => modelValue.value && !showEdit.value,
  onSelectAll: selectAll,
  onInvert: invertSelect,
});

watch(modelValue, (open) => {
  if (open) {
    focusList();
    return;
  }
  filter.value = "";
});

function selectNew() {
  const next = new Set(
    items.value.map((item, i) => (item.status === "new" ? i : -1)).filter((i) => i >= 0),
  );
  applySelection(next, next.size > 0 ? Math.max(...next) : null);
}

function selectUpdate() {
  const next = new Set(
    items.value
      .map((item, i) => (item.status === "update" ? i : -1))
      .filter((i) => i >= 0),
  );
  applySelection(next, next.size > 0 ? Math.max(...next) : null);
}

function onEdit(idx: number) {
  editIndex.value = idx;
  showEdit.value = true;
}

function onEditDone(source: BookSourceRecord) {
  showEdit.value = false;
  const idx = editIndex.value;
  const prev = items.value[idx];
  if (!prev) return;
  const next = items.value.slice();
  next[idx] = { ...prev, source };
  items.value = next;
}

async function onConfirm() {
  const indices = [...selected.value];
  if (!indices.length) return;
  const addUrls: string[] = [];
  const updateUrls: string[] = [];
  const sources: BookSourceImportPreviewItem["source"][] = [];
  for (const i of indices) {
    const item = items.value[i];
    if (!item) continue;
    sources.push(item.source);
    if (item.status === "new") addUrls.push(item.source.bookSourceUrl);
    else if (item.status === "update") updateUrls.push(item.source.bookSourceUrl);
  }
  await commitImport({ addUrls, updateUrls, sources });
  modelValue.value = false;
  emit("done");
}

function onCancel() {
  modelValue.value = false;
}
</script>

<template>
  <AppModal
    v-model="modelValue"
    title="导入书源"
    panel-class="bookSourcePanel"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="false"
  >
    <template #headerSuffix>
      <p class="impHint">（说明：只显示「文本」类型的书源）</p>
    </template>
    <div class="bsShell">
      <header class="bookSourceToolbarHeader">
        <div class="bsFilterField">
          <span class="bsFilterIcon" aria-hidden="true" v-html="icons.filter" />
          <input
            v-model="filter"
            class="bookSourceToolbarSearch bsFilterInput"
            type="search"
            placeholder="过滤书源"
          />
        </div>
      </header>
      <div
        ref="listFocusRef"
        class="bsListArea"
        tabindex="0"
        @keydown="onListKeydown"
      >
        <BookSourceCenterState v-if="!filteredEntries.length">
          {{ listEmptyText }}
        </BookSourceCenterState>
        <ul v-else class="bsList">
          <li
            v-for="(entry, listIndex) in filteredEntries"
            :key="entry.item.source.bookSourceUrl"
            class="bsRow"
            @click="onRowClick(entry.index, listIndex, $event)"
          >
            <AppCheckbox
              class="bsRowCheckbox"
              passive
              :model-value="selected.has(entry.index)"
              :aria-label="`选择 ${entry.item.source.bookSourceName}`"
            />
            <div class="bsRowMain">
              <div class="bsRowName">{{ entry.item.source.bookSourceName }}</div>
            </div>
            <div class="bsRowActions" @click.stop>
              <span class="impTag" :data-status="entry.item.status">
                {{ statusLabel(entry.item.status) }}
              </span>
              <IconButton
                :icon-html="icons.edit"
                title="编辑"
                aria-label="编辑"
                @click="onEdit(entry.index)"
              />
            </div>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <div class="bsFooter">
        <AppCheckbox
          class="bsFooterSelectAll"
          :model-value="allFilteredSelected"
          :indeterminate="selectAllIndeterminate"
          :aria-label="selectAllLabel"
          @update:model-value="onToggleSelectAll"
        >
          <template #label>
            {{ selectAllLabel }}（{{ selectedCount }}/{{ filteredEntries.length }}）
          </template>
        </AppCheckbox>
        <div class="bsFooterActions">
          <button type="button" class="btn" size="large" @click="selectNew">
            选中新增
          </button>
          <button type="button" class="btn" size="large" @click="selectUpdate">
            选中更新
          </button>
          <button type="button" class="btn" size="large" @click="onCancel">
            取消
          </button>
          <button
            type="button"
            class="btn primary"
            size="large"
            :disabled="!selectedCount"
            @click="onConfirm"
          >
            导入
          </button>
        </div>
      </div>
    </template>

    <EditBookSourcePanel
      v-model="showEdit"
      :draft-source="items[editIndex]?.source"
      draft-only
      @done="onEditDone"
    />
  </AppModal>
</template>

<style scoped>
.bsShell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.impHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
  flex-shrink: 0;
  align-self: flex-end;
}
.bsFilterField {
  position: relative;
  flex: 1;
  min-width: 0;
}
.bsFilterIcon {
  position: absolute;
  left: 10px;
  top: 50%;
  z-index: 1;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--secondary);
  pointer-events: none;
}
.bsFilterIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.bsFilterIcon :deep(svg path) {
  fill: currentColor;
}
.bsListArea {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}
.bsList {
  flex: 1;
  min-height: 0;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  background: var(--bg);
}
.bsRow {
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  min-height: 50px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.bsRowCheckbox {
  flex-shrink: 0;
  pointer-events: none;
}
.bsRowActions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.bsRowMain {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.bsRowName {
  /* font-weight: 600; */
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.impTag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--list-item-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--muted);
}
.impTag[data-status="new"] {
  background: color-mix(in srgb, #43a047 18%, transparent);
  color: #43a047;
}
.impTag[data-status="update"] {
  background: color-mix(in srgb, #ef6c00 18%, transparent);
  color: #ef6c00;
}
.bsFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 10px 10px 16px;
}
.bsFooterSelectAll {
  font-size: 14px;
  color: var(--fg, #333);
}
.bsFooterSelectAll :deep(.appCheckbox__label) {
  font-size: 14px;
  color: var(--fg, #333);
}
.bsFooterActions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
