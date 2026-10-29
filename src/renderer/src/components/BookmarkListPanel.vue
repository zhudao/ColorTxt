<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { icons } from "../icons";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";
import AppShellMenuTeleport from "./AppShellMenuTeleport.vue";
import AppContextMenu from "./AppContextMenu.vue";

const BOOKMARKS_HEADER_MORE_MENU_W = 120;

type BookmarkListItem = {
  line: number;
  note?: string;
  content: string;
  chapterTitle?: string;
};

export type BookmarkListPanelExpose = {
  scrollToLine: (
    line: number,
    opts?: { align?: "auto" | "center"; behavior?: ScrollBehavior },
  ) => void;
  openMoreMenu: () => void;
};

const props = withDefaults(
  defineProps<{
    currentFilePath: string | null;
    bookmarks: BookmarkListItem[];
    activeBookmarkLine: number | null;
    menuAnchorEl?: HTMLButtonElement | null;
  }>(),
  {
    currentFilePath: null,
    menuAnchorEl: null,
  },
);

const emit = defineEmits<{
  jumpToBookmark: [line: number];
  clearBookmarks: [];
  editBookmark: [line: number];
  removeBookmark: [line: number];
  bindListRef: [value: BookmarkListPanelExpose | null];
  exportBookmarksJson: [];
  importBookmarksJson: [];
}>();

const itemRefs = new Map<number, HTMLElement>();

function setItemRef(line: number, el: unknown) {
  if (el instanceof HTMLElement) itemRefs.set(line, el);
  else itemRefs.delete(line);
}

function scrollToLine(
  line: number,
  opts?: { align?: "auto" | "center"; behavior?: ScrollBehavior },
) {
  const el = itemRefs.get(line);
  if (!el) return;
  el.scrollIntoView({
    block: opts?.align === "center" ? "center" : "nearest",
    behavior: opts?.behavior ?? "auto",
  });
}

const moreBtnRef = ref<HTMLButtonElement | null>(null);
const anchorRef = ref<HTMLButtonElement | null>(null);
watch(
  () => props.menuAnchorEl ?? moreBtnRef.value,
  (el) => {
    anchorRef.value = el;
  },
  { immediate: true },
);
const moreMenu = useAnchoredAppShellMenu({
  anchor: anchorRef,
  placement: "below-end",
  widthPx: BOOKMARKS_HEADER_MORE_MENU_W,
  gap: 6,
  disabled: computed(() => !props.currentFilePath),
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

defineExpose({
  scrollToLine,
  openMoreMenu: toggleMoreMenu,
  moreOpen,
});

onMounted(() => {
  emit("bindListRef", { scrollToLine, openMoreMenu: toggleMoreMenu });
});

onBeforeUnmount(() => {
  emit("bindListRef", null);
});

const sortedBookmarks = computed(() =>
  props.bookmarks.slice().sort((a, b) => a.line - b.line),
);
const contextMenuOpen = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuLine = ref<number | null>(null);
const contextMenuItems = [
  { id: "edit", label: "编辑" },
  { id: "remove", label: "移除", type: "danger" as const },
];

function onItemClick(line: number) {
  emit("jumpToBookmark", line);
}

function closeContextMenu() {
  contextMenuOpen.value = false;
  contextMenuLine.value = null;
}

function onItemContextMenu(line: number, ev: MouseEvent) {
  ev.preventDefault();
  contextMenuLine.value = line;
  contextMenuX.value = ev.clientX;
  contextMenuY.value = ev.clientY;
  contextMenuOpen.value = true;
}

function onContextMenuSelect(actionId: string) {
  const line = contextMenuLine.value;
  if (line == null) return;
  if (actionId === "edit") emit("editBookmark", line);
  if (actionId === "remove") emit("removeBookmark", line);
  closeContextMenu();
}

function onMoreSelect(action: string) {
  closeMoreMenu();
  if (action === "export") emit("exportBookmarksJson");
  else if (action === "import") emit("importBookmarksJson");
}
</script>

<template>
  <div class="sidebarListWrap">
    <div class="sidebarTabBody">
      <div v-if="sortedBookmarks.length === 0" class="empty">
        {{ currentFilePath ? "当前文件暂无书签" : "未打开文件" }}
      </div>
      <div v-else class="sidebarListViewportPad">
        <div class="bookmarkList">
          <button
            v-for="item in sortedBookmarks"
            :key="item.line"
            :ref="(el) => setItemRef(item.line, el)"
            class="bookmarkItem"
            :class="{ active: item.line === activeBookmarkLine }"
            @click="onItemClick(item.line)"
            @contextmenu="onItemContextMenu(item.line, $event)"
          >
            <span class="bookmarkMain">
              <span
                v-if="item.note?.trim() || !item.chapterTitle"
                class="bookmarkNote"
                :class="{
                  bookmarkPlaceholder:
                    !item.note?.trim() && !item.chapterTitle,
                }"
                :title="item.note?.trim() || undefined"
              >
                {{
                  item.note?.trim() ||
                  (!item.chapterTitle ? "无备注" : "")
                }}
              </span>
              <span
                v-if="item.chapterTitle"
                class="bookmarkChapter"
                :title="item.chapterTitle"
              >
                {{ item.chapterTitle }}
              </span>
              <span
                class="bookmarkContent"
                :class="{
                  bookmarkPlaceholder: !item.content.trim(),
                }"
                :title="item.content.trim() || undefined"
              >
                {{ item.content.trim() || "（空行）" }}
              </span>
            </span>
            <span class="itemMeta">{{ item.line }} 行</span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="sortedBookmarks.length > 0" class="sidebarTabFooter">
      <span class="sidebarTabFooterStat"
        >共 {{ sortedBookmarks.length }} 条书签</span
      >
      <button
        type="button"
        class="link danger hoverMode sidebarTabFooterAction"
        :disabled="sortedBookmarks.length === 0"
        @click="emit('clearBookmarks')"
      >
        清空
      </button>
    </div>
    <AppShellMenuTeleport
      v-model:open="moreOpen"
      :left="moreLeft"
      :top="moreTop"
      :width="BOOKMARKS_HEADER_MORE_MENU_W"
      caret="end"
      :on-panel-mount="bindMorePanel"
      aria-label="书签更多"
    >
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="!currentFilePath || sortedBookmarks.length <= 0"
        @click="onMoreSelect('export')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.export" />
        <span class="appShellMenuLabel">导出书签</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="!currentFilePath"
        @click="onMoreSelect('import')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.import" />
        <span class="appShellMenuLabel">导入书签</span>
      </button>
    </AppShellMenuTeleport>
    <Teleport to="body">
      <AppContextMenu
        data-fullscreen-sidebar-float
        :open="contextMenuOpen"
        :x="contextMenuX"
        :y="contextMenuY"
        :items="contextMenuItems"
        :min-width="140"
        @close="closeContextMenu"
        @select="onContextMenuSelect"
      />
    </Teleport>
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
  padding: 6px;
  box-sizing: border-box;
  background: var(--bg);
  overflow: auto;
}
.bookmarkList {
  display: flex;
  flex-direction: column;
}
.bookmarkItem {
  width: 100%;
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
.bookmarkItem + .bookmarkItem {
  margin-top: 5px;
}
.bookmarkMain {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.bookmarkNote {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookmarkChapter {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  opacity: 0.78;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--list-item-fg);
}
.bookmarkContent {
  font-size: 11px;
  font-style: italic;
  line-height: 1.35;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookmarkNote.bookmarkPlaceholder,
.bookmarkContent.bookmarkPlaceholder {
  font-style: italic;
}
.bookmarkNote.bookmarkPlaceholder {
  opacity: 0.5;
}
.bookmarkContent.bookmarkPlaceholder {
  opacity: 0.42;
}
.itemMeta {
  font-size: 12px;
  opacity: 0.65;
  white-space: nowrap;
}
.bookmarkItem:hover {
  color: var(--list-item-fg);
  background: var(--list-item-bg-hover);
}
.bookmarkItem.active {
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
.sidebarTabFooterStat {
  flex: 1;
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
