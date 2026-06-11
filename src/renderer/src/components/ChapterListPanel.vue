<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import type { Chapter } from "../chapter";
import VirtualList from "./VirtualList.vue";
import { READER_SIDEBAR_ROW_STRIDE } from "../composables/useReaderSidebarLists";

defineProps<{
  currentFilePath: string | null;
  chaptersVisible: Chapter[];
  isChapterActive: (ch: Chapter) => boolean;
  showChapterCounts: boolean;
  formatCharCount: (n: number) => string;
}>();

const emit = defineEmits<{
  jumpToChapter: [chapter: Chapter];
  closeCurrentFile: [];
  bindListRef: [value: InstanceType<typeof VirtualList> | null];
}>();

function headingPaddingStyle(ch: Chapter): { paddingLeft: string } | undefined {
  const level = ch.headingLevel;
  if (level == null || level <= 1) return undefined;
  return { paddingLeft: `${(level - 1) * 10}px` };
}

function onBindListRef(value: Element | ComponentPublicInstance | null) {
  if (value && typeof value === "object" && "$el" in value) {
    emit("bindListRef", value as InstanceType<typeof VirtualList>);
    return;
  }
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
          :item-count="chaptersVisible.length"
          :row-stride="READER_SIDEBAR_ROW_STRIDE"
          :overscan="10"
          :item-key="(i) => i"
        >
          <template #default="{ index }">
            <button
              class="sidebarItem"
              :class="{
                active: isChapterActive(chaptersVisible[index]),
              }"
              :title="chaptersVisible[index].title"
              @click="emit('jumpToChapter', chaptersVisible[index])"
            >
              <span
                class="itemName"
                :style="headingPaddingStyle(chaptersVisible[index])"
                >{{ chaptersVisible[index].title }}</span
              >
              <span v-if="showChapterCounts" class="itemMeta">{{
                formatCharCount(chaptersVisible[index].charCount)
              }}</span>
            </button>
          </template>
        </VirtualList>
      </div>
    </div>
    <div v-if="currentFilePath" class="sidebarTabFooter">
      <span class="sidebarTabFooterStat"
        >共 {{ chaptersVisible.length }} 章</span
      >
      <button
        type="button"
        class="link danger hoverMode sidebarTabFooterAction"
        @click="emit('closeCurrentFile')"
      >
        关闭文件
      </button>
    </div>
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
