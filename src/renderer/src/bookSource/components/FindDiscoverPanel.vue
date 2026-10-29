<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import IconButton from "../../components/IconButton.vue";
import RefreshIcon from "../../components/RefreshIcon.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import FindBookListItem from "./FindBookListItem.vue";
import { FIND_BOOK_LIST_ROW_STRIDE } from "./findBookListLayout";
import EditBookSourcePanel from "./EditBookSourcePanel.vue";
import BookSourceCenterState from "./BookSourceCenterState.vue";
import LoadingDotsBounce from "../../components/LoadingDotsBounce.vue";
import VirtualList from "../../components/VirtualList.vue";
import { icons } from "../../icons";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import {
  useBookSourceApi,
} from "../composables/useBookSource";
import { useBookshelfCoverUrls } from "../composables/useBookshelfCoverUrls";
import type { BookSourceListItem, ExploreKind, SearchBookItem } from "@shared/bookSource/types";
import { appLog, appPrompt } from "../../services/appDialog";
import { legadoFlexChildStyle } from "@shared/bookSource/legadoFlexStyle";
import "./findBookListShared.css";

const props = defineProps<{
  filter: string;
  active: boolean;
}>();

const emit = defineEmits<{
  openBook: [item: SearchBookItem];
  /** 是否已进入书源分类浏览（用于父级隐藏筛选栏） */
  exploreActiveChange: [active: boolean];
  /** 限定该书源搜索 */
  searchSource: [item: { bookSourceUrl: string; bookSourceName: string }];
  /** 书源顺序等变更（置顶后通知父级） */
  sourcesChanged: [];
}>();

const { listSources, reorderSource, getSource, saveSource } = useBookSourceApi();

const sources = ref<BookSourceListItem[]>([]);
const expandedUrl = ref<string | null>(null);
const kindsByUrl = ref<Map<string, ExploreKind[]>>(new Map());
const kindsFailedByUrl = ref<Map<string, boolean>>(new Map());
const kindsLogsByUrl = ref<Map<string, string[]>>(new Map());
const kindsLoading = ref<string | null>(null);

const exploreShow = ref<{
  sourceUrl: string;
  sourceName: string;
  kindTitle: string;
  exploreUrl: string;
} | null>(null);
const explorePaneOpen = ref(false);
const exploreBooks = ref<SearchBookItem[]>([]);
/** 发现列表 VirtualList 可见窗书籍 id，用于封面懒解析 */
const exploreVisibleCoverIds = ref<string[]>([]);
const { getCoverUrl, isCoverPending } = useBookshelfCoverUrls(exploreBooks, {
  visibleIds: exploreVisibleCoverIds,
});

function onExploreVisibleIndices(indices: number[]) {
  const next: string[] = [];
  for (const i of indices) {
    const id = exploreBooks.value[i]?.id;
    if (id) next.push(id);
  }
  exploreVisibleCoverIds.value = next;
}
const exploreLoading = ref(false);
const exploreLoadingMore = ref(false);
/** 用户点击顶栏「刷新」触发的加载（用于图标旋转，不含初次进入 / 滚动加载更多） */
const exploreRefreshing = ref(false);
/** 即将请求的页码（滚动加载用） */
const explorePage = ref(1);
/** 当前列表已加载的页码（顶栏「第 N 页」展示） */
const exploreLoadedPage = ref(1);
const exploreHasMore = ref(true);
const exploreError = ref("");
const exploreLogs = ref<string[]>([]);
/** 发现分类书籍请求序号：切换分类/返回时递增，丢弃过期响应 */
let exploreRequestSeq = 0;

function bumpExploreRequestSeq(): number {
  exploreRequestSeq += 1;
  return exploreRequestSeq;
}

function isExploreContextMatch(
  captured: { sourceUrl: string; exploreUrl: string },
): boolean {
  const cur = exploreShow.value;
  return (
    cur !== null &&
    cur.sourceUrl === captured.sourceUrl &&
    cur.exploreUrl === captured.exploreUrl
  );
}
const hasExploreLogs = computed(() => exploreLogs.value.length > 0);
/** 有错误或已有日志时显示右上角日志入口 */
const showExploreLogBtn = computed(
  () => !!exploreError.value || hasExploreLogs.value,
);
const showEdit = ref(false);
const editingUrl = ref<string | null>(null);
const discoverBodyRef = ref<HTMLElement | null>(null);
const exploreBodyRef = ref<HTMLElement | null>(null);
const sourceItemEls = new Map<string, HTMLElement>();

const sourceMoreBtnRef = ref<HTMLElement | null>(null);
const sourceMoreItem = ref<BookSourceListItem | null>(null);
const sourceMoreMenu = useAnchoredAppShellMenu({
  anchor: sourceMoreBtnRef,
  placement: "below-end",
  widthPx: 160,
  gap: 6,
});
const {
  open: sourceMoreOpen,
  left: sourceMoreLeft,
  top: sourceMoreTop,
  openMenu: openSourceMoreMenu,
  closeMenu: closeSourceMoreMenu,
  panelRef: sourceMorePanelRef,
} = sourceMoreMenu;

function bindSourceMorePanel(el: HTMLElement | null) {
  sourceMorePanelRef.value = el;
}

function setSourceItemEl(url: string, el: Element | null) {
  if (el) sourceItemEls.set(url, el as HTMLElement);
  else sourceItemEls.delete(url);
}

const DISCOVER_SCROLL_TOP_GAP = 10;

function scrollExpandedSourceToTop(url: string) {
  void nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const body = discoverBodyRef.value;
        const item = sourceItemEls.get(url);
        if (!body || !item) return;
        const head = item.querySelector(".findDiscoverSourceHead") as HTMLElement | null;
        const target = head ?? item;
        const delta =
          target.getBoundingClientRect().top -
          body.getBoundingClientRect().top -
          DISCOVER_SCROLL_TOP_GAP;
        if (Math.abs(delta) < 1) return;
        body.scrollTo({
          top: Math.max(0, body.scrollTop + delta),
          behavior: "smooth",
        });
      });
    });
  });
}

async function scrollAfterExpand(source: BookSourceListItem) {
  const url = source.bookSourceUrl;
  await loadKinds(source);
  if (expandedUrl.value !== url) return;
  scrollExpandedSourceToTop(url);
}

const filteredSources = computed(() => {
  const q = props.filter.trim();
  let list = sources.value.filter(
    (s) => s.hasExploreUrl && s.enabledExplore,
  );
  if (!q) return list;
  if (q.startsWith("group:")) {
    const g = q.slice(6).trim();
    return list.filter((s) => (s.bookSourceGroup ?? "") === g);
  }
  const lower = q.toLowerCase();
  return list.filter(
    (s) =>
      s.bookSourceName.toLowerCase().includes(lower) ||
      (s.bookSourceGroup ?? "").toLowerCase().includes(lower),
  );
});

function kindChipStyle(kind: ExploreKind): Record<string, string> {
  return legadoFlexChildStyle(kind.style);
}

const showExploreList = computed(() => explorePaneOpen.value && exploreShow.value !== null);

watch(
  showExploreList,
  (active) => {
    emit("exploreActiveChange", active);
  },
  { immediate: true },
);

async function refreshSources() {
  sources.value = await listSources();
}

function isKindsErrorKind(kind: ExploreKind): boolean {
  return kind.title.startsWith("ERROR:");
}

function kindsParseFailed(sourceUrl: string): boolean {
  return kindsFailedByUrl.value.get(sourceUrl) === true;
}

function mergeKindsLogs(existing: string[], extra: string): string[] {
  const detail = extra.trim();
  if (!detail) return existing;
  if (existing.some((line) => line.includes(detail))) return existing;
  return [...existing, detail];
}

function kindsIsEmpty(sourceUrl: string): boolean {
  const kinds = kindsByUrl.value.get(sourceUrl);
  return kinds !== undefined && kinds.length === 0;
}

function showKindsLogBtn(sourceUrl: string): boolean {
  if (expandedUrl.value !== sourceUrl) return false;
  if ((kindsLogsByUrl.value.get(sourceUrl) ?? []).length) return true;
  if (kindsParseFailed(sourceUrl)) return true;
  if (kindsLoading.value !== sourceUrl && kindsIsEmpty(sourceUrl)) return true;
  return false;
}

async function loadKinds(source: BookSourceListItem, force = false) {
  const url = source.bookSourceUrl;
  if (!force) {
    const cached = kindsByUrl.value.get(url);
    if (cached !== undefined && cached.length > 0) return;
  }
  kindsLoading.value = source.bookSourceUrl;
  try {
    if (force) {
      await window.colorTxt.bookSourceExploreClearKindsCache(source.bookSourceUrl);
    }
    const r = await window.colorTxt.bookSourceExploreKinds(source.bookSourceUrl);
    const rawKinds = r.kinds ?? [];
    const errorKind = rawKinds.find(isKindsErrorKind);
    const validKinds = rawKinds.filter((k) => !isKindsErrorKind(k));
    let logs = [...(r.logs ?? [])];
    if (errorKind) {
      const detail =
        errorKind.url?.trim() ||
        errorKind.title.replace(/^ERROR:/, "").trim();
      logs = mergeKindsLogs(logs, detail);
    } else if (r.message?.trim() && !validKinds.length) {
      logs = mergeKindsLogs(logs, r.message.trim());
    }

    const nextKinds = new Map(kindsByUrl.value);
    nextKinds.set(source.bookSourceUrl, validKinds);
    kindsByUrl.value = nextKinds;

    const nextFailed = new Map(kindsFailedByUrl.value);
    nextFailed.set(
      source.bookSourceUrl,
      Boolean(errorKind) ||
        (!!r.message?.trim() && !validKinds.length) ||
        (!validKinds.length && logs.length > 0),
    );
    kindsFailedByUrl.value = nextFailed;

    const nextLogs = new Map(kindsLogsByUrl.value);
    nextLogs.set(source.bookSourceUrl, logs);
    kindsLogsByUrl.value = nextLogs;
  } finally {
    if (kindsLoading.value === url) {
      kindsLoading.value = null;
    }
  }
}

function toggleExpand(source: BookSourceListItem) {
  if (expandedUrl.value === source.bookSourceUrl) {
    expandedUrl.value = null;
    // 收起后移开鼠标仍显示按钮：因点击留在 head 上的焦点触发了 focus-within
    const ae = document.activeElement;
    if (ae instanceof HTMLElement) ae.blur();
    return;
  }
  expandedUrl.value = source.bookSourceUrl;
  void scrollAfterExpand(source);
}

async function onKindClick(source: BookSourceListItem, kind: ExploreKind) {
  if (!kind.url?.trim()) return;
  const seq = bumpExploreRequestSeq();
  exploreShow.value = {
    sourceUrl: source.bookSourceUrl,
    sourceName: source.bookSourceName,
    kindTitle: kind.title,
    exploreUrl: kind.url,
  };
  explorePaneOpen.value = true;
  exploreBooks.value = [];
  explorePage.value = 1;
  exploreLoadedPage.value = 1;
  exploreHasMore.value = true;
  exploreError.value = "";
  exploreLogs.value = [];
  exploreLoading.value = false;
  exploreLoadingMore.value = false;
  await loadExplorePage(false, seq);
}

async function onShowExploreLogs() {
  const text = exploreLogs.value.length
    ? exploreLogs.value.join("\n\n")
    : "（暂无日志）";
  await appLog(text);
}

async function onShowKindsLogs(sourceUrl: string) {
  const logs = kindsLogsByUrl.value.get(sourceUrl) ?? [];
  const text = logs.length ? logs.join("\n\n") : "（暂无日志）";
  await appLog(text);
}

async function loadExplorePage(append: boolean, requestSeq?: number) {
  const show = exploreShow.value;
  if (!show) return;
  const seq = requestSeq ?? exploreRequestSeq;
  const captured = {
    sourceUrl: show.sourceUrl,
    exploreUrl: show.exploreUrl,
  };
  const capturedPage = explorePage.value;

  function isStale(): boolean {
    if (seq !== exploreRequestSeq) return true;
    if (!isExploreContextMatch(captured)) return true;
    if (append && explorePage.value !== capturedPage) return true;
    return false;
  }

  if (append) exploreLoadingMore.value = true;
  else exploreLoading.value = true;
  try {
    const r = await window.colorTxt.bookSourceExploreBooks({
      sourceUrl: captured.sourceUrl,
      exploreUrl: captured.exploreUrl,
      page: capturedPage,
    });
    if (isStale()) return;
    if (r.logs?.length) exploreLogs.value = r.logs;
    const items = r.items ?? [];
    // 仅有 message 时视为失败；空列表但有日志可能是登录提示等软空结果（对齐 Legado toast）
    if (!append && !items.length && r.message?.trim()) {
      exploreError.value = r.message.trim();
      exploreHasMore.value = false;
      exploreBooks.value = [];
      exploreLoadedPage.value = capturedPage;
      return;
    }
    exploreError.value = "";
    if (append) {
      const seen = new Set(exploreBooks.value.map((b) => b.id));
      const merged = [...exploreBooks.value];
      let added = 0;
      for (const item of items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
          added += 1;
        }
      }
      exploreBooks.value = merged;
      if (items.length === 0 || added === 0) {
        exploreHasMore.value = false;
      } else {
        exploreLoadedPage.value = capturedPage;
        explorePage.value = capturedPage + 1;
        exploreHasMore.value = true;
      }
    } else {
      exploreBooks.value = items;
      exploreLoadedPage.value = capturedPage;
      if (items.length === 0) exploreHasMore.value = false;
      else {
        explorePage.value = capturedPage + 1;
        exploreHasMore.value = true;
      }
    }
  } catch (e) {
    if (isStale()) return;
    const msg = e instanceof Error ? e.message : String(e);
    exploreError.value = msg;
    exploreHasMore.value = false;
  } finally {
    if (seq === exploreRequestSeq) {
      exploreLoading.value = false;
      exploreLoadingMore.value = false;
    }
  }
  // 对齐 Legado ExploreShow：列表撑不满视口（!canScrollVertically）时继续拉下一页
  // （如部分书源发现列表第 1 页仅数本，否则永远无法滚动触发加载）
  if (!isStale() && exploreHasMore.value && exploreBooks.value.length) {
    await nextTick();
    await maybeAutoFillExplore(seq);
  }
}

/**
 * 内容高度不足以出现纵向滚动时自动加载更多（对齐 Legado
 * `!recyclerView.canScrollVertically(1) → scrollToBottom`）。
 */
async function maybeAutoFillExplore(seq: number) {
  if (seq !== exploreRequestSeq) return;
  if (!exploreShow.value || !exploreHasMore.value) return;
  if (exploreLoading.value || exploreLoadingMore.value) return;
  const el = exploreBodyRef.value;
  if (!el) return;
  // 再等一帧：VirtualList 量完行高后再判断是否可滚动
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (seq !== exploreRequestSeq) return;
  if (el.scrollHeight > el.clientHeight + 48) return;
  await loadExplorePage(true, seq);
}

function onExploreScroll(ev: Event) {
  const el = ev.target as HTMLElement;
  if (
    !exploreShow.value ||
    exploreLoading.value ||
    exploreLoadingMore.value ||
    !exploreHasMore.value
  ) {
    return;
  }
  // 撑不满视口：与滚到底部一样继续加载（对齐 Legado）
  if (el.scrollHeight <= el.clientHeight + 48) {
    void loadExplorePage(true);
    return;
  }
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
    void loadExplorePage(true);
  }
}

function backFromExplore() {
  bumpExploreRequestSeq();
  explorePaneOpen.value = false;
  exploreLoading.value = false;
  exploreLoadingMore.value = false;
}

async function onRefreshExplore() {
  if (!exploreShow.value || exploreLoading.value || exploreRefreshing.value) {
    return;
  }
  const seq = bumpExploreRequestSeq();
  exploreBooks.value = [];
  explorePage.value = 1;
  exploreLoadedPage.value = 1;
  exploreHasMore.value = true;
  exploreError.value = "";
  exploreLogs.value = [];
  exploreLoadingMore.value = false;
  if (exploreBodyRef.value) exploreBodyRef.value.scrollTop = 0;
  exploreRefreshing.value = true;
  try {
    await loadExplorePage(false, seq);
  } finally {
    exploreRefreshing.value = false;
  }
}

async function onSetExplorePage() {
  if (!exploreShow.value || exploreLoading.value || exploreRefreshing.value) {
    return;
  }
  const input = await appPrompt("输入要跳转的页码", {
    title: "",
    defaultValue: String(exploreLoadedPage.value || 1),
    placeholder: "例如 1",
    inputType: "number",
  });
  if (input == null) return;
  const page = Math.floor(Number(String(input).trim()));
  if (!Number.isFinite(page) || page < 1) {
    return;
  }
  const seq = bumpExploreRequestSeq();
  exploreBooks.value = [];
  explorePage.value = page;
  exploreLoadedPage.value = page;
  exploreHasMore.value = true;
  exploreError.value = "";
  exploreLogs.value = [];
  exploreLoadingMore.value = false;
  if (exploreBodyRef.value) exploreBodyRef.value.scrollTop = 0;
  exploreRefreshing.value = true;
  try {
    await loadExplorePage(false, seq);
  } finally {
    exploreRefreshing.value = false;
  }
}

function onOpenBook(item: SearchBookItem) {
  emit("openBook", item);
}

async function reloadKindsForUrl(url: string) {
  const nextKinds = new Map(kindsByUrl.value);
  nextKinds.delete(url);
  kindsByUrl.value = nextKinds;
  const nextFailed = new Map(kindsFailedByUrl.value);
  nextFailed.delete(url);
  kindsFailedByUrl.value = nextFailed;
  const nextLogs = new Map(kindsLogsByUrl.value);
  nextLogs.delete(url);
  kindsLogsByUrl.value = nextLogs;
  const source = sources.value.find((s) => s.bookSourceUrl === url);
  if (source) await loadKinds(source, true);
}

function onEditSource(source: BookSourceListItem) {
  editingUrl.value = source.bookSourceUrl;
  showEdit.value = true;
}

function onSearchSource(source: BookSourceListItem) {
  emit("searchSource", {
    bookSourceUrl: source.bookSourceUrl,
    bookSourceName: source.bookSourceName,
  });
}

function onSourceMoreClick(source: BookSourceListItem, e: MouseEvent) {
  sourceMoreItem.value = source;
  sourceMoreBtnRef.value = e.currentTarget as HTMLElement;
  void openSourceMoreMenu();
}

function onSourceMoreEdit() {
  const source = sourceMoreItem.value;
  closeSourceMoreMenu();
  sourceMoreItem.value = null;
  if (!source) return;
  onEditSource(source);
}

async function onSourceMorePinTop() {
  const source = sourceMoreItem.value;
  closeSourceMoreMenu();
  sourceMoreItem.value = null;
  if (!source) return;
  await reorderSource(source.bookSourceUrl, "top");
  await refreshSources();
  emit("sourcesChanged");
}

async function onSourceMoreDisableExplore() {
  const item = sourceMoreItem.value;
  closeSourceMoreMenu();
  sourceMoreItem.value = null;
  if (!item) return;
  const source = await getSource(item.bookSourceUrl);
  if (!source) return;
  await saveSource({ ...source, enabledExplore: false });
  if (expandedUrl.value === item.bookSourceUrl) {
    expandedUrl.value = null;
  }
  await refreshSources();
  emit("sourcesChanged");
}

async function onEditDone() {
  const url = editingUrl.value;
  showEdit.value = false;
  editingUrl.value = null;
  await refreshSources();
  if (!url || expandedUrl.value !== url) return;
  await reloadKindsForUrl(url);
}

function onSearchFromEdit(item: {
  bookSourceUrl: string;
  bookSourceName: string;
}) {
  showEdit.value = false;
  editingUrl.value = null;
  emit("searchSource", item);
}

watch(
  () => props.active,
  (on) => {
    if (on) void refreshSources();
    else closeSourceMoreMenu();
  },
  { immediate: true },
);

watch(expandedUrl, () => {
  closeSourceMoreMenu();
  sourceMoreItem.value = null;
});

defineExpose({ refreshSources });
</script>

<template>
  <div class="findDiscoverShell">
    <div
      v-show="showExploreList && exploreShow"
      class="findDiscoverExplorePane"
      :class="{ 'findDiscoverExplorePane--shadow': showExploreList && exploreShow }"
    >
      <header class="findDiscoverSubHead">
        <IconButton
          class="findDiscoverBackBtn"
          :icon-html="icons.back"
          title="返回"
          aria-label="返回"
          @click="backFromExplore"
        />
        <nav v-if="exploreShow" class="findDiscoverBreadcrumb" aria-label="发现分类">
          <span class="findDiscoverBreadcrumbSource">{{ exploreShow.sourceName }}</span>
          <span class="findDiscoverBreadcrumbSep" aria-hidden="true">/</span>
          <span class="findDiscoverBreadcrumbCurrent">{{ exploreShow.kindTitle }}</span>
        </nav>
        <div class="findDiscoverSubHeadActions">
          <IconButton
            v-if="showExploreLogBtn"
            class="findDiscoverSubLogBtn"
            :icon-html="icons.info"
            title="日志"
            aria-label="日志"
            @click="onShowExploreLogs"
          />
          <IconButton
            title="刷新"
            aria-label="刷新"
            :disabled="exploreLoading || !exploreShow"
            :aria-busy="exploreRefreshing || undefined"
            @click="onRefreshExplore"
          >
            <RefreshIcon :spinning="exploreRefreshing" />
          </IconButton>
          <button
            type="button"
            class="findDiscoverPageBtn"
            title="设置页数"
            aria-label="设置页数"
            :disabled="exploreLoading || exploreRefreshing || !exploreShow"
            @click="onSetExplorePage"
          >
            第 {{ exploreLoadedPage }} 页
          </button>
        </div>
      </header>
      <div class="findDiscoverExploreBodyWrap">
        <BookSourceCenterState v-if="exploreLoading">
          <span class="findDiscoverLoadingHint">加载中<LoadingDotsBounce /></span>
        </BookSourceCenterState>
        <BookSourceCenterState v-else-if="exploreError" error>
          加载失败
        </BookSourceCenterState>
        <BookSourceCenterState v-else-if="!exploreBooks.length">
          暂无书籍
        </BookSourceCenterState>
        <div
          v-else
          ref="exploreBodyRef"
          class="findDiscoverExploreBody"
          @scroll="onExploreScroll"
        >
          <div class="findBookResults">
            <VirtualList
              class="findBookResultsVirtual"
              role="list"
              :item-count="exploreBooks.length"
              :row-stride="FIND_BOOK_LIST_ROW_STRIDE"
              :overscan="6"
              :external-scroll-el="exploreBodyRef"
              :item-key="(i) => exploreBooks[i]?.id ?? i"
              @visible-indices="onExploreVisibleIndices"
            >
              <template #default="{ index }">
                <FindBookListItem
                  v-if="exploreBooks[index]"
                  :item="exploreBooks[index]"
                  :show-origin="false"
                  :cover-url="getCoverUrl(exploreBooks[index]!) ?? ''"
                  :cover-pending="isCoverPending(exploreBooks[index]!)"
                  @click="onOpenBook"
                />
              </template>
            </VirtualList>
            <div
              v-if="exploreLoadingMore"
              class="findBookResultsLoading"
              aria-live="polite"
            >
              加载中<LoadingDotsBounce />
            </div>
            <p
              v-else-if="exploreBooks.length && !exploreHasMore"
              class="findDiscoverHint"
            >
              没有更多了
            </p>
          </div>
        </div>
      </div>
    </div>

    <div ref="discoverBodyRef" v-show="!showExploreList" class="findDiscoverBody">
        <div v-if="!filteredSources.length" class="findBookEmpty">
          <p class="findBookEmptyIcon">(; '⌒' )</p>
          <p class="findBookEmptyText">没有可用发现源哦</p>
        </div>
        <ul v-else class="findDiscoverSourceList">
          <li
            v-for="source in filteredSources"
            :key="source.bookSourceUrl"
            :ref="(el) => setSourceItemEl(source.bookSourceUrl, el as Element | null)"
            class="findDiscoverSource"
          >
            <div class="findDiscoverSourceCard">
              <div
                class="findDiscoverSourceHead"
                role="button"
                tabindex="0"
                @click="toggleExpand(source)"
                @keydown.enter.prevent="toggleExpand(source)"
              >
                <span class="findDiscoverSourceName">{{ source.bookSourceName }}</span>
                <div class="findDiscoverSourceHeadEnd">
                  <IconButton
                    v-if="showKindsLogBtn(source.bookSourceUrl)"
                    class="findDiscoverSourceBtn"
                    :class="{
                      'findDiscoverSourceBtn--warning': kindsParseFailed(
                        source.bookSourceUrl,
                      ),
                    }"
                    :icon-html="icons.info"
                    title="日志"
                    aria-label="日志"
                    @click.stop="onShowKindsLogs(source.bookSourceUrl)"
                  />
                  <div
                    class="findDiscoverSourceActions"
                    :class="{
                      'findDiscoverSourceActions--visible':
                        expandedUrl === source.bookSourceUrl ||
                        (sourceMoreOpen &&
                          sourceMoreItem?.bookSourceUrl === source.bookSourceUrl),
                    }"
                  >
                    <IconButton
                      :icon-html="icons.find"
                      title="搜索"
                      aria-label="搜索"
                      class="findDiscoverSourceBtn"
                      @click.stop="onSearchSource(source)"
                    />
                    <IconButton
                      :icon-html="icons.more"
                      title="更多"
                      aria-label="更多"
                      aria-haspopup="menu"
                      :aria-expanded="
                        sourceMoreOpen &&
                        sourceMoreItem?.bookSourceUrl === source.bookSourceUrl
                      "
                      class="findDiscoverSourceBtn"
                      :active="
                        sourceMoreOpen &&
                        sourceMoreItem?.bookSourceUrl === source.bookSourceUrl
                      "
                      :pressed="
                        sourceMoreOpen &&
                        sourceMoreItem?.bookSourceUrl === source.bookSourceUrl
                      "
                      @click.stop="onSourceMoreClick(source, $event)"
                    />
                  </div>
                  <span
                    class="findDiscoverSourceArrow"
                    :class="{
                      'findDiscoverSourceArrow--open':
                        expandedUrl === source.bookSourceUrl,
                    }"
                    aria-hidden="true"
                    v-html="icons.foldChevron"
                  />
                </div>
              </div>
              <div
                v-if="expandedUrl === source.bookSourceUrl"
                class="findDiscoverKinds"
              >
                <p v-if="kindsLoading === source.bookSourceUrl" class="findDiscoverKindsHint">
                  加载分类…
                </p>
                <p
                  v-else-if="kindsParseFailed(source.bookSourceUrl)"
                  class="findDiscoverKindsHint findDiscoverKindsHint--error"
                >
                  分类加载失败
                </p>
                <p
                  v-else-if="!(kindsByUrl.get(source.bookSourceUrl) ?? []).length"
                  class="findDiscoverKindsHint"
                >
                  暂无分类
                </p>
                <template v-else>
                  <template
                    v-for="(kind, idx) in kindsByUrl.get(source.bookSourceUrl) ?? []"
                    :key="`${kind.title}-${idx}`"
                  >
                    <div v-if="!kind.url?.trim()" class="findDiscoverKindSection">
                      {{ kind.title }}
                    </div>
                    <button
                      v-else
                      type="button"
                      class="findDiscoverKindChip"
                      :style="kindChipStyle(kind)"
                      @click="onKindClick(source, kind)"
                    >
                      {{ kind.title }}
                    </button>
                  </template>
                </template>
              </div>
            </div>
          </li>
        </ul>
    </div>

    <AppShellMenuTeleport
      v-model:open="sourceMoreOpen"
      :left="sourceMoreLeft"
      :top="sourceMoreTop"
      caret="end"
      :on-panel-mount="bindSourceMorePanel"
    >
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onSourceMoreEdit"
      >
        <span class="appShellMenuLabel">编辑书源</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onSourceMorePinTop"
      >
        <span class="appShellMenuLabel">置顶</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem appShellMenuItem--danger"
        role="menuitem"
        @click="onSourceMoreDisableExplore"
      >
        <span class="appShellMenuLabel">禁用发现</span>
      </button>
    </AppShellMenuTeleport>

    <EditBookSourcePanel
      v-model="showEdit"
      :source-url="editingUrl"
      initial-tab="explore"
      @done="onEditDone"
      @search-source="onSearchFromEdit"
    />
  </div>
</template>

<style scoped>
.findDiscoverShell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
}
.findDiscoverExplorePane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.findDiscoverExploreBodyWrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg);
}
.findDiscoverLoadingHint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.findDiscoverBody,
.findDiscoverExploreBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--bg);
}
.findDiscoverBody {
  display: flex;
  flex-direction: column;
}
.findDiscoverHint {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  padding: 24px 0;
  margin: 0;
}
.findDiscoverSourceList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.findDiscoverSource {
  margin: 0;
}
.findDiscoverSourceCard {
  display: flex;
  flex-direction: column;
  background: var(--panel);
}
.findDiscoverSourceCard:has(.findDiscoverKinds) {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.findDiscoverSourceHead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  /* cursor: pointer; */
  user-select: none;
  transition: background 0.12s ease;
}
.findDiscoverSourceCard:has(.findDiscoverKinds) .findDiscoverSourceHead {
  border: none;
  border-radius: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
}
.findDiscoverSourceHead:hover,
.findDiscoverSourceCard:has(.findDiscoverKinds) .findDiscoverSourceHead {
  background: var(--icon-btn-bg-hover);
}
.findDiscoverSourceHeadEnd {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: auto;
}
.findDiscoverSourceActions {
  display: none;
  align-items: center;
  gap: 10px;
}
/* 仅 hover 或按钮自身聚焦时显示；勿用 head:focus-within（点击收起会留焦导致常显） */
.findDiscoverSourceHead:hover .findDiscoverSourceActions,
.findDiscoverSourceActions:focus-within,
.findDiscoverSourceActions--visible {
  display: flex;
}
.findDiscoverSourceBtn {
  width: 26px;
  height: 26px;
  background: transparent !important;
}
.findDiscoverSourceBtn:hover :deep(.icon),
.findDiscoverSourceBtn.active :deep(.icon) {
  color: var(--accent) !important;
}
.findDiscoverSourceBtn--warning :deep(.icon),
.findDiscoverSourceBtn--warning :deep(svg path) {
  color: var(--warning) !important;
}
.findDiscoverSourceBtn--warning:hover :deep(.icon),
.findDiscoverSourceBtn--warning:hover :deep(svg path) {
  color: var(--warning-hover) !important;
}
.findDiscoverSourceName {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
}
.findDiscoverSourceCard:has(.findDiscoverKinds) .findDiscoverSourceName {
  font-weight: 600;
}
.findDiscoverSourceArrow {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, var(--muted) 85%, var(--fg));
  transform: rotate(-90deg);
  transition: transform 0.22s ease;
}
.findDiscoverSourceArrow :deep(svg) {
  width: 10px;
  height: 10px;
  display: block;
}
.findDiscoverSourceArrow :deep(svg path) {
  fill: currentColor;
}
.findDiscoverSourceArrow--open {
  transform: rotate(0deg);
}
.findDiscoverKinds {
  display: flex;
  flex-wrap: wrap;
  padding: 10px;
  background: var(--panel);
}
.findDiscoverKindsHint {
  flex: 1 1 100%;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  padding: 4px;
  margin: 0;
}
.findDiscoverKindsHint--error {
  color: var(--fg);
}
.findDiscoverKindSection {
  flex: 0 1 100%;
  box-sizing: border-box;
  width: 100%;
  margin: 3px;
  text-align: center;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.findDiscoverKindChip {
  box-sizing: border-box;
  min-width: 0;
  margin: 3px;
  padding: 4px 12px;
  border: none;
  border-radius: 16px;
  background: var(--btn-bg);
  color: var(--fg);
  font-size: 14px;
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  transition: background 0.12s ease, color 0.12s ease;
  /* 作为 flex 子项时占满分配宽度 */
  align-self: stretch;
}
.findDiscoverKindChip:hover {
  background: color-mix(in srgb, var(--accent) 18%, var(--btn-bg, rgba(0, 0, 0, 0.06)));
  color: var(--accent);
}
.findDiscoverSubHead {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
}
.findDiscoverBackBtn {
  flex-shrink: 0;
}
.findDiscoverBreadcrumb {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.4;
}
.findDiscoverBreadcrumbSource {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  user-select: none;
}
.findDiscoverBreadcrumbSep {
  margin: 0 8px;
  color: var(--muted);
  flex-shrink: 0;
  user-select: none;
}
.findDiscoverBreadcrumbCurrent {
  color: var(--fg);
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.findDiscoverSubHeadActions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-left: auto;
  flex-shrink: 0;
}
.findDiscoverPageBtn {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--btn-bg, transparent);
  color: var(--fg);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.findDiscoverPageBtn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 12%, var(--btn-bg, transparent));
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
}
.findDiscoverPageBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.findDiscoverSubLogBtn {
  flex-shrink: 0;
}
</style>
