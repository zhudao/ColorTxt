<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
  type ComponentPublicInstance,
} from "vue";
import AppModal from "../../components/AppModal.vue";
import IconButton from "../../components/IconButton.vue";
import LoadingDotsBounce from "../../components/LoadingDotsBounce.vue";
import RefreshIcon from "../../components/RefreshIcon.vue";
import ReaderMain from "../../components/ReaderMain.vue";
import VoiceReadToolbar from "../../components/VoiceReadToolbar.vue";
import ReaderChapterNavBar from "../../components/ReaderChapterNavBar.vue";
import FullscreenSystemClock from "../../components/FullscreenSystemClock.vue";
import PomodoroBreakOverlay from "../../components/PomodoroBreakOverlay.vue";
import FindBookReaderFooter from "./FindBookReaderFooter.vue";
import FindBookReaderHeader from "./FindBookReaderHeader.vue";
import FindBookReaderChapterSidebar from "./FindBookReaderChapterSidebar.vue";
import DictionaryManageModal from "../../components/DictionaryManageModal.vue";
import WebSearchManageModal from "../../components/WebSearchManageModal.vue";
import TranslateManageModal from "../../components/TranslateManageModal.vue";
import { mergeDictionarySettings } from "../../constants/dictionarySettings";
import { mergeWebSearchSettings } from "../../constants/webSearchSettings";
import type { WebSearchSettings } from "@shared/webSearchTypes";
import {
  mergeTranslationSettings,
  resolveTranslationSecretsWritePayload,
} from "../../constants/translationSettings";
import type { TranslationSettings } from "@shared/translationTypes";
import type { DictionarySettings } from "@shared/dictionaryTypes";
import {
  countCharsForLine,
  floorReadingProgressPercentByLines,
  formatCharCount,
} from "../../utils/format";
import { usePomodoroTimer } from "../../composables/usePomodoroTimer";
import EditBookSourcePanel from "./EditBookSourcePanel.vue";
import BookSourceLoginPanel from "./BookSourceLoginPanel.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import { icons } from "../../icons";
import type {
  BookChapter,
  Book,
  BookSourceRecord,
  SearchBookItem,
} from "@shared/bookSource/types";
import { useBookSourceDownload } from "../composables/useBookSource";
import { useFindBookBookshelf } from "../composables/useFindBookBookshelf";
import {
  updateFindBookBookshelfBookInfo,
} from "../findBookBookshelf";
import { useFindBookReaderSettings } from "../composables/useFindBookReaderSettings";
import { useFindBookSettings } from "../composables/useFindBookSettings";
import { useFindBookReaderShortcuts } from "../composables/useFindBookReaderShortcuts";
import { useFindBookChapterSession } from "../composables/useFindBookChapterSession";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import { acceleratorToDisplayText } from "../../services/shortcutUtils";
import { loadStealthReaderSettings } from "../../utils/stealthReaderSettings";
import type { StealthPagePayload } from "@shared/stealthReaderIpc";
import { useAppReaderUiPrefs } from "../../composables/useAppReaderUiPrefs";
import { useAppReaderChrome } from "../../composables/useAppReaderChrome";
import { useFullscreenViewportPreserve } from "../../composables/useFullscreenViewportPreserve";
import { useReaderHudTip } from "../../composables/useReaderHudTip";
import { useAppFullscreenReaderLayout } from "../../composables/useAppFullscreenReaderLayout";
import { useAppTimedScroll } from "../../composables/useAppTimedScroll";
import { useAppVoiceRead } from "../../composables/useAppVoiceRead";
import { useReaderClickModeAltHold } from "../../composables/useReaderClickModeAltHold";
import { applyTextDisplayConverts } from "../../services/textConvertApply";
import { applyAppShellTheme, type AppShellTheme } from "../../utils/appShellThemeSync";
import { appConfirm, appLog } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import type {
  TextConvertWidthMode,
  TextConvertZhMode,
} from "@shared/textConvertTypes";
import {
  findBookReplaceRulesChangedEvent,
  type ReplaceRule,
} from "@shared/bookSource/replaceRule";
import type { BookSourceEditTab } from "../editBookSourceFields";
import { useChapterCacheMarks } from "../composables/useChapterCacheMarks";
import { confirmClearBookChapterCache } from "../services/clearBookChapterCache";
import { sortContentChaptersDisplay } from "../sortContentChaptersDisplay";
import {
  FIND_BOOK_SIDEBAR_MIN_WIDTH,
  SIDEBAR_MIN_READER_WIDTH,
  persistKey,
  persistedSettingsChangedEvent,
  applyReaderSurfaceToDocument,
  applyReaderBackgroundForPalettes,
} from "../../constants/appUi";
import {
  loadPersistedSettingsData,
  persistSettingsData,
} from "../../stores/cacheStore";
import { READER_SIDEBAR_ROW_STRIDE } from "../../composables/useReaderSidebarLists";

/** 章名下有 tag（updateTime）时两行展示的行距 */
const READER_SIDEBAR_ROW_STRIDE_WITH_TAG = 56;
import {
  displayIndexForReadingOrder,
  readingOrderIndexFromDisplay,
} from "../chapterReadingOrder";
import {
  FIND_BOOK_WINDOW_TITLE,
  formatFindBookWindowTitle,
} from "@shared/findBookWindowTitle";

import { ipcPlain } from "../ipcPlain";

const props = withDefaults(
  defineProps<{
    item: SearchBookItem;
    detail: Book;
    chapters: BookChapter[];
    initialChapterIndex?: number;
    /** 书架首次打开：目录尚未就绪，阅读区内显示加载中 */
    tocLoading?: boolean;
  }>(),
  { tocLoading: false },
);

const modelValue = defineModel<boolean>({ default: false });

const emit = defineEmits<{
  openSettings: [];
  openColorScheme: [];
  openBookDetail: [];
  chapterCacheCleared: [];
  /** 重新获取目录后同步父级 detail/chapters */
  tocRefreshed: [payload: { detail: Book; chapters: BookChapter[] }];
  openTextReplace: [];
  /** 限定该书源搜索 */
  searchSource: [item: { bookSourceUrl: string; bookSourceName: string }];
  openSpeakSettings: [];
}>();

const readerRef = ref<InstanceType<typeof ReaderMain> | null>(null);
const chapterListRef = ref<InstanceType<
  typeof FindBookReaderChapterSidebar
> | null>(null);

const showEditSource = ref(false);
const editingSourceUrl = ref<string | null>(null);
const editSourceInitialTab = ref<BookSourceEditTab>("content");
const showLogin = ref(false);
const loginSource = ref<BookSourceRecord | null>(null);
const sourceNeedsLogin = ref(false);
/** 用户点击「刷新」强制重拉当前章节 */
const refreshingChapter = ref(false);
/** 侧栏「重新获取目录」 */
const refreshingToc = ref(false);
/** 购买操作进行中 */
const payingChapter = ref(false);

const topMoreBtnRef = ref<HTMLElement | null>(null);
const topMoreMenu = useAnchoredAppShellMenu({
  anchor: topMoreBtnRef,
  placement: "below-end",
  widthPx: 180,
  gap: 6,
});
const {
  open: topMoreOpen,
  left: topMoreLeft,
  top: topMoreTop,
  toggleMenu: toggleTopMoreMenu,
  closeMenu: closeTopMoreMenu,
  panelRef: topMorePanelRef,
} = topMoreMenu;

function bindTopMorePanel(el: HTMLElement | null) {
  topMorePanelRef.value = el;
}
const chapterSortDesc = ref(false);
const currentDisplayIndex = ref(0);
const viewportTopLine = ref(1);
const viewportEndLine = ref(1);
const viewportVisualProgressPercent = ref(0);
const viewportAtBottom = ref(false);

const settings = useFindBookReaderSettings();
const findBookSettings = useFindBookSettings();
/** 阅读器侧栏 UI 态；持久化偏好在 findBookSettings.showSidebar */
const showSidebar = ref(findBookSettings.showSidebar.value);
const showChapterTag = findBookSettings.showChapterTag;
/** 本会话是否已按「章节数」应用过打开时的侧栏策略（单章临时收起等） */
let sidebarOpenPolicyApplied = false;
/** 本次打开后用户是否已手动切换侧栏（此后不再套用单章临时收起） */
let sidebarUserToggledThisOpen = false;
const effectiveCacheDir = findBookSettings.effectiveCacheDir;
const {
  phase: pomodoroPhase,
  displayMode: pomodoroDisplayMode,
  progress: pomodoroProgress,
  countdownText: pomodoroCountdownText,
  pauseResumeLabel: pomodoroPauseResumeLabel,
  paused: pomodoroPaused,
  showBreakOverlay: pomodoroShowBreakOverlay,
  start: startPomodoro,
  toggleDisplayMode: togglePomodoroDisplayMode,
  togglePause: togglePomodoroPause,
  stop: stopPomodoro,
  finishBreakEarly: finishPomodoroBreakEarly,
} = usePomodoroTimer(findBookSettings.pomodoroSettings);
const pomodoroEnabled = computed(
  () => findBookSettings.pomodoroSettings.value.enabled,
);
const {
  currentTheme,
  sidebarWidth,
  readerFontSize,
  readerLineHeightMultiple,
  readerLineSpacingPx,
  readerLetterSpacingPx,
  readerHorizontalInsetPx,
  monacoFontFamily,
  pinnedOtherFonts,
  monacoCustomHighlight,
  txtrDelimitedMatchCrossLine,
  compressBlankLines,
  compressBlankKeepOneBlank,
  chapterTitleBlankMode,
  leadIndentFullWidth,
  textConvertZh,
  textConvertLetter,
  textConvertDigit,
  monacoAdvancedWrapping,
  monacoCjkWrapOptimize,
  monacoSmoothScrolling,
  scrollbarTrackBehavior,
  mouseWheelScrollSensitivity,
  fastScrollSensitivity,
  stickyChapterTitleEnabled,
  readerClickMode,
  readingRulerEnabled,
  readingRulerFocusLines,
  readingRulerDimOpacity,
  readingRulerDimStickyTitle,
  readingRulerTransitionEnabled,
  markdownImageHeightPx,
  chapterNavToolbarEnabled,
  findBookChapterAdvanceEnabled,
  selectionToolbarButtons,
  dictionarySettings,
  webSearchSettings,
  translationSettings,
  readerEditShowLineNumbers,
  readerEditMinimap,
  fullscreenReaderWidthPercent,
  fullscreenShowSystemTime,
  chapterMinCharCount,
  timedScrollSettings,
  aiFeaturesEnabled,
  effectiveReaderSurfaceLight,
  effectiveReaderSurfaceDark,
  highlightColorsForReader,
  lineationColorsLight,
  lineationColorsDark,
  readerPaletteColorEnabledForReader,
  highlightWordsByIndexGlobal,
  voiceReadProfiles,
  activeVoiceReadProfileId,
  voiceReadSettings,
  canIncreaseFont,
  canDecreaseFont,
  canIncreaseLineHeight,
  canDecreaseLineHeight,
  persistReaderUiPrefs,
  syncSharedSettingsFromMain,
  readerBackground,
  readerSurfaceLight,
  readerSurfaceDark,
} = settings;

const {
  downloading: offlineCaching,
  downloadProgress: offlineCacheProgress,
  download: startOfflineCacheDownload,
  cancel: cancelOfflineCache,
} = useBookSourceDownload();

const showDictionaryManagePanel = ref(false);
const showWebSearchManagePanel = ref(false);
const showTranslateManagePanel = ref(false);

function openTranslateManagePanel() {
  showTranslateManagePanel.value = true;
}

function onDictionarySettingsUpdate(v: DictionarySettings) {
  dictionarySettings.value = mergeDictionarySettings(v);
  persistReaderUiPrefs();
}

function onWebSearchSettingsUpdate(v: WebSearchSettings) {
  webSearchSettings.value = mergeWebSearchSettings(v);
  persistReaderUiPrefs();
}

async function onTranslationSettingsUpdate(v: TranslationSettings) {
  translationSettings.value = mergeTranslationSettings(v);
  try {
    const payload = await resolveTranslationSecretsWritePayload(
      translationSettings.value,
      async () => {
        const res = await window.colorTxt.secrets.getTranslationProviderKeys();
        return res.keys ?? "";
      },
    );
    if (payload) {
      await window.colorTxt.secrets.setTranslationSecrets(payload);
    }
  } catch {
    /* ignore */
  }
  persistReaderUiPrefs();
}
const { isInBookshelf, toggle: toggleBookshelf, updateReadProgress } =
  useFindBookBookshelf();

const contentChapters = computed(() => props.chapters.filter((ch) => !ch.isVolume));

const {
  refresh: refreshChapterCacheStatus,
  markCached: markChapterCached,
  clearLocal: clearChapterCacheMarks,
  isCached: isChapterCached,
} = useChapterCacheMarks({
  bookName: () => props.detail.name || "",
  bookUrl: () => props.detail.bookUrl || "",
  chapterUrls: () => contentChapters.value.map((ch) => ch.url),
  cacheDir: () => effectiveCacheDir.value,
});

/** 离线缓存进行中、尚未写入勾标集合的当前章 */
function isChapterOfflineCaching(ch: BookChapter | undefined): boolean {
  if (!offlineCaching.value || !ch?.url) return false;
  if (offlineCacheProgress.value.chapterUrl !== ch.url) return false;
  return !isChapterCached(ch);
}

const offlineCacheProgressPercent = computed(() => {
  const { current, total } = offlineCacheProgress.value;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((current / total) * 100));
});

const offlineCacheProgressLabel = computed(() => {
  const { current, total } = offlineCacheProgress.value;
  return `缓存进度：${current}/${total}`;
});

watch(
  () =>
    [
      offlineCacheProgress.value.chapterUrl,
      offlineCacheProgress.value.current,
    ] as const,
  ([url], prev) => {
    if (!offlineCaching.value) return;
    const prevUrl = prev?.[0];
    if (prevUrl && prevUrl !== url) markChapterCached(prevUrl);
  },
);

watch(offlineCaching, (v, was) => {
  if (was && !v) {
    const url = offlineCacheProgress.value.chapterUrl;
    if (url) markChapterCached(url);
  }
});

const inBookshelf = computed(() =>
  isInBookshelf(props.detail.bookUrl, props.item.origin),
);

function onOpenTextReplace() {
  emit("openTextReplace");
}

const fullscreenSidebarPopoversSuppressCollapse = ref(false);
const readerEditMode = ref(false);
const prepareFullscreenExitViewportPreserveSlot = {
  run: () => {},
};
const chrome = useAppReaderChrome({
  readerRef,
  fullscreenSidebarPopoversSuppressCollapse,
  readerEditMode,
  prepareFullscreenExitViewportPreserve: () =>
    prepareFullscreenExitViewportPreserveSlot.run(),
});
const {
  readerHudTipVisible,
  readerHudTipFading,
  readerHudTipText,
  showReaderHudTip,
} = useReaderHudTip();
const {
  isFullscreenView,
  isMinimalistView,
  chromeAutoHide,
  toggleMinimalistView,
  showFullscreenTip,
  fullscreenTipFading,
  fullscreenTipText,
  showFullscreenHeader,
  fullscreenHeaderOverlayRef,
  showFullscreenFooter,
  fullscreenFooterOverlayRef,
  showFullscreenSidebar,
  fullscreenSidebarOverlayRef,
  resizingSidebar,
  enterOrExitFullscreenView,
  startResizeSidebar,
  endSidebarResize,
  updateFullscreenSidebarHover,
  onFullscreenSidebarMouseLeave,
  updateFullscreenHeaderHover,
  onFullscreenHeaderMouseLeave,
  updateFullscreenFooterHover,
  onFullscreenFooterMouseLeave,
  dismissFullscreenPanelsOnLayoutPointerDown,
  dismissFullscreenChromeForNativeExit,
  handleReaderChromeEscape,
  revealFullscreenSidebar,
  fullscreenCursorHidden,
  bumpFullscreenCursorIdle,
  recordFullscreenPointer,
  sidebarWidth: chromeSidebarWidth,
} = chrome;
const fullscreenViewportPreserve = useFullscreenViewportPreserve({
  readerRef,
  isFullscreenView,
});
const {
  enabled: fullscreenViewportPreserveEnabled,
  suppressViewportProgressUpdates,
  noteStableAnchor: noteFullscreenViewportStableAnchor,
  prepareFullscreenExit,
  onPossibleFullscreenTransitionResize,
  ensureExitAnchorBeforeChromeChange,
  restoreAfterLeave: restoreFullscreenViewportAfterLeave,
  onFullscreenEntered,
} = fullscreenViewportPreserve;
if (fullscreenViewportPreserveEnabled) {
  prepareFullscreenExitViewportPreserveSlot.run = prepareFullscreenExit;
}

isMinimalistView.value = findBookSettings.isMinimalistView.value;

const readerPaneWrapRef = useTemplateRef<HTMLElement>("readerPaneWrapRef");
const {
  fullscreenReaderPaneStyle,
  onLayoutMouseDown: onFullscreenLayoutMouseDown,
  onLayoutContextMenu: onFullscreenLayoutContextMenu,
  onLayoutWheel: onFullscreenLayoutWheel,
} = useAppFullscreenReaderLayout({
  isFullscreenView,
  readerRef,
  fullscreenSidebarOverlayRef,
  fullscreenReaderWidthPercent,
  readerPaneWrapRef,
});

const CHAPTER_ADVANCE_WHEEL_THRESHOLD = 260;
let chapterAdvanceLockTimer: number | null = null;
let wheelDeltaResetTimer: number | null = null;
let accumulatedWheelDelta = 0;
let accumulatedWheelDirection: 1 | -1 | 0 = 0;

function resetChapterAdvanceWheelAccumulation() {
  if (wheelDeltaResetTimer !== null) {
    window.clearTimeout(wheelDeltaResetTimer);
    wheelDeltaResetTimer = null;
  }
  accumulatedWheelDelta = 0;
  accumulatedWheelDirection = 0;
}

/**
 * 已在章节边界时，用户再次向下/向上滚动或翻页则切章。
 * 阅读尺开启时看尺能否再沿该方向移动；关闭时看视口是否贴边。
 * 定时滚动和语音朗读续章仍走各自逻辑。
 */
function tryAdvanceChapterFromOverscroll(direction: 1 | -1): boolean {
  if (!findBookChapterAdvanceEnabled.value) return false;
  if (chapterAdvanceLockTimer !== null) return false;
  if (
    chapterContentBusy.value ||
    readerEditMode.value ||
    voiceRead.isVoiceReadNavigationBlocked.value
  ) {
    return false;
  }
  const goingDown = direction === 1;
  const rulerOn = readerRef.value?.isReadingRulerActive?.() === true;
  const atEdge = rulerOn
    ? readerRef.value?.readingRulerCannotMove?.(direction) === true
    : goingDown
      ? viewportAtBottom.value
      : viewportTopLine.value <= 1;
  const canGo = goingDown ? canGoNextChapter.value : canGoPrevChapter.value;
  if (!atEdge || !canGo) return false;

  chapterAdvanceLockTimer = window.setTimeout(() => {
    chapterAdvanceLockTimer = null;
  }, 80);
  resetChapterAdvanceWheelAccumulation();
  const targetIndex = displayIndexForReadingOrder(
    currentReadingOrderIndex.value + direction,
    displayChapters.value.length,
    chapterSortDesc.value,
  );
  void loadChapterAtDisplayIndex(targetIndex, {
    scrollTo: goingDown ? "top" : "bottom",
  });
  return true;
}

/**
 * 书架在线阅读：正文已经到达本章边界后，用户再次滚动时进入邻章。
 * 只处理正文区域，避免滚动章节侧栏时意外跳章。
 */
function onLayoutWheel(ev: WheelEvent) {
  onFullscreenLayoutWheel(ev);
  if (!readerPaneWrapRef.value || ev.deltaY === 0) return;
  if (!(ev.target instanceof Node) || !readerPaneWrapRef.value.contains(ev.target)) return;
  if (!findBookChapterAdvanceEnabled.value) return;
  if (
    chapterContentBusy.value ||
    readerEditMode.value ||
    voiceRead.isVoiceReadNavigationBlocked.value
  ) {
    return;
  }

  // 一个连续滚轮手势可能产生多个 wheel 事件，只允许合并后的动作触发一次。
  if (chapterAdvanceLockTimer !== null) return;
  const direction: 1 | -1 = ev.deltaY > 0 ? 1 : -1;
  if (accumulatedWheelDirection !== direction) {
    accumulatedWheelDirection = direction;
    accumulatedWheelDelta = 0;
  }
  accumulatedWheelDelta += Math.abs(ev.deltaY);

  if (wheelDeltaResetTimer !== null) window.clearTimeout(wheelDeltaResetTimer);
  wheelDeltaResetTimer = window.setTimeout(() => {
    wheelDeltaResetTimer = null;
    accumulatedWheelDelta = 0;
    accumulatedWheelDirection = 0;
  }, 180);

  // 小幅滚动只用于阅读，不触发章节切换；需要明显的大幅度连续滚动。
  if (accumulatedWheelDelta < CHAPTER_ADVANCE_WHEEL_THRESHOLD) return;
  tryAdvanceChapterFromOverscroll(direction);
}

onBeforeUnmount(() => {
  if (chapterAdvanceLockTimer !== null) window.clearTimeout(chapterAdvanceLockTimer);
  resetChapterAdvanceWheelAccumulation();
});

const sidebarShellVisible = computed(() =>
  !chromeAutoHide.value ? showSidebar.value : showFullscreenSidebar.value,
);

const chapterNavUiVisible = computed(
  () =>
    chapterNavToolbarEnabled.value &&
    displayChapters.value.length > 1 &&
    !isVoiceReadActive.value,
);

const chapterNavVisible = computed(
  () =>
    chapterNavUiVisible.value &&
    (!chromeAutoHide.value || showFullscreenFooter.value),
);

function setFullscreenHeaderOverlayEl(
  el: Element | ComponentPublicInstance | null,
) {
  if (el == null) {
    fullscreenHeaderOverlayRef.value = null;
    return;
  }
  fullscreenHeaderOverlayRef.value =
    el instanceof HTMLElement
      ? el
      : ((el as ComponentPublicInstance).$el as HTMLElement | null);
}

function setFullscreenFooterOverlayEl(
  el: Element | ComponentPublicInstance | null,
) {
  if (el == null) {
    fullscreenFooterOverlayRef.value = null;
    return;
  }
  fullscreenFooterOverlayRef.value =
    el instanceof HTMLElement
      ? el
      : ((el as ComponentPublicInstance).$el as HTMLElement | null);
}

function onLayoutMouseDown(ev: MouseEvent) {
  const raw = ev.target;
  const footer = fullscreenFooterOverlayRef.value;
  if (
    chromeAutoHide.value &&
    raw instanceof Node &&
    footer &&
    (footer === raw || footer.contains(raw))
  ) {
    return;
  }
  dismissFullscreenPanelsOnLayoutPointerDown(ev);
  onFullscreenLayoutMouseDown(ev);
}

const breadcrumbSourceName = computed(() => props.item.originName?.trim() ?? "");
/** 顶栏/正文加载遮罩：目录拉取中（不含侧栏「重新获取目录」） */
const readerBootLoading = computed(() => props.tocLoading);

watch(
  () => props.item.origin?.trim() ?? "",
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

watch(
  () =>
    [
      props.detail.bookUrl,
      props.chapters,
      effectiveCacheDir.value,
    ] as const,
  () => {
    void refreshChapterCacheStatus();
  },
  { immediate: true },
);

const displayChapters = computed(() =>
  sortContentChaptersDisplay(contentChapters.value, chapterSortDesc.value),
);

/** 对齐 Legado ReadMenu：有 loginUrl 且当前章 VIP 未购买时显示「购买」 */
const showChapterPayBtn = computed(() => {
  if (!sourceNeedsLogin.value) return false;
  const ch = displayChapters.value[currentDisplayIndex.value];
  if (!ch) return false;
  return Boolean(ch.isVip) && !ch.isPay;
});

const convertedChapterTitlesByIndex = ref(new Map<number, string>());
let convertedChapterTitlesGen = 0;

function chapterDisplayBaseTitle(index: number): string {
  const ch = displayChapters.value[index];
  if (!ch) return "";
  return convertedChapterTitlesByIndex.value.get(index) ?? ch.title;
}

function chapterDisplayTitle(index: number): string {
  const ch = displayChapters.value[index];
  if (!ch) return "";
  const base = chapterDisplayBaseTitle(index);
  const tag = showChapterTag.value ? (ch.tag?.trim() ?? "") : "";
  return tag ? `${base}\n${tag}` : base;
}

const chapterListRowStride = computed(() =>
  showChapterTag.value &&
  displayChapters.value.some((ch) => ch.tag?.trim())
    ? READER_SIDEBAR_ROW_STRIDE_WITH_TAG
    : READER_SIDEBAR_ROW_STRIDE,
);

const hasChapterTags = computed(() =>
  displayChapters.value.some((ch) => Boolean(ch.tag?.trim())),
);

function toggleShowChapterTag() {
  showChapterTag.value = !showChapterTag.value;
  findBookSettings.persistAll();
}
const sidebarPanelWidth = computed(() =>
  Math.max(FIND_BOOK_SIDEBAR_MIN_WIDTH, sidebarWidth.value),
);

function getSidebarMaxTotalWidth(): number {
  const sidebarLeft =
    fullscreenSidebarOverlayRef.value?.getBoundingClientRect().left ?? 0;
  return Math.max(
    FIND_BOOK_SIDEBAR_MIN_WIDTH,
    window.innerWidth - SIDEBAR_MIN_READER_WIDTH - sidebarLeft,
  );
}

function clampSidebarWidthToViewport(): void {
  sidebarWidth.value = Math.min(
    getSidebarMaxTotalWidth(),
    Math.max(FIND_BOOK_SIDEBAR_MIN_WIDTH, sidebarWidth.value),
  );
}

function displayIndexForContentIndex(contentIndex: number): number {
  const ch = contentChapters.value[contentIndex];
  if (!ch) return 0;
  const idx = displayChapters.value.findIndex((c) => c.url === ch.url);
  return idx >= 0 ? idx : 0;
}

async function scrollChapterListToCurrent(options?: {
  force?: boolean;
  smooth?: boolean;
}): Promise<void> {
  const { force = false, smooth = false } = options ?? {};
  await nextTick();
  await chapterListRef.value?.scrollToIndex(currentDisplayIndex.value, {
    align: "center",
    force,
    behavior: smooth ? "smooth" : "auto",
  });
}

function onFindBookLayoutViewportRestored() {
  void scrollChapterListToCurrent({ force: true, smooth: false });
}

/** 进入编辑前退出朗读 / 停止定时滚动（voice/timed 创建后回填） */
let exitVoiceRead = () => {};
let stopTimedScroll = () => {};

const {
  readerContentKey,
  lastChapterTitle,
  lastChapterBody,
  lastRenderedReaderText,
  totalLineCount,
  readerChapterSaving,
  loading,
  showChapterLoadingUi,
  chapterLoading,
  chapterError,
  logs,
  cancelChapterLoad,
  chapterContentBusy,
  textReplaceActive,
  refreshReplaceRulesCache,
  ensureReplaceRulesCache,
  applyDisplayReplaceTitle,
  canEnterReaderEditMode,
  confirmIfReaderEditDiscard,
  onReaderEditDirtyChange,
  onToggleReaderEdit,
  onSaveReaderChapter,
  onApplyPartialPhysicalEdit,
  loadChapterAtDisplayIndex,
  isChapterLoading,
  refreshCurrentChapterDisplay,
  resetChapterSessionUi,
  clearReaderEditFlags,
  contentIndexFor,
  viewportDisplayLineToPhysicalLine,
  getPhysicalLineContent,
} = useFindBookChapterSession({
  readerRef,
  readerEditMode,
  detail: () => props.detail,
  item: () => props.item,
  displayChapters,
  contentChapters,
  chapterSortDesc,
  currentDisplayIndex,
  readerBootLoading,
  textConvertZh,
  textConvertLetter,
  textConvertDigit,
  compressBlankLines,
  compressBlankKeepOneBlank,
  chapterTitleBlankMode,
  leadIndentFullWidth,
  chapterMinCharCount,
  effectiveCacheDir,
  isChapterCached,
  markChapterCached,
  isInBookshelf,
  updateReadProgress,
  scrollChapterListToCurrent,
  exitVoiceRead: () => exitVoiceRead(),
  stopTimedScroll: () => stopTimedScroll(),
  readingRulerEnabled,
  isVoiceReadActive: () => isVoiceReadActive.value,
});

async function onReplaceRulesChanged() {
  await refreshReplaceRulesCache();
  if (!modelValue.value || readerEditMode.value) return;
  void refreshCurrentChapterDisplay();
  void refreshConvertedChapterTitles();
}

const hasReaderLogs = computed(() => logs.value.length > 0);
const showReaderLogBtn = computed(
  () => Boolean(chapterError.value) || hasReaderLogs.value,
);
const readerLogHasError = computed(() => Boolean(chapterError.value));

function textConvertOptions() {
  return {
    zh: textConvertZh.value,
    letter: textConvertLetter.value,
    digit: textConvertDigit.value,
  };
}

async function refreshConvertedChapterTitles() {
  const gen = ++convertedChapterTitlesGen;
  await ensureReplaceRulesCache();
  if (gen !== convertedChapterTitlesGen) return;
  const opts = textConvertOptions();
  const next = new Map<number, string>();
  const list = displayChapters.value;
  for (let i = 0; i < list.length; i++) {
    if (gen !== convertedChapterTitlesGen) return;
    const titled = applyDisplayReplaceTitle(list[i]!.title);
    next.set(i, await applyTextDisplayConverts(titled, opts));
  }
  if (gen !== convertedChapterTitlesGen) return;
  convertedChapterTitlesByIndex.value = next;
}

const MAX_CHAPTER_LIST_LAYOUT_RETRIES = 48;
const FLUSH_CHAPTER_LIST_AFTER_FULLSCREEN_MS = 50;

async function waitChapterListLayoutFrames(frameCount = 2): Promise<void> {
  let left = Math.max(0, Math.floor(frameCount));
  await new Promise<void>((resolve) => {
    const step = () => {
      if (left <= 0) {
        resolve();
        return;
      }
      left -= 1;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** 全屏切换后：当前章滚到列表视口垂直居中（侧栏隐藏时仍写入 VirtualList scrollTop） */
async function centerChapterListInSidebar(layoutRetry = 0): Promise<void> {
  await nextTick();
  await waitChapterListLayoutFrames(2);
  const idx = currentDisplayIndex.value;
  if (idx < 0 || !displayChapters.value.length) return;

  const vl = chapterListRef.value;
  if (!vl) {
    if (layoutRetry < MAX_CHAPTER_LIST_LAYOUT_RETRIES) {
      requestAnimationFrame(() => void centerChapterListInSidebar(layoutRetry + 1));
    }
    return;
  }

  vl.scrollToIndex(idx, {
    align: "center",
    behavior: "auto",
    force: true,
  });
}

function pulseChapterListCenter() {
  void nextTick(() => {
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        void centerChapterListInSidebar();
      }, FLUSH_CHAPTER_LIST_AFTER_FULLSCREEN_MS);
    });
  });
}

watch(showFullscreenSidebar, (visible) => {
  if (visible && chromeAutoHide.value) {
    pulseChapterListCenter();
  }
});

watch(chromeAutoHide, (hidden, wasHidden) => {
  if (!wasHidden || hidden) return;
  pulseChapterListCenter();
});

function toggleChapterSort() {
  const current = displayChapters.value[currentDisplayIndex.value];
  chapterSortDesc.value = !chapterSortDesc.value;
  if (current) {
    const nextIdx = displayChapters.value.findIndex((c) => c.url === current.url);
    if (nextIdx >= 0) currentDisplayIndex.value = nextIdx;
  }
  scrollChapterListToCurrent({ force: true, smooth: true });
}

function onWindowMouseMove(ev: MouseEvent) {
  if (resizingSidebar.value) {
    const sidebar = fullscreenSidebarOverlayRef.value;
    if (!sidebar) return;
    const rect = sidebar.getBoundingClientRect();
    const panelWidth = ev.clientX - rect.left;
    sidebarWidth.value = Math.min(
      getSidebarMaxTotalWidth(),
      Math.max(FIND_BOOK_SIDEBAR_MIN_WIDTH, panelWidth),
    );
    return;
  }
  updateFullscreenHeaderHover(ev);
  updateFullscreenFooterHover(ev);
  updateFullscreenSidebarHover(ev);
  if (chromeAutoHide.value) {
    recordFullscreenPointer(ev);
    bumpFullscreenCursorIdle();
  }
}

function onWindowMouseUp() {
  const wasResizing = resizingSidebar.value;
  endSidebarResize();
  if (wasResizing) findBookSettings.persistAll();
}

const readerUi = useAppReaderUiPrefs({
  readerRef,
  readerFontSize,
  readerLineHeightMultiple,
  readerLineSpacingPx,
  readerLetterSpacingPx,
  readerHorizontalInsetPx,
  monacoFontFamily,
  pinnedOtherFonts,
  monacoCustomHighlight,
  monacoAdvancedWrapping,
  compressBlankLines,
  leadIndentFullWidth,
  textConvertZh,
  textConvertLetter,
  textConvertDigit,
  withChapterListScrollSuppressed: async (fn) => fn(),
  currentFile: readerContentKey,
  stream: {
    applyDisplayPipelineToFullText: async (text: string) => text,
    reloadReaderFromPhysicalText: async () => {},
  } as never,
  syncChaptersAfterViewportSettled: () => {},
  persistSettings: persistReaderUiPrefs,
  isFullscreenView,
  showFullscreenHeader,
  viewportTopLine,
  viewportEndLine,
  viewportVisualProgressPercent,
  viewportAtBottom,
  suppressViewportProgressUpdates,
  noteFullscreenViewportStableAnchor,
  showReaderHudTip,
});

const emptyCharacterRoster = ref<readonly never[]>([]);

let offFullscreen: (() => void) | null = null;

function applySharedSettingsFromMain() {
  syncSharedSettingsFromMain();
  if (!modelValue.value) return;
  applyAppShellTheme(currentTheme.value);
  applyReaderAppearance();
}

function onStorageSync(ev: StorageEvent) {
  if (ev.storageArea !== localStorage) return;
  if (ev.key === persistKey) {
    applySharedSettingsFromMain();
  }
}

function onPersistedSettingsChanged() {
  applySharedSettingsFromMain();
}

function syncFooterLineCountFromReader() {
  const n = readerRef.value?.getModelLineCount?.();
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
    totalLineCount.value = n;
  }
}

function onFindBookViewportEndLineChange(line: number) {
  readerUi.onViewportEndLineChange(line);
  syncFooterLineCountFromReader();
}

function onChapterClick(index: number) {
  if (voiceRead.isVoiceReadNavigationBlocked.value) return;
  if (index === currentDisplayIndex.value && !loading.value && !chapterLoading.value)
    return;
  void loadChapterAtDisplayIndex(index);
}

const currentReadingOrderIndex = computed(() =>
  readingOrderIndexFromDisplay(
    currentDisplayIndex.value,
    displayChapters.value.length,
    chapterSortDesc.value,
  ),
);

const footerReadingProgress = computed(() => {
  const totalChapters = displayChapters.value.length;
  const hasContent = Boolean(readerContentKey.value);
  if (!hasContent || totalChapters <= 0 || currentReadingOrderIndex.value < 0) {
    return {
      percentPart: "-",
      detailPart: "",
      placeholder: true,
      complete: false,
    };
  }
  const chapterRo1 = currentReadingOrderIndex.value + 1;
  const percentValue = floorReadingProgressPercentByLines(
    chapterRo1,
    totalChapters,
  );
  const totalLines = Math.max(0, totalLineCount.value);
  const currentLine =
    totalLines > 0
      ? Math.min(totalLines, Math.max(1, viewportEndLine.value))
      : 0;
  const percent = percentValue.toFixed(1).replace(/\.0$/, "");
  return {
    percentPart: `${percent}%`,
    detailPart: ` (${chapterRo1}/${totalChapters}，${currentLine}/${totalLines})`,
    placeholder: false,
    complete: chapterRo1 >= totalChapters,
  };
});

const footerChapterCharCountText = computed(() =>
  formatCharCount(countCharsForLine(lastChapterBody.value)),
);

const footerHasContent = computed(() => Boolean(readerContentKey.value));
const footerLoading = computed(
  () => readerBootLoading.value || showChapterLoadingUi.value,
);

const canGoPrevChapter = computed(() => currentReadingOrderIndex.value > 0);
const canGoNextChapter = computed(
  () =>
    currentReadingOrderIndex.value >= 0 &&
    currentReadingOrderIndex.value < displayChapters.value.length - 1,
);

/** 阅读顺序上一章 / 下一章（与 content 数组正倒序、侧栏展示排序解耦） */
function goToPrevChapter() {
  if (!canGoPrevChapter.value || chapterNavBusy.value) return;
  void loadChapterAtDisplayIndex(
    displayIndexForReadingOrder(
      currentReadingOrderIndex.value - 1,
      displayChapters.value.length,
      chapterSortDesc.value,
    ),
  );
}

function goToNextChapter() {
  if (!canGoNextChapter.value || chapterNavBusy.value) return;
  void loadChapterAtDisplayIndex(
    displayIndexForReadingOrder(
      currentReadingOrderIndex.value + 1,
      displayChapters.value.length,
      chapterSortDesc.value,
    ),
  );
}

/** 定时滚动 / 语音朗读续章：不受「朗读中禁止跳转」限制 */
function advanceToNextChapterForAutoRead() {
  if (!canGoNextChapter.value || chapterContentBusy.value) return;
  void loadChapterAtDisplayIndex(
    displayIndexForReadingOrder(
      currentReadingOrderIndex.value + 1,
      displayChapters.value.length,
      chapterSortDesc.value,
    ),
  );
}

const voiceRead = useAppVoiceRead({
  readerRef,
  voiceReadSettings,
  voiceReadProfiles,
  activeVoiceReadProfileId,
  currentFile: readerContentKey,
  loading: chapterContentBusy,
  readerEditMode,
  monacoSmoothScrolling,
  aiFeaturesEnabled,
  characterRoster: emptyCharacterRoster,
  continueAtDocumentEnd: true,
  pauseOnLoading: true,
  canAdvanceToNextDocument: () => canGoNextChapter.value,
  onDocumentEnd: () => {
    advanceToNextChapterForAutoRead();
  },
});
exitVoiceRead = () => voiceRead.exitVoiceRead();

const isVoiceReadActive = voiceRead.isVoiceReadActive;
const isVoiceReadScrollLocked = voiceRead.isVoiceReadScrollLocked;
const isVoiceReadBlocksFind = voiceRead.isVoiceReadBlocksFind;
const canStartVoiceRead = voiceRead.canStartVoiceRead;

const chapterNavBusy = computed(
  () =>
    chapterContentBusy.value ||
    (isVoiceReadActive.value && voiceRead.mode.value === "playing"),
);

function jumpToPrevChapterWithShortcut() {
  if (voiceRead.isVoiceReadNavigationBlocked.value) return;
  goToPrevChapter();
}

function jumpToNextChapterWithShortcut() {
  if (voiceRead.isVoiceReadNavigationBlocked.value) return;
  goToNextChapter();
}

const canEnterStealth = computed(() => {
  if (chapterContentBusy.value || readerBootLoading.value) return false;
  if (chapterError.value && !readerContentKey.value) return false;
  return Boolean(lastChapterBody.value?.trim());
});

async function resolveFindBookReaderAreaScreenBounds(): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  const dom = readerRef.value?.getReaderEditorDomNode?.() ?? null;
  if (!dom) return null;
  const r = dom.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  const content = await window.colorTxt.getWindowContentBounds();
  const originX = content?.x ?? window.screenX;
  const originY = content?.y ?? window.screenY;
  return {
    x: Math.round(originX + r.left),
    y: Math.round(originY + r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

function buildStealthPayloadFromCurrentChapter(
  startLine: number,
  opts?: { anchor?: "start" | "end" },
): StealthPagePayload | null {
  // 优先用最近渲染正文：源窗在摸鱼期间被 hide，Monaco getAllText 可能仍是旧章
  const body =
    lastRenderedReaderText.value.trim() ||
    readerRef.value?.getAllText?.()?.trim() ||
    "";
  if (!body) return null;
  const ch = displayChapters.value[currentDisplayIndex.value];
  const title =
    (ch?.title || lastChapterTitle.value || "当前章节").trim() || "当前章节";
  return {
    text: body,
    startLine: Math.max(1, Math.floor(startLine) || 1),
    chapters: [{ title, lineNumber: 1 }],
    anchor: opts?.anchor === "end" ? "end" : "start",
    hasPrevChapter: hasAdjacentContentChapter(-1),
    hasNextChapter: hasAdjacentContentChapter(1),
  };
}

function hasAdjacentContentChapter(direction: 1 | -1): boolean {
  let readingIdx = currentReadingOrderIndex.value + direction;
  while (
    readingIdx >= 0 &&
    readingIdx < displayChapters.value.length
  ) {
    const di = displayIndexForReadingOrder(
      readingIdx,
      displayChapters.value.length,
      chapterSortDesc.value,
    );
    const ch = displayChapters.value[di];
    if (ch && contentIndexFor(ch) >= 0) return true;
    readingIdx += direction;
  }
  return false;
}

async function enterStealthMode() {
  if (!canEnterStealth.value) return;
  const startLine = readerRef.value?.getViewportTopLine?.() ?? 1;
  const page = buildStealthPayloadFromCurrentChapter(startLine);
  if (!page) {
    appToast("没有可阅读的正文", { kind: "warning", duration: 2000 });
    return;
  }
  const saved = loadStealthReaderSettings();
  const bounds =
    saved.bounds ??
    (await resolveFindBookReaderAreaScreenBounds()) ??
    undefined;
  const result = await window.colorTxt.stealthReaderEnter({
    ...page,
    bounds,
    exitAccelerator: shortcutBindings.value.enterStealthReader || "F9",
    navShortcuts: saved.shortcuts,
  });
  if (!result?.ok) {
    appToast(result?.message || "无法进入摸鱼模式", {
      kind: "warning",
      duration: 2200,
    });
  }
}

async function onStealthOwnerChapterNav(
  direction: "prev" | "next",
  anchor: "start" | "end" = "start",
) {
  const settleFail = () => {
    window.colorTxt.stealthReaderChapterNavSettled();
  };
  if (chapterNavBusy.value) {
    settleFail();
    return;
  }
  const step = direction === "next" ? 1 : -1;
  let readingIdx = currentReadingOrderIndex.value + step;
  let targetIndex = -1;
  while (
    readingIdx >= 0 &&
    readingIdx < displayChapters.value.length
  ) {
    const di = displayIndexForReadingOrder(
      readingIdx,
      displayChapters.value.length,
      chapterSortDesc.value,
    );
    const ch = displayChapters.value[di];
    if (ch && contentIndexFor(ch) >= 0) {
      targetIndex = di;
      break;
    }
    readingIdx += step;
  }
  if (targetIndex < 0) {
    settleFail();
    return;
  }
  const scrollTo =
    direction === "prev" && anchor === "end" ? "bottom" : "top";
  await loadChapterAtDisplayIndex(targetIndex, {
    smoothScroll: false,
    scrollTo,
  });
  await nextTick();
  const page = buildStealthPayloadFromCurrentChapter(1, {
    anchor: direction === "prev" && anchor === "end" ? "end" : "start",
  });
  if (!page) {
    settleFail();
    return;
  }
  const result = await window.colorTxt.stealthReaderUpdatePayload(page);
  if (!result?.ok) {
    console.warn("[findBook] stealth updatePayload failed", result?.message);
    settleFail();
  }
}

let offStealthOwnerProgress: (() => void) | null = null;
let offStealthOwnerChapterNav: (() => void) | null = null;

const { shortcutBindings } = useFindBookReaderShortcuts({
  readerOpen: modelValue,
  readerRef,
  increaseFontSize: () => readerUi.increaseFontSize(),
  decreaseFontSize: () => readerUi.decreaseFontSize(),
  increaseLineHeight: () => readerUi.increaseLineHeight(),
  decreaseLineHeight: () => readerUi.decreaseLineHeight(),
  increaseLetterSpacing: () => readerUi.increaseLetterSpacing(),
  decreaseLetterSpacing: () => readerUi.decreaseLetterSpacing(),
  increaseParagraphSpacing: () => readerUi.increaseParagraphSpacing(),
  decreaseParagraphSpacing: () => readerUi.decreaseParagraphSpacing(),
  increaseHorizontalInset: () => readerUi.increaseHorizontalInset(),
  decreaseHorizontalInset: () => readerUi.decreaseHorizontalInset(),
  jumpToPrevChapter: jumpToPrevChapterWithShortcut,
  jumpToNextChapter: jumpToNextChapterWithShortcut,
  toggleSidebar: () => onToggleSidebar(),
  toggleMinimalistView: () => onToggleMinimalist(),
  toggleFullscreen: () => void toggleFullscreen(),
  isVoiceReadScrollLocked,
  isVoiceReadBlocksFind,
  isVoiceReadActive,
  onVoiceReadTogglePlayPause: () => voiceRead.togglePlayPause(),
  onVoiceReadPlayPrevLine: () => voiceRead.playPrevLine(),
  onVoiceReadPlayNextLine: () => voiceRead.playNextLine(),
  toggleReaderEdit: onToggleReaderEdit,
  readerEditMode,
  tryAdvanceChapterOnScroll: tryAdvanceChapterFromOverscroll,
  enterStealthReader: () => {
    void enterStealthMode();
  },
});

const isMacPlatform = /mac|iphone|ipad|ipod/i.test(navigator.platform || "");
const settingsShortcutLabel = computed(() =>
  acceleratorToDisplayText(shortcutBindings.value.openSettings, isMacPlatform),
);
const colorSchemeShortcutLabel = computed(() =>
  acceleratorToDisplayText(
    shortcutBindings.value.openColorScheme,
    isMacPlatform,
  ),
);
const findShortcutLabel = computed(() =>
  acceleratorToDisplayText(shortcutBindings.value.toggleFind, isMacPlatform),
);
const themeShortcutLabel = computed(() =>
  acceleratorToDisplayText(shortcutBindings.value.toggleTheme, isMacPlatform),
);

watch(
  () => [modelValue.value, props.detail.name] as const,
  ([open, name]) => {
    window.colorTxt.setWindowTitle(
      open ? formatFindBookWindowTitle(name) : FIND_BOOK_WINDOW_TITLE,
    );
  },
  { immediate: true },
);

const timedScroll = useAppTimedScroll({
  readerRef,
  timedScrollSettings,
  currentFile: readerContentKey,
  loading: chapterContentBusy,
  readerEditMode,
  viewportAtBottom,
  isVoiceReadActive: voiceRead.isVoiceReadActive,
  continueAtBottom: true,
  pauseOnLoading: true,
  canStartDespiteBottom: () => canGoNextChapter.value,
  onAtBottomTick: () => {
    advanceToNextChapterForAutoRead();
  },
});
stopTimedScroll = () => timedScroll.stopTimedScroll();

const isTimedScrollActive = timedScroll.isTimedScrollActive;
const canStartTimedScroll = timedScroll.canStartTimedScroll;

function onFindBookProbeLineChange(
  _probeLine: number,
  _fromReadingScroll?: boolean,
  fromAnyScroll?: boolean,
) {
  if (fromAnyScroll === true) timedScroll.nudgeTimedScrollTimer();
}

function toggleReaderClickMode() {
  readerClickMode.value = !readerClickMode.value;
  persistReaderUiPrefs();
}

function toggleReadingRuler() {
  if (isVoiceReadActive.value) return;
  readingRulerEnabled.value = !readingRulerEnabled.value;
  persistReaderUiPrefs();
}

const { effectiveClickMode, clickModeAltHeld } = useReaderClickModeAltHold({
  persistedClickMode: readerClickMode,
  readerEditMode,
  enabled: modelValue,
});

async function toggleCompressBlankLines() {
  if (readerEditMode.value) {
    void readerRef.value?.applyEditFormatCompressBlankLines?.(
      compressBlankKeepOneBlank.value,
      chapterTitleBlankMode.value,
    );
    return;
  }
  compressBlankLines.value = !compressBlankLines.value;
  persistReaderUiPrefs();
  await refreshCurrentChapterDisplay();
}

async function toggleLeadIndentFullWidth() {
  if (readerEditMode.value) {
    void readerRef.value?.applyEditFormatLeadIndentFullWidth?.();
    return;
  }
  leadIndentFullWidth.value = !leadIndentFullWidth.value;
  persistReaderUiPrefs();
  await refreshCurrentChapterDisplay();
}

async function setTextConvertZhRead(mode: typeof textConvertZh.value) {
  if (textConvertZh.value === mode) return;
  textConvertZh.value = mode;
  persistReaderUiPrefs();
  await refreshCurrentChapterDisplay();
}

async function setTextConvertLetterRead(mode: typeof textConvertLetter.value) {
  if (textConvertLetter.value === mode) return;
  textConvertLetter.value = mode;
  persistReaderUiPrefs();
  await refreshCurrentChapterDisplay();
}

async function setTextConvertDigitRead(mode: typeof textConvertDigit.value) {
  if (textConvertDigit.value === mode) return;
  textConvertDigit.value = mode;
  persistReaderUiPrefs();
  await refreshCurrentChapterDisplay();
}

function onFormatEditCompressBlankLines() {
  void readerRef.value?.applyEditFormatCompressBlankLines?.(
    compressBlankKeepOneBlank.value,
    chapterTitleBlankMode.value,
  );
}

function onFormatEditLeadIndentFullWidth() {
  void readerRef.value?.applyEditFormatLeadIndentFullWidth?.();
}

function onApplyTextConvertZhEdit(mode: Exclude<TextConvertZhMode, "off">) {
  void readerRef.value?.applyEditFormatTextConvertZh?.(mode);
}

function onApplyTextConvertLetterEdit(
  mode: Exclude<TextConvertWidthMode, "off">,
) {
  void readerRef.value?.applyEditFormatTextConvertLetters?.(mode);
}

function onApplyTextConvertDigitEdit(
  mode: Exclude<TextConvertWidthMode, "off">,
) {
  void readerRef.value?.applyEditFormatTextConvertDigits?.(mode);
}

async function onBack() {
  if (!(await confirmIfReaderEditDiscard())) return;
  clearReaderEditFlags();
  voiceRead.exitVoiceRead();
  timedScroll.stopTimedScroll();
  cancelChapterLoad();
  modelValue.value = false;
}

function onOpenBookDetail() {
  closeTopMoreMenu();
  emit("openBookDetail");
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

async function onCopyChapterUrl() {
  closeTopMoreMenu();
  const ch = displayChapters.value[currentDisplayIndex.value];
  await copyText("正文 URL", ch?.url ?? "");
}

function onEditBookSource() {
  closeTopMoreMenu();
  const origin = props.item.origin?.trim();
  if (!origin) {
    appToast("书源不存在", { kind: "warning" });
    return;
  }
  editingSourceUrl.value = origin;
  editSourceInitialTab.value = "content";
  showEditSource.value = true;
}

async function onLogin() {
  const origin = props.item.origin?.trim();
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

/** 对齐 Legado ReadBookActivity.payAction：确认购买 → 执行 payAction */
async function onChapterPay() {
  if (payingChapter.value) return;
  const origin = props.item.origin?.trim();
  const ch = displayChapters.value[currentDisplayIndex.value];
  if (!origin || !ch) {
    appToast("当前没有可购买的章节", { kind: "warning" });
    return;
  }
  // 对齐 Legado alert(购买) + chapter.title
  const confirmed = await appConfirm(ch.title || "（无标题）", "购买");
  if (!confirmed) return;

  payingChapter.value = true;
  try {
    const bookUrl = props.detail.bookUrl?.trim() || props.item.bookUrl?.trim() || "";
    // IPC 只能传可结构化克隆的纯对象，需剥离 Vue 响应式代理
    const r = await window.colorTxt.bookSourcePayAction(
      JSON.parse(
        JSON.stringify({
          bookSourceUrl: origin,
          book: {
            ...props.detail,
            bookUrl,
            tocUrl: props.detail.tocUrl || bookUrl,
            kind: props.detail.kind || props.item.kind || "",
            name: props.detail.name || props.item.name,
            author: props.detail.author || props.item.author,
            origin,
            originName: props.item.originName,
          },
          chapter: ch,
          cacheDir: effectiveCacheDir.value.trim() || undefined,
        }),
      ),
    );
    if (r.logs?.length) logs.value = r.logs;
    if (!r.ok) {
      if (!r.cancelled && r.message) {
        appToast(r.message, { kind: "danger" });
      }
      return;
    }
    if (r.refresh) {
      await refreshTocAfterPay();
      await loadChapterAtDisplayIndex(currentDisplayIndex.value, {
        smoothScroll: false,
        preferCache: false,
      });
    }
  } catch (e) {
    appToast(e instanceof Error ? e.message : "购买失败", { kind: "danger" });
  } finally {
    payingChapter.value = false;
  }
}

async function onRefresh() {
  if (
    readerBootLoading.value ||
    chapterContentBusy.value ||
    refreshingChapter.value
  ) {
    return;
  }
  if (!displayChapters.value[currentDisplayIndex.value]) {
    appToast("当前没有可刷新的章节", { kind: "warning" });
    return;
  }
  refreshingChapter.value = true;
  try {
    await loadChapterAtDisplayIndex(currentDisplayIndex.value, {
      smoothScroll: false,
      preferCache: false,
    });
  } finally {
    refreshingChapter.value = false;
  }
}

async function onRefreshToc() {
  await refreshTocInternal({ announce: true });
}

/** 购买成功后刷新目录（对齐 Legado loadChapterList，不弹「无更新」） */
async function refreshTocAfterPay() {
  await refreshTocInternal({ announce: false });
}

async function refreshTocInternal(opts: { announce: boolean }) {
  if (refreshingToc.value || props.tocLoading || offlineCaching.value) {
    return;
  }
  const origin = props.item.origin?.trim();
  const bookUrl = props.detail.bookUrl?.trim() || props.item.bookUrl?.trim();
  if (!origin || !bookUrl) {
    appToast("书籍信息不完整，无法刷新目录", { kind: "warning" });
    return;
  }
  const currentUrl = displayChapters.value[currentDisplayIndex.value]?.url ?? "";
  refreshingToc.value = true;
  try {
    const bookPayload = ipcPlain({
      ...props.detail,
      bookUrl,
      tocUrl: props.detail.tocUrl || bookUrl,
      kind: props.detail.kind || props.item.kind || "",
      name: props.detail.name || props.item.name,
      author: props.detail.author || props.item.author,
      origin,
      originName: props.item.originName,
    });
    const tocRes = await window.colorTxt.bookSourceGetChapterList({
      bookSourceUrl: origin,
      book: bookPayload,
    });
    if (tocRes.logs?.length) logs.value = tocRes.logs;
    if (tocRes.message) {
      appToast(tocRes.message, { kind: "warning" });
      return;
    }
    const nextChapters = tocRes.chapters ?? [];
    const contentOnly = nextChapters.filter((ch) => !ch.isVolume);
    if (!contentOnly.length) {
      appToast("未获取到章节", { kind: "warning" });
      return;
    }
    // 内容章「最新在前」：与 resolveLatestChapterTitleFromToc / Legado 写回一致
    const prevLatest = contentChapters.value[0];
    const prevLatestTitle = prevLatest?.title?.trim() ?? "";
    const prevLatestUrl = prevLatest?.url ?? "";
    const latest = contentOnly[0]!;
    const latestTitle = latest.title?.trim() ?? "";
    const latestUrl = latest.url ?? "";
    const latestUnchanged =
      prevLatestUrl === latestUrl && prevLatestTitle === latestTitle;

    const nextDetail: Book = latestTitle
      ? { ...props.detail, lastChapter: latestTitle }
      : props.detail;
    updateFindBookBookshelfBookInfo(bookUrl, origin, {
      tocUrl: nextDetail.tocUrl,
      chapters: nextChapters,
      lastChapter: latestTitle,
    });
    emit("tocRefreshed", {
      detail: ipcPlain(nextDetail),
      chapters: nextChapters,
    });
    await nextTick();
    await refreshChapterCacheStatus();
    const nextDisplay = sortContentChaptersDisplay(
      contentOnly,
      chapterSortDesc.value,
    );
    // 只调整侧栏选中项，不重拉正文
    let idx = Math.min(
      currentDisplayIndex.value,
      Math.max(0, nextDisplay.length - 1),
    );
    if (currentUrl) {
      const found = nextDisplay.findIndex((ch) => ch.url === currentUrl);
      if (found >= 0) idx = found;
    }
    currentDisplayIndex.value = idx;
    void nextTick(() => scrollChapterListToCurrent({ smooth: false }));
    if (opts.announce) {
      if (latestUnchanged) {
        appToast("无更新", { kind: "info" });
      } else {
        appToast(`目录已更新，最新章节：${latestTitle || "（无标题）"}`, {
          kind: "success",
        });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[findBook] refreshToc", e);
    appToast(msg?.trim() ? `刷新目录失败：${msg}` : "刷新目录失败", {
      kind: "warning",
    });
  } finally {
    refreshingToc.value = false;
  }
}

function onEditSourceDone() {
  showEditSource.value = false;
  editingSourceUrl.value = null;
}

function onSearchFromEdit(item: {
  bookSourceUrl: string;
  bookSourceName: string;
}) {
  showEditSource.value = false;
  editingSourceUrl.value = null;
  emit("searchSource", item);
}

async function onClearChapterCache() {
  closeTopMoreMenu();
  const bookUrl = props.detail.bookUrl?.trim() || props.item.bookUrl?.trim();
  const name = props.detail.name?.trim() || props.item.name?.trim() || "";
  const cleared = await confirmClearBookChapterCache({
    name,
    bookUrl: bookUrl || "",
    cacheDir: effectiveCacheDir.value,
  });
  if (!cleared) return;
  clearChapterCacheMarks();
  emit("chapterCacheCleared");
}

async function onStopOfflineCache() {
  if (!offlineCaching.value) return;
  await cancelOfflineCache();
  appToast("已停止离线缓存", { kind: "warning" });
}

async function onStartOfflineCache() {
  if (offlineCaching.value) return;
  const bookUrl = props.detail.bookUrl?.trim() || props.item.bookUrl?.trim();
  if (!bookUrl || !props.item.origin?.trim()) {
    appToast("书籍信息不完整，无法缓存", { kind: "warning" });
    return;
  }
  const result = await startOfflineCacheDownload(
    {
      ...props.item,
      bookUrl,
      name: props.detail.name?.trim() || props.item.name,
      author: props.detail.author?.trim() || props.item.author,
    },
    "",
    effectiveCacheDir.value.trim() || undefined,
    { cacheOnly: true },
  );
  if (result !== null) {
    appToast("已完成离线缓存", { kind: "success", duration: 1200 });
    void refreshChapterCacheStatus();
  }
}

function buildShelfItem(): SearchBookItem {
  const variable = {
    ...(props.item.variable ?? {}),
    ...(props.detail.variable ?? {}),
  };
  return {
    ...props.item,
    name: props.detail.name,
    author: props.detail.author,
    intro: props.detail.intro ?? props.item.intro,
    coverUrl: props.detail.coverUrl || props.item.coverUrl,
    coverSourceUrl: props.detail.coverSourceUrl ?? props.item.coverSourceUrl,
    lastChapter: props.detail.lastChapter ?? props.item.lastChapter,
    kind: props.detail.kind ?? props.item.kind,
    wordCount: props.detail.wordCount ?? props.item.wordCount,
    bookUrl: props.detail.bookUrl,
    ...(Object.keys(variable).length ? { variable } : {}),
  };
}

function onToggleFindFromToolbar() {
  if (isVoiceReadBlocksFind.value) return;
  readerRef.value?.toggleFindWidget?.();
}

function onToggleBookshelf() {
  const item = buildShelfItem();
  const added = toggleBookshelf(item, {
    updateTime: props.detail.updateTime?.trim() || undefined,
  });
  if (added) {
    const ch = displayChapters.value[currentDisplayIndex.value];
    const contentIndex = ch ? contentIndexFor(ch) : -1;
    if (contentIndex >= 0) {
      updateReadProgress(
        props.detail.bookUrl,
        props.item.origin,
        contentIndex,
        ch.title,
      );
    }
    if (props.detail.tocUrl && props.chapters.length) {
      updateFindBookBookshelfBookInfo(props.detail.bookUrl, props.item.origin, {
        tocUrl: props.detail.tocUrl,
        chapters: props.chapters,
        variable: props.detail.variable,
      });
    }
  }
  appToast(added ? "已放入书架" : "已从书架移除", { kind: added ? "success" : "info" });
}

function persistSharedTheme(theme: AppShellTheme) {
  const loaded = loadPersistedSettingsData(localStorage, persistKey);
  persistSettingsData(localStorage, persistKey, {
    ...(loaded?.data ?? {}),
    theme,
  });
}

function onChangeTheme(theme: string) {
  const next: AppShellTheme = theme === "vs-dark" ? "vs-dark" : "vs";
  currentTheme.value = next;
  applyAppShellTheme(next);
  applyReaderAppearance();
  persistSharedTheme(next);
}

async function toggleFullscreen() {
  if (!isFullscreenView.value) {
    chromeSidebarWidth.value = sidebarWidth.value;
  }
  await enterOrExitFullscreenView();
}

function onDocumentKeydownEscape(ev: KeyboardEvent) {
  if (!modelValue.value) return;
  handleReaderChromeEscape(ev);
}

async function onShowLogs() {
  const runtimeText = logs.value.length ? logs.value.join("\n\n") : "";
  let text = "";
  if (chapterError.value && runtimeText) {
    text = `${chapterError.value}\n\n---\n\n${runtimeText}`;
  } else if (chapterError.value) {
    text = chapterError.value;
  } else if (runtimeText) {
    text = runtimeText;
  } else {
    text = "（暂无运行日志）";
  }
  await appLog(text);
}

function applyReaderAppearance() {
  applyReaderSurfaceToDocument(
    currentTheme.value,
    effectiveReaderSurfaceLight.value,
    effectiveReaderSurfaceDark.value,
  );
  void applyReaderBackgroundForPalettes(
    currentTheme.value,
    readerBackground.value,
    readerSurfaceLight.value,
    readerSurfaceDark.value,
  );
  readerRef.value?.setTheme(currentTheme.value);
  readerRef.value?.setFontSize(readerFontSize.value);
  readerRef.value?.setLineHeightMultiple(readerLineHeightMultiple.value);
  readerRef.value?.setLineSpacingPx(readerLineSpacingPx.value);
  readerRef.value?.setLetterSpacingPx(readerLetterSpacingPx.value);
  readerRef.value?.setFontFamily(monacoFontFamily.value);
}

watch(
  [
    displayChapters,
    textConvertZh,
    textConvertLetter,
    textConvertDigit,
  ],
  () => {
    void refreshConvertedChapterTitles();
  },
  { immediate: true },
);

watch(
  [
    readerFontSize,
    readerLineHeightMultiple,
    readerLineSpacingPx,
    readerLetterSpacingPx,
    monacoFontFamily,
    effectiveReaderSurfaceLight,
    effectiveReaderSurfaceDark,
    currentTheme,
    readerBackground,
    readerSurfaceLight,
    readerSurfaceDark,
  ],
  () => {
    if (!modelValue.value) return;
    applyReaderAppearance();
  },
  { deep: true },
);

watch(
  [
    compressBlankKeepOneBlank,
    chapterTitleBlankMode,
    txtrDelimitedMatchCrossLine,
  ],
  () => {
    if (!modelValue.value) return;
    void refreshCurrentChapterDisplay();
  },
);

async function bootstrapReaderContent() {
  if (!modelValue.value || !displayChapters.value.length) return;
  await refreshReplaceRulesCache();
  await refreshChapterCacheStatus();
  const startIndex = displayIndexForContentIndex(props.initialChapterIndex ?? 0);
  void loadChapterAtDisplayIndex(startIndex, { smoothScroll: false });
}

/** 打开时：先恢复持久化偏好；仅一章时临时收起（不写盘） */
function applySidebarOpenPolicy() {
  if (
    !modelValue.value ||
    sidebarOpenPolicyApplied ||
    sidebarUserToggledThisOpen
  ) {
    return;
  }
  const chapterCount = contentChapters.value.length;
  if (chapterCount <= 0) {
    showSidebar.value = findBookSettings.showSidebar.value;
    return;
  }
  showSidebar.value = findBookSettings.showSidebar.value;
  if (chapterCount === 1) {
    showSidebar.value = false;
  }
  sidebarOpenPolicyApplied = true;
}

function onToggleSidebar() {
  if (chromeAutoHide.value) {
    revealFullscreenSidebar();
    return;
  }
  showSidebar.value = !showSidebar.value;
  findBookSettings.showSidebar.value = showSidebar.value;
  findBookSettings.persistAll();
  sidebarUserToggledThisOpen = true;
  sidebarOpenPolicyApplied = true;
}

function onToggleMinimalist() {
  toggleMinimalistView();
  findBookSettings.isMinimalistView.value = isMinimalistView.value;
  findBookSettings.persistAll();
}

watch(
  modelValue,
  async (open) => {
    if (!open) {
      voiceRead.exitVoiceRead();
      timedScroll.stopTimedScroll();
      stopPomodoro();
      cancelChapterLoad();
      if (offlineCaching.value) void cancelOfflineCache();
      resetChapterSessionUi();
      sidebarOpenPolicyApplied = false;
      sidebarUserToggledThisOpen = false;
      if (isFullscreenView.value) {
        try {
          if (fullscreenViewportPreserveEnabled) prepareFullscreenExit();
          await window.colorTxt.setFullscreen(false);
        } catch {
          /* ignore */
        }
        dismissFullscreenChromeForNativeExit();
      }
      return;
    }
    applySidebarOpenPolicy();
    applyAppShellTheme(currentTheme.value);
    await nextTick();
    applyReaderAppearance();
    await bootstrapReaderContent();
  },
  { immediate: true },
);

/** 书架先开阅读器、目录迟到时：目录就绪后加载正文，并补做单章侧栏策略 */
watch(
  () => [modelValue.value, props.chapters.length, props.tocLoading] as const,
  async ([open, chapterCount, tocLoading], prev) => {
    if (!open || tocLoading || chapterCount <= 0) return;
    const prevCount = prev?.[1] ?? 0;
    const wasTocLoading = prev?.[2] ?? false;
    // 目录从空到有，或 tocLoading 刚结束且已有章节
    if (prevCount > 0 && !wasTocLoading) return;
    applySidebarOpenPolicy();
    await nextTick();
    await bootstrapReaderContent();
  },
);

function onFindBookWindowResize() {
  if (fullscreenViewportPreserveEnabled) {
    onPossibleFullscreenTransitionResize();
  }
  clampSidebarWidthToViewport();
}

onMounted(() => {
  offFullscreen = window.colorTxt.onFullscreenChanged(({ isFullscreen }) => {
    if (fullscreenViewportPreserveEnabled) {
      if (isFullscreen) {
        isFullscreenView.value = true;
        onFullscreenEntered();
        void nextTick(() => {
          requestAnimationFrame(() => {
            readerRef.value?.focusEditor?.();
          });
        });
        pulseChapterListCenter();
        return;
      }
      ensureExitAnchorBeforeChromeChange();
      isFullscreenView.value = false;
      dismissFullscreenChromeForNativeExit();
      void Promise.resolve(restoreFullscreenViewportAfterLeave()).finally(() => {
        pulseChapterListCenter();
      });
      return;
    }
    isFullscreenView.value = isFullscreen;
    if (!isFullscreen) {
      dismissFullscreenChromeForNativeExit();
    } else {
      void nextTick(() => {
        requestAnimationFrame(() => {
          readerRef.value?.focusEditor?.();
        });
      });
    }
    pulseChapterListCenter();
  });
  clampSidebarWidthToViewport();
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);
  window.addEventListener("resize", onFindBookWindowResize);
  window.addEventListener("storage", onStorageSync);
  window.addEventListener(persistedSettingsChangedEvent, onPersistedSettingsChanged);
  window.addEventListener(findBookReplaceRulesChangedEvent, onReplaceRulesChanged);
  document.addEventListener("keydown", onDocumentKeydownEscape, true);
  void refreshReplaceRulesCache();
  offStealthOwnerProgress = window.colorTxt.onStealthOwnerProgress((payload) => {
    if (payload.focus) {
      readerRef.value?.jumpToLine?.(payload.line, false);
    }
  });
  offStealthOwnerChapterNav = window.colorTxt.onStealthOwnerChapterNav(
    (payload) => {
      if (payload?.direction !== "prev" && payload?.direction !== "next") return;
      void onStealthOwnerChapterNav(
        payload.direction,
        payload.anchor === "end" ? "end" : "start",
      );
    },
  );
});

onBeforeUnmount(() => {
  window.colorTxt.setWindowTitle(FIND_BOOK_WINDOW_TITLE);
  offFullscreen?.();
  offStealthOwnerProgress?.();
  offStealthOwnerProgress = null;
  offStealthOwnerChapterNav?.();
  offStealthOwnerChapterNav = null;
  window.removeEventListener("mousemove", onWindowMouseMove);
  window.removeEventListener("mouseup", onWindowMouseUp);
  window.removeEventListener("resize", onFindBookWindowResize);
  window.removeEventListener("storage", onStorageSync);
  window.removeEventListener(
    persistedSettingsChangedEvent,
    onPersistedSettingsChanged,
  );
  window.removeEventListener(
    findBookReplaceRulesChangedEvent,
    onReplaceRulesChanged,
  );
  document.removeEventListener("keydown", onDocumentKeydownEscape, true);
  voiceRead.exitVoiceRead();
  timedScroll.stopTimedScroll();
  cancelChapterLoad();
});

defineExpose({
  bringToFront: () => {
    modalRef.value?.bringToFront?.();
  },
  refreshChapterCacheStatus,
  clearChapterCacheMarks,
  openChapter: (contentIndex: number) => {
    const startIndex = displayIndexForContentIndex(contentIndex);
    if (displayChapters.value.length) {
      void loadChapterAtDisplayIndex(startIndex, { smoothScroll: false });
    }
  },
  readerEditMode,
  applyEditFormatTextReplace: (rules: ReplaceRule[]) =>
    readerRef.value?.applyEditFormatTextReplace?.(rules),
});

const modalRef = ref<InstanceType<typeof AppModal> | null>(null);
</script>

<template>
  <AppModal
    ref="modalRef"
    v-model="modelValue"
    title=""
    fullscreen
    panel-class="findBookReaderPanel"
    :fullscreen-header-float="false"
    :mask-closable="false"
    :esc-closable="false"
    :show-close-button="false"
    :body-scroll="false"
  >
    <div
      class="findBookReaderShell"
      :class="{
        fullscreen: isFullscreenView,
        chromeHidden: chromeAutoHide,
        'fullscreen--cursorHidden': chromeAutoHide && fullscreenCursorHidden,
      }"
    >
      <Transition name="chromeFloatHeader" :css="chromeAutoHide">
      <div
        :ref="setFullscreenHeaderOverlayEl"
        class="findBookReaderHeaderWrap"
        v-show="!chromeAutoHide || showFullscreenHeader"
        @mouseleave="onFullscreenHeaderMouseLeave"
      >
        <div v-show="!isFullscreenView" class="findBookReaderTopBar">
          <IconButton
            :icon-html="icons.back"
            title="返回"
            aria-label="返回"
            @click="onBack"
          />
          <nav class="findBookReaderBreadcrumb" aria-label="阅读">
            <span v-if="breadcrumbSourceName" class="findBookReaderBreadcrumbSource">{{
              breadcrumbSourceName
            }}</span>
            <span
              v-if="breadcrumbSourceName"
              class="findBookReaderBreadcrumbSep"
              aria-hidden="true"
            >/</span>
            <button
              type="button"
              class="findBookReaderBreadcrumbCurrent"
              title="书籍信息"
              @click="onOpenBookDetail"
            >
              {{ detail.name }}
            </button>
          </nav>
          <div class="findBookReaderTopBarActions">
            <IconButton
              v-if="showReaderLogBtn"
              class="findBookReaderLogBtn"
              :class="{ 'findBookReaderLogBtn--warning': readerLogHasError }"
              :icon-html="icons.info"
              title="日志"
              aria-label="日志"
              @click="onShowLogs"
            />
            <IconButton
              title="重新获取当前章节（忽略缓存）"
              aria-label="重新获取当前章节（忽略缓存）"
              :disabled="
                refreshingChapter ||
                readerBootLoading ||
                chapterContentBusy ||
                !displayChapters.length
              "
              :aria-busy="refreshingChapter || undefined"
              @click="onRefresh"
            >
              <RefreshIcon :spinning="refreshingChapter" />
            </IconButton>
            <IconButton
              v-if="showChapterPayBtn"
              :icon-html="icons.buy"
              title="购买"
              aria-label="购买"
              :disabled="payingChapter || readerBootLoading || chapterContentBusy"
              :aria-busy="payingChapter || undefined"
              @click="onChapterPay"
            />
            <IconButton
              v-if="sourceNeedsLogin"
              :icon-html="icons.user"
              title="登录"
              aria-label="登录"
              @click="onLogin"
            />
            <div ref="topMoreBtnRef" class="findBookReaderTopMoreWrap">
              <IconButton
                :icon-html="icons.more"
                :active="topMoreOpen"
                :pressed="topMoreOpen"
                title="更多"
                aria-label="更多"
                aria-haspopup="menu"
                :aria-expanded="topMoreOpen"
                @click="toggleTopMoreMenu"
              />
            </div>
          </div>
        </div>
        <AppShellMenuTeleport
          v-model:open="topMoreOpen"
          :left="topMoreLeft"
          :top="topMoreTop"
          caret="end"
          :on-panel-mount="bindTopMorePanel"
        >
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            :disabled="!displayChapters[currentDisplayIndex]?.url?.trim()"
            @click="onCopyChapterUrl"
          >
            <span class="appShellMenuLabel">复制正文 URL</span>
          </button>
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            :disabled="!item.origin?.trim()"
            @click="onEditBookSource"
          >
            <span class="appShellMenuLabel">编辑书源</span>
          </button>
          <button
            type="button"
            class="appShellMenuItem appShellMenuItem--warning"
            role="menuitem"
            :disabled="
              offlineCaching ||
              !(detail.bookUrl?.trim() || item.bookUrl?.trim())
            "
            @click="onClearChapterCache"
          >
            <span class="appShellMenuLabel">清除缓存</span>
          </button>
        </AppShellMenuTeleport>
        <FindBookReaderHeader
          :in-bookshelf="inBookshelf"
          :current-theme="currentTheme"
          :in-fullscreen="isFullscreenView"
          :in-minimalist="isMinimalistView"
          :can-increase-font="canIncreaseFont"
          :can-decrease-font="canDecreaseFont"
          :can-increase-line-height="canIncreaseLineHeight"
          :can-decrease-line-height="canDecreaseLineHeight"
          :reader-font-size="readerFontSize"
          :reader-line-height-multiple="readerLineHeightMultiple"
          :monaco-font-family="monacoFontFamily"
          :pinned-other-fonts="pinnedOtherFonts"
          :monaco-advanced-wrapping="monacoAdvancedWrapping"
          :monaco-custom-highlight="monacoCustomHighlight"
          :compress-blank-lines="compressBlankLines"
          :lead-indent-full-width="leadIndentFullWidth"
          :text-convert-zh="textConvertZh"
          :text-convert-letter="textConvertLetter"
          :text-convert-digit="textConvertDigit"
          :voice-read-active="isVoiceReadActive"
          :can-voice-read="canStartVoiceRead"
          :timed-scroll-active="isTimedScrollActive"
          :can-timed-scroll="canStartTimedScroll"
          :voice-read-header-locked="isVoiceReadScrollLocked"
          :settings-shortcut-label="settingsShortcutLabel"
          :color-scheme-shortcut-label="colorSchemeShortcutLabel"
          :find-shortcut-label="findShortcutLabel"
          :theme-shortcut-label="themeShortcutLabel"
          :shortcut-bindings="shortcutBindings"
          :reader-edit-mode="readerEditMode"
          :reader-click-mode="effectiveClickMode"
          :reader-click-mode-alt-held="clickModeAltHeld"
          :reading-ruler-enabled="readingRulerEnabled"
          :can-enter-reader-edit-mode="canEnterReaderEditMode"
          :reader-chapter-saving="readerChapterSaving"
          :text-replace-active="textReplaceActive"
          :can-enter-stealth="canEnterStealth"
          @change-theme="onChangeTheme"
          @toggle-minimalist="onToggleMinimalist"
          @toggle-fullscreen="toggleFullscreen"
          @set-monaco-font="readerUi.setMonacoFontFamily"
          @toggle-pin-other-font="readerUi.togglePinnedOtherFont"
          @increase-font-size="readerUi.increaseFontSize"
          @decrease-font-size="readerUi.decreaseFontSize"
          @increase-line-height="readerUi.increaseLineHeight"
          @decrease-line-height="readerUi.decreaseLineHeight"
          @toggle-compress-blank-lines="toggleCompressBlankLines"
          @toggle-lead-indent-full-width="toggleLeadIndentFullWidth"
          @format-edit-compress-blank-lines="onFormatEditCompressBlankLines"
          @format-edit-lead-indent-full-width="onFormatEditLeadIndentFullWidth"
          @select-text-convert-zh-read="setTextConvertZhRead"
          @select-text-convert-letter-read="setTextConvertLetterRead"
          @select-text-convert-digit-read="setTextConvertDigitRead"
          @apply-text-convert-zh-edit="onApplyTextConvertZhEdit"
          @apply-text-convert-letter-edit="onApplyTextConvertLetterEdit"
          @apply-text-convert-digit-edit="onApplyTextConvertDigitEdit"
          @toggle-monaco-advanced-wrapping="readerUi.toggleMonacoAdvancedWrapping"
          @toggle-monaco-custom-highlight="readerUi.toggleMonacoCustomHighlight"
          @voice-read-toggle="voiceRead.toggleVoiceReadToolbar"
          @timed-scroll-toggle="timedScroll.toggleTimedScroll"
          @open-settings="emit('openSettings')"
          @open-color-scheme="emit('openColorScheme')"
          @toggle-find="onToggleFindFromToolbar"
          @toggle-bookshelf="onToggleBookshelf"
          @open-text-replace="onOpenTextReplace"
          @toggle-reader-edit="onToggleReaderEdit"
          @toggle-reader-click-mode="toggleReaderClickMode"
          @toggle-reading-ruler="toggleReadingRuler"
          @save-reader-chapter="onSaveReaderChapter"
          @enter-stealth-reader="enterStealthMode"
        />
      </div>
      </Transition>

      <div
        class="findBookReaderBody"
        :class="{ readerSurfaceBg: chromeAutoHide }"
        @pointerdown.capture="onLayoutMouseDown"
        @contextmenu="onFullscreenLayoutContextMenu"
        @wheel.capture="onLayoutWheel"
      >
        <Transition name="chromeFloatSidebar" :css="chromeAutoHide">
        <aside
          v-show="sidebarShellVisible"
          ref="fullscreenSidebarOverlayRef"
          class="findBookReaderSidebar"
          data-reader-sidebar-root
          :class="{ 'sidebarPaneWrap--fullscreen': chromeAutoHide }"
          :style="{ width: `${sidebarPanelWidth}px` }"
          @mouseleave="onFullscreenSidebarMouseLeave"
        >
          <div class="sidebarPanelColumn">
            <div class="sidebarHeader">
              <div class="sidebarHeaderStart">
                <span class="sidebarHeaderTitle">章节</span>
                <IconButton
                  v-if="hasChapterTags"
                  :icon-html="icons.subhead"
                  :title="showChapterTag ? '隐藏附加信息' : '显示附加信息'"
                  :aria-label="showChapterTag ? '隐藏附加信息' : '显示附加信息'"
                  :pressed="showChapterTag"
                  @click="toggleShowChapterTag"
                />
                <IconButton
                  title="重新获取目录"
                  aria-label="重新获取目录"
                  :disabled="
                    refreshingToc ||
                    tocLoading ||
                    offlineCaching ||
                    !(detail.bookUrl?.trim() || item.bookUrl?.trim())
                  "
                  :aria-busy="refreshingToc || undefined"
                  @click="onRefreshToc"
                >
                  <RefreshIcon :spinning="refreshingToc" />
                </IconButton>
              </div>
              <div
                v-if="displayChapters.length || readerBootLoading"
                class="sidebarHeaderEnd"
              >
                <IconButton
                  :icon-html="icons.cache"
                  title="离线缓存"
                  aria-label="离线缓存"
                  :disabled="
                    readerBootLoading ||
                    refreshingToc ||
                    offlineCaching ||
                    !(detail.bookUrl?.trim() || item.bookUrl?.trim())
                  "
                  @click="onStartOfflineCache"
                />
                <IconButton
                  :icon-html="chapterSortDesc ? icons.desc : icons.asc"
                  :title="chapterSortDesc ? '倒序' : '正序'"
                  :aria-label="chapterSortDesc ? '切换为正序' : '切换为倒序'"
                  :pressed="chapterSortDesc"
                  :disabled="
                    readerBootLoading ||
                    refreshingToc ||
                    !displayChapters.length
                  "
                  @click="toggleChapterSort"
                />
              </div>
            </div>
            <FindBookReaderChapterSidebar
              ref="chapterListRef"
              :chapters="displayChapters"
              :current-display-index="currentDisplayIndex"
              :row-stride="chapterListRowStride"
              :reader-boot-loading="readerBootLoading"
              :offline-caching="offlineCaching"
              :offline-cache-progress="offlineCacheProgress"
              :offline-cache-progress-percent="offlineCacheProgressPercent"
              :offline-cache-progress-label="offlineCacheProgressLabel"
              :show-chapter-tag="showChapterTag"
              :chapter-display-base-title="chapterDisplayBaseTitle"
              :chapter-display-title="chapterDisplayTitle"
              :is-chapter-loading="isChapterLoading"
              :is-chapter-offline-caching="isChapterOfflineCaching"
              :is-chapter-cached="isChapterCached"
              @chapter-click="onChapterClick"
              @stop-offline-cache="onStopOfflineCache"
            />
          </div>
          <div
            class="resizer findBookReaderResizer"
            :class="{ 'resizer--active': resizingSidebar }"
            @mousedown="startResizeSidebar"
          ></div>
        </aside>
        </Transition>

        <div
          ref="readerPaneWrapRef"
          class="findBookReaderMainWrap"
          :style="fullscreenReaderPaneStyle"
        >
          <p
            v-if="readerBootLoading || showChapterLoadingUi"
            class="findBookReaderLoading"
            aria-live="polite"
          >
            <span class="findBookReaderLoadingHint">
              加载中<LoadingDotsBounce />
            </span>
          </p>
          <p
            v-else-if="chapterError && !readerContentKey"
            class="findBookReaderError"
          >
            <span class="findBookReaderErrorMain">{{ chapterError }}</span>
            <span
              v-if="logs.length"
              class="findBookReaderErrorLogs"
            >{{ logs.join("\n\n") }}</span>
          </p>
          <ReaderMain
            ref="readerRef"
            class="readerPane findBookReaderMain"
            :stream-loading="readerBootLoading || showChapterLoadingUi"
            :voice-read-scroll-locked="isVoiceReadScrollLocked"
            :intercept-readonly-page-step="tryAdvanceChapterFromOverscroll"
            :voice-read-paused="isVoiceReadActive && voiceRead.mode.value === 'paused'"
            :voice-read-blocks-find="isVoiceReadBlocksFind"
            @voice-read-resume="voiceRead.togglePlayPause"
            :monaco-custom-highlight="monacoCustomHighlight"
            :txtr-delimited-match-cross-line="txtrDelimitedMatchCrossLine"
            :compress-blank-lines="compressBlankLines"
            :lead-indent-full-width="leadIndentFullWidth"
            :chapter-min-char-count="chapterMinCharCount"
            :monaco-advanced-wrapping="monacoAdvancedWrapping"
            :monaco-cjk-wrap-optimize="monacoCjkWrapOptimize"
            :line-spacing-px="readerLineSpacingPx"
            :letter-spacing-px="readerLetterSpacingPx"
            :horizontal-inset-px="readerHorizontalInsetPx"
            :monaco-smooth-scrolling="monacoSmoothScrolling"
            :scrollbar-track-behavior="scrollbarTrackBehavior"
            :mouse-wheel-scroll-sensitivity="mouseWheelScrollSensitivity"
            :fast-scroll-sensitivity="fastScrollSensitivity"
            :sticky-chapter-title-enabled="stickyChapterTitleEnabled"
            :reader-click-mode="effectiveClickMode"
            :reading-ruler-enabled="readingRulerEnabled"
            :reading-ruler-focus-lines="readingRulerFocusLines"
            :reading-ruler-dim-opacity="readingRulerDimOpacity"
            :reading-ruler-dim-sticky-title="readingRulerDimStickyTitle"
            :reading-ruler-transition-enabled="readingRulerTransitionEnabled"
            :markdown-image-height-px="markdownImageHeightPx"
            :reader-click-mode-alt-held="clickModeAltHeld"
            :selection-toolbar-buttons="selectionToolbarButtons"
            :dictionary-settings="dictionarySettings"
            :web-search-settings="webSearchSettings"
            :translation-settings="translationSettings"
            @open-dictionary-manage="showDictionaryManagePanel = true"
            @open-web-search-manage="showWebSearchManagePanel = true"
            @open-translate-manage="openTranslateManagePanel"
            @update:translation-settings="onTranslationSettingsUpdate"
            :reader-surface-light="effectiveReaderSurfaceLight"
            :reader-surface-dark="effectiveReaderSurfaceDark"
            :reader-palette-color-enabled="readerPaletteColorEnabledForReader"
            :highlight-colors="highlightColorsForReader"
            :lineation-colors="currentTheme === 'vs' ? lineationColorsLight : lineationColorsDark"
            :highlight-words-by-index="highlightWordsByIndexGlobal"
            :reader-fullscreen="isFullscreenView"
            :reader-edit-mode="readerEditMode"
            :show-selection-annotation-tools="false"
            :show-select-chapter-menu-item="false"
            :ai-features-enabled="false"
            :reader-edit-show-line-numbers="readerEditShowLineNumbers"
            :reader-edit-minimap="readerEditMinimap"
            :ebook-display-line-to-physical="viewportDisplayLineToPhysicalLine"
            :get-physical-line-content="getPhysicalLineContent"
            :monaco-font-family="monacoFontFamily"
            @viewport-top-line-change="readerUi.onViewportTopLineChange"
            @viewport-end-line-change="onFindBookViewportEndLineChange"
            @viewport-visual-progress-change="readerUi.onViewportVisualProgressChange"
            @probe-line-change="onFindBookProbeLineChange"
            @layout-viewport-restored="onFindBookLayoutViewportRestored"
            @reader-edit-dirty-change="onReaderEditDirtyChange"
            @reader-edit-save-request="onSaveReaderChapter"
            @apply-partial-physical-edit="onApplyPartialPhysicalEdit"
            @search-with-quote="
              (text) => readerRef?.openFindWithSearchString?.(text)
            "
          />
          <VoiceReadToolbar
            :visible="isVoiceReadActive"
            :mode="voiceRead.mode.value"
            :synthesizing="voiceRead.isSynthesizing.value"
            :synthesizing-phase="voiceRead.synthesizingPhase.value"
            :toolbar-rate="voiceRead.toolbarRate.value"
            :toolbar-volume="voiceRead.toolbarVolume.value"
            :engine="voiceReadSettings.engine"
            :can-prev-line="voiceRead.canPlayPrevLine.value"
            :can-next-line="voiceRead.canPlayNextLine.value"
            @update:toolbar-rate="voiceRead.toolbarRate.value = $event"
            @update:toolbar-volume="voiceRead.setToolbarVolume($event)"
            @toggle-play-pause="voiceRead.togglePlayPause"
            @prev-line="voiceRead.playPrevLine"
            @next-line="voiceRead.playNextLine"
            @regenerate="voiceRead.regenerateCurrentLine"
            @stop="voiceRead.exitVoiceRead"
            @open-speak-settings="emit('openSpeakSettings')"
          />
          <ReaderChapterNavBar
            v-if="chapterNavUiVisible && !chromeAutoHide"
            :visible="chapterNavVisible"
            :can-go-prev="canGoPrevChapter"
            :can-go-next="canGoNextChapter"
            :disabled="chapterNavBusy"
            @prev="goToPrevChapter"
            @next="goToNextChapter"
          />
          <div
            v-if="readerHudTipVisible"
            class="fullscreenTip readerHudTip"
            :class="{ fading: readerHudTipFading }"
            aria-live="polite"
          >
            {{ readerHudTipText }}
          </div>
        </div>
      </div>

      <Transition name="chromeFloatFooter" :css="chromeAutoHide">
      <div
        :ref="setFullscreenFooterOverlayEl"
        class="findBookReaderFooterWrap"
        v-show="!chromeAutoHide || showFullscreenFooter"
        @mouseleave="onFullscreenFooterMouseLeave"
      >
        <ReaderChapterNavBar
          v-if="chapterNavUiVisible && chromeAutoHide"
          :visible="chapterNavVisible"
          :can-go-prev="canGoPrevChapter"
          :can-go-next="canGoNextChapter"
          :disabled="chapterNavBusy"
          @prev="goToPrevChapter"
          @next="goToNextChapter"
        />
        <FindBookReaderFooter
          :loading="footerLoading"
          :has-content="footerHasContent"
          :reading-progress-percent-part="footerReadingProgress.percentPart"
          :reading-progress-detail-part="footerReadingProgress.detailPart"
          :reading-progress-placeholder="footerReadingProgress.placeholder"
          :reading-progress-complete="footerReadingProgress.complete"
          :voice-read-footer-status="voiceRead.voiceReadFooterStatus.value"
          :chapter-char-count-text="footerChapterCharCountText"
          :pomodoro-enabled="pomodoroEnabled"
          :pomodoro-phase="pomodoroPhase"
          :pomodoro-display-mode="pomodoroDisplayMode"
          :pomodoro-progress="pomodoroProgress"
          :pomodoro-countdown-text="pomodoroCountdownText"
          :pomodoro-pause-resume-label="pomodoroPauseResumeLabel"
          :pomodoro-paused="pomodoroPaused"
          @pomodoro-start="startPomodoro"
          @pomodoro-toggle-display-mode="togglePomodoroDisplayMode"
          @pomodoro-toggle-pause="togglePomodoroPause"
          @pomodoro-stop="stopPomodoro"
        />
      </div>
      </Transition>

      <div
        v-if="showFullscreenTip"
        class="fullscreenTip"
        :class="{ fading: fullscreenTipFading }"
      >
        {{ fullscreenTipText }}
      </div>
      <FullscreenSystemClock
        :visible="isFullscreenView && fullscreenShowSystemTime"
        :pomodoro-visible="chromeAutoHide && pomodoroPhase !== 'idle'"
        :pomodoro-progress="pomodoroProgress"
        :pomodoro-paused="pomodoroPaused"
      />
      <PomodoroBreakOverlay
        :visible="pomodoroShowBreakOverlay"
        :countdown-text="pomodoroCountdownText"
        @finish="finishPomodoroBreakEarly"
      />
    </div>

    <EditBookSourcePanel
      v-model="showEditSource"
      :source-url="editingSourceUrl"
      :initial-tab="editSourceInitialTab"
      @done="onEditSourceDone"
      @search-source="onSearchFromEdit"
    />
    <BookSourceLoginPanel v-model="showLogin" :source="loginSource" />
    <DictionaryManageModal
      v-model="showDictionaryManagePanel"
      :settings="dictionarySettings"
      @update:settings="onDictionarySettingsUpdate"
    />
    <WebSearchManageModal
      v-model="showWebSearchManagePanel"
      :settings="webSearchSettings"
      @update:settings="onWebSearchSettingsUpdate"
    />
    <TranslateManageModal
      v-model="showTranslateManagePanel"
      :settings="translationSettings"
      @update:settings="onTranslationSettingsUpdate"
    />
  </AppModal>
</template>

<style>
.appModalPanel.findBookReaderPanel .appModalBody {
  padding: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.findBookReaderShell.fullscreen,
.findBookReaderShell.chromeHidden {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}

.findBookReaderShell.fullscreen {
  --txtr-fullscreen-scrollbar-size: 14px;
}

.findBookReaderShell.chromeHidden.fullscreen--cursorHidden,
.findBookReaderShell.chromeHidden.fullscreen--cursorHidden * {
  cursor: none !important;
}

.findBookReaderShell.fullscreen .findBookReaderBody.readerSurfaceBg,
.findBookReaderShell.chromeHidden .findBookReaderBody.readerSurfaceBg {
  background-color: var(--reader-bg);
}

.findBookReaderFooterWrap {
  flex: 0 0 auto;
}

.findBookReaderShell.chromeHidden .findBookReaderFooterWrap {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 3400;
  background: var(--bg);
  box-shadow: 0 -6px 28px rgba(0, 0, 0, 0.45);
}

.findBookReaderShell.chromeHidden .findBookReaderHeaderWrap {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3500;
  background: var(--bg);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.45);
}

.findBookReaderShell.chromeHidden .findBookReaderSidebar.sidebarPaneWrap--fullscreen {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 3000;
  box-shadow: 6px 0 28px rgba(0, 0, 0, 0.45);
}

.findBookReaderShell.fullscreen .readerPane.content--readerEditMinimap .monaco-editor .minimap {
  position: fixed !important;
  left: auto !important;
  right: var(--txtr-fullscreen-scrollbar-size) !important;
  z-index: 9;
}

.findBookReaderShell.fullscreen .readerPane .monaco-editor .decorationsOverviewRuler,
.findBookReaderShell.fullscreen .readerPane .monaco-editor .monaco-scrollable-element > .scrollbar.vertical {
  position: fixed !important;
  left: auto !important;
  right: 0 !important;
}

.fullscreenTip {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 14px;
  opacity: 1;
  transition: opacity 250ms ease;
}

.fullscreenTip.fading {
  opacity: 0;
}

.fullscreenTip.readerHudTip {
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 14px;
}

.chromeFloatHeader-enter-active,
.chromeFloatHeader-leave-active {
  transition:
    opacity 140ms ease-out,
    transform 140ms ease-out;
}

.chromeFloatHeader-enter-from,
.chromeFloatHeader-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.chromeFloatHeader-leave-active {
  pointer-events: none;
}

.chromeFloatFooter-enter-active,
.chromeFloatFooter-leave-active {
  transition:
    opacity 140ms ease-out,
    transform 140ms ease-out;
}

.chromeFloatFooter-enter-from,
.chromeFloatFooter-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.chromeFloatFooter-leave-active {
  pointer-events: none;
}

.chromeFloatSidebar-enter-active,
.chromeFloatSidebar-leave-active {
  transition:
    opacity 180ms ease-out,
    transform 180ms ease-out;
}

.chromeFloatSidebar-enter-from,
.chromeFloatSidebar-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.chromeFloatSidebar-leave-active {
  pointer-events: none;
}

</style>

<style scoped>
.findBookReaderBreadcrumb {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.4;
}
.findBookReaderBreadcrumbSource {
  color: var(--muted);
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}
.findBookReaderBreadcrumbSep {
  margin: 0 8px;
  color: var(--muted);
  flex-shrink: 0;
  user-select: none;
}
.findBookReaderBreadcrumbCurrent {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-weight: 600;
  text-align: left;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.findBookReaderBreadcrumbCurrent:hover {
  color: var(--accent);
}
.findBookReaderLogBtn {
  flex-shrink: 0;
}
.findBookReaderLogBtn--warning :deep(.icon),
.findBookReaderLogBtn--warning :deep(svg path) {
  color: var(--warning);
}
.findBookReaderTopBarActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
}
.findBookReaderTopMoreWrap {
  display: inline-flex;
  flex-shrink: 0;
}
.findBookReaderShell {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.findBookReaderHeaderWrap {
  flex-shrink: 0;
}
.findBookReaderTopBar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid var(--border);
  min-width: 0;
  background: var(--panel);
}
.findBookReaderBody {
  flex: 1;
  min-height: 0;
  display: flex;
}
.findBookReaderSidebar {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.findBookReaderResizer {
  position: absolute;
  top: 0;
  right: calc(var(--app-sash-size, 4px) / -2);
  bottom: 0;
  z-index: 20;
  width: var(--app-sash-size, 4px);
  cursor: ew-resize;
  touch-action: none;
  background: transparent;
}
.findBookReaderResizer::before {
  content: "";
  pointer-events: none;
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--app-sash-hover-size, 4px);
  left: calc(50% - (var(--app-sash-hover-size, 4px) / 2));
  background: transparent;
  transition: background-color var(--app-sash-fade-duration, 0.1s) ease-out;
  transition-delay: 0s;
}
.findBookReaderResizer:hover::before {
  background: var(--app-sash-hover-border, var(--accent));
  transition-delay: var(--app-sash-hover-delay, 300ms);
}
.findBookReaderResizer.resizer--active::before {
  background: var(--app-sash-hover-border, var(--accent));
  transition-delay: 0s;
}
.sidebarPanelColumn {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
}
.sidebarHeader {
  flex: 0 0 auto;
  background: var(--bg);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 44px;
}
.sidebarHeaderTitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--tab-fg-active);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.sidebarHeaderStart {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.sidebarHeaderEnd {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.findBookReaderMainWrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}
.findBookReaderMainWrap > :deep(.voiceReadToolbarLayer) {
  z-index: 100;
}
.findBookReaderMain {
  flex: 1;
  min-height: 0;
}
.findBookReaderLoading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  font-size: 12px;
  color: var(--fg);
  text-align: center;
  z-index: 2;
  pointer-events: none;
  background: color-mix(in srgb, var(--reader-bg) 78%, transparent);
}
.findBookReaderLoadingHint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.findBookReaderError {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 12px;
  margin: 0;
  padding: 24px 20px;
  overflow: auto;
  font-size: 14px;
  line-height: 1.55;
  color: var(--danger);
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  z-index: 2;
  pointer-events: auto;
  background-color: var(--reader-bg, transparent);
  user-select: text;
}
.findBookReaderErrorMain {
  font-weight: 600;
}
.findBookReaderErrorLogs {
  display: block;
  font-weight: 400;
  font-size: 12px;
  opacity: 0.9;
  color: var(--muted-fg, var(--danger));
}
</style>
