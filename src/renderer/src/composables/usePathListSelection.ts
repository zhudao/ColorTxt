import { ref, watch, type Ref } from "vue";

export type PathListItem = {
  path: string;
};

/**
 * 路径列表多选（资源管理器语义）：单击单选、Ctrl/Meta 切换、Shift 范围、
 * Ctrl/Cmd+A 全选、Ctrl/Cmd+I 反选。始终可选（无侧栏「编辑」门闩）。
 */
export function usePathListSelection(opts: {
  /** 当前可见列表（与渲染顺序一致，供 Shift 连选） */
  items: Ref<readonly PathListItem[]>;
}) {
  const selectedPaths = ref<string[]>([]);
  const lastSelectedPath = ref<string | null>(null);

  watch(
    () => opts.items.value,
    (nextItems) => {
      if (selectedPaths.value.length === 0) return;
      const exists = new Set(nextItems.map((f) => f.path));
      selectedPaths.value = selectedPaths.value.filter((p) => exists.has(p));
      if (
        lastSelectedPath.value &&
        !selectedPaths.value.includes(lastSelectedPath.value)
      ) {
        lastSelectedPath.value =
          selectedPaths.value.length > 0
            ? selectedPaths.value[selectedPaths.value.length - 1]!
            : null;
      }
    },
  );

  function visiblePaths(): string[] {
    return opts.items.value.map((f) => f.path);
  }

  function selectAllVisible() {
    selectedPaths.value = visiblePaths().slice();
    const list = opts.items.value;
    lastSelectedPath.value =
      list.length > 0 ? list[list.length - 1]!.path : null;
  }

  function invertSelectionVisible() {
    const visible = visiblePaths();
    const visSet = new Set(visible);
    const selectedSet = new Set(selectedPaths.value);
    const next: string[] = [];
    for (const p of selectedPaths.value) {
      if (!visSet.has(p)) next.push(p);
    }
    for (const p of visible) {
      if (!selectedSet.has(p)) next.push(p);
    }
    selectedPaths.value = next;
    lastSelectedPath.value =
      next.length > 0 ? next[next.length - 1]! : null;
  }

  function onItemClick(listIndex: number, ev: MouseEvent) {
    const list = opts.items.value;
    const item = list[listIndex];
    if (!item) return;
    const filePath = item.path;
    const toggleMod = ev.ctrlKey || ev.metaKey;
    const rangeMod = ev.shiftKey;

    if (rangeMod) {
      const anchor = lastSelectedPath.value;
      if (!anchor) {
        lastSelectedPath.value = filePath;
        selectedPaths.value = [filePath];
        return;
      }
      const anchorIdx = list.findIndex((f) => f.path === anchor);
      const clickedIdx = listIndex;
      if (anchorIdx < 0 || clickedIdx < 0) {
        lastSelectedPath.value = filePath;
        selectedPaths.value = [filePath];
        return;
      }
      const start = Math.min(anchorIdx, clickedIdx);
      const end = Math.max(anchorIdx, clickedIdx);
      selectedPaths.value = list.slice(start, end + 1).map((f) => f.path);
      return;
    }

    if (toggleMod) {
      const idx = selectedPaths.value.indexOf(filePath);
      if (idx >= 0) selectedPaths.value.splice(idx, 1);
      else selectedPaths.value.push(filePath);
      lastSelectedPath.value = filePath;
      return;
    }

    selectedPaths.value = [filePath];
    lastSelectedPath.value = filePath;
  }

  function onListKeydown(ev: KeyboardEvent) {
    const accel = ev.ctrlKey || ev.metaKey;
    if (accel && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      selectAllVisible();
    } else if (accel && ev.key.toLowerCase() === "i") {
      ev.preventDefault();
      invertSelectionVisible();
    }
  }

  function clearSelection() {
    selectedPaths.value = [];
    lastSelectedPath.value = null;
  }

  return {
    selectedPaths,
    lastSelectedPath,
    onItemClick,
    onListKeydown,
    selectAllVisible,
    invertSelectionVisible,
    clearSelection,
  };
}
