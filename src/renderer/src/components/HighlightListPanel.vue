<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { icons } from "../icons";
import {
  buildHighlightFindQuery,
  highlightGroupListKeyBase,
  type HighlightListTerm,
} from "../utils/highlightWords";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";
import { syncDismissibleOverlay } from "../utils/dismissibleOverlayStack";
import AppShellMenuTeleport from "./AppShellMenuTeleport.vue";
import HighlightTermEditModal, {
  type HighlightTermEditCommit,
} from "./HighlightTermEditModal.vue";
import LoadingDotsBounce from "./LoadingDotsBounce.vue";

const HIGHLIGHTS_HEADER_MORE_MENU_W = 160;
/** 超过该词数则列表行只显示代表词 + +N */
const HL_SUMMARY_THRESHOLD = 2;
const HL_DRAG_MIME = "application/x-colortxt-highlight-group";

type HighlightListRow = HighlightListTerm & { listKey: string };

/** 同组在收藏与本书各有一条时 key 含 scope；不含 colorIndex */
function attachStableListKeys(terms: HighlightListTerm[]): HighlightListRow[] {
  const dupCount = new Map<string, number>();
  for (const t of terms) {
    const base = highlightGroupListKeyBase(t.storedTerms);
    dupCount.set(base, (dupCount.get(base) ?? 0) + 1);
  }
  return terms.map((t) => {
    const base = highlightGroupListKeyBase(t.storedTerms);
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
    highlightColors?: readonly string[];
    monacoFontFamily: string;
    menuAnchorEl?: HTMLButtonElement | null;
    /** 高亮词 AI 检索进行中：列表内信息条（不挡其它操作） */
    aiSearching?: boolean;
    aiSearchBannerText?: string;
  }>(),
  {
    currentFilePath: null,
    highlightTerms: () => [],
    hasInlineSearchHighlight: false,
    highlightPreviewBg: "var(--reader-bg, var(--bg))",
    highlightColors: () => [],
    menuAnchorEl: null,
    aiSearching: false,
    aiSearchBannerText: "",
  },
);

const emit = defineEmits<{
  findHighlightTerm: [payload: { query: string; useRegex: boolean }];
  removeHighlightTerm: [
    payload: { storedTerms: string[]; scope: "global" | "book" },
  ];
  favoriteHighlightTerm: [
    payload: { storedTerms: string[]; colorIndex: number },
  ];
  unfavoriteHighlightTerm: [
    payload: { storedTerms: string[]; colorIndex: number },
  ];
  commitHighlightGroup: [payload: HighlightTermEditCommit];
  mergeHighlightGroups: [
    payload: {
      source: { storedTerms: string[]; scope: "global" | "book" };
      target: {
        storedTerms: string[];
        scope: "global" | "book";
        colorIndex: number;
      };
    },
  ];
  splitHighlightTerm: [
    payload: {
      storedTerms: string[];
      scope: "global" | "book";
      colorIndex: number;
      term: string;
    },
  ];
  clearInlineSearchHighlight: [];
  clearHighlights: [];
  exportBookHighlightsJson: [];
  importBookHighlightsJson: [];
  exportFavoriteHighlightsJson: [];
  importFavoriteHighlightsJson: [];
  stopAiSearch: [];
}>();

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
  widthPx: HIGHLIGHTS_HEADER_MORE_MENU_W,
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

const editOpen = ref(false);
const editMode = ref<"add" | "edit">("add");
const editScope = ref<"global" | "book">("book");
const editInitialTerms = ref<string[]>([]);
const editInitialColorIndex = ref(0);

function openAddModal(prefillTerms?: readonly string[]) {
  editMode.value = "add";
  editScope.value = "book";
  editInitialTerms.value = prefillTerms?.length
    ? [...prefillTerms]
    : [];
  editInitialColorIndex.value = 0;
  editOpen.value = true;
}

function openEditModal(item: HighlightListTerm) {
  closeGroupExpand();
  editMode.value = "edit";
  editScope.value = item.scope;
  editInitialTerms.value = [...item.storedTerms];
  editInitialColorIndex.value = item.colorIndex;
  editOpen.value = true;
}

defineExpose({
  openMoreMenu: toggleMoreMenu,
  openAddModal,
  moreOpen,
});

function onRemoveHighlightTermClick(ev: MouseEvent, item: HighlightListTerm) {
  ev.preventDefault();
  ev.stopPropagation();
  closeGroupExpand();
  emit("removeHighlightTerm", {
    storedTerms: [...item.storedTerms],
    scope: item.scope,
  });
}

function onFavoriteClick(ev: MouseEvent, item: HighlightListTerm) {
  ev.preventDefault();
  ev.stopPropagation();
  if (item.isFavorited) {
    emit("unfavoriteHighlightTerm", {
      storedTerms: [...item.storedTerms],
      colorIndex: item.colorIndex,
    });
  } else {
    emit("favoriteHighlightTerm", {
      storedTerms: [...item.storedTerms],
      colorIndex: item.colorIndex,
    });
  }
}

function onEditClick(ev: MouseEvent, item: HighlightListTerm) {
  ev.preventDefault();
  ev.stopPropagation();
  openEditModal(item);
}

const suppressItemClick = ref(false);

/** —— 多词组：代表词 + +N，就地展开 —— */
const expandedListKey = ref<string | null>(null);
const groupListExpanded = computed(() => expandedListKey.value != null);
syncDismissibleOverlay(groupListExpanded);

function closeGroupExpand() {
  expandedListKey.value = null;
}

function isItemExpanded(item: HighlightListTerm & { listKey: string }): boolean {
  return expandedListKey.value === item.listKey;
}

function usesSummaryRow(item: HighlightListTerm): boolean {
  return item.terms.length > HL_SUMMARY_THRESHOLD;
}

function summaryHeadTerms(item: HighlightListTerm): string[] {
  return item.terms.slice(0, 1);
}

function summaryMoreCount(item: HighlightListTerm): number {
  return Math.max(0, item.terms.length - 1);
}

const highlightRows = computed(() =>
  attachStableListKeys(props.highlightTerms),
);

watch(
  () => props.highlightTerms,
  () => {
    const key = expandedListKey.value;
    if (!key) return;
    const hit = attachStableListKeys(props.highlightTerms).find(
      (r) => r.listKey === key,
    );
    if (!hit || !usesSummaryRow(hit)) closeGroupExpand();
  },
);

function onSummaryMoreClick(item: HighlightListRow, ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  if (expandedListKey.value === item.listKey) {
    closeGroupExpand();
    return;
  }
  expandedListKey.value = item.listKey;
}

function onExpandOutsidePointerDown(ev: PointerEvent) {
  if (!expandedListKey.value) return;
  const t = ev.target as HTMLElement | null;
  if (t?.closest?.(".highlightItem--expanded")) return;
  // 点另一项 +N：勿在 pointerdown 先收起，否则布局位移会吞掉后续 click
  if (t?.closest?.(".highlightMoreBadge")) return;
  closeGroupExpand();
}

function onExpandEsc(ev: KeyboardEvent) {
  if (ev.key !== "Escape" || !expandedListKey.value) return;
  ev.preventDefault();
  ev.stopPropagation();
  closeGroupExpand();
}

onMounted(() => {
  document.addEventListener("pointerdown", onExpandOutsidePointerDown, true);
  document.addEventListener("keydown", onExpandEsc, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onExpandOutsidePointerDown, true);
  document.removeEventListener("keydown", onExpandEsc, true);
});

function onItemClick(item: HighlightListTerm) {
  if (suppressItemClick.value) {
    suppressItemClick.value = false;
    return;
  }
  const { query, useRegex } = buildHighlightFindQuery(item.terms);
  if (!query) return;
  emit("findHighlightTerm", { query, useRegex });
}

/** 展开态：整组跳转只由 header 触发，行内空白不跳转 */
function onHighlightItemClick(
  item: HighlightListRow,
  _ev: MouseEvent,
) {
  if (isItemExpanded(item)) return;
  onItemClick(item);
}

function onTermClick(
  item: HighlightListTerm,
  termIndex: number,
  ev: MouseEvent,
) {
  ev.stopPropagation();
  if (suppressItemClick.value) {
    suppressItemClick.value = false;
    return;
  }
  const term = item.terms[termIndex]?.trim();
  if (!term) return;
  emit("findHighlightTerm", { query: term, useRegex: false });
}

function onEditCommit(payload: HighlightTermEditCommit) {
  emit("commitHighlightGroup", payload);
}

function onMoreSelect(action: string) {
  closeMoreMenu();
  if (action === "exportBook") emit("exportBookHighlightsJson");
  else if (action === "importBook") emit("importBookHighlightsJson");
  else if (action === "exportFavorite") emit("exportFavoriteHighlightsJson");
  else if (action === "importFavorite") emit("importFavoriteHighlightsJson");
}

const bookTermCount = computed(
  () => props.highlightTerms.filter((t) => t.scope === "book").length,
);

const favoriteTermCount = computed(
  () => props.highlightTerms.filter((t) => t.scope === "global").length,
);

const emptyMessage = computed(() => {
  if (props.highlightTerms.length > 0) return "";
  return props.currentFilePath ? "当前文件暂无高亮词" : "未打开文件";
});

function itemTitle(item: HighlightListTerm & { listKey?: string }): string {
  if (usesSummaryRow(item)) {
    return `共 ${item.terms.length} 个词，点击跳转到下一个匹配`;
  }
  return "点击跳转到下一个：" + item.terms.join(" | ");
}

function termTitle(term: string): string {
  return "点击跳转到下一个：" + term;
}

/** —— 拖放合并（整项 / 单个词）；词拖到列表外则拆分 —— */
const dragSourceKey = ref<string | null>(null);
const dragSourceTermKey = ref<string | null>(null);
const dropTargetKey = ref<string | null>(null);
/** 本次拖放是否落到某一列表项上（含拖回自身） */
const dropOnItem = ref(false);

type DragPayload = {
  listKey: string;
  /** 被拖动的词：整项为全组，单词语为 length=1 */
  storedTerms: string[];
  scope: "global" | "book";
  kind: "group" | "term";
  /** kind=term 时源组内下标（组内排序用） */
  termIndex?: number;
};

type ActiveDrag = {
  payload: DragPayload;
  /** 拖出词语所属原组（拆分用） */
  groupStoredTerms: string[];
  colorIndex: number;
};

const activeDrag = ref<ActiveDrag | null>(null);
/** 同组内拖词时的插入指示 */
const dropReorder = ref<{
  listKey: string;
  termIndex: number;
  place: "before" | "after";
} | null>(null);

function termDragKey(listKey: string, termIndex: number) {
  return `${listKey}\0${termIndex}`;
}

function beginDrag(
  item: HighlightListRow,
  ev: DragEvent,
  payload: DragPayload,
  plainLabel: string,
) {
  const dt = ev.dataTransfer;
  if (!dt) return;
  dropOnItem.value = false;
  dragSourceKey.value = item.listKey;
  activeDrag.value = {
    payload,
    groupStoredTerms: [...item.storedTerms],
    colorIndex: item.colorIndex,
  };
  dt.setData(HL_DRAG_MIME, JSON.stringify(payload));
  dt.setData("text/plain", plainLabel);
  dt.effectAllowed = "move";
}

function onItemDragStart(item: HighlightListRow, ev: DragEvent) {
  // 从词段发起的拖动由词段自己处理
  const t = ev.target as HTMLElement | null;
  if (t?.closest?.(".highlightTermPart")) return;
  dragSourceTermKey.value = null;
  beginDrag(
    item,
    ev,
    {
      listKey: item.listKey,
      storedTerms: [...item.storedTerms],
      scope: item.scope,
      kind: "group",
    },
    item.terms.join(" | "),
  );
}

function onTermDragStart(
  item: HighlightListRow,
  termIndex: number,
  ev: DragEvent,
) {
  ev.stopPropagation();
  const stored = item.storedTerms[termIndex];
  const display = item.terms[termIndex] ?? stored;
  if (!stored) {
    ev.preventDefault();
    return;
  }
  dragSourceTermKey.value = termDragKey(item.listKey, termIndex);
  beginDrag(
    item,
    ev,
    {
      listKey: item.listKey,
      storedTerms: [stored],
      scope: item.scope,
      kind: "term",
      termIndex,
    },
    display,
  );
}

function clearDragState() {
  dragSourceKey.value = null;
  dragSourceTermKey.value = null;
  dropTargetKey.value = null;
  dropReorder.value = null;
  activeDrag.value = null;
  dropOnItem.value = false;
}

function commitGroupTermOrder(
  item: HighlightListRow,
  fromIndex: number,
  insertBefore: number,
) {
  const n = item.storedTerms.length;
  if (fromIndex < 0 || fromIndex >= n) return;
  let to = Math.max(0, Math.min(n, insertBefore));
  if (fromIndex === to || fromIndex + 1 === to) return;
  const next = [...item.storedTerms];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return;
  if (fromIndex < to) to -= 1;
  next.splice(to, 0, moved);
  suppressItemClick.value = true;
  emit("commitHighlightGroup", {
    mode: "edit",
    scope: item.scope,
    colorIndex: item.colorIndex,
    terms: next,
    replaceStoredTerms: [...item.storedTerms],
  });
}

function onTermDragOver(
  item: HighlightListRow,
  termIndex: number,
  ev: DragEvent,
) {
  const drag = activeDrag.value;
  if (!drag || drag.payload.kind !== "term") return;
  if (drag.payload.listKey !== item.listKey) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  const el = ev.currentTarget as HTMLElement | null;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const place: "before" | "after" =
    ev.clientX < rect.left + rect.width / 2 ? "before" : "after";
  dropReorder.value = { listKey: item.listKey, termIndex, place };
}

function onTermDragLeave(item: HighlightListRow, termIndex: number, ev: DragEvent) {
  const related = ev.relatedTarget as Node | null;
  if (related && (ev.currentTarget as HTMLElement).contains(related)) return;
  const cur = dropReorder.value;
  if (
    cur &&
    cur.listKey === item.listKey &&
    cur.termIndex === termIndex
  ) {
    dropReorder.value = null;
  }
}

function onTermDrop(item: HighlightListRow, termIndex: number, ev: DragEvent) {
  const drag = activeDrag.value;
  if (!drag || drag.payload.kind !== "term") return;
  if (drag.payload.listKey !== item.listKey) return;
  ev.preventDefault();
  ev.stopPropagation();
  dropOnItem.value = true;
  const from =
    typeof drag.payload.termIndex === "number"
      ? drag.payload.termIndex
      : item.storedTerms.indexOf(drag.payload.storedTerms[0] ?? "");
  const hint = dropReorder.value;
  const place =
    hint &&
    hint.listKey === item.listKey &&
    hint.termIndex === termIndex
      ? hint.place
      : ev.clientX <
          (ev.currentTarget as HTMLElement).getBoundingClientRect().left +
            (ev.currentTarget as HTMLElement).getBoundingClientRect().width / 2
        ? "before"
        : "after";
  const insertBefore = place === "before" ? termIndex : termIndex + 1;
  commitGroupTermOrder(item, from, insertBefore);
  clearDragState();
}

/** 展开词列表空白处：同组拖词松手不算拆分 */
function onExpandTermsDragOver(item: HighlightListRow, ev: DragEvent) {
  const drag = activeDrag.value;
  if (!drag || drag.payload.kind !== "term") return;
  if (drag.payload.listKey !== item.listKey) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
}

function onExpandTermsDrop(item: HighlightListRow, ev: DragEvent) {
  const drag = activeDrag.value;
  if (!drag || drag.payload.kind !== "term") return;
  if (drag.payload.listKey !== item.listKey) return;
  ev.preventDefault();
  ev.stopPropagation();
  dropOnItem.value = true;
  clearDragState();
}

function termDropPlaceClass(
  item: HighlightListRow,
  termIndex: number,
): string | undefined {
  const d = dropReorder.value;
  if (!d || d.listKey !== item.listKey || d.termIndex !== termIndex) {
    return undefined;
  }
  return d.place === "before"
    ? "highlightTermPart--dropBefore"
    : "highlightTermPart--dropAfter";
}

function onDragEnd() {
  const drag = activeDrag.value;
  const landedOnItem = dropOnItem.value;
  // 单词语拖到列表外（未落到任一项）且原组为多词 → 自动拆分
  if (
    drag &&
    drag.payload.kind === "term" &&
    !landedOnItem &&
    drag.groupStoredTerms.length > 1 &&
    drag.payload.storedTerms[0]
  ) {
    suppressItemClick.value = true;
    emit("splitHighlightTerm", {
      storedTerms: [...drag.groupStoredTerms],
      scope: drag.payload.scope,
      colorIndex: drag.colorIndex,
      term: drag.payload.storedTerms[0],
    });
  }
  clearDragState();
}

function onItemDragOver(item: HighlightListRow, ev: DragEvent) {
  if (!dragSourceKey.value) return;
  if (dragSourceKey.value === item.listKey) {
    // 同组内拖词：允许 drop，避免松手被当成拖到外面而拆分
    if (activeDrag.value?.payload.kind === "term") {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    }
    return;
  }
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  dropTargetKey.value = item.listKey;
}

function onItemDragLeave(item: HighlightListRow, ev: DragEvent) {
  const related = ev.relatedTarget as Node | null;
  if (related && (ev.currentTarget as HTMLElement).contains(related)) return;
  if (dropTargetKey.value === item.listKey) dropTargetKey.value = null;
}

function onItemDrop(item: HighlightListRow, ev: DragEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  suppressItemClick.value = true;
  dropOnItem.value = true;
  const raw = ev.dataTransfer?.getData(HL_DRAG_MIME);
  dropTargetKey.value = null;
  if (!raw) {
    clearDragState();
    return;
  }
  let payload: DragPayload;
  try {
    payload = JSON.parse(raw) as DragPayload;
  } catch {
    clearDragState();
    return;
  }
  if (!payload?.storedTerms?.length) {
    clearDragState();
    return;
  }
  // 整项拖到自身 / 单词语拖回本组：不算合并，也不拆分
  if (payload.listKey === item.listKey) {
    clearDragState();
    return;
  }
  emit("mergeHighlightGroups", {
    source: {
      storedTerms: payload.storedTerms,
      scope: payload.scope,
    },
    target: {
      storedTerms: [...item.storedTerms],
      scope: item.scope,
      colorIndex: item.colorIndex,
    },
  });
  clearDragState();
}

</script>

<template>
  <div class="highlightPanelWrap">
    <div class="highlightPanelBody">
      <div
        v-if="aiSearching"
        class="highlightAiSearchBanner"
        role="status"
        aria-live="polite"
      >
        <span class="highlightAiSearchBannerText">
          {{ aiSearchBannerText.trim() || "正在检索" }}<LoadingDotsBounce />
        </span>
        <button
          type="button"
          class="highlightAiSearchCancelBtn"
          title="停止"
          aria-label="停止"
          @click="emit('stopAiSearch')"
        >
          <span
            class="highlightActionIcon"
            aria-hidden="true"
            v-html="icons.close"
          ></span>
        </button>
      </div>
      <div
        v-if="highlightTerms.length === 0 && !aiSearching"
        class="highlightEmpty"
      >
        {{ emptyMessage }}
      </div>
      <TransitionGroup
        v-else-if="highlightTerms.length > 0"
        name="highlightList"
        tag="div"
        class="highlightList"
      >
        <div
          v-for="item in highlightRows"
          :key="item.listKey"
          :title="itemTitle(item)"
          class="highlightItem"
          :class="{
            'highlightItem--favorited': item.isFavorited,
            'highlightItem--expanded': isItemExpanded(item),
            'highlightItem--dragging':
              dragSourceKey === item.listKey && !dragSourceTermKey,
            'highlightItem--dropTarget': dropTargetKey === item.listKey,
          }"
          :style="{
            backgroundColor: highlightPreviewBg,
            fontFamily: monacoFontFamily,
          }"
          draggable="true"
          @click="onHighlightItemClick(item, $event)"
          @dragstart="onItemDragStart(item, $event)"
          @dragend="onDragEnd"
          @dragover="onItemDragOver(item, $event)"
          @dragleave="onItemDragLeave(item, $event)"
          @drop="onItemDrop(item, $event)"
        >
          <template v-if="isItemExpanded(item)">
            <div
              class="highlightItemExpandHeader"
              :title="itemTitle(item)"
              @click.stop="onItemClick(item)"
            >
              <span class="highlightItemExpandCount"
                >共 {{ item.terms.length }} 个</span
              >
              <div class="highlightItemExpandActions" @click.stop @mousedown.stop>
                <button
                  type="button"
                  class="highlightEditBtn highlightEditBtn--always"
                  title="编辑"
                  aria-label="编辑"
                  draggable="false"
                  @click="onEditClick($event, item)"
                >
                  <span
                    class="highlightActionIcon"
                    aria-hidden="true"
                    v-html="icons.edit"
                  ></span>
                </button>
                <button
                  type="button"
                  class="highlightFavoriteBtn"
                  :class="{
                    'highlightFavoriteBtn--active': item.isFavorited,
                  }"
                  :title="item.isFavorited ? '取消收藏' : '收藏'"
                  :aria-label="item.isFavorited ? '取消收藏' : '收藏'"
                  draggable="false"
                  @click="onFavoriteClick($event, item)"
                >
                  <span
                    class="highlightActionIcon"
                    aria-hidden="true"
                    v-html="
                      item.isFavorited ? icons.favoriteFill : icons.favorite
                    "
                  ></span>
                </button>
                <button
                  v-if="!item.isFavorited"
                  type="button"
                  class="highlightRemoveBtn"
                  title="移除"
                  aria-label="移除"
                  draggable="false"
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
            <div
              class="highlightItemExpandTerms"
              @click.stop
              @dragover="onExpandTermsDragOver(item, $event)"
              @drop="onExpandTermsDrop(item, $event)"
            >
              <template v-for="(term, ti) in item.terms" :key="ti">
                <span
                  v-if="ti > 0"
                  class="highlightTermSep"
                  aria-hidden="true"
                  >|</span
                >
                <span
                  class="highlightTermPart"
                  :class="[
                    {
                      'highlightTermPart--dragging':
                        dragSourceTermKey === termDragKey(item.listKey, ti),
                    },
                    termDropPlaceClass(item, ti),
                  ]"
                  :title="termTitle(term)"
                  :style="{ color: item.color }"
                  draggable="true"
                  @click="onTermClick(item, ti, $event)"
                  @dragstart="onTermDragStart(item, ti, $event)"
                  @dragend="onDragEnd"
                  @dragover="onTermDragOver(item, ti, $event)"
                  @dragleave="onTermDragLeave(item, ti, $event)"
                  @drop="onTermDrop(item, ti, $event)"
                  >{{ term }}</span
                >
              </template>
            </div>
          </template>
          <template v-else>
            <span class="highlightText">
              <template v-if="usesSummaryRow(item)">
                <template
                  v-for="(term, ti) in summaryHeadTerms(item)"
                  :key="ti"
                >
                  <span
                    class="highlightTermPart"
                    :class="{
                      'highlightTermPart--dragging':
                        dragSourceTermKey === termDragKey(item.listKey, ti),
                    }"
                    :title="termTitle(term)"
                    :style="{ color: item.color }"
                    draggable="true"
                    @click="onTermClick(item, ti, $event)"
                    @dragstart="onTermDragStart(item, ti, $event)"
                    @dragend="onDragEnd"
                    >{{ term }}</span
                  >
                </template>
                <button
                  type="button"
                  class="highlightMoreBadge"
                  :title="`展开其余 ${summaryMoreCount(item)} 个词`"
                  :aria-label="`展开其余 ${summaryMoreCount(item)} 个词`"
                  aria-expanded="false"
                  draggable="false"
                  @click="onSummaryMoreClick(item, $event)"
                >
                  +{{ summaryMoreCount(item) }}
                </button>
              </template>
              <template v-else>
                <template v-for="(term, ti) in item.terms" :key="ti">
                  <span
                    v-if="ti > 0"
                    class="highlightTermSep"
                    aria-hidden="true"
                    >|</span
                  >
                  <span
                    class="highlightTermPart"
                    :class="[
                      {
                        'highlightTermPart--dragging':
                          dragSourceTermKey === termDragKey(item.listKey, ti),
                      },
                      termDropPlaceClass(item, ti),
                    ]"
                    :title="termTitle(term)"
                    :style="{ color: item.color }"
                    draggable="true"
                    @click="onTermClick(item, ti, $event)"
                    @dragstart="onTermDragStart(item, ti, $event)"
                    @dragend="onDragEnd"
                    @dragover="onTermDragOver(item, ti, $event)"
                    @dragleave="onTermDragLeave(item, ti, $event)"
                    @drop="onTermDrop(item, ti, $event)"
                    >{{ term }}</span
                  >
                </template>
              </template>
            </span>
            <div class="highlightItemActions" @mousedown.stop>
              <button
                type="button"
                class="highlightEditBtn"
                title="编辑"
                aria-label="编辑"
                draggable="false"
                @click="onEditClick($event, item)"
              >
                <span
                  class="highlightActionIcon"
                  aria-hidden="true"
                  v-html="icons.edit"
                ></span>
              </button>
              <button
                type="button"
                class="highlightFavoriteBtn"
                :class="{ 'highlightFavoriteBtn--active': item.isFavorited }"
                :title="item.isFavorited ? '取消收藏' : '收藏'"
                :aria-label="item.isFavorited ? '取消收藏' : '收藏'"
                draggable="false"
                @click="onFavoriteClick($event, item)"
              >
                <span
                  class="highlightActionIcon"
                  aria-hidden="true"
                  v-html="
                    item.isFavorited ? icons.favoriteFill : icons.favorite
                  "
                ></span>
              </button>
              <button
                v-if="!item.isFavorited"
                type="button"
                class="highlightRemoveBtn"
                title="移除"
                aria-label="移除"
                draggable="false"
                @click="onRemoveHighlightTermClick($event, item)"
              >
                <span
                  class="highlightActionIcon"
                  aria-hidden="true"
                  v-html="icons.close"
                ></span>
              </button>
            </div>
          </template>
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
    <AppShellMenuTeleport
      v-model:open="moreOpen"
      :left="moreLeft"
      :top="moreTop"
      :width="HIGHLIGHTS_HEADER_MORE_MENU_W"
      caret="end"
      :on-panel-mount="bindMorePanel"
      aria-label="高亮词更多"
    >
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="!currentFilePath || bookTermCount <= 0"
        @click="onMoreSelect('exportBook')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.export" />
        <span class="appShellMenuLabel">导出本书高亮词</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="!currentFilePath"
        @click="onMoreSelect('importBook')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.import" />
        <span class="appShellMenuLabel">导入本书高亮词</span>
      </button>
      <div class="appShellMenuDivider" role="separator" />
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="favoriteTermCount <= 0"
        @click="onMoreSelect('exportFavorite')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.export" />
        <span class="appShellMenuLabel">导出收藏高亮词</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onMoreSelect('importFavorite')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.import" />
        <span class="appShellMenuLabel">导入收藏高亮词</span>
      </button>
    </AppShellMenuTeleport>
    <HighlightTermEditModal
      v-model:open="editOpen"
      :mode="editMode"
      :scope="editScope"
      :initial-terms="editInitialTerms"
      :initial-color-index="editInitialColorIndex"
      :highlight-colors="highlightColors"
      :highlight-preview-bg="highlightPreviewBg"
      :monaco-font-family="monacoFontFamily"
      @commit="onEditCommit"
    />
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

/* 与 AiIndexProgressBanner 同风格：列表内进度信息条 */
.highlightAiSearchBanner {
  margin: 0 0 6px;
  font-size: 12px;
  padding: 6px 4px 6px 8px;
  border-radius: 6px;
  line-height: 1.45;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--fg);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.highlightAiSearchBannerText {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
  white-space: pre-wrap;
}

.highlightAiSearchCancelBtn {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--muted);
  transition: color 0.15s ease;
  border-radius: 4px;
}

.highlightAiSearchCancelBtn:hover {
  color: var(--danger);
}

.highlightAiSearchCancelBtn .highlightActionIcon :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}

.highlightAiSearchCancelBtn .highlightActionIcon :deep(svg path) {
  fill: currentColor;
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
  gap: 4px;
  min-width: 0;
  cursor: pointer;
  outline: 1px solid transparent;
  transition: outline-color 0.12s ease;
}

.highlightItem--expanded {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  /* 右、底无内边距，词列表滚动条贴右贴底 */
  padding: 6px 0 0 8px;
  cursor: default;
}

.highlightItem--dragging {
  opacity: 0.55;
}

.highlightItem--dropTarget {
  outline-color: var(--accent, var(--primary));
}

.highlightItemExpandHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-right: 4px;
  cursor: pointer;
}

.highlightItemExpandCount {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-family);
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.highlightItemExpandActions {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.highlightItemExpandTerms {
  max-height: min(36vh, 260px);
  overflow-x: hidden;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.55;
  white-space: normal;
  word-break: break-word;
  box-sizing: border-box;
  /* 内边距跟内容滚，滚动条轨道贴容器右、底边 */
  padding: 0 2px 6px 0;
}

.highlightItemExpandTerms::-webkit-scrollbar-thumb {
  border-right-width: 0;
  border-bottom-width: 0;
}

.highlightText {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  align-items: baseline;
  flex-wrap: nowrap;
  font-size: 16px;
  line-height: 1;
  overflow: hidden;
}

.highlightText > .highlightTermPart {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.highlightTermPart {
  vertical-align: baseline;
  border-radius: 2px;
}

.highlightTermPart:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.highlightTermPart--dragging {
  opacity: 0.45;
}

.highlightTermPart--dropBefore {
  box-shadow: inset 2px 0 0 var(--accent, var(--primary));
}

.highlightTermPart--dropAfter {
  box-shadow: inset -2px 0 0 var(--accent, var(--primary));
}

.highlightItemExpandTerms .highlightTermPart {
  cursor: pointer;
  white-space: nowrap;
}

.highlightTermSep {
  margin: 0 0.35em;
  color: var(--border);
  vertical-align: baseline;
}

.highlightMoreBadge {
  flex-shrink: 0;
  margin-left: 0;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--fg) 6%, var(--bg));
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
  font-family: var(--font-family);
  cursor: pointer;
  vertical-align: baseline;
  transition:
    color 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}

.highlightText .highlightMoreBadge {
  margin-left: 6px;
}

.highlightMoreBadge:hover,
.highlightMoreBadge--open {
  color: var(--accent, var(--primary));
  border-color: color-mix(
    in srgb,
    var(--accent, var(--primary)) 45%,
    var(--border)
  );
  background: color-mix(
    in srgb,
    var(--accent, var(--primary)) 10%,
    var(--bg)
  );
}

.highlightItemActions {
  flex-shrink: 0;
  display: none;
  align-items: center;
  gap: 2px;
}

.highlightItem--favorited .highlightItemActions,
.highlightItem:hover .highlightItemActions,
.highlightItem:focus-within .highlightItemActions {
  display: inline-flex;
}

.highlightEditBtn,
.highlightFavoriteBtn,
.highlightRemoveBtn {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--muted);
  transition: color 0.15s ease;
}

.highlightEditBtn {
  display: none;
  opacity: 0.72;
  transition: opacity 0.15s ease;
}

.highlightEditBtn--always,
.highlightItem:hover .highlightEditBtn,
.highlightItem:focus-within .highlightEditBtn {
  display: inline-flex;
}

.highlightEditBtn:hover {
  opacity: 1;
}

.highlightFavoriteBtn--active {
  color: var(--primary);
}

.highlightFavoriteBtn--active:hover {
  color: var(--muted);
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
  width: 12px;
  height: 12px;
}

.highlightEditBtn .highlightActionIcon :deep(svg path),
.highlightFavoriteBtn .highlightActionIcon :deep(svg path),
.highlightRemoveBtn .highlightActionIcon :deep(svg path) {
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
