import type { ShallowRef } from "vue";
import * as monaco from "monaco-editor";
import { ensureSearchAnchorCursorInViewport } from "../reader/ensureSearchAnchorCursorInViewport";

type MatchShape = { lineNumber: number; startColumn: number; endColumn: number };

/**
 * 与 Monaco FindModel.MATCHES_LIMIT 对齐。
 * `findMatches` 默认仅 999 条：高亮词组全文匹配常超限，导致后文无装饰、且「下一处」回绕到文首。
 */
const INLINE_SEARCH_MATCHES_LIMIT = 19999;

export function useReaderInlineSearch(deps: {
  editor: ShallowRef<monaco.editor.IStandaloneCodeEditor | null>;
  model: ShallowRef<monaco.editor.ITextModel | null>;
  inlineSearchDecorationsCollection: ShallowRef<monaco.editor.IEditorDecorationsCollection | null>;
  beginProgrammaticScroll: () => void;
  monacoScrollType: (smooth: boolean) => monaco.editor.ScrollType;
  suppressHighlightTipForProgrammaticSelection: () => void;
}) {
  let inlineSearchQuery = "";
  let inlineSearchCaseSensitive = false;
  let inlineSearchWholeWord = false;
  let inlineSearchUseRegex = false;
  let inlineSearchCurrentMatch: MatchShape | null = null;

  function isWordChar(ch: string): boolean {
    return /[0-9A-Za-z_]/.test(ch);
  }

  function isWholeWordRange(text: string, start: number, end: number): boolean {
    const before = start > 0 ? text[start - 1] : "";
    const after = end < text.length ? text[end] : "";
    const leftOk = before === "" || !isWordChar(before);
    const rightOk = after === "" || !isWordChar(after);
    return leftOk && rightOk;
  }

  function matchPassesWholeWord(it: monaco.editor.FindMatch): boolean {
    if (!inlineSearchWholeWord) return true;
    const m = deps.model.value;
    if (!m) return false;
    const lineText = m.getLineContent(it.range.startLineNumber);
    const start = Math.max(0, it.range.startColumn - 1);
    const end = Math.max(start, it.range.endColumn - 1);
    return isWholeWordRange(lineText, start, end);
  }

  function sameInlineSearchMatch(a: MatchShape, b: monaco.Range) {
    return (
      a.lineNumber === b.startLineNumber &&
      a.startColumn === b.startColumn &&
      a.endColumn === b.endColumn
    );
  }

  function findInlineSearchMatches(query: string) {
    const m = deps.model.value;
    if (!m) return [] as monaco.editor.FindMatch[];
    let matches = m.findMatches(
      query,
      false,
      inlineSearchUseRegex,
      inlineSearchCaseSensitive,
      null,
      false,
      INLINE_SEARCH_MATCHES_LIMIT,
    );
    if (inlineSearchWholeWord) {
      matches = matches.filter(matchPassesWholeWord);
    }
    return matches;
  }

  /**
   * 从 searchStart 起找下一处（含起点）；不受 findMatches 条数上限影响。
   * 已有选区时从选区终点起搜，避免重复命中当前项。
   */
  function findNextInlineSearchMatchFrom(
    query: string,
    searchStart: monaco.IPosition,
  ): monaco.editor.FindMatch | null {
    const m = deps.model.value;
    if (!m) return null;
    let start: monaco.IPosition = {
      lineNumber: searchStart.lineNumber,
      column: searchStart.column,
    };
    for (let guard = 0; guard < INLINE_SEARCH_MATCHES_LIMIT; guard++) {
      const hit = m.findNextMatch(
        query,
        start,
        inlineSearchUseRegex,
        inlineSearchCaseSensitive,
        null,
        false,
      );
      if (!hit) return null;
      if (matchPassesWholeWord(hit)) return hit;
      start = {
        lineNumber: hit.range.endLineNumber,
        column: hit.range.endColumn,
      };
    }
    return null;
  }

  function applyInlineSearchDecorations() {
    const m = deps.model.value;
    const collection = deps.inlineSearchDecorationsCollection.value;
    if (!m || !collection) return;
    const query = inlineSearchQuery.trim();
    if (!query) {
      collection.clear();
      return;
    }
    const matches = findInlineSearchMatches(query);
    if (matches.length === 0) {
      collection.clear();
      return;
    }
    let currentMatchIndex = -1;
    if (inlineSearchCurrentMatch != null) {
      currentMatchIndex = matches.findIndex((it) =>
        sameInlineSearchMatch(inlineSearchCurrentMatch!, it.range),
      );
    }
    if (currentMatchIndex < 0) currentMatchIndex = 0;
    const currentRange = matches[currentMatchIndex]!.range;
    const decorations: monaco.editor.IModelDeltaDecoration[] = matches.map(
      (it, idx) => ({
        range: it.range,
        options: {
          inlineClassName:
            idx === currentMatchIndex
              ? "readerInlineSearchCurrentMatch"
              : "readerInlineSearchMatch",
        },
      }),
    );
    decorations.push({
      range: new monaco.Range(
        currentRange.startLineNumber,
        1,
        currentRange.startLineNumber,
        m.getLineMaxColumn(currentRange.startLineNumber),
      ),
      options: {
        isWholeLine: true,
        className: "readerInlineSearchCurrentLine",
        linesDecorationsClassName: "readerInlineSearchCurrentLineDecor",
      },
    });
    collection.set(decorations);
  }

  function setInlineSearchState(
    query: string,
    currentMatch?: MatchShape | null,
    options?: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
      useRegex?: boolean;
    },
  ) {
    inlineSearchQuery = query.trim();
    inlineSearchCaseSensitive = options?.caseSensitive === true;
    inlineSearchWholeWord = options?.wholeWord === true;
    inlineSearchUseRegex = options?.useRegex === true;
    if (
      currentMatch &&
      Number.isFinite(currentMatch.lineNumber) &&
      Number.isFinite(currentMatch.startColumn) &&
      Number.isFinite(currentMatch.endColumn)
    ) {
      inlineSearchCurrentMatch = {
        lineNumber: Math.max(1, Math.floor(currentMatch.lineNumber)),
        startColumn: Math.max(1, Math.floor(currentMatch.startColumn)),
        endColumn: Math.max(
          1,
          Math.floor(Math.max(currentMatch.startColumn, currentMatch.endColumn)),
        ),
      };
    } else {
      inlineSearchCurrentMatch = null;
    }
    applyInlineSearchDecorations();
  }

  function clearInlineSearchState() {
    inlineSearchQuery = "";
    inlineSearchCaseSensitive = false;
    inlineSearchWholeWord = false;
    inlineSearchUseRegex = false;
    inlineSearchCurrentMatch = null;
    deps.inlineSearchDecorationsCollection.value?.clear();
  }

  function jumpToSearchMatchCentered(
    lineNumber: number,
    startColumn: number,
    endColumn: number,
    smooth = true,
  ) {
    const e = deps.editor.value;
    const m = deps.model.value;
    if (!e || !m) return;
    deps.beginProgrammaticScroll();
    const lineCount = m.getLineCount();
    const line = Math.max(
      1,
      Math.min(Math.floor(lineNumber), Math.max(1, lineCount)),
    );
    const maxCol = Math.max(1, m.getLineMaxColumn(line));
    const start = Math.max(1, Math.min(Math.floor(startColumn), maxCol));
    const end = Math.max(start, Math.min(Math.floor(endColumn), maxCol));
    const range = new monaco.Range(line, start, line, end);
    const selection = new monaco.Selection(line, start, line, end);
    const scrollType = deps.monacoScrollType(smooth);
    e.layout();
    deps.suppressHighlightTipForProgrammaticSelection();
    e.setPosition({ lineNumber: line, column: start });
    e.setSelection(selection);
    e.revealRangeInCenter(range, scrollType);
    const editorWithTopForPos = e as monaco.editor.IStandaloneCodeEditor & {
      getTopForPosition?: (lineNumber: number, column?: number) => number;
    };
    if (typeof editorWithTopForPos.getTopForPosition === "function") {
      const posTop = editorWithTopForPos.getTopForPosition(line, start);
      const vh = e.getLayoutInfo().height;
      const lineHeightPx = e.getOption(monaco.editor.EditorOption.lineHeight);
      const targetTop = Math.max(0, posTop - Math.floor(vh / 2) + lineHeightPx / 2);
      e.setScrollTop(targetTop, scrollType);
    }
    e.focus();
  }

  function jumpToNextInlineSearchMatch(
    query: string,
    options?: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
      useRegex?: boolean;
      smooth?: boolean;
    },
  ): boolean {
    const e = deps.editor.value;
    const m = deps.model.value;
    if (!e || !m) return false;
    const q = query.trim();
    if (!q) {
      clearInlineSearchState();
      return false;
    }
    /** 视口外光标先挪到视口首行；「下一处」用 findNextMatch；装饰上限 19999（对齐查找栏） */
    ensureSearchAnchorCursorInViewport(e);

    inlineSearchQuery = q;
    inlineSearchCaseSensitive = options?.caseSensitive === true;
    inlineSearchWholeWord = options?.wholeWord === true;
    inlineSearchUseRegex = options?.useRegex === true;

    const sel = e.getSelection();
    let searchStart: monaco.IPosition =
      e.getPosition() ?? { lineNumber: 1, column: 1 };
    if (sel && !sel.isEmpty()) {
      const end = sel.getEndPosition();
      searchStart = { lineNumber: end.lineNumber, column: end.column };
    }

    const hit = findNextInlineSearchMatchFrom(q, searchStart);
    if (!hit) {
      clearInlineSearchState();
      return false;
    }
    const target = hit.range;
    inlineSearchCurrentMatch = {
      lineNumber: target.startLineNumber,
      startColumn: target.startColumn,
      endColumn: target.endColumn,
    };
    applyInlineSearchDecorations();
    jumpToSearchMatchCentered(
      target.startLineNumber,
      target.startColumn,
      target.endColumn,
      options?.smooth !== false,
    );
    return true;
  }

  function hasInlineSearchQuery(): boolean {
    return inlineSearchQuery.trim().length > 0;
  }

  return {
    applyInlineSearchDecorations,
    setInlineSearchState,
    clearInlineSearchState,
    jumpToSearchMatchCentered,
    jumpToNextInlineSearchMatch,
    hasInlineSearchQuery,
  };
}
