/** `DataTransfer.types` 在部分环境为 DOMStringList，勿用 `.includes` */
export function dataTransferLikelyHasExternalFiles(
  dt: DataTransfer | null,
): boolean {
  if (!dt) return false;
  const types = dt.types;
  if (types && types.length) {
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
  }
  if (dt.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      if (dt.items[i]?.kind === "file") return true;
    }
  }
  if (dt.files?.length) return true;
  return false;
}

/**
 * 从拖放 `DataTransfer` 收集磁盘路径（Electron `webUtils.getPathForFile`）。
 * `drop` 时优先 `files`；为空时回退 `items` + `getAsFile()`。
 */
export function collectFsPathsFromDataTransfer(
  dt: DataTransfer | null,
): string[] {
  const api = window.colorTxt;
  if (!api?.getPathForFile) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const pushFile = (file: File | null) => {
    if (!file) return;
    try {
      const p = api.getPathForFile(file);
      if (p && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    } catch {
      /* ignore */
    }
  };
  if (dt?.files?.length) {
    for (let i = 0; i < dt.files.length; i++) {
      pushFile(dt.files[i]!);
    }
  }
  if (out.length === 0 && dt?.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it?.kind === "file") {
        pushFile(it.getAsFile());
      }
    }
  }
  return out;
}

/** 侧栏根：拖入合并进文件列表 */
export const DROP_ZONE_READER_SIDEBAR = "reader-sidebar";
/** 角色编辑抽屉立绘预览：拖入设置立绘，不触发侧栏「添加文件」 */
export const DROP_ZONE_CHARACTER_PORTRAIT = "character-portrait";

/** 拖放事件路径是否经过带 `data-drop-zone` 的节点 */
export function isDragOverDropZone(ev: DragEvent, zoneId: string): boolean {
  for (const n of ev.composedPath()) {
    if (n instanceof HTMLElement && n.dataset.dropZone === zoneId) {
      return true;
    }
  }
  return false;
}
