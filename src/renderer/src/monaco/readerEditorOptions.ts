import type { editor } from "monaco-editor";
import { getPresetCssStack } from "../utils/presetFontDefinitions";

/** `editor.updateOptions` 可写的编辑器选项子集（含 `IGlobalEditorOptions` 如 `wordBasedSuggestions`） */
export type ReaderMonacoConfigurableOptions = editor.IEditorOptions &
  editor.IGlobalEditorOptions;

/**
 * 关闭 Monaco Unicode 高亮及「Disable … Highlight」类横幅（中文等非 ASCII 正文常见）。
 * 对应 VS Code 文档中的 Unicode highlighting 各子项（nonBasicASCII / ambiguousCharacters / invisibleCharacters 等）。
 */
export const READER_UNICODE_HIGHLIGHT_DISABLED: editor.IUnicodeHighlightOptions =
  {
    nonBasicASCII: false,
    ambiguousCharacters: false,
    invisibleCharacters: false,
    includeComments: false,
    includeStrings: false,
  };

/** 阅读器 Monaco 初始字号（与 App 持久化同步前） */
export const READER_EDITOR_DEFAULT_FONT_SIZE = 14;

/** 阅读器 Monaco 初始字体栈（与 FontPicker「京華老宋体」预设一致） */
export const READER_EDITOR_DEFAULT_FONT_FAMILY = getPresetCssStack("kinghwa");

export const READER_EDITOR_PADDING = { top: 10, bottom: 10 } as const;

/** 垂直滚动条常显（Monaco 默认 `auto` 会在失焦后淡出） */
const READER_SCROLLBAR_VERTICAL_VISIBLE = {
  vertical: "visible" as const,
};

/**
 * 全屏只读：`auto` 失焦淡出；窗口只读与任意编辑：`visible` 常显。
 */
export function buildReaderVerticalScrollbarVisibility(
  editMode: boolean,
  fullscreen: boolean,
): "auto" | "visible" {
  if (!editMode && fullscreen) return "auto";
  return "visible";
}

/** 全屏只读不绘概览尺左边线；其余由 Monaco Canvas 绘制（细线） */
export function buildReaderOverviewRulerBorder(
  editMode: boolean,
  fullscreen: boolean,
): boolean {
  if (!editMode && fullscreen) return false;
  return true;
}

function withReaderVerticalScrollbar(
  scrollbar: ReaderMonacoConfigurableOptions["scrollbar"] | undefined,
  editMode: boolean,
  fullscreen: boolean,
): NonNullable<ReaderMonacoConfigurableOptions["scrollbar"]> {
  return {
    ...scrollbar,
    vertical: buildReaderVerticalScrollbarVisibility(editMode, fullscreen),
  };
}

export function readerEditorLineHeight(
  fontSize: number,
  lineHeightMultiple: number,
): number {
  return Math.max(1, Math.round(fontSize * lineHeightMultiple));
}

export type ReaderEditorCreateOptionsInput = {
  fontSize: number;
  lineHeightMultiple: number;
  fontFamily: string;
  /** 默认 `vs`（与 App 亮色主题一致） */
  theme?: string;
  /** Monaco `wrappingStrategy`：advanced 换行更优但更重 */
  wrappingStrategyAdvanced?: boolean;
  /** Monaco `smoothScrolling`；与设置「平滑滚动」一致 */
  smoothScrolling?: boolean;
};

/**
 * 只读 / 编辑共用：字号、行高、字体、换行策略、平滑滚动、主题、行号与缩略图策略等。
 * 与「阅读器配色」相关的视觉由 `ensureReaderSyntaxThemes` + `--reader-bg` 承担，此处不区分模式。
 */
export function buildReaderEditorSharedCoreOptions(
  input: ReaderEditorCreateOptionsInput,
): Pick<
  editor.IStandaloneEditorConstructionOptions,
  | "theme"
  | "fontSize"
  | "lineHeight"
  | "fontFamily"
  | "automaticLayout"
  | "smoothScrolling"
  | "wrappingStrategy"
  | "stickyScroll"
  | "lineNumbers"
  | "lineNumbersMinChars"
  | "glyphMargin"
  | "minimap"
  | "find"
  | "unusualLineTerminators"
  | "renderControlCharacters"
  | "fixedOverflowWidgets"
  | "hover"
  | "maxTokenizationLineLength"
  | "stopRenderingLineAfter"
> {
  const {
    fontSize,
    lineHeightMultiple,
    fontFamily,
    theme = "vs",
    wrappingStrategyAdvanced = false,
    smoothScrolling = true,
  } = input;

  return {
    theme,
    fontSize,
    lineHeight: readerEditorLineHeight(fontSize, lineHeightMultiple),
    fontFamily,
    automaticLayout: true,
    smoothScrolling,
    wrappingStrategy: wrappingStrategyAdvanced ? "advanced" : "simple",
    stickyScroll: { enabled: true, defaultModel: "outlineModel" },
    lineNumbers: "off",
    lineNumbersMinChars: 0,
    glyphMargin: false,
    minimap: { enabled: false },
    find: {
      seedSearchStringFromSelection: "selection",
    },
    /** 不提示 NEL/LS/PS 等非常规换行，避免编辑小说时弹层干扰 */
    unusualLineTerminators: "off",
    /** 默认 true 会对控制字符做特殊绘制；纯文本阅读/编辑关闭 */
    renderControlCharacters: false,
    /** 悬停/补全等内容挂件用视口 fixed 定位，避免被阅读区 overflow:hidden 裁切 */
    fixedOverflowWidgets: true,
    /** 长脚注悬停：可移入面板滚动阅读（Monaco 内建 sticky + 按需滚动条） */
    hover: {
      enabled: true,
      sticky: true,
      hidingDelay: 800,
    },
    /** 默认 20000 超长行不解析且 hover 提示配置项；小说段落可能超阈值 */
    maxTokenizationLineLength: 1_000_000,
    /** 默认 10000 后停止渲染且 hover 提示；`-1` 为不截断 */
    stopRenderingLineAfter: -1,
  };
}

/**
 * 仅只读模式：弱化编辑器 chrome、隐藏横向滚动条、关闭补全链路等，优化长文阅读。
 */
export function buildReaderEditorReadOnlyModeChromeOptions(): ReaderMonacoConfigurableOptions {
  return {
    /** 阅读器不用代码折叠；章节粘性条走 DocumentSymbolProvider（outlineModel） */
    folding: false,
    showFoldingControls: "never",
    scrollbar: {
      horizontal: "hidden",
    },
    guides: {
      indentation: false,
      highlightActiveIndentation: false,
    },
    scrollBeyondLastLine: false,
    occurrencesHighlight: "off",
    selectionHighlight: false,
    unicodeHighlight: { ...READER_UNICODE_HIGHLIGHT_DISABLED },
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    wordBasedSuggestions: "off",
    wordWrap: "on",
    contextmenu: false,
    links: true,
    padding: {
      top: READER_EDITOR_PADDING.top,
      bottom: READER_EDITOR_PADDING.bottom,
    },
  } satisfies ReaderMonacoConfigurableOptions;
}

/**
 * 编辑模式：保留光标、选区、缩进参考线等书写体验；关闭代码补全/行内建议（纯文本小说编辑不需要）。
 * 字体、字号、行号列、minimap、主题仍由 {@link buildReaderEditorSharedCoreOptions} 与配色管线统一控制。
 */
export function buildReaderEditorEditModeNativeChromeOptions(): ReaderMonacoConfigurableOptions {
  return {
    folding: false,
    showFoldingControls: "never",
    scrollbar: {
      horizontal: "auto",
      useShadows: true,
      ...READER_SCROLLBAR_VERTICAL_VISIBLE,
    },
    guides: {
      indentation: true,
      highlightActiveIndentation: true,
    },
    scrollBeyondLastLine: true,
    occurrencesHighlight: "singleFile",
    selectionHighlight: true,
    unicodeHighlight: { ...READER_UNICODE_HIGHLIGHT_DISABLED },
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    wordBasedSuggestions: "off",
    inlineSuggest: { enabled: false },
    tabCompletion: "off",
    wordWrap: "on",
    contextmenu: true,
    links: true,
    padding: { top: 0, bottom: 0 },
  } satisfies ReaderMonacoConfigurableOptions;
}

/** 只读：不可编辑 + 弱化光标/当前行高亮（与历史行为一致） */
export function buildReaderEditorReadOnlyInteractionOptions(): Pick<
  editor.IEditorOptions,
  | "readOnly"
  | "domReadOnly"
  | "readOnlyMessage"
  | "cursorBlinking"
  | "cursorWidth"
  | "renderLineHighlight"
  | "hideCursorInOverviewRuler"
> {
  return {
    readOnly: true,
    domReadOnly: true,
    readOnlyMessage: { value: "" },
    cursorBlinking: "solid",
    cursorWidth: 0,
    renderLineHighlight: "none",
    hideCursorInOverviewRuler: true,
  };
}

/** 可编辑：正常光标与当前行高亮 */
export function buildReaderEditorEditableInteractionOptions(): Pick<
  editor.IEditorOptions,
  | "readOnly"
  | "domReadOnly"
  | "cursorBlinking"
  | "cursorWidth"
  | "renderLineHighlight"
  | "hideCursorInOverviewRuler"
> {
  return {
    readOnly: false,
    domReadOnly: false,
    cursorBlinking: "blink",
    cursorWidth: 2,
    renderLineHighlight: "line",
    hideCursorInOverviewRuler: false,
  };
}

/**
 * 按当前是否编辑模式，合并「交互（只读/可写）」与「模式专属 chrome」。
 * 调用方在切换阅读/编辑或创建编辑器后应执行一次 `editor.updateOptions(...)`。
 */
export function buildReaderEditModeLineNumberOptions(
  showLineNumbers: boolean,
): Pick<editor.IEditorOptions, "lineNumbers" | "lineNumbersMinChars"> {
  return showLineNumbers
    ? { lineNumbers: "on", lineNumbersMinChars: 3 }
    : { lineNumbers: "off", lineNumbersMinChars: 0 };
}

export function buildReaderEditModeMinimapOptions(
  enabled: boolean,
): Pick<editor.IEditorOptions, "minimap"> {
  if (!enabled) {
    return { minimap: { enabled: false } };
  }
  return {
    minimap: {
      enabled: true,
      showSlider: "always",
      /** 按字符渲染语法色（非色块），与 VS Code 一致 */
      renderCharacters: true,
      side: "right",
      /** 章节名由 `buildChapterMinimapSectionHeaderDecorations` 提供，关闭自动探测避免重复 */
      showRegionSectionHeaders: false,
      showMarkSectionHeaders: false,
      sectionHeaderFontSize: 9,
    },
  };
}

export function buildReaderMonacoModeEditorOptions(
  editMode: boolean,
  editShowLineNumbers = false,
  editMinimap = false,
  fullscreen = false,
): ReaderMonacoConfigurableOptions {
  const lineNumberOptions = buildReaderEditModeLineNumberOptions(
    editMode && editShowLineNumbers,
  );
  const minimapOptions = buildReaderEditModeMinimapOptions(
    editMode && editMinimap,
  );
  if (editMode) {
    const mode = buildReaderEditorEditModeNativeChromeOptions();
    return {
      ...mode,
      ...buildReaderEditorEditableInteractionOptions(),
      ...lineNumberOptions,
      ...minimapOptions,
      scrollbar: withReaderVerticalScrollbar(mode.scrollbar, true, fullscreen),
      overviewRulerBorder: buildReaderOverviewRulerBorder(true, fullscreen),
    };
  }
  const mode = buildReaderEditorReadOnlyModeChromeOptions();
  return {
    ...mode,
    ...buildReaderEditorReadOnlyInteractionOptions(),
    ...lineNumberOptions,
    ...minimapOptions,
    scrollbar: withReaderVerticalScrollbar(mode.scrollbar, false, fullscreen),
    overviewRulerBorder: buildReaderOverviewRulerBorder(false, fullscreen),
  };
}

/**
 * `monaco.editor.create` 的阅读器专用选项（不含 `model`，由调用方传入）。
 * 初始为只读模式；进入编辑后由 {@link buildReaderMonacoModeEditorOptions} 切换。
 */
export function buildReaderEditorCreateOptions(
  input: ReaderEditorCreateOptionsInput,
): editor.IStandaloneEditorConstructionOptions {
  return {
    ...buildReaderEditorSharedCoreOptions(input),
    ...buildReaderEditorReadOnlyModeChromeOptions(),
    ...buildReaderEditorReadOnlyInteractionOptions(),
  } satisfies editor.IStandaloneEditorConstructionOptions;
}

/** 与 `setFontSize` 同步：更新字号与派生行高 */
export function buildReaderEditorFontSizeUpdate(input: {
  fontSize: number;
  lineHeightMultiple: number;
}): Pick<editor.IEditorOptions, "fontSize" | "lineHeight"> {
  return {
    fontSize: input.fontSize,
    lineHeight: readerEditorLineHeight(
      input.fontSize,
      input.lineHeightMultiple,
    ),
  };
}

/** 与 `setLineHeightMultiple` 同步：仅更新行高 */
export function buildReaderEditorLineHeightUpdate(input: {
  fontSize: number;
  lineHeightMultiple: number;
}): Pick<editor.IEditorOptions, "lineHeight"> {
  return {
    lineHeight: readerEditorLineHeight(
      input.fontSize,
      input.lineHeightMultiple,
    ),
  };
}
