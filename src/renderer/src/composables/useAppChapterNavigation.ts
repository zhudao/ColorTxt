import { nextTick, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  getChapterMatchRules,
  setChapterMatchRules,
  type Chapter,
  type ChapterMatchRule,
} from "../chapter";
import { pickActiveChapterIdx } from "../reader/chapterIndex";
import {
  buildChaptersFromMarkdownEditorText,
  buildChaptersFromMarkdownPhysicalLines,
} from "../markdown/markdownChapter";
import {
  buildChaptersFromReaderDisplayLines,
  buildChaptersFromReaderDisplayText,
} from "../reader/readerDisplayPipeline";
import { yieldToUi } from "../ebook/yieldToUi";
import type { ReaderViewportRestoreAnchor } from "../reader/readerViewportAnchor";
import type { useTxtStreamPipeline } from "./useTxtStreamPipeline";

type Stream = ReturnType<typeof useTxtStreamPipeline>;

export function useAppChapterNavigation(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  chapters: Ref<Chapter[]>;
  activeChapterIdx: Ref<number>;
  lastProbeLine: Ref<number>;
  viewportTopLine: Ref<number>;
  viewportEndLine: Ref<number>;
  currentFile: Ref<string | null>;
  currentFileIsMarkdown: Ref<boolean>;
  readerEditMode: Ref<boolean>;
  readingProgressSynced: Ref<boolean>;
  stream: Stream;
  touchRecentFile: (
    path: string,
    moveToTop: boolean,
    opts?: {
      persistRecent?: boolean;
      persistMeta?: boolean;
      updateMeta?: boolean;
      progress?: number;
      editorViewState?: unknown;
    },
  ) => void;
  chapterListScrollSmooth: Ref<boolean>;
  chapterRuleState: Ref<{ rules: ChapterMatchRule[] }>;
  chapterMinCharCount: Ref<number>;
  chapterRuleErrorText: Ref<string>;
  showChapterRulePanel: Ref<boolean>;
  sidebarTab: Ref<import("../constants/readerSidebarTab").ReaderSidebarTab>;
  persistSettings: () => void;
  compressBlankLines: Ref<boolean>;
  leadIndentFullWidth: Ref<boolean>;
  captureViewportRestoreAnchor: () => ReaderViewportRestoreAnchor | null;
  captureViewportAnchorPhysicalLine: () => number;
  withChapterListScrollSuppressed: <T>(
    fn: () => Promise<T> | T,
  ) => Promise<T>;
  onAfterChapterListRefresh?: () => void | Promise<void>;
}) {
  function resolveChapterListIndex(ch: Chapter): number {
    const list = deps.chapters.value;
    if (ch.tocOrder != null) {
      const byOrder = list.findIndex((c) => c.tocOrder === ch.tocOrder);
      if (byOrder >= 0) return byOrder;
    }
    const byTitle = list.findIndex(
      (c) => c.lineNumber === ch.lineNumber && c.title === ch.title,
    );
    if (byTitle >= 0) return byTitle;
    return pickActiveChapterIdx(list, ch.lineNumber);
  }

  function jumpToChapter(ch: Chapter) {
    deps.readerRef.value?.jumpToLine(ch.lineNumber);
    const idx = resolveChapterListIndex(ch);
    if (idx !== deps.activeChapterIdx.value) deps.activeChapterIdx.value = idx;
  }

  function withChapterListSmoothScroll(run: () => void) {
    deps.chapterListScrollSmooth.value = true;
    void nextTick(() => {
      deps.chapterListScrollSmooth.value = false;
    });
    run();
  }

  function jumpToPrevChapter() {
    const list = deps.chapters.value;
    if (list.length === 0) return;
    const idx = pickActiveChapterIdx(list, deps.lastProbeLine.value);
    if (idx > 0) {
      withChapterListSmoothScroll(() => jumpToChapter(list[idx - 1]!));
    }
  }

  function jumpToNextChapter() {
    const list = deps.chapters.value;
    if (list.length === 0) return;
    const idx = pickActiveChapterIdx(list, deps.lastProbeLine.value);
    if (idx === -1) {
      withChapterListSmoothScroll(() => jumpToChapter(list[0]!));
      return;
    }
    if (idx + 1 < list.length) {
      withChapterListSmoothScroll(() => jumpToChapter(list[idx + 1]!));
    }
  }

  function onProbeLineChange(probeLine: number, fromScroll?: boolean) {
    deps.lastProbeLine.value = probeLine;
    const idx = pickActiveChapterIdx(deps.chapters.value, probeLine);
    if (idx !== deps.activeChapterIdx.value) {
      deps.activeChapterIdx.value = idx;
      if (fromScroll === true) {
        deps.chapterListScrollSmooth.value = true;
        void nextTick(() => {
          deps.chapterListScrollSmooth.value = false;
        });
      }
    }
    if (deps.readingProgressSynced.value && deps.currentFile.value) {
      deps.touchRecentFile(deps.currentFile.value, false, {
        updateMeta: false,
        progress: deps.stream.calcProgressPercentByViewportDisplay(
          deps.viewportTopLine.value,
          deps.viewportEndLine.value,
        ),
      });
    }
  }

  function applyChapterListResult(filtered: Chapter[]) {
    deps.chapters.value = filtered;
    deps.readerRef.value?.setChapters(
      filtered.map((ch) => ({
        title: ch.title,
        lineNumber: ch.lineNumber,
        headingLevel: ch.headingLevel,
        tocOrder: ch.tocOrder,
      })),
    );
    deps.activeChapterIdx.value = pickActiveChapterIdx(
      deps.chapters.value,
      deps.lastProbeLine.value,
    );
  }

  /** 对当前 Monaco 展示全文统一匹配章节（加载后 / 规则变更 / 刷新章节） */
  function refreshChapterListFromReader() {
    void refreshChapterListFromReaderAsync();
  }

  async function refreshChapterListFromReaderAsync() {
    const reader = deps.readerRef.value;
    const lineCount = deps.stream.getLineCount();
    if (!reader || lineCount <= 0) {
      deps.chapters.value = [];
      deps.activeChapterIdx.value = -1;
      reader?.setChapters([]);
      return;
    }

    if (deps.readerEditMode.value) {
      deps.stream.resyncMirrorFromReader();
    }

    const leadingLinkLabels =
      reader.getEbookLeadingLinkLabelsByDisplayLine?.() ??
      new Map<number, readonly string[]>();

    const heavy =
      !deps.readerEditMode.value &&
      lineCount > 50_000 &&
      !deps.currentFileIsMarkdown.value;

    let filtered: Chapter[];
    if (deps.currentFileIsMarkdown.value) {
      const text = reader.getAllText?.() ?? "";
      if (!text) {
        deps.chapters.value = [];
        deps.activeChapterIdx.value = -1;
        reader.setChapters([]);
        return;
      }
      filtered = deps.readerEditMode.value
        ? buildChaptersFromMarkdownEditorText(text, {
            minCharCount: deps.chapterMinCharCount.value,
          })
        : buildChaptersFromMarkdownPhysicalLines(
            Array.from(
              { length: deps.stream.getPhysicalLineCount() },
              (_, i) => deps.stream.getPhysicalLineContent(i + 1),
            ),
            {
              minCharCount: deps.chapterMinCharCount.value,
              displayText: text,
              physicalLineToDisplayLine: (p) =>
                deps.stream.physicalLineToDisplayForReader(p),
            },
          );
    } else if (heavy) {
      const lines: string[] = new Array(lineCount);
      const getLine = reader.getEditorLineContent?.bind(reader);
      for (let i = 1; i <= lineCount; i++) {
        if (i > 1 && i % 8_000 === 0) {
          await yieldToUi();
        }
        lines[i - 1] = getLine?.(i) ?? "";
      }
      filtered = buildChaptersFromReaderDisplayLines(lines, {
        minCharCount: deps.chapterMinCharCount.value,
        leadingLinkLabelsByDisplayLine: leadingLinkLabels,
      });
    } else {
      const text = reader.getAllText?.() ?? "";
      if (!text) {
        deps.chapters.value = [];
        deps.activeChapterIdx.value = -1;
        reader.setChapters([]);
        return;
      }
      filtered = buildChaptersFromReaderDisplayText(text, {
        minCharCount: deps.chapterMinCharCount.value,
        leadingLinkLabelsByDisplayLine: leadingLinkLabels,
      });
    }

    applyChapterListResult(filtered);
  }

  async function refreshChapterListAfterDisplayChange() {
    await refreshChapterListFromReaderAsync();
    await deps.onAfterChapterListRefresh?.();
  }

  async function applyChapterMatchRules(payload: {
    rules: ChapterMatchRule[];
  }) {
    try {
      setChapterMatchRules(payload.rules);
      deps.chapterRuleState.value = getChapterMatchRules();
      deps.chapterRuleErrorText.value = "";
      deps.persistSettings();
      if (deps.currentFile.value) {
        const reapplyReaderDisplay =
          !deps.readerEditMode.value &&
          (deps.compressBlankLines.value || deps.leadIndentFullWidth.value);
        if (reapplyReaderDisplay) {
          await deps.withChapterListScrollSuppressed(async () => {
            const anchor =
              deps.captureViewportRestoreAnchor() ?? {
                physicalLine: deps.captureViewportAnchorPhysicalLine(),
                wrappedLineIndex: 0,
              };
            const ok =
              await deps.stream.applyReaderDisplayFromPhysicalLines(anchor);
            if (!ok) {
              deps.chapterRuleErrorText.value =
                "章节规则已保存，但重新格式化展示正文失败";
              refreshChapterListFromReader();
              return;
            }
            await refreshChapterListAfterDisplayChange();
          });
        } else {
          refreshChapterListFromReader();
        }
      }
      deps.sidebarTab.value = "chapters";
      deps.showChapterRulePanel.value = false;
    } catch (e) {
      deps.chapterRuleErrorText.value =
        e instanceof Error ? e.message : "规则无效，请检查正则表达式";
    }
  }

  return {
    jumpToChapter,
    jumpToPrevChapter,
    jumpToNextChapter,
    onProbeLineChange,
    refreshChapterListFromReader,
    refreshChapterListFromReaderAsync,
    applyChapterMatchRules,
  };
}
