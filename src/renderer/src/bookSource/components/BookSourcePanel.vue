<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import AppModal from "../../components/AppModal.vue";
import AppCheckbox from "../../components/AppCheckbox.vue";
import AppCustomSelect from "../../components/AppCustomSelect.vue";
import IconButton from "../../components/IconButton.vue";
import SwitchToggle from "../../components/SwitchToggle.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import { useListSelectionHotkeys } from "../../composables/useListSelectionHotkeys";
import {
  SORTABLE_ROW_HANDLE_CLASS,
  useSortableReorder,
} from "../../composables/useSortableReorder";
import { icons } from "../../icons";
import ImportBookSourcePanel from "./ImportBookSourcePanel.vue";
import EditBookSourcePanel from "./EditBookSourcePanel.vue";
import BookSourceLoginPanel from "./BookSourceLoginPanel.vue";
import BookSourceCenterState from "./BookSourceCenterState.vue";
import CheckSourceConfigPanel from "./CheckSourceConfigPanel.vue";
import {
  isNetworkImportAborted,
  newEmptyBookSource,
  useBookSourceApi,
} from "../composables/useBookSource";
import type {
  BookSourceListItem,
} from "@shared/bookSource/types";
import type { BookSourceCheckEvent } from "@shared/bookSource/ipc";
import { appConfirm, appPrompt } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import {
  DEFAULT_BOOK_SOURCE_FILTER,
  DEFAULT_BOOK_SOURCE_SORT,
  bookSourceFilterLabel,
  bookSourceSortLabel,
  bookSourceSortTriggerPrefixHtml,
  createBookSourceFilterItems,
  createBookSourceSortItems,
  filterAndSortBookSources,
  isBookSourceManualSort,
  reorderBookSourceManualOrders,
  type BookSourceFilterMode,
  type BookSourceSortMode,
} from "../bookSourcePanelSortFilter";
import "../bookSourceToolbar.css";

const modelValue = defineModel<boolean>({ default: false });

const emit = defineEmits<{
  searchSource: [item: BookSourceListItem];
  /** 书源列表启用态 / 发现态 / 增删改后，供找书/发现刷新空状态 */
  sourcesChanged: [];
}>();

const {
  listSources,
  deleteSources,
  toggleSource,
  importFromFile,
  importFromNetwork,
  importFromClipboard,
  getSource,
  saveSource,
  reorderSource,
  applySourceCustomOrders,
} = useBookSourceApi();

const sourceListRef = ref<HTMLElement | null>(null);
/** 列表快捷键焦点容器（与侧栏文件列表一致） */
const listFocusRef = ref<HTMLElement | null>(null);

const items = ref<BookSourceListItem[]>([]);
const filter = ref("");
const sortMode = ref<BookSourceSortMode>(DEFAULT_BOOK_SOURCE_SORT);
const filterMode = ref<BookSourceFilterMode>(DEFAULT_BOOK_SOURCE_FILTER);
const sortScrollItems = createBookSourceSortItems();
const filterScrollItems = createBookSourceFilterItems();
const selected = ref<Set<string>>(new Set());
/** Shift 连选锚点（与侧栏文件列表 / 书架管理一致） */
const lastSelectedUrl = ref<string | null>(null);
const headerMoreBtnRef = ref<HTMLElement | null>(null);
const headerMoreMenu = useAnchoredAppShellMenu({
  anchor: headerMoreBtnRef,
  placement: "below-end",
  widthPx: 200,
  gap: 6,
});
const {
  open: headerMoreOpen,
  left: headerMoreLeft,
  top: headerMoreTop,
  toggleMenu: toggleHeaderMoreMenu,
  closeMenu: closeHeaderMoreMenu,
  panelRef: headerMorePanelRef,
} = headerMoreMenu;

const footerMoreBtnRef = ref<HTMLElement | null>(null);
const footerMoreMenu = useAnchoredAppShellMenu({
  anchor: footerMoreBtnRef,
  placement: "above-end",
  widthPx: 180,
});
const {
  open: footerMoreOpen,
  left: footerMoreLeft,
  top: footerMoreTop,
  toggleMenu: toggleFooterMoreMenu,
  closeMenu: closeFooterMoreMenu,
  panelRef: footerMorePanelRef,
} = footerMoreMenu;

const rowMenuAnchor = ref<HTMLElement | null>(null);
const rowMenuItem = ref<BookSourceListItem | null>(null);
const rowMenu = useAnchoredAppShellMenu({
  anchor: rowMenuAnchor,
  placement: "below-end",
  widthPx: 168,
  gap: 6,
});
const {
  open: rowMenuOpen,
  left: rowMenuLeft,
  top: rowMenuTop,
  openMenu: openRowMenu,
  closeMenu: closeRowMenu,
  panelRef: rowMenuPanelRef,
} = rowMenu;

function bindHeaderMorePanel(el: HTMLElement | null) {
  headerMorePanelRef.value = el;
}
function bindFooterMorePanel(el: HTMLElement | null) {
  footerMorePanelRef.value = el;
}
function bindRowMenuPanel(el: HTMLElement | null) {
  rowMenuPanelRef.value = el;
}

const showImport = ref(false);
const importItems = ref<import("@shared/bookSource/types").BookSourceImportPreviewItem[]>([]);
const showEdit = ref(false);
const showLogin = ref(false);
const showCheckConfig = ref(false);
const loginSource = ref<import("@shared/bookSource/types").BookSourceRecord | null>(null);
const editingUrl = ref<string | null>(null);
const editingDraft = ref<import("@shared/bookSource/types").BookSourceRecord | null>(null);

const checking = ref(false);
const checkProgressText = ref("");
/** 校验过程/结果文案（对齐 Legado Debug.debugMessageMap） */
const checkMessages = ref<Map<string, string>>(new Map());
let unsubCheckEvent: (() => void) | null = null;

function bindCheckEvents() {
  if (unsubCheckEvent) return;
  unsubCheckEvent = window.colorTxt.onBookSourceCheckEvent((ev) => {
    onCheckEvent(ev);
  });
}

function unbindCheckEvents() {
  unsubCheckEvent?.();
  unsubCheckEvent = null;
}

function onCheckEvent(ev: BookSourceCheckEvent) {
  if (!modelValue.value) return;
  if (ev.type === "sourceStatus") {
    if (!checking.value) return;
    const nextMsg = new Map(checkMessages.value);
    nextMsg.set(ev.sourceUrl, ev.message);
    checkMessages.value = nextMsg;
    return;
  }
  if (ev.type === "sourceDone") {
    const nextMsg = new Map(checkMessages.value);
    if (!isCheckFinishedMessage(ev.message)) {
      nextMsg.delete(ev.sourceUrl);
    } else {
      nextMsg.set(ev.sourceUrl, ev.message);
      const idx = items.value.findIndex((i) => i.bookSourceUrl === ev.sourceUrl);
      if (idx >= 0) {
        const copy = items.value.slice();
        copy[idx] = {
          ...copy[idx]!,
          respondTime: ev.respondTime,
        };
        items.value = copy;
      }
    }
    checkMessages.value = nextMsg;
    return;
  }
  if (ev.type === "progress") {
    checkProgressText.value = `校验中 ${ev.completed}/${ev.total} · ${ev.sourceName}`;
    return;
  }
  if (ev.type === "done") {
    checking.value = false;
    checkProgressText.value = "";
    if (ev.cancelled) {
      resetIncompleteCheckMessages();
      appToast(`已停止校验（完成 ${ev.completed}/${ev.total}）`, { kind: "warning" });
    } else {
      appToast(`校验完成（${ev.completed}/${ev.total}）`, { kind: "info" });
    }
    void refresh();
  }
}

onBeforeUnmount(() => {
  unbindCheckEvents();
});

const filtered = computed(() =>
  filterAndSortBookSources(
    items.value,
    filter.value,
    filterMode.value,
    sortMode.value,
  ),
);

const sortDisplayLabel = computed(() => bookSourceSortLabel(sortMode.value));
const sortTriggerPrefixHtml = computed(() =>
  bookSourceSortTriggerPrefixHtml(sortMode.value),
);
const filterDisplayLabel = computed(() => bookSourceFilterLabel(filterMode.value));
const canDragReorder = computed(() => isBookSourceManualSort(sortMode.value));

useSortableReorder({
  containerRef: sourceListRef,
  draggable: "li",
  active: modelValue,
  enabled: canDragReorder,
  itemCount: computed(() => filtered.value.length),
  onReorder(from, to) {
    if (!isBookSourceManualSort(sortMode.value)) return;
    const updates = reorderBookSourceManualOrders(filtered.value, from, to);
    if (!updates.length) return;
    const orderMap = new Map(updates.map((u) => [u.url, u.customOrder]));
    items.value = items.value.map((it) => {
      const order = orderMap.get(it.bookSourceUrl);
      return order === undefined ? it : { ...it, customOrder: order };
    });
    void applySourceCustomOrders(updates);
  },
});

function onSortSelect(id: string) {
  sortMode.value = id as BookSourceSortMode;
}

function onFilterSelect(id: string) {
  filterMode.value = id as BookSourceFilterMode;
}

const listEmptyText = computed(() =>
  items.value.length === 0 ? "暂无书源" : "无匹配的书源",
);

/** 当前列表（筛选后）中勾选的数量；被过滤掉的不计入 */
const selectedCount = computed(() => {
  let n = 0;
  for (const item of filtered.value) {
    if (selected.value.has(item.bookSourceUrl)) n += 1;
  }
  return n;
});
const allFilteredSelected = computed(
  () =>
    filtered.value.length > 0 &&
    filtered.value.every((i) => selected.value.has(i.bookSourceUrl)),
);
const selectAllLabel = computed(() =>
  allFilteredSelected.value ? "取消全选" : "全选",
);
const selectAllIndeterminate = computed(
  () => selectedCount.value > 0 && !allFilteredSelected.value,
);

function exploreDotClass(item: BookSourceListItem): string | null {
  if (!item.hasExploreUrl) return null;
  return item.enabledExplore ? "bsRowDot--green" : "bsRowDot--red";
}

async function refresh() {
  items.value = await listSources();
}

async function refreshAndNotify() {
  await refresh();
  emit("sourcesChanged");
}

defineExpose({
  refreshLibrary: refreshAndNotify,
});

function notifySourcesChanged() {
  emit("sourcesChanged");
}

watch(items, (next) => {
  if (selected.value.size === 0) return;
  const valid = new Set(next.map((i) => i.bookSourceUrl));
  const pruned = new Set<string>();
  for (const url of selected.value) {
    if (valid.has(url)) pruned.add(url);
  }
  selected.value = pruned;
  if (lastSelectedUrl.value && !pruned.has(lastSelectedUrl.value)) {
    lastSelectedUrl.value =
      pruned.size > 0 ? [...pruned][pruned.size - 1]! : null;
  }
});

function clearSelection() {
  selected.value = new Set();
  lastSelectedUrl.value = null;
}

function selectAll() {
  const urls = filtered.value.map((i) => i.bookSourceUrl);
  selected.value = new Set(urls);
  lastSelectedUrl.value = urls.length > 0 ? urls[urls.length - 1]! : null;
}

function invertSelect() {
  const visibleKeys = filtered.value.map((i) => i.bookSourceUrl);
  const visible = new Set(visibleKeys);
  const next = new Set<string>();
  for (const url of selected.value) {
    if (!visible.has(url)) next.add(url);
  }
  for (const url of visibleKeys) {
    if (!selected.value.has(url)) next.add(url);
  }
  selected.value = next;
  lastSelectedUrl.value =
    next.size > 0 ? [...next][next.size - 1]! : null;
}

function isCheckFailedMessage(msg: string | undefined): boolean {
  return !!msg?.includes("校验失败");
}

function isCheckFinishedMessage(msg: string | undefined): boolean {
  return !!msg && (msg.includes("校验成功") || msg.includes("校验失败"));
}

/** 停止校验后：未完成项去掉中间态，已成功/失败的结果保留 */
function resetIncompleteCheckMessages() {
  const nextMsg = new Map(checkMessages.value);
  let changed = false;
  for (const [url, msg] of nextMsg) {
    if (!isCheckFinishedMessage(msg)) {
      nextMsg.delete(url);
      changed = true;
    }
  }
  if (changed) checkMessages.value = nextMsg;
}

/** 当前筛选列表中是否有校验失败的书源 */
const hasCheckFailedInList = computed(() =>
  filtered.value.some((i) =>
    isCheckFailedMessage(checkMessages.value.get(i.bookSourceUrl)),
  ),
);

function selectCheckFailed() {
  const urls = filtered.value
    .filter((i) =>
      isCheckFailedMessage(checkMessages.value.get(i.bookSourceUrl)),
    )
    .map((i) => i.bookSourceUrl);
  selected.value = new Set(urls);
  lastSelectedUrl.value =
    urls.length > 0 ? urls[urls.length - 1]! : null;
}

const { onListKeydown, focusList } = useListSelectionHotkeys({
  listEl: listFocusRef,
  enabled: () =>
    modelValue.value &&
    !showImport.value &&
    !showEdit.value &&
    !showLogin.value &&
    !showCheckConfig.value,
  onSelectAll: selectAll,
  onInvert: invertSelect,
});

watch(modelValue, (open) => {
  if (open) {
    void refresh();
    focusList();
    return;
  }
  clearSelection();
  // 关闭面板时保留已完成的校验结果；进行中的中间态清空并停止校验
  checkProgressText.value = "";
  if (checking.value) {
    checking.value = false;
    resetIncompleteCheckMessages();
    void window.colorTxt.bookSourceCheckCancel();
  }
});

/** 与资源管理器一致：单击单选、Ctrl 多选、Shift 连选 */
function onRowClick(item: BookSourceListItem, listIndex: number, ev: MouseEvent) {
  const url = item.bookSourceUrl;
  const list = filtered.value;
  const toggleMod = ev.ctrlKey || ev.metaKey;
  const rangeMod = ev.shiftKey;

  if (rangeMod) {
    const anchor = lastSelectedUrl.value;
    if (!anchor) {
      lastSelectedUrl.value = url;
      selected.value = new Set([url]);
      focusList();
      return;
    }
    const anchorIdx = list.findIndex((i) => i.bookSourceUrl === anchor);
    const clickedIdx = listIndex;
    if (anchorIdx < 0 || clickedIdx < 0) {
      lastSelectedUrl.value = url;
      selected.value = new Set([url]);
      focusList();
      return;
    }
    const start = Math.min(anchorIdx, clickedIdx);
    const end = Math.max(anchorIdx, clickedIdx);
    selected.value = new Set(
      list.slice(start, end + 1).map((i) => i.bookSourceUrl),
    );
    focusList();
    return;
  }

  if (toggleMod) {
    const next = new Set(selected.value);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    selected.value = next;
    lastSelectedUrl.value = url;
    focusList();
    return;
  }

  selected.value = new Set([url]);
  lastSelectedUrl.value = url;
  focusList();
}

function onToggleSelectAll() {
  if (allFilteredSelected.value) clearSelection();
  else selectAll();
}

function selectedUrlsInListOrder(): string[] {
  return filtered.value
    .filter((i) => selected.value.has(i.bookSourceUrl))
    .map((i) => i.bookSourceUrl);
}

async function onDelete() {
  const urls = selectedUrlsInListOrder();
  if (!urls.length) return;
  const ok = await appConfirm(`是否删除选中的 ${urls.length} 个书源？`);
  if (!ok) return;
  await deleteSources(urls);
  clearSelection();
  await refreshAndNotify();
}

async function onBatchToggleEnabled(enabled: boolean) {
  closeFooterMoreMenu();
  const urls = selectedUrlsInListOrder();
  if (!urls.length) return;
  await Promise.all(urls.map((url) => toggleSource(url, enabled)));
  await refreshAndNotify();
}

async function onBatchToggleExplore(enabledExplore: boolean) {
  closeFooterMoreMenu();
  const urls = selectedUrlsInListOrder();
  if (!urls.length) return;
  for (const url of urls) {
    const source = await getSource(url);
    if (!source) continue;
    await saveSource({ ...source, enabledExplore });
  }
  await refreshAndNotify();
}

async function onBatchMoveTop() {
  closeFooterMoreMenu();
  const urls = selectedUrlsInListOrder();
  if (!urls.length) return;
  for (const url of urls) {
    await reorderSource(url, "top");
  }
  await refresh();
}

async function onBatchMoveBottom() {
  closeFooterMoreMenu();
  const urls = [...selectedUrlsInListOrder()].reverse();
  if (!urls.length) return;
  for (const url of urls) {
    await reorderSource(url, "bottom");
  }
  await refresh();
}

async function onExportSelected() {
  closeFooterMoreMenu();
  const urls = selectedUrlsInListOrder();
  if (!urls.length) return;
  const sources: import("@shared/bookSource/types").BookSourceRecord[] = [];
  for (const url of urls) {
    const source = await getSource(url);
    if (source) sources.push(source);
  }
  if (!sources.length) {
    appToast("没有可导出的书源", { kind: "warning" });
    return;
  }
  const save = await window.colorTxt.showSaveDialog({
    title: "导出所选书源",
    defaultPath: "bookSource.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (save.canceled || !save.filePath) return;
  const body = `${JSON.stringify(sources, null, 2)}\n`;
  const written = await window.colorTxt.writeTextFile(save.filePath, body, "utf8");
  if (!written.ok) {
    appToast(written.message || "导出失败", { kind: "danger" });
    return;
  }
  appToast(`已导出 ${sources.length} 个书源`, { kind: "success" });
}

async function onStopCheck() {
  if (!checking.value) return;
  await window.colorTxt.bookSourceCheckCancel();
  resetIncompleteCheckMessages();
  appToast("正在停止校验…", { kind: "warning" });
}

async function startCheckSources(urls: string[]) {
  if (!urls.length) return;
  if (checking.value) {
    await onStopCheck();
    return;
  }
  let keyword = "我的";
  try {
    const cfg = await window.colorTxt.bookSourceCheckGetConfig();
    if (cfg?.keyword?.trim()) keyword = cfg.keyword.trim();
  } catch {
    /* ignore */
  }
  const input = await appPrompt("", {
    title: "搜索书名、作者",
    defaultValue: keyword,
    placeholder: "search word",
    neutralLabel: "校验设置",
    onNeutral: () => {
      showCheckConfig.value = true;
    },
  });
  if (input === null) return;
  const word = input.trim() || keyword;
  bindCheckEvents();
  // 仅清空本次将校验的项，保留其它书源已有校验结果
  if (urls.length) {
    const nextMsg = new Map(checkMessages.value);
    for (const url of urls) nextMsg.delete(url);
    checkMessages.value = nextMsg;
  }
  checking.value = true;
  checkProgressText.value = `校验中 0/${urls.length}`;
  const r = await window.colorTxt.bookSourceCheckStart(urls, { keyword: word });
  if (!r.ok) {
    checking.value = false;
    checkProgressText.value = "";
    appToast(r.message || "无法开始校验", { kind: "warning" });
  }
}

async function onCheckSelected() {
  closeFooterMoreMenu();
  await startCheckSources(selectedUrlsInListOrder());
}

async function onToggle(item: BookSourceListItem, enabled: boolean) {
  await toggleSource(item.bookSourceUrl, enabled);
  item.enabled = enabled;
  notifySourcesChanged();
}

function onEdit(item: BookSourceListItem) {
  editingUrl.value = item.bookSourceUrl;
  editingDraft.value = null;
  showEdit.value = true;
}

function onSearchSource(item: BookSourceListItem) {
  modelValue.value = false;
  emit("searchSource", item);
}

function onSearchFromEdit(item: {
  bookSourceUrl: string;
  bookSourceName: string;
}) {
  showEdit.value = false;
  editingUrl.value = null;
  editingDraft.value = null;
  onSearchSource({
    bookSourceUrl: item.bookSourceUrl,
    bookSourceName: item.bookSourceName,
  } as BookSourceListItem);
}

function onRowMoreClick(item: BookSourceListItem, e: MouseEvent) {
  rowMenuItem.value = item;
  rowMenuAnchor.value = e.currentTarget as HTMLElement;
  void openRowMenu();
}

async function onRowMenuTop() {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  await reorderSource(item.bookSourceUrl, "top");
  await refresh();
}

async function onRowMenuBottom() {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  await reorderSource(item.bookSourceUrl, "bottom");
  await refresh();
}

async function onRowMenuCheck() {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  await startCheckSources([item.bookSourceUrl]);
}

async function onRowMenuToggleExplore() {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  const source = await getSource(item.bookSourceUrl);
  if (!source) return;
  await saveSource({ ...source, enabledExplore: !item.enabledExplore });
  await refreshAndNotify();
}

async function onRowMenuDelete() {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  const ok = await appConfirm(`删除书源「${item.bookSourceName}」？`);
  if (!ok) return;
  await deleteSources([item.bookSourceUrl]);
  const next = new Set(selected.value);
  next.delete(item.bookSourceUrl);
  selected.value = next;
  if (lastSelectedUrl.value === item.bookSourceUrl) {
    lastSelectedUrl.value =
      next.size > 0 ? [...next][next.size - 1]! : null;
  }
  await refreshAndNotify();
}

function onNewSource() {
  closeHeaderMoreMenu();
  editingUrl.value = null;
  editingDraft.value = newEmptyBookSource();
  showEdit.value = true;
}

async function onLocalImport() {
  closeHeaderMoreMenu();
  const preview = await importFromFile();
  if (!preview.length) return;
  importItems.value = preview;
  showImport.value = true;
}

async function onNetworkImport() {
  closeHeaderMoreMenu();
  try {
    const preview = await importFromNetwork();
    if (!preview.length) return;
    importItems.value = preview;
    showImport.value = true;
  } catch (e) {
    if (isNetworkImportAborted(e)) return;
    console.error(e);
    appToast(e instanceof Error ? e.message : "网络导入失败", {
      kind: "warning",
    });
  }
}

async function onClipboardImport() {
  closeHeaderMoreMenu();
  let preview: typeof importItems.value;
  try {
    preview = await importFromClipboard();
  } catch {
    appToast("读取剪贴板失败", { kind: "warning" });
    return;
  }
  if (!preview.length) {
    appToast("剪贴板中没有有效书源（需含 bookSourceUrl / bookSourceName）", {
      kind: "warning",
    });
    return;
  }
  importItems.value = preview;
  showImport.value = true;
}

async function onImportDone() {
  showImport.value = false;
  focusList();
  void refreshAndNotify();
}

async function onLogin(item: BookSourceListItem) {
  const source = await getSource(item.bookSourceUrl);
  if (!source?.loginUrl?.trim()) {
    appToast("此书源未配置登录", { kind: "warning" });
    return;
  }
  // 对齐 Legado SourceLoginActivity：无 loginUi → WebView；有 loginUi → 弹层
  if (!source.loginUi?.trim()) {
    const r = await window.colorTxt.bookSourceBrowserLogin(
      source.bookSourceUrl,
      `登录 · ${source.bookSourceName}`,
    );
    if (r.ok) appToast("Cookie 已保存", { kind: "info" });
    else if (!r.cancelled && r.message) appToast(r.message, { kind: "warning" });
    return;
  }
  loginSource.value = source;
  showLogin.value = true;
}

function onEditDone() {
  showEdit.value = false;
  editingUrl.value = null;
  editingDraft.value = null;
  focusList();
  void refreshAndNotify();
}
</script>

<template>
  <AppModal
    v-model="modelValue"
    title="书源"
    panel-class="bookSourcePanel"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="false"
  >
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
        <AppCustomSelect
          v-model="sortMode"
          class="bsToolbarSelect"
          :display-label="sortDisplayLabel"
          :trigger-prefix-html="sortTriggerPrefixHtml"
          :fixed-top-items="[]"
          :scroll-items="sortScrollItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="450"
          ariaLabel="书源排序"
          @update:model-value="onSortSelect"
        />
        <AppCustomSelect
          v-model="filterMode"
          class="bsToolbarSelect"
          :display-label="filterDisplayLabel"
          :fixed-top-items="[]"
          :scroll-items="filterScrollItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="280"
          ariaLabel="书源过滤"
          @update:model-value="onFilterSelect"
        />
        <div ref="headerMoreBtnRef" class="bsMoreWrap">
          <IconButton
            :icon-html="icons.more"
            :active="headerMoreOpen"
            :pressed="headerMoreOpen"
            title="更多"
            aria-label="更多"
            aria-haspopup="menu"
            :aria-expanded="headerMoreOpen"
            @click="toggleHeaderMoreMenu"
          />
          <AppShellMenuTeleport
            v-model:open="headerMoreOpen"
            :left="headerMoreLeft"
            :top="headerMoreTop"
            caret="end"
            :on-panel-mount="bindHeaderMorePanel"
          >
            <button type="button" class="appShellMenuItem" @click="onNewSource">
              新建书源
            </button>
            <button type="button" class="appShellMenuItem" @click="onLocalImport">
              本地导入
            </button>
            <button type="button" class="appShellMenuItem" @click="onNetworkImport">
              网络导入
            </button>
            <button type="button" class="appShellMenuItem" @click="onClipboardImport">
              从剪贴板导入
            </button>
          </AppShellMenuTeleport>
        </div>
      </header>

      <div
        ref="listFocusRef"
        class="bsListArea"
        tabindex="0"
        @keydown="onListKeydown"
      >
        <BookSourceCenterState v-if="!filtered.length">
          {{ listEmptyText }}
        </BookSourceCenterState>
        <ul v-else ref="sourceListRef" class="bsList">
          <li
            v-for="(item, index) in filtered"
            :key="item.bookSourceUrl"
            class="bsRow"
            @click="onRowClick(item, index, $event)"
          >
            <button
              v-if="canDragReorder"
              type="button"
              class="bsRowDragHandle"
              :class="SORTABLE_ROW_HANDLE_CLASS"
              aria-label="拖动排序"
              title="拖动排序"
              @click.stop
            >
              <span class="bsRowDragHandleIcon" aria-hidden="true" v-html="icons.move" />
            </button>
            <AppCheckbox
              class="bsRowCheckbox"
              passive
              :model-value="selected.has(item.bookSourceUrl)"
              :aria-label="`选择 ${item.bookSourceName}`"
            />
            <div class="bsRowMain">
              <div class="bsRowName">{{ item.bookSourceName }}</div>
              <div
                v-if="checkMessages.get(item.bookSourceUrl)"
                class="bsRowCheckMsg"
                :class="{
                  'bsRowCheckMsg--ok':
                    checkMessages.get(item.bookSourceUrl)?.includes('校验成功'),
                  'bsRowCheckMsg--fail':
                    checkMessages.get(item.bookSourceUrl)?.includes('校验失败'),
                }"
              >
                {{ checkMessages.get(item.bookSourceUrl) }}
              </div>
            </div>
            <div class="bsRowActions" @click.stop>
              <SwitchToggle
                :model-value="item.enabled"
                :aria-label="`启用 ${item.bookSourceName}`"
                @update:model-value="onToggle(item, $event)"
              />
              <IconButton
                :icon-html="icons.edit"
                title="编辑"
                aria-label="编辑"
                @click="onEdit(item)"
              />
              <IconButton
                :icon-html="icons.find"
                title="搜索"
                aria-label="搜索"
                @click="onSearchSource(item)"
              />
              <IconButton
                v-if="item.hasLoginUrl"
                :icon-html="icons.user"
                title="登录"
                aria-label="登录"
                @click="onLogin(item)"
              />
              <span v-else class="bsRowLoginPlaceholder" aria-hidden="true" />
              <div class="bsRowMoreWrap">
                <IconButton
                  :icon-html="icons.more"
                  title="更多"
                  aria-label="更多"
                  aria-haspopup="menu"
                  :aria-expanded="
                    rowMenuOpen &&
                    rowMenuItem?.bookSourceUrl === item.bookSourceUrl
                  "
                  :active="
                    rowMenuOpen &&
                    rowMenuItem?.bookSourceUrl === item.bookSourceUrl
                  "
                  :pressed="
                    rowMenuOpen &&
                    rowMenuItem?.bookSourceUrl === item.bookSourceUrl
                  "
                  @click="onRowMoreClick(item, $event)"
                />
                <span
                  v-if="exploreDotClass(item)"
                  class="bsRowDot"
                  :class="exploreDotClass(item)!"
                  :title="item.enabledExplore ? '发现页已启用' : '发现页未启用'"
                />
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <AppShellMenuTeleport
      v-model:open="rowMenuOpen"
      :left="rowMenuLeft"
      :top="rowMenuTop"
      caret="end"
      :on-panel-mount="bindRowMenuPanel"
    >
      <button type="button" class="appShellMenuItem" @click="onRowMenuTop">
        置顶
      </button>
      <button type="button" class="appShellMenuItem" @click="onRowMenuBottom">
        置底
      </button>
      <button
        v-if="rowMenuItem?.hasExploreUrl"
        type="button"
        class="appShellMenuItem"
        @click="onRowMenuToggleExplore"
      >
        {{ rowMenuItem?.enabledExplore ? "禁用发现" : "启用发现" }}
      </button>
      <button type="button" class="appShellMenuItem" @click="onRowMenuCheck">
        校验
      </button>
      <button type="button" class="appShellMenuItem appShellMenuItem--danger" @click="onRowMenuDelete">
        删除
      </button>
    </AppShellMenuTeleport>

    <template #footer>
      <div class="bsFooter">
        <div v-if="checking" class="bsCheckProgressBar">
          <p class="bsCheckProgressText" :title="checkProgressText">
            {{ checkProgressText }}
          </p>
          <button
            type="button"
            class="link danger bsCheckStopLink"
            @click="onStopCheck"
          >
            停止
          </button>
        </div>
        <div class="bsFooterRow">
          <AppCheckbox
            class="bsFooterSelectAll"
            :model-value="allFilteredSelected"
            :indeterminate="selectAllIndeterminate"
            :aria-label="selectAllLabel"
            @update:model-value="onToggleSelectAll"
          >
            <template #label>
              {{ selectAllLabel }}（{{ selectedCount }}/{{ filtered.length }}）
            </template>
          </AppCheckbox>
          <div class="bsFooterActions">
            <button
              v-if="hasCheckFailedInList"
              type="button"
              class="btn"
              size="large"
              @click="selectCheckFailed"
            >
              选中失败项
            </button>
            <button type="button" class="btn" size="large" @click="invertSelect">反选</button>
            <button
              type="button"
              class="btn danger"
              size="large"
              :disabled="!selectedCount"
              @click="onDelete"
            >
              删除
            </button>
            <div ref="footerMoreBtnRef" class="bsFooterMoreWrap">
              <IconButton
                :icon-html="icons.more"
                :active="footerMoreOpen"
                :pressed="footerMoreOpen"
                title="更多"
                aria-label="更多"
                aria-haspopup="menu"
                :aria-expanded="footerMoreOpen"
                @click="toggleFooterMoreMenu"
              />
              <AppShellMenuTeleport
                v-model:open="footerMoreOpen"
                :left="footerMoreLeft"
                :top="footerMoreTop"
                :on-panel-mount="bindFooterMorePanel"
              >
                <button
                  type="button"
                  class="appShellMenuItem"
                  :disabled="!selectedCount"
                  @click="onBatchToggleEnabled(true)"
                >
                  启用所选
                </button>
                <button
                  type="button"
                  class="appShellMenuItem"
                  :disabled="!selectedCount"
                  @click="onBatchToggleEnabled(false)"
                >
                  禁用所选
                </button>
                <button
                  type="button"
                  class="appShellMenuItem"
                  :disabled="!selectedCount"
                  @click="onBatchToggleExplore(true)"
                >
                  启用发现
                </button>
                <button
                  type="button"
                  class="appShellMenuItem"
                  :disabled="!selectedCount"
                  @click="onBatchToggleExplore(false)"
                >
                  禁用发现
                </button>
                <button
                  type="button"
                  class="appShellMenuItem"
                  :disabled="!selectedCount"
                  @click="onBatchMoveTop"
                >
                  置顶所选
                </button>
                <button
                  type="button"
                  class="appShellMenuItem"
                  :disabled="!selectedCount"
                  @click="onBatchMoveBottom"
                >
                  置底所选
                </button>
                <button
                  type="button"
                  class="appShellMenuItem"
                  :disabled="!selectedCount"
                  @click="onExportSelected"
                >
                  导出所选
                </button>
                <button
                  type="button"
                  class="appShellMenuItem"
                  :disabled="!selectedCount && !checking"
                  @click="onCheckSelected"
                >
                  {{ checking ? "停止校验" : "校验所选" }}
                </button>
              </AppShellMenuTeleport>
            </div>
          </div>
        </div>
      </div>
    </template>

    <ImportBookSourcePanel
      v-model="showImport"
      v-model:items="importItems"
      @done="onImportDone"
    />
    <EditBookSourcePanel
      v-model="showEdit"
      :source-url="editingUrl"
      :draft-source="editingDraft ?? undefined"
      @done="onEditDone"
      @search-source="onSearchFromEdit"
    />
    <BookSourceLoginPanel v-model="showLogin" :source="loginSource" />
    <CheckSourceConfigPanel v-model="showCheckConfig" />
  </AppModal>
</template>

<style>
.appModalPanel.bookSourcePanel {
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
.appModalPanel.bookSourcePanel .appModalPanelHeader {
  margin-bottom: 0;
  padding: 12px 48px 12px 16px;
}
.appModalPanel.bookSourcePanel .appModalBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
.appModalPanel.bookSourcePanel .bookSourceToolbarHeader {
  padding: 0 10px 10px 10px;
  border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.08));
}
.appModalPanel.bookSourcePanel .appModalFooter {
  margin-top: 0;
  padding: 0;
  border-top: 1px solid var(--border, rgba(0, 0, 0, 0.08));
}
.appModalPanel.bookSourcePanel .bsList {
  padding: 0 16px;
  overflow: auto;
}

.appModalPanel.bookSourcePanel input.bookSourceToolbarSearch.bsFilterInput[type="search"] {
  width: 100%;
  flex: none;
  padding-left: 32px;
  font-size: 14px;
}
</style>

<style scoped>
.bsFilterField {
  position: relative;
  flex: 1;
  min-width: 0;
}
.bsToolbarSelect {
  flex-shrink: 0;
  width: 114px;
  min-width: 114px;
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
.bsShell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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
.bsRow.sortableRowGhost {
  opacity: 0.45;
}
.bsRow.sortableRowChosen {
  background: color-mix(in srgb, var(--fg) 4%, var(--bg));
}
.bsRowDragHandle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: grab;
}
.bsRowDragHandle:active {
  cursor: grabbing;
}
.bsRowDragHandle:hover {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--fg);
}
.bsRowDragHandleIcon {
  display: flex;
  width: 16px;
  height: 16px;
}
.bsRowDragHandleIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.bsRowDragHandleIcon :deep(svg path) {
  fill: currentColor;
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
.bsRowCheckMsg {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
.bsRowCheckMsg--ok {
  color: #2e7d32;
}
.bsRowCheckMsg--fail {
  color: #c62828;
}
.bsRowLoginPlaceholder {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
}
.bsRowMoreWrap {
  position: relative;
  flex-shrink: 0;
}
.bsRowDot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 0 0 1px var(--bg, #fff);
}
.bsRowDot--green {
  background: #43a047;
}
.bsRowDot--red {
  background: #e53935;
}
.bsFooter {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.bsCheckProgressBar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 10px 10px 8px 16px;
  margin: 0;
  border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.08));
}
.bsCheckProgressText {
  margin: 0;
  min-width: 0;
  flex: 1 1 auto;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bsCheckStopLink {
  flex-shrink: 0;
  color: var(--accent, #409eff);
  font-size: 12px;
}
.bsFooterRow {
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
  gap: 8px;
}
.bsFooterMoreWrap {
  position: relative;
  flex-shrink: 0;
}
</style>
