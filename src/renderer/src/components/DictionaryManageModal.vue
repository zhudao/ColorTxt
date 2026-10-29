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
import SwitchToggle from "./SwitchToggle.vue";
import PathPickerInput from "./PathPickerInput.vue";
import { icons } from "../icons";
import {
  BUILTIN_DICTIONARY_LABELS,
  dictionaryDisplayName,
  mergeDictionarySettings,
} from "../constants/dictionarySettings";
import { resolveDefaultDictionariesDirSync } from "../utils/defaultCacheDirs";
import type {
  DictionarySettings,
  ImportedDictionary,
} from "@shared/dictionaryTypes";
import { appToast } from "../services/appToast";
import {
  SORTABLE_ROW_HANDLE_CLASS,
  useSortableReorder,
} from "../composables/useSortableReorder";

const open = defineModel<boolean>({ default: false });

const props = defineProps<{
  settings: DictionarySettings;
}>();

const emit = defineEmits<{
  "update:settings": [v: DictionarySettings];
}>();

const importing = ref(false);
const showEditModal = ref(false);
const editingLocalId = ref<string | null>(null);
const editName = ref("");
const listRef = useTemplateRef<HTMLElement>("listRef");
/** 仅在实际出现纵向滚动条时加右侧内边距（与下拉/分类菜单等一致） */
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

type RowKind = "builtin-net" | "local";

type RowItem = {
  id: string;
  title: string;
  kindLabel: string;
  kind: RowKind;
  editable: boolean;
  removable: boolean;
  unsupported?: boolean;
  unsupportedReason?: string;
};

function patch(partial: Partial<DictionarySettings>) {
  emit(
    "update:settings",
    mergeDictionarySettings({
      ...props.settings,
      ...partial,
      providerEnabled: {
        ...props.settings.providerEnabled,
        ...(partial.providerEnabled ?? {}),
      },
    }),
  );
}

function localKindLabel(d: ImportedDictionary): string {
  switch (d.kind) {
    case "stardict":
      return "StarDict";
    case "mdict":
      return "MDict";
    case "dict":
      return "DICT";
    case "slob":
      return "Slob";
    case "bgl":
      return "BGL";
    default:
      return d.kind;
  }
}

const rows = computed<RowItem[]>(() => {
  const s = props.settings;
  const localById = new Map(s.importedDictionaries.map((d) => [d.id, d]));
  return s.providerOrder.map((id) => {
    const local = localById.get(id);
    if (local) {
      return {
        id,
        title: local.name,
        kindLabel: localKindLabel(local),
        kind: "local" as const,
        editable: true,
        removable: true,
        unsupported: local.unsupported,
        unsupportedReason: local.unsupportedReason,
      };
    }
    return {
      id,
      title: BUILTIN_DICTIONARY_LABELS[id] ?? dictionaryDisplayName(s, id),
      kindLabel: "网络词典",
      kind: "builtin-net" as const,
      editable: false,
      removable: false,
    };
  });
});

const rowCount = computed(() => rows.value.length);

useSortableReorder({
  containerRef: listRef,
  draggable: ".dictRow",
  active: open,
  itemCount: rowCount,
  enabled: computed(() => rows.value.length > 1),
  onReorder(from, to) {
    const order = [...props.settings.providerOrder];
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
    patch({ providerOrder: order });
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

function isEnabled(id: string): boolean {
  return props.settings.providerEnabled[id] !== false;
}

function setEnabled(id: string, enabled: boolean) {
  patch({
    providerEnabled: {
      ...props.settings.providerEnabled,
      [id]: enabled,
    },
  });
}

const defaultCacheDirPlaceholder = computed(() =>
  resolveDefaultDictionariesDirSync(),
);

function onLocalCacheDirChange(v: string) {
  const t = v.trim();
  patch({ localCacheDir: t || resolveDefaultDictionariesDirSync() });
}

async function onImportLocal() {
  if (importing.value) return;
  const r = await window.colorTxt.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "词典包",
        extensions: [
          "mdx",
          "mdd",
          "ifo",
          "idx",
          "dict",
          "dz",
          "syn",
          "index",
          "slob",
          "bgl",
          "css",
        ],
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (r.canceled || !r.filePaths.length) return;
  importing.value = true;
  try {
    const res = await window.colorTxt.dictionaryImport({
      filePaths: r.filePaths,
      localCacheDir: props.settings.localCacheDir,
    });
    if (!res.ok) {
      appToast(res.message || "导入失败", { kind: "danger" });
      return;
    }
    const importedIds = res.imported.map((d) => d.id);
    const nextImported = [
      ...res.imported,
      ...props.settings.importedDictionaries,
    ];
    const nextOrder = [...importedIds, ...props.settings.providerOrder];
    const nextEnabled = { ...props.settings.providerEnabled };
    for (const d of res.imported) {
      nextEnabled[d.id] = !d.unsupported;
    }
    patch({
      importedDictionaries: nextImported,
      providerOrder: nextOrder,
      providerEnabled: nextEnabled,
    });
    appToast(res.message || `已导入 ${res.imported.length} 本词典`, {
      kind: "success",
    });
  } catch (e) {
    appToast(e instanceof Error ? e.message : String(e), { kind: "danger" });
  } finally {
    importing.value = false;
  }
}

function openEdit(row: RowItem) {
  if (!row.editable || row.kind !== "local") return;
  const local = props.settings.importedDictionaries.find(
    (d) => d.id === row.id,
  );
  if (!local) return;
  editingLocalId.value = local.id;
  editName.value = local.name;
  showEditModal.value = true;
}

async function onRemove(id: string) {
  const local = props.settings.importedDictionaries.find((d) => d.id === id);
  if (!local) return;
  const ok = await window.colorTxt.confirm("确定删除该词典？");
  if (!ok) return;
  const res = await window.colorTxt.dictionaryRemove({
    id: local.id,
    bundleDir: local.bundleDir,
    localCacheDir: props.settings.localCacheDir,
  });
  if (!res.ok) {
    appToast(res.message || "删除失败", { kind: "danger" });
    return;
  }
  patch({
    importedDictionaries: props.settings.importedDictionaries.filter(
      (d) => d.id !== id,
    ),
    providerOrder: props.settings.providerOrder.filter((x) => x !== id),
    providerEnabled: Object.fromEntries(
      Object.entries(props.settings.providerEnabled).filter(([k]) => k !== id),
    ),
  });
}

function onSaveLocalName() {
  const name = editName.value.trim();
  if (!name) {
    appToast("请填写名称", { kind: "danger" });
    return;
  }
  if (!editingLocalId.value) return;
  patch({
    importedDictionaries: props.settings.importedDictionaries.map((d) =>
      d.id === editingLocalId.value ? { ...d, name } : d,
    ),
  });
  showEditModal.value = false;
  appToast("已保存", { kind: "success" });
}
</script>

<template>
  <AppModal
    v-model="open"
    title="词典管理"
    max-width="720px"
    panel-class="dictionaryManagePanel"
    :mask-closable="true"
    :esc-closable="true"
    :body-scroll="false"
  >
    <div class="dictManage">
      <div class="dictCacheRow">
        <span class="dictCacheLabel">本地词典缓存目录</span>
        <PathPickerInput
          :model-value="settings.localCacheDir"
          is-directory
          :placeholder="defaultCacheDirPlaceholder"
          aria-label="本地词典缓存目录"
          class="dictCachePicker"
          @update:model-value="onLocalCacheDirChange"
        />
      </div>

      <ul
        ref="listRef"
        class="dictList"
        :class="{ 'dictList--scrollbarPad': listHasScrollbar }"
        aria-label="词典列表"
      >
        <li v-for="row in rows" :key="row.id" class="dictRow">
          <div class="dictCol dictCol--switch">
            <SwitchToggle
              :model-value="isEnabled(row.id)"
              :disabled="!!row.unsupported"
              :aria-label="`启用 ${row.title}`"
              @update:model-value="setEnabled(row.id, $event)"
            />
          </div>
          <div class="dictCol dictCol--title" :title="row.title">
            <span class="dictRowTitle">{{ row.title }}</span>
            <span v-if="row.unsupported" class="dictWarn">
              不支持{{
                row.unsupportedReason ? `（${row.unsupportedReason}）` : ""
              }}
            </span>
          </div>
          <div class="dictCol dictCol--kind">
            <span class="tag">{{ row.kindLabel }}</span>
          </div>
          <div class="dictCol dictCol--actions">
            <button
              type="button"
              class="dictIconBtn"
              :class="SORTABLE_ROW_HANDLE_CLASS"
              aria-label="拖动排序"
              title="拖动排序"
            >
              <span aria-hidden="true" v-html="icons.move" />
            </button>
            <button
              type="button"
              class="dictIconBtn"
              :class="{ invisible: !row.editable }"
              :tabindex="row.editable ? 0 : -1"
              :aria-hidden="!row.editable"
              aria-label="编辑"
              title="编辑"
              @click="row.editable && openEdit(row)"
            >
              <span aria-hidden="true" v-html="icons.edit" />
            </button>
            <button
              type="button"
              class="dictIconBtn dictIconBtn--danger"
              :class="{ invisible: !row.removable }"
              :tabindex="row.removable ? 0 : -1"
              :aria-hidden="!row.removable"
              aria-label="移除"
              title="移除"
              @click="row.removable && onRemove(row.id)"
            >
              <span aria-hidden="true" v-html="icons.remove" />
            </button>
          </div>
        </li>
      </ul>

      <div class="dictFooterActions">
        <p class="dictFooterHint">
          提示：导入时请同时选择词典包内的所有文件
        </p>
        <button
          type="button"
          class="btn"
          size="large"
          :disabled="importing"
          @click="onImportLocal"
        >
          {{ importing ? "导入中…" : "导入本地词典" }}
        </button>
      </div>
    </div>
  </AppModal>

  <AppModal
    v-model="showEditModal"
    title="编辑本地词典"
    max-width="480px"
    :mask-closable="true"
    :esc-closable="true"
  >
    <div class="dictEditForm">
      <label class="dictField">
        <span class="dictFieldLabel">名称</span>
        <input v-model="editName" class="dictInput" type="text" />
      </label>
    </div>
    <template #footer>
      <div class="dictEditFooter">
        <button
          type="button"
          class="btn"
          size="large"
          @click="showEditModal = false"
        >
          取消
        </button>
        <button
          type="button"
          class="btn primary"
          size="large"
          @click="onSaveLocalName"
        >
          确定
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
:deep(.dictionaryManagePanel) {
  max-height: min(90vh, 640px);
}

.dictManage {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}

.dictCacheRow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.dictCacheLabel {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--fg);
  white-space: nowrap;
}

.dictCachePicker {
  flex: 1 1 240px;
  min-width: 0;
}

.dictList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

/* 有纵向滚动条时：与轨道留出间距；无条时不加，避免右侧空一条 */
.dictList--scrollbarPad {
  padding-right: 8px;
}

.dictFooterActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.dictFooterHint {
  flex: 1 1 180px;
  margin: 0;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.dictRow {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.dictCol--switch {
  display: flex;
  justify-content: center;
}

.dictCol--title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dictRowTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dictWarn {
  font-size: 11px;
  color: var(--danger, #c44);
}

.dictCol--kind {
  flex-shrink: 0;
}

.dictCol--actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.dictIconBtn {
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

.dictIconBtn:hover:not(:disabled):not(.invisible) {
  background: var(--icon-btn-bg-hover);
}

.dictIconBtn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.dictIconBtn.invisible {
  visibility: hidden;
  pointer-events: none;
}

.dictIconBtn--danger {
  color: var(--danger, #c44);
}

.dictIconBtn :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.dictIconBtn :deep(svg path) {
  fill: currentColor;
}

.dictIconBtn.sortableRowHandle {
  cursor: grab;
}

.dictEditForm {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 8px;
}

.dictField {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dictFieldLabel {
  font-size: 12px;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.dictInput {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 13px;
}

.dictEditFooter {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
</style>
