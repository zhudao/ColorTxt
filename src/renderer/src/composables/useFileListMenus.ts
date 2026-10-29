import { ref, type Ref } from "vue";
export type FileListMenusEmit = {
  (e: "setFilesCategory", paths: string[], category: string): void;
  (e: "removeFileList", filePaths: string[]): void;
  (e: "open-file-in-new-window", path: string): void;
  (e: "replaceFilePath", oldPath: string): void;
};

export function useFileListMenus(
  emit: FileListMenusEmit,
  selection: {
    isEditingFileList: Ref<boolean>;
    selectedFilePaths: Ref<string[]>;
    lastSelectedFilePath: Ref<string | null>;
    footerCategoryBtnRef: Ref<HTMLButtonElement | null>;
    clearEditSelectionState: () => void;
    onRemoveSelectedFileListItems: () => void;
    selectAllVisible: () => void;
    invertSelectionVisible: () => void;
    selectSinglePathForContextMenu: (filePath: string) => void;
  },
) {
  const fileContextMenuOpen = ref(false);
  const fileContextMenuX = ref(0);
  const fileContextMenuY = ref(0);
  const fileContextMenuFilePath = ref<string | null>(null);
  /** 仅非编辑态文件右键：按住 Ctrl 时显示「清除该文件数据」 */
  const fileContextMenuWithCtrl = ref(false);
  const fileContextMenuItems = [
    { id: "category", label: "分类" },
    { id: "remove", label: "移除", type: "danger" as const },
    { id: "sep-1", separator: true },
    { id: "rename", label: "重命名" },
    { id: "replace", label: "替换文件" },
    { id: "sep-2", separator: true },
    { id: "openInNewWindow", label: "在新窗口中打开" },
    { id: "reveal", label: "在文件管理器中显示" },
  ];

  const editContextMenuOpen = ref(false);
  const editContextMenuX = ref(0);
  const editContextMenuY = ref(0);
  const editContextMenuFilePath = ref<string | null>(null);
  const editCategorySubOpen = ref(false);

  const categoryPickerOpen = ref(false);
  const categoryPickX = ref(0);
  const categoryPickY = ref(0);
  const categoryPickFromFooter = ref(false);
  const categoryPickTargetPaths = ref<string[]>([]);

  function closeFileContextMenu() {
    fileContextMenuOpen.value = false;
    fileContextMenuFilePath.value = null;
    fileContextMenuWithCtrl.value = false;
  }

  function closeEditContextMenu() {
    editContextMenuOpen.value = false;
    editContextMenuFilePath.value = null;
    editCategorySubOpen.value = false;
  }

  function closeCategoryPicker() {
    categoryPickerOpen.value = false;
    categoryPickTargetPaths.value = [];
  }

  /** 全屏浮动侧栏收起等场景：关掉所有挂到 `body` 的文件列表菜单 */
  function dismissAllTeleportMenus() {
    closeFileContextMenu();
    closeEditContextMenu();
    closeCategoryPicker();
  }

  function openCategoryPickerAt(
    x: number,
    y: number,
    fromFooter: boolean,
    targetPaths?: string[],
  ) {
    categoryPickX.value = x;
    categoryPickY.value = y;
    categoryPickFromFooter.value = fromFooter;
    categoryPickTargetPaths.value =
      targetPaths && targetPaths.length > 0
        ? targetPaths.slice()
        : selection.selectedFilePaths.value.slice();
    categoryPickerOpen.value = true;
  }

  function onFooterCategoryClick(ev: MouseEvent) {
    ev.preventDefault();
    if (selection.selectedFilePaths.value.length === 0) return;
    const btn = selection.footerCategoryBtnRef.value;
    if (btn) {
      const r = btn.getBoundingClientRect();
      openCategoryPickerAt(r.left, r.top, true, selection.selectedFilePaths.value);
    }
  }

  function onEditMenuCategoryPicked(name: string) {
    emit("setFilesCategory", selection.selectedFilePaths.value.slice(), name);
    closeEditContextMenu();
  }

  function onCategoryPicked(name: string) {
    const paths =
      categoryPickTargetPaths.value.length > 0
        ? categoryPickTargetPaths.value.slice()
        : selection.selectedFilePaths.value.slice();
    emit("setFilesCategory", paths, name);
    closeCategoryPicker();
  }

  function onFileItemContextMenu(filePath: string, ev: MouseEvent) {
    ev.preventDefault();
    if (selection.isEditingFileList.value) {
      if (!selection.selectedFilePaths.value.includes(filePath)) {
        selection.selectSinglePathForContextMenu(filePath);
      }
      editContextMenuX.value = ev.clientX;
      editContextMenuY.value = ev.clientY;
      editContextMenuFilePath.value = filePath;
      editContextMenuOpen.value = true;
      closeFileContextMenu();
      return;
    }
    fileContextMenuFilePath.value = filePath;
    fileContextMenuX.value = ev.clientX;
    fileContextMenuY.value = ev.clientY;
    fileContextMenuWithCtrl.value = ev.ctrlKey;
    fileContextMenuOpen.value = true;
    closeEditContextMenu();
  }

  function onFileContextMenuSelect(actionId: string) {
    const filePath = fileContextMenuFilePath.value;
    if (!filePath) return;
    if (actionId === "category") {
      openCategoryPickerAt(fileContextMenuX.value, fileContextMenuY.value, false, [
        filePath,
      ]);
      closeFileContextMenu();
      return;
    }
    if (actionId === "remove") {
      emit("removeFileList", [filePath]);
      closeFileContextMenu();
      return;
    }
    if (actionId === "openInNewWindow") {
      emit("open-file-in-new-window", filePath);
      closeFileContextMenu();
      return;
    }
    if (actionId === "reveal") {
      void window.colorTxt.showItemInFolder(filePath).catch(() => {});
    }
    if (actionId === "replace") {
      emit("replaceFilePath", filePath);
      closeFileContextMenu();
      return;
    }
    if (actionId !== "rename") closeFileContextMenu();
  }

  function onEditMenuRemove() {
    selection.onRemoveSelectedFileListItems();
    closeEditContextMenu();
  }

  function onEditMenuSelectAll() {
    selection.selectAllVisible();
    closeEditContextMenu();
  }

  function onEditMenuInvert() {
    selection.invertSelectionVisible();
    closeEditContextMenu();
  }

  function exitEditFileListMode() {
    selection.clearEditSelectionState();
    closeEditContextMenu();
    closeCategoryPicker();
  }

  function setEditCategorySubOpen(open: boolean) {
    editCategorySubOpen.value = open;
  }

  return {
    fileContextMenuOpen,
    fileContextMenuX,
    fileContextMenuY,
    fileContextMenuFilePath,
    fileContextMenuWithCtrl,
    fileContextMenuItems,
    editContextMenuOpen,
    editContextMenuX,
    editContextMenuY,
    editContextMenuFilePath,
    editCategorySubOpen,
    categoryPickerOpen,
    categoryPickX,
    categoryPickY,
    categoryPickFromFooter,
    closeFileContextMenu,
    closeEditContextMenu,
    closeCategoryPicker,
    dismissAllTeleportMenus,
    onFooterCategoryClick,
    onEditMenuCategoryPicked,
    onCategoryPicked,
    onFileItemContextMenu,
    onFileContextMenuSelect,
    onEditMenuRemove,
    onEditMenuSelectAll,
    onEditMenuInvert,
    exitEditFileListMode,
    setEditCategorySubOpen,
  };
}
