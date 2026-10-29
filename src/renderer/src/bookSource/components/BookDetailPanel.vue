<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppModal from "../../components/AppModal.vue";
import AppContextMenu from "../../components/AppContextMenu.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import CategoryPickerMenu from "../../components/CategoryPickerMenu.vue";
import IconButton from "../../components/IconButton.vue";
import RefreshIcon from "../../components/RefreshIcon.vue";
import VirtualList from "../../components/VirtualList.vue";
import LoadingDotsBounce from "../../components/LoadingDotsBounce.vue";
import LoadingDotsRotate from "../../components/LoadingDotsRotate.vue";
import DefaultBookCover from "./DefaultBookCover.vue";
import BookSourceCenterState from "./BookSourceCenterState.vue";
import EditBookSourcePanel from "./EditBookSourcePanel.vue";
import BookSourceLoginPanel from "./BookSourceLoginPanel.vue";
import ReaderImageLightbox from "../../components/ReaderImageLightbox.vue";
import { icons } from "../../icons";
import {
  useBookSourceDetail,
  useBookSourceDownload,
} from "../composables/useBookSource";
import type {
  BookChapter,
  Book,
  BookSourceRecord,
  SearchBookItem,
} from "@shared/bookSource/types";
import { appLog, appPrompt } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import { useFindBookBookshelf } from "../composables/useFindBookBookshelf";
import { useFindBookSettings } from "../composables/useFindBookSettings";
import { useChapterCacheMarks } from "../composables/useChapterCacheMarks";
import { confirmClearBookChapterCache } from "../services/clearBookChapterCache";
import { sortContentChaptersDisplay } from "../sortContentChaptersDisplay";
import {
  bookshelfBookKey,
  updateFindBookBookshelfBookInfo,
} from "../findBookBookshelf";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import {
  formatBookAuthor,
  formatBookIntroForDisplay,
  getBookKindList,
} from "../bookSourceDisplay";
import { resolveFirstChapterContentIndex } from "../chapterReadingOrder";
import { resolveLatestChapterTitleFromToc } from "../findBookshelfDisplay";
import type { BookSourceEditTab } from "../editBookSourceFields";
import type { FileCategoryDefinition } from "../../constants/fileCategories";
import { loadBookshelfCategoryCatalog } from "../findBookshelfCategory";

/** 与 .bookDetailChapterItem 固定行高一致（外层滚动虚拟列表） */
const CHAPTER_ROW_STRIDE = 40;
/** 章名下有 tag（updateTime）时两行展示的行距 */
const CHAPTER_ROW_STRIDE_WITH_TAG = 56;

const props = withDefaults(
  defineProps<{
    item: SearchBookItem | null;
    downloadDir: string;
    cacheDir: string;
    /** 与书架分类目录共用；不传则从书架分类存储读取 */
    categoryCatalog?: FileCategoryDefinition[];
  }>(),
  {
    categoryCatalog: undefined,
  },
);

const emit = defineEmits<{
  fileDownloaded: [filePath: string, size: number];
  readChapter: [payload: { index: number; detail: Book; chapters: BookChapter[] }];
  chapterCacheCleared: [];
  /** 限定该书源搜索 */
  searchSource: [item: { bookSourceUrl: string; bookSourceName: string }];
}>();

const modelValue = defineModel<boolean>({ default: false });

const coverFailed = ref(false);
const coverLightboxSrc = ref("");
const chapterSortDesc = ref(false);
const findBookSettings = useFindBookSettings();
const showChapterTag = findBookSettings.showChapterTag;
const showEdit = ref(false);
const editingUrl = ref<string | null>(null);
const showLogin = ref(false);
const loginSource = ref<BookSourceRecord | null>(null);
/** 当前书源是否配置了 loginUrl */
const sourceNeedsLogin = ref(false);
/** 用户点击顶栏「刷新」触发的加载（用于图标旋转，不含初次进入） */
const refreshing = ref(false);
const editInitialTab = ref<BookSourceEditTab>("detail");
const detailScrollEl = ref<HTMLElement | null>(null);
const moreBtnRef = ref<HTMLElement | null>(null);
const moreMenu = useAnchoredAppShellMenu({
  anchor: moreBtnRef,
  placement: "below-end",
  widthPx: 200,
  gap: 6,
});
const {
  open: moreOpen,
  left: moreLeft,
  top: moreTop,
  toggleMenu: toggleMoreMenu,
  closeMenu: closeMoreMenu,
  panelRef: morePanelRef,
} = moreMenu;

function bindMorePanel(el: HTMLElement | null) {
  morePanelRef.value = el;
}

const bookDetailMetaEl = ref<HTMLElement | null>(null);
const metaContextMenuOpen = ref(false);
const metaContextMenuX = ref(0);
const metaContextMenuY = ref(0);
const metaContextMenuHasSelection = ref(false);

const metaContextMenuItems = computed(() => [
  {
    id: "copy",
    label: "复制",
    disabled: !metaContextMenuHasSelection.value,
  },
  { id: "sep-select-all", separator: true as const },
  { id: "selectAll", label: "全选" },
]);

function metaHasTextSelection(): boolean {
  const el = bookDetailMetaEl.value;
  const sel = window.getSelection();
  if (!el || !sel || sel.isCollapsed || !sel.toString()) return false;
  return (
    !!sel.anchorNode &&
    !!sel.focusNode &&
    el.contains(sel.anchorNode) &&
    el.contains(sel.focusNode)
  );
}

function onMetaContextMenu(ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  metaContextMenuHasSelection.value = metaHasTextSelection();
  metaContextMenuX.value = ev.clientX;
  metaContextMenuY.value = ev.clientY;
  metaContextMenuOpen.value = true;
}

function closeMetaContextMenu() {
  metaContextMenuOpen.value = false;
}

function onMetaContextMenuSelect(id: string) {
  closeMetaContextMenu();
  const el = bookDetailMetaEl.value;
  if (!el) return;
  if (id === "selectAll") {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return;
  }
  if (id === "copy") {
    if (!metaHasTextSelection()) return;
    document.execCommand("copy");
  }
}

const { loading, error, logs, detail, chapters, load, reset } =
  useBookSourceDetail();
const { downloading, downloadProgress, download, cancel } =
  useBookSourceDownload();

const contentChapterList = computed(() =>
  chapters.value.filter((ch) => !ch.isVolume),
);

const {
  refresh: refreshChapterCacheStatus,
  markCached: markChapterCached,
  clearLocal: clearChapterCacheMarks,
  isCached: isChapterCached,
} = useChapterCacheMarks({
  bookName: () => detail.value?.name ?? props.item?.name ?? "",
  bookUrl: () => detail.value?.bookUrl ?? props.item?.bookUrl ?? "",
  chapterUrls: () => contentChapterList.value.map((ch) => ch.url),
  cacheDir: () => props.cacheDir,
});

/** 下载中、尚未写入缓存集合的当前章 */
function isChapterDownloading(ch: BookChapter | undefined): boolean {
  if (!downloading.value || !ch?.url) return false;
  if (downloadProgress.value.chapterUrl !== ch.url) return false;
  return !isChapterCached(ch);
}

defineExpose({
  refreshChapterCacheStatus,
  clearChapterCacheMarks,
  bringToFront: () => {
    modalRef.value?.bringToFront?.();
  },
});

const modalRef = ref<InstanceType<typeof AppModal> | null>(null);

const downloadProgressPercent = computed(() => {
  const { current, total } = downloadProgress.value;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((current / total) * 100));
});
const downloadProgressLabel = computed(() => {
  const { current, total } = downloadProgress.value;
  return `${current}/${total}，${downloadProgressPercent.value}%`;
});

/** 与搜索/阅读器日志入口一致：有失败态或日志含错误时高亮 */
const detailLogHasError = computed(() => {
  if (error.value?.trim()) return true;
  return logs.value.some((line) => /错误|失败|异常/.test(line));
});

/** 有日志或错误时才显示顶栏「日志」按钮 */
const showDetailLogBtn = computed(
  () => Boolean(error.value?.trim()) || logs.value.length > 0,
);

watch(
  () => props.item?.origin?.trim() ?? "",
  async (origin) => {
    if (!origin) {
      sourceNeedsLogin.value = false;
      return;
    }
    try {
      const source = await window.colorTxt.bookSourceGet(origin);
      sourceNeedsLogin.value = Boolean(source?.loginUrl?.trim());
    } catch {
      sourceNeedsLogin.value = false;
    }
  },
  { immediate: true },
);

const displayItem = computed(() => props.item);
const displayName = computed(() => detail.value?.name ?? props.item?.name ?? "");
const displayAuthor = computed(
  () => detail.value?.author ?? props.item?.author ?? "",
);
const displayIntro = computed(() =>
  formatBookIntroForDisplay(detail.value?.intro ?? props.item?.intro),
);
const displayCover = computed(() => {
  if (detail.value?.coverUrl) return detail.value.coverUrl;
  return props.item?.coverUrl ?? "";
});
const displayLastChapter = computed(() => {
  const raw = detail.value?.lastChapter ?? props.item?.lastChapter ?? "";
  return raw
    .replace(/[·•][^\n]*$/, "")
    .replace(
      /\s+(?:\d+\s*(?:分钟|小时|天|周|个月|月|年)前|刚刚|\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$/u,
      "",
    )
    .trim();
});
const latestChapterIsVip = computed(() => {
  const list = chapters.value.filter((ch) => !ch.isVolume);
  if (!list.length) return false;
  // 目录数组始终「最新在前」，与展示排序无关
  const ch = list[0];
  return Boolean(ch?.isVip || ch?.isPay);
});
const latestChapterIsPay = computed(() => {
  const list = chapters.value.filter((ch) => !ch.isVolume);
  return Boolean(list[0]?.isPay);
});
const displayUpdateTime = computed(() => detail.value?.updateTime ?? "");
const kindTags = computed(() => {
  const wc =
    detail.value?.wordCount?.trim() || props.item?.wordCount?.trim() || undefined;
  return getBookKindList({
    kind: detail.value?.kind ?? props.item?.kind,
    wordCount: wc,
  });
});
const showUpdateTimeLine = computed(() => {
  const ut = displayUpdateTime.value.trim();
  if (!ut) return false;
  return !kindTags.value.some((t) => t === ut || t.replace(/-/g, "/") === ut.replace(/-/g, "/"));
});
const displayChapters = computed(() =>
  sortContentChaptersDisplay(contentChapterList.value, chapterSortDesc.value),
);
const hasChapterTags = computed(() =>
  displayChapters.value.some((ch) => Boolean(ch.tag?.trim())),
);
const chapterRowStride = computed(() =>
  showChapterTag.value && hasChapterTags.value
    ? CHAPTER_ROW_STRIDE_WITH_TAG
    : CHAPTER_ROW_STRIDE,
);
const chapterCount = computed(() => displayChapters.value.length);
const breadcrumbSourceName = computed(
  () => displayItem.value?.originName?.trim() ?? "",
);

const {
  books,
  toggle: toggleBookshelf,
  updateReadProgress,
  applyBooks,
  setCategory,
} = useFindBookBookshelf();

const inBookshelf = computed(() => {
  const item = props.item;
  if (!item) return false;
  const key = bookshelfBookKey(item.bookUrl, item.origin);
  return books.value.some(
    (b) => bookshelfBookKey(b.bookUrl, b.origin) === key,
  );
});

const bookshelfEntry = computed(() => {
  const item = props.item;
  if (!item) return null;
  const key = bookshelfBookKey(item.bookUrl, item.origin);
  return (
    books.value.find((b) => bookshelfBookKey(b.bookUrl, b.origin) === key) ??
    null
  );
});

const resolvedCategoryCatalog = computed(() =>
  props.categoryCatalog ?? loadBookshelfCategoryCatalog(),
);

const categoryMenuCounts = computed(() => {
  const files = books.value;
  let uncategorized = 0;
  const byName: Record<string, number> = {};
  for (const c of resolvedCategoryCatalog.value) {
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

const categoryBtnRef = ref<HTMLElement | null>(null);
const categoryPickerOpen = ref(false);
const categoryPickX = ref(0);
const categoryPickY = ref(0);

const bookshelfCategoryLabel = computed(() => {
  const name = (bookshelfEntry.value?.category ?? "").trim();
  return name || "未分类";
});

function onCategoryBtnClick(ev: MouseEvent) {
  ev.preventDefault();
  if (!inBookshelf.value) return;
  const btn = categoryBtnRef.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  categoryPickX.value = r.left;
  categoryPickY.value = r.top;
  categoryPickerOpen.value = true;
}

function onCategoryPicked(name: string) {
  const item = props.item;
  if (!item) return;
  setCategory(item.bookUrl, item.origin, name);
  categoryPickerOpen.value = false;
}


const hasBookshelfReadProgress = computed(() => {
  if (!inBookshelf.value) return false;
  const idx = bookshelfEntry.value?.lastReadChapterIndex;
  const n = contentChapterList.value.length;
  return (
    typeof idx === "number" &&
    Number.isFinite(idx) &&
    idx >= 0 &&
    idx < n
  );
});

/** 最后阅读章节（content 数组下标对应的章） */
const lastReadChapter = computed(() => {
  if (!hasBookshelfReadProgress.value) return null;
  const idx = bookshelfEntry.value!.lastReadChapterIndex!;
  return contentChapterList.value[idx] ?? null;
});

const lastReadChapterTitleLabel = computed(() => {
  if (!hasBookshelfReadProgress.value) return "";
  const stored = bookshelfEntry.value?.lastReadChapterTitle?.trim();
  if (stored) return stored;
  return lastReadChapter.value?.title?.trim() || "";
});

const readActionLabel = computed(() =>
  hasBookshelfReadProgress.value ? "继续阅读" : "开始阅读",
);

function isLastReadChapter(ch: BookChapter | undefined): boolean {
  const last = lastReadChapter.value;
  return Boolean(ch?.url && last?.url && ch.url === last.url);
}

const canStartReading = computed(
  () => Boolean(detail.value && contentChapterList.value.length),
);

function buildShelfItem(): SearchBookItem | null {
  const item = props.item;
  if (!item) return null;
  // 有目录时用最新章标题入库（对齐 Legado）
  const tocLatest = resolveLatestChapterTitleFromToc(chapters.value);
  const variable = {
    ...(item.variable ?? {}),
    ...(detail.value?.variable ?? {}),
  };
  return {
    ...item,
    name: displayName.value,
    author: displayAuthor.value,
    intro: detail.value?.intro ?? item.intro,
    coverUrl: displayCover.value || item.coverUrl,
    coverSourceUrl: detail.value?.coverSourceUrl ?? item.coverSourceUrl,
    lastChapter: tocLatest || displayLastChapter.value || item.lastChapter,
    kind: detail.value?.kind ?? item.kind,
    wordCount: detail.value?.wordCount ?? item.wordCount,
    ...(Object.keys(variable).length ? { variable } : {}),
  };
}

function onToggleBookshelf() {
  const item = buildShelfItem();
  if (!item) return;
  const added = toggleBookshelf(item, {
    updateTime: detail.value?.updateTime?.trim() || undefined,
  });
  // 放入时同步目录缓存，触发 lastChapter 写回最新章标题（对齐 Legado）
  if (added && chapters.value.length && item.bookUrl && item.origin) {
    const next = updateFindBookBookshelfBookInfo(item.bookUrl, item.origin, {
      tocUrl: detail.value?.tocUrl,
      chapters: chapters.value,
      lastChapter: item.lastChapter,
      variable: detail.value?.variable,
    });
    if (next) applyBooks(next);
  }
  appToast(added ? "已放入书架" : "已从书架移除", { kind: added ? "success" : "info" });
}

const displayBookUrl = computed(
  () => detail.value?.bookUrl?.trim() ?? displayItem.value?.bookUrl?.trim() ?? "",
);

const displayTocUrl = computed(() => detail.value?.tocUrl?.trim() ?? "");

function formatVariableComment(
  sourceComment: string | undefined,
  fallback: string,
): string {
  const c = sourceComment?.trim();
  return c ? `${c}\n${fallback}` : fallback;
}

async function copyText(label: string, text: string) {
  const value = text.trim();
  if (!value) {
    appToast(`${label}为空`, { kind: "warning" });
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    appToast(`已复制${label}`, { kind: "success", duration: 1200 });
  } catch {
    appToast(`复制${label}失败`, { kind: "warning" });
  }
}

async function onRefresh() {
  closeMoreMenu();
  const item = props.item;
  if (!item || loading.value || refreshing.value) return;
  coverFailed.value = false;
  refreshing.value = true;
  try {
    await load(item);
  } finally {
    refreshing.value = false;
  }
}

async function onLogin() {
  const origin = displayItem.value?.origin?.trim();
  if (!origin) {
    appToast("书源不存在", { kind: "warning" });
    return;
  }
  const source = await window.colorTxt.bookSourceGet(origin);
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

async function onCopyBookUrl() {
  closeMoreMenu();
  await copyText("书籍 URL", displayBookUrl.value);
}

async function onCopyTocUrl() {
  closeMoreMenu();
  await copyText("目录 URL", displayTocUrl.value);
}

async function onSetSourceVariable() {
  closeMoreMenu();
  const item = displayItem.value;
  if (!item?.origin?.trim()) {
    appToast("书源不存在", { kind: "warning" });
    return;
  }
  const source = await window.colorTxt.bookSourceGet(item.origin);
  if (!source) {
    appToast("书源不存在", { kind: "warning" });
    return;
  }
  const current = await window.colorTxt.bookSourceGetSourceVariable(item.origin);
  const comment = formatVariableComment(
    source.variableComment,
    "源变量可在 js 中通过 <code>source.getVariable()</code> 获取",
  );
  const next = await appPrompt(comment, {
    title: "设置源变量",
    defaultValue: current,
    multiline: true,
    dangerouslyUseHTMLString: true,
  });
  if (next == null) return;
  await window.colorTxt.bookSourceSetSourceVariable(item.origin, next);
  appToast("源变量已保存", { kind: "success", duration: 1200 });
}

async function onSetBookVariable() {
  closeMoreMenu();
  const bookUrl = displayBookUrl.value;
  if (!bookUrl) {
    appToast("书籍 URL 为空", { kind: "warning" });
    return;
  }
  const item = displayItem.value;
  const source = item?.origin
    ? await window.colorTxt.bookSourceGet(item.origin)
    : null;
  const current = await window.colorTxt.bookSourceGetBookVariable(bookUrl);
  const comment = formatVariableComment(
    source?.variableComment,
    '书籍变量可在 js 中通过 <code>book.getVariable("custom")</code> 获取',
  );
  const next = await appPrompt(comment, {
    title: "设置书籍变量",
    defaultValue: current,
    multiline: true,
    dangerouslyUseHTMLString: true,
  });
  if (next == null) return;
  await window.colorTxt.bookSourceSetBookVariable(bookUrl, next);
  appToast("书籍变量已保存", { kind: "success", duration: 1200 });
}

function onEditBookSource() {
  closeMoreMenu();
  const origin = displayItem.value?.origin?.trim();
  if (!origin) {
    appToast("书源不存在", { kind: "warning" });
    return;
  }
  editingUrl.value = origin;
  editInitialTab.value = "detail";
  showEdit.value = true;
}

async function onClearChapterCache() {
  closeMoreMenu();
  const bookUrl = detail.value?.bookUrl?.trim() || props.item?.bookUrl?.trim();
  if (!bookUrl) {
    appToast("书籍 URL 为空", { kind: "warning" });
    return;
  }
  const name = detail.value?.name?.trim() || props.item?.name?.trim() || "";
  const cleared = await confirmClearBookChapterCache({
    name,
    bookUrl,
    cacheDir: props.cacheDir,
  });
  if (!cleared) return;
  clearChapterCacheMarks();
  emit("chapterCacheCleared");
}

function onEditDone() {
  showEdit.value = false;
  editingUrl.value = null;
}

function onSearchFromEdit(item: {
  bookSourceUrl: string;
  bookSourceName: string;
}) {
  showEdit.value = false;
  editingUrl.value = null;
  emit("searchSource", item);
}

function buildDetailLogLinks(): string[] {
  const item = displayItem.value;
  if (!item) return [];
  const lines: string[] = [];
  const sourceName = item.originName?.trim();
  const sourceUrl = item.origin?.trim();
  if (sourceName || sourceUrl) {
    lines.push(
      sourceUrl
        ? `书源：${sourceName ?? "未知"}\n${sourceUrl}`
        : `书源：${sourceName}`,
    );
  }
  const bookUrl = detail.value?.bookUrl ?? item.bookUrl;
  if (bookUrl?.trim()) lines.push(`书籍链接：\n${bookUrl.trim()}`);
  const tocUrl = detail.value?.tocUrl?.trim();
  if (tocUrl) lines.push(`目录链接：\n${tocUrl}`);
  return lines;
}

const showDefaultCover = computed(
  () => !displayCover.value || coverFailed.value,
);

watch(
  () => [modelValue.value, props.item?.id] as const,
  ([open, id]) => {
    if (!open || !id || !props.item) {
      if (!open) {
        reset();
        clearChapterCacheMarks();
      }
      return;
    }
    coverFailed.value = false;
    chapterSortDesc.value = false;
    void load(props.item);
  },
);

watch(modelValue, (open) => {
  if (!open) {
    coverFailed.value = false;
    coverLightboxSrc.value = "";
    return;
  }
  void refreshChapterCacheStatus();
});

function openCoverLightbox() {
  if (showDefaultCover.value) return;
  const url = displayCover.value.trim();
  if (!url) return;
  coverLightboxSrc.value = url;
}

function onBack() {
  modelValue.value = false;
}

function toggleChapterSort() {
  chapterSortDesc.value = !chapterSortDesc.value;
}

function toggleShowChapterTag() {
  showChapterTag.value = !showChapterTag.value;
  findBookSettings.persistAll();
}

async function onShowLogs() {
  const links = buildDetailLogLinks();
  const linkText = links.length ? links.join("\n\n") : "";
  const runtimeText = logs.value.length ? logs.value.join("\n\n") : "";
  let text = "";
  if (linkText && runtimeText) {
    text = `${linkText}\n\n---\n\n${runtimeText}`;
  } else if (linkText) {
    text = linkText;
  } else if (runtimeText) {
    text = runtimeText;
  } else {
    text = "（暂无运行日志）";
  }
  await appLog(text);
}

function syncBookshelfLastReadTitleFromChapters() {
  const item = props.item;
  const entry = bookshelfEntry.value;
  const list = contentChapterList.value;
  if (!item || !entry || !list.length || entry.lastReadChapterTitle?.trim()) {
    return;
  }
  const idx = entry.lastReadChapterIndex;
  if (typeof idx !== "number" || !Number.isFinite(idx) || idx < 0 || idx >= list.length) {
    return;
  }
  const title = list[idx]?.title?.trim();
  if (!title) return;
  updateReadProgress(item.bookUrl, item.origin, idx, title);
}

watch(contentChapterList, () => {
  syncBookshelfLastReadTitleFromChapters();
  void refreshChapterCacheStatus();
});

watch(
  () => props.cacheDir,
  () => {
    void refreshChapterCacheStatus();
  },
);

watch(
  () =>
    [downloadProgress.value.chapterUrl, downloadProgress.value.current] as const,
  ([url], prev) => {
    if (!downloading.value) return;
    const prevUrl = prev?.[0];
    if (prevUrl && prevUrl !== url) markChapterCached(prevUrl);
  },
);

watch(downloading, (v, was) => {
  if (was && !v) {
    const url = downloadProgress.value.chapterUrl;
    if (url) markChapterCached(url);
  }
});

function onReadChapter(displayIndex: number) {
  if (loading.value || !detail.value || !chapters.value.length) return;
  const ch = displayChapters.value[displayIndex];
  if (!ch) return;
  const contentIndex = contentChapterList.value.findIndex((c) => c.url === ch.url);
  emit("readChapter", {
    index: contentIndex >= 0 ? contentIndex : displayIndex,
    detail: detail.value,
    chapters: chapters.value,
  });
}

function resolveStartContentIndex(): number {
  const list = contentChapterList.value;
  if (!list.length) return 0;
  if (hasBookshelfReadProgress.value) {
    return bookshelfEntry.value!.lastReadChapterIndex!;
  }
  return resolveFirstChapterContentIndex(list);
}

function onStartOrContinueReading() {
  if (loading.value || !detail.value || !contentChapterList.value.length) return;
  const idx = resolveStartContentIndex();
  const item = props.item;
  const ch = contentChapterList.value[idx];
  if (item && inBookshelf.value && ch?.title?.trim()) {
    updateReadProgress(item.bookUrl, item.origin, idx, ch.title.trim());
  }
  emit("readChapter", {
    index: idx,
    detail: detail.value,
    chapters: chapters.value,
  });
}

async function onDownloadOrStop() {
  if (downloading.value) {
    await cancel();
    appToast("已停止下载", { kind: "warning" });
    return;
  }
  const item = props.item;
  const dir = props.downloadDir.trim();
  if (!item || !dir) return;
  const path = await download(item, dir, props.cacheDir.trim() || undefined);
  if (path) {
    const st = await window.colorTxt.stat(path);
    emit("fileDownloaded", path, st?.size ?? 0);
  }
}
</script>

<template>
  <AppModal
    ref="modalRef"
    v-model="modelValue"
    title=""
    fullscreen
    panel-class="bookDetailPanel"
    :mask-closable="false"
    :esc-closable="false"
    :show-close-button="false"
    :body-scroll="false"
  >
    <template #headerPrefix>
      <IconButton
        :icon-html="icons.back"
        title="返回"
        aria-label="返回"
        @click="onBack"
      />
      <nav class="bookDetailBreadcrumb" aria-label="书籍信息">
        <span v-if="breadcrumbSourceName" class="bookDetailBreadcrumbSource">{{
          breadcrumbSourceName
        }}</span>
        <span
          v-if="breadcrumbSourceName"
          class="bookDetailBreadcrumbSep"
          aria-hidden="true"
        >/</span>
        <span class="bookDetailBreadcrumbCurrent">{{ displayName }}</span>
      </nav>
      <div v-if="displayItem" class="bookDetailHeaderActions">
        <IconButton
          v-if="showDetailLogBtn"
          class="bookDetailLogBtn"
          :class="{ 'bookDetailLogBtn--warning': detailLogHasError }"
          :icon-html="icons.info"
          title="日志"
          aria-label="日志"
          @click="onShowLogs"
        />
        <IconButton
          title="刷新"
          aria-label="刷新"
          :disabled="loading || !item"
          :aria-busy="refreshing || undefined"
          @click="onRefresh"
        >
          <RefreshIcon :spinning="refreshing" />
        </IconButton>
        <IconButton
          v-if="sourceNeedsLogin"
          :icon-html="icons.user"
          title="登录"
          aria-label="登录"
          @click="onLogin"
        />
        <div ref="moreBtnRef" class="bookDetailMoreWrap">
          <IconButton
            :icon-html="icons.more"
            :active="moreOpen"
            :pressed="moreOpen"
            title="更多"
            aria-label="更多"
            aria-haspopup="menu"
            :aria-expanded="moreOpen"
            @click="toggleMoreMenu"
          />
        </div>
      </div>
    </template>

    <AppShellMenuTeleport
      v-model:open="moreOpen"
      :left="moreLeft"
      :top="moreTop"
      caret="end"
      :on-panel-mount="bindMorePanel"
    >
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onCopyBookUrl"
      >
        <span class="appShellMenuLabel">复制书籍 URL</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="!displayTocUrl"
        @click="onCopyTocUrl"
      >
        <span class="appShellMenuLabel">复制目录 URL</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="!item?.origin"
        @click="onEditBookSource"
      >
        <span class="appShellMenuLabel">编辑书源</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onSetSourceVariable"
      >
        <span class="appShellMenuLabel">设置源变量</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onSetBookVariable"
      >
        <span class="appShellMenuLabel">设置书籍变量</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem appShellMenuItem--warning"
        role="menuitem"
        :disabled="!displayBookUrl"
        @click="onClearChapterCache"
      >
        <span class="appShellMenuLabel">清除缓存</span>
      </button>
    </AppShellMenuTeleport>

    <EditBookSourcePanel
      v-model="showEdit"
      :source-url="editingUrl"
      :initial-tab="editInitialTab"
      @done="onEditDone"
      @search-source="onSearchFromEdit"
    />

    <BookSourceLoginPanel v-model="showLogin" :source="loginSource" />
    <ReaderImageLightbox v-model="coverLightboxSrc" />
    <AppContextMenu
      :open="metaContextMenuOpen"
      :x="metaContextMenuX"
      :y="metaContextMenuY"
      :items="metaContextMenuItems"
      :min-width="96"
      @close="closeMetaContextMenu"
      @select="onMetaContextMenuSelect"
    />
    <div class="bookDetailShell">
      <BookSourceCenterState v-if="loading">
        <span class="bookDetailLoadingHint" aria-live="polite">
          加载中<LoadingDotsBounce />
        </span>
      </BookSourceCenterState>
      <BookSourceCenterState v-else-if="error && !detail" error>
        <p>{{ error }}</p>
      </BookSourceCenterState>
      <template v-else>
        <div ref="detailScrollEl" class="bookDetailScroll">
          <div class="bookDetailHero">
            <DefaultBookCover
              v-if="showDefaultCover"
              class="bookDetailCover"
              :title="displayName"
              :author="displayAuthor"
            />
            <img
              v-else
              class="bookDetailCover bookDetailCover--zoomable"
              :src="displayCover"
              alt=""
              referrerpolicy="no-referrer"
              title="点击查看大图"
              @click="openCoverLightbox"
              @error="coverFailed = true"
            />
            <div
              ref="bookDetailMetaEl"
              class="bookDetailMeta"
              @contextmenu="onMetaContextMenu"
            >
              <h1 class="bookDetailName">{{ displayName }}</h1>
              <p class="bookDetailAuthor">{{ formatBookAuthor(displayAuthor) }}</p>
              <div v-if="kindTags.length" class="bookDetailTags">
                <span
                  v-for="(tag, idx) in kindTags"
                  :key="`${tag}-${idx}`"
                  class="bookDetailTag"
                >{{ tag }}</span>
              </div>
              <p v-if="showUpdateTimeLine" class="bookDetailUpdateTime">
                最后更新：{{ displayUpdateTime }}
              </p>
              <p v-if="displayLastChapter" class="bookDetailLastChapter">
                最新章节：<span
                  v-if="latestChapterIsVip"
                  class="bookDetailChapterLock"
                  :class="{
                    'bookDetailChapterLock--unlocked': latestChapterIsPay,
                  }"
                  v-html="latestChapterIsPay ? icons.unlock : icons.lock"
                  aria-hidden="true"
                />{{ displayLastChapter }}
              </p>
              <p v-if="displayIntro" class="bookDetailIntro">{{ displayIntro }}</p>
              <p v-else class="bookDetailIntro bookDetailIntro--empty">暂无简介</p>
            </div>
          </div>

          <section class="bookDetailSection">
          <div class="bookDetailSectionHead">
            <div class="bookDetailSectionHeadLeft">
              <h3 class="bookDetailSectionTitle">目录</h3>
              <IconButton
                v-if="hasChapterTags"
                :icon-html="icons.subhead"
                :title="showChapterTag ? '隐藏附加信息' : '显示附加信息'"
                :aria-label="showChapterTag ? '隐藏附加信息' : '显示附加信息'"
                :pressed="showChapterTag"
                @click="toggleShowChapterTag"
              />
              <span
                v-if="lastReadChapterTitleLabel"
                class="bookDetailLastRead"
                :title="`最后阅读：${lastReadChapterTitleLabel}`"
              >
                最后阅读：{{ lastReadChapterTitleLabel }}
              </span>
            </div>
            <div class="bookDetailSectionHeadRight">
              <span v-if="chapterCount" class="bookDetailChapterCount">
                共 {{ chapterCount }} 章
              </span>
              <IconButton
                v-if="chapterCount"
                :icon-html="chapterSortDesc ? icons.desc : icons.asc"
                :title="chapterSortDesc ? '倒序' : '正序'"
                :aria-label="chapterSortDesc ? '切换为正序' : '切换为倒序'"
                :pressed="chapterSortDesc"
                @click="toggleChapterSort"
              />
            </div>
          </div>
          <p v-if="error && detail" class="bookDetailChapterHint bookDetailChapterHint--error">
            目录加载失败：{{ error }}
          </p>
          <p v-else-if="!chapterCount" class="bookDetailChapterHint">暂无章节</p>
          <VirtualList
            v-else
            class="bookDetailChapterList"
            :item-count="chapterCount"
            :row-stride="chapterRowStride"
            :overscan="12"
            :external-scroll-el="detailScrollEl"
            :item-key="(i) => displayChapters[i]?.url ?? i"
          >
            <template #default="{ index }">
              <div
                v-if="displayChapters[index]"
                class="bookDetailChapterItem"
                :class="{
                  'bookDetailChapterItem--vip':
                    displayChapters[index].isVip || displayChapters[index].isPay,
                  'bookDetailChapterItem--clickable': !loading && !!detail,
                }"
                @click="onReadChapter(index)"
              >
                <span
                  v-if="displayChapters[index].isVip || displayChapters[index].isPay"
                  class="bookDetailChapterLock"
                  :class="{
                    'bookDetailChapterLock--unlocked': displayChapters[index].isPay,
                  }"
                  v-html="
                    displayChapters[index].isPay ? icons.unlock : icons.lock
                  "
                  :aria-label="displayChapters[index].isPay ? '已购买' : 'VIP'"
                />
                <span class="bookDetailChapterText">
                  <span class="bookDetailChapterTitle">{{
                    displayChapters[index].title
                  }}</span>
                  <span
                    v-if="showChapterTag && displayChapters[index].tag?.trim()"
                    class="bookDetailChapterTitleTag"
                    >{{ displayChapters[index].tag.trim() }}</span
                  >
                </span>
                <span
                  v-if="isLastReadChapter(displayChapters[index])"
                  class="bookDetailChapterLastRead"
                  v-html="icons.read"
                  title="最后阅读"
                  aria-label="最后阅读"
                />
                <LoadingDotsRotate
                  v-if="isChapterDownloading(displayChapters[index])"
                  class="bookDetailChapterCaching"
                  title="正在缓存"
                  aria-label="正在缓存"
                />
                <span
                  v-else-if="isChapterCached(displayChapters[index])"
                  class="bookDetailChapterCached"
                  v-html="icons.ok"
                  title="已离线缓存"
                  aria-label="已离线缓存"
                />
              </div>
            </template>
          </VirtualList>
          </section>
        </div>
      </template>

      <div
        v-if="displayItem && !loading && downloading"
        class="bookDetailDownloadBar"
        role="progressbar"
        :aria-valuenow="downloadProgress.current"
        aria-valuemin="0"
        :aria-valuemax="downloadProgress.total"
        :aria-label="`下载进度：${downloadProgressLabel}`"
      >
        <span class="bookDetailDownloadBarText">下载进度：{{ downloadProgressLabel }}</span>
        <div class="bookDetailDownloadBarTrack" aria-hidden="true">
          <div
            class="bookDetailDownloadBarFill"
            :style="{ width: `${downloadProgressPercent}%` }"
          />
        </div>
      </div>
      <footer v-if="displayItem && !loading" class="bookDetailFooter">
        <div class="bookDetailFooterActions">
          <div class="bookDetailFooterLeft">
            <button
              type="button"
              class="btn bookDetailBookshelfBtn"
              :class="{ 'bookDetailBookshelfBtn--remove': inBookshelf }"
              size="large"
              :disabled="!inBookshelf && !canStartReading"
              @click="onToggleBookshelf"
            >
              <span class="bookDetailFooterBtnIcon" aria-hidden="true" v-html="icons.bookshelf" />
              {{ inBookshelf ? "从书架移除" : "放入书架" }}
            </button>
            <button
              v-if="inBookshelf"
              ref="categoryBtnRef"
              type="button"
              class="btn bookDetailCategoryBtn"
              size="large"
              @click="onCategoryBtnClick"
            >
              <span
                class="bookDetailFooterBtnIcon"
                aria-hidden="true"
                v-html="icons.folderOpen"
              />
              {{ bookshelfCategoryLabel }}
            </button>
          </div>
          <div class="bookDetailFooterRight">
            <button
              type="button"
              class="btn"
              size="large"
              :disabled="!canStartReading"
              @click="onStartOrContinueReading"
            >
              <span class="bookDetailFooterBtnIcon" aria-hidden="true" v-html="icons.read" />
              {{ readActionLabel }}
            </button>
            <button
              type="button"
              class="btn"
              size="large"
              :class="downloading ? 'danger' : 'primary'"
              :disabled="!downloading && (!downloadDir.trim() || !canStartReading)"
              @click="onDownloadOrStop"
            >
              <span
                class="bookDetailFooterBtnIcon"
                aria-hidden="true"
                v-html="downloading ? icons.stop : icons.download"
              />
              {{ downloading ? "停止" : "下载" }}
            </button>
          </div>
        </div>
      </footer>
    </div>
  </AppModal>

  <CategoryPickerMenu
    :open="categoryPickerOpen"
    :x="categoryPickX"
    :y="categoryPickY"
    align-above
    :catalog="resolvedCategoryCatalog"
    :menu-counts="categoryMenuCounts"
    :min-width="140"
    @close="categoryPickerOpen = false"
    @pick="onCategoryPicked"
  />
</template>

<style>
.appModalPanel.bookDetailPanel .appModalBody {
  padding: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.appModalPanel.bookDetailPanel .appModalTitleCluster {
  flex: 1;
  min-width: 0;
  align-items: center;
}
</style>

<style scoped>
.bookDetailBreadcrumb {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.4;
}
.bookDetailBreadcrumbSource {
  color: var(--muted);
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}
.bookDetailBreadcrumbSep {
  margin: 0 8px;
  color: var(--muted);
  flex-shrink: 0;
  user-select: none;
}
.bookDetailBreadcrumbCurrent {
  color: var(--fg);
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookDetailLogBtn {
  flex-shrink: 0;
}
.bookDetailLogBtn--warning :deep(.icon) {
  color: var(--warning);
}
.bookDetailLogBtn--warning :deep(svg path) {
  fill: currentColor;
}
.bookDetailHeaderActions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-left: auto;
  flex-shrink: 0;
}
.bookDetailMoreWrap {
  display: inline-flex;
  flex-shrink: 0;
}
.bookDetailShell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg);
}
.bookDetailLoadingHint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.bookDetailScroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.bookDetailHero {
  display: flex;
  gap: 15px;
  padding: 15px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-elevated);
}
.bookDetailCover {
  width: 96px;
  height: 128px;
  --book-cover-height: 128px;
  border-radius: 6px;
  flex-shrink: 0;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--fg) 12%, transparent);
}
img.bookDetailCover {
  object-fit: cover;
  background: var(--scrollbar-track);
}
img.bookDetailCover--zoomable {
  cursor: zoom-in;
}
.bookDetailMeta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 128px;
  user-select: text;
}
.bookDetailName {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--fg);
}
.bookDetailAuthor {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}
.bookDetailTags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bookDetailTag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  background: var(--book-source-tag);
  color: white;
  user-select: none;
  white-space: nowrap;
}

.bookDetailUpdateTime,
.bookDetailLastChapter {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.bookDetailChapterLock {
  display: inline-flex;
  align-items: center;
  vertical-align: -0.15em;
  margin-right: 4px;
  color: var(--warning);
}
.bookDetailChapterLock--unlocked {
  color: var(--accent);
}
.bookDetailChapterLock :deep(svg) {
  width: 13px;
  height: 13px;
  display: block;
}
.bookDetailChapterLock :deep(svg path) {
  fill: currentColor;
}
.bookDetailSectionHeadRight {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.bookDetailSectionHeadLeft {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 auto;
}
.bookDetailLastRead {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}
.bookDetailIntro--empty {
  color: var(--muted);
}
.bookDetailSection {
  padding: 15px;
}
.bookDetailSectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.bookDetailSectionTitle {
  margin: 0;
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}
.bookDetailChapterCount {
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}
.bookDetailIntro {
  margin: 0;
  font-size: 12px;
  color: var(--fg);
  white-space: pre-wrap;
}
.bookDetailChapterHint {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
  padding: 16px 0;
}
.bookDetailChapterHint--error {
  color: var(--danger);
}
.bookDetailChapterList {
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-elevated);
  overflow: hidden;
}
.bookDetailChapterList :deep(.virtualList-row + .virtualList-row) {
  border-top: 1px solid var(--border);
}
.bookDetailChapterItem {
  box-sizing: border-box;
  height: 100%;
  padding: 0 12px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--fg);
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.bookDetailChapterText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}
.bookDetailChapterTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookDetailChapterTitleTag {
  color: var(--secondary);
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookDetailChapterLastRead {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--muted);
}
.bookDetailChapterLastRead :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}
.bookDetailChapterLastRead :deep(svg path) {
  fill: currentColor;
}
.bookDetailChapterCached {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--muted);
}
.bookDetailChapterCached :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}
.bookDetailChapterCached :deep(svg path) {
  fill: currentColor;
}
.bookDetailChapterCaching {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--accent);
}
.bookDetailChapterItem--clickable {
  cursor: pointer;
}
.bookDetailChapterItem--clickable:hover {
  background: color-mix(in srgb, var(--fg) 4%, transparent);
}
.bookDetailChapterItem--vip {
  color: var(--muted);
}
.bookDetailDownloadBar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 28px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  background: var(--panel);
}
.bookDetailDownloadBarTrack {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  z-index: 1;
  pointer-events: none;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  overflow: hidden;
}
.bookDetailDownloadBarFill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
.bookDetailDownloadBarText {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.bookDetailFooter {
  flex-shrink: 0;
  padding: 10px;
  border-top: 1px solid var(--border);
  background: var(--panel);
}
.bookDetailFooterActions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.bookDetailFooterLeft {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}
.bookDetailFooterRight {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  flex-shrink: 0;
}
.bookDetailFooterBtnIcon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.bookDetailFooterBtnIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.bookDetailFooterBtnIcon :deep(svg path) {
  fill: currentColor;
}
.bookDetailBookshelfBtn--remove:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
  background: var(--danger-bg);
}
</style>
