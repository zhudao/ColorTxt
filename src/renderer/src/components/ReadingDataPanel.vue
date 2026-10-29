<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppModal from "./AppModal.vue";
import AppCheckbox from "./AppCheckbox.vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import IconButton from "./IconButton.vue";
import VirtualList from "./VirtualList.vue";
import { icons } from "../icons";
import { usePathListSelection } from "../composables/usePathListSelection";
import {
  formatFileReadProgress,
  isProgressComplete,
} from "../utils/fileListPanelDisplay";
import "../bookSource/bookSourceToolbar.css";

export type ReadingDataListItem = {
  path: string;
  fileName: string;
  /** 0–100，与侧栏文件进度一致 */
  progress?: number;
  lastOpenedAt?: number;
};

export type ReadingDataSortMode =
  | "nameAsc"
  | "nameDesc"
  | "pathAsc"
  | "pathDesc"
  | "progressAsc"
  | "progressDesc"
  | "lastOpenedAtAsc"
  | "lastOpenedAtDesc";

const DEFAULT_SORT: ReadingDataSortMode = "lastOpenedAtDesc";

/** 对齐书源行高（min-height 50 + 底部分隔线） */
const READING_DATA_ROW_STRIDE = 51;

const SORT_LABELS: Record<ReadingDataSortMode, string> = {
  nameAsc: "文件名",
  nameDesc: "文件名",
  pathAsc: "文件路径",
  pathDesc: "文件路径",
  progressAsc: "阅读进度",
  progressDesc: "阅读进度",
  lastOpenedAtAsc: "打开时间",
  lastOpenedAtDesc: "打开时间",
};

const SORT_MODES: ReadingDataSortMode[] = [
  "nameAsc",
  "nameDesc",
  "pathAsc",
  "pathDesc",
  "progressAsc",
  "progressDesc",
  "lastOpenedAtAsc",
  "lastOpenedAtDesc",
];

const modelValue = defineModel<boolean>({ default: false });

const props = defineProps<{
  items: ReadingDataListItem[];
}>();

const emit = defineEmits<{
  clearAllReadingData: [];
  clearPaths: [paths: string[]];
  removeMissingFiles: [];
  openPath: [path: string];
}>();

const filterQuery = ref("");
const sortMode = ref<ReadingDataSortMode>(DEFAULT_SORT);

const filteredSortedItems = computed(() => {
  const q = filterQuery.value.trim().toLowerCase();
  let list = props.items.slice();
  if (q) {
    list = list.filter((it) => it.path.toLowerCase().includes(q));
  }
  const mode = sortMode.value;
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const prog = (it: ReadingDataListItem) =>
    typeof it.progress === "number" && Number.isFinite(it.progress)
      ? it.progress
      : -1;
  const opened = (it: ReadingDataListItem) =>
    typeof it.lastOpenedAt === "number" && Number.isFinite(it.lastOpenedAt)
      ? it.lastOpenedAt
      : 0;

  list.sort((a, b) => {
    switch (mode) {
      case "nameAsc":
        return collator.compare(a.fileName, b.fileName);
      case "nameDesc":
        return collator.compare(b.fileName, a.fileName);
      case "pathAsc":
        return collator.compare(a.path, b.path);
      case "pathDesc":
        return collator.compare(b.path, a.path);
      case "progressAsc":
        return prog(a) - prog(b);
      case "progressDesc":
        return prog(b) - prog(a);
      case "lastOpenedAtAsc":
        return opened(a) - opened(b);
      case "lastOpenedAtDesc":
      default:
        return opened(b) - opened(a);
    }
  });
  return list;
});

const {
  selectedPaths,
  onItemClick,
  onListKeydown,
  clearSelection,
} = usePathListSelection({ items: filteredSortedItems });

const listFocusEl = ref<HTMLElement | null>(null);
const modalRef = ref<InstanceType<typeof AppModal> | null>(null);

function isEditableKeyTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** AppModal 蒙层捕获阶段；输入框内放行，避免抢走 Ctrl+A 全选文本 */
function onModalKeydown(ev: KeyboardEvent) {
  if (isEditableKeyTarget(ev.target)) return;
  const accel = ev.ctrlKey || ev.metaKey;
  if (!accel) return;
  const k = ev.key.toLowerCase();
  if (k !== "a" && k !== "i") return;
  ev.preventDefault();
  ev.stopPropagation();
  onListKeydown(ev);
}

watch(modelValue, (open) => {
  if (!open) {
    clearSelection();
    filterQuery.value = "";
    sortMode.value = DEFAULT_SORT;
    return;
  }
  void nextTick(() => {
    void nextTick(() => {
      listFocusEl.value?.focus({ preventScroll: true });
      if (!listFocusEl.value) {
        modalRef.value?.focusBackdrop?.();
      }
    });
  });
});

const hasAnyItems = computed(() => props.items.length > 0);
const visibleCount = computed(() => filteredSortedItems.value.length);
const showSelCount = computed(() => visibleCount.value > 0);
const hasSelection = computed(() => selectedPaths.value.length > 0);

const sortScrollItems = computed((): CustomSelectItem[] =>
  SORT_MODES.map((m) => ({
    kind: "item" as const,
    id: m,
    label: SORT_LABELS[m],
    prefixHtml: /Asc$/.test(m) ? icons.asc : icons.desc,
  })),
);

const sortDisplayLabel = computed(
  () => SORT_LABELS[sortMode.value] ?? "打开时间",
);

const sortTriggerPrefixHtml = computed(() =>
  /Asc$/.test(sortMode.value) ? icons.asc : icons.desc,
);

function onSortSelect(id: string) {
  if (id === sortMode.value) return;
  if ((SORT_MODES as string[]).includes(id)) {
    sortMode.value = id as ReadingDataSortMode;
  }
}

function formatOpenedDate(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function progressText(p: number | undefined): string {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  return formatFileReadProgress(p);
}

function onDeleteSelected() {
  if (selectedPaths.value.length === 0) return;
  const paths = selectedPaths.value.slice();
  clearSelection();
  emit("clearPaths", paths);
}

function onDeleteOne(path: string, ev: MouseEvent) {
  ev.stopPropagation();
  emit("clearPaths", [path]);
}

function onOpenOne(path: string, ev: MouseEvent) {
  ev.stopPropagation();
  const p = path.trim();
  if (!p) return;
  emit("openPath", p);
}

function onRevealOne(path: string, ev: MouseEvent) {
  ev.stopPropagation();
  const p = path.trim();
  if (!p) return;
  void window.colorTxt?.showItemInFolder(p).catch(() => {});
}

function onClearAll() {
  emit("clearAllReadingData");
}

function onRemoveMissing() {
  emit("removeMissingFiles");
}
</script>

<template>
  <AppModal
    ref="modalRef"
    v-model="modelValue"
    title="阅读数据"
    panel-class="readingDataPanelModal"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="false"
    @keydown="onModalKeydown"
  >
    <div class="readingDataBody">
      <header class="bookSourceToolbarHeader readingDataToolbar">
        <div class="readingDataFilterField">
          <span
            class="readingDataFilterIcon"
            aria-hidden="true"
            v-html="icons.filter"
          />
          <input
            v-model="filterQuery"
            class="bookSourceToolbarSearch readingDataFilterInput"
            type="search"
            spellcheck="false"
            autocomplete="off"
            placeholder="过滤路径…"
            aria-label="过滤阅读数据路径"
          />
        </div>
        <AppCustomSelect
          class="readingDataSortSelect"
          :model-value="sortMode"
          :display-label="sortDisplayLabel"
          :trigger-prefix-html="sortTriggerPrefixHtml"
          :fixed-top-items="[]"
          :scroll-items="sortScrollItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="360"
          ariaLabel="阅读数据排序"
          @update:model-value="onSortSelect"
        />
      </header>

      <div
        ref="listFocusEl"
        class="readingDataListFocus"
        tabindex="0"
        aria-label="阅读数据列表"
      >
        <div v-if="!hasAnyItems" class="readingDataEmpty">暂无阅读数据</div>
        <div v-else-if="visibleCount === 0" class="readingDataEmpty">
          无匹配的路径
        </div>
        <VirtualList
          v-else
          class="readingDataList"
          :item-count="visibleCount"
          :row-stride="READING_DATA_ROW_STRIDE"
          :overscan="10"
          :item-key="(i) => filteredSortedItems[i]?.path ?? i"
        >
          <template #default="{ index }">
            <div class="readingDataRow" @click="onItemClick(index, $event)">
              <AppCheckbox
                class="readingDataCheckbox"
                passive
                :model-value="
                  selectedPaths.includes(filteredSortedItems[index]!.path)
                "
                :aria-label="`选择 ${filteredSortedItems[index]!.fileName}`"
              />
              <div class="readingDataIdentity">
                <span
                  class="readingDataName"
                  :title="filteredSortedItems[index]!.fileName"
                  >{{ filteredSortedItems[index]!.fileName }}</span
                >
                <span
                  class="readingDataPath"
                  :title="filteredSortedItems[index]!.path"
                  >{{ filteredSortedItems[index]!.path }}</span
                >
              </div>
              <span
                class="readingDataProgress"
                :class="{
                  'readingDataProgress--complete': isProgressComplete(
                    filteredSortedItems[index]!.progress,
                  ),
                  'readingDataProgress--incomplete':
                    typeof filteredSortedItems[index]!.progress === 'number' &&
                    !isProgressComplete(filteredSortedItems[index]!.progress),
                }"
              >
                {{ progressText(filteredSortedItems[index]!.progress) }}
              </span>
              <span class="readingDataOpened">{{
                formatOpenedDate(filteredSortedItems[index]!.lastOpenedAt)
              }}</span>
              <div class="readingDataActions" @click.stop>
                <IconButton
                  :icon-html="icons.read"
                  aria-label="打开"
                  title="打开"
                  @click="onOpenOne(filteredSortedItems[index]!.path, $event)"
                />
                <IconButton
                  :icon-html="icons.folderOpen"
                  aria-label="在文件管理器中显示"
                  title="在文件管理器中显示"
                  @click="onRevealOne(filteredSortedItems[index]!.path, $event)"
                />
                <IconButton
                  danger
                  :icon-html="icons.remove"
                  aria-label="清除阅读数据"
                  title="清除"
                  @click="onDeleteOne(filteredSortedItems[index]!.path, $event)"
                />
              </div>
            </div>
          </template>
        </VirtualList>
      </div>
    </div>

    <template #footer>
      <div class="readingDataFooter">
        <p class="readingDataFooterHint">
          清除阅读数据会清除文件的阅读进度、书签、高亮词、笔记、角色卡（含立绘）、AI
          对话记录、向量索引与分词缓存等数据，并从最近打开中移除；不会删除文件本身。
        </p>
        <div class="readingDataFooterBar">
          <div class="readingDataFooterStart">
            <button
              class="btn warning"
              type="button"
              size="large"
              :disabled="!hasAnyItems"
              @click="onClearAll"
            >
              清空
            </button>
            <button
              class="btn"
              type="button"
              size="large"
              :disabled="!hasAnyItems"
              @click="onRemoveMissing"
            >
              清除失效文件
            </button>
          </div>
          <div class="readingDataFooterEnd">
            <span v-if="showSelCount" class="readingDataSelCount">
              已选中：{{ selectedPaths.length }}/{{ visibleCount }}
            </span>
            <button
              class="btn danger"
              type="button"
              size="large"
              :disabled="!hasSelection"
              @click="onDeleteSelected"
            >
              清除选中
            </button>
          </div>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style>
.appModalPanel.readingDataPanelModal {
  --min-width: 600px;
  --max-width: 800px;
  --max-height: calc(100vh - 48px);
  padding: 0;
  overflow: hidden;
  max-width: var(--max-width) !important;
  width: max(min(calc(100vw - 48px), var(--max-width)), var(--min-width));
  max-height: var(--max-height) !important;
  height: var(--max-height);
}
.appModalPanel.readingDataPanelModal .appModalPanelHeader {
  margin-bottom: 0;
  padding: 12px 48px 12px 16px;
}
.appModalPanel.readingDataPanelModal .appModalBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
.appModalPanel.readingDataPanelModal .readingDataToolbar {
  padding: 0 10px 10px;
  border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.08));
}
.appModalPanel.readingDataPanelModal .appModalFooter {
  margin-top: 0;
  padding: 10px 10px 10px 16px;
  border-top: 1px solid var(--border, rgba(0, 0, 0, 0.08));
}
.appModalPanel.readingDataPanelModal .readingDataList {
  padding: 0 16px;
}
.appModalPanel.readingDataPanelModal
  input.bookSourceToolbarSearch.readingDataFilterInput[type="search"] {
  width: 100%;
  flex: none;
  padding-left: 32px;
  font-size: 14px;
}
</style>

<style scoped>
.readingDataBody {
  display: flex;
  flex-direction: column;
  outline: none;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.readingDataListFocus {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}

.readingDataFilterField {
  position: relative;
  flex: 1;
  min-width: 0;
}

.readingDataFilterIcon {
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

.readingDataFilterIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.readingDataFilterIcon :deep(svg path) {
  fill: currentColor;
}

.readingDataSortSelect {
  flex-shrink: 0;
  width: 114px;
  min-width: 114px;
}

.readingDataEmpty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 14px;
  padding: 24px;
}

.readingDataList {
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}

.readingDataRow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 6px 0;
  box-sizing: border-box;
  min-height: 50px;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--fg);
  text-align: left;
  user-select: none;
}

.readingDataCheckbox {
  flex-shrink: 0;
  pointer-events: none;
}

.readingDataIdentity {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}

.readingDataName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 1.25;
  color: var(--fg);
}

.readingDataPath {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.25;
  color: var(--muted);
}

.readingDataProgress {
  flex: 0 0 48px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.readingDataProgress--complete {
  color: var(--success);
}

.readingDataProgress--incomplete {
  color: var(--warning);
}

.readingDataOpened {
  flex: 0 0 126px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  white-space: nowrap;
}

.readingDataActions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.readingDataFooter {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  width: 100%;
}

.readingDataFooterHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.readingDataFooterBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.readingDataFooterStart {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.readingDataFooterEnd {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.readingDataSelCount {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
