<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import LoadingDotsBounce from "../../components/LoadingDotsBounce.vue";
import LoadingDotsRotate from "../../components/LoadingDotsRotate.vue";
import VirtualList from "../../components/VirtualList.vue";
import { icons } from "../../icons";
import type { BookChapter } from "@shared/bookSource/types";

const props = withDefaults(
  defineProps<{
    chapters: BookChapter[];
    currentDisplayIndex: number;
    rowStride: number;
    readerBootLoading?: boolean;
    offlineCaching?: boolean;
    offlineCacheProgress: { current: number; total: number; chapterUrl: string };
    offlineCacheProgressPercent: number;
    offlineCacheProgressLabel: string;
    showChapterTag: boolean;
    chapterDisplayBaseTitle: (index: number) => string;
    chapterDisplayTitle: (index: number) => string;
    isChapterLoading: (index: number) => boolean;
    isChapterOfflineCaching: (ch: BookChapter | undefined) => boolean;
    isChapterCached: (ch: BookChapter | undefined) => boolean;
  }>(),
  {
    readerBootLoading: false,
    offlineCaching: false,
  },
);

const emit = defineEmits<{
  chapterClick: [index: number];
  stopOfflineCache: [];
}>();

const chapterListRef = ref<InstanceType<typeof VirtualList> | null>(null);

const canLocateCurrentChapter = computed(() => {
  const idx = props.currentDisplayIndex;
  return idx >= 0 && idx < props.chapters.length;
});

async function onLocateCurrentChapter() {
  if (!canLocateCurrentChapter.value) return;
  const idx = props.currentDisplayIndex;
  await nextTick();
  requestAnimationFrame(() => {
    chapterListRef.value?.scrollToIndex(idx, {
      align: "center",
      behavior: "smooth",
    });
  });
}

function scrollToIndex(
  ...args: Parameters<InstanceType<typeof VirtualList>["scrollToIndex"]>
) {
  return chapterListRef.value?.scrollToIndex(...args);
}

defineExpose({
  scrollToIndex,
});
</script>

<template>
  <div
    v-if="offlineCaching"
    class="sidebarCacheBar"
    role="progressbar"
    :aria-valuenow="offlineCacheProgress.current"
    aria-valuemin="0"
    :aria-valuemax="offlineCacheProgress.total"
    :aria-label="offlineCacheProgressLabel"
  >
    <span class="sidebarCacheBarLabel">{{ offlineCacheProgressLabel }}</span>
    <button
      type="button"
      class="link danger sidebarCacheBarStop"
      @click="emit('stopOfflineCache')"
    >
      停止
    </button>
    <div class="sidebarCacheBarTrack" aria-hidden="true">
      <div
        class="sidebarCacheBarFill"
        :style="{ width: `${offlineCacheProgressPercent}%` }"
      />
    </div>
  </div>
  <div class="sidebarListWrap">
    <div class="sidebarTabBody">
      <div v-if="!chapters.length" class="empty">
        <span
          v-if="readerBootLoading"
          class="findBookReaderLoadingHint"
          aria-live="polite"
        >
          加载中<LoadingDotsBounce />
        </span>
        <template v-else>暂无章节</template>
      </div>
      <div v-else class="sidebarListViewportPad">
        <VirtualList
          ref="chapterListRef"
          class="sidebarList sidebarList--itemGap"
          :item-count="chapters.length"
          :row-stride="rowStride"
          :overscan="10"
          :item-key="(i) => i"
          arrow-nav
        >
          <template #default="{ index }">
            <button
              type="button"
              tabindex="-1"
              class="sidebarItem"
              :class="{
                active: index === currentDisplayIndex,
                'sidebarItem--vip':
                  chapters[index]?.isVip || chapters[index]?.isPay,
              }"
              :title="chapterDisplayTitle(index)"
              @click="emit('chapterClick', index)"
            >
              <span
                v-if="chapters[index]?.isVip || chapters[index]?.isPay"
                class="findBookReaderChapterLock"
                :class="{
                  'findBookReaderChapterLock--unlocked': chapters[index]?.isPay,
                }"
                v-html="chapters[index]?.isPay ? icons.unlock : icons.lock"
                :aria-label="chapters[index]?.isPay ? '已购买' : 'VIP'"
              />
              <span class="itemName">
                <span class="itemNameTitle">{{
                  chapterDisplayBaseTitle(index)
                }}</span>
                <span
                  v-if="showChapterTag && chapters[index]?.tag?.trim()"
                  class="itemNameTag"
                  >{{ chapters[index].tag.trim() }}</span
                >
              </span>
              <LoadingDotsRotate
                v-if="isChapterLoading(index)"
                class="findBookReaderChapterLoading"
                title="加载中"
                aria-label="加载中"
              />
              <LoadingDotsRotate
                v-else-if="isChapterOfflineCaching(chapters[index])"
                class="findBookReaderChapterLoading"
                title="正在缓存"
                aria-label="正在缓存"
              />
              <span
                v-else-if="isChapterCached(chapters[index])"
                class="findBookReaderChapterCached"
                v-html="icons.ok"
                title="已离线缓存"
                aria-label="已离线缓存"
              />
            </button>
          </template>
        </VirtualList>
      </div>
    </div>
    <div v-if="chapters.length" class="sidebarTabFooter">
      <div class="sidebarTabFooterStart">
        <span class="sidebarTabFooterStat">共 {{ chapters.length }} 章</span>
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
:deep(.virtualList-scroll.sidebarList) {
  box-sizing: border-box;
  padding: 6px 6px 1px;
}
:deep(.virtualList-scroll.sidebarList::-webkit-scrollbar-thumb) {
  border-right-width: 0;
}
.sidebarItem {
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
.sidebarItem--vip {
  color: var(--muted);
}
.itemName {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}
.itemNameTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itemNameTag {
  color: var(--secondary);
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.findBookReaderChapterCached,
.findBookReaderChapterLoading {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--muted);
}
.findBookReaderChapterLoading {
  color: var(--accent);
}
.findBookReaderChapterCached :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}
.findBookReaderChapterCached :deep(svg path) {
  fill: currentColor;
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
.sidebarCacheBar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
  padding: 10px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  user-select: none;
}
.sidebarCacheBarLabel {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebarCacheBarStop {
  flex-shrink: 0;
}
.sidebarCacheBarTrack {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 3px;
  z-index: 1;
  pointer-events: none;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  overflow: hidden;
}
.sidebarCacheBarFill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
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
.findBookReaderChapterLock {
  display: inline-flex;
  width: 14px;
  flex-shrink: 0;
  color: var(--warning);
}
.findBookReaderChapterLock--unlocked {
  color: var(--accent);
}
.findBookReaderChapterLock :deep(svg) {
  width: 14px;
  height: 14px;
}
.findBookReaderChapterLock :deep(svg path) {
  fill: currentColor;
}
.findBookReaderLoadingHint {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
}
</style>
