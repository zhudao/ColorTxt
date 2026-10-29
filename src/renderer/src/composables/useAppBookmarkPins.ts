import { computed, nextTick, ref, watch, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import type { Chapter } from "../chapter";
import { APP_DISPLAY_NAME } from "../constants/appUi";
import { pickActiveChapterIdx } from "../reader/chapterIndex";
import { appToast } from "../services/appToast";
import {
  findFileMetaRecord,
  type FileBookmarkItem,
  type FileMetaRecord,
} from "../stores/fileMetaStore";
import type {
  TextConvertWidthMode,
  TextConvertZhMode,
} from "@shared/textConvertTypes";

type ReaderRef = Ref<InstanceType<typeof ReaderMain> | null>;
type TxtStreamPipeline = ReturnType<
  typeof import("./useTxtStreamPipeline").useTxtStreamPipeline
>;

export function useAppBookmarkPins(deps: {
  readerRef: ReaderRef;
  stream: TxtStreamPipeline;
  /** 为 true 时 Monaco 与磁盘物理行一一对应，跳转/视口书签判定勿走滤空映射 */
  readerEditMode: Ref<boolean>;
  currentFile: Ref<string | null>;
  loading: Ref<boolean>;
  totalLineCount: Ref<number>;
  fileMetaRecords: Ref<FileMetaRecord[]>;
  lastProbeLine: Ref<number>;
  viewportEndLine: Ref<number>;
  sidebarTab: Ref<import("../constants/readerSidebarTab").ReaderSidebarTab>;
  pulseBookmarkListCenter: () => void;
  upsertBookmark: (path: string, line: number, note: string) => void;
  removeBookmark: (path: string, line: number) => void;
  clearBookmarks: (path: string) => void;
  chapters: Ref<readonly Chapter[]>;
  textConvertZh: Ref<TextConvertZhMode>;
  textConvertLetter: Ref<TextConvertWidthMode>;
  textConvertDigit: Ref<TextConvertWidthMode>;
  compressBlankLines: Ref<boolean>;
  leadIndentFullWidth: Ref<boolean>;
}) {
  const pinnedScrollTop = ref<number | null>(null);
  const pinActive = computed(() => pinnedScrollTop.value !== null);
  const canPin = computed(
    () =>
      Boolean(deps.currentFile.value) &&
      !deps.loading.value &&
      deps.totalLineCount.value > 0,
  );
  const canBookmark = canPin;

  const addBookmarkOpen = ref(false);
  const removeBookmarkOpen = ref(false);
  const bookmarkNoteInput = ref("");
  const bookmarkNoteInputRef = ref<HTMLTextAreaElement | null>(null);
  const editingBookmarkLine = ref<number | null>(null);
  /** 编辑书签时「更新为当前行」暂存的行号；仅点「保存」写入 meta，关弹窗或取消则清除。 */
  const stagedEditingBookmarkLine = ref<number | null>(null);

  watch(deps.currentFile, () => {
    pinnedScrollTop.value = null;
  });
  watch(addBookmarkOpen, async (open) => {
    if (!open) {
      stagedEditingBookmarkLine.value = null;
      return;
    }
    await nextTick();
    const el = bookmarkNoteInputRef.value;
    if (!el) return;
    el.focus();
    el.select();
  });

  const currentFileBookmarks = computed<FileBookmarkItem[]>(() => {
    const path = deps.currentFile.value;
    if (!path) return [];
    return (
      findFileMetaRecord(deps.fileMetaRecords.value, path)
        ?.bookmarks.slice()
        .sort((a, b) => a.line - b.line) ?? []
    );
  });

  const viewportTopPhysicalLine = computed(() => {
    const probeTick = deps.lastProbeLine.value;
    const top = deps.readerRef.value?.getViewportTopLine?.();
    const displayTop =
      typeof top === "number" && Number.isFinite(top) ? top : probeTick;
    if (deps.readerEditMode.value) {
      return Math.max(1, Math.floor(displayTop));
    }
    return deps.stream.viewportDisplayLineToPhysicalLine(displayTop);
  });
  const viewportBottomPhysicalLine = computed(() => {
    const end = deps.viewportEndLine.value;
    if (deps.readerEditMode.value) {
      return Math.max(1, Math.floor(end));
    }
    return deps.stream.viewportDisplayLineToPhysicalLine(end);
  });

  const activeBookmarkInViewport = computed<FileBookmarkItem | null>(() => {
    const top = Math.min(
      viewportTopPhysicalLine.value,
      viewportBottomPhysicalLine.value,
    );
    const bottom = Math.max(
      viewportTopPhysicalLine.value,
      viewportBottomPhysicalLine.value,
    );
    for (const item of currentFileBookmarks.value) {
      if (item.line >= top && item.line <= bottom) return item;
    }
    return null;
  });
  const activeBookmarkLine = computed(
    () => activeBookmarkInViewport.value?.line ?? null,
  );
  const bookmarkActive = computed(
    () => activeBookmarkInViewport.value !== null,
  );

  function bookmarkPreviewLineContent(physicalLine: number): string {
    const line = Math.max(1, Math.floor(physicalLine));
    if (deps.readerEditMode.value) {
      return deps.stream.getPhysicalLineContent(line).trim();
    }
    const displayLine = deps.stream.physicalLineToDisplayForReader(line);
    return deps.stream.getDisplayLineContent(displayLine).trim();
  }

  function resolveBookmarkPreviewContent(line: number) {
    const start = Math.max(1, Math.floor(line));
    const end = Math.max(start, deps.stream.getPhysicalLineCount());
    for (let i = start; i <= end; i += 1) {
      const text = bookmarkPreviewLineContent(i);
      if (text) return text;
    }
    return "";
  }

  function resolveBookmarkChapterTitle(storedLine: number): string | undefined {
    const list = deps.chapters.value;
    if (list.length === 0) return undefined;
    const displayLine = deps.readerEditMode.value
      ? Math.max(1, Math.floor(storedLine))
      : deps.stream.physicalLineToDisplayForReader(storedLine);
    const idx = pickActiveChapterIdx(list, displayLine);
    if (idx < 0) return undefined;
    const t = list[idx]?.title?.trim();
    return t ? t : undefined;
  }

  const bookmarkListItems = computed(() => {
    // 展示层（format / 转换）变化时须重算原文摘要
    void deps.totalLineCount.value;
    void deps.readerEditMode.value;
    void deps.textConvertZh.value;
    void deps.textConvertLetter.value;
    void deps.textConvertDigit.value;
    void deps.compressBlankLines.value;
    void deps.leadIndentFullWidth.value;
    return currentFileBookmarks.value.map((it) => ({
      line: it.line,
      note: it.note,
      content: resolveBookmarkPreviewContent(it.line),
      chapterTitle: resolveBookmarkChapterTitle(it.line),
    }));
  });
  watch(activeBookmarkLine, (line, prev) => {
    if (line == null || line === prev) return;
    if (deps.sidebarTab.value === "bookmarks") deps.pulseBookmarkListCenter();
  });

  function onPinClick() {
    if (pinnedScrollTop.value !== null) {
      pinnedScrollTop.value = null;
      return;
    }
    if (!canPin.value) return;
    const top = deps.readerRef.value?.getScrollTop?.() ?? 0;
    pinnedScrollTop.value = Math.max(0, top);
  }

  /** 与手动点亮书钉一致；已激活或不可钉时不修改。 */
  function ensurePinBeforeRevealFindWidget() {
    if (pinnedScrollTop.value !== null) return;
    if (!canPin.value) return;
    const top = deps.readerRef.value?.getScrollTop?.() ?? 0;
    pinnedScrollTop.value = Math.max(0, top);
  }

  function onGoBackFromPin() {
    const top = pinnedScrollTop.value;
    if (top == null) return;
    deps.readerRef.value?.scrollToScrollTop?.(top, true);
    pinnedScrollTop.value = null;
    queueMicrotask(() => {
      deps.readerRef.value?.emitProbeLine?.();
    });
  }

  function onBookmarkClick() {
    if (!deps.currentFile.value || !canBookmark.value) return;
    if (bookmarkActive.value) {
      removeBookmarkOpen.value = true;
      addBookmarkOpen.value = false;
      return;
    }
    editingBookmarkLine.value = null;
    stagedEditingBookmarkLine.value = null;
    bookmarkNoteInput.value = deps.readerRef.value?.getSelectedText?.() ?? "";
    addBookmarkOpen.value = true;
    removeBookmarkOpen.value = false;
  }

  /** 当前视口锚点行（与新建书签写入行一致）：锚点显示行 → 物理/显示行；无锚点时回退视口顶行。 */
  function resolveViewportBookmarkAnchorLine(): number {
    const anchor =
      deps.readerRef.value?.getBookmarkSaveAnchorDisplayLine?.() ?? null;
    if (typeof anchor === "number" && Number.isFinite(anchor)) {
      const displayLine = Math.max(1, Math.floor(anchor));
      return deps.readerEditMode.value
        ? displayLine
        : deps.stream.viewportDisplayLineToPhysicalLine(displayLine);
    }
    return viewportTopPhysicalLine.value;
  }

  /** 添加/编辑书签弹窗与 `confirmAddBookmark` 使用的行号（阅读模式为物理行，编辑模式为显示行）。 */
  function getPendingBookmarkSaveLine(): number {
    if (editingBookmarkLine.value != null) {
      return (
        stagedEditingBookmarkLine.value ?? editingBookmarkLine.value
      );
    }
    return resolveViewportBookmarkAnchorLine();
  }

  const addBookmarkDialogPreview = computed(() => {
    if (!addBookmarkOpen.value) return null;
    void deps.totalLineCount.value;
    void deps.lastProbeLine.value;
    void deps.chapters.value;
    void deps.readerEditMode.value;
    void deps.textConvertZh.value;
    void deps.textConvertLetter.value;
    void deps.textConvertDigit.value;
    void deps.compressBlankLines.value;
    void deps.leadIndentFullWidth.value;
    void stagedEditingBookmarkLine.value;
    const line = getPendingBookmarkSaveLine();
    return {
      chapterTitle: resolveBookmarkChapterTitle(line),
      content: resolveBookmarkPreviewContent(line),
    };
  });

  function confirmAddBookmark() {
    const path = deps.currentFile.value;
    if (!path) return;
    const origEditLine = editingBookmarkLine.value;
    const line = getPendingBookmarkSaveLine();
    const note = bookmarkNoteInput.value.replace(/\r?\n/g, " ").trim();
    if (origEditLine != null) {
      if (line !== origEditLine) {
        if (
          currentFileBookmarks.value.some(
            (it) => it.line === line && it.line !== origEditLine,
          )
        ) {
          appToast("目标行已有书签，请先移除或更换阅读位置", {
            kind: "warning",
          });
          return;
        }
        deps.removeBookmark(path, origEditLine);
      }
      deps.upsertBookmark(path, line, note);
    } else {
      deps.upsertBookmark(path, line, note);
    }
    editingBookmarkLine.value = null;
    stagedEditingBookmarkLine.value = null;
    addBookmarkOpen.value = false;
    if (deps.sidebarTab.value === "bookmarks") deps.pulseBookmarkListCenter();
  }

  /** 编辑书签：仅暂存当前视口锚点行；与备注一并于「保存」写入；「取消」关弹窗会清暂存。 */
  function updateEditingBookmarkToCurrentViewportLine() {
    const origLine = editingBookmarkLine.value;
    if (origLine == null || !canBookmark.value) return;
    const newLine = resolveViewportBookmarkAnchorLine();
    const effectiveBefore = stagedEditingBookmarkLine.value ?? origLine;
    if (newLine === effectiveBefore) return;
    if (
      currentFileBookmarks.value.some(
        (it) => it.line === newLine && it.line !== origLine,
      )
    ) {
      appToast("目标行已有书签，请先移除或更换阅读位置", { kind: "warning" });
      return;
    }
    stagedEditingBookmarkLine.value = newLine;
  }

  function confirmRemoveActiveBookmark() {
    const path = deps.currentFile.value;
    const line = activeBookmarkLine.value;
    if (!path || line == null) return;
    deps.removeBookmark(path, line);
    removeBookmarkOpen.value = false;
  }

  function jumpToBookmark(line: number) {
    ensurePinBeforeRevealFindWidget();
    const displayLine = deps.readerEditMode.value
      ? Math.max(1, Math.floor(line))
      : deps.stream.physicalLineToDisplayForReader(line);
    deps.readerRef.value?.jumpToBookmarkLine(displayLine);
    queueMicrotask(() => deps.readerRef.value?.emitProbeLine?.());
  }

  async function clearCurrentFileBookmarks() {
    const path = deps.currentFile.value;
    if (!path) return;
    if (!window.colorTxt) return;
    const r = await window.colorTxt.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      buttons: ["取消", "清空"],
      defaultId: 1,
      cancelId: 0,
      message: "是否要清空当前文件的所有书签？",
      detail: "此操作不可逆！",
      noLink: true,
    });
    if (r.response !== 1) return;
    deps.clearBookmarks(path);
  }

  function removeCurrentFileBookmarks(lines: number[]) {
    const path = deps.currentFile.value;
    if (!path) return;
    for (const line of lines) deps.removeBookmark(path, line);
  }

  function onEditBookmark(line: number) {
    const item = currentFileBookmarks.value.find((it) => it.line === line);
    editingBookmarkLine.value = line;
    stagedEditingBookmarkLine.value = null;
    bookmarkNoteInput.value = item?.note ?? "";
    addBookmarkOpen.value = true;
    removeBookmarkOpen.value = false;
  }

  function onRemoveBookmark(line: number) {
    const path = deps.currentFile.value;
    if (!path) return;
    deps.removeBookmark(path, line);
  }

  return {
    pinnedScrollTop,
    pinActive,
    canPin,
    canBookmark,
    addBookmarkOpen,
    removeBookmarkOpen,
    bookmarkNoteInput,
    bookmarkNoteInputRef,
    editingBookmarkLine,
    currentFileBookmarks,
    viewportTopPhysicalLine,
    viewportBottomPhysicalLine,
    activeBookmarkInViewport,
    activeBookmarkLine,
    bookmarkActive,
    bookmarkListItems,
    addBookmarkDialogPreview,
    onPinClick,
    ensurePinBeforeRevealFindWidget,
    onGoBackFromPin,
    onBookmarkClick,
    confirmAddBookmark,
    updateEditingBookmarkToCurrentViewportLine,
    confirmRemoveActiveBookmark,
    jumpToBookmark,
    clearCurrentFileBookmarks,
    removeCurrentFileBookmarks,
    onEditBookmark,
    onRemoveBookmark,
  };
}
