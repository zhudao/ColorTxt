import { nextTick, ref, watch, type Ref, type ShallowRef } from "vue";
import type { SidebarFileItem } from "./useReaderSidebarLists";

export type FileListSelectionProps = Readonly<{
  files: SidebarFileItem[];
  filesFiltered: SidebarFileItem[];
}>;

export type FileListSelectionEmit = {
  (e: "openFile", item: SidebarFileItem): void;
  (e: "removeFileList", filePaths: string[]): void;
};

export function useFileListSelection(
  props: FileListSelectionProps,
  emit: FileListSelectionEmit,
  templateRefs?: {
    listFocusEl: ShallowRef<HTMLElement | null>;
    footerCategoryBtnRef: ShallowRef<HTMLButtonElement | null>;
  },
) {
  const isEditingFileList = ref(false);
  const selectedFilePaths = ref<string[]>([]);
  const lastSelectedFilePath = ref<string | null>(null);
  const listFocusEl: Ref<HTMLElement | null> =
    templateRefs?.listFocusEl ?? ref<HTMLElement | null>(null);
  const footerCategoryBtnRef: Ref<HTMLButtonElement | null> =
    templateRefs?.footerCategoryBtnRef ?? ref<HTMLButtonElement | null>(null);

  watch(
    () => props.files,
    (nextFiles) => {
      if (selectedFilePaths.value.length === 0) return;
      const exists = new Set(nextFiles.map((f) => f.path));
      selectedFilePaths.value = selectedFilePaths.value.filter((p) =>
        exists.has(p),
      );
      if (
        lastSelectedFilePath.value &&
        !selectedFilePaths.value.includes(lastSelectedFilePath.value)
      ) {
        lastSelectedFilePath.value =
          selectedFilePaths.value.length > 0
            ? selectedFilePaths.value[selectedFilePaths.value.length - 1]!
            : null;
      }
    },
  );

  watch(isEditingFileList, (editing) => {
    if (editing) {
      void nextTick(() => listFocusEl.value?.focus({ preventScroll: true }));
    }
  });

  function visiblePaths(): string[] {
    return props.filesFiltered.map((f) => f.path);
  }

  function selectAllVisible() {
    selectedFilePaths.value = visiblePaths().slice();
    const list = props.filesFiltered;
    lastSelectedFilePath.value =
      list.length > 0 ? list[list.length - 1]!.path : null;
  }

  function invertSelectionVisible() {
    const visible = visiblePaths();
    const visSet = new Set(visible);
    /** 用 Set 做成员判断，避免对每条可见项在超长选中数组上 O(n) 的 includes（几万项时接近平方级卡顿） */
    const selectedSet = new Set(selectedFilePaths.value);
    const next: string[] = [];
    for (const p of selectedFilePaths.value) {
      if (!visSet.has(p)) next.push(p);
    }
    for (const p of visible) {
      if (!selectedSet.has(p)) next.push(p);
    }
    selectedFilePaths.value = next;
    lastSelectedFilePath.value =
      next.length > 0 ? next[next.length - 1]! : null;
  }

  /**
   * @param orderedPaths 连选/可见顺序用的路径序列；缺省为 `filesFiltered`（列表模式）。
   *   树状模式应传入当前可见的文件行路径（不含文件夹节点）。
   */
  function onFileItemClick(
    item: SidebarFileItem,
    _listIndex: number,
    ev: MouseEvent,
    orderedPaths?: readonly string[],
  ) {
    const filePath = item.path;
    if (!isEditingFileList.value) {
      emit("openFile", item);
      return;
    }
    const order =
      orderedPaths && orderedPaths.length > 0
        ? orderedPaths
        : visiblePaths();
    const toggleMod = ev.ctrlKey || ev.metaKey;
    const rangeMod = ev.shiftKey;

    if (rangeMod) {
      const anchor = lastSelectedFilePath.value;
      if (!anchor) {
        lastSelectedFilePath.value = filePath;
        selectedFilePaths.value = [filePath];
        return;
      }
      const anchorIdx = order.indexOf(anchor);
      const clickedIdx = order.indexOf(filePath);
      if (anchorIdx < 0 || clickedIdx < 0) {
        lastSelectedFilePath.value = filePath;
        selectedFilePaths.value = [filePath];
        return;
      }
      const start = Math.min(anchorIdx, clickedIdx);
      const end = Math.max(anchorIdx, clickedIdx);
      const rangePaths = order.slice(start, end + 1);
      /* 与资源管理器一致：Shift 连选仅保留锚点～当前项的连续区间；不移动锚点（lastSelected） */
      selectedFilePaths.value = rangePaths.slice();
      return;
    }

    if (toggleMod) {
      const idx = selectedFilePaths.value.indexOf(filePath);
      if (idx >= 0) selectedFilePaths.value.splice(idx, 1);
      else selectedFilePaths.value.push(filePath);
      lastSelectedFilePath.value = filePath;
      return;
    }

    selectedFilePaths.value = [filePath];
    lastSelectedFilePath.value = filePath;
  }

  function onListKeydown(ev: KeyboardEvent) {
    if (!isEditingFileList.value) return;
    const accel = ev.ctrlKey || ev.metaKey;
    if (accel && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      selectAllVisible();
    } else if (accel && ev.key.toLowerCase() === "i") {
      ev.preventDefault();
      invertSelectionVisible();
    }
  }

  function enterEditFileListMode() {
    isEditingFileList.value = true;
    selectedFilePaths.value = [];
    lastSelectedFilePath.value = null;
  }

  function clearEditSelectionState() {
    isEditingFileList.value = false;
    selectedFilePaths.value = [];
    lastSelectedFilePath.value = null;
  }

  function onRemoveSelectedFileListItems() {
    const paths = selectedFilePaths.value;
    if (paths.length === 0) return;
    emit("removeFileList", paths.slice());
    selectedFilePaths.value = [];
    lastSelectedFilePath.value = null;
  }

  /** 编辑态右键未选中项：先单选该项，再打开右键菜单（与资源管理器一致） */
  function selectSinglePathForContextMenu(filePath: string) {
    selectedFilePaths.value = [filePath];
    lastSelectedFilePath.value = filePath;
  }

  return {
    isEditingFileList,
    selectedFilePaths,
    lastSelectedFilePath,
    listFocusEl,
    footerCategoryBtnRef,
    onFileItemClick,
    onListKeydown,
    enterEditFileListMode,
    clearEditSelectionState,
    onRemoveSelectedFileListItems,
    selectAllVisible,
    invertSelectionVisible,
    selectSinglePathForContextMenu,
  };
}
