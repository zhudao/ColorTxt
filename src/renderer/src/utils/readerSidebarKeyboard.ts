/** 键盘事件是否起源于阅读侧栏（活动栏 + 面板） */
export function keyboardEventFromReaderSidebar(ev: KeyboardEvent): boolean {
  for (const n of ev.composedPath()) {
    if (
      n instanceof HTMLElement &&
      n.hasAttribute("data-reader-sidebar-root")
    ) {
      return true;
    }
  }
  return false;
}

/** 侧栏搜索框 / 重命名 / AI 输入等：整表让出，避免抢走 Ctrl+← 挪光标等 */
export function keyboardEventFromReaderSidebarEditable(
  ev: KeyboardEvent,
): boolean {
  if (!keyboardEventFromReaderSidebar(ev)) return false;
  const t = ev.target;
  if (!(t instanceof Element)) return false;
  if (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  const role = t.getAttribute("role");
  return role === "slider" || role === "spinbutton" || role === "textbox";
}

/** 列表用 ↑↓ / PageUp / PageDown 换行与翻页，勿改成阅读器滚屏 */
const SIDEBAR_LIST_NAV_ACTIONS = new Set([
  "scrollDownLine",
  "scrollUpLine",
  "scrollPageUp",
  "scrollPageDown",
]);

function isBareF2(ev: KeyboardEvent): boolean {
  return (
    ev.key === "F2" &&
    !ev.altKey &&
    !ev.ctrlKey &&
    !ev.metaKey &&
    !ev.shiftKey
  );
}

/** 仅文件列表把 F2 留给重命名；章节等其它侧栏仍走窗口快捷键（默认切主题） */
function keyboardEventFromFileListRenameHost(ev: KeyboardEvent): boolean {
  for (const n of ev.composedPath()) {
    if (
      n instanceof HTMLElement &&
      n.hasAttribute("data-file-list-rename-hotkey")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 侧栏焦点时是否让出该窗口快捷键（不 preventDefault）。
 * 列表只让出滚行/翻页；裸 `F2` 仅文件列表让出（重命名）。设置 `F5` 等仍派发。
 */
export function shouldDeferShortcutForReaderSidebar(
  action: string,
  ev: KeyboardEvent,
): boolean {
  if (!keyboardEventFromReaderSidebar(ev)) return false;
  if (keyboardEventFromReaderSidebarEditable(ev)) return true;
  if (isBareF2(ev)) return keyboardEventFromFileListRenameHost(ev);
  return SIDEBAR_LIST_NAV_ACTIONS.has(action);
}
