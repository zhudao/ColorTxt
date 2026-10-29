import type * as monaco from "monaco-editor";
import { Emitter, editor as monacoEditor } from "monaco-editor";
import { chapterTitleForDisplay } from "../chapter";
import { scheduleReaderBackgroundStickyAlign } from "../constants/readerBackground";

/** 与 `setChapters` / 粘性滚动大纲一致的单条章节信息 */
export type ChapterStickyLine = {
  title: string;
  lineNumber: number;
  /** 1 = 顶栏；子级递增（嵌入目录 level+1 / Markdown `#` 数） */
  headingLevel?: number;
  /** 嵌入目录顺序；粘性大纲按此构建层级，勿按展示行号排序 */
  tocOrder?: number;
};

/** 正文里章节标题行的装饰 class，需与样式中的选择器一致 */
export const CHAPTER_TITLE_LINE_CLASS = "chapterTitleLine";

const STICKY_NO_CLICK_STYLE_ID = "txtr-monaco-sticky-chapter-no-click";

/**
 * 禁止点击阅读器粘性章节条触发 Monaco 内部跳转。
 * 选择器须限定在 `.readerPane`（ReaderMain），避免波及书源全屏 Monaco 等其它实例。
 */
export function ensureStickyChapterBarClickDisabled(): void {
  let el = document.getElementById(
    STICKY_NO_CLICK_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STICKY_NO_CLICK_STYLE_ID;
    document.head.appendChild(el);
  }
  // 始终写入：热更新或旧版全局选择器残留时可被纠正
  el.textContent = `
.readerPane .monaco-editor .sticky-widget {
  pointer-events: none !important;
  isolation: isolate;
  overflow: hidden;
  background-color: var(--reader-bg) !important;
  box-shadow: none !important;
}
/* 容器透明，透出条上的底色 + 纹理；行必须实心，否则 Monaco 末行上滑会叠进父级标题 */
.readerPane .monaco-editor .sticky-widget .sticky-widget-line-numbers,
.readerPane .monaco-editor .sticky-widget .sticky-widget-lines-scrollable {
  background-color: transparent !important;
}
.readerPane .monaco-editor .sticky-widget .sticky-line-content,
.readerPane .monaco-editor .sticky-widget .sticky-line-content:hover,
.readerPane .monaco-editor .sticky-widget .sticky-line-number {
  overflow: hidden;
  isolation: isolate;
  background-color: var(--reader-bg) !important;
}
/* 勿改 position：Monaco 用 absolute + top 叠多层标题，relative 会把 top 变成流内偏移 */
.readerPane .monaco-editor .sticky-widget .sticky-line-content {
  color: var(--reader-chapter-title) !important;
}
`;
}

/** 当前覆盖正文的 Monaco 粘性章节条高度。 */
export function getStickyChapterScrollHeight(
  editor: monaco.editor.ICodeEditor,
): number {
  const widget = editor
    .getDomNode()
    ?.querySelector<HTMLElement>(".sticky-widget");
  return widget?.clientHeight ?? 0;
}

export type ChapterStickyScrollProvidersHandle = {
  disposable: monaco.IDisposable;
  /**
   * 章节行号已更新但模型未发生内容变更时调用（如「刷新章节」仅重算行号），
   * 触发文档符号失效，使粘性条按 `getChapters` 重新拉取大纲范围。
   */
  notifyChapterFoldingRangesChanged: () => void;
};

function chaptersInModel(
  getChapters: () => ChapterStickyLine[],
  maxLine: number,
): ChapterStickyLine[] {
  return getChapters().filter(
    (c) => c.lineNumber >= 1 && c.lineNumber <= maxLine,
  );
}

/** 嵌入目录顺序（无 tocOrder 时回退展示行号） */
function sortChaptersByTocOrder(
  chapters: readonly ChapterStickyLine[],
): ChapterStickyLine[] {
  return chapters
    .slice()
    .sort(
      (a, b) =>
        (a.tocOrder ?? a.lineNumber) - (b.tocOrder ?? b.lineNumber) ||
        a.lineNumber - b.lineNumber,
    );
}

/** 目录序中下一同级或上级章节的展示行（用于区间右边界） */
function rangeEndLineForTocIndex(
  sorted: readonly ChapterStickyLine[],
  index: number,
  maxLine: number,
): number {
  const curLevel = Math.max(1, Math.floor(sorted[index]!.headingLevel ?? 1));
  for (let j = index + 1; j < sorted.length; j++) {
    const nextLevel = Math.max(1, Math.floor(sorted[j]!.headingLevel ?? 1));
    if (nextLevel <= curLevel) {
      return Math.max(
        sorted[index]!.lineNumber,
        Math.min(maxLine, sorted[j]!.lineNumber - 1),
      );
    }
  }
  return maxLine;
}

/** Monaco 只为至少跨三行的 DocumentSymbol 创建 sticky candidate。 */
function isMonacoStickyCandidateRange(start: number, end: number): boolean {
  return end > start + 1;
}

/**
 * `lineNumber` 成为章节条下方第一行时，预测会保持粘性的章节层数。
 * 范围边界与 `buildChapterDocumentSymbols` 一致，并对齐 Monaco 的 candidate 规则。
 */
function countStickyChapterRowsForLine(
  chapters: readonly ChapterStickyLine[],
  lineNumber: number,
  maxLine: number,
): number {
  const sorted = sortChaptersByTocOrder(
    chapters.filter((c) => c.lineNumber >= 1 && c.lineNumber <= maxLine),
  );
  let rows = 0;
  const countedStartLines = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!.lineNumber;
    if (start >= lineNumber || countedStartLines.has(start)) continue;
    const end = rangeEndLineForTocIndex(sorted, i, maxLine);
    if (isMonacoStickyCandidateRange(start, end) && lineNumber <= end) {
      countedStartLines.add(start);
      rows++;
    }
  }
  return rows;
}

/**
 * 预测指定行成为正文首行时，Monaco 粘性章节条的稳定高度。
 * 可能与真实 DOM 差一行；翻页后应用 `getStickyChapterScrollHeight` 再校正。
 */
export function predictStickyChapterScrollHeight(
  editor: monaco.editor.ICodeEditor,
  chapters: readonly ChapterStickyLine[],
  lineNumber: number,
): number {
  const stickyOption = editor.getOption(
    monacoEditor.EditorOption.stickyScroll,
  );
  if (!stickyOption.enabled) return 0;

  const maxLine = editor.getModel()?.getLineCount() ?? 0;
  if (maxLine < 1) return 0;

  const lineHeight = Math.max(
    1,
    editor.getOption(monacoEditor.EditorOption.lineHeight),
  );
  const viewportHeight = Math.max(1, editor.getLayoutInfo().height);
  const rows = countStickyChapterRowsForLine(chapters, lineNumber, maxLine);
  // Monaco 将 sticky 行数限制为 maxLineCount 与视口行数约 25% 的较小值。
  const maxRows = Math.min(
    stickyOption.maxLineCount,
    Math.round((viewportHeight / lineHeight) * 0.25),
  );
  return Math.min(rows, Math.max(0, maxRows)) * lineHeight;
}

function buildChapterDocumentSymbols(
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  chapters: readonly ChapterStickyLine[],
): monaco.languages.DocumentSymbol[] {
  const max = model.getLineCount();
  const sorted = sortChaptersByTocOrder(chapters);
  const roots: monaco.languages.DocumentSymbol[] = [];
  const stack: { level: number; symbol: monaco.languages.DocumentSymbol }[] =
    [];

  for (let i = 0; i < sorted.length; i++) {
    const ch = sorted[i]!;
    const start = ch.lineNumber;
    const end = rangeEndLineForTocIndex(sorted, i, max);
    const range = new monacoApi.Range(
      start,
      1,
      end,
      model.getLineMaxColumn(end),
    );
    const selectionRange = new monacoApi.Range(
      start,
      1,
      start,
      model.getLineMaxColumn(start),
    );
    const name =
      chapterTitleForDisplay(ch.title) ||
      chapterTitleForDisplay(model.getLineContent(start)) ||
      `第 ${start} 行`;
    const symbol: monaco.languages.DocumentSymbol = {
      name,
      detail: "",
      kind: monacoApi.languages.SymbolKind.Namespace,
      range,
      selectionRange,
      tags: [],
      children: [],
    };

    const level = Math.max(1, Math.floor(ch.headingLevel ?? 1));
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(symbol);
    } else {
      stack[stack.length - 1]!.symbol.children!.push(symbol);
    }
    stack.push({ level, symbol });
  }

  return roots;
}

/**
 * 注册文档符号供粘性滚动（outlineModel）使用；不注册折叠区，避免章节标题旁出现可点击折叠把手。
 * `getChapters` 应在每次 `setChapters` 后返回最新快照。
 */
export function registerChapterStickyScrollProviders(
  monacoApi: typeof monaco,
  languageId: string,
  getChapters: () => ChapterStickyLine[],
): ChapterStickyScrollProvidersHandle {
  const disposables: monaco.IDisposable[] = [];
  const documentSymbolsChanged =
    new Emitter<monaco.languages.DocumentSymbolProvider>();

  const documentSymbolProvider = {
    onDidChange: documentSymbolsChanged.event,
    provideDocumentSymbols(model: monaco.editor.ITextModel) {
      return buildChapterDocumentSymbols(
        monacoApi,
        model,
        chaptersInModel(getChapters, model.getLineCount()),
      );
    },
  };

  disposables.push(
    monacoApi.languages.registerDocumentSymbolProvider(
      languageId,
      documentSymbolProvider,
    ),
  );

  disposables.push({ dispose: () => documentSymbolsChanged.dispose() });

  const notifyChapterOutlineChanged = () => {
    documentSymbolsChanged.fire(documentSymbolProvider);
  };

  return {
    disposable: {
      dispose() {
        for (const d of disposables) d.dispose();
      },
    },
    notifyChapterFoldingRangesChanged: notifyChapterOutlineChanged,
  };
}

/**
 * 大纲/行内装饰更新后，Monaco 粘性条未必重绘；关开一次以套用章节标题样式。
 * 调用方须在 `notifyChapterFoldingRangesChanged` 之后、且 `stickyScroll` 应为开启时调用。
 */
export function refreshStickyChapterScrollWidget(
  editor: monaco.editor.ICodeEditor,
): void {
  const scrollTop = editor.getScrollTop();
  editor.updateOptions({ stickyScroll: { enabled: false } });
  requestAnimationFrame(() => {
    editor.updateOptions({ stickyScroll: { enabled: true } });
    if (editor.getScrollTop() !== scrollTop) {
      editor.setScrollTop(scrollTop);
    }
    scheduleReaderBackgroundStickyAlign();
    requestAnimationFrame(() => scheduleReaderBackgroundStickyAlign());
  });
}

// HMR / 旧版全局选择器残留：模块加载时若已注入样式则立即纠正
if (
  typeof document !== "undefined" &&
  document.getElementById(STICKY_NO_CLICK_STYLE_ID)
) {
  ensureStickyChapterBarClickDisabled();
}
