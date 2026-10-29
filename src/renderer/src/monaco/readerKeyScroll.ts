import type * as monaco from "monaco-editor";

export type ReaderScrollKeyHandlerOptions = {
  /** 空格键：只读下一屏（阅读尺开启时按聚焦行数移尺），并避免触发只读空提示气泡 */
  onSpacePageDown?: () => void;
  /**
   * 为 false 时不做任何只读侧键位拦截（空格翻页、方向键等），交给 Monaco 正常编辑。
   * 编辑模式下应返回 false。
   */
  shouldInterceptReadOnlyKeys?: () => boolean;
};

/**
 * 阅读器只读模式下：屏蔽左右/Home/End/Delete 与无意义剪贴板快捷键。
 * 空格改为下一屏滚动（见 options；窗口快捷键也会把只读空格当下一屏，焦点不在编辑器时仍能翻页）；
 * 上下方向键/PageUp/PageDown 改由应用层快捷键系统统一处理，便于用户自定义。
 */
export function installReaderScrollKeyHandler(
  monacoApi: typeof monaco,
  e: monaco.editor.IStandaloneCodeEditor,
  options?: ReaderScrollKeyHandlerOptions,
): monaco.IDisposable {
  return e.onKeyDown((ev) => {
    if (options?.shouldInterceptReadOnlyKeys?.() === false) {
      return;
    }

    const accelKey = ev.ctrlKey || ev.metaKey;
    const isPasteOrCut =
      accelKey &&
      (ev.keyCode === monacoApi.KeyCode.KeyV ||
        ev.keyCode === monacoApi.KeyCode.KeyX);
    if (isPasteOrCut) {
      // 只读阅读器中粘贴/剪切无意义；拦截以避免 Monaco 弹出空提示。
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    if (
      ev.keyCode === monacoApi.KeyCode.Space &&
      !accelKey &&
      !ev.altKey
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      options?.onSpacePageDown?.();
      return;
    }

    const key = ev.keyCode;
    const isBlockedKey =
      key === monacoApi.KeyCode.LeftArrow ||
      key === monacoApi.KeyCode.RightArrow ||
      key === monacoApi.KeyCode.Delete ||
      key === monacoApi.KeyCode.Home ||
      key === monacoApi.KeyCode.End;
    if (!isBlockedKey) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
  });
}
