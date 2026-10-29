import type * as monaco from "monaco-editor";

function isFindWidgetTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".find-widget"));
}

function shouldBlockReadOnlyIme(
  monacoApi: typeof monaco,
  e: monaco.editor.IStandaloneCodeEditor,
  ev?: Event,
): boolean {
  if (!e.getOption(monacoApi.editor.EditorOption.readOnly)) return false;
  if (ev && isFindWidgetTarget(ev.target)) return false;
  if (isFindWidgetTarget(document.activeElement)) return false;
  return true;
}

/**
 * 只读阅读器：拦住输入法合成与插入。
 * Monaco 0.55 默认 EditContext 仍会开 IME（空白框），并把视口滚回光标；
 * 查找栏输入须放行。
 */
export function installReaderReadOnlyImeGuard(
  monacoApi: typeof monaco,
  e: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable {
  const root = e.getDomNode();
  if (!root) {
    return { dispose() {} };
  }

  const capture = true;
  const stopIfBlocked = (ev: Event) => {
    if (!shouldBlockReadOnlyIme(monacoApi, e, ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
  };

  root.addEventListener("beforeinput", stopIfBlocked, capture);
  root.addEventListener("compositionstart", stopIfBlocked, capture);
  root.addEventListener("compositionupdate", stopIfBlocked, capture);
  root.addEventListener("textInput", stopIfBlocked, capture);

  const keyDown = e.onKeyDown((ev) => {
    if (!shouldBlockReadOnlyIme(monacoApi, e, ev.browserEvent)) return;
    const be = ev.browserEvent;
    if (
      be.isComposing ||
      be.keyCode === 229 ||
      ev.keyCode === monacoApi.KeyCode.KEY_IN_COMPOSITION
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      be.preventDefault();
    }
  });

  return {
    dispose() {
      root.removeEventListener("beforeinput", stopIfBlocked, capture);
      root.removeEventListener("compositionstart", stopIfBlocked, capture);
      root.removeEventListener("compositionupdate", stopIfBlocked, capture);
      root.removeEventListener("textInput", stopIfBlocked, capture);
      keyDown.dispose();
    },
  };
}
