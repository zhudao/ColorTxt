import type { editor } from "monaco-editor";
import {
  buildReaderEditorSharedCoreOptions,
  READER_EDITOR_PADDING,
  READER_UNICODE_HIGHLIGHT_DISABLED,
  type ReaderEditorCreateOptionsInput,
} from "./readerEditorOptions";

/** Diff 左右两侧编辑器须完全一致，避免行号列宽度错位 */
export function buildReaderDiffSideEditorOptions(): editor.IEditorOptions {
  return {
    glyphMargin: false,
    lineNumbers: "on",
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 10,
    wordWrap: "on",
    padding: { ...READER_EDITOR_PADDING },
    folding: false,
    guides: { indentation: false, highlightActiveIndentation: false },
    scrollBeyondLastLine: false,
    contextmenu: false,
    overviewRulerBorder: false,
    scrollbar: {
      horizontal: "auto",
      vertical: "auto",
      useShadows: true,
    },
    unicodeHighlight: { ...READER_UNICODE_HIGHLIGHT_DISABLED },
    renderControlCharacters: false,
    renderWhitespace: "none",
    find: {
      seedSearchStringFromSelection: "selection",
    },
    /** 查找栏挂件勿被 Diff 容器 overflow 裁切 */
    fixedOverflowWidgets: true,
  };
}

export function buildReaderDiffEditorCreateOptions(
  input: ReaderEditorCreateOptionsInput,
): editor.IStandaloneDiffEditorConstructionOptions {
  const shared = buildReaderEditorSharedCoreOptions(input);
  return {
    ...shared,
    stickyScroll: { enabled: false },
    renderSideBySide: true,
    /** 禁止窄容器自动切 inline（合并行号）；切回 side-by-side 时左侧行号列/换行会错位 */
    useInlineViewWhenSpaceIsLimited: false,
    originalEditable: false,
    renderMarginRevertIcon: true,
    renderIndicators: true,
    /** 忽略行首/行尾空白（含行首「　　」缩进），避免后置缩进干扰差异对比 */
    ignoreTrimWhitespace: true,
    automaticLayout: true,
    enableSplitViewResizing: true,
    renderOverviewRuler: true,
    diffCodeLens: false,
    wordWrap: "on",
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    lineNumbers: "on",
    lineNumbersMinChars: 3,
    glyphMargin: false,
    lineDecorationsWidth: 10,
    folding: false,
    padding: { ...READER_EDITOR_PADDING },
    guides: { indentation: false, highlightActiveIndentation: false },
    unicodeHighlight: { ...READER_UNICODE_HIGHLIGHT_DISABLED },
    renderControlCharacters: false,
    renderWhitespace: "none",
  };
}
