<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from "vue";
import type { Chapter } from "../chapter";
import { icons } from "../icons";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";
import { appToast } from "../services/appToast";
import VirtualList from "./VirtualList.vue";
import AppShellMenuTeleport from "./AppShellMenuTeleport.vue";
import { READER_SIDEBAR_ROW_STRIDE } from "../composables/useReaderSidebarLists";
import {
  CHAPTER_LIST_INDENT_PX,
  ancestorParentKeysForChapter,
  chapterHeadingLevel,
  chapterListHasNesting,
  chapterListItemKey,
  collectChapterParentKeys,
  filterVisibleChapters,
} from "../reader/chapterListTree";

const CHAPTERS_HEADER_MORE_MENU_W = 120;

export type ChapterListPanelExpose = {
  openMoreMenu: () => void;
  moreOpen: boolean;
  hasNestedChapters: boolean;
  allParentsCollapsed: boolean;
  toggleExpandAll: () => void;
  displayedIndexOfActive: () => number;
};

const props = withDefaults(
  defineProps<{
    currentFilePath: string | null;
    chaptersVisible: Chapter[];
    isChapterActive: (ch: Chapter) => boolean;
    showChapterCounts: boolean;
    formatCharCount: (n: number) => string;
    /** 侧栏标题行「更多」按钮（锚定菜单） */
    menuAnchorEl?: HTMLButtonElement | null;
  }>(),
  {
    menuAnchorEl: null,
  },
);

const emit = defineEmits<{
  jumpToChapter: [chapter: Chapter];
  closeCurrentFile: [];
  bindListRef: [value: InstanceType<typeof VirtualList> | null];
}>();

const moreBtnRef = ref<HTMLButtonElement | null>(null);
const moreAnchorRef = ref<HTMLButtonElement | null>(null);
watch(
  () => props.menuAnchorEl ?? moreBtnRef.value,
  (el) => {
    moreAnchorRef.value = el;
  },
  { immediate: true },
);
const moreMenu = useAnchoredAppShellMenu({
  anchor: moreAnchorRef,
  placement: "below-end",
  widthPx: CHAPTERS_HEADER_MORE_MENU_W,
  gap: 6,
});
const {
  open: moreOpen,
  left: moreLeft,
  top: moreTop,
  panelRef: morePanelRef,
  toggleMenu: toggleMoreMenu,
  closeMenu: closeMoreMenu,
} = moreMenu;

function bindMorePanel(el: HTMLElement | null) {
  morePanelRef.value = el;
}

/** 已折叠的父级键；空集合 = 全部展开 */
const collapsedKeys = ref<Set<string>>(new Set());

const hasNestedChapters = computed(() =>
  chapterListHasNesting(props.chaptersVisible),
);

const parentKeys = computed(() =>
  collectChapterParentKeys(props.chaptersVisible),
);

const parentKeySet = computed(() => new Set(parentKeys.value));

const allParentsCollapsed = computed(() => {
  const keys = parentKeys.value;
  if (keys.length === 0) return true;
  const collapsed = collapsedKeys.value;
  return keys.every((k) => collapsed.has(k));
});

const displayedChapters = computed(() =>
  filterVisibleChapters(props.chaptersVisible, collapsedKeys.value),
);

function pruneCollapsedKeys() {
  const valid = parentKeySet.value;
  const cur = collapsedKeys.value;
  let changed = false;
  const next = new Set<string>();
  for (const k of cur) {
    if (valid.has(k)) next.add(k);
    else changed = true;
  }
  if (changed) collapsedKeys.value = next;
}

function ensureActiveAncestorsExpanded(): void {
  const active = props.chaptersVisible.find((ch) => props.isChapterActive(ch));
  if (!active) return;
  const keys = ancestorParentKeysForChapter(props.chaptersVisible, active);
  if (keys.length === 0) return;
  let changed = false;
  const next = new Set(collapsedKeys.value);
  for (const k of keys) {
    if (next.delete(k)) changed = true;
  }
  if (changed) collapsedKeys.value = next;
}

watch(
  () => props.currentFilePath,
  () => {
    collapsedKeys.value = new Set();
  },
);

watch(
  () => props.chaptersVisible,
  () => {
    pruneCollapsedKeys();
  },
);

watch(
  () => {
    const list = props.chaptersVisible;
    const active = list.find((ch) => props.isChapterActive(ch));
    return active ? chapterListItemKey(active) : "";
  },
  () => {
    ensureActiveAncestorsExpanded();
  },
  { flush: "sync" },
);

function toggleExpandAll() {
  if (allParentsCollapsed.value) {
    collapsedKeys.value = new Set();
  } else {
    collapsedKeys.value = new Set(parentKeys.value);
  }
}

function toggleParentCollapsed(ch: Chapter) {
  const key = chapterListItemKey(ch);
  const next = new Set(collapsedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsedKeys.value = next;
}

function chapterRowHasChildren(ch: Chapter): boolean {
  return parentKeySet.value.has(chapterListItemKey(ch));
}

function chapterRowCollapsed(ch: Chapter): boolean {
  return collapsedKeys.value.has(chapterListItemKey(ch));
}

function displayedIndexOfActive(): number {
  ensureActiveAncestorsExpanded();
  return displayedChapters.value.findIndex((ch) => props.isChapterActive(ch));
}

const canLocateCurrentChapter = computed(() =>
  props.chaptersVisible.some((ch) => props.isChapterActive(ch)),
);

const listRef = ref<InstanceType<typeof VirtualList> | null>(null);

async function onLocateCurrentChapter() {
  if (!canLocateCurrentChapter.value) return;
  const idx = displayedIndexOfActive();
  if (idx < 0) return;
  await nextTick();
  requestAnimationFrame(() => {
    listRef.value?.scrollToIndex(idx, {
      align: "center",
      behavior: "smooth",
    });
  });
}

function chapterItemKey(index: number): string {
  const ch = displayedChapters.value[index];
  return ch ? chapterListItemKey(ch) : `i:${index}`;
}

function headingPaddingStyle(ch: Chapter): { paddingLeft: string } | undefined {
  const level = chapterHeadingLevel(ch);
  if (level <= 1) return undefined;
  return { paddingLeft: `${(level - 1) * CHAPTER_LIST_INDENT_PX}px` };
}

defineExpose({
  openMoreMenu: toggleMoreMenu,
  moreOpen,
  hasNestedChapters,
  allParentsCollapsed,
  toggleExpandAll,
  displayedIndexOfActive,
});

const copyTocDisabled = computed(
  () => !props.currentFilePath || props.chaptersVisible.length === 0,
);

/** 与侧栏层级一致：`(headingLevel - 1)` 级各缩进 2 空格，一行一标题 */
function formatChaptersTocText(chapters: Chapter[]): string {
  return chapters
    .map((ch) => {
      const level = chapterHeadingLevel(ch);
      const indent = "  ".repeat(level - 1);
      return `${indent}${ch.title}`;
    })
    .join("\n");
}

async function onCopyToc() {
  closeMoreMenu();
  if (copyTocDisabled.value) {
    appToast(
      props.currentFilePath ? "未识别到章节" : "未打开文件",
      { kind: "info" },
    );
    return;
  }
  const text = formatChaptersTocText(props.chaptersVisible);
  try {
    await navigator.clipboard.writeText(text);
    appToast("已复制目录", { kind: "success", duration: 1200 });
  } catch {
    appToast("复制目录失败", { kind: "warning" });
  }
}

function onBindListRef(value: Element | ComponentPublicInstance | null) {
  if (value && typeof value === "object" && "$el" in value) {
    listRef.value = value as InstanceType<typeof VirtualList>;
    emit("bindListRef", value as InstanceType<typeof VirtualList>);
    return;
  }
  listRef.value = null;
  emit("bindListRef", null);
}
</script>

<template>
  <div class="sidebarListWrap">
    <div class="sidebarTabBody">
      <div v-if="chaptersVisible.length === 0" class="empty">
        {{ currentFilePath ? "未识别到章节" : "未打开文件" }}
      </div>
      <div v-else class="sidebarListViewportPad">
        <VirtualList
          :ref="onBindListRef"
          class="sidebarList sidebarList--itemGap"
          :item-count="displayedChapters.length"
          :row-stride="READER_SIDEBAR_ROW_STRIDE"
          :overscan="10"
          :item-key="chapterItemKey"
          arrow-nav
        >
          <template #default="{ index }">
            <button
              type="button"
              tabindex="-1"
              class="sidebarItem"
              :class="{
                active: isChapterActive(displayedChapters[index]),
                'sidebarItem--tree': hasNestedChapters,
              }"
              :title="displayedChapters[index].title"
              :aria-expanded="
                chapterRowHasChildren(displayedChapters[index])
                  ? !chapterRowCollapsed(displayedChapters[index])
                  : undefined
              "
              @click="emit('jumpToChapter', displayedChapters[index])"
            >
              <span
                class="chapterItemMain"
                :style="
                  hasNestedChapters
                    ? headingPaddingStyle(displayedChapters[index])
                    : undefined
                "
              >
                <span
                  v-if="
                    hasNestedChapters &&
                    chapterRowHasChildren(displayedChapters[index])
                  "
                  class="chapterTreeChevron"
                  :class="{
                    'chapterTreeChevron--expanded': !chapterRowCollapsed(
                      displayedChapters[index],
                    ),
                  }"
                  aria-hidden="true"
                  @click.stop="
                    toggleParentCollapsed(displayedChapters[index])
                  "
                  v-html="icons.foldChevron"
                />
                <span
                  v-else-if="hasNestedChapters"
                  class="chapterTreeChevronSpacer"
                  aria-hidden="true"
                />
                <span
                  class="itemName"
                  :style="
                    hasNestedChapters
                      ? undefined
                      : headingPaddingStyle(displayedChapters[index])
                  "
                  >{{ displayedChapters[index].title }}</span
                >
              </span>
              <span v-if="showChapterCounts" class="itemMeta">{{
                formatCharCount(displayedChapters[index].charCount)
              }}</span>
            </button>
          </template>
        </VirtualList>
      </div>
    </div>
    <div v-if="currentFilePath" class="sidebarTabFooter">
      <div class="sidebarTabFooterStart">
        <span class="sidebarTabFooterStat"
          >共 {{ chaptersVisible.length }} 章</span
        >
        <button
          type="button"
          class="aiActivityLikeBtn"
          :disabled="!canLocateCurrentChapter"
          title="定位到当前章节"
          aria-label="定位到当前章节"
          @click="onLocateCurrentChapter"
        >
          <span class="svg" v-html="icons.location" />
        </button>
      </div>
      <button
        type="button"
        class="link danger hoverMode sidebarTabFooterAction"
        @click="emit('closeCurrentFile')"
      >
        关闭文件
      </button>
    </div>
    <AppShellMenuTeleport
      v-model:open="moreOpen"
      :left="moreLeft"
      :top="moreTop"
      :width="CHAPTERS_HEADER_MORE_MENU_W"
      caret="end"
      :on-panel-mount="bindMorePanel"
      aria-label="章节更多"
    >
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="copyTocDisabled"
        @click="onCopyToc"
      >
        <span class="appShellMenuIconSlot" v-html="icons.copy" />
        <span class="appShellMenuLabel">复制目录</span>
      </button>
    </AppShellMenuTeleport>
  </div>
</template>

<style scoped>
.sidebarListWrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sidebarTabBody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.sidebarListViewportPad {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* 列表与边缘留白由 .sidebar .virtualList-scroll.sidebarList 的 padding 统一控制 */
  padding: 0;
  background: var(--bg);
}
.sidebarList {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}
.sidebarList--itemGap :deep(.virtualList-row) {
  padding-bottom: 5px;
}
.sidebarItem {
  text-align: left;
  background: transparent;
  border: none;
  color: var(--list-item-fg);
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  gap: 8px;
  align-items: center;
}
.sidebarItem--tree {
  gap: 6px;
  padding-left: 6px;
}
.chapterItemMain {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0;
}
.chapterTreeChevron {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  color: var(--tab-fg);
  transform: rotate(-90deg);
  transition: transform 0.12s ease;
  cursor: pointer;
}
.chapterTreeChevron--expanded {
  transform: rotate(0deg);
}
.chapterTreeChevron :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}
.chapterTreeChevron :deep(svg path) {
  fill: currentColor;
}
.chapterTreeChevronSpacer {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-right: 8px;
}
.itemName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itemMeta {
  font-size: 12px;
  color: inherit;
  opacity: 0.65;
  white-space: nowrap;
}
.sidebarItem:hover {
  color: var(--list-item-fg);
  background: var(--list-item-bg-hover);
}
.sidebarItem.active {
  color: var(--list-item-fg-active);
  background: var(--list-item-bg-active);
}
.empty {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px 16px;
  font-size: 12px;
  color: var(--secondary);
}
.sidebarTabFooter {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--muted);
  border-top: 1px solid var(--border);
  background: var(--bg);
  user-select: none;
}
.sidebarTabFooterStart {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.sidebarTabFooterStat {
  flex: 0 1 auto;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebarTabFooterAction {
  flex-shrink: 0;
}
</style>
