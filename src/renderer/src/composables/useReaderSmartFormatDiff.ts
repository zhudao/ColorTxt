import {
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  nextTick,
  type Ref,
} from "vue";
import * as monaco from "monaco-editor";
import type { SmartFormatReviewSession } from "../aiSmartFormat/aiSmartFormatReviewTypes";
import {
  buildReaderDiffEditorCreateOptions,
  buildReaderDiffSideEditorOptions,
} from "../monaco/readerDiffEditorOptions";
import {
  buildReaderEditorFontSizeUpdate,
  type ReaderEditorCreateOptionsInput,
} from "../monaco/readerEditorOptions";
import { disableLineSpacingOnMonacoCodeEditor } from "../monaco/lineSpacing";
import { readerMonacoThemeForAppTheme } from "../monaco/readerInlineDecorations";
import {
  enhanceSmartFormatDiffRevertButtons,
  installSmartFormatDiffRevertUi,
} from "../aiSmartFormat/smartFormatDiffRevertUi";

const TXTR_LANGUAGE_ID = "txtr-text";

function waitForLayout(host: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const tryLayout = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width > 0 && height > 0) {
        resolve();
        return;
      }
      requestAnimationFrame(tryLayout);
    };
    requestAnimationFrame(tryLayout);
  });
}

export type SmartFormatDiffContextMenuRequest = {
  side: "original" | "modified";
  x: number;
  y: number;
  hasSelection: boolean;
};

export function useReaderSmartFormatDiff(deps: {
  diffHostEl: Ref<HTMLDivElement | null>;
  session: () => SmartFormatReviewSession | null | undefined;
  getCreateOptionsInput: () => ReaderEditorCreateOptionsInput;
  onContextMenuRequest?: (request: SmartFormatDiffContextMenuRequest) => void;
  /** Diff 左右侧编辑器光标/选区/聚焦变化时回调（用于底栏行列号） */
  onDiffEditorCursorActivity?: (editor: monaco.editor.ICodeEditor) => void;
}) {
  const diffEditor = shallowRef<monaco.editor.IStandaloneDiffEditor | null>(
    null,
  );
  const changeCount = ref(0);
  const showWhitespaceDiff = ref(false);
  const hideUnchangedRegionsEnabled = ref(false);
  let originalModel: monaco.editor.ITextModel | null = null;
  let modifiedModel: monaco.editor.ITextModel | null = null;
  let diffUpdateDisposable: monaco.IDisposable | null = null;
  let modifiedContentDisposable: monaco.IDisposable | null = null;
  let uninstallRevertUi: (() => void) | null = null;
  let diffContextMenuDisposables: monaco.IDisposable[] = [];
  let diffCursorDisposables: monaco.IDisposable[] = [];
  let diffMarginRepairDisposable: monaco.IDisposable | null = null;

  function disposeDiffEditor() {
    diffUpdateDisposable?.dispose();
    diffUpdateDisposable = null;
    modifiedContentDisposable?.dispose();
    modifiedContentDisposable = null;
    uninstallRevertUi?.();
    uninstallRevertUi = null;
    for (const d of diffContextMenuDisposables) d.dispose();
    diffContextMenuDisposables = [];
    for (const d of diffCursorDisposables) d.dispose();
    diffCursorDisposables = [];
    diffMarginRepairDisposable?.dispose();
    diffMarginRepairDisposable = null;
    diffEditor.value?.dispose();
    diffEditor.value = null;
    originalModel?.dispose();
    originalModel = null;
    modifiedModel?.dispose();
    modifiedModel = null;
    changeCount.value = 0;
    showWhitespaceDiff.value = false;
    hideUnchangedRegionsEnabled.value = false;
  }

  function refreshChangeCount() {
    changeCount.value = diffEditor.value?.getLineChanges()?.length ?? 0;
  }

  function applyDiffSideChrome(editor: monaco.editor.IStandaloneDiffEditor) {
    const diffSideChrome = buildReaderDiffSideEditorOptions();
    editor.getOriginalEditor().updateOptions({
      ...diffSideChrome,
      readOnly: true,
      domReadOnly: true,
      cursorBlinking: "solid",
      cursorWidth: 0,
      renderLineHighlight: "none",
    });
    editor.getModifiedEditor().updateOptions({
      ...diffSideChrome,
      readOnly: false,
      domReadOnly: false,
    });
  }

  /** Monaco 在切换折叠/空白 diff 后常滞留加宽的装饰列，强制重算左右 margin */
  function repairDiffEditorSideMargins(editor: monaco.editor.IStandaloneDiffEditor) {
    const pulse = { glyphMargin: false, lineDecorationsWidth: 0 };
    editor.getOriginalEditor().updateOptions(pulse);
    editor.getModifiedEditor().updateOptions(pulse);
    editor.layout();
    applyDiffSideChrome(editor);
    editor.layout();
    editor.getOriginalEditor().layout();
    editor.getModifiedEditor().layout();
  }

  function scheduleRepairDiffEditorSideMargins() {
    const editor = diffEditor.value;
    if (!editor) return;
    const run = () => repairDiffEditorSideMargins(editor);
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
    diffMarginRepairDisposable?.dispose();
    diffMarginRepairDisposable = editor.onDidUpdateDiff(() => {
      diffMarginRepairDisposable?.dispose();
      diffMarginRepairDisposable = null;
      run();
    });
  }

  function triggerDiffEditorCommand(commandId: string) {
    const editor = diffEditor.value;
    if (!editor) return;
    for (const ed of [
      editor.getOriginalEditor(),
      editor.getModifiedEditor(),
    ]) {
      ed.trigger("smartFormatReview", commandId, null);
    }
  }

  /** 与主阅读器 setFontSize / setLineHeightMultiple / setFontFamily 同步排版 */
  function syncDiffEditorTypography() {
    const editor = diffEditor.value;
    if (!editor) return;
    const input = deps.getCreateOptionsInput();
    const typography = {
      ...buildReaderEditorFontSizeUpdate({
        fontSize: input.fontSize,
        lineHeightMultiple: input.lineHeightMultiple,
      }),
      letterSpacing: input.letterSpacingPx ?? 0,
      fontFamily: input.fontFamily,
    };
    editor.getOriginalEditor().updateOptions(typography);
    editor.getModifiedEditor().updateOptions(typography);
    editor.layout();
  }

  function goToPreviousDiff() {
    diffEditor.value?.goToDiff("previous");
  }

  function goToNextDiff() {
    diffEditor.value?.goToDiff("next");
  }

  function toggleShowWhitespaceDiff() {
    const editor = diffEditor.value;
    if (!editor) return;
    showWhitespaceDiff.value = !showWhitespaceDiff.value;
    editor.updateOptions({
      ignoreTrimWhitespace: !showWhitespaceDiff.value,
    });
    scheduleRepairDiffEditorSideMargins();
  }

  function toggleHideUnchangedRegions() {
    const editor = diffEditor.value;
    if (!editor) return;
    hideUnchangedRegionsEnabled.value = !hideUnchangedRegionsEnabled.value;
    editor.updateOptions({
      hideUnchangedRegions: {
        enabled: hideUnchangedRegionsEnabled.value,
        revealLineCount: 20,
        minimumLineCount: 3,
        contextLineCount: 3,
      },
    });
    if (!hideUnchangedRegionsEnabled.value) {
      triggerDiffEditorCommand("diffEditor.showAllUnchangedRegions");
      scheduleRepairDiffEditorSideMargins();
    }
  }

  async function mountDiffEditor(session: SmartFormatReviewSession) {
    disposeDiffEditor();
    await nextTick();

    const host = deps.diffHostEl.value;
    if (!host) return;

    await waitForLayout(host);

    const input = deps.getCreateOptionsInput();
    monaco.editor.setTheme(
      readerMonacoThemeForAppTheme(input.theme ?? "vs"),
    );

    const editor = monaco.editor.createDiffEditor(
      host,
      buildReaderDiffEditorCreateOptions(input),
    );

    originalModel = monaco.editor.createModel(
      session.originalText,
      TXTR_LANGUAGE_ID,
    );
    modifiedModel = monaco.editor.createModel(
      session.proposedText,
      TXTR_LANGUAGE_ID,
    );
    editor.setModel({ original: originalModel, modified: modifiedModel });

    /** 段间距是布局层全局默认值；Diff 两侧单独覆盖为 0，避免左右垂直对齐错位 */
    const pinDiffLineSpacingOff = () => {
      disableLineSpacingOnMonacoCodeEditor(editor.getOriginalEditor());
      disableLineSpacingOnMonacoCodeEditor(editor.getModifiedEditor());
    };
    pinDiffLineSpacingOff();
    requestAnimationFrame(pinDiffLineSpacingOff);

    applyDiffSideChrome(editor);

    diffEditor.value = editor;
    refreshChangeCount();
    diffUpdateDisposable = editor.onDidUpdateDiff(() => {
      refreshChangeCount();
      if (host) enhanceSmartFormatDiffRevertButtons(host);
    });
    modifiedContentDisposable = modifiedModel.onDidChangeContent(() => {
      requestAnimationFrame(() => refreshChangeCount());
    });
    uninstallRevertUi = installSmartFormatDiffRevertUi(host);

    if (deps.onContextMenuRequest) {
      const openMenu = (
        side: SmartFormatDiffContextMenuRequest["side"],
        ed: monaco.editor.ICodeEditor,
        mouseEv: monaco.editor.IEditorMouseEvent,
      ) => {
        mouseEv.event.preventDefault();
        mouseEv.event.stopPropagation();
        const sel = ed.getSelection();
        deps.onContextMenuRequest?.({
          side,
          x: mouseEv.event.browserEvent.clientX,
          y: mouseEv.event.browserEvent.clientY,
          hasSelection: Boolean(sel && !sel.isEmpty()),
        });
      };
      diffContextMenuDisposables = [
        editor
          .getOriginalEditor()
          .onContextMenu((ev) => openMenu("original", editor.getOriginalEditor(), ev)),
        editor
          .getModifiedEditor()
          .onContextMenu((ev) => openMenu("modified", editor.getModifiedEditor(), ev)),
      ];
    }

    if (deps.onDiffEditorCursorActivity) {
      const wireCursor = (ed: monaco.editor.ICodeEditor) => {
        const emit = () => deps.onDiffEditorCursorActivity?.(ed);
        return [
          ed.onDidChangeCursorPosition(emit),
          ed.onDidChangeCursorSelection(emit),
          ed.onDidFocusEditorWidget(emit),
        ];
      };
      diffCursorDisposables = [
        ...wireCursor(editor.getOriginalEditor()),
        ...wireCursor(editor.getModifiedEditor()),
      ];
      deps.onDiffEditorCursorActivity(editor.getModifiedEditor());
    }

    editor.layout();
    requestAnimationFrame(() => editor.layout());
  }

  watch(
    () => deps.session(),
    (session) => {
      if (!session) {
        disposeDiffEditor();
        return;
      }
      void mountDiffEditor(session);
    },
    { flush: "post" },
  );

  onBeforeUnmount(() => {
    disposeDiffEditor();
  });

  return {
    diffEditor,
    changeCount,
    showWhitespaceDiff,
    hideUnchangedRegionsEnabled,
    disposeDiffEditor,
    layoutDiffEditor: () => diffEditor.value?.layout(),
    syncDiffEditorTypography,
    goToPreviousDiff,
    goToNextDiff,
    toggleShowWhitespaceDiff,
    toggleHideUnchangedRegions,
    getSmartFormatReviewModifiedText: (): string | null => {
      const m =
        modifiedModel ?? diffEditor.value?.getModifiedEditor().getModel();
      return m?.getValue() ?? null;
    },
  };
}
