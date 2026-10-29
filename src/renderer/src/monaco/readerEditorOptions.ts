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

/** 垂直滚动条由 Monaco 常显；全屏/极简只读的淡出走 CSS（随光标 `fullscreen--cursorHidden`） */
const READER_SCROLLBAR_VERTICAL_VISIBLE = {
  vertical: "visible" as const,
};

/** Monaco 概览尺左边线（与竖条同宽重叠）。全屏也曾关掉，以免 `auto` 淡出后剩一条线；现随光标一起藏，窗口/极简/全屏都绘。 */
export function buildReaderOverviewRulerBorder(
  _editMode: boolean,
  _fullscreen: boolean,
): boolean {
  return true;
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
  /** Monaco `letterSpacing`（px） */
  letterSpacingPx?: number;
  fontFamily: string;
  /**
   * 阅读器 Monaco 主题名（`txtr-reader` / `txtr-reader-dark`）。
   * 应用壳主题仍用 `vs` / `vs-dark`，须经 `readerMonacoThemeForAppTheme` 映射后再传入。
   */
  theme?: string;
  /** Monaco `wrappingStrategy`：advanced 换行更优但更重 */
  wrappingStrategyAdvanced?: boolean;
  /** Monaco `smoothScrolling`；与设置「平滑滚动」一致 */
  smoothScrolling?: boolean;
  /** Monaco `mouseWheelScrollSensitivity`；与设置「滚动倍率」一致 */
  mouseWheelScrollSensitivity?: number;
  /** Monaco `fastScrollSensitivity`；与设置「滚动加速倍率」一致 */
  fastScrollSensitivity?: number;
  /** Monaco `stickyScroll`；与设置「启用粘性章节标题」一致 */
  stickyChapterTitleEnabled?: boolean;
};

/**
 * 只读 / 编辑共用：字号、行间距、字体、换行策略、平滑滚动、主题、行号与缩略图策略等。
 * 与「阅读器配色」相关的视觉由 `ensureReaderSyntaxThemes` + `--reader-bg` 承担，此处不区分模式。
 */
export function buildReaderEditorSharedCoreOptions(
  input: ReaderEditorCreateOptionsInput,
): Pick<
  editor.IStandaloneEditorConstructionOptions,
  | "theme"
  | "fontSize"
  | "lineHeight"
  | "letterSpacing"
  | "fontFamily"
  | "automaticLayout"
  | "smoothScrolling"
  | "mouseWheelScrollSensitivity"
  | "fastScrollSensitivity"
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
  | "useShadowDOM"
  | "hover"
  | "maxTokenizationLineLength"
  | "stopRenderingLineAfter"
  | "largeFileOptimizations"
  | "disableMonospaceOptimizations"
  | "roundedSelection"
> {
  const {
    fontSize,
    lineHeightMultiple,
    letterSpacingPx = 0,
    fontFamily,
    theme = "txtr-reader",
    wrappingStrategyAdvanced = false,
    smoothScrolling = true,
    mouseWheelScrollSensitivity = 1,
    fastScrollSensitivity = 5,
    stickyChapterTitleEnabled = true,
  } = input;

  return {
    theme,
    fontSize,
    lineHeight: readerEditorLineHeight(fontSize, lineHeightMultiple),
    letterSpacing: letterSpacingPx,
    fontFamily,
    automaticLayout: true,
    smoothScrolling,
    mouseWheelScrollSensitivity,
    fastScrollSensitivity,
    wrappingStrategy: wrappingStrategyAdvanced ? "advanced" : "simple",
    stickyScroll: {
      enabled: stickyChapterTitleEnabled,
      defaultModel: "outlineModel",
    },
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
    /** 关闭 Shadow DOM，便于统一 context menu 等挂件样式；右键菜单由应用层接管 */
    useShadowDOM: false,
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
    /**
     * Monaco 默认 true：>30 万行或 >20MB 时 `isTooLargeForTokenization()`，
     * 会改用 ViewModelLinesFromModelAsIs（彻底关闭 viewport 换行）并跳过 sticky scroll。
     * 网文转载 txt 常一行一句，行数易超 30 万；关闭此项以换取正确排版（更慢、更占内存）。
     */
    largeFileOptimizations: false,
    /**
     * 纯 ASCII 行默认走 FastRenderedViewLine（`spaceWidth × 列`）。
     * 内嵌京華老宋体 `@font-face` 常被判成等宽，但拉丁字母实际非等宽，选区会左偏；
     * 行内有汉字则 isBasicASCII=false，改测 DOM，所以不歪。系统安装的同款字体
     * 往往因伪斜体/粗体字宽不一致而被判非等宽。阅读器一律关闭该优化。
     */
    disableMonospaceOptimizations: true,
    /**
     * 阅读器底色透明以透出纹理。圆角选区会在列重叠处铺 `.cslr` 再用底色抠内角，
     * 实心 `--reader-bg` 会盖住背景图，关掉圆角即可。
     */
    roundedSelection: false,
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
      ...READER_SCROLLBAR_VERTICAL_VISIBLE,
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
    /**
     * 默认 `alt` 会把 Alt 占成多光标。只读下改为 `ctrlCmd`，
     * 这样「先按住左键再按 Alt 拖」才是列选；先按 Alt 仍用于临时切点击模式。
     */
    multiCursorModifier: "ctrlCmd",
    padding: {
      top: READER_EDITOR_PADDING.top,
      bottom: READER_EDITOR_PADDING.bottom,
    },
  } satisfies ReaderMonacoConfigurableOptions;
}

/**
 * 编辑模式：保留光标、选区、缩进参考线等书写体验；关闭代码补全/行内建议与当前词高亮（纯文本小说编辑不需要）。
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
    /**
     * 当前词关掉：无空格中文会被当成整段词铺底。
     * 选区出现次数仍开：选中「杨过」时其它「杨过」有浅底（只读关，避免阅读干扰）。
     */
    occurrencesHighlight: "off",
    selectionHighlight: true,
    unicodeHighlight: { ...READER_UNICODE_HIGHLIGHT_DISABLED },
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    wordBasedSuggestions: "off",
    inlineSuggest: { enabled: false },
    tabCompletion: "off",
    wordWrap: "on",
    contextmenu: false,
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
  | "editContext"
  | "cursorBlinking"
  | "cursorWidth"
  | "renderLineHighlight"
  | "hideCursorInOverviewRuler"
> {
  return {
    readOnly: true,
    domReadOnly: true,
    readOnlyMessage: { value: "" },
    /**
     * Monaco 0.55 默认 `editContext: true`（Chromium EditContext）。
     * 只读时仍会开输入法：光标处出现空白合成框，且 `updateSelectionBounds`
     * 会把视口拽回光标。查找栏有独立 input，不受此项影响。
     */
    editContext: false,
    cursorBlinking: "solid",
    cursorWidth: 0,
    renderLineHighlight: "none",
    hideCursorInOverviewRuler: true,
  };
}

/** 可编辑：正常光标；当前行不高亮（与只读一致，避免整行铺底） */
export function buildReaderEditorEditableInteractionOptions(): Pick<
  editor.IEditorOptions,
  | "readOnly"
  | "domReadOnly"
  | "editContext"
  | "cursorBlinking"
  | "cursorWidth"
  | "renderLineHighlight"
  | "hideCursorInOverviewRuler"
> {
  return {
    readOnly: false,
    domReadOnly: false,
    editContext: true,
    cursorBlinking: "blink",
    cursorWidth: 2,
    renderLineHighlight: "none",
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
      overviewRulerBorder: buildReaderOverviewRulerBorder(true, fullscreen),
    };
  }
  const mode = buildReaderEditorReadOnlyModeChromeOptions();
  return {
    ...mode,
    ...buildReaderEditorReadOnlyInteractionOptions(),
    ...lineNumberOptions,
    ...minimapOptions,
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

/** 与 `setFontSize` 同步：更新字号与派生行间距（lineHeight） */
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

/** 与 `setLineHeightMultiple` 同步：仅更新行间距（lineHeight） */
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

/** 与 `setLetterSpacingPx` 同步：仅更新字间距 */
export function buildReaderEditorLetterSpacingUpdate(input: {
  letterSpacingPx: number;
}): Pick<editor.IEditorOptions, "letterSpacing"> {
  return {
    letterSpacing: input.letterSpacingPx,
  };
}
