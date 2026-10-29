import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import type { useTxtStreamPipeline } from "./useTxtStreamPipeline";
import {
  annotationColumnMapOptions,
  displayColumnToPhysicalColumn,
} from "../utils/readerAnnotations";

export type SidebarSearchResult = {
  physicalLine: number;
  displayLine: number;
  text: string;
  /** 该行内单次匹配（同一行多次匹配各占一条结果） */
  range: { start: number; end: number };
  /**
   * 物理行内命中起始列（1-based）。
   * 编辑态与 `range.start+1` 一致；只读态经行首缩进映射推回（简繁/替换开启时可能与原文错位）。
   */
  physicalStartColumn: number;
};

type Stream = ReturnType<typeof useTxtStreamPipeline>;

function isSameSidebarSearchResult(
  item: SidebarSearchResult,
  active: { displayLine: number; rangeStart: number },
): boolean {
  return (
    item.displayLine === active.displayLine &&
    item.range.start === active.rangeStart
  );
}

function isWordChar(ch: string): boolean {
  return /[0-9A-Za-z_]/.test(ch);
}

function isWholeWordBoundary(
  text: string,
  start: number,
  end: number,
): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  const leftOk = before === "" || !isWordChar(before);
  const rightOk = after === "" || !isWordChar(after);
  return leftOk && rightOk;
}

function collectPlainRanges(
  text: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): Array<{ start: number; end: number }> {
  const source = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  if (!needle) return out;
  let from = 0;
  while (from < source.length) {
    const idx = source.indexOf(needle, from);
    if (idx < 0) break;
    const end = idx + needle.length;
    if (!wholeWord || isWholeWordBoundary(text, idx, end)) {
      out.push({ start: idx, end });
    }
    from = end;
  }
  return out;
}

function collectRegexRanges(
  text: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): Array<{ start: number; end: number }> | null {
  const flags = caseSensitive ? "g" : "gi";
  let reg: RegExp;
  try {
    reg = new RegExp(query, flags);
  } catch {
    return null;
  }
  const out: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null = null;
  while ((match = reg.exec(text)) != null) {
    const matched = match[0] ?? "";
    const start = match.index;
    const end = start + matched.length;
    if (matched.length === 0) {
      reg.lastIndex = start + 1;
      continue;
    }
    if (!wholeWord || isWholeWordBoundary(text, start, end)) {
      out.push({ start, end });
    }
  }
  return out;
}

const SEARCH_RESULT_LIMIT = 20000;
const SEARCH_DEBOUNCE_MS = 180;

/**
 * 侧栏全文搜索：结果列表、debounce、与 ReaderMain 内联高亮联动。
 */
export function useAppSidebarSearch(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  stream: Stream;
  currentFile: Ref<string | null>;
  loading: Ref<boolean>;
  totalLineCount: Ref<number>;
  readerEditMode: Ref<boolean>;
  textConvertZh: Ref<unknown>;
  textConvertLetter: Ref<unknown>;
  textConvertDigit: Ref<unknown>;
  compressBlankLines: Ref<boolean>;
  leadIndentFullWidth: Ref<boolean>;
  isVoiceReadNavigationBlocked: Ref<boolean>;
  ensurePinBeforeRevealFindWidget: () => void;
}) {
  const searchQuery = ref("");
  const searchResults = ref<SidebarSearchResult[]>([]);
  const searchInProgress = ref(false);
  const activeSearchResult = ref<{
    displayLine: number;
    rangeStart: number;
  } | null>(null);
  const hasInlineSearchHighlight = ref(false);
  const searchMatchCase = ref(false);
  const searchWholeWord = ref(false);
  const searchUseRegex = ref(false);

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchRunToken = 0;

  function clearReaderInlineSearchHighlight() {
    deps.readerRef.value?.clearInlineSearchState?.();
    hasInlineSearchHighlight.value = false;
  }

  function clearSidebarSearchState() {
    searchQuery.value = "";
    searchResults.value = [];
    searchInProgress.value = false;
    activeSearchResult.value = null;
    searchRunToken += 1;
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    deps.readerRef.value?.clearInlineSearchState?.();
    hasInlineSearchHighlight.value = false;
  }

  function runSidebarSearch(token: number) {
    if (token !== searchRunToken) return;
    const q = searchQuery.value.trim();
    if (!deps.currentFile.value || !q) {
      searchResults.value = [];
      searchInProgress.value = false;
      return;
    }
    const caseSensitive = searchMatchCase.value;
    const wholeWord = searchWholeWord.value;
    const useRegex = searchUseRegex.value;
    const editMode = deps.readerEditMode.value;
    const maxLine = editMode
      ? deps.stream.getPhysicalLineCount()
      : deps.stream.getLineCount();
    const next: SidebarSearchResult[] = [];
    for (let line = 1; line <= maxLine; line += 1) {
      const text = editMode
        ? deps.stream.getPhysicalLineContent(line)
        : deps.stream.getDisplayLineContent(line);
      const ranges = useRegex
        ? collectRegexRanges(text, q, caseSensitive, wholeWord)
        : collectPlainRanges(text, q, caseSensitive, wholeWord);
      if (ranges == null) {
        searchResults.value = [];
        activeSearchResult.value = null;
        searchInProgress.value = false;
        return;
      }
      if (ranges.length === 0) continue;
      const displayLine = line;
      const physicalLine = editMode
        ? line
        : deps.stream.viewportDisplayLineToPhysicalLine(line);
      const columnMap = annotationColumnMapOptions({
        readerEditMode: editMode,
        leadIndentFullWidth: deps.leadIndentFullWidth.value,
      });
      const physicalLineText = editMode
        ? text
        : deps.stream.getPhysicalLineContent(physicalLine);
      for (const range of ranges) {
        const physicalStartColumn = editMode
          ? range.start + 1
          : displayColumnToPhysicalColumn(
              physicalLineText,
              range.start + 1,
              columnMap,
            );
        next.push({
          physicalLine,
          displayLine,
          text,
          range,
          physicalStartColumn,
        });
        if (next.length >= SEARCH_RESULT_LIMIT) break;
      }
      if (next.length >= SEARCH_RESULT_LIMIT) break;
    }
    if (token !== searchRunToken) return;
    searchResults.value = next;
    deps.readerRef.value?.setInlineSearchState?.(q, null, {
      caseSensitive,
      wholeWord,
      useRegex,
    });
    hasInlineSearchHighlight.value = next.length > 0;
    if (
      activeSearchResult.value != null &&
      !next.some((it) =>
        isSameSidebarSearchResult(it, activeSearchResult.value!),
      )
    ) {
      activeSearchResult.value = null;
    }
    searchInProgress.value = false;
  }

  function scheduleSidebarSearch() {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    const q = searchQuery.value.trim();
    if (!deps.currentFile.value || !q) {
      searchResults.value = [];
      searchInProgress.value = false;
      activeSearchResult.value = null;
      deps.readerRef.value?.clearInlineSearchState?.();
      hasInlineSearchHighlight.value = false;
      return;
    }
    const token = ++searchRunToken;
    searchInProgress.value = true;
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      runSidebarSearch(token);
    }, SEARCH_DEBOUNCE_MS);
  }

  function onJumpToSearchResult(item: SidebarSearchResult) {
    if (
      !deps.currentFile.value ||
      deps.loading.value ||
      deps.totalLineCount.value <= 0
    ) {
      return;
    }
    if (deps.isVoiceReadNavigationBlocked.value) return;
    activeSearchResult.value = {
      displayLine: item.displayLine,
      rangeStart: item.range.start,
    };
    deps.ensurePinBeforeRevealFindWidget();
    const displayLine = item.displayLine;
    const startColumn = item.range.start + 1;
    const endColumn = Math.max(item.range.start + 2, item.range.end + 1);
    deps.readerRef.value?.setInlineSearchState?.(
      searchQuery.value,
      {
        lineNumber: displayLine,
        startColumn,
        endColumn,
      },
      {
        caseSensitive: searchMatchCase.value,
        wholeWord: searchWholeWord.value,
        useRegex: searchUseRegex.value,
      },
    );
    hasInlineSearchHighlight.value = true;
    deps.readerRef.value?.jumpToSearchMatchCentered?.(
      displayLine,
      startColumn,
      endColumn,
    );
    queueMicrotask(() => deps.readerRef.value?.emitProbeLine?.());
  }

  watch(searchQuery, () => {
    scheduleSidebarSearch();
  });

  watch([searchMatchCase, searchWholeWord, searchUseRegex], () => {
    scheduleSidebarSearch();
  });

  watch(deps.totalLineCount, () => {
    if (!searchQuery.value.trim()) return;
    if (deps.readerEditMode.value) return;
    scheduleSidebarSearch();
  });

  watch(
    [
      () => deps.textConvertZh.value,
      () => deps.textConvertLetter.value,
      () => deps.textConvertDigit.value,
      deps.compressBlankLines,
      deps.leadIndentFullWidth,
    ],
    () => {
      if (!searchQuery.value.trim() || deps.readerEditMode.value) return;
      scheduleSidebarSearch();
    },
  );

  watch(deps.readerEditMode, (edit) => {
    if (!searchQuery.value.trim()) return;
    if (edit) return;
    scheduleSidebarSearch();
  });

  watch(deps.currentFile, (next, prev) => {
    if (next === prev) return;
    clearSidebarSearchState();
  });

  onBeforeUnmount(() => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    activeSearchResult.value = null;
    deps.readerRef.value?.clearInlineSearchState?.();
    hasInlineSearchHighlight.value = false;
  });

  return {
    searchQuery,
    searchResults,
    searchInProgress,
    activeSearchResult,
    hasInlineSearchHighlight,
    searchMatchCase,
    searchWholeWord,
    searchUseRegex,
    scheduleSidebarSearch,
    clearSidebarSearchState,
    clearReaderInlineSearchHighlight,
    onJumpToSearchResult,
  };
}
