<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
  type ComponentPublicInstance,
} from "vue";
import AppCustomSelect from "./AppCustomSelect.vue";
import CategoryPickerMenu from "./CategoryPickerMenu.vue";
import FileCategoryFlyoutList from "./FileCategoryFlyoutList.vue";
import FileCategoryManageModal from "./FileCategoryManageModal.vue";
import VirtualList from "./VirtualList.vue";
import {
  READER_SIDEBAR_ROW_STRIDE,
  type SidebarFileItem,
} from "../composables/useReaderSidebarLists";
import { useFileListCategorySort } from "../composables/useFileListCategorySort";
import { useFileListMenus } from "../composables/useFileListMenus";
import { useFileListSelection } from "../composables/useFileListSelection";
import type { FileCategoryDefinition } from "../constants/fileCategories";
import type { FileListViewMode } from "../constants/fileCategories";
import type { FileSortMode } from "../constants/fileCategories";
import {
  FILE_CATEGORY_FILTER_ALL,
  normalizeCategoryFilter,
} from "../constants/fileCategories";
import type { CategoryEditorRow } from "../constants/fileCategories";
import {
  borderColorForFile,
  fileItemShowCategoryMark,
  fileRowProgressForPath,
  formatFileReadProgress,
  formatFileSize,
  isProgressComplete,
} from "../utils/fileListPanelDisplay";
import {
  buildFilePathTree,
  collectAncestorFolderKeysForFile,
  collectFilesUnderDir,
  collectFolderKeys,
  findFileRowIndex,
  flattenVisibleFileTreeRows,
  rootFolderKeys,
  type FileListTreeFlatRow,
  type FileListTreeNode,
} from "../utils/fileListTree";
import { isPlainTextBookPath } from "../ebook/ebookFormat";
import { icons } from "../icons";
import { fileListEmptyHint, fileListDropHint, fileListNoMatchHint } from "../constants/appUi";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";
import AppShellMenuTeleport from "./AppShellMenuTeleport.vue";
import { appToast } from "../services/appToast";
import { appLoading } from "../services/appLoading";
import { appConfirm } from "../services/appDialog";
import { fileHistoryKey } from "../stores/recentHistoryStore";

const FILES_HEADER_MORE_MENU_W = 140;
const TREE_INDENT_PX = 14;

const props = withDefaults(
  defineProps<{
    files: SidebarFileItem[];
    filesFiltered: SidebarFileItem[];
    currentFilePath: string | null;
    fileFilterQuery: string;
    metaProgressMap?: Map<string, number>;
    liveReadingProgressPercent?: number;
    fileCategory: string;
    fileSort: FileSortMode;
    fileListViewMode?: FileListViewMode;
    fileCategoryCatalog: FileCategoryDefinition[];
    /** 全屏/极简浮动侧栏是否展开；从展开变为收起时关闭 Teleport 菜单/下拉（不含 AppModal） */
    showFullscreenSidebar?: boolean;
    /** 侧栏标题行「更多」按钮（锚定菜单） */
    menuAnchorEl?: HTMLButtonElement | null;
    /** App 脉冲：将当前文件滚入视口并居中（树模式下由本面板处理） */
    shouldCenterFileList?: boolean;
    /** 侧栏当前是否显示本面板（隐藏时不主动滚动定位） */
    panelVisible?: boolean;
  }>(),
  {
    metaProgressMap: () => new Map<string, number>(),
    liveReadingProgressPercent: undefined,
    fileListViewMode: "list",
    menuAnchorEl: null,
    shouldCenterFileList: false,
    panelVisible: true,
  },
);

const emit = defineEmits<{
  /** 全屏侧栏：文件列表 Teleport 弹层是否打开（供收起侧栏逻辑） */
  "update:fullscreenFileListPopoversOpen": [open: boolean];
  updateFileFilterQuery: [value: string];
  "update:fileCategory": [value: string];
  "update:fileSort": [value: FileSortMode];
  persistUi: [];
  applyCategoryCatalog: [
    payload: {
      initial: CategoryEditorRow[];
      draft: CategoryEditorRow[];
      catalog: FileCategoryDefinition[];
    },
  ];
  setFilesCategory: [paths: string[], category: string];
  renameFilePath: [payload: { oldPath: string; newName: string }];
  replaceFilePath: [oldPath: string];
  "open-file-in-new-window": [path: string];
  "clear-file-meta": [path: string];
  openFile: [item: SidebarFileItem];
  importDroppedPaths: [paths: string[]];
  /** 侧栏「更多」→ 选择文件（加入列表，不打开） */
  pickFiles: [];
  clearFileList: [];
  clearFileListCategory: [categoryFilter: string];
  removeFileList: [filePaths: string[]];
  bindListRef: [value: InstanceType<typeof VirtualList> | null];
  "update:fileListEditing": [editing: boolean];
}>();

function baseNameFromPath(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

function fileNameSelectionRange(fileName: string): { start: number; end: number } {
  const dot = fileName.lastIndexOf(".");
  if (dot > 0) return { start: 0, end: dot };
  return { start: 0, end: fileName.length };
}

function fileRowProgress(filePath: string): number | undefined {
  return fileRowProgressForPath(
    props.currentFilePath,
    props.liveReadingProgressPercent,
    props.metaProgressMap,
    filePath,
  );
}

function borderColorForFileRow(f: SidebarFileItem): string {
  return borderColorForFile(f, props.fileCategoryCatalog);
}

function fileItemShowCategoryMarkRow(f: SidebarFileItem): boolean {
  return fileItemShowCategoryMark(f, props.fileCategory);
}

const moreBtnRef = ref<HTMLButtonElement | null>(null);
const moreAnchorRef = ref<HTMLButtonElement | null>(null);
watch(
  () => props.menuAnchorEl ?? moreBtnRef.value,
  (el) => {
    moreAnchorRef.value = el;
  },
  { immediate: true },
);
const moreMenu = useAnchoredAppShellMenu({
  anchor: moreAnchorRef,
  placement: "below-end",
  widthPx: FILES_HEADER_MORE_MENU_W,
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

const removingMissingFiles = ref(false);

async function onRemoveMissingFiles() {
  closeMoreMenu();
  if (!window.colorTxt || removingMissingFiles.value) return;
  const paths = props.files.map((f) => f.path);
  if (paths.length === 0) {
    appToast("没有可移除的文件", { kind: "info" });
    return;
  }
  removingMissingFiles.value = true;
  try {
    await appLoading.with("检查中", async () => {
      const missing: string[] = [];
      for (const p of paths) {
        try {
          // file:stat 对 ENOENT 返回 isFile/isDirectory 均为 false，不抛错
          const st = await window.colorTxt.stat(p);
          if (!st.isFile) missing.push(p);
        } catch {
          missing.push(p);
        }
      }
      if (missing.length === 0) {
        appToast("没有失效文件", { kind: "info" });
        return;
      }
      emit("removeFileList", missing);
      appToast(`已移除 ${missing.length} 个失效文件`, { kind: "success" });
    });
  } finally {
    removingMissingFiles.value = false;
  }
}

function onPickFiles() {
  closeMoreMenu();
  emit("pickFiles");
}

defineExpose({
  openMoreMenu: toggleMoreMenu,
  moreOpen,
});

const listRef = ref<InstanceType<typeof VirtualList> | null>(null);

function onBindListRef(value: Element | ComponentPublicInstance | null) {
  if (value && typeof value === "object" && "$el" in value) {
    listRef.value = value as InstanceType<typeof VirtualList>;
    emit("bindListRef", value as InstanceType<typeof VirtualList>);
    return;
  }
  listRef.value = null;
  emit("bindListRef", null);
}

const isTreeMode = computed(() => props.fileListViewMode === "tree");

/** path → 列表项，避免树行渲染时对 filesFiltered 线性 find */
const fileByPath = computed(() => {
  const m = new Map<string, SidebarFileItem>();
  for (const f of props.files) m.set(f.path, f as SidebarFileItem);
  for (const f of props.filesFiltered) m.set(f.path, f);
  return m;
});

/**
 * 树结构指纹：仅 path/size/name/排序，不含 category。
 * 改分类时 filesFiltered 会换新数组，但指纹不变 → 不重建树、不重置展开。
 */
const fileTreeStructureKey = computed(() => {
  if (!isTreeMode.value) return "";
  const parts = props.filesFiltered.map(
    (f) => `${f.path}\0${f.size}\0${f.name}`,
  );
  return `${props.fileSort}\n${parts.join("\n")}`;
});

const fileTreeRoots = shallowRef<FileListTreeNode[]>([]);

watch(
  fileTreeStructureKey,
  (key) => {
    if (!key) {
      fileTreeRoots.value = [];
      return;
    }
    fileTreeRoots.value = buildFilePathTree(
      props.filesFiltered,
      props.fileSort,
    );
  },
  { immediate: true },
);

/** 展开的目录 fullDirPath（初始化/切换分类：仅当前文件路径上的目录，或全收起） */
const expandedFolderPaths = ref<Set<string>>(new Set());

function folderExpandSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) {
    if (!b.has(k)) return false;
  }
  return true;
}

function listPathForCurrentFile(): string {
  const path = props.currentFilePath?.trim() ?? "";
  if (!path) return "";
  if (props.filesFiltered.some((f) => f.path === path)) return path;
  const key = fileHistoryKey(path);
  return (
    props.filesFiltered.find((f) => fileHistoryKey(f.path) === key)?.path ?? ""
  );
}

/**
 * 初始化 / 列表重建（含切换分类）：
 * - 当前打开文件在筛选列表中 → 只展开其祖先目录
 * - 否则 → 全部收起
 * @returns 是否应滚到当前文件
 */
function applyExpandForCurrentFileOnTreeRebuild(
  roots: readonly FileListTreeNode[],
): boolean {
  const path = listPathForCurrentFile();
  const inList = !!path;
  if (!inList) {
    if (expandedFolderPaths.value.size > 0) {
      expandedFolderPaths.value = new Set();
    }
    return false;
  }
  const ancestors = collectAncestorFolderKeysForFile(roots, path);
  if (!ancestors) {
    if (expandedFolderPaths.value.size > 0) {
      expandedFolderPaths.value = new Set();
    }
    return false;
  }
  const next = new Set(ancestors);
  if (!folderExpandSetsEqual(next, expandedFolderPaths.value)) {
    expandedFolderPaths.value = next;
  }
  return true;
}

async function scrollTreeToCurrentFileRow(
  mode: "edge" | "center" = "center",
  behavior: ScrollBehavior = "auto",
) {
  await nextTick();
  if (!isTreeMode.value || !props.panelVisible) return;
  const path = listPathForCurrentFile();
  if (!path) return;
  const idx = findFileRowIndex(treeFlatRows.value, path);
  if (idx < 0) return;
  const vl = listRef.value;
  if (!vl) return;
  vl.scrollToIndex(idx, {
    align: mode === "center" ? "center" : "auto",
    behavior,
  });
}

watch(
  fileTreeRoots,
  (roots) => {
    if (roots.length === 0) {
      if (expandedFolderPaths.value.size > 0) {
        expandedFolderPaths.value = new Set();
      }
      return;
    }
    const shouldScroll = applyExpandForCurrentFileOnTreeRebuild(roots);
    if (shouldScroll && props.panelVisible) {
      void scrollTreeToCurrentFileRow("center");
    }
  },
  { immediate: true },
);

const treeFlatRows = computed((): FileListTreeFlatRow[] => {
  if (!isTreeMode.value) return [];
  return flattenVisibleFileTreeRows(
    fileTreeRoots.value,
    expandedFolderPaths.value,
  );
});

const displayItemCount = computed(() =>
  isTreeMode.value ? treeFlatRows.value.length : props.filesFiltered.length,
);

const treeItemKeyFn = (i: number): string | number => treeRowKey(i);
const listItemKeyFn = (i: number): string | number =>
  props.filesFiltered[i]?.path ?? i;

function treeRowKey(index: number): string {
  const row = treeFlatRows.value[index];
  if (!row) return `i:${index}`;
  if (row.kind === "folder") return `d:${row.fullDirPath}`;
  return `f:${row.file.path}`;
}

function toggleFolderExpanded(fullDirPath: string) {
  const next = new Set(expandedFolderPaths.value);
  if (next.has(fullDirPath)) next.delete(fullDirPath);
  else next.add(fullDirPath);
  expandedFolderPaths.value = next;
}

function onTreeFolderClick(fullDirPath: string) {
  toggleFolderExpanded(fullDirPath);
}

const treeRootFolderKeys = computed(() => rootFolderKeys(fileTreeRoots.value));

/** 所有根文件夹均折叠 → 显示「全部展开」；否则「全部折叠」 */
const allRootFoldersCollapsed = computed(() => {
  const roots = treeRootFolderKeys.value;
  if (roots.length === 0) return true;
  return roots.every((k) => !expandedFolderPaths.value.has(k));
});

function onToggleExpandAllFolders() {
  if (allRootFoldersCollapsed.value) {
    expandedFolderPaths.value = collectFolderKeys(fileTreeRoots.value);
  } else {
    expandedFolderPaths.value = new Set();
  }
}

function fileItemFromPath(path: string): SidebarFileItem | undefined {
  return fileByPath.value.get(path);
}

/** 打开/居中当前文件时：展开其路径（可保留其它已展开目录）；面板可见时再滚入视口 */
async function scrollTreeToCurrentFile(
  mode: "edge" | "center" = "center",
  behavior: ScrollBehavior = "auto",
) {
  await nextTick();
  if (!isTreeMode.value) return;
  const path = listPathForCurrentFile();
  if (!path) return;
  const roots = fileTreeRoots.value;
  if (roots.length === 0) return;
  const ancestors = collectAncestorFolderKeysForFile(roots, path);
  if (!ancestors) return;
  const next = new Set(expandedFolderPaths.value);
  for (const a of ancestors) next.add(a);
  if (!folderExpandSetsEqual(next, expandedFolderPaths.value)) {
    expandedFolderPaths.value = next;
  }
  if (!props.panelVisible) return;
  await scrollTreeToCurrentFileRow(mode, behavior);
}

async function scrollListToCurrentFile(
  mode: "edge" | "center" = "center",
  behavior: ScrollBehavior = "auto",
) {
  await nextTick();
  if (isTreeMode.value || !props.panelVisible) return;
  const path = props.currentFilePath;
  if (!path) return;
  const idx = props.filesFiltered.findIndex((f) => f.path === path);
  if (idx < 0) return;
  const vl = listRef.value;
  if (!vl) return;
  vl.scrollToIndex(idx, {
    align: mode === "center" ? "center" : "auto",
    behavior,
  });
}

watch(
  () => props.shouldCenterFileList,
  (v) => {
    if (!v || !isTreeMode.value) return;
    void scrollTreeToCurrentFile("center");
  },
);

/**
 * 会话恢复时先建树（尚无当前文件 → 全收起），再打开文件并切到「章节」。
 * 当前文件就绪后补展开祖先；切到「文件」面板时再滚入视口。
 */
watch(
  () => [isTreeMode.value, props.currentFilePath] as const,
  () => {
    if (!isTreeMode.value) return;
    if (!listPathForCurrentFile()) return;
    void scrollTreeToCurrentFile("center");
  },
);

watch(
  () => props.panelVisible,
  (visible) => {
    if (!visible || !isTreeMode.value) return;
    if (!listPathForCurrentFile()) return;
    void scrollTreeToCurrentFile("center");
  },
);

watch(isTreeMode, (tree) => {
  if (!props.currentFilePath || !props.panelVisible) return;
  if (tree) {
    void scrollTreeToCurrentFile("center");
    return;
  }
  // 树 → 列表：VirtualList 换键后需等一帧再定位
  void nextTick(() => {
    requestAnimationFrame(() => {
      void scrollListToCurrentFile("center");
    });
  });
});

const canLocateCurrentFile = computed(() => !!listPathForCurrentFile());

function onLocateCurrentFile() {
  if (!canLocateCurrentFile.value) return;
  if (isTreeMode.value) {
    void scrollTreeToCurrentFile("center", "smooth");
    return;
  }
  void scrollListToCurrentFile("center", "smooth");
}

const filterVisible = ref(false);
const fileFilterInputRef = ref<HTMLInputElement | null>(null);

watch(filterVisible, async (visible) => {
  if (visible) {
    await nextTick();
    fileFilterInputRef.value?.focus({ preventScroll: true });
    return;
  }
  emit("updateFileFilterQuery", "");
});

const {
  manageModalOpen,
  categoryMenuCounts,
  categoryFixedTop,
  categoryScrollItems,
  categoryFixedBottom,
  categoryTriggerLabel,
  categoryTriggerSuffix,
  categoryTriggerMarkColor,
  sortScrollItems,
  sortDisplayLabel,
  sortTriggerPrefixHtml,
  onCategorySelect,
  onCategoryAction,
  onSortSelect,
} = useFileListCategorySort(props, emit);

const isFileCategoryFilterAll = computed(
  () => normalizeCategoryFilter(props.fileCategory) === FILE_CATEGORY_FILTER_ALL,
);

const clearFileListFooterDisabled = computed(() => {
  if (props.fileFilterQuery.trim()) return true;
  if (!isFileCategoryFilterAll.value && props.filesFiltered.length === 0) {
    return true;
  }
  return false;
});

function onClearFileListFooterClick() {
  if (isFileCategoryFilterAll.value) {
    emit("clearFileList");
    return;
  }
  emit("clearFileListCategory", props.fileCategory);
}

const listFocusEl = useTemplateRef<HTMLElement>("listFocusEl");
const footerCategoryBtnRef = useTemplateRef<HTMLButtonElement>(
  "footerCategoryBtnRef",
);

const selection = useFileListSelection(props, emit, {
  listFocusEl,
  footerCategoryBtnRef,
});

const {
  isEditingFileList,
  selectedFilePaths,
  lastSelectedFilePath,
  onFileItemClick,
  onListKeydown,
  enterEditFileListMode,
  onRemoveSelectedFileListItems,
} = selection;

function onTreeFileClick(path: string, index: number, e: MouseEvent) {
  const item = fileItemFromPath(path);
  if (!item) return;
  const visibleFilePaths = treeFlatRows.value
    .filter((r): r is Extract<FileListTreeFlatRow, { kind: "file" }> => r.kind === "file")
    .map((r) => r.file.path);
  onFileItemClick(item, index, e, visibleFilePaths);
}

function resolveTreeFileItem(row: Extract<FileListTreeFlatRow, { kind: "file" }>): SidebarFileItem {
  return fileByPath.value.get(row.file.path) ?? (row.file as SidebarFileItem);
}

const renamingFilePath = ref<string | null>(null);
const renameDraft = ref("");
const renameInputEl = ref<HTMLInputElement | null>(null);
const renameCommitting = ref(false);

/** VirtualList 的 v-for 会把同名模板 ref 收成数组，须用函数 ref 拿到真正的 input */
function setRenameInputEl(el: unknown) {
  renameInputEl.value = el instanceof HTMLInputElement ? el : null;
}

function startRenamingFile(path: string) {
  const row = props.files.find((f) => f.path === path);
  const fileName = row?.name || baseNameFromPath(path);
  renamingFilePath.value = path;
  renameDraft.value = fileName;
}

async function cancelRenamingFile() {
  renamingFilePath.value = null;
  renameDraft.value = "";
  renameCommitting.value = false;
  await nextTick();
  listFocusEl.value?.focus({ preventScroll: true });
}

function commitRenamingFile() {
  const oldPath = renamingFilePath.value;
  if (!oldPath || renameCommitting.value) return;
  renameCommitting.value = true;
  const newName = renameDraft.value.trim();
  const oldName = baseNameFromPath(oldPath);
  if (!newName || newName === oldName) {
    cancelRenamingFile();
    return;
  }
  emit("renameFilePath", { oldPath, newName });
  cancelRenamingFile();
}

function shouldIgnoreGlobalRenameHotkey(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

function onFileListRootKeydown(ev: KeyboardEvent) {
  onListKeydown(ev);
  if (ev.key !== "F2") return;
  if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
  if (renamingFilePath.value) return;
  if (shouldIgnoreGlobalRenameHotkey()) return;
  let renameTargetPath: string | null = null;
  if (isEditingFileList.value) {
    const lastSelected = lastSelectedFilePath.value;
    if (lastSelected && props.files.some((f) => f.path === lastSelected)) {
      renameTargetPath = lastSelected;
    } else if (selectedFilePaths.value.length > 0) {
      const fallback = selectedFilePaths.value[selectedFilePaths.value.length - 1]!;
      if (props.files.some((f) => f.path === fallback)) {
        renameTargetPath = fallback;
      }
    }
  } else if (
    props.currentFilePath &&
    props.files.some((f) => f.path === props.currentFilePath)
  ) {
    renameTargetPath = props.currentFilePath;
  }
  if (!renameTargetPath) return;
  // v-show 隐藏（display:none）时避免误触；仅文件面板可见时响应。
  if (!listFocusEl.value || listFocusEl.value.offsetParent === null) return;
  ev.preventDefault();
  startRenamingFile(renameTargetPath);
}

watch(renamingFilePath, async (path) => {
  if (!path) return;
  await nextTick();
  const input = renameInputEl.value;
  if (!input) return;
  input.focus({ preventScroll: true });
  const range = fileNameSelectionRange(input.value);
  input.setSelectionRange(range.start, range.end);
});

watch(
  isEditingFileList,
  (v) => emit("update:fileListEditing", v),
  { immediate: true },
);

const menus = reactive(
  useFileListMenus(emit, {
    isEditingFileList: selection.isEditingFileList,
    selectedFilePaths: selection.selectedFilePaths,
    lastSelectedFilePath: selection.lastSelectedFilePath,
    footerCategoryBtnRef: selection.footerCategoryBtnRef,
    clearEditSelectionState: selection.clearEditSelectionState,
    onRemoveSelectedFileListItems: selection.onRemoveSelectedFileListItems,
    selectAllVisible: selection.selectAllVisible,
    invertSelectionVisible: selection.invertSelectionVisible,
    selectSinglePathForContextMenu: selection.selectSinglePathForContextMenu,
  }),
);

const fileCtxMenuPanelRef = useTemplateRef<HTMLElement>("fileCtxMenuPanelRef");
const fileCtxCategoryFlyoutRef = useTemplateRef<HTMLElement>(
  "fileCtxCategoryFlyoutRef",
);
const fileCtxMenuLeft = ref(0);
const fileCtxMenuTop = ref(0);
const fileCtxCategorySubOpen = ref(false);
/** 子菜单在右侧放不下时改为向左展开（appShellMenuFlyout--left） */
const fileCtxFlyoutUseLeft = ref(false);
/** 子菜单在视口内做最后平移修正（翻转后仍可能上下溢出） */
const fileCtxFlyoutTransform = ref("");
/** 子菜单完成左右翻转与 translate 夹紧后再显示，避免首帧错位闪烁 */
const fileCtxFlyoutPositionReady = ref(false);

const fileCtxFlyoutPanelStyle = computed(() => {
  const s: Record<string, string> = {};
  if (fileCtxFlyoutTransform.value) {
    s.transform = fileCtxFlyoutTransform.value;
  }
  if (fileCtxCategorySubOpen.value) {
    s.visibility = fileCtxFlyoutPositionReady.value ? "visible" : "hidden";
    s.pointerEvents = fileCtxFlyoutPositionReady.value ? "auto" : "none";
  }
  return s;
});

function closeFileCtxCategorySub() {
  fileCtxCategorySubOpen.value = false;
  fileCtxFlyoutUseLeft.value = false;
  fileCtxFlyoutTransform.value = "";
  fileCtxFlyoutPositionReady.value = false;
}

function clampFileContextMenuToViewport() {
  if (!menus.fileContextMenuOpen) return;
  const el = fileCtxMenuPanelRef.value;
  if (!el) return;
  const margin = 8;
  const rawX = menus.fileContextMenuX;
  const rawY = menus.fileContextMenuY;
  const maxX = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
  fileCtxMenuLeft.value = Math.min(Math.max(margin, rawX), maxX);
  fileCtxMenuTop.value = Math.min(Math.max(margin, rawY), maxY);
}

function applyFileCtxCategoryFlyoutTranslateClamp() {
  const flyout = fileCtxCategoryFlyoutRef.value;
  if (!flyout || !fileCtxCategorySubOpen.value) return;
  const margin = 8;
  const r = flyout.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (r.bottom > window.innerHeight - margin) {
    dy = window.innerHeight - margin - r.bottom;
  }
  if (r.top + dy < margin) {
    dy = margin - r.top;
  }
  if (r.right + dx > window.innerWidth - margin) {
    dx = window.innerWidth - margin - r.right;
  }
  if (r.left + dx < margin) {
    dx = margin - r.left;
  }
  fileCtxFlyoutTransform.value =
    dx !== 0 || dy !== 0 ? `translate(${dx}px, ${dy}px)` : "";
}

async function layoutFileCtxCategoryFlyoutInViewport(opts?: { instant?: boolean }) {
  if (!menus.fileContextMenuOpen || !fileCtxCategorySubOpen.value) {
    closeFileCtxCategorySub();
    return;
  }
  if (!opts?.instant) {
    fileCtxFlyoutPositionReady.value = false;
  }
  fileCtxFlyoutUseLeft.value = false;
  fileCtxFlyoutTransform.value = "";
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const flyout = fileCtxCategoryFlyoutRef.value;
  if (!flyout || !fileCtxCategorySubOpen.value) {
    fileCtxFlyoutPositionReady.value = true;
    return;
  }
  const margin = 8;
  const r = flyout.getBoundingClientRect();
  if (r.right > window.innerWidth - margin) {
    fileCtxFlyoutUseLeft.value = true;
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  applyFileCtxCategoryFlyoutTranslateClamp();
  fileCtxFlyoutPositionReady.value = true;
}

async function layoutFileContextMenuPanel() {
  if (!menus.fileContextMenuOpen) return;
  fileCtxMenuLeft.value = menus.fileContextMenuX;
  fileCtxMenuTop.value = menus.fileContextMenuY;
  if (!fileCtxCategorySubOpen.value) {
    closeFileCtxCategorySub();
  }
  await nextTick();
  requestAnimationFrame(() => {
    clampFileContextMenuToViewport();
    if (fileCtxCategorySubOpen.value) {
      void layoutFileCtxCategoryFlyoutInViewport();
    }
  });
}

watch(
  () =>
    [
      menus.fileContextMenuOpen,
      menus.fileContextMenuX,
      menus.fileContextMenuY,
      fileCtxCategorySubOpen.value,
    ] as const,
  async ([open]) => {
    if (!open) {
      closeFileCtxCategorySub();
      return;
    }
    await layoutFileContextMenuPanel();
  },
);

function onWindowResizeForFileCtxMenu() {
  if (!menus.fileContextMenuOpen) return;
  clampFileContextMenuToViewport();
  if (fileCtxCategorySubOpen.value) {
    void layoutFileCtxCategoryFlyoutInViewport({ instant: true });
  }
}

onMounted(() => {
  window.addEventListener("resize", onWindowResizeForFileCtxMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", onWindowResizeForFileCtxMenu);
});

function fileCtxTargetPath(): string | null {
  return menus.fileContextMenuFilePath;
}

function closeFileContextMenuAll() {
  menus.closeFileContextMenu();
  closeFileCtxCategorySub();
}

function onFileItemContextMenu(path: string, ev: MouseEvent) {
  closeFolderContextMenuAll();
  menus.onFileItemContextMenu(path, ev);
}

function onFileCtxRename() {
  const target = fileCtxTargetPath();
  if (!target) return;
  startRenamingFile(target);
  closeFileContextMenuAll();
}

function onFileCtxReplace() {
  const target = fileCtxTargetPath();
  if (!target || !isPlainTextBookPath(target)) return;
  emit("replaceFilePath", target);
  closeFileContextMenuAll();
}

function onFileCtxRemove() {
  const target = fileCtxTargetPath();
  if (!target) return;
  emit("removeFileList", [target]);
  closeFileContextMenuAll();
}

function onFileCtxClearFileMeta() {
  const target = fileCtxTargetPath();
  if (!target) return;
  emit("clear-file-meta", target);
  closeFileContextMenuAll();
}

function onFileCtxReveal() {
  const target = fileCtxTargetPath();
  if (!target) return;
  void window.colorTxt.showItemInFolder(target).catch(() => {});
  closeFileContextMenuAll();
}

function onFileCtxOpenInNewWindow() {
  const target = fileCtxTargetPath();
  if (!target) return;
  emit("open-file-in-new-window", target);
  closeFileContextMenuAll();
}

function onFileCtxCategoryPicked(name: string) {
  const target = fileCtxTargetPath();
  if (!target) return;
  emit("setFilesCategory", [target], name);
  closeFileContextMenuAll();
}

/** 树状：文件夹右键 */
const folderCtxOpen = ref(false);
const folderCtxDirPath = ref<string | null>(null);
const folderCtxRawX = ref(0);
const folderCtxRawY = ref(0);
const folderCtxMenuLeft = ref(0);
const folderCtxMenuTop = ref(0);
const folderCtxMenuPanelRef = useTemplateRef<HTMLElement>("folderCtxMenuPanelRef");
const folderCtxCategoryFlyoutRef = useTemplateRef<HTMLElement>(
  "folderCtxCategoryFlyoutRef",
);
const folderCtxCategorySubOpen = ref(false);
const folderCtxFlyoutUseLeft = ref(false);
const folderCtxFlyoutTransform = ref("");
const folderCtxFlyoutPositionReady = ref(false);

const folderCtxFlyoutPanelStyle = computed(() => {
  const s: Record<string, string> = {};
  if (folderCtxFlyoutTransform.value) {
    s.transform = folderCtxFlyoutTransform.value;
  }
  if (folderCtxCategorySubOpen.value) {
    s.visibility = folderCtxFlyoutPositionReady.value ? "visible" : "hidden";
    s.pointerEvents = folderCtxFlyoutPositionReady.value ? "auto" : "none";
  }
  return s;
});

function closeFolderCtxCategorySub() {
  folderCtxCategorySubOpen.value = false;
  folderCtxFlyoutUseLeft.value = false;
  folderCtxFlyoutTransform.value = "";
  folderCtxFlyoutPositionReady.value = false;
}

function closeFolderContextMenuAll() {
  folderCtxOpen.value = false;
  folderCtxDirPath.value = null;
  closeFolderCtxCategorySub();
}

function clampFolderContextMenuToViewport() {
  if (!folderCtxOpen.value) return;
  const el = folderCtxMenuPanelRef.value;
  if (!el) return;
  const margin = 8;
  const rawX = folderCtxRawX.value;
  const rawY = folderCtxRawY.value;
  const maxX = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
  folderCtxMenuLeft.value = Math.min(Math.max(margin, rawX), maxX);
  folderCtxMenuTop.value = Math.min(Math.max(margin, rawY), maxY);
}

function applyFolderCtxCategoryFlyoutTranslateClamp() {
  const flyout = folderCtxCategoryFlyoutRef.value;
  if (!flyout || !folderCtxCategorySubOpen.value) return;
  const margin = 8;
  const r = flyout.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (r.bottom > window.innerHeight - margin) {
    dy = window.innerHeight - margin - r.bottom;
  }
  if (r.top + dy < margin) {
    dy = margin - r.top;
  }
  if (r.right + dx > window.innerWidth - margin) {
    dx = window.innerWidth - margin - r.right;
  }
  if (r.left + dx < margin) {
    dx = margin - r.left;
  }
  folderCtxFlyoutTransform.value =
    dx !== 0 || dy !== 0 ? `translate(${dx}px, ${dy}px)` : "";
}

async function layoutFolderCtxCategoryFlyoutInViewport(opts?: {
  instant?: boolean;
}) {
  if (!folderCtxOpen.value || !folderCtxCategorySubOpen.value) {
    closeFolderCtxCategorySub();
    return;
  }
  if (!opts?.instant) {
    folderCtxFlyoutPositionReady.value = false;
  }
  folderCtxFlyoutUseLeft.value = false;
  folderCtxFlyoutTransform.value = "";
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const flyout = folderCtxCategoryFlyoutRef.value;
  if (!flyout || !folderCtxCategorySubOpen.value) {
    folderCtxFlyoutPositionReady.value = true;
    return;
  }
  const margin = 8;
  const r = flyout.getBoundingClientRect();
  if (r.right > window.innerWidth - margin) {
    folderCtxFlyoutUseLeft.value = true;
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  applyFolderCtxCategoryFlyoutTranslateClamp();
  folderCtxFlyoutPositionReady.value = true;
}

async function layoutFolderContextMenuPanel() {
  if (!folderCtxOpen.value) return;
  folderCtxMenuLeft.value = folderCtxRawX.value;
  folderCtxMenuTop.value = folderCtxRawY.value;
  if (!folderCtxCategorySubOpen.value) {
    closeFolderCtxCategorySub();
  }
  await nextTick();
  requestAnimationFrame(() => {
    clampFolderContextMenuToViewport();
    if (folderCtxCategorySubOpen.value) {
      void layoutFolderCtxCategoryFlyoutInViewport();
    }
  });
}

watch(folderCtxOpen, (open) => {
  if (open) void layoutFolderContextMenuPanel();
});

function onFolderContextMenu(fullDirPath: string, ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  closeFileContextMenuAll();
  menus.closeEditContextMenu();
  folderCtxDirPath.value = fullDirPath;
  folderCtxRawX.value = ev.clientX;
  folderCtxRawY.value = ev.clientY;
  folderCtxOpen.value = true;
  closeFolderCtxCategorySub();
  void layoutFolderContextMenuPanel();
}

function folderCtxTargetPaths(): string[] {
  const dir = folderCtxDirPath.value;
  if (!dir) return [];
  return collectFilesUnderDir(props.files, dir).map((f) => f.path);
}

function onFolderCtxCategoryPicked(name: string) {
  const paths = folderCtxTargetPaths();
  if (paths.length === 0) {
    closeFolderContextMenuAll();
    return;
  }
  emit("setFilesCategory", paths, name);
  closeFolderContextMenuAll();
}

async function onFolderCtxRemove() {
  const paths = folderCtxTargetPaths();
  closeFolderContextMenuAll();
  if (paths.length === 0) return;
  const ok = await appConfirm("是否要移除该文件夹下的所有文件？");
  if (!ok) return;
  emit("removeFileList", paths);
}

function onFolderCtxOpenInExplorer() {
  const dir = folderCtxDirPath.value;
  closeFolderContextMenuAll();
  if (!dir) return;
  void window.colorTxt.openPath(dir).then((r) => {
    if (r && "ok" in r && !r.ok) {
      appToast(r.error || "无法打开文件夹", { kind: "warning" });
    }
  });
}

function onEditCtxRename() {
  const target =
    menus.editContextMenuFilePath ||
    lastSelectedFilePath.value ||
    selectedFilePaths.value[selectedFilePaths.value.length - 1] ||
    null;
  if (!target) return;
  startRenamingFile(target);
  menus.closeEditContextMenu();
}

function onEditCtxReplace() {
  const target =
    menus.editContextMenuFilePath ||
    lastSelectedFilePath.value ||
    selectedFilePaths.value[selectedFilePaths.value.length - 1] ||
    null;
  if (!target || !isPlainTextBookPath(target)) return;
  emit("replaceFilePath", target);
  menus.closeEditContextMenu();
}

const categoryToolbarSelectRef = ref<InstanceType<typeof AppCustomSelect> | null>(
  null,
);
const sortToolbarSelectRef = ref<InstanceType<typeof AppCustomSelect> | null>(
  null,
);

const categorySelectPanelOpen = ref(false);
const sortSelectPanelOpen = ref(false);

const fullscreenFileListPopoversOpenComputed = computed(
  () =>
    Boolean(
      moreOpen.value ||
        menus.fileContextMenuOpen ||
        folderCtxOpen.value ||
        menus.editContextMenuOpen ||
        menus.categoryPickerOpen ||
        manageModalOpen.value ||
        categorySelectPanelOpen.value ||
        sortSelectPanelOpen.value,
    ),
);

watch(
  fullscreenFileListPopoversOpenComputed,
  (v) => emit("update:fullscreenFileListPopoversOpen", v),
  { immediate: true },
);

function dismissAllFullscreenTeleportUi() {
  closeMoreMenu();
  menus.dismissAllTeleportMenus();
  closeFolderContextMenuAll();
  filterVisible.value = false;
  // AppModal（分类管理）Teleport 到 body：蒙版打开时 chrome 会收起浮动侧栏，
  // 若此处一并关掉弹窗，极简/全屏下「分类管理」会刚开即关。
  categoryToolbarSelectRef.value?.closePanel?.();
  sortToolbarSelectRef.value?.closePanel?.();
}

watch(
  () => props.showFullscreenSidebar,
  (vis, prev) => {
    if (prev !== true) return;
    if (vis === true) return;
    dismissAllFullscreenTeleportUi();
  },
);

const editCtxMenuPanelRef = useTemplateRef<HTMLElement>("editCtxMenuPanelRef");
const editCtxCategoryFlyoutRef = useTemplateRef<HTMLElement>(
  "editCtxCategoryFlyoutRef",
);
const editCtxMenuLeft = ref(0);
const editCtxMenuTop = ref(0);
/** 子菜单在右侧放不下时改为向左展开（appShellMenuFlyout--left） */
const editCtxFlyoutUseLeft = ref(false);
/** 子菜单在视口内做最后平移修正（翻转后仍可能上下溢出） */
const editCtxFlyoutTransform = ref("");
/** 子菜单完成左右翻转与 translate 夹紧后再显示，避免首帧错位闪烁 */
const editCtxFlyoutPositionReady = ref(false);

const editCtxFlyoutPanelStyle = computed(() => {
  const s: Record<string, string> = {};
  if (editCtxFlyoutTransform.value) {
    s.transform = editCtxFlyoutTransform.value;
  }
  if (menus.editCategorySubOpen) {
    s.visibility = editCtxFlyoutPositionReady.value ? "visible" : "hidden";
    s.pointerEvents = editCtxFlyoutPositionReady.value ? "auto" : "none";
  }
  return s;
});

function clampEditContextMenuToViewport() {
  if (!menus.editContextMenuOpen) return;
  const el = editCtxMenuPanelRef.value;
  if (!el) return;
  const margin = 8;
  const rawX = menus.editContextMenuX;
  const rawY = menus.editContextMenuY;
  const maxX = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
  editCtxMenuLeft.value = Math.min(Math.max(margin, rawX), maxX);
  editCtxMenuTop.value = Math.min(Math.max(margin, rawY), maxY);
}

function resetEditCategoryFlyoutClamp() {
  editCtxFlyoutUseLeft.value = false;
  editCtxFlyoutTransform.value = "";
  editCtxFlyoutPositionReady.value = false;
}

function applyEditCategoryFlyoutTranslateClamp() {
  const flyout = editCtxCategoryFlyoutRef.value;
  if (!flyout || !menus.editCategorySubOpen) return;
  const margin = 8;
  const r = flyout.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (r.bottom > window.innerHeight - margin) {
    dy = window.innerHeight - margin - r.bottom;
  }
  if (r.top + dy < margin) {
    dy = margin - r.top;
  }
  if (r.right + dx > window.innerWidth - margin) {
    dx = window.innerWidth - margin - r.right;
  }
  if (r.left + dx < margin) {
    dx = margin - r.left;
  }
  editCtxFlyoutTransform.value =
    dx !== 0 || dy !== 0 ? `translate(${dx}px, ${dy}px)` : "";
}

async function layoutEditCategoryFlyoutInViewport(opts?: {
  instant?: boolean;
}) {
  if (!menus.editContextMenuOpen || !menus.editCategorySubOpen) {
    resetEditCategoryFlyoutClamp();
    return;
  }
  if (!opts?.instant) {
    editCtxFlyoutPositionReady.value = false;
  }
  editCtxFlyoutUseLeft.value = false;
  editCtxFlyoutTransform.value = "";
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  const flyout = editCtxCategoryFlyoutRef.value;
  if (!flyout || !menus.editCategorySubOpen) {
    editCtxFlyoutPositionReady.value = true;
    return;
  }
  const margin = 8;
  let r = flyout.getBoundingClientRect();
  if (r.right > window.innerWidth - margin) {
    editCtxFlyoutUseLeft.value = true;
    await nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  applyEditCategoryFlyoutTranslateClamp();
  editCtxFlyoutPositionReady.value = true;
}

async function layoutEditContextMenuPanel() {
  if (!menus.editContextMenuOpen) return;
  editCtxMenuLeft.value = menus.editContextMenuX;
  editCtxMenuTop.value = menus.editContextMenuY;
  if (!menus.editCategorySubOpen) {
    resetEditCategoryFlyoutClamp();
  }
  await nextTick();
  requestAnimationFrame(() => {
    clampEditContextMenuToViewport();
    if (menus.editCategorySubOpen) {
      void layoutEditCategoryFlyoutInViewport();
    }
  });
}

watch(
  () =>
    [
      menus.editContextMenuOpen,
      menus.editContextMenuX,
      menus.editContextMenuY,
      menus.editCategorySubOpen,
    ] as const,
  async ([open]) => {
    if (!open) {
      resetEditCategoryFlyoutClamp();
      return;
    }
    await layoutEditContextMenuPanel();
  },
);

function onWindowResizeForEditCtxMenu() {
  if (!menus.editContextMenuOpen) return;
  clampEditContextMenuToViewport();
  if (menus.editCategorySubOpen) {
    void layoutEditCategoryFlyoutInViewport({ instant: true });
  }
}

onMounted(() => {
  window.addEventListener("resize", onWindowResizeForEditCtxMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", onWindowResizeForEditCtxMenu);
});

</script>

<template>
  <div class="sidebarListWrap">
    <div
      ref="listFocusEl"
      class="sidebarTabBody"
      data-file-list-rename-hotkey
      :tabindex="isEditingFileList ? 0 : -1"
      @keydown="onFileListRootKeydown"
    >
      <div
        class="fileToolbarRow"
        :class="{ 'fileToolbarRow--filterOpen': filterVisible }"
      >
        <button
          v-if="isTreeMode && treeRootFolderKeys.length > 0"
          type="button"
          class="aiActivityLikeBtn fileTreeExpandToggle"
          :aria-label="allRootFoldersCollapsed ? '全部展开' : '全部折叠'"
          :title="allRootFoldersCollapsed ? '全部展开' : '全部折叠'"
          @click="onToggleExpandAllFolders"
        >
          <span
            class="svg"
            v-html="
              allRootFoldersCollapsed ? icons.allExpand : icons.allCollapse
            "
          />
        </button>
        <AppCustomSelect
          ref="categoryToolbarSelectRef"
          class="fileToolbarSelect"
          :model-value="fileCategory"
          :display-label="categoryTriggerLabel"
          :display-suffix="categoryTriggerSuffix"
          :trigger-mark-color="categoryTriggerMarkColor"
          :fixed-top-items="categoryFixedTop"
          :scroll-items="categoryScrollItems"
          :fixed-bottom-items="categoryFixedBottom"
          :scroll-max-height="300"
          ariaLabel="文件分类"
          category-color-marks
          @update:model-value="onCategorySelect"
          @action="onCategoryAction"
          @panel-open-change="categorySelectPanelOpen = $event"
        />
        <AppCustomSelect
          ref="sortToolbarSelectRef"
          class="fileToolbarSelect"
          :model-value="fileSort"
          :display-label="sortDisplayLabel"
          :trigger-prefix-html="sortTriggerPrefixHtml"
          :fixed-top-items="[]"
          :scroll-items="sortScrollItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="430"
          ariaLabel="文件排序"
          @update:model-value="onSortSelect"
          @panel-open-change="sortSelectPanelOpen = $event"
        />
        <button
          type="button"
          class="btn btnIconSquare fileSearchToggle"
          :class="{ active: filterVisible }"
          aria-label="切换过滤文件名"
          :title="filterVisible ? '隐藏过滤' : '显示过滤'"
          @click="filterVisible = !filterVisible"
        >
          <span class="fileSearchToggleIcon" v-html="icons.find" />
        </button>
      </div>
      <div v-show="filterVisible" class="fileFilterRow">
        <input
          ref="fileFilterInputRef"
          :value="fileFilterQuery"
          class="fileFilterInput"
          type="search"
          spellcheck="false"
          autocomplete="off"
          placeholder="过滤文件名…"
          aria-label="过滤文件列表"
          @input="
            emit(
              'updateFileFilterQuery',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
      </div>
      <div v-if="files.length === 0" class="empty">
        <div>{{ fileListEmptyHint }}</div>
        <p>{{ fileListDropHint }}</p>
      </div>
      <template v-else>
        <div v-if="filesFiltered.length === 0" class="empty">
          {{ fileListNoMatchHint }}
        </div>
        <div v-else class="sidebarListViewportPad">
          <VirtualList
            :ref="onBindListRef"
            class="sidebarList sidebarList--itemGap"
            :item-count="displayItemCount"
            :row-stride="READER_SIDEBAR_ROW_STRIDE"
            :overscan="10"
            :item-key="isTreeMode ? treeItemKeyFn : listItemKeyFn"
            arrow-nav
          >
            <template #default="{ index }">
              <template v-if="isTreeMode">
                <template
                  v-for="row in [treeFlatRows[index]]"
                  :key="treeRowKey(index)"
                >
                  <button
                    v-if="row?.kind === 'folder'"
                    type="button"
                    tabindex="-1"
                    class="sidebarItem fileItem fileItem--folder"
                    :title="row.fullDirPath"
                    @click="onTreeFolderClick(row.fullDirPath)"
                    @contextmenu="onFolderContextMenu(row.fullDirPath, $event)"
                  >
                    <span
                      class="fileItemMain"
                      :style="{
                        paddingLeft: row.depth * TREE_INDENT_PX + 'px',
                      }"
                    >
                      <span
                        class="fileTreeChevron"
                        :class="{
                          'fileTreeChevron--expanded': row.expanded,
                        }"
                        aria-hidden="true"
                        v-html="icons.foldChevron"
                      />
                      <span class="itemName">{{ row.name }}</span>
                      <span class="itemMeta itemMeta--folderStats"
                        >({{ row.fileCount }} 文件，{{
                          formatFileSize(row.totalSize)
                        }})</span
                      >
                    </span>
                  </button>
                  <button
                    v-else-if="row?.kind === 'file'"
                    type="button"
                    tabindex="-1"
                    class="sidebarItem fileItem"
                    :class="{
                      active: row.file.path === currentFilePath,
                    }"
                    :title="row.file.path"
                    @click="
                      renamingFilePath === row.file.path
                        ? undefined
                        : onTreeFileClick(row.file.path, index, $event)
                    "
                    @contextmenu="
                      onFileItemContextMenu(row.file.path, $event)
                    "
                  >
                    <span
                      class="fileItemMain"
                      :style="{
                        paddingLeft: row.depth * TREE_INDENT_PX + 'px',
                      }"
                    >
                      <span
                        v-if="isEditingFileList"
                        class="checkbox fileItemCheckboxWrap"
                        aria-hidden="true"
                      >
                        <input
                          type="checkbox"
                          :checked="
                            selectedFilePaths.includes(row.file.path)
                          "
                          tabindex="-1"
                          aria-hidden="true"
                        />
                      </span>
                      <span
                        v-if="
                          fileItemShowCategoryMarkRow(resolveTreeFileItem(row))
                        "
                        class="fileItemCatMark"
                        aria-hidden="true"
                        :style="{
                          backgroundColor: borderColorForFileRow(
                            resolveTreeFileItem(row),
                          ),
                        }"
                      />
                      <input
                        v-if="renamingFilePath === row.file.path"
                        :ref="setRenameInputEl"
                        v-model="renameDraft"
                        class="fileItemRenameInput"
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        @click.stop
                        @keydown.stop.enter.prevent="commitRenamingFile"
                        @keydown.stop.esc.prevent="cancelRenamingFile"
                        @blur="commitRenamingFile"
                      />
                      <span v-else class="itemName">{{ row.file.name }}</span>
                      <span
                        v-if="
                          typeof fileRowProgress(row.file.path) === 'number'
                        "
                        class="itemMeta itemMeta--progress"
                        :class="{
                          'itemMeta--progress-complete': isProgressComplete(
                            fileRowProgress(row.file.path),
                          ),
                        }"
                      >
                        {{
                          formatFileReadProgress(
                            fileRowProgress(row.file.path) as number,
                          )
                        }}
                      </span>
                      <span class="itemMeta">{{
                        formatFileSize(row.file.size)
                      }}</span>
                    </span>
                  </button>
                </template>
              </template>
              <button
                v-else
                type="button"
                tabindex="-1"
                class="sidebarItem fileItem"
                :class="{
                  active: filesFiltered[index].path === currentFilePath,
                }"
                :title="filesFiltered[index].path"
                @click="
                  renamingFilePath === filesFiltered[index].path
                    ? undefined
                    : onFileItemClick(filesFiltered[index], index, $event)
                "
                @contextmenu="
                  onFileItemContextMenu(filesFiltered[index].path, $event)
                "
              >
                <span class="fileItemMain">
                  <span
                    v-if="isEditingFileList"
                    class="checkbox fileItemCheckboxWrap"
                    aria-hidden="true"
                  >
                    <input
                      type="checkbox"
                      :checked="
                        selectedFilePaths.includes(filesFiltered[index].path)
                      "
                      tabindex="-1"
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    v-if="fileItemShowCategoryMarkRow(filesFiltered[index])"
                    class="fileItemCatMark"
                    aria-hidden="true"
                    :style="{
                      backgroundColor: borderColorForFileRow(
                        filesFiltered[index],
                      ),
                    }"
                  />
                  <input
                    v-if="renamingFilePath === filesFiltered[index].path"
                    :ref="setRenameInputEl"
                    v-model="renameDraft"
                    class="fileItemRenameInput"
                    type="text"
                    spellcheck="false"
                    autocomplete="off"
                    @click.stop
                    @keydown.stop.enter.prevent="commitRenamingFile"
                    @keydown.stop.esc.prevent="cancelRenamingFile"
                    @blur="commitRenamingFile"
                  />
                  <span v-else class="itemName">{{ filesFiltered[index].name }}</span>
                  <span
                    v-if="
                      typeof fileRowProgress(filesFiltered[index].path) ===
                      'number'
                    "
                    class="itemMeta itemMeta--progress"
                    :class="{
                      'itemMeta--progress-complete': isProgressComplete(
                        fileRowProgress(filesFiltered[index].path),
                      ),
                    }"
                  >
                    {{
                      formatFileReadProgress(
                        fileRowProgress(filesFiltered[index].path) as number,
                      )
                    }}
                  </span>
                  <span class="itemMeta">{{
                    formatFileSize(filesFiltered[index].size)
                  }}</span>
                </span>
              </button>
            </template>
          </VirtualList>
        </div>
      </template>
    </div>
    <div v-if="files.length > 0" class="sidebarTabFooter">
      <div class="sidebarTabFooterStart">
        <span v-if="isEditingFileList" class="sidebarTabFooterStat">
          已选中 {{ selectedFilePaths.length }} 个文件
        </span>
        <template v-else>
          <span class="sidebarTabFooterStat"
            >共 {{ filesFiltered.length }} 个文件</span
          >
          <button
            type="button"
            class="aiActivityLikeBtn"
            :disabled="!canLocateCurrentFile"
            title="定位到当前打开文件"
            aria-label="定位到当前打开文件"
            @click="onLocateCurrentFile"
          >
            <span class="svg" v-html="icons.location" />
          </button>
        </template>
      </div>
      <button
        v-if="!isEditingFileList"
        type="button"
        class="link sidebarTabFooterAction"
        :disabled="filesFiltered.length === 0"
        @click="enterEditFileListMode"
      >
        编辑
      </button>
      <button
        v-if="!isEditingFileList"
        type="button"
        class="link danger hoverMode sidebarTabFooterAction"
        :disabled="clearFileListFooterDisabled"
        @click="onClearFileListFooterClick"
      >
        {{ isFileCategoryFilterAll ? "清空" : "清空分类" }}
      </button>
      <template v-if="isEditingFileList">
        <button
          ref="footerCategoryBtnRef"
          type="button"
          class="link sidebarTabFooterAction"
          :disabled="selectedFilePaths.length === 0"
          @click="menus.onFooterCategoryClick"
        >
          分类
        </button>
        <button
          type="button"
          class="link danger sidebarTabFooterAction"
          :disabled="selectedFilePaths.length === 0"
          @click="onRemoveSelectedFileListItems"
        >
          移除
        </button>
        <button
          type="button"
          class="link warning hoverMode sidebarTabFooterAction"
          @click="menus.exitEditFileListMode"
        >
          退出编辑
        </button>
      </template>
    </div>
    <Teleport to="body">
      <div
        v-if="menus.fileContextMenuOpen"
        ref="fileCtxMenuPanelRef"
        data-fullscreen-sidebar-float
        class="fileCtxMenu appShellMenuPanel"
        :style="{
          left: `${fileCtxMenuLeft}px`,
          top: `${fileCtxMenuTop}px`,
        }"
        role="menu"
        @click.stop
      >
        <div
          class="appShellMenuSubWrap"
          @mouseenter="
            fileCtxCategorySubOpen = true;
            void layoutFileCtxCategoryFlyoutInViewport();
          "
          @mouseleave="closeFileCtxCategorySub"
        >
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            aria-haspopup="menu"
            :aria-expanded="fileCtxCategorySubOpen"
          >
            <span class="appShellMenuLabel">分类</span>
            <span class="appShellMenuSubChevron">›</span>
          </button>
          <div
            v-show="fileCtxCategorySubOpen"
            ref="fileCtxCategoryFlyoutRef"
            class="appShellMenuFlyout fileCtxCategoryFlyout"
            :class="
              fileCtxFlyoutUseLeft
                ? 'appShellMenuFlyout--left'
                : 'appShellMenuFlyout--right'
            "
            :style="fileCtxFlyoutPanelStyle"
            role="menu"
            @click.stop
          >
            <FileCategoryFlyoutList
              :catalog="fileCategoryCatalog"
              :menu-counts="categoryMenuCounts"
              @pick="onFileCtxCategoryPicked"
            />
          </div>
        </div>
        <button
          type="button"
          class="appShellMenuItem appShellMenuItem--danger"
          role="menuitem"
          @click="onFileCtxRemove"
        >
          移除
        </button>
        <button
          v-if="menus.fileContextMenuWithCtrl"
          type="button"
          class="appShellMenuItem appShellMenuItem--danger"
          role="menuitem"
          @click="onFileCtxClearFileMeta"
        >
          清除该文件数据
        </button>
        <div class="appShellMenuDivider" role="separator" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onFileCtxRename"
        >
          重命名
        </button>
        <button
          v-if="
            menus.fileContextMenuFilePath &&
            isPlainTextBookPath(menus.fileContextMenuFilePath)
          "
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onFileCtxReplace"
        >
          替换文件
        </button>
        <div class="appShellMenuDivider" role="separator" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onFileCtxOpenInNewWindow"
        >
          在新窗口中打开
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onFileCtxReveal"
        >
          在文件管理器中显示
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="menus.fileContextMenuOpen"
        data-fullscreen-sidebar-float
        class="fileCtxMenuBackdrop"
        @pointerdown="closeFileContextMenuAll"
      />
    </Teleport>
    <Teleport to="body">
      <div
        v-if="folderCtxOpen"
        ref="folderCtxMenuPanelRef"
        data-fullscreen-sidebar-float
        class="fileCtxMenu appShellMenuPanel"
        :style="{
          left: `${folderCtxMenuLeft}px`,
          top: `${folderCtxMenuTop}px`,
        }"
        role="menu"
        @click.stop
      >
        <div
          class="appShellMenuSubWrap"
          @mouseenter="
            folderCtxCategorySubOpen = true;
            void layoutFolderCtxCategoryFlyoutInViewport();
          "
          @mouseleave="closeFolderCtxCategorySub"
        >
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            aria-haspopup="menu"
            :aria-expanded="folderCtxCategorySubOpen"
          >
            <span class="appShellMenuLabel">分类</span>
            <span class="appShellMenuSubChevron">›</span>
          </button>
          <div
            v-show="folderCtxCategorySubOpen"
            ref="folderCtxCategoryFlyoutRef"
            class="appShellMenuFlyout fileCtxCategoryFlyout"
            :class="
              folderCtxFlyoutUseLeft
                ? 'appShellMenuFlyout--left'
                : 'appShellMenuFlyout--right'
            "
            :style="folderCtxFlyoutPanelStyle"
            role="menu"
            @click.stop
          >
            <FileCategoryFlyoutList
              :catalog="fileCategoryCatalog"
              :menu-counts="categoryMenuCounts"
              @pick="onFolderCtxCategoryPicked"
            />
          </div>
        </div>
        <button
          type="button"
          class="appShellMenuItem appShellMenuItem--danger"
          role="menuitem"
          @click="onFolderCtxRemove"
        >
          移除
        </button>
        <div class="appShellMenuDivider" role="separator" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onFolderCtxOpenInExplorer"
        >
          在文件管理器中打开
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="folderCtxOpen"
        data-fullscreen-sidebar-float
        class="fileCtxMenuBackdrop"
        @pointerdown="closeFolderContextMenuAll"
      />
    </Teleport>
    <Teleport to="body">
      <div
        v-if="menus.editContextMenuOpen"
        ref="editCtxMenuPanelRef"
        data-fullscreen-sidebar-float
        class="editCtxMenu appShellMenuPanel"
        :style="{
          left: `${editCtxMenuLeft}px`,
          top: `${editCtxMenuTop}px`,
        }"
        role="menu"
        @click.stop
      >
        <div
          class="appShellMenuSubWrap"
          @mouseenter="menus.setEditCategorySubOpen(true)"
          @mouseleave="menus.setEditCategorySubOpen(false)"
        >
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            aria-haspopup="menu"
            :aria-expanded="menus.editCategorySubOpen"
          >
            <span class="appShellMenuLabel">分类</span>
            <span class="appShellMenuSubChevron">›</span>
          </button>
          <div
            v-show="menus.editCategorySubOpen"
            ref="editCtxCategoryFlyoutRef"
            class="appShellMenuFlyout editCtxCategoryFlyout"
            :class="
              editCtxFlyoutUseLeft
                ? 'appShellMenuFlyout--left'
                : 'appShellMenuFlyout--right'
            "
            :style="editCtxFlyoutPanelStyle"
            role="menu"
            @click.stop
          >
            <FileCategoryFlyoutList
              :catalog="fileCategoryCatalog"
              :menu-counts="categoryMenuCounts"
              @pick="menus.onEditMenuCategoryPicked"
            />
          </div>
        </div>
        <button
          type="button"
          class="appShellMenuItem appShellMenuItem--danger"
          role="menuitem"
          @click="menus.onEditMenuRemove"
        >
          移除
        </button>
        <div class="appShellMenuDivider" role="separator" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onEditCtxRename"
        >
          重命名
        </button>
        <button
          v-if="
            isPlainTextBookPath(
              menus.editContextMenuFilePath || lastSelectedFilePath || '',
            )
          "
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onEditCtxReplace"
        >
          替换文件
        </button>
        <div class="appShellMenuDivider" role="separator" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="menus.onEditMenuSelectAll"
        >
          全选
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="menus.onEditMenuInvert"
        >
          反选
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="menus.editContextMenuOpen"
        data-fullscreen-sidebar-float
        class="editCtxMenuBackdrop"
        @pointerdown="menus.closeEditContextMenu"
      />
    </Teleport>
    <AppShellMenuTeleport
      v-model:open="moreOpen"
      :left="moreLeft"
      :top="moreTop"
      :width="FILES_HEADER_MORE_MENU_W"
      caret="end"
      :on-panel-mount="bindMorePanel"
      aria-label="文件更多"
    >
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onPickFiles"
      >
        <span class="appShellMenuIconSlot" v-html="icons.add" />
        <span class="appShellMenuLabel">选择文件</span>
      </button>
      <div class="appShellMenuDivider" role="separator" />
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="files.length === 0 || removingMissingFiles"
        @click="onRemoveMissingFiles"
      >
        <span class="appShellMenuIconSlot" v-html="icons.clear" />
        <span class="appShellMenuLabel">移除失效文件</span>
      </button>
    </AppShellMenuTeleport>
    <CategoryPickerMenu
      :open="menus.categoryPickerOpen"
      :x="menus.categoryPickX"
      :y="menus.categoryPickY"
      :align-above="menus.categoryPickFromFooter"
      :catalog="fileCategoryCatalog"
      :menu-counts="categoryMenuCounts"
      :min-width="140"
      @close="menus.closeCategoryPicker"
      @pick="menus.onCategoryPicked"
    />
    <FileCategoryManageModal
      v-model="manageModalOpen"
      :catalog="fileCategoryCatalog"
      @apply="emit('applyCategoryCatalog', $event)"
    />
  </div>
</template>

<style scoped>
.sidebarListWrap {
  position: relative;
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
  outline: none;
  background: var(--bg);
}
.fileToolbarRow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.fileToolbarRow--filterOpen {
  border-bottom: none;
}
.fileToolbarSelect {
  flex: 1;
  min-width: 0;
}
.fileTreeExpandToggle,
.fileSearchToggle {
  flex-shrink: 0;
}
.fileSearchToggleIcon {
  display: flex;
  width: 16px;
  height: 16px;
}
.fileSearchToggleIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.fileFilterRow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 8px 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.fileFilterInput {
  box-sizing: border-box;
  width: 100%;
}
.sidebarListViewportPad {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* 列表与边缘留白由 .sidebar .virtualList-scroll.sidebarList 的 padding 统一控制 */
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
.sidebarItem {
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
.itemName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itemMeta {
  font-size: 12px;
  color: inherit;
  opacity: 0.65;
  white-space: nowrap;
}
.itemMeta--progress {
  color: var(--warning);
  opacity: 1;
}

.itemMeta--progress-complete {
  color: var(--success);
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px 16px;
  font-size: 12px;
  color: var(--secondary);
}
.fileItem {
  align-items: stretch;
  gap: 6px;
  padding-left: 6px;
}
.fileItem--folder .itemName {
  font-weight: 600;
}
.fileTreeChevron {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 2px;
  color: var(--tab-fg);
  transform: rotate(-90deg);
  transition: transform 0.12s ease;
}
.fileTreeChevron--expanded {
  transform: rotate(0deg);
}
.fileTreeChevron :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}
.fileTreeChevron :deep(svg path) {
  fill: currentColor;
}
.itemMeta--folderStats {
  flex-shrink: 0;
  opacity: 0.75;
}
.fileItemCatMark {
  flex-shrink: 0;
  width: 3px;
  align-self: stretch;
  border-radius: 2px;
  margin: 4px 0 2px 0;
}
.fileItemMain {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 8px;
  align-items: center;
}
.fileItemCheckboxWrap {
  flex-shrink: 0;
  pointer-events: none;
  cursor: default;
}

.fileItemCheckboxWrap input {
  pointer-events: none;
  cursor: default;
}
.fileItemRenameInput {
  flex: 1;
  min-width: 0;
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
.sidebarTabFooterAction {
  flex-shrink: 0;
}
.editCtxMenuBackdrop {
  position: fixed;
  inset: 0;
  z-index: 6990;
}
.fileCtxMenuBackdrop {
  position: fixed;
  inset: 0;
  z-index: 6990;
}
.editCtxMenu {
  position: fixed;
  z-index: 7100;
  min-width: 100px;
}
.fileCtxMenu {
  position: fixed;
  z-index: 7100;
  min-width: 160px;
}
.editCtxCategoryFlyout {
  min-width: 140px;
}
.fileCtxCategoryFlyout {
  min-width: 140px;
}
</style>
