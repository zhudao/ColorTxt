import { computed, nextTick, ref, shallowRef, watch } from "vue";
import type { Chapter } from "../chapter";
import { defaultChapterMinCharCount } from "../constants/appUi";
import type VirtualList from "../components/VirtualList.vue";
import type { FileSortMode } from "../constants/fileCategories";
import {
  FILE_CATEGORY_FILTER_ALL,
  FILE_CATEGORY_FILTER_UNCATEGORIZED,
} from "../constants/fileCategories";
import type { TxtFileItem } from "../services/fileListService";
import { fileHistoryKey } from "../stores/recentHistoryStore";
import {
  normalizeFileMetaPathKey,
  type FileMetaRecord,
} from "../stores/fileMetaStore";

const EMPTY_META_PROGRESS = new Map<string, number>();

/** 行高 + 1px 行间距（用于虚拟列表内的 padding-bottom） */
export const READER_SIDEBAR_ROW_STRIDE = 41;

export type SidebarFileItem = {
  name: string;
  path: string;
  size: number;
  /**
   * 阅读进度（%）；`undefined` 表示尚未在 meta 中有记录（从未打开过），
   * 与 `0`（已打开且进度为 0%）不同；排序时会将无记录项固定排在最后。
   * 列表行展示用 `metaProgressMap` + 实时进度；`fileRowsEnriched` 故意不写本字段，避免滚动时整表重算。
   */
  progress?: number;
  /**
   * 来自 file.meta 的 `lastOpenedAt`（ms）：仅在应用内打开该文件时更新；
   * 无记录时为 `undefined`；按打开时间升序时，有阅读进度但无本字段的项视为更早打开，排在最前。
   */
  lastReadAt?: number;
  /** 来自侧栏文件列表项；空或未设为未分类 */
  category?: string;
  addedAt?: number;
};

type SidebarBookmarkItem = {
  line: number;
  note?: string;
  content: string;
};

export type ReaderSidebarListProps = Readonly<{
  activeTab: import("../constants/readerSidebarTab").ReaderSidebarTab;
  chapters: Chapter[];
  /** 原始文件列表（与 `App` 中 `txtFiles` 同源）；项上可带 `category`；进度等与 `metaProgressByPathKey` / `fileMetaRecords` 合并 */
  files: TxtFileItem[];
  bookmarks: SidebarBookmarkItem[];
  currentFilePath: string | null;
  activeChapterIdx: number;
  activeBookmarkLine?: number | null;
  inFullscreen?: boolean;
  chapterListScrollSmooth?: boolean;
  shouldCenterChapterList?: boolean;
  suppressChapterListAutoScroll?: boolean;
  shouldCenterFileList?: boolean;
  shouldCenterBookmarkList?: boolean;
  activeScrollMode?: "edge" | "center";
  /** 来自持久化的阅读进度映射（路径 key → %） */
  metaProgressByPathKey?: Map<string, number>;
  /** 与 `files` 对应的 file.meta 行；用于分类、打开时间、排序用进度等 */
  fileMetaRecords?: readonly FileMetaRecord[];
  /** 文件列表分类筛选 */
  fileCategory?: string;
  /** 文件列表排序 */
  fileSort?: FileSortMode;
  /** 当前打开文件的实时进度（%）；仅「按阅读进度」排序时参与 `filesSorted`（勿用于打开时间排序，以免滚动时整表重算） */
  liveReadingProgressPercent?: number;
  /** 与设置「章节最少字数」一致；0 表示保留无正文字数的目录项（如书名页） */
  chapterMinCharCount?: number;
}>;

function effectiveCategoryName(f: SidebarFileItem): string {
  const c = f.category?.trim() ?? "";
  return c;
}

/** `category` 已是展示用 trim 结果（无首尾空白），可与 `fileRowsEnriched` 复用源对象引用 */
function categoryFieldAlreadyTrimmed(f: TxtFileItem): boolean {
  const c = f.category;
  if (c === undefined) return true;
  return typeof c === "string" && c === c.trim();
}

function comparePathKey(a: string, b: string): number {
  return normalizeFileMetaPathKey(a).localeCompare(normalizeFileMetaPathKey(b));
}

/** 已有阅读进度记录（含 0%）；无记录的文件不参与按百分比比较，固定排末尾 */
function hasRecordedReadingProgress(f: SidebarFileItem): boolean {
  return typeof f.progress === "number" && Number.isFinite(f.progress);
}

function hasLastReadAt(f: SidebarFileItem): boolean {
  return typeof f.lastReadAt === "number" && Number.isFinite(f.lastReadAt);
}

function effectiveFileSizeBytes(f: SidebarFileItem): number {
  const s = f.size;
  return typeof s === "number" && Number.isFinite(s) ? s : 0;
}

/**
 * 打开时间升序：0 有进度无时间（旧数据，视为最早）；1 有时间戳；2 无进度。
 */
function readingTimeSortOrderAsc(f: SidebarFileItem): 0 | 1 | 2 {
  if (hasLastReadAt(f)) return 1;
  if (hasRecordedReadingProgress(f)) return 0;
  return 2;
}

/**
 * 打开时间降序：0 有时间戳；1 有进度无时间；2 无进度（组间顺序与升序对称）。
 */
function readingTimeSortOrderDesc(f: SidebarFileItem): 0 | 1 | 2 {
  if (hasLastReadAt(f)) return 0;
  if (hasRecordedReadingProgress(f)) return 1;
  return 2;
}

function sortFileList(
  list: SidebarFileItem[],
  mode: FileSortMode,
): SidebarFileItem[] {
  const out = list.slice();
  const byName = (a: SidebarFileItem, b: SidebarFileItem) =>
    a.name.localeCompare(b.name, "zh-Hans-CN");
  switch (mode) {
    case "nameAsc":
      return out.sort(byName);
    case "nameDesc":
      return out.sort((a, b) => byName(b, a));
    case "pathAsc":
      return out.sort((a, b) => comparePathKey(a.path, b.path));
    case "pathDesc":
      return out.sort((a, b) => comparePathKey(b.path, a.path));
    case "sizeAsc":
      return out.sort(
        (a, b) =>
          effectiveFileSizeBytes(a) - effectiveFileSizeBytes(b) || byName(a, b),
      );
    case "sizeDesc":
      return out.sort(
        (a, b) =>
          effectiveFileSizeBytes(b) - effectiveFileSizeBytes(a) || byName(a, b),
      );
    case "progressAsc":
      return out.sort((a, b) => {
        const aRec = hasRecordedReadingProgress(a);
        const bRec = hasRecordedReadingProgress(b);
        if (!aRec && !bRec) return byName(a, b);
        if (!aRec) return 1;
        if (!bRec) return -1;
        const cmp = a.progress! - b.progress!;
        return cmp || byName(a, b);
      });
    case "progressDesc":
      return out.sort((a, b) => {
        const aRec = hasRecordedReadingProgress(a);
        const bRec = hasRecordedReadingProgress(b);
        if (!aRec && !bRec) return byName(a, b);
        if (!aRec) return 1;
        if (!bRec) return -1;
        const cmp = b.progress! - a.progress!;
        return cmp || byName(a, b);
      });
    case "lastReadAtAsc":
      return out.sort((a, b) => {
        const ta = readingTimeSortOrderAsc(a);
        const tb = readingTimeSortOrderAsc(b);
        if (ta !== tb) return ta - tb;
        if (ta === 1) {
          const cmp = a.lastReadAt! - b.lastReadAt!;
          return cmp || byName(a, b);
        }
        return byName(a, b);
      });
    case "lastReadAtDesc":
      return out.sort((a, b) => {
        const ta = readingTimeSortOrderDesc(a);
        const tb = readingTimeSortOrderDesc(b);
        if (ta !== tb) return ta - tb;
        if (ta === 0) {
          const cmp = b.lastReadAt! - a.lastReadAt!;
          return cmp || byName(a, b);
        }
        return byName(a, b);
      });
    case "addedAtAsc":
      return out.sort(
        (a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0) || byName(a, b),
      );
    case "addedAtDesc":
      return out.sort(
        (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || byName(a, b),
      );
    default:
      return out.sort(byName);
  }
}

export function useReaderSidebarLists(
  props: ReaderSidebarListProps,
  emit: (e: "jumpToChapter", chapter: Chapter) => void,
) {
  const chapterListRef = ref<InstanceType<typeof VirtualList> | null>(null);
  const fileListRef = ref<InstanceType<typeof VirtualList> | null>(null);
  const bookmarkListRef = ref<InstanceType<typeof VirtualList> | null>(null);

  const fileFilterQuery = ref("");

  /**
   * 当前排序为「打开时间」（升或降）时从 meta 拍快照；排序只用快照，
   * 打开文件时更新 `lastOpenedAt` 不会改列表顺序；每次选「打开时间」会重拍（含升/降互切）。
   */
  const openedAtSortSnapshot = shallowRef(new Map<string, number>());

  function refreshOpenedAtSortSnapshotFromMeta() {
    const m = new Map<string, number>();
    for (const r of props.fileMetaRecords ?? []) {
      if (
        typeof r.lastOpenedAt === "number" &&
        Number.isFinite(r.lastOpenedAt)
      ) {
        m.set(fileHistoryKey(r.path), r.lastOpenedAt);
      }
    }
    openedAtSortSnapshot.value = m;
  }

  watch(
    () => props.fileSort ?? "nameAsc",
    (mode) => {
      if (mode === "lastReadAtAsc" || mode === "lastReadAtDesc") {
        refreshOpenedAtSortSnapshotFromMeta();
      }
    },
    { immediate: true },
  );

  /**
   * 分类来自列表项 `TxtFileItem.category`；（按需）合并打开时间快照。
   * **不**合并 `metaProgressByPathKey` / 实时进度，避免滚动时整表 `.map` 与下游 watcher 连锁。
   * 分类字段已规范化的行复用源对象引用，减轻「只改少数项分类」时的分配与下游重算。
   */
  const fileRowsEnriched = computed((): SidebarFileItem[] => {
    const list = props.files;
    const sortMode = props.fileSort ?? "nameAsc";
    const needLastRead =
      sortMode === "lastReadAtAsc" || sortMode === "lastReadAtDesc";
    const snap = openedAtSortSnapshot.value;
    const n = list.length;
    const out: SidebarFileItem[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const f = list[i]!;
      const key = fileHistoryKey(f.path);
      if (needLastRead) {
        const lastAt = snap.get(key);
        if (lastAt === undefined && categoryFieldAlreadyTrimmed(f)) {
          out[i] = f as SidebarFileItem;
        } else {
          const trimmed = (f.category ?? "").trim();
          const row: SidebarFileItem = categoryFieldAlreadyTrimmed(f)
            ? { ...f }
            : { ...f, category: trimmed };
          if (lastAt !== undefined) row.lastReadAt = lastAt;
          out[i] = row;
        }
      } else if (categoryFieldAlreadyTrimmed(f)) {
        out[i] = f as SidebarFileItem;
      } else {
        out[i] = { ...f, category: (f.category ?? "").trim() };
      }
    }
    return out;
  });

  const filesByCategory = computed(() => {
    const list = fileRowsEnriched.value;
    const filter = props.fileCategory ?? FILE_CATEGORY_FILTER_ALL;
    if (filter === FILE_CATEGORY_FILTER_ALL) return list;
    if (filter === FILE_CATEGORY_FILTER_UNCATEGORIZED) {
      return list.filter((f) => !effectiveCategoryName(f));
    }
    return list.filter((f) => effectiveCategoryName(f) === filter);
  });

  const filesSorted = computed(() => {
    const mode = props.fileSort ?? "nameAsc";
    const base = filesByCategory.value;
    const needsArchivedProgressOnly =
      mode === "lastReadAtAsc" || mode === "lastReadAtDesc";
    if (needsArchivedProgressOnly) {
      const map = props.metaProgressByPathKey ?? EMPTY_META_PROGRESS;
      const merged = base.map((f) => ({
        ...f,
        progress: map.get(fileHistoryKey(f.path)),
      }));
      return sortFileList(merged, mode);
    }
    if (mode !== "progressAsc" && mode !== "progressDesc") {
      return sortFileList(base, mode);
    }
    const map = props.metaProgressByPathKey ?? EMPTY_META_PROGRESS;
    const cur = props.currentFilePath;
    const live = props.liveReadingProgressPercent;
    const merged = base.map((f) => {
      const key = fileHistoryKey(f.path);
      const p =
        cur === f.path && typeof live === "number" ? live : map.get(key);
      return { ...f, progress: p };
    });
    return sortFileList(merged, mode);
  });

  const filesFiltered = computed<SidebarFileItem[]>(() => {
    const q = fileFilterQuery.value.trim().toLowerCase();
    const base = filesSorted.value;
    if (!q) return base;
    return base.filter((f) => f.name.toLowerCase().includes(q));
  });

  const chapterMinCharFloor = computed(() =>
    Math.max(
      0,
      Math.floor(props.chapterMinCharCount ?? defaultChapterMinCharCount),
    ),
  );

  function chapterMeetsMinCharCount(ch: Chapter): boolean {
    const floor = chapterMinCharFloor.value;
    return floor <= 0 || ch.charCount >= floor;
  }

  const chaptersVisible = computed(() =>
    props.chapters
      .filter((ch) => chapterMeetsMinCharCount(ch))
      .slice()
      .sort(
        (a, b) =>
          (a.tocOrder ?? a.lineNumber) - (b.tocOrder ?? b.lineNumber) ||
          a.lineNumber - b.lineNumber,
      ),
  );
  const bookmarksVisible = computed<SidebarBookmarkItem[]>(() =>
    props.bookmarks.slice().sort((a, b) => a.line - b.line),
  );

  const sidebarActiveLineNumber = computed(() => {
    const list = props.chapters;
    const idx = props.activeChapterIdx;
    if (idx < 0 || idx >= list.length) return -1;
    let i = idx;
    while (i >= 0 && !chapterMeetsMinCharCount(list[i]!)) i--;
    if (i < 0) return -1;
    return list[i].lineNumber;
  });

  const activeChapterKey = computed(() => {
    const list = props.chapters;
    const idx = props.activeChapterIdx;
    if (idx < 0 || idx >= list.length) return "";
    let i = idx;
    while (i >= 0 && !chapterMeetsMinCharCount(list[i]!)) i--;
    if (i < 0) return "";
    const ch = list[i]!;
    return ch.tocOrder != null
      ? `o:${ch.tocOrder}`
      : `l:${ch.lineNumber}:${ch.title}`;
  });

  function isChapterActive(ch: Chapter): boolean {
    const list = props.chapters;
    const idx = props.activeChapterIdx;
    if (idx < 0 || idx >= list.length) return false;
    let i = idx;
    while (i >= 0 && !chapterMeetsMinCharCount(list[i]!)) i--;
    if (i < 0) return false;
    const active = list[i]!;
    if (
      active.tocOrder != null &&
      ch.tocOrder != null &&
      active.tocOrder === ch.tocOrder
    ) {
      return true;
    }
    return active.lineNumber === ch.lineNumber && active.title === ch.title;
  }

  let suppressAutoScrollUntil = 0;

  const MAX_CHAPTER_LIST_LAYOUT_RETRIES = 48;

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

  function resetChapterListScroll(): void {
    chapterListRef.value?.scrollToTop();
  }

  function resolveActiveChapterVisibleIndex(): number {
    const visible = chaptersVisible.value;
    if (visible.length === 0) return -1;
    const full = props.chapters;
    const ai = props.activeChapterIdx;
    if (ai >= 0 && ai < full.length) {
      let i = ai;
      while (i >= 0 && !chapterMeetsMinCharCount(full[i]!)) i--;
      if (i >= 0) {
        const ch = full[i]!;
        if (ch.tocOrder != null) {
          const byOrder = visible.findIndex((v) => v.tocOrder === ch.tocOrder);
          if (byOrder >= 0) return byOrder;
        }
        const byTitle = visible.findIndex(
          (v) => v.lineNumber === ch.lineNumber && v.title === ch.title,
        );
        if (byTitle >= 0) return byTitle;
      }
    }
    const line = sidebarActiveLineNumber.value;
    if (line >= 0) {
      return visible.findIndex((ch) => ch.lineNumber === line);
    }
    return -1;
  }

  /** 章节表就绪后：将当前章滚到列表视口垂直居中 */
  async function centerActiveChapterInList(smooth = false): Promise<void> {
    await nextTick();
    await waitChapterListLayoutFrames(2);
    const idx = resolveActiveChapterVisibleIndex();
    if (idx < 0) return;
    await ensureActiveChapterVisible(
      {
        smooth,
        allowWhenHidden: true,
        align: "center",
        force: true,
      },
      0,
      idx,
    );
  }

  async function ensureActiveChapterVisible(
    override?: {
      smooth?: boolean;
      align?: "auto" | "center";
      /**
       * 当侧栏章节列表当前未显示（tab!=chapters / display:none）时：
       * - allowWhenHidden=true：仍尝试写入虚拟列表的 scrollTop（虚拟列表内部会在可见后同步）
       * - allowWhenHidden=false：保持原行为（不打断用户/不做隐藏滚动）
       */
      allowWhenHidden?: boolean;
      /** 展示选项切换后须强制滚动（避免旧 scrollTop 触发 early-return） */
      force?: boolean;
    },
    layoutRetry = 0,
    visibleIndexOverride?: number,
  ): Promise<void> {
    const wantSmoothScroll = props.inFullscreen
      ? false
      : override?.smooth !== undefined
        ? override.smooth
        : props.chapterListScrollSmooth;
    const align =
      override?.align ??
      (props.activeScrollMode === "center" ? "center" : "auto");
    const allowWhenHidden = override?.allowWhenHidden === true;

    await nextTick();
    if (Date.now() < suppressAutoScrollUntil) {
      return;
    }
    const list = chaptersVisible.value;
    const idx =
      visibleIndexOverride != null && visibleIndexOverride >= 0
        ? Math.min(visibleIndexOverride, list.length - 1)
        : resolveActiveChapterVisibleIndex();
    if (idx < 0) return;

    const vl = chapterListRef.value;
    const scrollHost = vl?.scrollEl as HTMLElement | undefined;
    const clientH = scrollHost?.clientHeight ?? 0;
    if (
      !vl ||
      !scrollHost ||
      (!allowWhenHidden && clientH <= 0) ||
      (!allowWhenHidden && props.activeTab !== "chapters")
    ) {
      if (layoutRetry < MAX_CHAPTER_LIST_LAYOUT_RETRIES) {
        requestAnimationFrame(
          () =>
            void ensureActiveChapterVisible(
              {
                smooth: wantSmoothScroll,
                allowWhenHidden,
                align,
                force: override?.force,
              },
              layoutRetry + 1,
              visibleIndexOverride,
            ),
        );
      }
      return;
    }

    const behavior = wantSmoothScroll ? "smooth" : "auto";
    vl.scrollToIndex(idx, {
      align: align === "center" ? "center" : "auto",
      behavior,
      force: override?.force === true,
    });
  }

  const MAX_FILE_LIST_LAYOUT_RETRIES = 48;

  async function ensureCurrentFileVisible(
    mode: "edge" | "center" = "edge",
    layoutRetry = 0,
  ): Promise<void> {
    await nextTick();
    const path = props.currentFilePath;
    if (!path) return;
    const list = filesFiltered.value;
    const idx = list.findIndex((f) => f.path === path);
    if (idx < 0) return;

    const vl = fileListRef.value;
    const scrollHost = vl?.scrollEl as HTMLElement | undefined;
    const clientH = scrollHost?.clientHeight ?? 0;
    if (!vl || !scrollHost || clientH <= 0 || props.activeTab !== "files") {
      if (layoutRetry < MAX_FILE_LIST_LAYOUT_RETRIES) {
        requestAnimationFrame(
          () => void ensureCurrentFileVisible(mode, layoutRetry + 1),
        );
      }
      return;
    }

    if (mode === "center") {
      vl.scrollToIndex(idx, { align: "center", behavior: "auto" });
      return;
    }
    vl.scrollToIndex(idx, { align: "auto", behavior: "auto" });
  }

  async function ensureActiveBookmarkVisible(
    mode: "edge" | "center" = "center",
    smooth = true,
  ) {
    await nextTick();
    const activeLine = props.activeBookmarkLine ?? -1;
    if (activeLine < 0) return;
    const idx = bookmarksVisible.value.findIndex(
      (it) => it.line === activeLine,
    );
    if (idx < 0) return;
    const vl = bookmarkListRef.value;
    if (!vl) return;
    const behavior = props.inFullscreen ? "auto" : smooth ? "smooth" : "auto";
    if (mode === "center") {
      vl.scrollToIndex(idx, { align: "center", behavior });
      return;
    }
    vl.scrollToIndex(idx, { align: "auto", behavior });
  }

  function onChapterItemClick(chapter: Chapter) {
    suppressAutoScrollUntil = Date.now() + 800;
    emit("jumpToChapter", chapter);
  }

  watch(
    () => props.shouldCenterChapterList,
    (v) => {
      if (!v) return;
      if (props.suppressChapterListAutoScroll) return;
      if (props.activeChapterIdx < 0) return;
      const smooth = props.chapterListScrollSmooth;
      void centerActiveChapterInList(smooth);
    },
  );

  watch(
    () => [props.activeChapterIdx, activeChapterKey.value] as [number, string],
    (curr, prev) => {
      if (props.suppressChapterListAutoScroll) return;
      const [idx, key] = curr;
      if (idx < 0 || !key) return;
      if (prev) {
        const [pIdx, pKey] = prev;
        if (pIdx === idx && pKey === key) return;
      }
      const smooth = props.chapterListScrollSmooth;
      // 阅读器滚动换章时：章节列表可能不处于显示状态，但仍应居中当前章。
      void ensureActiveChapterVisible({ smooth, allowWhenHidden: true });
    },
  );

  // 切换到「章节 / 文件」时：列表可能刚从隐藏变为可见（clientHeight 由 0 变为正常），
  // 此前 `shouldCenter*` 一拍或打开文件时的 pulse 可能未生效；此处补一次居中。
  watch(
    () => props.activeTab,
    (tab) => {
      void nextTick(() => {
        requestAnimationFrame(() => {
          if (tab === "chapters") {
            void ensureActiveChapterVisible({
              smooth: false,
              allowWhenHidden: false,
              align: "center",
              force: true,
            });
          } else if (tab === "files" && props.currentFilePath) {
            void ensureCurrentFileVisible("center");
          }
        });
      });
    },
  );

  watch(
    () => props.shouldCenterFileList,
    (v) => {
      if (!v) return;
      if (!props.currentFilePath) return;
      void ensureCurrentFileVisible("center");
    },
  );

  watch(
    () => props.shouldCenterBookmarkList,
    (v) => {
      if (!v) return;
      if ((props.activeBookmarkLine ?? -1) < 0) return;
      void ensureActiveBookmarkVisible("center", true);
    },
  );

  watch(fileFilterQuery, (newVal, oldVal) => {
    if (props.activeTab !== "files") return;
    const newQ = newVal.trim();
    const oldQ = (oldVal ?? "").trim();
    void nextTick(() => {
      if (oldQ.length > 0 && newQ.length === 0) {
        const path = props.currentFilePath;
        if (path) {
          const list = filesFiltered.value;
          if (list.some((f) => f.path === path)) {
            void ensureCurrentFileVisible("center");
            return;
          }
        }
        fileListRef.value?.scrollToTop();
        return;
      }
      if (newQ.length > 0) {
        fileListRef.value?.scrollToTop();
      }
    });
  });

  watch(
    () => [props.fileCategory, props.fileSort] as const,
    () => {
      if (props.activeTab !== "files") return;
      void nextTick(() => {
        const path = props.currentFilePath;
        if (path && filesFiltered.value.some((f) => f.path === path)) {
          void ensureCurrentFileVisible(
            props.activeScrollMode === "center" ? "center" : "edge",
          );
          return;
        }
        fileListRef.value?.scrollToTop();
      });
    },
  );

  async function scrollFileListToIndex(index: number) {
    await nextTick();
    const vl = fileListRef.value;
    if (!vl) return;
    const list = filesFiltered.value;
    const n = list.length;
    if (n <= 0) return;
    const idx = Math.max(0, Math.min(Math.floor(index), n - 1));
    vl.scrollToIndex(idx, { align: "auto", behavior: "auto" });
  }

  return {
    chapterListRef,
    fileListRef,
    bookmarkListRef,
    fileFilterQuery,
    /** 含 meta 分类/进度等，供分类菜单计数与「共 n 个文件」等（与原始 `files` 条数一致） */
    fileRowsEnriched,
    filesFiltered,
    chaptersVisible,
    bookmarksVisible,
    sidebarActiveLineNumber,
    isChapterActive,
    onChapterItemClick,
    ensureActiveBookmarkVisible,
    ensureCurrentFileVisible,
    scrollFileListToIndex,
    resetChapterListScroll,
    centerActiveChapterInList,
  };
}
