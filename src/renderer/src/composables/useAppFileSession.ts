import { nextTick, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import ReaderSidebar from "../components/ReaderSidebar.vue";
import {
  basenameFromPath,
  normalizeTxtFileItem,
  readTxtDirectoryFromDialog,
  mergeTxtFileLists,
  type TxtFileItem,
} from "../services/fileListService";
import { appAlert } from "../services/appDialog";
import { prepareOpenFile } from "../services/fileOpenService";
import { loadSessionSnapshot } from "../stores/cacheStore";
import { useAppPersistence } from "./useAppPersistence";
import { normalizeFileMetaPathKey } from "../stores/fileMetaStore";
import { isEbookFilePath, isSupportedBookPath } from "../ebook/ebookFormat";
import { ensureEbookMarkdown } from "../ebook/convert/convertEbookToMarkdown";
import { yieldToUi } from "../ebook/yieldToUi";
import { useAppChapterListSync } from "./useAppChapterListSync";
import { useTxtStreamPipeline } from "./useTxtStreamPipeline";
import type { Chapter } from "../chapter";
import {
  FILE_CATEGORY_FILTER_ALL,
  displayNameForCategoryFilter,
  filePathsMatchingCategoryFilter,
  normalizeCategoryFilter,
} from "../constants/fileCategories";
import {
  APP_DISPLAY_NAME,
  sessionKey,
  fileListKey,
} from "../constants/appUi";
import { COLOR_TXT_OPEN_BOOK_EXTENSIONS } from "@shared/colorTxtOpenSaveDialog";
import { fileHistoryKey } from "../stores/recentHistoryStore";

/** 等浏览器下一帧再续，让 Monaco 在空文档上完成绘制，避免黏性章节标题滞留 */
function waitNextPaintFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * 流结束时 `restorePhys >= totalPhysical` 会走 `scrollToBottom`（见 useAppWindowBindings）。
 * 用于已读完（100%）时跳过可能因窗口缩放而失准的 Monaco viewState / 行号恢复。
 */
const RESTORE_PHYSICAL_LINE_SCROLL_TO_END = Number.MAX_SAFE_INTEGER;

function isReadingCompleteProgress(progress: number | undefined): boolean {
  return (
    typeof progress === "number" && Number.isFinite(progress) && progress >= 100
  );
}

type Persistence = ReturnType<typeof useAppPersistence>;
type ChapterSync = ReturnType<typeof useAppChapterListSync>;
type Stream = ReturnType<typeof useTxtStreamPipeline>;

export function useAppFileSession(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  readerSidebarRef: Ref<InstanceType<typeof ReaderSidebar> | null>;
  stream: Stream;
  persistence: Persistence;
  chapterSync: ChapterSync;
  currentFile: Ref<string | null>;
  loading: Ref<boolean>;
  loadingProgressPercent: Ref<number | null>;
  dirListScanning: Ref<boolean>;
  dirListCurrentName: Ref<string>;
  fileEncoding: Ref<string>;
  currentFileSize: Ref<number | null>;
  totalCharCount: Ref<number>;
  totalLineCount: Ref<number>;
  chapters: Ref<Chapter[]>;
  activeChapterIdx: Ref<number>;
  sidebarTab: Ref<import("../constants/readerSidebarTab").ReaderSidebarTab>;
  txtFiles: Ref<TxtFileItem[]>;
  lastProbeLine: Ref<number>;
  viewportTopLine: Ref<number>;
  viewportEndLine: Ref<number>;
  pendingRestorePhysicalLine: Ref<number | null>;
  /** 流结束后 `restoreViewState`；与 pendingRestorePhysicalLine 二选一 */
  pendingRestoreEditorViewState: Ref<unknown | null>;
  /** 与视图状态配套的视口首行物理行号，用于流结束后校验 */
  pendingRestoreViewportTopPhysicalLine: Ref<number | null>;
  /** 流结束后按视口第二行高锚点恢复（编辑切回只读等） */
  pendingRestoreViewportAnchor: Ref<
    import("../reader/readerViewportAnchor").ReaderViewportRestoreAnchor | null
  >;
  recentFiles: Ref<import("../components/AppHeader.vue").RecentFileItem[]>;
  restoreSessionOnStartup: Ref<boolean>;
  /** 与主进程流 requestId 对齐；resetSession 时清空，避免旧 chunk 在清空后仍被当作当前流处理 */
  activeStreamRequestId: Ref<number | null>;
  activeStreamFilePath: Ref<string | null>;
  /** 磁盘上实际被流式读取的路径（电子书为转换后的 `{原名}.txt`，与 currentFile 可能不同） */
  physicalReaderPath: Ref<string | null>;
  /** 打开/重置会话后为 false，流结束并完成阅读位置同步后为 true */
  readingProgressSynced: Ref<boolean>;
  ebookConvertOutputDir: Ref<string>;
  ebookParsing: Ref<boolean>;
  /** 正在转换的电子书源路径（用于底栏在 resetSession 之前显示「转换中…」） */
  ebookConversionSourcePath: Ref<string | null>;
  readerEditMode: Ref<boolean>;
  readerEditorDirty: Ref<boolean>;
  /**
   * 在合并进 `txtFiles` **之后**调用：传入本次新加入的路径；
   * 若当前筛选为具体分类则写入列表项 `category`；为「全部 / 未分类」时不改。
   */
  applyCurrentFileCategoryIfConcrete?: (newPaths: string[]) => void;
  /** 切书/关文件前：返回 false 表示用户取消（保留未保存编辑） */
  confirmIfReaderEditDiscard?: () => Promise<boolean>;
}) {
  const {
    persistFileListCache,
    loadTxtFileListSnapshot,
    touchRecentFile,
    removeRecentFile,
    getFileMeta,
    persistFileMeta,
    patchMetaProgressForPath,
    setEbookConvertedMeta,
  } = deps.persistence;
  const { pulseFileListCenter, suppressFileListCenterAfterLoad } =
    deps.chapterSync;

  /**
   * 打开文件后再写回侧栏 `size`，避免与首帧流式加载抢主线程；无变更则 no-op。
   */
  function scheduleDeferredFileListSizeSync(
    sessionPath: string,
    listSizeBytes: number,
  ) {
    const run = () => {
      const wantKey = fileHistoryKey(sessionPath);
      const list = deps.txtFiles.value;
      const idx = list.findIndex((f) => fileHistoryKey(f.path) === wantKey);
      if (idx < 0) return;
      const cur = list[idx]!;
      if (cur.size === listSizeBytes) return;
      const next = list.slice();
      next[idx] = normalizeTxtFileItem({ ...cur, size: listSizeBytes });
      deps.txtFiles.value = next;
      persistFileListCache();
    };

    const ric = (
      globalThis as typeof globalThis & {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number },
        ) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      ric(() => run(), { timeout: 2000 });
    } else {
      setTimeout(run, 0);
    }
  }

  async function resolvePhysicalTextForOpen(
    filePath: string,
    options?: { forceEbookConvert?: boolean },
  ): Promise<
    | {
        ok: true;
        physicalPath: string;
        sessionFilePath?: string;
        /** 底栏等：实际读取的文本字节数（电子书为转换结果 .txt） */
        displaySize: number;
        /** 与侧栏列表项 `path`（会话路径）一致时的磁盘字节数：纯文本即本文件；电子书为源书文件 */
        listSizeAtSessionPath: number;
      }
    | { ok: false; message: string }
  > {
    if (!isEbookFilePath(filePath)) {
      try {
        const st = await window.colorTxt.stat(filePath);
        if (!st.isFile) {
          return { ok: false, message: `文件不存在或不可访问：${filePath}` };
        }
        return {
          ok: true,
          physicalPath: filePath,
          displaySize: st.size,
          listSizeAtSessionPath: st.size,
        };
      } catch {
        return { ok: false, message: `文件不存在或不可访问：${filePath}` };
      }
    }

    try {
      const st = await window.colorTxt.stat(filePath);
      if (!st.isFile) {
        return { ok: false, message: `文件不存在或不可访问：${filePath}` };
      }
      const meta = getFileMeta(filePath);
      const { convertedMdPath, didConvert } = await ensureEbookMarkdown({
        sourceBookPath: filePath,
        ebookConvertOutputDir: deps.ebookConvertOutputDir.value,
        sourceMtimeMs: st.mtimeMs,
        existingConvertedPath: meta?.convertedMdPath,
        existingSourceMtimeMs: meta?.sourceMtimeMsAtConvert,
        forceConvert: options?.forceEbookConvert,
        onActualConversionStart: async () => {
          deps.ebookConversionSourcePath.value = filePath;
          deps.ebookParsing.value = true;
          await nextTick();
          await yieldToUi();
        },
      });
      const recordedMd = meta?.convertedMdPath?.trim();
      const pathMatch =
        Boolean(recordedMd) &&
        normalizeFileMetaPathKey(recordedMd!) ===
          normalizeFileMetaPathKey(convertedMdPath);
      const mtimeMatch =
        typeof meta?.sourceMtimeMsAtConvert === "number" &&
        meta.sourceMtimeMsAtConvert === st.mtimeMs;
      if (didConvert || !pathMatch || !mtimeMatch) {
        setEbookConvertedMeta(filePath, convertedMdPath, st.mtimeMs);
        persistFileMeta();
      }
      const tst = await window.colorTxt.stat(convertedMdPath);
      if (!tst.isFile) {
        return {
          ok: false,
          message: `转换结果未生成或路径不可读：${convertedMdPath}`,
        };
      }
      return {
        ok: true,
        physicalPath: convertedMdPath,
        sessionFilePath: filePath,
        displaySize: tst.size,
        listSizeAtSessionPath: st.size,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    } finally {
      deps.ebookParsing.value = false;
      deps.ebookConversionSourcePath.value = null;
    }
  }

  /** 文件列表替换后：若当前打开的文件仍在列表中，则将该项滚入视口并居中 */
  function centerFileListIfCurrentInList() {
    const path = deps.currentFile.value;
    if (!path) return;
    if (!deps.txtFiles.value.some((f) => f.path === path)) return;
    void nextTick(() => {
      pulseFileListCenter();
    });
  }

  async function clearFileList() {
    if (!window.colorTxt) return;
    const r = await window.colorTxt.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      buttons: ["取消", "清空"],
      defaultId: 1,
      cancelId: 0,
      message: "是否要清空文件列表？",
      detail: "不会关闭当前正在阅读的文件。",
      noLink: true,
    });
    if (r.response !== 1) return;
    deps.txtFiles.value = [];
    persistFileListCache();
  }

  async function clearFileListForCategory(categoryFilter: string) {
    if (!window.colorTxt) return;
    const norm = normalizeCategoryFilter(categoryFilter);
    if (norm === FILE_CATEGORY_FILTER_ALL) {
      await clearFileList();
      return;
    }
    const paths = filePathsMatchingCategoryFilter(deps.txtFiles.value, norm);
    if (paths.length === 0) return;
    const label = displayNameForCategoryFilter(norm);
    const n = paths.length;
    const r = await window.colorTxt.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      buttons: ["取消", "清空分类"],
      defaultId: 1,
      cancelId: 0,
      message: `是否从文件列表中移除「${label}」下的 ${n} 个文件？`,
      detail: "不会关闭当前正在阅读的文件。",
      noLink: true,
    });
    if (r.response !== 1) return;
    removeFileList(paths);
  }

  function removeFileList(filePaths: string[]) {
    if (!window.colorTxt) return;
    if (filePaths.length === 0) return;
    const removeSet = new Set(filePaths);
    const next = deps.txtFiles.value.filter((f) => !removeSet.has(f.path));
    if (next.length === deps.txtFiles.value.length) return;
    deps.txtFiles.value = next;
    persistFileListCache();
  }

  async function closeCurrentFile() {
    if (!deps.currentFile.value) return;
    if (deps.confirmIfReaderEditDiscard) {
      if (!(await deps.confirmIfReaderEditDiscard())) return;
    }
    rememberCurrentFileLine();
    deps.pendingRestorePhysicalLine.value = null;
    deps.pendingRestoreEditorViewState.value = null;
    deps.pendingRestoreViewportTopPhysicalLine.value = null;
    deps.pendingRestoreViewportAnchor.value = null;
    deps.readingProgressSynced.value = true;
    deps.currentFile.value = null;
    deps.activeStreamRequestId.value = null;
    deps.activeStreamFilePath.value = null;
    deps.physicalReaderPath.value = null;
    deps.readerEditMode.value = false;
    deps.readerEditorDirty.value = false;
    deps.loading.value = false;
    deps.loadingProgressPercent.value = null;
    deps.fileEncoding.value = "-";
    deps.currentFileSize.value = null;
    deps.totalCharCount.value = 0;
    deps.totalLineCount.value = 0;
    deps.viewportTopLine.value = 1;
    deps.viewportEndLine.value = 1;
    deps.lastProbeLine.value = 1;
    deps.chapters.value = [];
    deps.activeChapterIdx.value = -1;
    deps.stream.resetStreamInternals();
    deps.readerRef.value?.clear();
    deps.readerRef.value?.resetToTop();
  }

  function rememberCurrentFileLine() {
    if (!deps.currentFile.value) return;
    if (!deps.readingProgressSynced.value) return;
    const path = deps.currentFile.value;
    const progress = deps.stream.calcProgressPercentByViewportDisplay(
      deps.viewportTopLine.value,
      deps.viewportEndLine.value,
    );
    touchRecentFile(path, false, {
      persistRecent: true,
      persistMeta: true,
      /** 换书前落盘：原地改 meta，避免整表 upsert 新数组 + 侧栏整表连锁重算 */
      updateMeta: false,
      ...(typeof progress === "number" ? { progress } : {}),
    });
    if (typeof progress === "number") {
      patchMetaProgressForPath(path, progress);
    }
  }

  /** 在 `resetSession` 之前清空阅读区，便于感知正在加载 */
  function clearReaderBeforeResolve() {
    deps.readerRef.value?.clear({ keepStickyHiddenForStream: true });
    deps.readerRef.value?.resetToTop();
  }

  function resetSession(filePath: string) {
    deps.activeStreamRequestId.value = null;
    deps.activeStreamFilePath.value = null;
    deps.readingProgressSynced.value = false;
    deps.currentFile.value = filePath;
    deps.chapters.value = [];
    deps.activeChapterIdx.value = -1;
    deps.viewportTopLine.value = 1;
    deps.viewportEndLine.value = 1;
    deps.totalCharCount.value = 0;
    deps.totalLineCount.value = 0;
    deps.fileEncoding.value = "-";
    deps.currentFileSize.value = null;
    deps.stream.resetStreamInternals();
    deps.loading.value = true;
    deps.loadingProgressPercent.value = 0;

    deps.readerRef.value?.clear({ keepStickyHiddenForStream: true });
    deps.readerRef.value?.resetToTop();
  }

  function restoreFileListFromSession() {
    const fileList = loadTxtFileListSnapshot(window.localStorage, fileListKey);
    if (fileList.length === 0) return false;
    deps.txtFiles.value = fileList.map((f) =>
      normalizeTxtFileItem({
        ...f,
        name: String(f.name ?? ""),
        path: String(f.path ?? ""),
        size: typeof f.size === "number" ? f.size : 0,
      }),
    );
    persistFileListCache();
    return true;
  }

  async function tryRestoreSession() {
    if (!window.colorTxt) return;
    if (!deps.restoreSessionOnStartup.value) return;
    const session = loadSessionSnapshot(window.localStorage, sessionKey);
    if (!session) return;
    restoreFileListFromSession();

    const path = session.currentFile;
    const viewportTopLine = Math.max(1, Math.floor(session.viewportTopLine));
    const scrollLine = session.viewportBottomLine;

    if (!path) {
      deps.sidebarTab.value = "files";
      deps.lastProbeLine.value = scrollLine;
      return;
    }

    deps.sidebarTab.value = "chapters";

    try {
      const st = await window.colorTxt.stat(path);
      if (!st.isFile) {
        deps.sidebarTab.value = "files";
        return;
      }
      clearReaderBeforeResolve();
      const resolved = await resolvePhysicalTextForOpen(path);
      if (!resolved.ok) {
        deps.sidebarTab.value = "files";
        return;
      }
      const meta = getFileMeta(path);
      const savedVs = meta?.editorViewState;
      const anchorRaw = meta?.viewportTopPhysicalLine;
      const hasAnchor =
        typeof anchorRaw === "number" && Number.isFinite(anchorRaw);
      const canRestoreViewState =
        savedVs != null &&
        typeof savedVs === "object" &&
        !Array.isArray(savedVs) &&
        hasAnchor;
      if (isReadingCompleteProgress(meta?.progress)) {
        deps.pendingRestoreEditorViewState.value = null;
        deps.pendingRestoreViewportTopPhysicalLine.value = null;
        deps.pendingRestorePhysicalLine.value =
          RESTORE_PHYSICAL_LINE_SCROLL_TO_END;
      } else if (canRestoreViewState) {
        deps.pendingRestoreEditorViewState.value = savedVs;
        deps.pendingRestorePhysicalLine.value = null;
        deps.pendingRestoreViewportTopPhysicalLine.value = Math.max(
          1,
          Math.floor(anchorRaw),
        );
      } else {
        deps.pendingRestoreEditorViewState.value = null;
        deps.pendingRestoreViewportTopPhysicalLine.value = null;
        // 若上次视口首行就是物理第一行，说明可能只是打开过文件未开始阅读；
        // 此时不做恢复滚动，保留在顶部。
        deps.pendingRestorePhysicalLine.value =
          viewportTopLine === 1 ? null : Math.max(1, Math.floor(scrollLine));
      }
      resetSession(path);
      deps.physicalReaderPath.value = resolved.physicalPath;
      deps.currentFileSize.value = resolved.displaySize;
      scheduleDeferredFileListSizeSync(path, resolved.listSizeAtSessionPath);
      await waitNextPaintFrame();
      window.colorTxt.streamFile(resolved.physicalPath, {
        sessionFilePath: resolved.sessionFilePath,
      });
      const fileInList = deps.txtFiles.value.some((f) => f.path === path);
      if (fileInList) {
        void nextTick(() => {
          pulseFileListCenter();
        });
      }
    } catch {
      deps.sidebarTab.value = "files";
    }
  }

  async function openFileViaDialog() {
    if (!window.colorTxt) {
      await appAlert("preload 未注入：请重启应用（或检查主进程 preload 路径）");
      return;
    }
    const r = await window.colorTxt.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "电子书",
          extensions: [...COLOR_TXT_OPEN_BOOK_EXTENSIONS],
        },
      ],
    });
    const filePath =
      r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    if (!filePath) return;
    await openFilePath(filePath);
  }

  function openFileFromSidebar(item: TxtFileItem) {
    suppressFileListCenterAfterLoad.value = true;
    void openFilePath(item.path, { keepSidebarTab: true, listRow: item });
  }

  function subscribeDirListTxtScan(): () => void {
    return window.colorTxt.onDirListTxtScan((p) => {
      if (p.phase === "start") {
        deps.dirListScanning.value = true;
        deps.dirListCurrentName.value = "";
      } else {
        deps.dirListCurrentName.value = p.name;
      }
    });
  }

  async function pickTxtDirectory() {
    if (!window.colorTxt) {
      await appAlert("目录选择接口未加载，请重启应用");
      return;
    }
    const unsub = subscribeDirListTxtScan();
    try {
      const result = await readTxtDirectoryFromDialog(window.colorTxt);
      if (!result.ok && result.reason === "missingApi") {
        await appAlert("目录选择接口未加载，请重启应用");
        return;
      }
      if (!result.ok) return;
      const knownPaths = new Set(deps.txtFiles.value.map((f) => f.path));
      const newPaths = result.files
        .map((f) => f.path)
        .filter((path) => !knownPaths.has(path));
      deps.txtFiles.value = mergeTxtFileLists(
        deps.txtFiles.value,
        result.files,
      );
      deps.applyCurrentFileCategoryIfConcrete?.(newPaths);
      persistFileListCache();
      deps.sidebarTab.value = "files";
      centerFileListIfCurrentInList();
      if (
        !deps.currentFile.value ||
        !deps.txtFiles.value.some((f) => f.path === deps.currentFile.value)
      ) {
        scrollFileListsToIndex(0);
      }
    } finally {
      unsub();
      deps.dirListScanning.value = false;
      deps.dirListCurrentName.value = "";
    }
  }

  /** 拖放 / 文件列表导入：按路径顺序合并目录内 txt/电子书 或单个支持的文件 */
  async function importPathsIntoFileList(paths: string[]) {
    if (!window.colorTxt || paths.length === 0) return;
    const unsub = subscribeDirListTxtScan();
    try {
      const knownPaths = new Set(deps.txtFiles.value.map((f) => f.path));
      let merged = deps.txtFiles.value;
      const newPaths: string[] = [];
      for (const p of paths) {
        try {
          const st = await window.colorTxt.stat(p);
          if (st.isDirectory) {
            const dirResult = await window.colorTxt.listTxtFilesInDirectory(p);
            const items = dirResult.files.map(normalizeTxtFileItem);
            for (const it of items) {
              if (!knownPaths.has(it.path)) {
                knownPaths.add(it.path);
                newPaths.push(it.path);
              }
            }
            merged = mergeTxtFileLists(merged, items);
          } else if (st.isFile && isSupportedBookPath(p)) {
            const item = normalizeTxtFileItem({
              name: basenameFromPath(p),
              path: p,
              size: st.size,
            });
            if (!knownPaths.has(item.path)) {
              knownPaths.add(item.path);
              newPaths.push(item.path);
            }
            merged = mergeTxtFileLists(merged, [item]);
          }
        } catch {
          /* 单路径失败则跳过 */
        }
      }
      deps.txtFiles.value = merged;
      deps.applyCurrentFileCategoryIfConcrete?.(newPaths);
      persistFileListCache();
      deps.sidebarTab.value = "files";
      centerFileListIfCurrentInList();
      if (
        !deps.currentFile.value ||
        !deps.txtFiles.value.some((f) => f.path === deps.currentFile.value)
      ) {
        scrollFileListsToIndex(0);
      }
    } finally {
      unsub();
      deps.dirListScanning.value = false;
      deps.dirListCurrentName.value = "";
    }
  }

  function scrollFileListsToIndex(index: number) {
    if (deps.txtFiles.value.length === 0 || index < 0) return;
    const idx = Math.min(index, deps.txtFiles.value.length - 1);
    void nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void deps.readerSidebarRef.value?.scrollFileListToIndex(idx);
        });
      });
    });
  }

  async function openFilePath(
    filePath: string,
    options?: {
      restoreLine?: number;
      restorePhysicalLine?: number;
      skipRememberCurrent?: boolean;
      keepSidebarTab?: boolean;
      /** 侧栏列表点击时传入当前行 */
      listRow?: TxtFileItem;
      /** 为 true 时跳过「未保存编辑」确认（如编辑切回只读后的同一文件重载） */
      skipReaderEditGuard?: boolean;
      /** 流结束后按视口第二行高锚点恢复（优先于 restorePhysicalLine） */
      restoreViewportAnchor?: import("../reader/readerViewportAnchor").ReaderViewportRestoreAnchor;
      /** 电子书：忽略缓存，强制重新转换后再打开 */
      forceEbookConvert?: boolean;
    },
  ) {
    if (!options?.keepSidebarTab) {
      suppressFileListCenterAfterLoad.value = false;
    }

    if (!options?.skipReaderEditGuard && deps.confirmIfReaderEditDiscard) {
      if (!(await deps.confirmIfReaderEditDiscard())) {
        suppressFileListCenterAfterLoad.value = false;
        return false;
      }
    }

    if (!options?.skipRememberCurrent) {
      rememberCurrentFileLine();
    }

    const normalizedExplicitRestore =
      options?.restoreLine != null
        ? Math.max(1, Math.floor(options.restoreLine))
        : undefined;

    const prepared = await prepareOpenFile({
      filePath,
      txtFiles: deps.txtFiles.value,
      statFile: (path) => window.colorTxt.stat(path),
      listRow: options?.listRow,
    });
    if (!prepared.ok) {
      const tip = prepared.message;
      await appAlert(tip);
      removeRecentFile(filePath);
      suppressFileListCenterAfterLoad.value = false;
      return false;
    }

    const resolved = await resolvePhysicalTextForOpen(filePath, {
      forceEbookConvert: options?.forceEbookConvert,
    });
    if (!resolved.ok) {
      await appAlert(resolved.message);
      removeRecentFile(filePath);
      suppressFileListCenterAfterLoad.value = false;
      return false;
    }

    const meta = getFileMeta(filePath);
    const savedVs = meta?.editorViewState;
    const anchorRaw = meta?.viewportTopPhysicalLine;
    const hasAnchor =
      typeof anchorRaw === "number" && Number.isFinite(anchorRaw);
    const canRestoreViewState =
      savedVs != null &&
      typeof savedVs === "object" &&
      !Array.isArray(savedVs) &&
      hasAnchor;

    if (options?.restoreViewportAnchor != null) {
      deps.pendingRestoreEditorViewState.value = null;
      deps.pendingRestoreViewportTopPhysicalLine.value = null;
      deps.pendingRestorePhysicalLine.value = null;
      deps.pendingRestoreViewportAnchor.value = options.restoreViewportAnchor;
    } else if (
      options?.restorePhysicalLine != null ||
      normalizedExplicitRestore != null
    ) {
      deps.pendingRestoreEditorViewState.value = null;
      deps.pendingRestoreViewportTopPhysicalLine.value = null;
      deps.pendingRestoreViewportAnchor.value = null;
      deps.pendingRestorePhysicalLine.value =
        options?.restorePhysicalLine != null
          ? Math.max(1, Math.floor(options.restorePhysicalLine))
          : normalizedExplicitRestore!;
    } else if (isReadingCompleteProgress(meta?.progress)) {
      deps.pendingRestoreEditorViewState.value = null;
      deps.pendingRestoreViewportTopPhysicalLine.value = null;
      deps.pendingRestoreViewportAnchor.value = null;
      deps.pendingRestorePhysicalLine.value =
        RESTORE_PHYSICAL_LINE_SCROLL_TO_END;
    } else if (canRestoreViewState) {
      deps.pendingRestoreEditorViewState.value = savedVs;
      deps.pendingRestorePhysicalLine.value = null;
      deps.pendingRestoreViewportAnchor.value = null;
      deps.pendingRestoreViewportTopPhysicalLine.value = Math.max(
        1,
        Math.floor(anchorRaw),
      );
    } else {
      deps.pendingRestoreEditorViewState.value = null;
      deps.pendingRestoreViewportTopPhysicalLine.value = null;
      deps.pendingRestorePhysicalLine.value = null;
      deps.pendingRestoreViewportAnchor.value = null;
    }

    deps.readerEditMode.value = false;
    deps.readerEditorDirty.value = false;

    resetSession(filePath);
    deps.physicalReaderPath.value = resolved.physicalPath;
    deps.currentFileSize.value = resolved.displaySize;
    scheduleDeferredFileListSizeSync(filePath, resolved.listSizeAtSessionPath);
    if (!options?.keepSidebarTab) {
      deps.sidebarTab.value = "chapters";
    }
    touchRecentFile(filePath, true, { persistRecent: true, updateMeta: false });
    await waitNextPaintFrame();
    window.colorTxt.streamFile(resolved.physicalPath, {
      sessionFilePath: resolved.sessionFilePath,
    });

    const fileInList = deps.txtFiles.value.some((f) => f.path === filePath);
    if (fileInList && !suppressFileListCenterAfterLoad.value) {
      void nextTick(() => {
        pulseFileListCenter();
      });
    }
    suppressFileListCenterAfterLoad.value = false;

    return true;
  }

  function openRecentFileFromHistory(filePath: string) {
    return openFilePath(filePath);
  }

  return {
    restoreFileListFromSession,
    centerFileListIfCurrentInList,
    clearFileList,
    clearFileListForCategory,
    removeFileList,
    closeCurrentFile,
    rememberCurrentFileLine,
    tryRestoreSession,
    resetSession,
    openFileViaDialog,
    openFileFromSidebar,
    subscribeDirListTxtScan,
    pickTxtDirectory,
    importPathsIntoFileList,
    scrollFileListsToIndex,
    openFilePath,
    openRecentFileFromHistory,
  };
}
