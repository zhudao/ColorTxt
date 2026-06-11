import type * as monaco from "monaco-editor";
import { Emitter } from "monaco-editor";
import { chapterTitleForDisplay } from "../chapter";

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
 * 禁止点击粘性章节条触发 Monaco 内部跳转（全局一次注入即可）。
 */
export function ensureStickyChapterBarClickDisabled(): void {
  if (document.getElementById(STICKY_NO_CLICK_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STICKY_NO_CLICK_STYLE_ID;
  el.textContent = `
.monaco-editor .sticky-widget {
  pointer-events: none !important;
  background-color: var(--reader-bg) !important;
}
/* 子区域仍用 VS Code 变量；编辑器背景透明后需与阅读区底色一致，避免透出正文 */
.monaco-editor .sticky-widget .sticky-widget-line-numbers {
  background-color: var(--reader-bg) !important;
}
.monaco-editor .sticky-widget .sticky-widget-lines-scrollable {
  background-color: var(--reader-bg) !important;
}
.monaco-editor .sticky-widget .sticky-line-content:hover {
  background-color: var(--reader-bg) !important;
}
.monaco-editor .sticky-widget .sticky-line-content {
  color: var(--reader-chapter-title) !important;
}
`;
  document.head.appendChild(el);
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
  });
}
