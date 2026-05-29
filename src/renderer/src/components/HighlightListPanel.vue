<script setup lang="ts">
import { computed } from "vue";
import { icons } from "../icons";
import type { HighlightListTerm } from "../utils/highlightWords";

type HighlightListRow = HighlightListTerm & { listKey: string };

/** 同词在收藏与本书各有一条时 key 含 scope；否则仅用 colorIndex+text，便于收藏/取消收藏时触发 move */
function attachStableListKeys(terms: HighlightListTerm[]): HighlightListRow[] {
  const dupCount = new Map<string, number>();
  for (const t of terms) {
    const base = `${t.colorIndex}\0${t.text}`;
    dupCount.set(base, (dupCount.get(base) ?? 0) + 1);
  }
  return terms.map((t) => {
    const base = `${t.colorIndex}\0${t.text}`;
    const listKey =
      (dupCount.get(base) ?? 0) > 1 ? `${base}\0${t.scope}` : base;
    return { ...t, listKey };
  });
}

const props = withDefaults(
  defineProps<{
    currentFilePath: string | null;
    highlightTerms: HighlightListTerm[];
    hasInlineSearchHighlight?: boolean;
    highlightPreviewBg?: string;
    monacoFontFamily: string;
  }>(),
  {
    currentFilePath: null,
    highlightTerms: () => [],
    hasInlineSearchHighlight: false,
    highlightPreviewBg: "var(--reader-bg, var(--bg))",
  },
);

const emit = defineEmits<{
  findHighlightTerm: [text: string];
  removeHighlightTerm: [payload: { text: string; scope: "global" | "book" }];
  favoriteHighlightTerm: [payload: { text: string; colorIndex: number }];
  unfavoriteHighlightTerm: [payload: { text: string; colorIndex: number }];
  clearInlineSearchHighlight: [];
  clearHighlights: [];
}>();

function onRemoveHighlightTermClick(
  ev: MouseEvent,
  item: HighlightListTerm,
) {
  ev.preventDefault();
  ev.stopPropagation();
  emit("removeHighlightTerm", { text: item.text, scope: item.scope });
}

function onFavoriteClick(ev: MouseEvent, item: HighlightListTerm) {
  ev.preventDefault();
  ev.stopPropagation();
  if (item.isFavorited) {
    emit("unfavoriteHighlightTerm", {
      text: item.text,
      colorIndex: item.colorIndex,
    });
  } else {
    emit("favoriteHighlightTerm", {
      text: item.text,
      colorIndex: item.colorIndex,
    });
  }
}

const highlightRows = computed(() =>
  attachStableListKeys(props.highlightTerms),
);

const emptyMessage = computed(() => {
  if (props.highlightTerms.length > 0) return "";
  return props.currentFilePath ? "当前文件暂无高亮词" : "暂无高亮词";
});
</script>

<template>
  <div class="highlightPanelWrap">
    <div class="highlightPanelBody">
      <div v-if="highlightTerms.length === 0" class="highlightEmpty">
        {{ emptyMessage }}
      </div>
      <TransitionGroup
        v-else
        name="highlightList"
        tag="div"
        class="highlightList"
      >
        <div
          v-for="item in highlightRows"
          :key="item.listKey"
          :title="'点击跳转到下一个：' + item.text"
          class="highlightItem"
          :class="{ 'highlightItem--favorited': item.isFavorited }"
          :style="{
            backgroundColor: highlightPreviewBg,
            fontFamily: monacoFontFamily,
          }"
          @click="emit('findHighlightTerm', item.text)"
        >
          <span class="highlightText" :style="{ color: item.color }">
            {{ item.text }}
          </span>
          <div class="highlightItemActions">
            <button
              type="button"
              class="highlightFavoriteBtn"
              :class="{ 'highlightFavoriteBtn--active': item.isFavorited }"
              :title="item.isFavorited ? '取消收藏' : '收藏'"
              :aria-label="item.isFavorited ? '取消收藏' : '收藏'"
              @click="onFavoriteClick($event, item)"
            >
              <span
                class="highlightActionIcon"
                aria-hidden="true"
                v-html="item.isFavorited ? icons.favoriteFill : icons.favorite"
              ></span>
            </button>
            <button
              v-if="!item.isFavorited"
              type="button"
              class="highlightRemoveBtn"
              title="移除"
              aria-label="移除"
              @click="onRemoveHighlightTermClick($event, item)"
            >
              <span
                class="highlightActionIcon"
                aria-hidden="true"
                v-html="icons.close"
              ></span>
            </button>
          </div>
        </div>
      </TransitionGroup>
    </div>
    <div v-if="highlightTerms.length > 0" class="sidebarTabFooter">
      <span class="sidebarTabFooterStat"
        >共 {{ highlightTerms.length }} 个</span
      >
      <div class="sidebarTabFooterActions">
        <button
          type="button"
          class="link hoverMode sidebarTabFooterAction"
          :disabled="!hasInlineSearchHighlight"
          @click="emit('clearInlineSearchHighlight')"
        >
          清除定位
        </button>
        <button
          type="button"
          class="link danger hoverMode sidebarTabFooterAction"
          :disabled="!currentFilePath"
          @click="emit('clearHighlights')"
        >
          清空本书
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.highlightPanelWrap {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.highlightPanelBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.highlightList {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.highlightList-move,
.highlightList-enter-active,
.highlightList-leave-active {
  transition:
    transform 0.28s ease,
    opacity 0.22s ease;
}

.highlightList-leave-active {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 0;
}

.highlightList-enter-from,
.highlightList-leave-to {
  opacity: 0;
}

.highlightItem {
  border-radius: 4px;
  min-height: 34px;
  padding: 6px 4px 6px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.highlightText {
  min-width: 0;
  flex: 1 1 auto;
  font-size: 16px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.highlightItemActions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.highlightFavoriteBtn,
.highlightRemoveBtn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--muted);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    color 0.15s ease;
}

.highlightFavoriteBtn--active {
  opacity: 1;
  pointer-events: auto;
  color: var(--primary);
}

.highlightFavoriteBtn--active:hover {
  color: var(--muted);
}

.highlightItem:hover .highlightFavoriteBtn,
.highlightItem:focus-within .highlightFavoriteBtn,
.highlightItem:hover .highlightRemoveBtn,
.highlightItem:focus-within .highlightRemoveBtn {
  opacity: 1;
  pointer-events: auto;
}

.highlightFavoriteBtn:hover:not(.highlightFavoriteBtn--active) {
  color: var(--primary);
}

.highlightRemoveBtn:hover {
  color: var(--danger);
}

.highlightActionIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.highlightActionIcon :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}

.highlightRemoveBtn .highlightActionIcon :deep(svg) {
  width: 9px;
  height: 9px;
}

.highlightActionIcon :deep(path) {
  fill: currentColor;
}

.highlightEmpty {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  color: var(--secondary);
  font-size: 12px;
  text-align: center;
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
  min-width: 0;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebarTabFooterAction {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 0;
}

.sidebarTabFooterActions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
</style>
