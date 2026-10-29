<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DefaultBookCover from "./DefaultBookCover.vue";
import AppCheckbox from "../../components/AppCheckbox.vue";
import IconButton from "../../components/IconButton.vue";
import type { BookshelfBook } from "../findBookBookshelf";
import { formatCoverAuthor } from "../bookSourceDisplay";
import {
  formatBookshelfLastRead,
  formatBookshelfLatestChapter,
  isBookshelfCaughtUpToLatest,
  isBookshelfLastReadChapterVip,
  isBookshelfLatestChapterVip,
} from "../findBookshelfDisplay";
import { SORTABLE_ROW_HANDLE_CLASS } from "../../composables/useSortableReorder";
import { icons } from "../../icons";
import RefreshIcon from "../../components/RefreshIcon.vue";
import {
  UNCATEGORIZED_LIST_BORDER_COLOR,
  type FileCategoryDefinition,
} from "../../constants/fileCategories";

const props = withDefaults(
  defineProps<{
    item: BookshelfBook;
    coverUrl?: string;
    /** 封面仍在代理解析中：显示占位，不显示默认封面 */
    coverPending?: boolean;
    forceDefaultCover?: boolean;
    /** 最后阅读展示（含异步解析的章节名） */
    lastReadText?: string;
    /** 书架分类目录（用于取色） */
    categoryCatalog?: FileCategoryDefinition[];
    /** 手动排序模式下显示拖动手柄 */
    showDragHandle?: boolean;
    /** 正在更新书籍信息 */
    updating?: boolean;
    /** 书架管理（编辑）模式 */
    managing?: boolean;
    /** 编辑模式下是否选中 */
    selected?: boolean;
    /** 该行「更多」菜单是否打开（保持按钮可见与激活态） */
    moreMenuOpen?: boolean;
  }>(),
  {
    coverPending: false,
    categoryCatalog: () => [],
    showDragHandle: false,
    updating: false,
    managing: false,
    selected: false,
    moreMenuOpen: false,
  },
);

const emit = defineEmits<{
  click: [item: BookshelfBook, event: MouseEvent];
  coverError: [item: BookshelfBook];
  more: [item: BookshelfBook, event: MouseEvent];
  remove: [item: BookshelfBook];
  searchSource: [item: BookshelfBook];
  selectCategory: [category: string];
  openBookInfo: [item: BookshelfBook];
  searchAuthor: [author: string];
}>();

const coverLoadFailed = ref(false);

const displayCoverUrl = computed(() => {
  if (props.coverUrl !== undefined) {
    const t = props.coverUrl.trim();
    return t || undefined;
  }
  return props.item.coverUrl?.trim() || undefined;
});

/** 仅最终失败才用默认封面；解析中用占位 */
const showDefaultCover = computed(
  () =>
    props.forceDefaultCover ||
    coverLoadFailed.value ||
    (!props.coverPending && !displayCoverUrl.value),
);

const showCoverPending = computed(
  () =>
    !showDefaultCover.value &&
    !displayCoverUrl.value &&
    props.coverPending,
);

const latestChapterText = computed(() => formatBookshelfLatestChapter(props.item));
const lastReadText = computed(
  () => props.lastReadText ?? formatBookshelfLastRead(props.item),
);
const caughtUpToLatest = computed(() =>
  isBookshelfCaughtUpToLatest(props.item, lastReadText.value),
);
const latestChapterVip = computed(() => isBookshelfLatestChapterVip(props.item));
const lastReadChapterVip = computed(() =>
  isBookshelfLastReadChapterVip(props.item),
);
const updateDisabled = computed(() => props.item.canUpdate === false);

const categoryName = computed(() => (props.item.category ?? "").trim());
const categoryColor = computed(() => {
  const n = categoryName.value;
  if (!n) return UNCATEGORIZED_LIST_BORDER_COLOR;
  const hit = props.categoryCatalog.find((c) => c.name === n);
  return hit?.color ?? UNCATEGORIZED_LIST_BORDER_COLOR;
});
const showOriginMeta = computed(
  () => Boolean(props.item.originName) || Boolean(categoryName.value),
);

const authorDisplay = computed(() => formatCoverAuthor(props.item.author));
const authorSearchable = computed(() => {
  const a = authorDisplay.value;
  return Boolean(a && a !== "未知");
});

watch(
  () => props.coverUrl,
  () => {
    coverLoadFailed.value = false;
  },
);

function onClick(e: MouseEvent) {
  emit("click", props.item, e);
}

function onCoverError() {
  coverLoadFailed.value = true;
  emit("coverError", props.item);
}

function onCoverLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  if (!img.naturalWidth || !img.naturalHeight) onCoverError();
}

function onMoreClick(e: MouseEvent) {
  emit("more", props.item, e);
}

function onRemoveClick(e: MouseEvent) {
  e.stopPropagation();
  emit("remove", props.item);
}

function onOpenBookInfoClick(e: MouseEvent) {
  if (props.managing) return;
  e.stopPropagation();
  emit("openBookInfo", props.item);
}

function onSearchAuthorClick(e: MouseEvent) {
  if (props.managing) return;
  e.stopPropagation();
  if (!authorSearchable.value) return;
  emit("searchAuthor", authorDisplay.value);
}

function onSearchSourceClick(e: MouseEvent) {
  if (props.managing) return;
  e.stopPropagation();
  emit("searchSource", props.item);
}

function onSelectCategoryClick(e: MouseEvent) {
  if (props.managing) return;
  e.stopPropagation();
  const name = categoryName.value;
  if (!name) return;
  emit("selectCategory", name);
}
</script>

<template>
  <li
    class="findBookListItem"
    :class="{
      'findBookListItem--selected': managing && selected,
      'findBookListItem--managing': managing,
    }"
    @click="onClick"
  >
    <span
      v-if="caughtUpToLatest"
      class="findBookshelfCaughtUpBadge"
      title="已读至最新章节"
      aria-label="已读至最新章节"
      v-html="icons.ok"
    />
    <AppCheckbox
      v-if="managing"
      class="findBookshelfSelectCheckbox"
      passive
      :model-value="selected"
      :aria-label="`选择 ${item.name}`"
    />
    <div class="findBookshelfCoverWrap">
      <DefaultBookCover
        v-if="showDefaultCover"
        class="findBookListItemCover"
        :title="item.name"
        :author="item.author"
      />
      <div
        v-else-if="showCoverPending"
        class="findBookListItemCover findBookListItemCover--pending"
        aria-hidden="true"
      />
      <img
        v-else
        class="findBookListItemCover"
        :src="displayCoverUrl"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        @error="onCoverError"
        @load="onCoverLoad"
      />
    </div>
    <div
      class="findBookListItemMain"
      :class="{ 'findBookListItemMain--managing': managing }"
    >
      <div class="findBookListItemBody">
        <div class="findBookListItemTitle">
          <button
            type="button"
            class="link findBookshelfTitleLink"
            :title="item.name"
            @click="onOpenBookInfoClick"
          >
            {{ item.name }}
          </button>
        </div>
        <div class="findBookListItemAuthor">
          <span
            class="findBookshelfMetaIcon"
            title="作者"
            aria-label="作者"
            v-html="icons.user"
          />
          <button
            type="button"
            class="link findBookshelfAuthorLink"
            :disabled="!authorSearchable"
            :title="authorSearchable ? `搜索：${authorDisplay}` : authorDisplay"
            @click="onSearchAuthorClick"
          >
            {{ authorDisplay }}
          </button>
        </div>
        <div class="findBookListItemLatest">
          <span
            class="findBookshelfMetaIcon"
            title="最新章节"
            aria-label="最新章节"
            v-html="icons.history"
          /><span
            v-if="latestChapterVip"
            class="findBookshelfChapterLock"
            v-html="icons.lock"
            aria-hidden="true"
          /><span :title="latestChapterText">{{ latestChapterText }}</span>
        </div>
        <div class="findBookListItemLatest">
          <span
            class="findBookshelfMetaIcon"
            title="最后阅读"
            aria-label="最后阅读"
            v-html="icons.read"
          /><span
            v-if="lastReadChapterVip"
            class="findBookshelfChapterLock"
            v-html="icons.lock"
            aria-hidden="true"
          /><span :title="lastReadText">{{ lastReadText }}</span>
        </div>
        <div v-if="showOriginMeta" class="findBookListItemOrigin">
          <span v-if="item.originName" class="findBookshelfOrigin">
            <span
              class="findBookshelfMetaIcon findBookshelfMetaIcon--origin"
              title="书源"
              aria-label="书源"
              v-html="icons.findBook"
            />
            <button
              type="button"
              class="link findBookshelfOriginLink"
              :disabled="!item.origin?.trim()"
              :title="`${item.originName}：搜索`"
              @click="onSearchSourceClick"
            >
              {{ item.originName }}
            </button>
          </span>
          <span
            v-if="categoryName"
            class="findBookshelfCategory"
            :style="{ color: categoryColor }"
          >
            <span
              class="findBookshelfMetaIcon findBookshelfMetaIcon--category"
              title="分类"
              aria-label="分类"
              aria-hidden="true"
              v-html="icons.folderOpen"
            />
            <button
              type="button"
              class="link findBookshelfCategoryLink"
              :title="`分类：${categoryName}`"
              :style="{ color: categoryColor }"
              @click="onSelectCategoryClick"
            >
              {{ categoryName }}
            </button>
          </span>
        </div>
      </div>
      <div v-if="!managing" class="findBookListItemActions">
        <button
          v-if="showDragHandle"
          type="button"
          class="findBookshelfDragHandle"
          :class="SORTABLE_ROW_HANDLE_CLASS"
          aria-label="拖动排序"
          title="拖动排序"
          @click.stop
        >
          <span
            class="findBookshelfDragHandleIcon"
            aria-hidden="true"
            v-html="icons.move"
          />
        </button>
        <button
          type="button"
          class="findBookshelfMoreBtn"
          :class="{ 'findBookshelfMoreBtn--active': moreMenuOpen }"
          aria-label="更多"
          title="更多"
          aria-haspopup="menu"
          :aria-expanded="moreMenuOpen"
          @click.stop="onMoreClick"
        >
          <span
            class="findBookshelfMoreBtnIcon"
            aria-hidden="true"
            v-html="icons.more"
          />
        </button>
      </div>
      <div v-if="managing && updateDisabled" class="findBookListItemMeta">
        <span class="findBookshelfStatusTag">已禁止更新</span>
      </div>
    </div>
    <IconButton
      v-if="managing"
      class="findBookshelfRemoveBtn"
      danger
      :icon-html="icons.remove"
      aria-label="移除"
      title="移除"
      @click="onRemoveClick"
    />
    <div
      v-else-if="updating || updateDisabled"
      class="findBookshelfStatus"
    >
      <RefreshIcon
        v-if="updating"
        class="findBookshelfStatusIcon"
        :size="16"
        spinning
      />
      <span v-else-if="updateDisabled" class="findBookshelfStatusTag">已禁止更新</span>
    </div>
  </li>
</template>

<style scoped>
.findBookListItem {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface-elevated);
  border: 1px solid var(--border);
  color: var(--fg);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}
.findBookListItem:hover {
  box-shadow: 0 2px 8px color-mix(in srgb, var(--fg) 12%, transparent);
}
.findBookListItem--selected {
  border-color: var(--accent);
}
.findBookListItem--selected:hover {
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 12%, transparent);
}
.findBookListItem--managing {
  cursor: default;
}
.findBookshelfSelectCheckbox {
  flex-shrink: 0;
  align-self: center;
  margin: 0;
  pointer-events: none;
}
.findBookListItemActions {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.findBookshelfDragHandle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  opacity: 0;
  pointer-events: none;
  cursor: grab;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.findBookListItem:hover .findBookshelfDragHandle,
.findBookListItem.sortableRowChosen .findBookshelfDragHandle {
  opacity: 1;
  pointer-events: auto;
}
.findBookshelfDragHandle:hover {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--fg);
}
.findBookshelfDragHandleIcon {
  display: flex;
  width: 16px;
  height: 16px;
}
.findBookshelfDragHandleIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.findBookshelfDragHandleIcon :deep(svg path) {
  fill: currentColor;
}
.findBookshelfCoverWrap {
  position: relative;
  flex-shrink: 0;
  width: 76px;
  height: 102px;
}
.findBookListItemCover {
  width: 76px;
  height: 102px;
  border-radius: 4px;
  flex-shrink: 0;
}
.findBookshelfCaughtUpBadge {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 3px 0 0 3px;
  border-radius: 7px 0 0 0;
  background: var(--success);
  clip-path: polygon(0 0, 100% 0, 0 100%);
  color: #fff;
  pointer-events: none;
  user-select: none;
}
.findBookshelfCaughtUpBadge :deep(svg) {
  width: 11px;
  height: 11px;
  display: block;
}
.findBookshelfCaughtUpBadge :deep(svg path) {
  fill: currentColor;
}
img.findBookListItemCover {
  object-fit: cover;
  background: var(--scrollbar-track);
}
.findBookListItemMain {
  flex: 1;
  min-width: 0;
}
.findBookListItemMain--managing {
  display: flex;
  align-items: stretch;
  gap: 10px;
}
.findBookListItemMain--managing * {
  pointer-events: none;
}
.findBookListItemBody {
  flex: 1;
  min-width: 0;
}
.findBookListItemMeta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  min-width: 0;
}
.findBookListItemTitle {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 15px;
  line-height: 1.35;
  color: var(--fg);
  margin-bottom: 4px;
}
.findBookshelfTitleLink {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  color: inherit;
  font-weight: inherit;
  font-size: inherit;
  line-height: inherit;
  text-align: left;
  white-space: normal;
}
.findBookshelfTitleLink:not(:disabled):hover {
  color: var(--accent);
}
.findBookListItemOrigin {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--book-source);
  min-width: 0;
}
.findBookshelfOrigin {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
}
.findBookshelfOriginLink {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--book-source);
  font-size: inherit;
  line-height: inherit;
}
.findBookshelfOriginLink:not(:disabled):hover {
  color: var(--book-source);
}
.findBookshelfCategory {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
}
.findBookshelfCategoryLink {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: inherit;
  line-height: inherit;
}
.findBookshelfCategoryLink:not(:disabled):hover {
  color: inherit;
}
.findBookshelfMoreBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.findBookListItem:hover .findBookshelfMoreBtn,
.findBookshelfMoreBtn--active {
  opacity: 1;
  pointer-events: auto;
}
.findBookshelfMoreBtn:hover,
.findBookshelfMoreBtn--active {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--fg);
}
.findBookshelfMoreBtnIcon {
  display: flex;
  width: 16px;
  height: 16px;
}
.findBookshelfMoreBtnIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.findBookshelfMoreBtnIcon :deep(svg path) {
  fill: currentColor;
}
.findBookshelfRemoveBtn {
  flex-shrink: 0;
  align-self: center;
}
.findBookshelfStatus {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 2;
  pointer-events: none;
}
.findBookshelfStatusIcon {
  color: var(--muted);
}
.findBookshelfStatusTag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 1.3;
  color: var(--muted);
  background: color-mix(in srgb, var(--fg) 6%, var(--surface-elevated));
  white-space: nowrap;
}
.findBookListItemAuthor {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  font-size: 13px;
  color: var(--fg);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.findBookshelfAuthorLink {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
}
.findBookshelfAuthorLink:not(:disabled):hover {
  color: var(--accent);
}
.findBookListItemLatest {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.findBookshelfMetaIcon {
  display: inline-flex;
  align-items: center;
  vertical-align: -0.15em;
  margin-right: 4px;
  color: var(--muted);
  flex-shrink: 0;
}
.findBookshelfMetaIcon--origin {
  margin-right: 0;
}
.findBookshelfMetaIcon--category {
  margin-right: 0;
}
.findBookshelfMetaIcon :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}
.findBookshelfMetaIcon :deep(svg > path) {
  fill: currentColor;
}
.findBookshelfChapterLock {
  display: inline-flex;
  align-items: center;
  vertical-align: -0.15em;
  margin-right: 4px;
  color: var(--warning);
}
.findBookshelfChapterLock :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}
.findBookshelfChapterLock :deep(svg path) {
  fill: currentColor;
}
.findBookListItemLatest:last-child {
  margin-bottom: 0;
}
</style>
