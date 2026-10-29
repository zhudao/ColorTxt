<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import AppModal from "./AppModal.vue";
import { icons } from "../icons";
import {
  mergeWebSearchSettings,
  newWebSearchEngineId,
} from "../constants/webSearchSettings";
import type { WebSearchEngine, WebSearchSettings } from "@shared/webSearchTypes";
import { appToast } from "../services/appToast";
import {
  SORTABLE_ROW_HANDLE_CLASS,
  useSortableReorder,
} from "../composables/useSortableReorder";

const open = defineModel<boolean>({ default: false });

const props = defineProps<{
  settings: WebSearchSettings;
}>();

const emit = defineEmits<{
  "update:settings": [v: WebSearchSettings];
}>();

const showEditorModal = ref(false);
const editingId = ref<string | null>(null);
const editName = ref("");
const editUrlTemplate = ref("");
const listRef = useTemplateRef<HTMLElement>("listRef");
const listHasScrollbar = ref(false);
let listResizeObserver: ResizeObserver | null = null;

function updateListHasScrollbar() {
  const el = listRef.value;
  if (!el) {
    listHasScrollbar.value = false;
    return;
  }
  listHasScrollbar.value = el.scrollHeight - el.clientHeight > 0.5;
}

function bindListResizeObserver() {
  unbindListResizeObserver();
  const el = listRef.value;
  if (!el) return;
  listResizeObserver = new ResizeObserver(() => {
    updateListHasScrollbar();
  });
  listResizeObserver.observe(el);
}

function unbindListResizeObserver() {
  listResizeObserver?.disconnect();
  listResizeObserver = null;
}

function patch(engines: WebSearchEngine[]) {
  emit("update:settings", mergeWebSearchSettings({ engines }));
}

const engines = computed(() => props.settings.engines);
const rowCount = computed(() => engines.value.length);

useSortableReorder({
  containerRef: listRef,
  draggable: ".searchRow",
  active: open,
  itemCount: rowCount,
  enabled: computed(() => engines.value.length > 1),
  onReorder: (from, to) => {
    const order = [...props.settings.engines];
    if (
      from < 0 ||
      to < 0 ||
      from >= order.length ||
      to >= order.length ||
      from === to
    ) {
      return;
    }
    const [item] = order.splice(from, 1);
    if (!item) return;
    order.splice(to, 0, item);
    patch(order);
  },
});

watch(
  open,
  async (o) => {
    if (!o) {
      unbindListResizeObserver();
      listHasScrollbar.value = false;
      return;
    }
    await nextTick();
    updateListHasScrollbar();
    bindListResizeObserver();
    requestAnimationFrame(() => {
      updateListHasScrollbar();
    });
  },
);

watch(rowCount, async () => {
  if (!open.value) return;
  await nextTick();
  updateListHasScrollbar();
});

onBeforeUnmount(() => {
  unbindListResizeObserver();
});

function openAdd() {
  editingId.value = null;
  editName.value = "";
  editUrlTemplate.value = "";
  showEditorModal.value = true;
}

function openEdit(engine: WebSearchEngine) {
  editingId.value = engine.id;
  editName.value = engine.name;
  editUrlTemplate.value = engine.urlTemplate;
  showEditorModal.value = true;
}

function onRemove(id: string) {
  patch(props.settings.engines.filter((e) => e.id !== id));
}

function onSaveEditor() {
  const name = editName.value.trim();
  const urlTemplate = editUrlTemplate.value.trim();
  if (!name) {
    appToast("请填写名称", { kind: "danger" });
    return;
  }
  if (!urlTemplate.includes("%s")) {
    appToast("URL 模板须包含 %s 占位符", { kind: "danger" });
    return;
  }
  try {
    // 允许 http(s) 与自定义协议（如 es:）
    void new URL(urlTemplate.split("%s").join("test"));
  } catch {
    appToast("URL 模板格式无效", { kind: "danger" });
    return;
  }

  if (editingId.value) {
    patch(
      props.settings.engines.map((e) =>
        e.id === editingId.value ? { ...e, name, urlTemplate } : e,
      ),
    );
  } else {
    const next: WebSearchEngine = {
      id: newWebSearchEngineId(),
      name,
      urlTemplate,
    };
    patch([next, ...props.settings.engines]);
  }
  showEditorModal.value = false;
  appToast("已保存", { kind: "success" });
}

const editorTitle = computed(() =>
  editingId.value ? "编辑网络搜索" : "添加网络搜索",
);
</script>

<template>
  <AppModal
    v-model="open"
    title="搜索管理"
    max-width="520px"
    panel-class="webSearchManagePanel"
    :mask-closable="true"
    :esc-closable="true"
    :body-scroll="false"
  >
    <div class="searchManage">
      <ul
        ref="listRef"
        class="searchList"
        :class="{ 'searchList--scrollbarPad': listHasScrollbar }"
        aria-label="搜索引擎列表"
      >
        <li v-for="engine in engines" :key="engine.id" class="searchRow">
          <div class="searchCol searchCol--title" :title="engine.name">
            <span class="searchRowTitle">{{ engine.name }}</span>
            <span class="searchRowUrl" :title="engine.urlTemplate">{{
              engine.urlTemplate
            }}</span>
          </div>
          <div class="searchCol searchCol--actions">
            <button
              type="button"
              class="searchIconBtn"
              :class="SORTABLE_ROW_HANDLE_CLASS"
              aria-label="拖动排序"
              title="拖动排序"
            >
              <span aria-hidden="true" v-html="icons.move" />
            </button>
            <button
              type="button"
              class="searchIconBtn"
              aria-label="编辑"
              title="编辑"
              @click="openEdit(engine)"
            >
              <span aria-hidden="true" v-html="icons.edit" />
            </button>
            <button
              type="button"
              class="searchIconBtn searchIconBtn--danger"
              aria-label="删除"
              title="删除"
              @click="onRemove(engine.id)"
            >
              <span aria-hidden="true" v-html="icons.remove" />
            </button>
          </div>
        </li>
        <li v-if="!engines.length" class="searchEmpty">暂无搜索引擎</li>
      </ul>

      <div class="searchFooterActions">
        <p class="searchFooterHint">
          提示：URL 模板中用 %s 表示关键词（将自动编码）
        </p>
        <button type="button" class="btn" size="large" @click="openAdd">
          添加网络搜索
        </button>
      </div>
    </div>
  </AppModal>

  <AppModal
    v-model="showEditorModal"
    :title="editorTitle"
    max-width="520px"
    :mask-closable="false"
    :esc-closable="true"
  >
    <div class="searchEditForm">
      <label class="searchField">
        <span class="searchFieldLabel">名称</span>
        <input v-model="editName" class="searchInput" type="text" />
      </label>
      <label class="searchField">
        <span class="searchFieldLabel">URL 模板</span>
        <input
          v-model="editUrlTemplate"
          class="searchInput"
          type="text"
          placeholder="https://www.example.com/search?q=%s"
          spellcheck="false"
        />
      </label>
    </div>
    <template #footer>
      <div class="searchEditFooter">
        <p class="searchEditHint">
          提示：URL 模板中用 %s 表示关键词（将自动编码）
        </p>
        <button
          type="button"
          class="btn"
          size="large"
          @click="showEditorModal = false"
        >
          取消
        </button>
        <button
          type="button"
          class="btn primary"
          size="large"
          @click="onSaveEditor"
        >
          确定
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
:deep(.webSearchManagePanel) {
  max-height: min(90vh, 640px);
}

.searchManage {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}

.searchList {
  list-style: none;
  margin: 5px 0 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-height: 120px;
  overflow-x: hidden;
  overflow-y: auto;
}

.searchList--scrollbarPad {
  padding-right: 8px;
}

.searchEmpty {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.searchFooterActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.searchFooterHint {
  flex: 1 1 180px;
  margin: 0;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.searchRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.searchCol--title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.searchRowTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.searchRowUrl {
  font-size: 11px;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.searchCol--actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.searchIconBtn {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}

.searchIconBtn:hover:not(:disabled) {
  background: var(--icon-btn-bg-hover);
}

.searchIconBtn--danger {
  color: var(--danger, #c44);
}

.searchIconBtn :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.searchIconBtn :deep(svg path) {
  fill: currentColor;
}

.searchIconBtn.sortableRowHandle {
  cursor: grab;
}

.searchEditForm {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 8px;
}

.searchField {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.searchFieldLabel {
  font-size: 12px;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.searchInput {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 13px;
}

.searchEditHint {
  flex: 1 1 180px;
  margin: 0;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.searchEditFooter {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  width: 100%;
}
</style>
