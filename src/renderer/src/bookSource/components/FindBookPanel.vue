<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import AppModal from "../../components/AppModal.vue";
import AppTabBar from "../../components/AppTabBar.vue";
import IconButton from "../../components/IconButton.vue";
import SwitchToggle from "../../components/SwitchToggle.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import AppCustomSelect from "../../components/AppCustomSelect.vue";
import FileCategoryManageModal from "../../components/FileCategoryManageModal.vue";
import type { CustomSelectItem } from "../../components/AppCustomSelect.vue";
import { icons } from "../../icons";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import BookSourcePanel from "./BookSourcePanel.vue";
import ReplaceRulePanel from "./ReplaceRulePanel.vue";
import VoiceReadSpeakSettingsPanel from "../../components/VoiceReadSpeakSettingsPanel.vue";
import BookDetailPanel from "./BookDetailPanel.vue";
import FindBookReaderPanel from "./FindBookReaderPanel.vue";
import FindDiscoverPanel from "./FindDiscoverPanel.vue";
import FindBookshelfPanel from "./FindBookshelfPanel.vue";
import FindBookListItem from "./FindBookListItem.vue";
import { FIND_BOOK_LIST_ROW_STRIDE } from "./findBookListLayout";
import FindBookSettingsPanel from "./FindBookSettingsPanel.vue";
import ColorSchemePanel, {
  type ColorSchemeApplyPayload,
} from "../../components/ColorSchemePanel.vue";
import AboutPanel from "../../components/AboutPanel.vue";
import ShortcutPanel from "../../components/ShortcutPanel.vue";
import AppUpdateFlow from "../../components/AppUpdateFlow.vue";
import VirtualList from "../../components/VirtualList.vue";
import DisclaimerPanel from "./DisclaimerPanel.vue";
import LoadingDotsBounce from "../../components/LoadingDotsBounce.vue";
import type { FindBookSettingsTabId } from "./FindBookSettingsTabBar.vue";
import { useFindBookSettings } from "../composables/useFindBookSettings";
import { useFindBookReaderSettings } from "../composables/useFindBookReaderSettings";
import { useFindBookPanelShortcuts } from "../composables/useFindBookPanelShortcuts";
import { acceleratorToDisplayText, titleWithShortcut } from "../../services/shortcutUtils";
import { runFindBookDownloadAfterAction } from "../services/findBookDownloadActions";
import {
  addFindBookSearchHistory,
  clearFindBookSearchHistory,
  loadFindBookSearchHistory,
  removeFindBookSearchHistory,
} from "../findBookSearchHistory";
import {
  countEligibleSearchSources,
  useBookSourceSearch,
} from "../composables/useBookSource";
import { useBookshelfCoverUrls } from "../composables/useBookshelfCoverUrls";
import type { BookSourceListItem, Book, BookChapter, SearchBookItem } from "@shared/bookSource/types";
import { appLog } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import type { BookshelfBook } from "../findBookBookshelf";
import { bookshelfAsBook } from "../findBookBookshelf";
import type { ReplaceRule } from "@shared/bookSource/replaceRule";
import {
  hasCachedBookshelfToc,
  loadBookshelfReaderPayload,
} from "../bookshelfOpenReader";
import { useFindBookBookshelf } from "../composables/useFindBookBookshelf";
import {
  bookshelfSortLabel,
  bookshelfSortTriggerPrefixHtml as getBookshelfSortTriggerPrefixHtml,
  createBookshelfSortItems,
  loadBookshelfSortMode,
  saveBookshelfSortMode,
  type BookshelfSortMode,
} from "../findBookshelfSort";
import {
  BOOKSHELF_CATEGORY_CATALOG_KEY,
  loadBookshelfCategoryCatalog,
  loadBookshelfCategoryFilter,
  saveBookshelfCategoryCatalog,
  saveBookshelfCategoryFilter,
} from "../findBookshelfCategory";
import {
  FILE_CATEGORY_ACTION_MANAGE,
  FILE_CATEGORY_FILTER_ALL,
  FILE_CATEGORY_FILTER_UNCATEGORIZED,
  UNCATEGORIZED_LIST_BORDER_COLOR,
  type CategoryEditorRow,
  type FileCategoryDefinition,
} from "../../constants/fileCategories";
import {
  GITHUB_REPO_URL,
  persistKey,
  persistedSettingsChangedEvent,
} from "../../constants/appUi";
import {
  loadPersistedSettingsData,
  persistSettingsData,
} from "../../stores/cacheStore";
import { bookshelfUpdateBusy, bookshelfUpdateHasLog, getBookshelfUpdateLogText } from "../composables/useBookshelfUpdate";
import {
  applyAppShellTheme,
  listenPersistedSettingsSync,
  readPersistedAppShellTheme,
  type AppShellTheme,
} from "../../utils/appShellThemeSync";
import { buildWebDavAuth } from "../../utils/webDavAuth";
import {
  downloadFindBookBookshelf,
  downloadFindBookBookSources,
  downloadFindBookSettings,
  uploadFindBookBookshelf,
  uploadFindBookBookSources,
  uploadFindBookSettings,
} from "../../utils/webDavFindBookSync";
import "../bookSourceToolbar.css";
import "./findBookListShared.css";

const mainTab = ref<"bookshelf" | "search" | "discover">(
  (() => {
    try {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "bookshelf") return "bookshelf";
    } catch {
      /* ignore */
    }
    return "search";
  })(),
);
const discoverFilter = ref("");
const discoverExploreActive = ref(false);
const bookshelfFilter = ref("");
const bookshelfSortMode = ref<BookshelfSortMode>(loadBookshelfSortMode());
const bookshelfSortItems = createBookshelfSortItems();
const bookshelfCategoryFilter = ref(loadBookshelfCategoryFilter());
const bookshelfCategoryCatalog = ref<FileCategoryDefinition[]>(
  loadBookshelfCategoryCatalog(),
);
const bookshelfCategoryManageOpen = ref(false);

const bookshelfSortDisplayLabel = computed(() =>
  bookshelfSortLabel(bookshelfSortMode.value),
);
const bookshelfSortTriggerPrefixHtml = computed(() =>
  getBookshelfSortTriggerPrefixHtml(bookshelfSortMode.value),
);

function onBookshelfSortChange(mode: string) {
  const next = mode as BookshelfSortMode;
  bookshelfSortMode.value = next;
  saveBookshelfSortMode(next);
}

const { applyBooks, books: bookshelfBooks, applyCategoryCatalogEdit, refresh: refreshBookshelf } =
  useFindBookBookshelf();

const bookshelfCategoryMenuCounts = computed(() => {
  const files = bookshelfBooks.value;
  const all = files.length;
  let uncategorized = 0;
  const byName: Record<string, number> = {};
  for (const c of bookshelfCategoryCatalog.value) {
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
  return { all, uncategorized, byName };
});

const bookshelfCategoryFixedTop = computed((): CustomSelectItem[] => {
  const m = bookshelfCategoryMenuCounts.value;
  return [
    {
      kind: "item",
      id: FILE_CATEGORY_FILTER_ALL,
      label: "全部",
      skipCategoryMark: true,
      labelSuffix: `(${m.all})`,
    },
    {
      kind: "item",
      id: FILE_CATEGORY_FILTER_UNCATEGORIZED,
      label: "未分类",
      skipCategoryMark: true,
      labelSuffix: `(${m.uncategorized})`,
    },
    { kind: "divider" },
  ];
});

const bookshelfCategoryScrollItems = computed((): CustomSelectItem[] => {
  const m = bookshelfCategoryMenuCounts.value;
  return bookshelfCategoryCatalog.value.map((c) => ({
    kind: "item" as const,
    id: c.name,
    label: c.name,
    borderColor: c.color,
    labelSuffix: `(${m.byName[c.name] ?? 0})`,
  }));
});

const bookshelfCategoryFixedBottom = computed((): CustomSelectItem[] => [
  { kind: "divider" },
  {
    kind: "item",
    id: FILE_CATEGORY_ACTION_MANAGE,
    label: "分类管理",
    actionOnly: true,
  },
]);

const bookshelfCategoryTriggerLabel = computed(() => {
  const v = bookshelfCategoryFilter.value;
  if (v === FILE_CATEGORY_FILTER_ALL) return "全部";
  if (v === FILE_CATEGORY_FILTER_UNCATEGORIZED) return "未分类";
  return v;
});

const bookshelfCategoryTriggerMarkColor = computed(() => {
  const v = bookshelfCategoryFilter.value;
  if (
    v === FILE_CATEGORY_FILTER_ALL ||
    v === FILE_CATEGORY_FILTER_UNCATEGORIZED
  ) {
    return undefined;
  }
  const hit = bookshelfCategoryCatalog.value.find((x) => x.name === v);
  if (hit) return hit.color;
  return UNCATEGORIZED_LIST_BORDER_COLOR;
});

function onBookshelfCategorySelect(id: string) {
  bookshelfCategoryFilter.value = id;
  saveBookshelfCategoryFilter(id);
}

function onBookshelfCategoryAction(id: string) {
  if (id === FILE_CATEGORY_ACTION_MANAGE) {
    bookshelfCategoryManageOpen.value = true;
  }
}

function onApplyBookshelfCategoryCatalog(payload: {
  initial: CategoryEditorRow[];
  draft: CategoryEditorRow[];
  catalog: FileCategoryDefinition[];
}) {
  applyCategoryCatalogEdit(payload.initial, payload.draft);
  bookshelfCategoryCatalog.value = payload.catalog.map((c) => ({ ...c }));
  saveBookshelfCategoryCatalog(bookshelfCategoryCatalog.value);
  const fc = bookshelfCategoryFilter.value;
  if (
    fc !== FILE_CATEGORY_FILTER_ALL &&
    fc !== FILE_CATEGORY_FILTER_UNCATEGORIZED &&
    !payload.catalog.some((c) => c.name === fc)
  ) {
    bookshelfCategoryFilter.value = FILE_CATEGORY_FILTER_ALL;
    saveBookshelfCategoryFilter(FILE_CATEGORY_FILTER_ALL);
  }
}

function syncBookshelfCategoryCatalogFromStorage() {
  bookshelfCategoryCatalog.value = loadBookshelfCategoryCatalog();
  const fc = bookshelfCategoryFilter.value;
  if (
    fc !== FILE_CATEGORY_FILTER_ALL &&
    fc !== FILE_CATEGORY_FILTER_UNCATEGORIZED &&
    !bookshelfCategoryCatalog.value.some((c) => c.name === fc)
  ) {
    bookshelfCategoryFilter.value = FILE_CATEGORY_FILTER_ALL;
    saveBookshelfCategoryFilter(FILE_CATEGORY_FILTER_ALL);
  }
}

function onBookshelfCategoryCatalogStorage(ev: StorageEvent) {
  if (ev.key === BOOKSHELF_CATEGORY_CATALOG_KEY) {
    syncBookshelfCategoryCatalogFromStorage();
  }
}

const bookshelfPanelRef = ref<InstanceType<typeof FindBookshelfPanel> | null>(null);
const discoverPanelRef = ref<InstanceType<typeof FindDiscoverPanel> | null>(null);
const bookshelfToolbarMoreBtnRef = ref<HTMLElement | null>(null);
const bookshelfToolbarMoreMenu = useAnchoredAppShellMenu({
  anchor: bookshelfToolbarMoreBtnRef,
  placement: "below-end",
  widthPx: 160,
  gap: 6,
});
const {
  open: bookshelfToolbarMoreOpen,
  left: bookshelfToolbarMoreLeft,
  top: bookshelfToolbarMoreTop,
  toggleMenu: toggleBookshelfToolbarMoreMenu,
  closeMenu: closeBookshelfToolbarMoreMenu,
  panelRef: bookshelfToolbarMorePanelRef,
} = bookshelfToolbarMoreMenu;

function bindBookshelfToolbarMorePanel(el: HTMLElement | null) {
  bookshelfToolbarMorePanelRef.value = el;
}

const bookshelfManaging = ref(false);

function onBookshelfUpdateAll() {
  closeBookshelfToolbarMoreMenu();
  void bookshelfPanelRef.value?.updateAll();
}

function onBookshelfManage() {
  closeBookshelfToolbarMoreMenu();
  if (bookshelfManaging.value) {
    bookshelfPanelRef.value?.exitManage();
  } else {
    bookshelfPanelRef.value?.enterManage();
  }
}

async function onBookshelfUpdateLogs() {
  closeBookshelfToolbarMoreMenu();
  await appLog(getBookshelfUpdateLogText());
}

const props = withDefaults(
  defineProps<{
    standalone?: boolean;
  }>(),
  { standalone: false },
);

const findBookSettings = useFindBookSettings();
const fbReaderSettings = useFindBookReaderSettings();
const {
  currentTheme: colorSchemeTheme,
  readerPaletteColorEnabled: colorSchemeColorEnabled,
  readerPaletteUserPresets: colorSchemeUserPresets,
  readerPaletteSelectedIdLight: colorSchemeSelectedIdLight,
  readerPaletteSelectedIdDark: colorSchemeSelectedIdDark,
  readerBackground: colorSchemeBackground,
  monacoFontFamily: colorSchemeFontFamily,
  applyReaderPalettes,
} = fbReaderSettings;

function onApplyColorScheme(payload: ColorSchemeApplyPayload) {
  if (payload.reader) applyReaderPalettes(payload.reader);
}
const effectiveCacheDir = findBookSettings.effectiveCacheDir;
const effectiveDownloadDir = findBookSettings.effectiveDownloadDir;

const showSettingsPanel = ref(false);
const showColorSchemePanel = ref(false);
const colorSchemePanelRef = ref<InstanceType<typeof ColorSchemePanel> | null>(
  null,
);
const showShortcutPanel = ref(false);
const showDisclaimerPanel = ref(false);
const showAboutPanel = ref(false);
const settingsInitialTab = ref<FindBookSettingsTabId>("download");
const appUpdateFlowRef = useTemplateRef<{
  checkForUpdates: () => void | Promise<void>;
}>("appUpdateFlowRef");

const emit = defineEmits<{
  close: [];
  goMain: [];
}>();

const modelValue = defineModel<boolean>({ default: false });

const panelOpen = computed({
  get: () => (props.standalone ? true : modelValue.value),
  set: (open) => {
    if (!props.standalone) modelValue.value = open;
  },
});

const query = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);
const searchInputFocused = ref(false);
const searchHistory = ref<string[]>(loadFindBookSearchHistory());
const showBookSourcePanel = ref(false);
const bookSourcePanelRef = ref<InstanceType<typeof BookSourcePanel> | null>(
  null,
);
const showReplaceRulePanel = ref(false);
const showVoiceReadSpeakSettingsPanel = ref(false);
const showBookDetail = ref(false);
const showBookReader = ref(false);
const bookDetailPanelRef = ref<InstanceType<typeof BookDetailPanel> | null>(null);
const bookReaderPanelRef = ref<InstanceType<typeof FindBookReaderPanel> | null>(
  null,
);
const replaceRuleEditFormatMode = computed(
  () => bookReaderPanelRef.value?.readerEditMode === true,
);

function onApplyReplaceRuleFormat(rules: ReplaceRule[]) {
  void bookReaderPanelRef.value?.applyEditFormatTextReplace?.(rules);
}
const readerInitialChapterIndex = ref(0);
/** 书架未缓存目录时先打开阅读器，后台拉目录 */
const readerTocLoading = ref(false);
let bookshelfReaderOpenGen = 0;
const readerDetail = ref<Book | null>(null);
const readerChapters = ref<BookChapter[]>([]);
const selectedBook = ref<SearchBookItem | null>(null);
const findBookBodyRef = ref<HTMLElement | null>(null);
const searchScope = ref<Pick<BookSourceListItem, "bookSourceUrl" | "bookSourceName"> | null>(
  null,
);
const precisionSearch = ref(false);
const moreBtnRef = ref<HTMLElement | null>(null);
const webDavBtnRef = ref<HTMLElement | null>(null);
const searchOptionsBtnRef = ref<HTMLElement | null>(null);
const moreMenu = useAnchoredAppShellMenu({
  anchor: moreBtnRef,
  placement: "below-end",
  widthPx: 180,
  gap: 6,
});
const webDavMenu = useAnchoredAppShellMenu({
  anchor: webDavBtnRef,
  placement: "below-center",
  widthPx: 160,
  gap: 6,
});
const searchOptionsMenu = useAnchoredAppShellMenu({
  anchor: searchOptionsBtnRef,
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

const {
  open: webDavMenuOpen,
  left: webDavMenuLeft,
  top: webDavMenuTop,
  toggleMenu: toggleWebDavMenu,
  closeMenu: closeWebDavMenu,
  panelRef: webDavMenuPanelRef,
} = webDavMenu;

function bindMorePanel(el: HTMLElement | null) {
  morePanelRef.value = el;
}

function bindWebDavMenuPanel(el: HTMLElement | null) {
  webDavMenuPanelRef.value = el;
}

const {
  open: searchOptionsOpen,
  left: searchOptionsLeft,
  top: searchOptionsTop,
  toggleMenu: toggleSearchOptionsMenu,
  closeMenu: closeSearchOptionsMenu,
  panelRef: searchOptionsPanelRef,
} = searchOptionsMenu;

function bindSearchOptionsPanel(el: HTMLElement | null) {
  searchOptionsPanelRef.value = el;
}

function buildSearchOptions() {
  const opts: { sourceUrls?: string[]; precisionSearch?: boolean } = {};
  if (searchScope.value) opts.sourceUrls = [searchScope.value.bookSourceUrl];
  if (precisionSearch.value) opts.precisionSearch = true;
  return Object.keys(opts).length ? opts : undefined;
}

function rerunSearchIfNeeded() {
  const k = query.value.trim();
  if (!k) return;
  void search(k, buildSearchOptions());
}

const {
  searching,
  pageLoading,
  searchPage,
  searchHasMore,
  searchPhase,
  searchKey,
  progress,
  results,
  searchLogs,
  searchSourceErrors,
  searchSourceStats,
  search,
  loadMore,
  cancel,
  clearShortCircuitSearch,
} = useBookSourceSearch();
/** 搜索结果 VirtualList 可见窗（含 overscan）对应的书籍 id，用于封面懒解析 */
const searchVisibleCoverIds = ref<string[]>([]);
const { getCoverUrl, isCoverPending } = useBookshelfCoverUrls(results, {
  visibleIds: searchVisibleCoverIds,
});

function onSearchVisibleIndices(indices: number[]) {
  const next: string[] = [];
  for (const i of indices) {
    const id = results.value[i]?.id;
    if (id) next.push(id);
  }
  searchVisibleCoverIds.value = next;
}

/** 全局是否有可搜索的启用书源（未限定单一源时的空状态用） */
const hasEnabledSearchSources = ref(true);

/**
 * 有效「有搜索源」：特指某书源时视为只启用了该书源（与全局是否另有启用源无关）。
 */
const hasEffectiveSearchSources = computed(
  () => Boolean(searchScope.value) || hasEnabledSearchSources.value,
);

async function refreshHasEnabledSearchSources() {
  hasEnabledSearchSources.value =
    (await countEligibleSearchSources()) > 0;
  if (hasEnabledSearchSources.value) {
    clearShortCircuitSearch();
  }
}

async function onBookSourcesChanged() {
  await refreshHasEnabledSearchSources();
  void discoverPanelRef.value?.refreshSources?.();
}

const hasResults = computed(() => results.value.length > 0);
const hasSearched = computed(() => Boolean(searchKey.value.trim()));
const showHistory = computed(() => searchInputFocused.value);
const filteredSearchHistory = computed(() => {
  const key = query.value.trim();
  if (!key) return searchHistory.value;
  return searchHistory.value.filter((item) => item.includes(key));
});
/** 搜索进行中且尚未有任何条目时，结果区显示加载占位 */
const showSearchLoading = computed(
  () => !showHistory.value && searching.value && !hasResults.value,
);
const showEmpty = computed(
  () =>
    !showHistory.value &&
    !searching.value &&
    !hasResults.value &&
    !hasSearched.value &&
    !query.value.trim(),
);
const showNoResults = computed(
  () =>
    !showHistory.value &&
    !searching.value &&
    !hasResults.value &&
    hasSearched.value,
);
/** 未搜索空状态：有源（含特指书源）邀请搜索，无源提示不可用 */
const emptyIdleIcon = computed(() =>
  hasEffectiveSearchSources.value ? "(•◡•)و" : "(; '⌒' )",
);
const emptyIdleText = computed(() =>
  hasEffectiveSearchSources.value ? "想找什么书呀" : "没有可用搜索源哦",
);
/** 已搜索无结果：有源（含特指）显示无结果，否则提示无可用搜索源 */
const noResultsText = computed(() =>
  hasEffectiveSearchSources.value
    ? "没有找到相关内容哦"
    : "没有可用搜索源哦",
);
const showResults = computed(
  () =>
    !showHistory.value &&
    !showSearchLoading.value &&
    (searching.value || hasResults.value || hasSearched.value),
);

const searchProgressPercent = computed(() => {
  const { completed, total } = progress.value;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
});

const showSearchStatus = computed(
  () =>
    pageLoading.value ||
    searchPhase.value === "completed" ||
    searchPhase.value === "stopped",
);

const searchSourceHasIssue = computed(
  () =>
    searchSourceErrors.value.length > 0 ||
    searchSourceStats.value.some((s) => s.failed || s.itemCount === 0),
);

const searchStatusProgressClass = computed(() => {
  if (searchPhase.value === "stopped") return "findBookStatusEm--warning";
  if (pageLoading.value) return "findBookStatusEm--accent";
  if (searchSourceHasIssue.value) return "findBookStatusEm--warning";
  return "findBookStatusEm--success";
});

const searchLogsHasErrors = computed(
  () => searchSourceErrors.value.length > 0 || searchSourceHasIssue.value,
);

const showSearchLogsBtn = computed(
  () =>
    searchPhase.value !== null &&
    progress.value.total > 0 &&
    !pageLoading.value,
);

async function onShowSearchLogs() {
  const lines = [
    ...searchSourceErrors.value,
    ...searchLogs.value,
  ];
  const text = lines.length ? lines.join("\n\n") : "（暂无日志）";
  await appLog(text);
}

function onSearchScroll(ev: Event) {
  const el = ev.target as HTMLElement;
  if (pageLoading.value || !searchHasMore.value || !hasResults.value) {
    return;
  }
  if (el.scrollHeight <= el.clientHeight + 48) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
    void loadMore();
  }
}

async function tryAutoLoadMoreSearch() {
  await nextTick();
  if (mainTab.value !== "search") return;
  const el = findBookBodyRef.value;
  if (!el || pageLoading.value || !searchHasMore.value || !hasResults.value) {
    return;
  }
  if (el.scrollHeight <= el.clientHeight + 48) {
    void loadMore();
  }
}

watch(
  () =>
    [results.value.length, searchHasMore.value, pageLoading.value] as const,
  ([, , loading]) => {
    if (loading) return;
    void tryAutoLoadMoreSearch();
  },
);

function onOpenBookSources() {
  closeMoreMenu();
  showBookSourcePanel.value = true;
}

function onOpenReplaceRules() {
  closeMoreMenu();
  showReplaceRulePanel.value = true;
}

async function onOpenDownloadDir() {
  closeMoreMenu();
  const dir = effectiveDownloadDir.value.trim();
  if (!dir) {
    appToast("下载目录未配置", { kind: "warning" });
    return;
  }
  const r = await window.colorTxt.openPath(dir);
  if (!r.ok) {
    appToast(r.error || "无法打开下载目录", { kind: "warning" });
  }
}

function onQuitApp() {
  closeMoreMenu();
  window.colorTxt.quitApp();
}

function openSettings(tab?: FindBookSettingsTabId) {
  closeMoreMenu();
  if (tab !== undefined) {
    settingsInitialTab.value = tab;
  }
  if (showBookReader.value) {
    void nextTick(() => {
      showSettingsPanel.value = true;
    });
    return;
  }
  showSettingsPanel.value = true;
}

function openDisclaimer() {
  closeMoreMenu();
  showDisclaimerPanel.value = true;
}

function onToggleDevTools() {
  closeMoreMenu();
  void window.colorTxt.toggleDevTools();
}

function onCheckForUpdates() {
  closeMoreMenu();
  void appUpdateFlowRef.value?.checkForUpdates();
}

function onOpenGithub() {
  closeMoreMenu();
  void window.colorTxt.openExternal(GITHUB_REPO_URL);
}

function onOpenAbout() {
  closeMoreMenu();
  showAboutPanel.value = true;
}

async function onCreateDesktopShortcut() {
  closeMoreMenu();
  const result = await window.colorTxt.createFindBookDesktopShortcut();
  if (result.ok) {
    appToast("已在桌面创建快捷方式", { kind: "success" });
    return;
  }
  appToast(result.error || "创建快捷方式失败", { kind: "warning" });
}

function onOpenSettingsFromReader() {
  openSettings();
}

function openColorScheme() {
  closeMoreMenu();
  if (showBookReader.value) {
    void nextTick(() => {
      showColorSchemePanel.value = true;
    });
    return;
  }
  showColorSchemePanel.value = true;
}

function openShortcuts() {
  closeMoreMenu();
  if (showBookReader.value) {
    void nextTick(() => {
      showShortcutPanel.value = true;
    });
    return;
  }
  showShortcutPanel.value = true;
}

function onOpenColorSchemeFromReader() {
  openColorScheme();
}

function onGoMain() {
  closeMoreMenu();
  emit("goMain");
}

function onOpenNewWindow() {
  closeMoreMenu();
  window.colorTxt.openNewFindBookWindow();
}

const {
  shortcutBindings,
  defaultShortcutBindings,
  applyShortcutBindings,
} = useFindBookPanelShortcuts({
  showBookReader,
  openSettings,
  openColorScheme,
  openBookSources: onOpenBookSources,
  goMain: onGoMain,
  openNewWindow: () => {
    closeMoreMenu();
    window.colorTxt.openNewFindBookWindow();
  },
  toggleTheme: onToggleTheme,
});

const isMacPlatform = /mac|iphone|ipad|ipod/i.test(navigator.platform || "");
const supportsFindBookDesktopShortcut =
  window.colorTxt.supportsFindBookDesktopShortcut === true;

const bookSourceShortcutLabel = computed(() =>
  acceleratorToDisplayText(shortcutBindings.value.openBookSource, isMacPlatform),
);
const settingsShortcutLabel = computed(() =>
  acceleratorToDisplayText(shortcutBindings.value.openSettings, isMacPlatform),
);
const colorSchemeShortcutLabel = computed(() =>
  acceleratorToDisplayText(
    shortcutBindings.value.openColorScheme,
    isMacPlatform,
  ),
);
const findBookShortcutLabel = computed(() =>
  acceleratorToDisplayText(shortcutBindings.value.openFindBook, isMacPlatform),
);
const newWindowShortcutLabel = computed(() =>
  acceleratorToDisplayText(shortcutBindings.value.openNewWindow, isMacPlatform),
);
const themeToggleTitle = computed(() =>
  titleWithShortcut(
    currentTheme.value === "vs"
      ? "当前亮色，点击切换暗色"
      : "当前暗色，点击切换亮色",
    shortcutBindings.value.toggleTheme,
    isMacPlatform,
  ),
);
const goMainTitle = computed(() =>
  titleWithShortcut(
    "主界面",
    shortcutBindings.value.openFindBook,
    isMacPlatform,
  ),
);

function bookshelfBookIdentity(item: SearchBookItem): string {
  return `${item.bookUrl.trim()}::${item.origin.trim()}`;
}

function resetReaderLayer() {
  bookshelfReaderOpenGen += 1;
  showBookReader.value = false;
  readerTocLoading.value = false;
  readerDetail.value = null;
  readerChapters.value = [];
  readerInitialChapterIndex.value = 0;
}

function onOpenBook(item: SearchBookItem) {
  const prev = selectedBook.value;
  if (prev && bookshelfBookIdentity(prev) !== bookshelfBookIdentity(item)) {
    resetReaderLayer();
  }
  selectedBook.value = item;
  showBookDetail.value = true;
}

async function onReadBookshelfBook(item: SearchBookItem) {
  const prev = selectedBook.value;
  if (prev && bookshelfBookIdentity(prev) !== bookshelfBookIdentity(item)) {
    resetReaderLayer();
  }
  selectedBook.value = item;
  const shelfBook = item as BookshelfBook;
  const openGen = ++bookshelfReaderOpenGen;

  // 已有目录缓存：直接打开阅读器
  if (hasCachedBookshelfToc(shelfBook)) {
    try {
      const { payload, books, message } =
        await loadBookshelfReaderPayload(shelfBook);
      if (openGen !== bookshelfReaderOpenGen) return;
      if (books) applyBooks(books);
      if (!payload) {
        appToast(message ?? "打开阅读器失败", { kind: "warning" });
        return;
      }
      onReadChapter({
        index: payload.chapterIndex,
        detail: payload.detail,
        chapters: payload.chapters,
      });
    } catch {
      if (openGen === bookshelfReaderOpenGen) {
        appToast("打开阅读器失败", { kind: "warning" });
      }
    }
    return;
  }

  // 未读/无目录缓存：先打开阅读器，目录加载放进面板内
  readerDetail.value = bookshelfAsBook(shelfBook);
  readerChapters.value = [];
  readerInitialChapterIndex.value = 0;
  readerTocLoading.value = true;
  showBookReader.value = true;

  try {
    const { payload, books, message } =
      await loadBookshelfReaderPayload(shelfBook);
    if (openGen !== bookshelfReaderOpenGen) return;
    if (books) applyBooks(books);
    if (!payload) {
      appToast(message ?? "打开阅读器失败", { kind: "warning" });
      resetReaderLayer();
      return;
    }
    readerDetail.value = payload.detail;
    readerChapters.value = payload.chapters;
    readerInitialChapterIndex.value = payload.chapterIndex;
  } catch {
    if (openGen !== bookshelfReaderOpenGen) return;
    appToast("打开阅读器失败", { kind: "warning" });
    resetReaderLayer();
  } finally {
    if (openGen === bookshelfReaderOpenGen) {
      readerTocLoading.value = false;
    }
  }
}

function raiseOrOpenBookDetail() {
  if (showBookDetail.value) {
    bookDetailPanelRef.value?.bringToFront?.();
    return;
  }
  showBookDetail.value = true;
}

/**
 * 详情与阅读器可同时存在；目标已打开则抬升 z-index。
 * 特例：从详情再次唤起「已存在的」阅读器时关闭详情，避免叠层干扰阅读。
 */
function raiseOrOpenBookReader(chapterIndex?: number) {
  if (showBookReader.value) {
    bookReaderPanelRef.value?.bringToFront?.();
    if (chapterIndex != null) {
      bookReaderPanelRef.value?.openChapter?.(chapterIndex);
    }
    showBookDetail.value = false;
    return;
  }
  showBookReader.value = true;
}

function onReadChapter(payload: {
  index: number;
  detail: Book;
  chapters: BookChapter[];
}) {
  if (!selectedBook.value) return;
  readerDetail.value = payload.detail;
  readerChapters.value = payload.chapters;
  readerInitialChapterIndex.value = payload.index;
  raiseOrOpenBookReader(payload.index);
}

function onOpenBookDetailFromReader() {
  raiseOrOpenBookDetail();
}

/** 阅读器侧栏重新获取目录后同步 */
function onReaderTocRefreshed(payload: {
  detail: Book;
  chapters: BookChapter[];
}) {
  readerDetail.value = payload.detail;
  readerChapters.value = payload.chapters;
}

/** 一侧清除缓存后，同步另一侧目录勾标 */
function onChapterCacheCleared() {
  bookDetailPanelRef.value?.clearChapterCacheMarks?.();
  bookReaderPanelRef.value?.clearChapterCacheMarks?.();
}

/** 关闭阅读器后，若详情仍开着则刷新其目录缓存勾标 */
watch(showBookReader, (open, wasOpen) => {
  if (wasOpen && !open) {
    bookshelfReaderOpenGen += 1;
    readerTocLoading.value = false;
    if (showBookDetail.value) {
      void bookDetailPanelRef.value?.refreshChapterCacheStatus?.();
    }
  }
});

function onBookDownloaded(path: string, size: number) {
  void runFindBookDownloadAfterAction(path, size, {
    addToMainFileList: findBookSettings.downloadAddToMainFileList.value,
    defaultCategory: findBookSettings.downloadDefaultCategory.value,
    afterAction: findBookSettings.downloadAfterAction.value,
  });
}

function onSearchSubmit() {
  const k = query.value.trim();
  if (!k) return;
  searchHistory.value = addFindBookSearchHistory(k);
  void search(k, buildSearchOptions());
  searchInputRef.value?.blur();
}

function onSearchAction() {
  if (searching.value) {
    void cancel();
    return;
  }
  onSearchSubmit();
}

function onHistoryPick(keyword: string) {
  query.value = keyword;
  searchHistory.value = addFindBookSearchHistory(keyword);
  void search(keyword, buildSearchOptions());
  searchInputRef.value?.blur();
}

function onClearHistory() {
  clearFindBookSearchHistory();
  searchHistory.value = [];
}

function onRemoveHistoryItem(keyword: string) {
  searchHistory.value = removeFindBookSearchHistory(keyword);
}

function onSearchFocus() {
  searchInputFocused.value = true;
}

function onSearchBlur() {
  searchInputFocused.value = false;
}

async function onSearchFromSource(item: {
  bookSourceUrl: string;
  bookSourceName: string;
}) {
  searchScope.value = {
    bookSourceUrl: item.bookSourceUrl,
    bookSourceName: item.bookSourceName,
  };
  // 关闭可能盖住找书页的叠层（编辑书源已由子面板自行关闭）
  showBookDetail.value = false;
  showBookReader.value = false;
  showBookSourcePanel.value = false;
  showSettingsPanel.value = false;
  showReplaceRulePanel.value = false;
  showDisclaimerPanel.value = false;
  mainTab.value = "search";
  query.value = "";
  // 搜索中 input 为 disabled，须等 cancel 把 searching 置 false 后再聚焦
  if (searching.value) await cancel();
  await nextTick();
  searchInputRef.value?.focus();
}

async function onSearchAuthor(author: string) {
  const k = author.trim();
  if (!k) return;
  showBookDetail.value = false;
  showBookReader.value = false;
  showBookSourcePanel.value = false;
  showSettingsPanel.value = false;
  showReplaceRulePanel.value = false;
  showDisclaimerPanel.value = false;
  searchScope.value = null;
  precisionSearch.value = true;
  mainTab.value = "search";
  query.value = k;
  if (searching.value) await cancel();
  await nextTick();
  searchHistory.value = addFindBookSearchHistory(k);
  void search(k, buildSearchOptions());
  searchInputRef.value?.blur();
}

function clearSearchScope() {
  searchScope.value = null;
  rerunSearchIfNeeded();
}

function clearPrecisionSearch() {
  precisionSearch.value = false;
  rerunSearchIfNeeded();
}

function onPrecisionSearchChange(value: boolean) {
  precisionSearch.value = value;
  rerunSearchIfNeeded();
}

const currentTheme = ref<AppShellTheme>(readPersistedAppShellTheme());
const webDavEnabled = ref(false);
const webDavBusy = ref(false);
let offThemeSync: (() => void) | null = null;
let offActivateTab: (() => void) | null = null;

function syncThemeFromStorage() {
  currentTheme.value = readPersistedAppShellTheme();
}

function syncWebDavEnabledFromStorage() {
  const loaded = loadPersistedSettingsData(localStorage, persistKey);
  webDavEnabled.value = loaded?.data?.webDavEnabled === true;
}

function applyFindBookTheme(next: AppShellTheme) {
  currentTheme.value = next;
  colorSchemeTheme.value = next;
  applyAppShellTheme(next);
  const loaded = loadPersistedSettingsData(localStorage, persistKey);
  persistSettingsData(localStorage, persistKey, {
    ...(loaded?.data ?? {}),
    theme: next,
  });
}

function onToggleTheme() {
  if (colorSchemePanelRef.value?.isThemeLocked()) return;
  applyFindBookTheme(currentTheme.value === "vs" ? "vs-dark" : "vs");
}

function onColorSchemeChangeTheme(theme: string) {
  if (colorSchemePanelRef.value?.isThemeLocked()) return;
  applyFindBookTheme(theme === "vs-dark" ? "vs-dark" : "vs");
}

function refreshFindBookAfterWebDavDownload() {
  refreshBookshelf();
  bookshelfCategoryFilter.value = loadBookshelfCategoryFilter();
  bookshelfCategoryCatalog.value = loadBookshelfCategoryCatalog();
  bookshelfSortMode.value = loadBookshelfSortMode();
  syncThemeFromStorage();
  findBookSettings.hydrateSharedReaderFromMain();
}

function formatBookshelfSyncToast(
  action: "upload" | "download",
  stats: {
    booksUploaded: number;
    booksSkipped: number;
    booksDeletedRemote: number;
    booksDownloaded: number;
    booksDownloadSkipped: number;
  },
): string {
  if (action === "upload") {
    if (stats.booksUploaded === 0 && stats.booksSkipped === 0) {
      return "本地书架为空，仅同步了分类/排序";
    }
    if (stats.booksUploaded === 0 && stats.booksSkipped > 0) {
      return `书架已是最新（跳过 ${stats.booksSkipped} 本）`;
    }
    return `已上传书架（+${stats.booksUploaded}，跳过 ${stats.booksSkipped}，远端删除 ${stats.booksDeletedRemote}）`;
  }
  return `已同步书架（+${stats.booksDownloaded}，跳过 ${stats.booksDownloadSkipped}）`;
}

function readWebDavAuthFromSettings() {
  const loaded = loadPersistedSettingsData(localStorage, persistKey)?.data ?? {};
  return buildWebDavAuth({
    webDavEnabled: loaded.webDavEnabled === true,
    webDavUrl: typeof loaded.webDavUrl === "string" ? loaded.webDavUrl : "",
    webDavUsername:
      typeof loaded.webDavUsername === "string" ? loaded.webDavUsername : "",
    webDavRemoteDir:
      typeof loaded.webDavRemoteDir === "string" && loaded.webDavRemoteDir.trim()
        ? loaded.webDavRemoteDir.trim()
        : "ColorTxt",
  });
}

async function withWebDavBusy(
  run: () => Promise<void>,
): Promise<void> {
  webDavBusy.value = true;
  try {
    await run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appToast(msg || "WebDAV 操作失败", { kind: "danger" });
  } finally {
    webDavBusy.value = false;
  }
}

async function onUploadFindBookBookshelfWebDav() {
  closeWebDavMenu();
  const auth = readWebDavAuthFromSettings();
  if (!auth) {
    appToast("请先配置 WebDAV", { kind: "warning" });
    return;
  }
  await withWebDavBusy(async () => {
    const r = await uploadFindBookBookshelf(auth);
    if (!r.ok) {
      appToast(r.error, { kind: "danger" });
      return;
    }
    appToast(formatBookshelfSyncToast("upload", r.stats), {
      kind: r.stats.booksUploaded > 0 ? "success" : "info",
    });
  });
}

async function onUpdateFindBookBookshelfWebDav() {
  closeWebDavMenu();
  const auth = readWebDavAuthFromSettings();
  if (!auth) {
    appToast("请先配置 WebDAV", { kind: "warning" });
    return;
  }
  await withWebDavBusy(async () => {
    const r = await downloadFindBookBookshelf(auth);
    if (!r.ok) {
      appToast(r.error, { kind: "danger" });
      return;
    }
    refreshFindBookAfterWebDavDownload();
    appToast(formatBookshelfSyncToast("download", r.stats), { kind: "success" });
  });
}

async function onUploadFindBookBookSourcesWebDav() {
  closeWebDavMenu();
  const auth = readWebDavAuthFromSettings();
  if (!auth) {
    appToast("请先配置 WebDAV", { kind: "warning" });
    return;
  }
  await withWebDavBusy(async () => {
    const r = await uploadFindBookBookSources(auth);
    if (!r.ok) {
      appToast(r.error, { kind: r.error.includes("没有可上传") ? "warning" : "danger" });
      return;
    }
    appToast(`已上传 ${r.stats.sourceCount} 个书源`, { kind: "success" });
  });
}

async function onUpdateFindBookBookSourcesWebDav() {
  closeWebDavMenu();
  const auth = readWebDavAuthFromSettings();
  if (!auth) {
    appToast("请先配置 WebDAV", { kind: "warning" });
    return;
  }
  await withWebDavBusy(async () => {
    const r = await downloadFindBookBookSources(auth);
    if (!r.ok) {
      appToast(r.error, { kind: "danger" });
      return;
    }
    await bookSourcePanelRef.value?.refreshLibrary?.();
    void onBookSourcesChanged();
    if (!r.stats.added && !r.stats.updated) {
      appToast("没有需要新增或更新的书源", { kind: "info" });
      return;
    }
    appToast(
      `已同步书源（新增 ${r.stats.added}，更新 ${r.stats.updated}）`,
      { kind: "success" },
    );
  });
}

async function onUploadFindBookSettingsWebDav() {
  closeWebDavMenu();
  const auth = readWebDavAuthFromSettings();
  if (!auth) {
    appToast("请先配置 WebDAV", { kind: "warning" });
    return;
  }
  await withWebDavBusy(async () => {
    const r = await uploadFindBookSettings(auth);
    if (!r.ok) {
      appToast(r.error, { kind: "danger" });
      return;
    }
    appToast("已上传设置", { kind: "success" });
  });
}

async function onUpdateFindBookSettingsWebDav() {
  closeWebDavMenu();
  const auth = readWebDavAuthFromSettings();
  if (!auth) {
    appToast("请先配置 WebDAV", { kind: "warning" });
    return;
  }
  await withWebDavBusy(async () => {
    const r = await downloadFindBookSettings(auth);
    if (!r.ok) {
      appToast(r.error, { kind: "danger" });
      return;
    }
    refreshFindBookAfterWebDavDownload();
    appToast("已同步设置", { kind: "success" });
  });
}

onMounted(() => {
  if (props.standalone) {
    searchHistory.value = loadFindBookSearchHistory();
  }
  syncThemeFromStorage();
  syncWebDavEnabledFromStorage();
  void refreshHasEnabledSearchSources();
  offThemeSync = listenPersistedSettingsSync(() => {
    syncThemeFromStorage();
    syncWebDavEnabledFromStorage();
  });
  window.addEventListener(persistedSettingsChangedEvent, syncThemeFromStorage);
  window.addEventListener(
    persistedSettingsChangedEvent,
    syncWebDavEnabledFromStorage,
  );
  window.addEventListener("storage", onBookshelfCategoryCatalogStorage);
  offActivateTab = window.colorTxt.onFindBookActivateTab((tab) => {
    if (tab === "bookshelf" || tab === "search" || tab === "discover") {
      mainTab.value = tab;
    }
  });
});

onBeforeUnmount(() => {
  offThemeSync?.();
  offThemeSync = null;
  offActivateTab?.();
  offActivateTab = null;
  window.removeEventListener(
    persistedSettingsChangedEvent,
    syncThemeFromStorage,
  );
  window.removeEventListener(
    persistedSettingsChangedEvent,
    syncWebDavEnabledFromStorage,
  );
  window.removeEventListener("storage", onBookshelfCategoryCatalogStorage);
});

watch(modelValue, (open) => {
  if (props.standalone) return;
  if (!open) {
    searchScope.value = null;
    precisionSearch.value = false;
    searchInputFocused.value = false;
    mainTab.value = "search";
    discoverFilter.value = "";
    bookshelfFilter.value = "";
    showBookDetail.value = false;
    showBookReader.value = false;
    readerDetail.value = null;
    readerChapters.value = [];
    selectedBook.value = null;
    closeMoreMenu();
    closeSearchOptionsMenu();
  } else {
    searchHistory.value = loadFindBookSearchHistory();
  }
});

watch(mainTab, (tab) => {
  closeMoreMenu();
  closeSearchOptionsMenu();
  closeBookshelfToolbarMoreMenu();
  if (tab !== "bookshelf") {
    bookshelfPanelRef.value?.exitManage();
  }
  if (tab === "search") {
    void refreshHasEnabledSearchSources();
    void tryAutoLoadMoreSearch();
  }
});

watch(showBookSourcePanel, (open, wasOpen) => {
  if (wasOpen && !open) {
    void onBookSourcesChanged();
  }
});

function onBack() {
  if (props.standalone) {
    emit("close");
    return;
  }
  modelValue.value = false;
}

</script>

<template>
  <AppModal
    v-model="panelOpen"
    title=""
    fullscreen
    panel-class="findBookPanel"
    :mask-closable="false"
    :esc-closable="false"
    :show-close-button="false"
    :body-scroll="false"
  >
    <template #headerPrefix>
      <div class="findBookHeaderBar">
        <div class="findBookHeaderSide findBookHeaderSide--start">
          <button
            v-if="standalone"
            type="button"
            class="findBookHomeBtn"
            :title="goMainTitle"
            :aria-label="goMainTitle"
            @click="onGoMain"
          >
            <span class="findBookHomeIcon findBookHomeIcon--colorful" aria-hidden="true" v-html="icons.home" />
            <span class="findBookHomeLabel">主界面</span>
          </button>
          <IconButton
            v-else
            :icon-html="icons.back"
            title="返回"
            aria-label="返回"
            @click="onBack"
          />
        </div>
        <div class="findBookHeaderCenter">
          <AppTabBar
            v-model:active-tab="mainTab"
            class="findBookMainTabs"
            aria-label="找书分类"
            :tabs="[
              { id: 'bookshelf', label: '书架', iconHtml: icons.bookshelf },
              { id: 'search', label: '找书', iconHtml: icons.find },
              { id: 'discover', label: '发现', iconHtml: icons.explore },
            ]"
          />
        </div>
        <div class="findBookHeaderSide findBookHeaderSide--end">
          <div v-if="webDavEnabled" ref="webDavBtnRef" class="findBookHeaderWebDav">
            <IconButton
              :icon-html="icons.webDav"
              :active="webDavMenuOpen"
              :pressed="webDavMenuOpen"
              :disabled="webDavBusy"
              title="WebDAV"
              aria-label="WebDAV"
              aria-haspopup="menu"
              :aria-expanded="webDavMenuOpen"
              @click="toggleWebDavMenu"
            />
          </div>
          <IconButton
            :icon-html="currentTheme === 'vs' ? icons.light : icons.dark"
            :title="themeToggleTitle"
            :aria-label="themeToggleTitle"
            @click="onToggleTheme"
          />
          <div ref="moreBtnRef" class="findBookHeaderMore">
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
      </div>
    </template>
    <div class="findBookShell">
      <header v-if="mainTab === 'search'" class="bookSourceToolbarHeader">
        <div class="findBookSearchCombo">
          <div class="findBookSearchField">
            <span class="findBookSearchIcon" aria-hidden="true" v-html="icons.find" />
            <div v-if="precisionSearch" class="findBookScopeTag">
              <span class="findBookScopeTagLabel">精准搜索</span>
              <button
                type="button"
                class="findBookScopeTagRemove"
                aria-label="关闭精准搜索"
                title="移除"
                @mousedown.prevent
                @click="clearPrecisionSearch"
              >
                <span class="findBookScopeTagRemoveIcon" v-html="icons.close" />
              </button>
            </div>
            <div v-if="searchScope" class="findBookScopeTag">
              <span class="findBookScopeTagLabel">{{ searchScope.bookSourceName }}</span>
              <button
                type="button"
                class="findBookScopeTagRemove"
                :aria-label="`移除仅搜索 ${searchScope.bookSourceName}`"
                title="移除"
                @mousedown.prevent
                @click="clearSearchScope"
              >
                <span class="findBookScopeTagRemoveIcon" v-html="icons.close" />
              </button>
            </div>
            <input
              ref="searchInputRef"
              v-model="query"
              class="findBookSearchInput"
              type="search"
              placeholder="搜索书名、作者"
              enterkeyhint="search"
              :disabled="searching"
              @focus="onSearchFocus"
              @blur="onSearchBlur"
              @keydown.enter.prevent="onSearchAction"
            />
          </div>
          <button
            type="button"
            class="btn findBookSearchBtn"
            :class="searching ? 'danger' : 'primary'"
            @mousedown.prevent
            @click="onSearchAction"
          >
            {{ searching ? "停止" : "搜索" }}
          </button>
          <div ref="searchOptionsBtnRef" class="findBookSearchMore">
            <IconButton
              :icon-html="icons.more"
              :active="searchOptionsOpen"
              :pressed="searchOptionsOpen"
              title="更多"
              aria-label="搜索更多选项"
              aria-haspopup="menu"
              :aria-expanded="searchOptionsOpen"
              @click="toggleSearchOptionsMenu"
            />
          </div>
        </div>
      </header>

      <header v-else-if="mainTab === 'bookshelf'" class="bookSourceToolbarHeader findBookDiscoverToolbar findBookBookshelfToolbar">
        <div class="findBookDiscoverFilter">
          <span class="findBookDiscoverFilterIcon" aria-hidden="true" v-html="icons.filter" />
          <input
            v-model="bookshelfFilter"
            class="findBookDiscoverFilterInput"
            type="search"
            placeholder="筛选书籍"
          />
        </div>
        <AppCustomSelect
          class="findBookBookshelfCategorySelect"
          :model-value="bookshelfCategoryFilter"
          :display-label="bookshelfCategoryTriggerLabel"
          :trigger-mark-color="bookshelfCategoryTriggerMarkColor"
          :fixed-top-items="bookshelfCategoryFixedTop"
          :scroll-items="bookshelfCategoryScrollItems"
          :fixed-bottom-items="bookshelfCategoryFixedBottom"
          :scroll-max-height="300"
          ariaLabel="书架分类"
          category-color-marks
          @update:model-value="onBookshelfCategorySelect"
          @action="onBookshelfCategoryAction"
        />
        <AppCustomSelect
          v-model="bookshelfSortMode"
          class="findBookBookshelfSortSelect"
          :display-label="bookshelfSortDisplayLabel"
          :trigger-prefix-html="bookshelfSortTriggerPrefixHtml"
          :fixed-top-items="[]"
          :scroll-items="bookshelfSortItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="360"
          ariaLabel="书架排序"
          @update:model-value="onBookshelfSortChange"
        />
        <div ref="bookshelfToolbarMoreBtnRef" class="findBookBookshelfToolbarMore">
          <IconButton
            class="findBookBookshelfToolbarMoreBtn"
            :icon-html="icons.more"
            :active="bookshelfToolbarMoreOpen"
            :pressed="bookshelfToolbarMoreOpen"
            title="更多"
            aria-label="更多"
            aria-haspopup="menu"
            :aria-expanded="bookshelfToolbarMoreOpen"
            @click="toggleBookshelfToolbarMoreMenu"
          />
        </div>
      </header>

      <header
        v-else-if="mainTab === 'discover' && !discoverExploreActive"
        class="bookSourceToolbarHeader findBookDiscoverToolbar"
      >
        <div class="findBookDiscoverFilter">
          <span class="findBookDiscoverFilterIcon" aria-hidden="true" v-html="icons.filter" />
          <input
            v-model="discoverFilter"
            class="findBookDiscoverFilterInput"
            type="search"
            placeholder="筛选发现"
          />
        </div>
      </header>

      <AppShellMenuTeleport
        v-model:open="bookshelfToolbarMoreOpen"
        :left="bookshelfToolbarMoreLeft"
        :top="bookshelfToolbarMoreTop"
        caret="end"
        :on-panel-mount="bindBookshelfToolbarMorePanel"
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="bookshelfUpdateBusy || bookshelfBooks.length === 0"
          @click="onBookshelfUpdateAll"
        >
          <span class="appShellMenuLabel">更新书籍目录</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          :class="{ 'appShellMenuItem--warning': bookshelfManaging }"
          role="menuitem"
          :disabled="bookshelfBooks.length === 0 && !bookshelfManaging"
          @click="onBookshelfManage"
        >
          <span class="appShellMenuLabel">{{
            bookshelfManaging ? "退出书架管理" : "书架管理"
          }}</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="!bookshelfUpdateHasLog"
          @click="onBookshelfUpdateLogs"
        >
          <span class="appShellMenuLabel">日志</span>
        </button>
      </AppShellMenuTeleport>

      <AppShellMenuTeleport
        v-model:open="searchOptionsOpen"
        :left="searchOptionsLeft"
        :top="searchOptionsTop"
        caret="end"
        :on-panel-mount="bindSearchOptionsPanel"
      >
        <button
          type="button"
          class="appShellMenuItem findBookSearchOptionItem"
          role="menuitemcheckbox"
          :aria-checked="precisionSearch"
          @click="onPrecisionSearchChange(!precisionSearch)"
        >
          <span class="appShellMenuLabel">精准搜索</span>
          <SwitchToggle
            class="findBookSearchOptionSwitch"
            :model-value="precisionSearch"
            size="sm"
            aria-hidden="true"
            tabindex="-1"
          />
        </button>
      </AppShellMenuTeleport>

      <AppShellMenuTeleport
        v-model:open="webDavMenuOpen"
        :width="120"
        :left="webDavMenuLeft"
        :top="webDavMenuTop"
        caret="center"
        :on-panel-mount="bindWebDavMenuPanel"
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="webDavBusy"
          @click="onUploadFindBookBookshelfWebDav"
        >
          <span class="appShellMenuIconSlot" v-html="icons.webDavUpload" />
          <span class="appShellMenuLabel">上传书架</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="webDavBusy"
          @click="onUpdateFindBookBookshelfWebDav"
        >
          <span class="appShellMenuIconSlot" v-html="icons.webDavDownload" />
          <span class="appShellMenuLabel">同步书架</span>
        </button>
        <div class="appShellMenuDivider" role="separator" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="webDavBusy"
          @click="onUploadFindBookBookSourcesWebDav"
        >
          <span class="appShellMenuIconSlot" v-html="icons.webDavUpload" />
          <span class="appShellMenuLabel">上传书源</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="webDavBusy"
          @click="onUpdateFindBookBookSourcesWebDav"
        >
          <span class="appShellMenuIconSlot" v-html="icons.webDavDownload" />
          <span class="appShellMenuLabel">同步书源</span>
        </button>
        <div class="appShellMenuDivider" role="separator" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="webDavBusy"
          @click="onUploadFindBookSettingsWebDav"
        >
          <span class="appShellMenuIconSlot" v-html="icons.webDavUpload" />
          <span class="appShellMenuLabel">上传设置</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="webDavBusy"
          @click="onUpdateFindBookSettingsWebDav"
        >
          <span class="appShellMenuIconSlot" v-html="icons.webDavDownload" />
          <span class="appShellMenuLabel">同步设置</span>
        </button>
      </AppShellMenuTeleport>

      <AppShellMenuTeleport
        v-model:open="moreOpen"
        :width="200"
        :left="moreLeft"
        :top="moreTop"
        caret="end"
        :on-panel-mount="bindMorePanel"
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onOpenBookSources"
        >
          <span
            class="appShellMenuIconSlot appShellMenuIconSlot--colorful"
            v-html="icons.bookSource"
          />
          <span class="appShellMenuLabel">书源管理</span>
          <span class="appShellMenuShortcut">{{ bookSourceShortcutLabel }}</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onOpenDownloadDir"
        >
          <span class="appShellMenuIconSlot" v-html="icons.folderOpen" />
          <span class="appShellMenuLabel">打开下载目录</span>
        </button>
        <div class="appShellMenuDivider" role="separator"></div>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onOpenNewWindow"
        >
          <span class="appShellMenuIconSlot" v-html="icons.newWindow" />
          <span class="appShellMenuLabel">新窗口</span>
          <span class="appShellMenuShortcut">{{ newWindowShortcutLabel }}</span>
        </button>
        <div class="appShellMenuDivider" role="separator"></div>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="openShortcuts"
        >
          <span class="appShellMenuIconSlot" v-html="icons.shortcut" />
          <span class="appShellMenuLabel">快捷键</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="openSettings()"
        >
          <span class="appShellMenuIconSlot" v-html="icons.setting" />
          <span class="appShellMenuLabel">设置</span>
          <span class="appShellMenuShortcut">{{ settingsShortcutLabel }}</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="openColorScheme"
        >
          <span
            class="appShellMenuIconSlot appShellMenuIconSlot--colorful"
            v-html="icons.palette"
          />
          <span class="appShellMenuLabel">配色</span>
          <span class="appShellMenuShortcut">{{ colorSchemeShortcutLabel }}</span>
        </button>
        <button
          v-if="standalone"
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onGoMain"
        >
          <span
            class="appShellMenuIconSlot appShellMenuIconSlot--colorful"
            v-html="icons.home"
          />
          <span class="appShellMenuLabel">主界面</span>
          <span class="appShellMenuShortcut">{{ findBookShortcutLabel }}</span>
        </button>
        <div class="appShellMenuDivider" role="separator"></div>
        <button
          v-if="supportsFindBookDesktopShortcut"
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onCreateDesktopShortcut"
        >
          <span class="appShellMenuIconSlot" v-html="icons.desktopShortcut" />
          <span class="appShellMenuLabel">生成桌面快捷方式</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onCheckForUpdates"
        >
          <span class="appShellMenuIconSlot" v-html="icons.update" />
          <span class="appShellMenuLabel">检查更新</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onToggleDevTools"
        >
          <span class="appShellMenuIconSlot" v-html="icons.devTools" />
          <span class="appShellMenuLabel">开发者工具</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onOpenGithub"
        >
          <span
            class="appShellMenuIconSlot appShellMenuIconSlot--github"
            v-html="icons.github"
          />
          <span class="appShellMenuLabel">GitHub</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onOpenAbout"
        >
          <span class="appShellMenuIconSlot" v-html="icons.info" />
          <span class="appShellMenuLabel">关于</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="openDisclaimer"
        >
          <span class="appShellMenuIconSlot" v-html="icons.disclaimer" />
          <span class="appShellMenuLabel">免责声明</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onQuitApp"
        >
          <span class="appShellMenuIconSlot" v-html="icons.quit" />
          <span class="appShellMenuLabel">退出</span>
        </button>
      </AppShellMenuTeleport>

      <FindBookshelfPanel
        ref="bookshelfPanelRef"
        v-show="mainTab === 'bookshelf'"
        :active="mainTab === 'bookshelf'"
        :filter="bookshelfFilter"
        :category-filter="bookshelfCategoryFilter"
        :category-catalog="bookshelfCategoryCatalog"
        :sort-mode="bookshelfSortMode"
        @read-book="onReadBookshelfBook"
        @open-book-info="onOpenBook"
        @search-source="onSearchFromSource"
        @select-category="onBookshelfCategorySelect"
        @search-author="onSearchAuthor"
        @search-book-name="onSearchAuthor"
        @managing-change="bookshelfManaging = $event"
      />

      <div v-show="mainTab === 'search'" class="findBookSearchPane">
        <div v-if="showSearchStatus" class="findBookStatus">
          <div
            v-if="pageLoading"
            class="findBookProgressBar"
            role="progressbar"
            :aria-valuenow="progress.completed"
            aria-valuemin="0"
            :aria-valuemax="progress.total"
            :aria-label="`搜索进度 ${progress.completed} / ${progress.total}`"
          >
            <div
              class="findBookProgressBarFill"
              :style="{ width: `${searchProgressPercent}%` }"
            />
          </div>
          <span class="findBookStatusText">
            第
            <span class="findBookStatusEm findBookStatusEm--warning">{{ searchPage }}</span>
            页，
            <template v-if="searchPhase === 'stopped'">已停止：</template>
            <template v-else>{{ pageLoading ? "加载中" : "已完成" }}：</template>
            <span class="findBookStatusEm" :class="searchStatusProgressClass">
              {{ progress.completed }}/{{ progress.total }}
            </span>，共
            <span class="findBookStatusEm findBookStatusEm--warning">{{ results.length }}</span>
            个结果
          </span>
          <IconButton
            v-if="showSearchLogsBtn"
            class="findBookStatusLogBtn"
            :class="{ 'findBookStatusLogBtn--warning': searchLogsHasErrors }"
            :icon-html="icons.info"
            title="查看搜索日志"
            aria-label="查看搜索日志"
            @click="onShowSearchLogs"
          />
        </div>

        <div ref="findBookBodyRef" class="findBookBody" @scroll="onSearchScroll">
          <div v-if="showHistory" class="findBookHistory">
            <div class="findBookHistoryHead">
              <span class="findBookHistoryTitle">搜索历史</span>
              <button
                v-if="searchHistory.length"
                type="button"
                class="link danger hoverMode findBookHistoryClear"
                @mousedown.prevent
                @click="onClearHistory"
              >
                清空
              </button>
            </div>
            <div v-if="filteredSearchHistory.length" class="findBookHistoryTags">
              <div
                v-for="item in filteredSearchHistory"
                :key="item"
                class="findBookHistoryTagWrap"
              >
                <button
                  type="button"
                  class="findBookHistoryTag"
                  @mousedown.prevent
                  @click="onHistoryPick(item)"
                >
                  {{ item }}
                </button>
                <button
                  type="button"
                  class="findBookHistoryTagRemove"
                  :aria-label="`移除 ${item}`"
                  title="移除"
                  @mousedown.prevent
                  @click.stop="onRemoveHistoryItem(item)"
                >
                  <span class="findBookHistoryTagRemoveIcon" v-html="icons.close" />
                </button>
              </div>
            </div>
            <p v-else-if="searchHistory.length" class="findBookHistoryEmpty">无匹配的搜索历史</p>
            <p v-else class="findBookHistoryEmpty">暂无搜索历史</p>
          </div>
          <div v-else-if="showSearchLoading" class="findBookEmpty">
            <p class="findBookEmptyText findBookEmptyText--loading">
              加载中<LoadingDotsBounce />
            </p>
          </div>
          <div v-else-if="showEmpty" class="findBookEmpty">
            <p class="findBookEmptyIcon">{{ emptyIdleIcon }}</p>
            <p class="findBookEmptyText">{{ emptyIdleText }}</p>
          </div>
          <div v-else-if="showNoResults" class="findBookEmpty">
            <p class="findBookEmptyIcon">(; '⌒' )</p>
            <p class="findBookEmptyText">{{ noResultsText }}</p>
          </div>
          <div v-else-if="showResults" class="findBookResults">
            <VirtualList
              class="findBookResultsVirtual"
              role="list"
              :item-count="results.length"
              :row-stride="FIND_BOOK_LIST_ROW_STRIDE"
              :overscan="6"
              :external-scroll-el="findBookBodyRef"
              :item-key="(i) => results[i]?.id ?? i"
              @visible-indices="onSearchVisibleIndices"
            >
              <template #default="{ index }">
                <FindBookListItem
                  v-if="results[index]"
                  :item="results[index]"
                  :cover-url="getCoverUrl(results[index]!) ?? ''"
                  :cover-pending="isCoverPending(results[index]!)"
                  @click="onOpenBook"
                />
              </template>
            </VirtualList>
            <div
              v-if="pageLoading && hasResults"
              class="findBookResultsLoading"
              aria-live="polite"
            >
              加载中<LoadingDotsBounce />
            </div>
          </div>
        </div>
      </div>

      <FindDiscoverPanel
        ref="discoverPanelRef"
        v-show="mainTab === 'discover'"
        :filter="discoverFilter"
        :active="mainTab === 'discover'"
        @open-book="onOpenBook"
        @explore-active-change="discoverExploreActive = $event"
        @search-source="onSearchFromSource"
        @sources-changed="onBookSourcesChanged"
      />
    </div>

    <BookDetailPanel
      ref="bookDetailPanelRef"
      v-model="showBookDetail"
      :item="selectedBook"
      :download-dir="effectiveDownloadDir"
      :cache-dir="effectiveCacheDir"
      :category-catalog="bookshelfCategoryCatalog"
      @file-downloaded="onBookDownloaded"
      @read-chapter="onReadChapter"
      @chapter-cache-cleared="onChapterCacheCleared"
      @search-source="onSearchFromSource"
    />

    <FileCategoryManageModal
      v-model="bookshelfCategoryManageOpen"
      :catalog="bookshelfCategoryCatalog"
      @apply="onApplyBookshelfCategoryCatalog"
    />

    <FindBookReaderPanel
      ref="bookReaderPanelRef"
      v-if="selectedBook && readerDetail"
      v-model="showBookReader"
      :item="selectedBook"
      :detail="readerDetail"
      :chapters="readerChapters"
      :initial-chapter-index="readerInitialChapterIndex"
      :toc-loading="readerTocLoading"
      @open-settings="onOpenSettingsFromReader"
      @open-color-scheme="onOpenColorSchemeFromReader"
      @open-book-detail="onOpenBookDetailFromReader"
      @chapter-cache-cleared="onChapterCacheCleared"
      @toc-refreshed="onReaderTocRefreshed"
      @open-text-replace="onOpenReplaceRules"
      @search-source="onSearchFromSource"
      @open-speak-settings="showVoiceReadSpeakSettingsPanel = true"
    />

    <FindBookSettingsPanel
      v-model="showSettingsPanel"
      :initial-tab="settingsInitialTab"
      @chapter-cache-cleared="onChapterCacheCleared"
      @open-speak-settings="showVoiceReadSpeakSettingsPanel = true"
    />

    <ColorSchemePanel
      ref="colorSchemePanelRef"
      v-model="showColorSchemePanel"
      :current-theme="currentTheme"
      :reader-palette-color-enabled="colorSchemeColorEnabled"
      :reader-palette-user-presets="colorSchemeUserPresets"
      :reader-palette-selected-id-light="colorSchemeSelectedIdLight"
      :reader-palette-selected-id-dark="colorSchemeSelectedIdDark"
      :reader-background="colorSchemeBackground"
      :monaco-font-family="colorSchemeFontFamily"
      :visible-tabs="['reader']"
      @apply="onApplyColorScheme"
      @change-theme="onColorSchemeChangeTheme"
    />

    <ShortcutPanel
      v-model="showShortcutPanel"
      panel-context="findBook"
      :shortcut-bindings="shortcutBindings"
      :default-shortcut-bindings="defaultShortcutBindings"
      @apply="applyShortcutBindings"
    />

    <DisclaimerPanel v-model="showDisclaimerPanel" />
    <AboutPanel v-model="showAboutPanel" />
    <AppUpdateFlow ref="appUpdateFlowRef" />

    <BookSourcePanel
      ref="bookSourcePanelRef"
      v-model="showBookSourcePanel"
      @search-source="onSearchFromSource"
      @sources-changed="onBookSourcesChanged"
    />

    <ReplaceRulePanel
      v-model="showReplaceRulePanel"
      bucket="findBook"
      :edit-format-mode="replaceRuleEditFormatMode"
      :scope-book-name="readerDetail?.name || selectedBook?.name || ''"
      :scope-book-origin="selectedBook?.origin || ''"
      @apply-format="onApplyReplaceRuleFormat"
    />
    <VoiceReadSpeakSettingsPanel v-model="showVoiceReadSpeakSettingsPanel" />
  </AppModal>
</template>

<style>
.appModalPanel.findBookPanel .appModalBody {
  padding: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.appModalPanel.findBookPanel .appModalTitleCluster {
  flex: 1;
  min-width: 0;
  align-items: center;
  display: flex;
}
.findBookHeaderBar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 8px;
}
.findBookHeaderSide {
  display: flex;
  align-items: center;
  min-width: 0;
}
.findBookHeaderSide--start {
  justify-self: start;
}
.findBookHeaderCenter {
  justify-self: center;
  min-width: 0;
}
.findBookHeaderSide--end {
  justify-self: end;
  gap: 8px;
}
.appModalPanel.findBookPanel .findBookMainTabs {
  flex: unset;
  min-width: 0;
  border-bottom: none;
}
.appModalPanel.findBookPanel .findBookHeaderMore {
  margin-left: 0;
  flex-shrink: 0;
}
</style>

<style scoped>
.findBookHomeBtn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--icon-btn-fg);
  font-size: 14px;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
}
.findBookHomeBtn:hover {
  background: var(--icon-btn-bg-hover);
}
.findBookHomeBtn:active {
  background: var(--icon-btn-bg-active);
}
.findBookHomeIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.findBookHomeIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.findBookHomeLabel {
  display: inline-flex;
  align-items: center;
  height: 16px;
  flex-shrink: 0;
  line-height: 1;
}
.findBookSearchCombo {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
}
.findBookSearchField {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-right: none;
  border-radius: 999px 0 0 999px;
  background: var(--input-bg);
  padding: 6px 10px;
  transition: border-color 0.12s ease;
}
.findBookSearchField:focus-within {
  border-color: var(--accent);
}
.findBookSearchIcon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--secondary);
  pointer-events: none;
}
.findBookSearchIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.findBookSearchIcon :deep(svg path) {
  fill: currentColor;
}
.findBookScopeTag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 46%;
  padding: 2px 4px 2px 8px;
  border-radius: 999px;
  background: var(--book-source-tag, #8b63c9);;
  color: white;
  font-size: 12px;
  line-height: 1.4;
}
.findBookScopeTagLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.findBookScopeTagRemove {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: white;
  cursor: pointer;
}
.findBookScopeTagRemove:hover {
  background: var(--danger);
}
.findBookScopeTagRemoveIcon {
  display: flex;
  width: 12px;
  height: 12px;
}
.findBookScopeTagRemoveIcon :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}
.findBookScopeTagRemoveIcon :deep(svg path) {
  fill: currentColor;
}
.findBookSearchInput {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  width: 0;
  height: auto;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 2px 0;
  color: var(--fg);
  font: inherit;
  font-size: 14px;
  line-height: inherit;
  outline: none;
}
.findBookSearchInput:disabled {
  color: var(--muted);
  cursor: not-allowed;
}
.findBookSearchBtn {
  flex-shrink: 0;
  border-radius: 0 999px 999px 0;
  padding: 7px 16px;
  white-space: nowrap;
  font-size: 14px;
  border: none;
}
.findBookSearchMore {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  margin-left: 10px;
}
.findBookSearchOptionItem {
  justify-content: space-between;
  gap: 12px;
}
.findBookSearchOptionSwitch {
  pointer-events: none;
  flex-shrink: 0;
}
.findBookDiscoverFilter {
  position: relative;
  flex: 1;
  min-width: 0;
}
.findBookDiscoverFilterIcon {
  position: absolute;
  left: 10px;
  top: 50%;
  z-index: 1;
  transform: translateY(-50%);
  display: flex;
  width: 16px;
  height: 16px;
  color: var(--secondary);
  pointer-events: none;
}
.findBookDiscoverFilterIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.findBookDiscoverFilterIcon :deep(svg path) {
  fill: currentColor;
}
.findBookDiscoverFilterInput {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 999px;
  background: var(--input-bg);
  padding: 8px 12px 8px 32px;
  color: var(--fg);
  font: inherit;
  font-size: 14px;
  outline: none;
}
.findBookDiscoverFilterInput:focus {
  border-color: var(--accent);
}
.findBookDiscoverFilterInput::placeholder {
  color: var(--muted);
}
.findBookBookshelfToolbar {
  gap: 8px;
}
.findBookBookshelfCategorySelect {
  flex-shrink: 0;
  width: 112px;
  min-width: 112px;
}
.findBookBookshelfSortSelect {
  flex-shrink: 0;
  width: 128px;
  min-width: 128px;
}
.findBookBookshelfToolbarMore {
  flex-shrink: 0;
}
.findBookShell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}
.findBookSearchPane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
}
.findBookProgressBar {
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
.findBookProgressBarFill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
.findBookStatus {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 47px;
  padding: 10px 10px 10px 16px;
  font-size: 12px;
  color: var(--text-muted, #666);
  border-bottom: 1px solid var(--border);
}
.findBookStatusText {
  flex: 1;
  min-width: 0;
}
.findBookStatusEm {
  font-weight: 700;
}
.findBookStatusEm--warning {
  color: var(--warning);
}
.findBookStatusEm--accent {
  color: var(--accent);
}
.findBookStatusEm--success {
  color: var(--success);
}
.findBookStatusLogBtn {
  flex-shrink: 0;
  margin-left: auto;
}
.findBookStatusLogBtn--warning :deep(.icon),
.findBookStatusLogBtn--warning :deep(svg path) {
  color: var(--warning);
}
.findBookBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--bg);
}
.findBookHistory {
  padding: 10px;
}
.findBookHistoryHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.findBookHistoryTitle {
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
}

.findBookHistoryClear {
  font-size: 14px;
  text-decoration: none !important;
}
.findBookHistoryTags {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.findBookHistoryTagWrap {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  padding-top: 4px;
  padding-right: 4px;
}
.findBookHistoryTag {
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 14px;
  line-height: 1.3;
  background: var(--btn-bg);
  color: var(--fg);
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.12s ease;
}
.findBookHistoryTagWrap:hover .findBookHistoryTag {
  color: var(--accent);
}
.findBookHistoryTagRemove {
  position: absolute;
  top: 0;
  right: 0;
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  min-width: 16px;
  min-height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--danger);
  line-height: 0;
  font-size: 0;
  display: none;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  box-shadow: 0 0 0 1px var(--bg);
  overflow: hidden;
}
.findBookHistoryTagWrap:hover .findBookHistoryTagRemove {
  display: flex;
}
.findBookHistoryTagRemove:hover {
  background: var(--danger-hover);
}
.findBookHistoryTagRemoveIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #ffffff;
  pointer-events: none;
}
.findBookHistoryTagRemoveIcon :deep(svg) {
  width: 10px;
  height: 10px;
  display: block;
  flex-shrink: 0;
}
.findBookHistoryTagRemoveIcon :deep(svg path) {
  fill: currentColor;
}
.findBookHistoryEmpty {
  margin: 24px 0 0;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
</style>
