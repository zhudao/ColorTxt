import { computed, nextTick, ref, shallowRef, watch, type ShallowRef } from "vue";
import * as monaco from "monaco-editor";
import {
  clampLineationColorIndex,
  parseLineationColorIndexRaw,
} from "../constants/annotationColors";
import type { LineationLastColorPrefs } from "../constants/annotationColors";
import {
  clampHighlightColorIndex,
  parseHighlightLastColor,
} from "../constants/highlightColors";
import {
  ANNOTATION_VIEWPORT_BUFFER_LINES,
  ANNOTATION_VIEWPORT_SYNC_MS,
  annotationNoteToHoverMarkdown,
  annotationNotesAtColumn,
  buildAnnotationDecorationsForViewport,
  buildAnnotationHitsByDisplayLine,
  monacoRangeFromAnnotation,
  registerAnnotationNoteHoverQuery,
  type AnnotationCompactHit,
} from "../reader/readerAnnotationDecor";
import type {
  HighlightWordsByIndex,
  ReaderAnnotationRecord,
  ReaderLineationType,
} from "../stores/fileMetaStore";
import {
  annotationPhysicalRange,
  annotationColumnMapOptions,
  collapseAnnotationQuoteText,
  createAnnotationFromRange,
  displayColumnToPhysicalColumn,
  findAnnotationAtPoint,
  findAnnotationContainingRange,
  findAnnotationMatchingExactSelection,
  findAnnotationsIntersectingRange,
  getTextInDisplayRangeFromStoredRange,
  getTextInPhysicalRangeFromLines,
  monacoRangeToPhysicalRange,
  physicalRangeToMonacoRange,
  resolveAnnotationDisplayQuote,
  rangesEqual,
  unionPhysicalRanges,
  type AnnotationColumnMapOptions,
  type AnnotationDisplayQuoteContext,
  type AnnotationRange,
} from "../utils/readerAnnotations";
import { getRangeViewportAnchor, computeFloatPlacement } from "../reader/readerHighlightGeometry";
import {
  positionFromClientPoint,
  clientXWithinSingleLineModelRange,
} from "../reader/readerEbookPointer";
import { appToast } from "../services/appToast";
import {
  findHighlightColorIndexInMap,
} from "../utils/highlightWords";
import {
  hasVisibleSelectionToolbarActions,
  type SelectionToolbarButtons,
} from "../constants/selectionToolbar";

export function useReaderAnnotations(opts: {
  editor: { value: monaco.editor.IStandaloneCodeEditor | null };
  model: { value: monaco.editor.ITextModel | null };
  readerAnnotations: () => ReaderAnnotationRecord[];
  lineationLastColors: () => LineationLastColorPrefs;
  highlightLastColor: () => number;
  readerFilePath: () => string | null | undefined;
  readerEditMode: () => boolean;
  /**
   * 是否提供高亮词 / 划线 / 笔记入口。
   * 找书阅读器为 false：无文件路径也可出选区工具条，但不含标注类按钮。
   */
  showSelectionAnnotationTools?: () => boolean;
  monacoCustomHighlight: () => boolean;
  aiFeaturesEnabled: () => boolean;
  selectionToolbarButtons: () => SelectionToolbarButtons;
  highlightWordsByIndexBookOnly: () => HighlightWordsByIndex | undefined;
  highlightColorsLength: () => number;
  lineationColorsLength: () => number;
  emitUpsert: (ann: ReaderAnnotationRecord) => void;
  emitRemove: (id: string) => void;
  emitUpdateLineationColor: (payload: {
    type: ReaderLineationType;
    colorIndex: number;
  }) => void;
  emitUpdateHighlightLastColor: (colorIndex: number) => void;
  emitAddHighlightTerm: (payload: { text: string; colorIndex: number }) => void;
  emitRemoveHighlightTerm: (payload: { text: string }) => void;
  emitAskAiWithQuote: (text: string) => void;
  emitFindWithQuote: (text: string) => void;
  ebookDisplayLineToPhysical: () =>
    | ((displayLine: number) => number)
    | undefined;
  ebookAnchorPhysicalToDisplay: () =>
    | ((physicalLine: number) => number)
    | undefined;
  /** 源文件物理行文本（标注 `text` 快照） */
  getPhysicalLineContent: (physicalLine: number) => string;
  /** 当前展示层行文本（标注 `displayText` 快照） */
  getDisplayLineContent: (displayLine: number) => string;
  /** 只读态是否启用行首全角缩进（列映射须与展示层一致） */
  leadIndentFullWidth: () => boolean;
  onAnnotationIndexRebuilt?: () => void;
  annotationDecorationsCollection: ShallowRef<monaco.editor.IEditorDecorationsCollection | null>;
}) {
  const toolbarVisible = ref(false);
  const colorPickerMode = ref<null | "highlight" | "lineation">(null);

  function showSelectionAnnotationTools(): boolean {
    return opts.showSelectionAnnotationTools?.() !== false;
  }

  /** 只读且（主窗有打开文件，或找书等无标注模式）时可弹出选区工具条 */
  function canShowSelectionToolbar(): boolean {
    if (opts.readerEditMode()) return false;
    if (!showSelectionAnnotationTools()) return true;
    return Boolean(opts.readerFilePath());
  }

  function canUseSelectionAnnotationTools(): boolean {
    return showSelectionAnnotationTools() && Boolean(opts.readerFilePath());
  }

  function selectionToolbarHasVisibleActions(): boolean {
    return hasVisibleSelectionToolbarActions({
      buttons: opts.selectionToolbarButtons(),
      showAnnotationTools: showSelectionAnnotationTools(),
      aiFeaturesEnabled: opts.aiFeaturesEnabled(),
    });
  }
  const lineationPickerType = ref<ReaderLineationType | null>(null);
  const floatCenterX = ref(0);
  const floatRootTop = ref(0);
  const floatOpenDownward = ref(false);
  const draftText = ref("");
  const draftPhysicalRange = ref<AnnotationRange | null>(null);
  const activeAnnotationId = ref<string | null>(null);
  const floatRootRef = ref<HTMLElement | null>(null);
  const notePanelOpen = ref(false);
  const notePanelDraft = ref("");
  const notePanelSourceText = ref("");
  const notePanelEditing = ref(false);
  const notePanelTargetAnnotationId = ref<string | null>(null);
  const notePanelPhysicalRange = ref<AnnotationRange | null>(null);
  const notePanelRootRef = ref<HTMLElement | null>(null);
  const dictionaryPopupOpen = ref(false);
  const dictionaryPopupWord = ref("");
  const dictionaryPopupCenterX = ref(0);
  const dictionaryPopupTop = ref(0);
  const dictionaryPopupOpenDownward = ref(false);
  /** 按阅读区可用空间钳制，避免贴顶/贴底被截断 */
  const dictionaryPopupMaxHeight = ref(420);
  const dictionaryPopupRootRef = ref<HTMLElement | null>(null);
  const translatePopupOpen = ref(false);
  const translatePopupText = ref("");
  const translatePopupCenterX = ref(0);
  const translatePopupTop = ref(0);
  const translatePopupOpenDownward = ref(false);
  const translatePopupMaxHeight = ref(420);
  const translatePopupRootRef = ref<HTMLElement | null>(null);
  let translatePopupResizeObserver: ResizeObserver | null = null;

  let annotationViewportSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let annotationViewportDecorLastKey = "";
  let annotationViewportDecorLastCount = 0;
  let annotationScrollDisposable: monaco.IDisposable | null = null;
  let annotationNoteHoverQueryDisposable: monaco.IDisposable | null = null;
  let annotationViewportSyncRetry = 0;
  const ANNOTATION_VIEWPORT_SYNC_MAX_RETRY = 40;
  const ANNOTATION_VIEWPORT_SYNC_RETRY_MS = 50;
  const annotationHitsByLine = shallowRef<Map<number, AnnotationCompactHit[]>>(
    new Map(),
  );
  const annotationsById = shallowRef<Map<string, ReaderAnnotationRecord>>(
    new Map(),
  );
  let suppressToolbarUntilMs = 0;
  let removeGlobalListeners: (() => void) | null = null;
  let selectionPointerActive = false;
  let selectionPointerUpListener: ((ev: PointerEvent) => void) | null = null;
  /** 选区滚出视口时暂隐工具条，保留 draft 以便滚回后恢复 */
  let toolbarScrollHidden = false;

  function isFindWidgetTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(".find-widget");
  }

  function clearSelectionPointerUpListener() {
    if (selectionPointerUpListener) {
      window.removeEventListener("pointerup", selectionPointerUpListener, true);
      selectionPointerUpListener = null;
    }
  }

  function finishSelectionPointerInteraction(
    clientX: number,
    clientY: number,
  ) {
    if (!selectionPointerActive) return;
    selectionPointerActive = false;
    clearSelectionPointerUpListener();
    if (!canShowSelectionToolbar()) return;
    if (Date.now() < suppressToolbarUntilMs) return;
    void nextTick(() => {
      const ed = opts.editor.value;
      const sel = ed?.getSelection();
      if (sel && !sel.isEmpty()) {
        showToolbarFromSelectionIfAny();
        return;
      }
      if (
        canUseSelectionAnnotationTools() &&
        tryShowToolbarFromAnnotationPoint(clientX, clientY)
      ) {
        return;
      }
      closeToolbarUi();
    });
  }

  function beginSelectionPointerInteraction(startTarget?: EventTarget | null) {
    if (isFindWidgetTarget(startTarget ?? null)) return;
    selectionPointerActive = true;
    if (selectionPointerUpListener) return;
    selectionPointerUpListener = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      finishSelectionPointerInteraction(ev.clientX, ev.clientY);
    };
    window.addEventListener("pointerup", selectionPointerUpListener, true);
  }

  function cancelSelectionPointerInteraction() {
    selectionPointerActive = false;
    clearSelectionPointerUpListener();
  }

  function physicalToDisplay(n: number): number {
    const fn = opts.ebookAnchorPhysicalToDisplay();
    return typeof fn === "function" ? fn(n) : n;
  }

  function displayToPhysical(n: number): number {
    const fn = opts.ebookDisplayLineToPhysical();
    return typeof fn === "function" ? fn(n) : n;
  }

  function columnMap(): AnnotationColumnMapOptions {
    return annotationColumnMapOptions({
      readerEditMode: opts.readerEditMode(),
      leadIndentFullWidth: opts.leadIndentFullWidth(),
    });
  }

  function annotationDisplayQuoteContext(): AnnotationDisplayQuoteContext {
    return {
      readerEditMode: opts.readerEditMode(),
      getDisplayLineContent: opts.getDisplayLineContent,
      getPhysicalLineContent: opts.getPhysicalLineContent,
      physicalToDisplay,
      columnMap: columnMap(),
      monacoModel: opts.model.value,
      hitsByLine: annotationHitsByLine.value,
    };
  }

  function sourceTextInPhysicalRange(range: AnnotationRange): string {
    return getTextInPhysicalRangeFromLines(
      opts.getPhysicalLineContent,
      range,
      "physical",
    ).trim();
  }

  /** 高亮词持久化：只读存物理原文，编辑态与 Monaco 一致 */
  function highlightTermTextForStorage(): string {
    const display = draftText.value.trim();
    if (!display) return "";
    if (opts.readerEditMode()) return display;
    const range = draftPhysicalRange.value;
    if (!range) return display;
    return sourceTextInPhysicalRange(range) || display;
  }

  function displayTextInPhysicalRange(range: AnnotationRange): string {
    return getTextInDisplayRangeFromStoredRange(
      opts.getDisplayLineContent,
      opts.getPhysicalLineContent,
      range,
      physicalToDisplay,
      columnMap(),
    );
  }

  function createAnnotationTextsFromRange(range: AnnotationRange): {
    text: string;
    displayText?: string;
  } {
    const text = getTextInPhysicalRangeFromLines(
      opts.getPhysicalLineContent,
      range,
      "physical",
    );
    const m = opts.model.value;
    let displayText = "";
    if (m && !opts.readerEditMode()) {
      displayText = m.getValueInRange(
        physicalRangeToMonacoRange(
          range,
          physicalToDisplay,
          opts.getPhysicalLineContent,
          columnMap(),
        ),
      );
    } else {
      displayText = getTextInDisplayRangeFromStoredRange(
        opts.getDisplayLineContent,
        opts.getPhysicalLineContent,
        range,
        physicalToDisplay,
        columnMap(),
      );
    }
    return displayText === text ? { text } : { text, displayText };
  }

  /** 侧栏/导出：与阅读器装饰同源的展示层原文 */
  function getAnnotationDisplayQuote(ann: ReaderAnnotationRecord): string {
    return resolveAnnotationDisplayQuote(ann, annotationDisplayQuoteContext());
  }

  function displayTextForAnnotation(ann: ReaderAnnotationRecord): string {
    return getAnnotationDisplayQuote(ann);
  }

  function shouldSuppressToolbar(): boolean {
    return Date.now() < suppressToolbarUntilMs;
  }

  function resolveAnnotationById(
    id: string | null | undefined,
  ): ReaderAnnotationRecord | null {
    if (!id) return null;
    return (
      annotationsById.value.get(id) ??
      opts.readerAnnotations().find((a) => a.id === id) ??
      null
    );
  }

  function activeAnnotation(): ReaderAnnotationRecord | null {
    return resolveAnnotationById(activeAnnotationId.value);
  }

  const activeLineation = computed(() => activeAnnotation()?.lineation);
  const toolbarHasLineation = computed(() => !!activeLineation.value);
  const toolbarHasNote = computed(() =>
    Boolean(activeAnnotation()?.note?.content?.trim()),
  );

  /**
   * 色盘勾选只对应当前标注色；无划线时为 null（不回退「上次颜色」）。
   * 上次颜色仅用于新标注时自动上色，存在 prefs 内存里。
   */
  const lineationPickerSelectedIndex = computed((): number | null => {
    if (colorPickerMode.value !== "lineation" || !lineationPickerType.value) {
      return null;
    }
    const ann = activeAnnotation();
    if (
      ann?.lineation?.type !== lineationPickerType.value ||
      ann.lineation.colorIndex == null
    ) {
      return null;
    }
    return clampLineationColorIndex(
      ann.lineation.colorIndex,
      opts.lineationColorsLength(),
    );
  });

  function syncLineationLastColor(
    type: ReaderLineationType,
    colorIndex: number,
  ) {
    opts.emitUpdateLineationColor({ type, colorIndex });
  }

  function syncHighlightLastColor(colorIndex: number) {
    opts.emitUpdateHighlightLastColor(colorIndex);
  }

  function lastHighlightColorIndex(): number {
    return clampHighlightColorIndex(
      parseHighlightLastColor(opts.highlightLastColor()),
      opts.highlightColorsLength(),
    );
  }

  function applyHighlightTerm(colorIndex: number) {
    const t = highlightTermTextForStorage();
    if (!t) return;
    const n = opts.highlightColorsLength();
    if (n <= 0) return;
    const idx = clampHighlightColorIndex(colorIndex, n);
    opts.emitAddHighlightTerm({ text: t, colorIndex: idx });
    syncHighlightLastColor(idx);
  }

  /** 绑定已有划线标注时同步色盘类型；openIfLineation 为 true 时一并展开标注色盘 */
  function rememberLineationColorFromAnnotation(ann: ReaderAnnotationRecord) {
    if (!ann.lineation?.type || ann.lineation.colorIndex == null) return;
    syncLineationLastColor(ann.lineation.type, ann.lineation.colorIndex);
  }

  function syncLineationPickerFromActiveAnnotation(openIfLineation = false) {
    const ann = activeAnnotation();
    if (!ann?.lineation?.type) return;
    if (openIfLineation) {
      colorPickerMode.value = "lineation";
      lineationPickerType.value = ann.lineation.type;
      rememberLineationColorFromAnnotation(ann);
    } else if (colorPickerMode.value === "lineation") {
      lineationPickerType.value = ann.lineation.type;
      rememberLineationColorFromAnnotation(ann);
    }
  }

  function findStoredHighlightColorIndex(text: string): number | null {
    const idx = findHighlightColorIndexInMap(
      opts.highlightWordsByIndexBookOnly(),
      text,
    );
    if (idx == null || idx >= opts.highlightColorsLength()) return null;
    return idx;
  }

  function closeColorPicker() {
    colorPickerMode.value = null;
    lineationPickerType.value = null;
  }

  /**
   * 色盘与选区状态同步。
   * 显式取消高亮/划线时由调用方 {@link closeColorPicker}；
   * 此处仅在 openIfPicker 的新选区同步时按状态打开/清空。
   */
  function syncPickerFromSelection(openIfPicker = false) {
    const ann = activeAnnotation();
    const hasLineation = !!ann?.lineation?.type;
    const hasHighlight = findStoredHighlightColorIndex(draftText.value) != null;

    if (hasLineation) {
      syncLineationPickerFromActiveAnnotation(openIfPicker);
      return;
    }

    if (hasHighlight) {
      if (openIfPicker) {
        colorPickerMode.value = "highlight";
        lineationPickerType.value = null;
      }
      return;
    }

    if (openIfPicker) {
      colorPickerMode.value = null;
      lineationPickerType.value = null;
    }
  }

  const hlPickerExistingColorIndex = computed(() =>
    findStoredHighlightColorIndex(draftText.value.trim()),
  );

  const hlPickerShowRemoveRow = computed(
    () =>
      hlPickerExistingColorIndex.value != null &&
      hlPickerExistingColorIndex.value < opts.highlightColorsLength(),
  );

  function hideToolbarForScrollOut() {
    toolbarVisible.value = false;
    colorPickerMode.value = null;
    lineationPickerType.value = null;
    toolbarScrollHidden = true;
  }

  function closeToolbarUi() {
    toolbarScrollHidden = false;
    toolbarVisible.value = false;
    colorPickerMode.value = null;
    lineationPickerType.value = null;
    draftText.value = "";
    draftPhysicalRange.value = null;
    activeAnnotationId.value = null;
  }

  function maybeCloseToolbarOnEmptySelection() {
    if (!activeAnnotationId.value && !toolbarVisible.value) closeToolbarUi();
  }

  function openNotePanelFromToolbar() {
    bindDraftFromSelection();
    const source = resolveNotePanelSourceText();
    if (!source) return;
    const ann = activeAnnotation();
    notePanelTargetAnnotationId.value = ann?.id ?? activeAnnotationId.value ?? null;
    notePanelPhysicalRange.value =
      draftPhysicalRange.value ??
      (ann ? annotationPhysicalRange(ann) : null);
    notePanelDraft.value = ann?.note?.content ?? "";
    notePanelEditing.value = !!ann?.note?.content?.trim();
    notePanelSourceText.value = source;
    notePanelOpen.value = true;
    /** 笔记面板 registerModal 入栈瞬间不关闭工具条 */
    suppressToolbarUntilMs = Date.now() + 300;
  }

  const DICT_POPUP_W = 360;
  const DICT_POPUP_MAX_H = 420;
  const DICT_POPUP_MIN_H = 140;

  /**
   * 打开时按「最大可用高度」定一次位置与 maxHeight，之后不再随内容伸缩重算。
   * 否则查词/内部跳转导致高度变化时会改 top / 上下翻转，带动阅读区视觉抖动。
   */
  function applyDictionaryPopupPlacement() {
    const anchor = getAnchor();
    const editorClip = getEditorClipRect();
    const floatWidth = DICT_POPUP_W;
    const floatHeight = DICT_POPUP_MAX_H;

    if (anchor) {
      const spaceAbove = Math.max(
        0,
        anchor.anchorTop - FLOAT_GAP - (editorClip.top + FLOAT_MARGIN),
      );
      const spaceBelow = Math.max(
        0,
        editorClip.bottom - FLOAT_MARGIN - (anchor.lineBottom + FLOAT_GAP),
      );
      const maxAvail = Math.max(spaceAbove, spaceBelow, DICT_POPUP_MIN_H);
      const placeHeight = Math.min(floatHeight, maxAvail);

      const base = {
        selectionCenterX: anchor.selectionCenterX,
        anchorTop: anchor.anchorTop,
        lineBottom: anchor.lineBottom,
        floatHeight: placeHeight,
        floatWidth,
        gap: FLOAT_GAP,
        margin: FLOAT_MARGIN,
      };

      let placed = computeFloatPlacement({ ...base, clip: editorClip });
      const rightEdge = placed.centerX + floatWidth / 2;
      const windowRightLimit = window.innerWidth - FLOAT_MARGIN;
      if (rightEdge > windowRightLimit + 0.5) {
        placed = computeFloatPlacement({
          ...base,
          clip: {
            top: editorClip.top,
            bottom: editorClip.bottom,
            left: 0,
            right: window.innerWidth,
          },
        });
      }

      dictionaryPopupCenterX.value = placed.centerX;
      dictionaryPopupTop.value = placed.rootTop;
      dictionaryPopupOpenDownward.value = placed.openDownward;

      const avail = placed.openDownward
        ? editorClip.bottom - FLOAT_MARGIN - placed.rootTop
        : placed.rootTop - (editorClip.top + FLOAT_MARGIN);
      dictionaryPopupMaxHeight.value = Math.min(
        DICT_POPUP_MAX_H,
        Math.max(DICT_POPUP_MIN_H, avail),
      );
      return;
    }

    // 选区锚点不可用时，退回工具条坐标并按窗口钳制高度
    dictionaryPopupCenterX.value = floatCenterX.value;
    dictionaryPopupTop.value = floatRootTop.value;
    dictionaryPopupOpenDownward.value = floatOpenDownward.value;
    const fallbackAvail = floatOpenDownward.value
      ? window.innerHeight - FLOAT_MARGIN - floatRootTop.value
      : floatRootTop.value - FLOAT_MARGIN;
    dictionaryPopupMaxHeight.value = Math.min(
      DICT_POPUP_MAX_H,
      Math.max(DICT_POPUP_MIN_H, fallbackAvail),
    );
  }

  function openDictionaryPopupFromToolbar() {
    const text = draftText.value.trim();
    if (!text) {
      bindDraftFromSelection();
    }
    const word = draftText.value.trim();
    if (!word) return;
    dictionaryPopupWord.value = word;
    applyDictionaryPopupPlacement();
    dictionaryPopupOpen.value = true;
    closeToolbarUi();
    suppressToolbarUntilMs = Date.now() + 300;
  }

  function closeDictionaryPopup() {
    dictionaryPopupOpen.value = false;
    dictionaryPopupWord.value = "";
  }

  const TRANSLATE_POPUP_W = 380;
  const TRANSLATE_POPUP_MAX_H = 420;
  const TRANSLATE_POPUP_MIN_H = 140;
  const TRANSLATE_POPUP_ESTIMATE_H = 260;

  function disconnectTranslatePopupResizeObserver() {
    translatePopupResizeObserver?.disconnect();
    translatePopupResizeObserver = null;
  }

  function applyTranslatePopupPlacement(measuredHeight?: number) {
    const anchor = getAnchor();
    const editorClip = getEditorClipRect();
    const floatWidth = TRANSLATE_POPUP_W;
    let floatHeight =
      measuredHeight && measuredHeight > 0
        ? measuredHeight
        : TRANSLATE_POPUP_ESTIMATE_H;
    floatHeight = Math.min(
      TRANSLATE_POPUP_MAX_H,
      Math.max(TRANSLATE_POPUP_MIN_H, floatHeight),
    );

    if (anchor && editorClip) {
      const base = {
        selectionCenterX: anchor.selectionCenterX,
        anchorTop: anchor.anchorTop,
        lineBottom: anchor.lineBottom,
        floatHeight,
        floatWidth,
        gap: FLOAT_GAP,
        margin: FLOAT_MARGIN,
      };
      let placed = computeFloatPlacement({ ...base, clip: editorClip });
      const rightEdge = placed.centerX + floatWidth / 2;
      const windowRightLimit = window.innerWidth - FLOAT_MARGIN;
      if (rightEdge > windowRightLimit + 0.5) {
        placed = computeFloatPlacement({
          ...base,
          clip: {
            top: editorClip.top,
            bottom: editorClip.bottom,
            left: 0,
            right: window.innerWidth,
          },
        });
      }
      translatePopupCenterX.value = placed.centerX;
      translatePopupTop.value = placed.rootTop;
      translatePopupOpenDownward.value = placed.openDownward;
      const avail = placed.openDownward
        ? editorClip.bottom - FLOAT_MARGIN - placed.rootTop
        : placed.rootTop - (editorClip.top + FLOAT_MARGIN);
      translatePopupMaxHeight.value = Math.min(
        TRANSLATE_POPUP_MAX_H,
        Math.max(TRANSLATE_POPUP_MIN_H, avail),
      );
      return;
    }
    translatePopupCenterX.value = floatCenterX.value;
    translatePopupTop.value = floatRootTop.value;
    translatePopupOpenDownward.value = floatOpenDownward.value;
    const fallbackAvail = floatOpenDownward.value
      ? window.innerHeight - FLOAT_MARGIN - floatRootTop.value
      : floatRootTop.value - FLOAT_MARGIN;
    translatePopupMaxHeight.value = Math.min(
      TRANSLATE_POPUP_MAX_H,
      Math.max(TRANSLATE_POPUP_MIN_H, fallbackAvail),
    );
  }

  function observeTranslatePopupSize() {
    disconnectTranslatePopupResizeObserver();
    const el = translatePopupRootRef.value?.querySelector(".trPopup");
    if (!(el instanceof HTMLElement)) return;
    translatePopupResizeObserver = new ResizeObserver(() => {
      if (!translatePopupOpen.value) return;
      const h = el.getBoundingClientRect().height;
      if (h > 0) applyTranslatePopupPlacement(h);
    });
    translatePopupResizeObserver.observe(el);
  }

  function openTranslatePopupFromToolbar() {
    const text = draftText.value.trim();
    if (!text) bindDraftFromSelection();
    // 保留行首缩进；仅用 trim 判断是否有可译内容
    const quote = draftText.value;
    if (!quote.trim()) return;
    translatePopupText.value = quote;
    applyTranslatePopupPlacement();
    translatePopupOpen.value = true;
    closeToolbarUi();
    suppressToolbarUntilMs = Date.now() + 300;
    void nextTick(() => {
      observeTranslatePopupSize();
      const el = translatePopupRootRef.value?.querySelector(".trPopup");
      if (el instanceof HTMLElement) {
        const h = el.getBoundingClientRect().height;
        if (h > 0) applyTranslatePopupPlacement(h);
      }
    });
  }

  function closeTranslatePopup() {
    disconnectTranslatePopupResizeObserver();
    translatePopupOpen.value = false;
    translatePopupText.value = "";
  }

  function ensureNotePanelAnnotationRecord(): ReaderAnnotationRecord | null {
    const existing = resolveAnnotationById(notePanelTargetAnnotationId.value);
    if (existing) return existing;
    const range = notePanelPhysicalRange.value;
    const text = notePanelSourceText.value.trim();
    if (!range || !text) return null;
    const { text: physicalText, displayText } =
      createAnnotationTextsFromRange(range);
    return createAnnotationFromRange(range, physicalText, { displayText });
  }

  function resolveNotePanelSourceText(): string {
    const e = opts.editor.value;
    const m = opts.model.value;
    if (e && m) {
      const sel = e.getSelection();
      if (sel && !sel.isEmpty()) {
        const fromSel = collapseAnnotationQuoteText(m.getValueInRange(sel));
        if (fromSel) return fromSel;
      }
    }
    const fromDraft = collapseAnnotationQuoteText(draftText.value);
    if (fromDraft) return fromDraft;
    const ann = activeAnnotation();
    const fromAnn = ann ? collapseAnnotationQuoteText(displayTextForAnnotation(ann)) : "";
    if (fromAnn) return fromAnn;
    const range = draftPhysicalRange.value;
    if (range) {
      return collapseAnnotationQuoteText(displayTextInPhysicalRange(range));
    }
    return "";
  }

  function closeNotePanel() {
    notePanelOpen.value = false;
    notePanelDraft.value = "";
    notePanelSourceText.value = "";
    notePanelEditing.value = false;
    notePanelTargetAnnotationId.value = null;
    notePanelPhysicalRange.value = null;
  }

  function getToolbarAnchorRange(): monaco.IRange | null {
    const e = opts.editor.value;
    const m = opts.model.value;
    if (!e || !m) return null;
    const sel = e.getSelection();
    if (sel && !sel.isEmpty()) return sel;
    if (draftPhysicalRange.value) {
      return physicalRangeToMonacoRange(
        draftPhysicalRange.value,
        physicalToDisplay,
        opts.getPhysicalLineContent,
        columnMap(),
      );
    }
    const ann = activeAnnotation();
    if (ann) {
      return monacoRangeFromAnnotation(
        ann,
        physicalToDisplay,
        opts.getPhysicalLineContent,
        columnMap(),
      );
    }
    return null;
  }

  function isToolbarRangeInViewport(range: monaco.IRange): boolean {
    const e = opts.editor.value;
    if (!e) return false;
    const lifted = monaco.Range.lift(range);
    for (const vr of e.getVisibleRanges()) {
      if (lifted.intersectRanges(vr)) return true;
    }
    return false;
  }

  function getAnchor() {
    const e = opts.editor.value;
    const m = opts.model.value;
    if (!e || !m) return null;
    const range = getToolbarAnchorRange();
    if (!range) return null;
    return getRangeViewportAnchor(e, m, range);
  }

  function syncToolbarOnScroll() {
    const range = getToolbarAnchorRange();
    const inView = range != null && isToolbarRangeInViewport(range);
    const anchor = inView ? getAnchor() : null;

    if (toolbarVisible.value || colorPickerMode.value) {
      if (!inView || !anchor) {
        hideToolbarForScrollOut();
        return;
      }
      applyFloatPlacement(anchor);
      return;
    }

    if (toolbarScrollHidden && inView && anchor) {
      toolbarScrollHidden = false;
      toolbarVisible.value = true;
      applyFloatPlacement(anchor);
    }
  }

  const FLOAT_TOOLBAR_H = 72;
  const FLOAT_GAP = 6;
  const FLOAT_PICKER_H = 52;
  const FLOAT_MARGIN = 8;
  /** 单按钮约宽（含 gap）；与 `.selAction` min-width + padding 对齐 */
  const FLOAT_ACTION_W = 46;
  const FLOAT_TOOLBAR_PAD_X = 24;

  function getEditorClipRect() {
    const dom = opts.editor.value?.getDomNode();
    if (dom) {
      const r = dom.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
    }
    return {
      top: 0,
      left: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
  }

  function estimateFloatWidth(): number {
    const float = floatRootRef.value?.querySelector(".selFloatRoot");
    if (float instanceof HTMLElement) {
      const w = float.getBoundingClientRect().width;
      if (w > 0) return w;
    }
    /** 马克笔 / 波浪线 / 直线 + 记笔记 */
    let actions = 4;
    const buttons = opts.selectionToolbarButtons();
    if (buttons.copy) actions += 1;
    if (opts.monacoCustomHighlight()) actions += 1;
    if (buttons.find) actions += 1;
    if (buttons.dictionary) actions += 1;
    if (buttons.translate) actions += 1;
    if (opts.aiFeaturesEnabled() && buttons.askAi) actions += 1;
    return actions * FLOAT_ACTION_W + FLOAT_TOOLBAR_PAD_X;
  }

  function estimateFloatHeight(): number {
    if (!colorPickerMode.value) return FLOAT_TOOLBAR_H;
    return FLOAT_TOOLBAR_H + FLOAT_GAP + FLOAT_PICKER_H;
  }

  /**
   * 相对选区首行水平居中。优先钳在阅读区；
   * 仅当阅读区钳制后右侧仍会被窗口裁切时，水平改按窗口钳制（可伸入侧栏）。
   */
  function applyFloatPlacement(anchor: {
    selectionCenterX: number;
    anchorTop: number;
    lineBottom: number;
  }) {
    const floatWidth = estimateFloatWidth();
    const floatHeight = estimateFloatHeight();
    const editorClip = getEditorClipRect();
    const base = {
      selectionCenterX: anchor.selectionCenterX,
      anchorTop: anchor.anchorTop,
      lineBottom: anchor.lineBottom,
      floatHeight,
      floatWidth,
      gap: FLOAT_GAP,
      margin: FLOAT_MARGIN,
    };

    let placed = computeFloatPlacement({ ...base, clip: editorClip });
    const rightEdge = placed.centerX + floatWidth / 2;
    const windowRightLimit = window.innerWidth - FLOAT_MARGIN;
    if (rightEdge > windowRightLimit + 0.5) {
      placed = computeFloatPlacement({
        ...base,
        clip: {
          top: editorClip.top,
          bottom: editorClip.bottom,
          left: 0,
          right: window.innerWidth,
        },
      });
    }

    floatOpenDownward.value = placed.openDownward;
    floatRootTop.value = placed.rootTop;
    floatCenterX.value = placed.centerX;
  }

  function reflowToolbarPlacement() {
    const anchor = getAnchor();
    if (!anchor) return;
    applyFloatPlacement(anchor);
  }

  function bindDraftFromAnnotation(ann: ReaderAnnotationRecord) {
    activeAnnotationId.value = ann.id;
    draftText.value = displayTextForAnnotation(ann);
    draftPhysicalRange.value = annotationPhysicalRange(ann);
  }

  function bindDraftFromSelection() {
    const e = opts.editor.value;
    const m = opts.model.value;
    if (!e || !m) return false;
    const sel = e.getSelection();
    if (!sel || sel.isEmpty()) return false;

    // 严格按选区取文；勿 trim、勿自动补行首缩进（未选中的空白不算选区）
    const text = m.getValueInRange(sel);
    if (!text.trim()) return false;

    const phys = monacoRangeToPhysicalRange(
      sel,
      displayToPhysical,
      opts.getPhysicalLineContent,
      columnMap(),
    );
    const exact = findAnnotationMatchingExactSelection(
      opts.readerAnnotations(),
      sel,
      displayToPhysical,
      opts.getPhysicalLineContent,
      columnMap(),
    );
    const containedIn = findAnnotationContainingRange(
      opts.readerAnnotations(),
      phys,
    );
    if (exact) {
      bindDraftFromAnnotation(exact);
    } else {
      draftText.value = text;
      draftPhysicalRange.value = phys;
      /** 选区完全落在标注内：保留用户选区，但绑定标注以显示工具条激活态 */
      activeAnnotationId.value = containedIn?.id ?? null;
    }
    return true;
  }

  function showToolbarFromSelectionIfAny() {
    if (!canShowSelectionToolbar()) {
      closeToolbarUi();
      return;
    }
    if (!selectionToolbarHasVisibleActions()) {
      closeToolbarUi();
      return;
    }
    if (!opts.editor.value || !opts.model.value) {
      closeToolbarUi();
      return;
    }
    const sel = opts.editor.value.getSelection();
    if (!sel || sel.isEmpty()) {
      maybeCloseToolbarOnEmptySelection();
      return;
    }
    if (!bindDraftFromSelection()) {
      closeToolbarUi();
      return;
    }
    const anchor = getAnchor();
    if (!anchor) {
      closeToolbarUi();
      return;
    }
    applyFloatPlacement(anchor);
    toolbarScrollHidden = false;
    toolbarVisible.value = true;
    if (canUseSelectionAnnotationTools()) {
      syncPickerFromSelection(true);
    } else {
      colorPickerMode.value = null;
      lineationPickerType.value = null;
    }
  }

  function onSelectionChangedDuringInteraction() {
    if (!canShowSelectionToolbar()) return;
    if (selectionPointerActive) return;
    const sel = opts.editor.value?.getSelection();
    if (!sel || sel.isEmpty()) {
      maybeCloseToolbarOnEmptySelection();
      return;
    }
    if (!toolbarVisible.value) return;
    if (bindDraftFromSelection()) {
      if (canUseSelectionAnnotationTools()) {
        syncPickerFromSelection(true);
      }
    }
  }

  function findAnnotationAtClientPoint(
    clientX: number,
    clientY: number,
  ): ReaderAnnotationRecord | null {
    const ed = opts.editor.value;
    const m = opts.model.value;
    if (!ed || !m) return null;
    const pos = positionFromClientPoint(ed, clientX, clientY);
    if (!pos) return null;
    const hits = annotationHitsByLine.value.get(pos.lineNumber);
    if (hits?.length) {
      for (const h of hits) {
        const range: monaco.Range = new monaco.Range(
          pos.lineNumber,
          h.startColumn,
          pos.lineNumber,
          h.endColumnExclusive,
        );
        if (!range.containsPosition(pos)) continue;
        if (!clientXWithinSingleLineModelRange(ed, m, range, clientX)) continue;
        const ann = annotationsById.value.get(h.annotationId);
        if (ann && !ann.stale) return ann;
      }
    }
    const physicalLine = displayToPhysical(pos.lineNumber);
    const physicalColumn = displayColumnToPhysicalColumn(
      opts.getPhysicalLineContent(physicalLine),
      pos.column,
      columnMap(),
    );
    return findAnnotationAtPoint(
      opts.readerAnnotations(),
      physicalLine,
      physicalColumn,
    );
  }

  /** 点击标注区域：弹出工具条并绑定该标注，但不改变编辑器选区 */
  function showToolbarForAnnotationClick(ann: ReaderAnnotationRecord) {
    if (!canUseSelectionAnnotationTools() || opts.readerEditMode()) return false;
    const ed = opts.editor.value;
    const m = opts.model.value;
    if (!ed || !m || ann.stale) return false;
    bindDraftFromAnnotation(ann);
    const range = monacoRangeFromAnnotation(
      ann,
      physicalToDisplay,
      opts.getPhysicalLineContent,
      columnMap(),
    );
    const anchor = getRangeViewportAnchor(ed, m, range);
    if (!anchor) return false;
    applyFloatPlacement(anchor);
    toolbarScrollHidden = false;
    toolbarVisible.value = true;
    syncPickerFromSelection(true);
    return true;
  }

  function tryShowToolbarFromAnnotationPoint(
    clientX: number,
    clientY: number,
  ): boolean {
    const ann = findAnnotationAtClientPoint(clientX, clientY);
    if (!ann || ann.stale) return false;
    return showToolbarForAnnotationClick(ann);
  }

  function clearAnnotationViewportDecorations() {
    if (annotationViewportSyncTimer) {
      clearTimeout(annotationViewportSyncTimer);
      annotationViewportSyncTimer = null;
    }
    annotationViewportDecorLastKey = "";
    annotationViewportDecorLastCount = 0;
    annotationViewportSyncRetry = 0;
    annotationHitsByLine.value = new Map();
    opts.annotationDecorationsCollection.value?.clear();
  }

  function rebuildAnnotationIndex() {
    const list = opts.readerAnnotations().filter((a) => !a.stale);
    const idMap = new Map<string, ReaderAnnotationRecord>();
    for (const a of list) idMap.set(a.id, a);
    annotationsById.value = idMap;

    if (opts.readerEditMode()) {
      clearAnnotationViewportDecorations();
      closeToolbarUi();
      opts.onAnnotationIndexRebuilt?.();
      return;
    }

    bindAnnotationNoteHoverQuery();
    annotationHitsByLine.value = buildAnnotationHitsByDisplayLine(
      list,
      physicalToDisplay,
      opts.getPhysicalLineContent,
      columnMap(),
      opts.lineationColorsLength(),
    );
    annotationViewportDecorLastKey = "";
    annotationViewportSyncRetry = 0;
    scheduleAnnotationViewportSync(true);
    opts.onAnnotationIndexRebuilt?.();
  }

  async function waitForEditorLayoutReady(): Promise<boolean> {
    for (let i = 0; i < ANNOTATION_VIEWPORT_SYNC_MAX_RETRY; i++) {
      const ed = opts.editor.value;
      const m = opts.model.value;
      if (
        ed &&
        m &&
        m.getLineCount() > 0 &&
        ed.getVisibleRanges().length > 0
      ) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        return true;
      }
      await new Promise((r) => setTimeout(r, ANNOTATION_VIEWPORT_SYNC_RETRY_MS));
    }
    return false;
  }

  function refreshAnnotationDecorations() {
    void waitForEditorLayoutReady().then(() => {
      rebuildAnnotationIndex();
    });
  }

  function noteHoverSuppressId(): string | null {
    return toolbarVisible.value && activeAnnotationId.value
      ? activeAnnotationId.value
      : null;
  }

  function bindAnnotationNoteHoverQuery() {
    if (annotationNoteHoverQueryDisposable) return;
    annotationNoteHoverQueryDisposable = registerAnnotationNoteHoverQuery(
      (model, position) => {
        if (opts.readerEditMode()) return null;
        if (model !== opts.model.value) return null;
        const maxCol = model.getLineMaxColumn(position.lineNumber);
        const found = annotationNotesAtColumn(
          annotationHitsByLine.value.get(position.lineNumber),
          position.column,
          maxCol,
          noteHoverSuppressId(),
        );
        if (!found) return null;
        return {
          // 覆盖整行，折行后鼠标锚点是整段 view line 时仍视为同一悬停
          range: new monaco.Range(
            position.lineNumber,
            1,
            position.lineNumber,
            maxCol,
          ),
          contents: found.notes.map(annotationNoteToHoverMarkdown),
        };
      },
    );
  }

  function dismissEditorContentHover() {
    const ed = opts.editor.value;
    if (!ed) return;
    (
      ed.getContribution("editor.contrib.contentHover") as {
        hideContentHover?: () => void;
      } | null
    )?.hideContentHover?.();
  }

  function syncAnnotationViewportDecorationsNow() {
    const ed = opts.editor.value;
    const m = opts.model.value;
    const collection = opts.annotationDecorationsCollection.value;
    if (!ed || !m || !collection) return;
    if (opts.readerEditMode()) {
      collection.clear();
      annotationViewportDecorLastKey = "";
      annotationViewportDecorLastCount = 0;
      return;
    }
    if (annotationHitsByLine.value.size === 0) {
      collection.clear();
      annotationViewportDecorLastKey = "";
      annotationViewportDecorLastCount = 0;
      return;
    }
    const ranges = ed.getVisibleRanges();
    if (!ranges.length) {
      if (
        annotationViewportSyncRetry < ANNOTATION_VIEWPORT_SYNC_MAX_RETRY &&
        annotationHitsByLine.value.size > 0
      ) {
        annotationViewportSyncRetry++;
        if (annotationViewportSyncTimer) {
          clearTimeout(annotationViewportSyncTimer);
        }
        annotationViewportSyncTimer = setTimeout(() => {
          annotationViewportSyncTimer = null;
          syncAnnotationViewportDecorationsNow();
        }, ANNOTATION_VIEWPORT_SYNC_RETRY_MS);
      }
      return;
    }
    annotationViewportSyncRetry = 0;
    let lo = ranges[0]!.startLineNumber;
    let hi = ranges[0]!.endLineNumber;
    for (const r of ranges) {
      lo = Math.min(lo, r.startLineNumber);
      hi = Math.max(hi, r.endLineNumber);
    }
    lo = Math.max(1, lo - ANNOTATION_VIEWPORT_BUFFER_LINES);
    hi = hi + ANNOTATION_VIEWPORT_BUFFER_LINES;
    const key = `${lo}:${hi}`;
    if (
      key === annotationViewportDecorLastKey &&
      annotationViewportDecorLastCount > 0
    ) {
      return;
    }
    const decs = buildAnnotationDecorationsForViewport(
      lo,
      hi,
      annotationHitsByLine.value,
      m,
    );
    annotationViewportDecorLastKey = key;
    annotationViewportDecorLastCount = decs.length;
    collection.set(decs);
  }

  function scheduleAnnotationViewportSync(force = false) {
    if (opts.readerEditMode()) {
      if (force) syncAnnotationViewportDecorationsNow();
      return;
    }
    if (force) {
      if (annotationViewportSyncTimer) {
        clearTimeout(annotationViewportSyncTimer);
        annotationViewportSyncTimer = null;
      }
      syncAnnotationViewportDecorationsNow();
      return;
    }
    if (annotationViewportSyncTimer) return;
    annotationViewportSyncTimer = setTimeout(() => {
      annotationViewportSyncTimer = null;
      syncAnnotationViewportDecorationsNow();
    }, ANNOTATION_VIEWPORT_SYNC_MS);
  }

  function bindAnnotationScrollSync(ed: monaco.editor.IStandaloneCodeEditor) {
    annotationScrollDisposable?.dispose();
    annotationScrollDisposable = ed.onDidScrollChange(() => {
      scheduleAnnotationViewportSync();
      syncToolbarOnScroll();
    });
  }

  function disposeAnnotationDecorations() {
    cancelSelectionPointerInteraction();
    clearAnnotationViewportDecorations();
    annotationsById.value = new Map();
    annotationScrollDisposable?.dispose();
    annotationScrollDisposable = null;
    annotationNoteHoverQueryDisposable?.dispose();
    annotationNoteHoverQueryDisposable = null;
  }

  function prepareLineationTargetAnnotation(): ReaderAnnotationRecord | null {
    const m = opts.model.value;
    if (!m) return null;
    const range = draftPhysicalRange.value;
    const text = draftText.value.trim();
    if (!range || !text) return null;

    const existing = activeAnnotation();
    if (existing && rangesEqual(annotationPhysicalRange(existing), range)) {
      return existing;
    }

    const overlaps = findAnnotationsIntersectingRange(
      opts.readerAnnotations(),
      range,
    );
    for (const ann of overlaps) {
      opts.emitRemove(ann.id);
    }

    const mergedRange = unionPhysicalRanges([
      range,
      ...overlaps.map((ann) => annotationPhysicalRange(ann)),
    ]);
    const { text: mergedText, displayText } =
      createAnnotationTextsFromRange(mergedRange);
    if (!mergedText) return null;

    const ann = createAnnotationFromRange(mergedRange, mergedText, {
      displayText,
    });
    activeAnnotationId.value = ann.id;
    draftPhysicalRange.value = mergedRange;
    draftText.value = displayText ?? mergedText;
    return ann;
  }

  function applyLineation(
    type: ReaderLineationType,
    colorIndex: number,
    options?: { openPicker?: boolean },
  ) {
    const idx = clampLineationColorIndex(
      parseLineationColorIndexRaw(colorIndex),
      opts.lineationColorsLength(),
    );
    let ann = prepareLineationTargetAnnotation();
    if (!ann) return;
    ann = {
      ...ann,
      lineation: { type, colorIndex: idx },
      updatedAt: Date.now(),
    };
    opts.emitUpsert(ann);
    activeAnnotationId.value = ann.id;
    syncLineationLastColor(type, idx);
    const openPicker = options?.openPicker !== false;
    if (openPicker) {
      colorPickerMode.value = "lineation";
      lineationPickerType.value = type;
    } else if (colorPickerMode.value === "lineation") {
      lineationPickerType.value = type;
    }
  }

  /** 快捷键用：优先按当前选区重绑 draft；失败则回退已有 draft / active */
  function ensureDraftForShortcut(): boolean {
    if (bindDraftFromSelection()) return true;
    if (activeAnnotationId.value) {
      const ann = activeAnnotation();
      if (ann) {
        bindDraftFromAnnotation(ann);
        return Boolean(draftText.value.trim() && draftPhysicalRange.value);
      }
    }
    return Boolean(draftText.value.trim() && draftPhysicalRange.value);
  }

  function lastColorIndexForType(type: ReaderLineationType): number {
    /** 无效值 → 0；勿直接 clamp(undefined) 落到末色 */
    return clampLineationColorIndex(
      parseLineationColorIndexRaw(opts.lineationLastColors()[type]),
      opts.lineationColorsLength(),
    );
  }

  /** 快捷键取消划线；关闭色盘，工具条保持。 */
  function removeLineationOnShortcut(ann: ReaderAnnotationRecord): void {
    if (ann.note?.content?.trim()) {
      opts.emitUpsert({ ...ann, lineation: undefined, updatedAt: Date.now() });
      activeAnnotationId.value = ann.id;
    } else {
      opts.emitRemove(ann.id);
      activeAnnotationId.value = null;
    }
    closeColorPicker();
  }

  function canUseSelectionToolbarDigitShortcut(): boolean {
    if (opts.readerEditMode()) return false;
    if (!canUseSelectionAnnotationTools()) return false;
    if (toolbarVisible.value) return true;
    const e = opts.editor.value;
    const m = opts.model.value;
    const sel = e?.getSelection();
    if (sel && !sel.isEmpty() && m) {
      if (m.getValueInRange(sel).trim()) return true;
    }
    if (draftText.value.trim() && draftPhysicalRange.value) return true;
    return Boolean(activeAnnotationId.value);
  }

  function openPickerForShortcut(
    mode: "highlight" | "lineation",
    type?: ReaderLineationType,
  ): void {
    toolbarVisible.value = true;
    colorPickerMode.value = mode;
    lineationPickerType.value = mode === "lineation" ? (type ?? null) : null;
  }

  /** 快捷键：设置高亮词 ↔ 取消高亮词（新建用上次颜色；取消时关色盘） */
  function toggleHighlightFromShortcut(): boolean {
    if (!opts.monacoCustomHighlight()) return false;
    if (!ensureDraftForShortcut()) return false;
    const t = highlightTermTextForStorage();
    if (!t) return false;
    if (opts.highlightColorsLength() <= 0) return false;
    const idx = findStoredHighlightColorIndex(t);
    if (idx == null) {
      applyHighlightTerm(lastHighlightColorIndex());
      openPickerForShortcut("highlight");
    } else {
      opts.emitRemoveHighlightTerm({ text: t });
      closeColorPicker();
    }
    return true;
  }

  /**
   * 快捷键：同类型划线 ↔ 取消；跨类型则切换到目标类型（用该类型上次颜色）。
   * 取消时关色盘；标注时打开对应色盘。
   */
  function toggleLineationFromShortcut(type: ReaderLineationType): boolean {
    if (!ensureDraftForShortcut()) return false;
    let ann = activeAnnotation();
    if (!ann?.lineation?.type && draftPhysicalRange.value) {
      const containing = findAnnotationContainingRange(
        opts.readerAnnotations(),
        draftPhysicalRange.value,
      );
      if (containing?.lineation?.type) {
        bindDraftFromAnnotation(containing);
        ann = containing;
      }
    }

    const existing = ann?.lineation;
    if (existing?.type === type) {
      removeLineationOnShortcut(ann!);
      return true;
    }
    applyLineation(type, lastColorIndexForType(type), { openPicker: true });
    openPickerForShortcut("lineation", type);
    return true;
  }

  function isSelectionToolbarDigitKeyBlockedTarget(
    target: EventTarget | null,
  ): boolean {
    if (!(target instanceof Element)) return false;
    if (target.closest(".find-widget")) return true;
    /**
     * 只读正文焦点落在 Monaco 隐藏 textarea（.inputarea）上；
     * 不能按普通输入框拦截，否则划词后数字快捷键永远不触发。
     * （查找栏已在上方单独拦截。）
     */
    const editorDom = opts.editor.value?.getDomNode();
    if (editorDom && editorDom.contains(target) && !opts.readerEditMode()) {
      return false;
    }
    if (
      target.closest(
        "input, textarea, select, [contenteditable=''], [contenteditable='true']",
      )
    ) {
      return true;
    }
    return false;
  }

  /**
   * 按钮未展示时快捷键不生效（与工具条 v-if 一致）。
   * `1` 复制 / `2` 高亮词 / `3`–`5` 划线 / `6` 笔记 / `7` 查找 / `8` 词典 / `9` 翻译 / `0` 问 AI
   */
  function isSelectionToolbarDigitEnabled(
    digit: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  ): boolean {
    const b = opts.selectionToolbarButtons();
    if (digit === 1) return b.copy;
    if (digit === 2) {
      return canUseSelectionAnnotationTools() && opts.monacoCustomHighlight();
    }
    if (digit === 3 || digit === 4 || digit === 5 || digit === 6) {
      return canUseSelectionAnnotationTools();
    }
    if (digit === 7) return b.find;
    if (digit === 8) return b.dictionary;
    if (digit === 9) return b.translate;
    return opts.aiFeaturesEnabled() && b.askAi;
  }

  function runToolbarActionFromShortcut(
    action: "copy" | "find" | "dictionary" | "translate" | "askAi" | "note",
  ): boolean {
    if (!ensureDraftForShortcut()) return false;
    if (action === "note") {
      openNotePanelFromToolbar();
      return true;
    }
    if (!draftText.value.trim()) return false;
    onToolbarAction(action);
    return true;
  }

  /**
   * 只读选区工具条数字快捷键（见 {@link isSelectionToolbarDigitEnabled}）。
   * 命中且按钮启用时 preventDefault + stopPropagation；否则返回 false。
   */
  function onSelectionToolbarDigitKey(ev: KeyboardEvent): boolean {
    if (ev.defaultPrevented) return false;
    if (ev.isComposing) return false;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return false;
    if (notePanelOpen.value || dictionaryPopupOpen.value || translatePopupOpen.value) {
      return false;
    }
    if (isSelectionToolbarDigitKeyBlockedTarget(ev.target)) return false;
    if (!canUseSelectionToolbarDigitShortcut()) return false;

    const code = ev.code;
    let digit: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | null = null;
    if (code === "Digit0" || code === "Numpad0") digit = 0;
    else if (code === "Digit1" || code === "Numpad1") digit = 1;
    else if (code === "Digit2" || code === "Numpad2") digit = 2;
    else if (code === "Digit3" || code === "Numpad3") digit = 3;
    else if (code === "Digit4" || code === "Numpad4") digit = 4;
    else if (code === "Digit5" || code === "Numpad5") digit = 5;
    else if (code === "Digit6" || code === "Numpad6") digit = 6;
    else if (code === "Digit7" || code === "Numpad7") digit = 7;
    else if (code === "Digit8" || code === "Numpad8") digit = 8;
    else if (code === "Digit9" || code === "Numpad9") digit = 9;
    else return false;

    if (!isSelectionToolbarDigitEnabled(digit)) return false;

    let handled = false;
    if (digit === 1) {
      handled = runToolbarActionFromShortcut("copy");
    } else if (digit === 2) {
      handled = toggleHighlightFromShortcut();
    } else if (digit === 3) {
      handled = toggleLineationFromShortcut("marker");
    } else if (digit === 4) {
      handled = toggleLineationFromShortcut("wavy");
    } else if (digit === 5) {
      handled = toggleLineationFromShortcut("straight");
    } else if (digit === 6) {
      handled = runToolbarActionFromShortcut("note");
    } else if (digit === 7) {
      handled = runToolbarActionFromShortcut("find");
    } else if (digit === 8) {
      handled = runToolbarActionFromShortcut("dictionary");
    } else if (digit === 9) {
      handled = runToolbarActionFromShortcut("translate");
    } else {
      handled = runToolbarActionFromShortcut("askAi");
    }

    if (!handled) return false;
    ev.preventDefault();
    ev.stopPropagation();
    return true;
  }

  function removeActiveLineation() {
    const ann = activeAnnotation();
    if (!ann?.lineation) return;
    if (ann.note?.content?.trim()) {
      opts.emitUpsert({ ...ann, lineation: undefined, updatedAt: Date.now() });
      activeAnnotationId.value = ann.id;
    } else {
      opts.emitRemove(ann.id);
      activeAnnotationId.value = null;
    }
    closeColorPicker();
  }

  function onToolbarAction(
    action:
      | "copy"
      | "highlight"
      | "marker"
      | "wavy"
      | "straight"
      | "note"
      | "find"
      | "dictionary"
      | "translate"
      | "askAi",
  ) {
    if (
      !canUseSelectionAnnotationTools() &&
      (action === "note" ||
        action === "highlight" ||
        action === "marker" ||
        action === "wavy" ||
        action === "straight")
    ) {
      return;
    }
    if (action === "note") {
      openNotePanelFromToolbar();
      return;
    }
    const text = draftText.value.trim();
    if (!text) return;
    if (action === "copy") {
      void navigator.clipboard.writeText(text).then(
        () => {
          appToast("已复制到剪贴板", { kind: "success", duration: 1000 });
        },
        () => {
          /* ignore */
        },
      );
      return;
    }
    if (action === "find") {
      closeToolbarUi();
      opts.emitFindWithQuote(text);
      return;
    }
    if (action === "dictionary") {
      openDictionaryPopupFromToolbar();
      return;
    }
    if (action === "translate") {
      openTranslatePopupFromToolbar();
      return;
    }
    if (action === "askAi") {
      opts.emitAskAiWithQuote(text);
      /** 切换侧栏 / 聚焦 AI 输入框时避免误关工具条 */
      suppressToolbarUntilMs = Date.now() + 500;
      return;
    }
    if (action === "highlight") {
      colorPickerMode.value = "highlight";
      lineationPickerType.value = null;
      const existing = findStoredHighlightColorIndex(draftText.value);
      if (existing == null) {
        /** 与划线按钮一致：未设置时用「上次颜色」自动添加 */
        applyHighlightTerm(lastHighlightColorIndex());
      } else {
        syncHighlightLastColor(existing);
      }
      return;
    }
    const typeMap = {
      marker: "marker" as const,
      wavy: "wavy" as const,
      straight: "straight" as const,
    };
    if (action in typeMap) {
      const type = typeMap[action as keyof typeof typeMap];
      const ann = activeAnnotation();
      if (ann?.lineation?.type === type) {
        colorPickerMode.value = "lineation";
        lineationPickerType.value = type;
        return;
      }
      colorPickerMode.value = "lineation";
      lineationPickerType.value = type;
      applyLineation(type, lastColorIndexForType(type));
    }
  }

  function jumpToAnnotationRange(
    ann: ReaderAnnotationRecord,
    options?: { smooth?: boolean },
  ) {
    const ed = opts.editor.value;
    if (!ed) return;
    const range = monacoRangeFromAnnotation(
      ann,
      physicalToDisplay,
      opts.getPhysicalLineContent,
      columnMap(),
    );
    ed.revealRangeInCenter(
      range,
      options?.smooth
        ? monaco.editor.ScrollType.Smooth
        : monaco.editor.ScrollType.Immediate,
    );
    ed.setSelection(range);
    suppressToolbarUntilMs = Date.now() + 300;
    closeToolbarUi();
  }

  watch(() => opts.readerAnnotations(), rebuildAnnotationIndex, { deep: true });

  watch(
    () => [opts.leadIndentFullWidth(), opts.readerEditMode()] as const,
    rebuildAnnotationIndex,
  );

  watch(() => opts.lineationColorsLength(), () => {
    rebuildAnnotationIndex();
  });

  watch(
    () => opts.readerFilePath(),
    () => {
      annotationViewportDecorLastKey = "";
      annotationViewportDecorLastCount = 0;
      rebuildAnnotationIndex();
    },
  );

  watch(
    () => opts.model.value,
    () => {
      annotationViewportDecorLastKey = "";
      annotationViewportDecorLastCount = 0;
      annotationViewportSyncRetry = 0;
      scheduleAnnotationViewportSync(true);
    },
  );

  watch(colorPickerMode, () => {
    if (!toolbarVisible.value) return;
    void nextTick(() => reflowToolbarPlacement());
  });

  watch([toolbarVisible, activeAnnotationId], () => {
    if (toolbarVisible.value) {
      dismissEditorContentHover();
      syncPickerFromSelection(false);
    }
  });

  watch(toolbarVisible, (v) => {
    if (!v) {
      removeGlobalListeners?.();
      removeGlobalListeners = null;
      return;
    }
    /** 首帧按估算宽度放置，挂载后按实测宽度再钳一次（含伸入侧栏） */
    void nextTick(() => reflowToolbarPlacement());
    const onDocPointerDown = (ev: PointerEvent) => {
      if (floatRootRef.value?.contains(ev.target as Node)) return;
      if (notePanelRootRef.value?.contains(ev.target as Node)) return;
      if (dictionaryPopupRootRef.value?.contains(ev.target as Node)) return;
      if (translatePopupRootRef.value?.contains(ev.target as Node)) return;
      const editorDom = opts.editor.value?.getDomNode();
      if (!editorDom?.contains(ev.target as Node)) return;
      closeToolbarUi();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    removeGlobalListeners = () =>
      document.removeEventListener("pointerdown", onDocPointerDown, true);
  });

  return {
    toolbarVisible,
    colorPickerMode,
    lineationPickerType,
    floatCenterX,
    floatRootTop,
    floatOpenDownward,
    floatRootRef,
    activeLineation,
    toolbarHasLineation,
    toolbarHasNote,
    lineationPickerSelectedIndex,
    hlPickerShowRemoveRow,
    hlPickerExistingColorIndex,
    notePanelOpen,
    notePanelDraft,
    notePanelEditing,
    notePanelSourceText,
    notePanelRootRef,
    dictionaryPopupOpen,
    dictionaryPopupWord,
    dictionaryPopupCenterX,
    dictionaryPopupTop,
    dictionaryPopupOpenDownward,
    dictionaryPopupMaxHeight,
    dictionaryPopupRootRef,
    closeDictionaryPopup,
    translatePopupOpen,
    translatePopupText,
    translatePopupCenterX,
    translatePopupTop,
    translatePopupOpenDownward,
    translatePopupMaxHeight,
    translatePopupRootRef,
    closeTranslatePopup,
    closeToolbarUi,
    showToolbarFromSelectionIfAny,
    syncToolbarOnScroll,
    onSelectionChangedDuringInteraction,
    onToolbarAction,
    onSelectionToolbarDigitKey,
    onHighlightPickConfirm: (colorIndex: number) => {
      if (colorIndex < 0 || colorIndex >= opts.highlightColorsLength()) return;
      applyHighlightTerm(colorIndex);
    },
    onHighlightPickRemove: () => {
      const t = highlightTermTextForStorage();
      if (t) opts.emitRemoveHighlightTerm({ text: t });
      closeColorPicker();
    },
    onLineationPickConfirm: (colorIndex: number) => {
      const type = lineationPickerType.value;
      if (
        !type ||
        colorIndex < 0 ||
        colorIndex >= opts.lineationColorsLength()
      ) {
        return;
      }
      applyLineation(type, colorIndex);
    },
    onLineationPickRemove: () => {
      removeActiveLineation();
    },
    onNotePanelConfirm: (content: string) => {
      let ann = ensureNotePanelAnnotationRecord();
      if (!ann) return;
      const now = Date.now();
      ann = {
        ...ann,
        note: { content, createdAt: ann.note?.createdAt ?? now, updatedAt: now },
        updatedAt: now,
      };
      opts.emitUpsert(ann);
      notePanelTargetAnnotationId.value = ann.id;
      closeNotePanel();
    },
    onNotePanelDelete: () => {
      const ann =
        resolveAnnotationById(notePanelTargetAnnotationId.value) ??
        activeAnnotation();
      if (!ann?.note) return;
      if (ann.lineation) {
        opts.emitUpsert({ ...ann, note: undefined, updatedAt: Date.now() });
      } else {
        opts.emitRemove(ann.id);
      }
      closeNotePanel();
      closeToolbarUi();
    },
    closeNotePanel,
    beginSelectionPointerInteraction,
    cancelSelectionPointerInteraction,
    tryShowToolbarFromAnnotationPoint,
    jumpToAnnotationRange,
    getAnnotationDisplayQuote,
    getAnnotationHitsByLine: () => annotationHitsByLine.value,
    rebuildAnnotationIndex,
    refreshAnnotationDecorations,
    bindAnnotationScrollSync,
    disposeAnnotationDecorations,
    shouldSuppressToolbar,
    setSuppressToolbarUntilMs: (ms: number) => {
      suppressToolbarUntilMs = ms;
    },
  };
}
