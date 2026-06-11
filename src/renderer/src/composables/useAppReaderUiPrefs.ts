import { nextTick, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  lineHeightMultipleStep,
  maxFontSize,
  maxLineHeightMultipleForFontSize,
  minFontSize,
  minLineHeightMultiple,
  normalizeLineHeightMultiple,
} from "../constants/appUi";
import type { useTxtStreamPipeline } from "./useTxtStreamPipeline";

type Stream = ReturnType<typeof useTxtStreamPipeline>;

export function useAppReaderUiPrefs(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  readerFontSize: Ref<number>;
  readerLineHeightMultiple: Ref<number>;
  monacoFontFamily: Ref<string>;
  monacoCustomHighlight: Ref<boolean>;
  monacoAdvancedWrapping: Ref<boolean>;
  compressBlankLines: Ref<boolean>;
  leadIndentFullWidth: Ref<boolean>;
  withChapterListScrollSuppressed: <T>(fn: () => Promise<T> | T) => Promise<T>;
  currentFile: Ref<string | null>;
  stream: Stream;
  syncChaptersAfterViewportSettled: () => void | Promise<void>;
  persistSettings: () => void;
  isFullscreenView: Ref<boolean>;
  showFullscreenHeader: Ref<boolean>;
  viewportTopLine: Ref<number>;
  viewportEndLine: Ref<number>;
  viewportVisualProgressPercent: Ref<number>;
  viewportAtBottom: Ref<boolean>;
  /** 语音朗读播放中：禁止打开查找栏 */
  isVoiceReadBlocksFind?: Ref<boolean>;
}) {
  function onViewportTopLineChange(lineNumber: number) {
    deps.viewportTopLine.value = lineNumber;
  }

  function onViewportEndLineChange(lineNumber: number) {
    deps.viewportEndLine.value = lineNumber;
  }

  function onViewportVisualProgressChange(percent: number, atBottom: boolean) {
    deps.viewportVisualProgressPercent.value = percent;
    deps.viewportAtBottom.value = atBottom;
  }

  function increaseFontSize() {
    if (deps.readerFontSize.value >= maxFontSize) return;
    deps.readerFontSize.value += 1;
    deps.readerRef.value?.setFontSize(deps.readerFontSize.value);
    const cap = maxLineHeightMultipleForFontSize(deps.readerFontSize.value);
    if (deps.readerLineHeightMultiple.value > cap + 1e-6) {
      deps.readerLineHeightMultiple.value = cap;
      deps.readerRef.value?.setLineHeightMultiple(cap);
    }
    deps.persistSettings();
  }

  function decreaseFontSize() {
    if (deps.readerFontSize.value <= minFontSize) return;
    deps.readerFontSize.value -= 1;
    deps.readerRef.value?.setFontSize(deps.readerFontSize.value);
    deps.persistSettings();
  }

  function increaseLineHeight() {
    const next = normalizeLineHeightMultiple(
      deps.readerLineHeightMultiple.value + lineHeightMultipleStep,
    );
    if (
      next >
      maxLineHeightMultipleForFontSize(deps.readerFontSize.value) + 1e-6
    )
      return;
    if (next === deps.readerLineHeightMultiple.value) return;
    deps.readerLineHeightMultiple.value = next;
    deps.readerRef.value?.setLineHeightMultiple(next);
    deps.persistSettings();
  }

  function decreaseLineHeight() {
    const next = normalizeLineHeightMultiple(
      deps.readerLineHeightMultiple.value - lineHeightMultipleStep,
    );
    if (next < minLineHeightMultiple - 1e-6) return;
    if (next === deps.readerLineHeightMultiple.value) return;
    deps.readerLineHeightMultiple.value = next;
    deps.readerRef.value?.setLineHeightMultiple(next);
    deps.persistSettings();
  }

  function setMonacoFontFamily(fontFamily: string) {
    deps.monacoFontFamily.value = fontFamily;
    deps.readerRef.value?.setFontFamily(fontFamily);
    deps.persistSettings();
  }

  function toggleMonacoCustomHighlight() {
    deps.monacoCustomHighlight.value = !deps.monacoCustomHighlight.value;
    deps.persistSettings();
  }

  function toggleMonacoAdvancedWrapping() {
    deps.monacoAdvancedWrapping.value = !deps.monacoAdvancedWrapping.value;
    deps.readerRef.value?.setWrappingStrategyAdvanced(
      deps.monacoAdvancedWrapping.value,
    );
    deps.persistSettings();
  }

  async function applyDisplayToggleFromPhysical(
    applyNext: () => void,
    revert: () => void,
  ) {
    if (!deps.currentFile.value) {
      applyNext();
      deps.persistSettings();
      return;
    }
    const anchor =
      deps.readerRef.value?.captureViewportRestoreAnchor?.() ?? {
        physicalLine: deps.stream.viewportDisplayLineToPhysicalLine(
          Math.max(
            1,
            Math.floor(
              deps.readerRef.value?.getViewportEndLine?.() ??
                deps.viewportEndLine.value,
            ),
          ),
        ),
        wrappedLineIndex: 0,
      };
    await deps.withChapterListScrollSuppressed(async () => {
      applyNext();
      deps.persistSettings();
      const ok = await deps.stream.applyReaderDisplayFromPhysicalLines(anchor);
      if (!ok) {
        revert();
        deps.persistSettings();
        return;
      }
      await nextTick();
      deps.readerRef.value?.emitProbeLine?.();
      await deps.syncChaptersAfterViewportSettled();
    });
  }

  async function toggleCompressBlankLines() {
    const next = !deps.compressBlankLines.value;
    await applyDisplayToggleFromPhysical(
      () => {
        deps.compressBlankLines.value = next;
      },
      () => {
        deps.compressBlankLines.value = !next;
      },
    );
  }

  async function toggleLeadIndentFullWidth() {
    const next = !deps.leadIndentFullWidth.value;
    await applyDisplayToggleFromPhysical(
      () => {
        deps.leadIndentFullWidth.value = next;
      },
      () => {
        deps.leadIndentFullWidth.value = !next;
      },
    );
  }

  function toggleReaderFind() {
    if (deps.isVoiceReadBlocksFind?.value) return;
    deps.readerRef.value?.toggleFindWidget?.();
  }

  function onToggleFind() {
    toggleReaderFind();
  }

  return {
    onViewportTopLineChange,
    onViewportEndLineChange,
    onViewportVisualProgressChange,
    increaseFontSize,
    decreaseFontSize,
    increaseLineHeight,
    decreaseLineHeight,
    setMonacoFontFamily,
    toggleMonacoCustomHighlight,
    toggleMonacoAdvancedWrapping,
    toggleCompressBlankLines,
    toggleLeadIndentFullWidth,
    toggleReaderFind,
    onToggleFind,
  };
}
