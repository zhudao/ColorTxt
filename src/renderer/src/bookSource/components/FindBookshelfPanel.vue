<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppCheckbox from "../../components/AppCheckbox.vue";
import IconButton from "../../components/IconButton.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import CategoryPickerMenu from "../../components/CategoryPickerMenu.vue";
import FileCategoryFlyoutList from "../../components/FileCategoryFlyoutList.vue";
import FindBookshelfListItem from "./FindBookshelfListItem.vue";
import { useFindBookBookshelf } from "../composables/useFindBookBookshelf";
import { useBookshelfCoverUrls } from "../composables/useBookshelfCoverUrls";
import { useBookshelfLastReadTitles } from "../composables/useBookshelfLastReadTitles";
import { useBookshelfUpdate } from "../composables/useBookshelfUpdate";
import { useSortableReorder } from "../../composables/useSortableReorder";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import { useListSelectionHotkeys } from "../../composables/useListSelectionHotkeys";
import { appConfirm } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import { icons } from "../../icons";
import type { SearchBookItem } from "@shared/bookSource/types";
import {
  bookshelfBookKey,
  type BookshelfBook,
} from "../findBookBookshelf";
import {
  isBookshelfManualSort,
  reorderBookshelfManual,
  sortBookshelfBooks,
  type BookshelfSortMode,
} from "../findBookshelfSort";
import {
  FILE_CATEGORY_FILTER_ALL,
  FILE_CATEGORY_FILTER_UNCATEGORIZED,
  type FileCategoryDefinition,
} from "../../constants/fileCategories";
import "./findBookListShared.css";

const props = defineProps<{
  active: boolean;
  filter?: string;
  categoryFilter?: string;
  categoryCatalog?: FileCategoryDefinition[];
  sortMode: BookshelfSortMode;
}>();

const emit = defineEmits<{
  readBook: [item: SearchBookItem];
  openBookInfo: [item: SearchBookItem];
  /** 限定该书源搜索 */
  searchSource: [item: { bookSourceUrl: string; bookSourceName: string }];
  selectCategory: [category: string];
  /** 切换到找书并搜索作者 */
  searchAuthor: [author: string];
  /** 切换到找书并精准搜索书名 */
  searchBookName: [name: string];
  managingChange: [managing: boolean];
}>();

const {
  books,
  refresh,
  setOrder,
  remove,
  setCanUpdate,
  setCategory,
  setCategories,
  applyBooks,
} = useFindBookBookshelf();
const { getCoverUrl, isCoverPending, retryCover } = useBookshelfCoverUrls(books);
const { getLastReadText } = useBookshelfLastReadTitles(
  books,
  () => props.active,
  refresh,
);
const { isAnyUpdating, isUpdating, updateBook, updateBooks } = useBookshelfUpdate(
  applyBooks,
);

const managing = ref(false);
const selected = ref(new Set<string>());
/** Shift 连选锚点（与侧栏文件列表 lastSelected 一致） */
const lastSelectedKey = ref<string | null>(null);
const coverFailedIds = ref<Record<string, true>>({});
const bookshelfListRef = ref<HTMLElement | null>(null);
const bookshelfBodyRef = ref<HTMLElement | null>(null);
const rowMenuAnchor = ref<HTMLElement | null>(null);
const rowMenuItem = ref<BookshelfBook | null>(null);
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

const footerMoreBtnRef = ref<HTMLElement | null>(null);
const footerMoreMenu = useAnchoredAppShellMenu({
  anchor: footerMoreBtnRef,
  placement: "above-end",
  widthPx: 140,
});
const {
  open: footerMoreOpen,
  left: footerMoreLeft,
  top: footerMoreTop,
  toggleMenu: toggleFooterMoreMenu,
  closeMenu: closeFooterMoreMenu,
  panelRef: footerMorePanelRef,
} = footerMoreMenu;

const footerCategoryBtnRef = ref<HTMLElement | null>(null);
const categoryPickerOpen = ref(false);
const categoryPickX = ref(0);
const categoryPickY = ref(0);

function bindRowMenuPanel(el: HTMLElement | null) {
  rowMenuPanelRef.value = el;
}

function bindFooterMorePanel(el: HTMLElement | null) {
  footerMorePanelRef.value = el;
}

function bookKey(book: BookshelfBook): string {
  return bookshelfBookKey(book.bookUrl, book.origin);
}

const categoryCatalog = computed(() => props.categoryCatalog ?? []);

const categoryMenuCounts = computed(() => {
  const files = books.value;
  let uncategorized = 0;
  const byName: Record<string, number> = {};
  for (const c of categoryCatalog.value) {
    byName[c.name] = 0;
  }
  for (const f of files) {
    const n = (f.category ?? "").trim();
    if (!n) {
      uncategorized++;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(byName, n)) {
      byName[n] = (byName[n] ?? 0) + 1;
    }
  }
  return { uncategorized, byName };
});

const filteredBooks = computed(() => {
  const q = props.filter?.trim().toLowerCase() ?? "";
  const cat = props.categoryFilter ?? FILE_CATEGORY_FILTER_ALL;
  return books.value.filter((item) => {
    if (cat === FILE_CATEGORY_FILTER_UNCATEGORIZED) {
      if ((item.category ?? "").trim()) return false;
    } else if (cat !== FILE_CATEGORY_FILTER_ALL) {
      if ((item.category ?? "").trim() !== cat) return false;
    }
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.author.toLowerCase().includes(q)
    );
  });
});

const displayBooks = computed(() =>
  sortBookshelfBooks(filteredBooks.value, props.sortMode),
);

const canDragReorder = computed(
  () =>
    props.active &&
    !managing.value &&
    !props.filter?.trim() &&
    (props.categoryFilter ?? FILE_CATEGORY_FILTER_ALL) ===
      FILE_CATEGORY_FILTER_ALL &&
    isBookshelfManualSort(props.sortMode) &&
    displayBooks.value.length > 1,
);

const rowMenuCanUpdate = computed(() => rowMenuItem.value?.canUpdate !== false);

const rowMenuCategorySubOpen = ref(false);
const rowMenuCategoryFlyoutRef = ref<HTMLElement | null>(null);
const rowMenuFlyoutUseLeft = ref(false);
const rowMenuFlyoutTransform = ref("");
const rowMenuFlyoutPositionReady = ref(false);

const rowMenuFlyoutPanelStyle = computed(() => {
  const s: Record<string, string> = {};
  if (rowMenuFlyoutTransform.value) {
    s.transform = rowMenuFlyoutTransform.value;
  }
  if (rowMenuCategorySubOpen.value) {
    s.visibility = rowMenuFlyoutPositionReady.value ? "visible" : "hidden";
    s.pointerEvents = rowMenuFlyoutPositionReady.value ? "auto" : "none";
  }
  return s;
});

function closeRowMenuCategorySub() {
  rowMenuCategorySubOpen.value = false;
  rowMenuFlyoutUseLeft.value = false;
  rowMenuFlyoutTransform.value = "";
  rowMenuFlyoutPositionReady.value = false;
}

function applyRowMenuCategoryFlyoutTranslateClamp() {
  const flyout = rowMenuCategoryFlyoutRef.value;
  if (!flyout || !rowMenuCategorySubOpen.value) return;
  const margin = 8;
  const r = flyout.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (r.bottom > window.innerHeight - margin) {
    dy = window.innerHeight - margin - r.bottom;
  }
  if (r.top + dy < margin) {
    dy = margin - r.top;
  }
  if (r.right + dx > window.innerWidth - margin) {
    dx = window.innerWidth - margin - r.right;
  }
  if (r.left + dx < margin) {
    dx = margin - r.left;
  }
  rowMenuFlyoutTransform.value =
    dx !== 0 || dy !== 0 ? `translate(${dx}px, ${dy}px)` : "";
}

async function layoutRowMenuCategoryFlyout() {
  if (!rowMenuOpen.value || !rowMenuCategorySubOpen.value) {
    closeRowMenuCategorySub();
    return;
  }
  rowMenuFlyoutPositionReady.value = false;
  rowMenuFlyoutUseLeft.value = false;
  rowMenuFlyoutTransform.value = "";
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const flyout = rowMenuCategoryFlyoutRef.value;
  if (!flyout || !rowMenuCategorySubOpen.value) {
    rowMenuFlyoutPositionReady.value = true;
    return;
  }
  const margin = 8;
  const r = flyout.getBoundingClientRect();
  if (r.right > window.innerWidth - margin) {
    rowMenuFlyoutUseLeft.value = true;
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  applyRowMenuCategoryFlyoutTranslateClamp();
  rowMenuFlyoutPositionReady.value = true;
}

watch(rowMenuOpen, (open) => {
  if (!open) closeRowMenuCategorySub();
});

const selectedCount = computed(() => {
  let n = 0;
  for (const book of displayBooks.value) {
    if (selected.value.has(bookKey(book))) n += 1;
  }
  return n;
});
const allDisplaySelected = computed(
  () =>
    displayBooks.value.length > 0 &&
    displayBooks.value.every((b) => selected.value.has(bookKey(b))),
);
const selectAllLabel = computed(() =>
  allDisplaySelected.value ? "取消全选" : "全选",
);
const selectAllIndeterminate = computed(
  () => selectedCount.value > 0 && !allDisplaySelected.value,
);

useSortableReorder({
  containerRef: bookshelfListRef,
  draggable: "li",
  active: computed(() => props.active),
  enabled: canDragReorder,
  itemCount: computed(() => displayBooks.value.length),
  onReorder(from, to) {
    if (!isBookshelfManualSort(props.sortMode)) return;
    setOrder(reorderBookshelfManual(books.value, from, to));
  },
});

const showEmptyShelf = computed(
  () =>
    !books.value.length &&
    !props.filter?.trim() &&
    (props.categoryFilter ?? FILE_CATEGORY_FILTER_ALL) ===
      FILE_CATEGORY_FILTER_ALL,
);

const showNoFilterMatch = computed(
  () =>
    books.value.length > 0 &&
    filteredBooks.value.length === 0 &&
    (!!props.filter?.trim() ||
      (props.categoryFilter ?? FILE_CATEGORY_FILTER_ALL) !==
        FILE_CATEGORY_FILTER_ALL),
);

watch(books, (next) => {
  if (managing.value && next.length === 0) {
    exitManage();
    return;
  }
  if (selected.value.size === 0) return;
  const valid = new Set(next.map(bookKey));
  const pruned = new Set<string>();
  for (const key of selected.value) {
    if (valid.has(key)) pruned.add(key);
  }
  selected.value = pruned;
  if (lastSelectedKey.value && !pruned.has(lastSelectedKey.value)) {
    lastSelectedKey.value =
      pruned.size > 0 ? [...pruned][pruned.size - 1]! : null;
  }
});


watch(
  () => props.active,
  (active) => {
    if (!active) exitManage();
  },
);

function clearSelection() {
  selected.value = new Set();
  lastSelectedKey.value = null;
}

function enterManage() {
  managing.value = true;
  clearSelection();
  closeRowMenu();
  emit("managingChange", true);
}

function exitManage() {
  managing.value = false;
  clearSelection();
  closeRowMenu();
  closeFooterMoreMenu();
  emit("managingChange", false);
}

function isSelected(book: BookshelfBook): boolean {
  return selected.value.has(bookKey(book));
}

function selectAllVisible() {
  const keys = displayBooks.value.map(bookKey);
  selected.value = new Set(keys);
  lastSelectedKey.value = keys.length > 0 ? keys[keys.length - 1]! : null;
}

function invertSelect() {
  const visibleKeys = displayBooks.value.map(bookKey);
  const visible = new Set(visibleKeys);
  const next = new Set<string>();
  for (const key of selected.value) {
    if (!visible.has(key)) next.add(key);
  }
  for (const key of visibleKeys) {
    if (!selected.value.has(key)) next.add(key);
  }
  selected.value = next;
  lastSelectedKey.value =
    next.size > 0 ? [...next][next.size - 1]! : null;
}

const { onListKeydown: onBookshelfBodyKeydown, focusList } =
  useListSelectionHotkeys({
    listEl: bookshelfBodyRef,
    enabled: () => managing.value && props.active,
    onSelectAll: selectAllVisible,
    onInvert: invertSelect,
  });

watch(managing, (on) => {
  if (on) focusList();
});

function onToggleSelectAll() {
  if (allDisplaySelected.value) clearSelection();
  else selectAllVisible();
}

function selectedBooksInDisplayOrder(): BookshelfBook[] {
  return displayBooks.value.filter((b) => selected.value.has(bookKey(b)));
}

async function onCoverError(item: BookshelfBook) {
  const ok = await retryCover(item);
  if (!ok) {
    coverFailedIds.value = { ...coverFailedIds.value, [item.id]: true };
  } else {
    const { [item.id]: _, ...rest } = coverFailedIds.value;
    coverFailedIds.value = rest;
  }
}

/** 与侧栏文件列表 / 资源管理器一致：单击单选、Ctrl 多选、Shift 连选 */
function onItemClick(item: BookshelfBook, listIndex: number, ev: MouseEvent) {
  if (!managing.value) {
    emit("readBook", item);
    return;
  }
  const key = bookKey(item);
  const list = displayBooks.value;
  const toggleMod = ev.ctrlKey || ev.metaKey;
  const rangeMod = ev.shiftKey;

  if (rangeMod) {
    const anchor = lastSelectedKey.value;
    if (!anchor) {
      lastSelectedKey.value = key;
      selected.value = new Set([key]);
      focusList();
      return;
    }
    const anchorIdx = list.findIndex((b) => bookKey(b) === anchor);
    const clickedIdx = listIndex;
    if (anchorIdx < 0 || clickedIdx < 0) {
      lastSelectedKey.value = key;
      selected.value = new Set([key]);
      focusList();
      return;
    }
    const start = Math.min(anchorIdx, clickedIdx);
    const end = Math.max(anchorIdx, clickedIdx);
    selected.value = new Set(
      list.slice(start, end + 1).map((b) => bookKey(b)),
    );
    focusList();
    return;
  }

  if (toggleMod) {
    const next = new Set(selected.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected.value = next;
    lastSelectedKey.value = key;
    focusList();
    return;
  }

  selected.value = new Set([key]);
  lastSelectedKey.value = key;
  focusList();
}

function onRowMoreClick(item: BookshelfBook, e: MouseEvent) {
  rowMenuItem.value = item;
  rowMenuAnchor.value = e.currentTarget as HTMLElement;
  void openRowMenu();
}

async function onRowMenuUpdate() {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  if (item.canUpdate === false) {
    appToast("该书已禁止更新", { kind: "warning" });
    return;
  }
  const ok = await updateBook(item);
  appToast(ok ? "更新完成" : "更新失败", { kind: ok ? "success" : "warning" });
}

function onOpenBookInfoFromItem(item: BookshelfBook) {
  emit("openBookInfo", item);
}

function onSearchAuthorFromItem(author: string) {
  emit("searchAuthor", author);
}

function onRowMenuSearchBookName() {
  const item = rowMenuItem.value;
  closeRowMenu();
  const name = item?.name?.trim();
  if (!name) {
    appToast("书名为空", { kind: "warning" });
    return;
  }
  emit("searchBookName", name);
}

function searchSourceForBook(item: BookshelfBook) {
  const url = item.origin?.trim();
  if (!url) {
    appToast("该书没有关联书源", { kind: "warning" });
    return;
  }
  emit("searchSource", {
    bookSourceUrl: url,
    bookSourceName: item.originName?.trim() || url,
  });
}

function onRowMenuCategoryPicked(name: string) {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  setCategory(item.bookUrl, item.origin, name);
}

function onRowMenuToggleCanUpdate() {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  const next = item.canUpdate === false;
  setCanUpdate(item.bookUrl, item.origin, next);
}

async function removeBook(item: BookshelfBook, skipConfirm = false) {
  if (!skipConfirm) {
    const ok = await appConfirm(`确定从书架移除「${item.name}」？`);
    if (!ok) return false;
  }
  remove(item.bookUrl, item.origin);
  const key = bookKey(item);
  if (selected.value.has(key)) {
    const next = new Set(selected.value);
    next.delete(key);
    selected.value = next;
  }
  return true;
}

async function onRowMenuRemove() {
  const item = rowMenuItem.value;
  closeRowMenu();
  if (!item) return;
  const ok = await removeBook(item);
  if (ok) appToast("已从书架移除", { kind: "success", duration: 1200 });
}

async function onRowRemove(item: BookshelfBook) {
  const ok = await removeBook(item);
  if (ok) appToast("已从书架移除", { kind: "success", duration: 1200 });
}

async function onBatchDelete() {
  const list = selectedBooksInDisplayOrder();
  if (!list.length) return;
  const ok = await appConfirm(`是否移除选中的 ${list.length} 本书？`);
  if (!ok) return;
  for (const book of list) {
    remove(book.bookUrl, book.origin);
  }
  clearSelection();
  appToast(`已移除 ${list.length} 本书`, { kind: "success", duration: 1200 });
}

function onFooterCategoryClick(ev: MouseEvent) {
  ev.preventDefault();
  if (!selectedCount.value) return;
  const btn = footerCategoryBtnRef.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  categoryPickX.value = r.left;
  categoryPickY.value = r.top;
  categoryPickerOpen.value = true;
}

function onCategoryPicked(name: string) {
  const list = selectedBooksInDisplayOrder();
  if (!list.length) return;
  setCategories(
    list.map((b) => ({ bookUrl: b.bookUrl, origin: b.origin })),
    name,
  );
  categoryPickerOpen.value = false;
}

function onSelectCategoryFromItem(category: string) {
  emit("selectCategory", category);
}

function onBatchSetCanUpdate(canUpdate: boolean) {
  closeFooterMoreMenu();
  const list = selectedBooksInDisplayOrder();
  if (!list.length) return;
  for (const book of list) {
    setCanUpdate(book.bookUrl, book.origin, canUpdate);
  }
  appToast(canUpdate ? "已允许更新" : "已禁止更新", {
    kind: "success",
    duration: 1200,
  });
}

async function updateAll() {
  if (!books.value.length || isAnyUpdating.value) return;
  await updateBooks(books.value);
  appToast("书架更新完成", { kind: "success" });
}

defineExpose({ refresh, updateAll, enterManage, exitManage });
</script>

<template>
  <div class="findBookshelfPanel">
    <div
      ref="bookshelfBodyRef"
      class="findBookshelfBody"
      :tabindex="managing ? 0 : -1"
      @keydown="onBookshelfBodyKeydown"
    >
      <div v-if="showEmptyShelf" class="findBookEmpty">
        <p class="findBookEmptyIcon">(•◡•)و</p>
        <p class="findBookEmptyText">书架还空着，先去搜索书籍或从发现里添加吧</p>
      </div>
      <div v-else-if="showNoFilterMatch" class="findBookEmpty">
        <p class="findBookEmptyText">无匹配的书籍</p>
      </div>
      <ul v-else ref="bookshelfListRef" class="findBookResultsList">
        <FindBookshelfListItem
          v-for="(item, index) in displayBooks"
          :key="item.id"
          :item="item"
          :cover-url="getCoverUrl(item) ?? ''"
          :cover-pending="isCoverPending(item)"
          :force-default-cover="!!coverFailedIds[item.id]"
          :last-read-text="getLastReadText(item)"
          :category-catalog="categoryCatalog"
          :show-drag-handle="canDragReorder"
          :updating="isUpdating(item)"
          :managing="managing"
          :selected="isSelected(item)"
          :more-menu-open="
            rowMenuOpen && rowMenuItem?.id === item.id
          "
          @click="(book, ev) => onItemClick(book, index, ev)"
          @cover-error="onCoverError"
          @more="onRowMoreClick"
          @remove="onRowRemove"
          @search-source="searchSourceForBook"
          @select-category="onSelectCategoryFromItem"
          @open-book-info="onOpenBookInfoFromItem"
          @search-author="onSearchAuthorFromItem"
        />
      </ul>
    </div>

    <footer v-if="managing" class="findBookshelfFooter">
      <AppCheckbox
        class="findBookshelfFooterSelectAll"
        :model-value="allDisplaySelected"
        :indeterminate="selectAllIndeterminate"
        :aria-label="selectAllLabel"
        @update:model-value="onToggleSelectAll"
      >
        <template #label>
          {{ selectAllLabel }}（{{ selectedCount }}/{{ displayBooks.length }}）
        </template>
      </AppCheckbox>
      <div class="findBookshelfFooterActions">
        <button type="button" class="btn findBookshelfFooterBtn" size="large" @click="invertSelect">
          反选
        </button>
        <button
          ref="footerCategoryBtnRef"
          type="button"
          class="btn findBookshelfFooterBtn"
          size="large"
          :disabled="!selectedCount"
          @click="onFooterCategoryClick"
        >
          分类
        </button>
        <button
          type="button"
          class="btn danger findBookshelfFooterBtn"
          size="large"
          :disabled="!selectedCount"
          @click="onBatchDelete"
        >
          移除
        </button>
        <div ref="footerMoreBtnRef" class="findBookshelfFooterMoreWrap">
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
              role="menuitem"
              :disabled="!selectedCount"
              @click="onBatchSetCanUpdate(true)"
            >
              允许更新
            </button>
            <button
              type="button"
              class="appShellMenuItem"
              role="menuitem"
              :disabled="!selectedCount"
              @click="onBatchSetCanUpdate(false)"
            >
              禁止更新
            </button>
          </AppShellMenuTeleport>
        </div>
        <button
          type="button"
          class="btn warning findBookshelfFooterBtn"
          size="large"
          @click="exitManage"
        >
          退出
        </button>
      </div>
    </footer>

    <CategoryPickerMenu
      :open="categoryPickerOpen"
      :x="categoryPickX"
      :y="categoryPickY"
      align-above
      :catalog="categoryCatalog"
      :menu-counts="categoryMenuCounts"
      :min-width="140"
      @close="categoryPickerOpen = false"
      @pick="onCategoryPicked"
    />

    <AppShellMenuTeleport
      v-model:open="rowMenuOpen"
      :left="rowMenuLeft"
      :top="rowMenuTop"
      caret="end"
      panel-class="findBookshelfRowMenu"
      :on-panel-mount="bindRowMenuPanel"
    >
      <button
        :disabled="!rowMenuCanUpdate"
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onRowMenuUpdate"
      >
        更新目录
      </button>
      <div
        class="appShellMenuSubWrap"
        @mouseenter="
          rowMenuCategorySubOpen = true;
          void layoutRowMenuCategoryFlyout();
        "
        @mouseleave="closeRowMenuCategorySub"
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          aria-haspopup="menu"
          :aria-expanded="rowMenuCategorySubOpen"
        >
          <span class="appShellMenuLabel">分类</span>
          <span class="appShellMenuSubChevron">›</span>
        </button>
        <div
          v-show="rowMenuCategorySubOpen"
          ref="rowMenuCategoryFlyoutRef"
          class="appShellMenuFlyout findBookshelfRowCategoryFlyout"
          :class="
            rowMenuFlyoutUseLeft
              ? 'appShellMenuFlyout--left'
              : 'appShellMenuFlyout--right'
          "
          :style="rowMenuFlyoutPanelStyle"
          role="menu"
          @click.stop
        >
          <FileCategoryFlyoutList
            :catalog="categoryCatalog"
            :menu-counts="categoryMenuCounts"
            @pick="onRowMenuCategoryPicked"
          />
        </div>
      </div>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onRowMenuSearchBookName"
      >
        搜索书名
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onRowMenuToggleCanUpdate"
      >
        {{ rowMenuCanUpdate ? "禁止更新" : "允许更新" }}
      </button>
      <button
        type="button"
        class="appShellMenuItem appShellMenuItem--danger"
        role="menuitem"
        @click="onRowMenuRemove"
      >
        从书架移除
      </button>
    </AppShellMenuTeleport>
  </div>
</template>

<style scoped>
.findBookshelfPanel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.findBookshelfBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--bg);
  outline: none;
}
.findBookshelfFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding: 10px 10px 10px 23px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.findBookshelfFooterSelectAll {
  font-size: 14px;
  color: var(--fg, #333);
  flex-shrink: 0;
}
.findBookshelfFooterSelectAll :deep(.appCheckbox__label) {
  font-size: 14px;
  color: var(--fg, #333);
}
.findBookshelfFooterActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.findBookshelfFooterMoreWrap {
  position: relative;
  flex-shrink: 0;
}
.findBookshelfFooterBtn {
  justify-content: center;
  line-height: 1;
}
.findBookshelfRowCategoryFlyout {
  min-width: 140px;
}
:deep(li.sortableRowGhost) {
  opacity: 0.45;
}
:deep(li.sortableRowChosen) {
  box-shadow: 0 2px 12px color-mix(in srgb, var(--accent) 24%, transparent);
}
:deep(.sortableRowHandle) {
  cursor: grab;
}
:deep(.sortableRowHandle:active) {
  cursor: grabbing;
}
</style>

<style>
/* Teleport 到 body：需可见溢出以展示分类子菜单 */
.findBookshelfRowMenu.appShellMenuTeleport {
  overflow: visible;
}
</style>
