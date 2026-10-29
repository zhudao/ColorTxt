import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

/** 原生 `<input>` / `<textarea>`，不含 Monaco 等 contenteditable（它们自有 AppContextMenu） */
function isNativeTextFormControl(
  formControlType: Electron.ContextMenuParams["formControlType"],
): boolean {
  return (
    formControlType === "text-area" ||
    formControlType === "input-text" ||
    formControlType === "input-search" ||
    formControlType === "input-password" ||
    formControlType === "input-email" ||
    formControlType === "input-url" ||
    formControlType === "input-telephone" ||
    formControlType === "input-number"
  );
}

/**
 * Electron 默认不提供输入框右键菜单（且 `removeMenu()` 后更无编辑项）。
 * 在主进程为原生可编辑表单控件弹出剪切/复制/粘贴等。
 */
export function attachEditableContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_event, params) => {
    if (win.isDestroyed()) return;
    if (!params.isEditable || !isNativeTextFormControl(params.formControlType)) {
      return;
    }
    const { editFlags } = params;
    const template: MenuItemConstructorOptions[] = [
      { label: "撤销", role: "undo", enabled: editFlags.canUndo },
      { label: "重做", role: "redo", enabled: editFlags.canRedo },
      { type: "separator" },
      { label: "剪切", role: "cut", enabled: editFlags.canCut },
      { label: "复制", role: "copy", enabled: editFlags.canCopy },
      { label: "粘贴", role: "paste", enabled: editFlags.canPaste },
      { label: "删除", role: "delete", enabled: editFlags.canDelete },
      { type: "separator" },
      { label: "全选", role: "selectAll", enabled: editFlags.canSelectAll },
    ];
    Menu.buildFromTemplate(template).popup({
      window: win,
      ...(params.frame ? { frame: params.frame } : {}),
    });
  });
}
