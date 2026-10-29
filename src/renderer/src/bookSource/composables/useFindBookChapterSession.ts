import {
  computed,
  nextTick,
  ref,
  type ComputedRef,
  type Ref,
} from "vue";
import type ReaderMain from "../../components/ReaderMain.vue";
import type { Book, BookChapter, SearchBookItem } from "@shared/bookSource/types";
import type { ReplaceRule } from "@shared/bookSource/replaceRule";
import {
  applyContentReplaceWithRules,
  applyTitleReplaceWithRules,
  filterEnabledReplaceRules,
} from "@shared/bookSource/replaceRuleApply";
import { listReplaceRulesLocal } from "../replaceRuleLocalStore";
import { formatPhysicalPlainTextForReader } from "../../reader/readerDisplayPipeline";
import type { ChapterTitleBlankMode } from "../../constants/appUi";
import type { ReaderViewportRestoreAnchor } from "../../reader/readerViewportAnchor";
import { applyTextDisplayConverts } from "../../services/textConvertApply";
import { afterNextPaints } from "../../ebook/yieldToUi";
import { appConfirm } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import { appLoading } from "../../services/appLoading";
import {
  replaceTextInPhysicalLines,
  type AnnotationRange,
} from "../../utils/readerAnnotations";
import {
  contentChaptersInReadingOrder,
  displayIndexForReadingOrder,
  readingOrderIndexFromDisplay,
} from "../chapterReadingOrder";
import { useBookSourceChapterContent } from "./useBookSource";
import type {
  TextConvertWidthMode,
  TextConvertZhMode,
} from "@shared/textConvertTypes";

export type FindBookChapterSessionDeps = {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  detail: () => Book;
  item: () => SearchBookItem;
  displayChapters: ComputedRef<BookChapter[]> | Ref<BookChapter[]>;
  contentChapters: ComputedRef<BookChapter[]> | Ref<BookChapter[]>;
  chapterSortDesc: Ref<boolean>;
  currentDisplayIndex: Ref<number>;
  readerBootLoading: ComputedRef<boolean> | Ref<boolean>;
  textConvertZh: Ref<TextConvertZhMode>;
  textConvertLetter: Ref<TextConvertWidthMode>;
  textConvertDigit: Ref<TextConvertWidthMode>;
  compressBlankLines: Ref<boolean>;
  compressBlankKeepOneBlank: Ref<boolean>;
  chapterTitleBlankMode: Ref<ChapterTitleBlankMode>;
  leadIndentFullWidth: Ref<boolean>;
  chapterMinCharCount: Ref<number>;
  effectiveCacheDir: Ref<string>;
  isChapterCached: (ch: BookChapter) => boolean;
  markChapterCached: (url: string) => void;
  isInBookshelf: (bookUrl: string, origin: string) => boolean;
  updateReadProgress: (
    bookUrl: string,
    origin: string,
    chapterIndex: number,
    chapterTitle?: string,
  ) => void;
  scrollChapterListToCurrent: (options?: {
    force?: boolean;
    smooth?: boolean;
  }) => Promise<void>;
  /** 进入编辑前退出朗读（可晚绑定） */
  exitVoiceRead: () => void;
  /** 进入编辑前停止定时滚动（可晚绑定） */
  stopTimedScroll: () => void;
  readerEditMode: Ref<boolean>;
  readingRulerEnabled: Ref<boolean>;
  /** 晚绑定：朗读中（含暂停）不走阅读尺居中 */
  isVoiceReadActive?: () => boolean;
};

/**
 * 找书阅读器章节会话：加载正文、展示管线渲染、编辑进出/保存。
 * 面板负责编排与侧栏/页脚 UI；本 composable 持有章节内容状态。
 */
export function useFindBookChapterSession(deps: FindBookChapterSessionDeps) {
  const readerContentKey = ref<string | null>(null);
  const lastChapterTitle = ref("");
  const lastChapterBody = ref("");
  /** 阅读展示中章节标题所在行（切章阅读尺居中用） */
  let lastChapterTitleDisplayLine = 1;
  const totalLineCount = ref(0);
  const readerEditMode = deps.readerEditMode;
  const readerEditorDirty = ref(false);
  /** 章节保存 / 局部编辑写缓存中 */
  const readerChapterSaving = ref(false);
  /** 切章过程（含列表滚动等待）；与 IPC chapterLoading 合并为 chapterContentBusy */
  const loading = ref(false);
  /** 仅切到未缓存章节时为 true，控制侧栏 loading 图标与「加载中」提示 */
  const showChapterLoadingUi = ref(false);

  const {
    loading: chapterLoading,
    error: chapterError,
    logs,
    load: loadChapterContent,
    cancel: cancelChapterLoad,
  } = useBookSourceChapterContent();

  /** 展示管线用规则缓存（原文在 lastChapter*；规则变更时刷新） */
  const cachedReplaceRules = ref<ReplaceRule[]>([]);
  const replaceRulesLoaded = ref(false);
  /** 最近一次阅读渲染：展示行 → 管线物理行（进出编辑恢复视口用） */
  const lastDisplayLineToPhysicalLine = ref<number[] | null>(null);
  /**
   * 阅读展示管线物理行（文本替换 + 转换之后、压缩空行之前），
   * 与 `lastDisplayLineToPhysicalLine` 下标一致；供局部编辑选区映射。
   */
  const lastReaderPhysicalLines = ref<string[]>([]);
  /** 最近一次写入 ReaderMain 的展示正文（摸鱼热换章用，不依赖隐藏窗 Monaco） */
  const lastRenderedReaderText = ref("");

  function viewportDisplayLineToPhysicalLine(displayLine: number): number {
    const v = Math.max(1, Math.floor(displayLine));
    const map = lastDisplayLineToPhysicalLine.value;
    if (!map?.length) return v;
    const idx = v - 1;
    if (idx < 0) return 1;
    if (idx >= map.length) return map[map.length - 1] ?? v;
    return map[idx]!;
  }

  function getPhysicalLineContent(physicalLine: number): string {
    const idx = Math.max(1, Math.floor(physicalLine)) - 1;
    return lastReaderPhysicalLines.value[idx] ?? "";
  }

  function captureEditViewportAnchor(): ReaderViewportRestoreAnchor {
    return (
      deps.readerRef.value?.captureViewportRestoreAnchor?.() ?? {
        physicalLine: Math.max(
          1,
          Math.floor(deps.readerRef.value?.getViewportEndLine?.() ?? 1),
        ),
        wrappedLineIndex: 0,
      }
    );
  }

  async function refreshReplaceRulesCache() {
    try {
      cachedReplaceRules.value = listReplaceRulesLocal("findBook");
    } catch {
      cachedReplaceRules.value = [];
    } finally {
      replaceRulesLoaded.value = true;
    }
  }

  async function ensureReplaceRulesCache() {
    if (!replaceRulesLoaded.value) await refreshReplaceRulesCache();
  }

  function applyDisplayReplaceTitle(title: string): string {
    if (!title) return title;
    const d = deps.detail();
    const it = deps.item();
    const rules = filterEnabledReplaceRules(
      cachedReplaceRules.value,
      d.name || "",
      it.origin || "",
      "title",
    );
    return applyTitleReplaceWithRules(title, rules);
  }

  function applyDisplayReplaceBody(body: string): string {
    const d = deps.detail();
    const it = deps.item();
    const rules = filterEnabledReplaceRules(
      cachedReplaceRules.value,
      d.name || "",
      it.origin || "",
      "content",
    );
    return applyContentReplaceWithRules(body, rules);
  }

  /** 有已启用的规则 → 工具栏按钮激活（无总开关） */
  const textReplaceActive = computed(() => {
    const d = deps.detail();
    const it = deps.item();
    const name = d.name || "";
    const origin = it.origin || "";
    const rules = cachedReplaceRules.value;
    return (
      filterEnabledReplaceRules(rules, name, origin, "content").length > 0 ||
      filterEnabledReplaceRules(rules, name, origin, "title").length > 0
    );
  });

  function textConvertOptions() {
    return {
      zh: deps.textConvertZh.value,
      letter: deps.textConvertLetter.value,
      digit: deps.textConvertDigit.value,
    };
  }

  function contentIndexFor(ch: BookChapter): number {
    return deps.contentChapters.value.findIndex((c) => c.url === ch.url);
  }

  async function ensureChapterScrollAtTop() {
    for (let i = 0; i < 30 && !deps.readerRef.value; i++) {
      await nextTick();
    }
    const reader = deps.readerRef.value;
    if (!reader) return;
    const rulerFocus =
      deps.readingRulerEnabled.value &&
      !deps.readerEditMode.value &&
      !deps.isVoiceReadActive?.();
    const apply = () => {
      if (rulerFocus) {
        reader.scrollChapterTitleToRulerFocus?.(
          lastChapterTitleDisplayLine,
          false,
        );
      } else {
        reader.scrollToDocumentStart(false);
      }
    };
    apply();
    await nextTick();
    await afterNextPaints();
    apply();
    reader.refreshChapterStickyScroll?.();
  }

  async function ensureChapterScrollAtBottom() {
    for (let i = 0; i < 30 && !deps.readerRef.value; i++) {
      await nextTick();
    }
    const reader = deps.readerRef.value;
    if (!reader) return;
    reader.scrollToBottom?.(false);
    await nextTick();
    await afterNextPaints();
    reader.scrollToBottom?.(false);
    reader.refreshChapterStickyScroll?.();
    if (
      deps.readingRulerEnabled.value &&
      !deps.readerEditMode.value &&
      !deps.isVoiceReadActive?.()
    ) {
      reader.syncReadingRulerToDocumentContentEdge?.(1);
    }
  }

  function stripLeadingChapterTitleFromBody(body: string, title: string): string {
    const rawTitle = title.trim();
    if (!rawTitle) return body;
    try {
      const titlePat = rawTitle
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s*");
      return body.replace(
        new RegExp(`^(?:\\s|\\p{P})*${titlePat}\\s*`, "u"),
        "",
      );
    } catch {
      return body;
    }
  }

  async function renderChapterText(
    heading: string,
    body: string,
    opts?: { resetScroll?: boolean },
  ) {
    await ensureReplaceRulesCache();
    const convertOpts = textConvertOptions();
    const rawTitle = heading.trim();
    // 正文若已带章节名（旧缓存 / ##{{title}} 未生效），先剥离再拼回一行，
    // 避免「橙色章节装饰行 + 正文里又一行黑字标题」
    let bodyText = stripLeadingChapterTitleFromBody(body, rawTitle);
    // 文本替换与「转换」同属展示管线：先替换，再简繁/全半角
    const titleText = applyDisplayReplaceTitle(rawTitle);
    bodyText = applyDisplayReplaceBody(bodyText);
    let text = titleText ? `${titleText}\n${bodyText}` : bodyText;
    text = await applyTextDisplayConverts(text, convertOpts);
    const formatted = formatPhysicalPlainTextForReader(text, {
      compressBlankLines: deps.compressBlankLines.value,
      compressBlankKeepOneBlank: deps.compressBlankKeepOneBlank.value,
      chapterTitleBlankMode: deps.chapterTitleBlankMode.value,
      leadIndentFullWidth: deps.leadIndentFullWidth.value,
      minCharCount: deps.chapterMinCharCount.value,
      skipBlanksBeforeFirstChapterTitle: true,
    });
    for (let i = 0; i < 30 && !deps.readerRef.value; i++) {
      await nextTick();
    }
    const reader = deps.readerRef.value;
    if (!reader) return;
    lastReaderPhysicalLines.value = text.length > 0 ? text.split("\n") : [""];
    lastDisplayLineToPhysicalLine.value = formatted.displayLineToPhysicalLine;
    lastRenderedReaderText.value = formatted.text;
    await reader.setFullText(formatted.text, {
      heavy: false,
      resetScroll: opts?.resetScroll ?? true,
    });
    totalLineCount.value = reader.getModelLineCount?.() ?? formatted.lineCount;
    if (rawTitle) {
      const lineNumber =
        formatted.chapterTitleDisplayLineByPhysical.get(1) ?? 1;
      lastChapterTitleDisplayLine = lineNumber;
      reader.setChapters([
        {
          title: rawTitle,
          lineNumber,
          headingLevel: 1,
        },
      ]);
    } else {
      lastChapterTitleDisplayLine = 1;
      reader.setChapters([]);
    }
  }

  /**
   * 编辑态展示：缓存原文（章节名 + 正文），不经压缩空行等阅读管线。
   * 正文前若已带章节名则剥离后再拼回，与 renderChapterText 行结构对齐，避免进出编辑行号错位。
   */
  function buildEditSourceText(): string {
    const rawTitle = lastChapterTitle.value.trim();
    const body = stripLeadingChapterTitleFromBody(
      lastChapterBody.value,
      rawTitle,
    );
    return rawTitle ? `${rawTitle}\n${body}` : body;
  }

  function settleReaderViewport(): Promise<void> {
    return afterNextPaints();
  }

  const chapterContentBusy = computed(
    () => loading.value || chapterLoading.value,
  );

  const canEnterReaderEditMode = computed(
    () =>
      Boolean(readerContentKey.value) &&
      !chapterContentBusy.value &&
      !deps.readerBootLoading.value,
  );

  async function confirmIfReaderEditDiscard(): Promise<boolean> {
    if (!readerEditMode.value || !readerEditorDirty.value) return true;
    return appConfirm(
      "当前章节已修改但尚未保存，确定要放弃这些改动吗？",
      "修改未保存",
    );
  }

  function onReaderEditDirtyChange(dirty: boolean) {
    readerEditorDirty.value = dirty;
  }

  async function onToggleReaderEdit() {
    if (readerEditMode.value) {
      if (!(await confirmIfReaderEditDiscard())) return;
      // 编辑态下行号≈原文物理行；退出前采锚点，换展示文后按映射恢复
      const exitAnchor = captureEditViewportAnchor();
      readerEditorDirty.value = false;
      readerEditMode.value = false;
      await nextTick();
      // 退出编辑：lastChapter* 仍为原文，重跑展示管线（文本替换 → 转换 → …）
      if (lastChapterBody.value || lastChapterTitle.value) {
        await renderChapterText(lastChapterTitle.value, lastChapterBody.value, {
          resetScroll: false,
        });
        // 等章节装饰 / sticky 布局稳定后再恢复，避免恢复后被 sticky 刷新顶偏
        deps.readerRef.value?.refreshChapterStickyScroll?.();
        await settleReaderViewport();
        await deps.readerRef.value?.restoreViewportToRestoreAnchor?.(
          exitAnchor,
          lastDisplayLineToPhysicalLine.value ?? undefined,
        );
      }
      return;
    }
    if (!canEnterReaderEditMode.value) {
      appToast("请等待当前章节加载完成后再进入编辑模式。", { kind: "info" });
      return;
    }
    // 阅读展示行 ≠ 编辑原文行（压缩空行等）；先采物理锚点再换文
    const enterAnchor = captureEditViewportAnchor();
    deps.exitVoiceRead();
    deps.stopTimedScroll();
    // 先进入编辑态再 setChapters，避免阅读态标题装饰残留（与主界面一致：编辑不渲标题样式）
    readerEditMode.value = true;
    await nextTick();
    // 进入编辑：直接编辑原文（文本替换只在阅读展示管线，不改 lastChapter*）
    const editText = buildEditSourceText();
    const reader = deps.readerRef.value;
    if (reader) {
      await reader.setFullText(editText, { heavy: false, resetScroll: false });
      totalLineCount.value = reader.getModelLineCount?.() ?? 0;
      if (lastChapterTitle.value.trim()) {
        reader.setChapters([
          {
            title: lastChapterTitle.value.trim(),
            lineNumber: 1,
            headingLevel: 1,
          },
        ]);
      } else {
        reader.setChapters([]);
      }
      reader.refreshChapterStickyScroll?.();
      await settleReaderViewport();
      await reader.restoreViewportToRestoreAnchor?.(enterAnchor);
    }
    deps.readerRef.value?.markReaderEditSaved?.();
    readerEditorDirty.value = false;
  }

  async function onSaveReaderChapter() {
    if (!readerEditMode.value) return;
    if (readerChapterSaving.value) return;
    const ch = deps.displayChapters.value[deps.currentDisplayIndex.value];
    const d = deps.detail();
    const it = deps.item();
    const bookUrl = d.bookUrl?.trim() || it.bookUrl?.trim();
    if (!ch?.url?.trim() || !bookUrl) {
      appToast("无法保存：缺少章节信息", { kind: "warning" });
      return;
    }
    readerChapterSaving.value = true;
    try {
      await appLoading.with("保存中", async () => {
        const text = deps.readerRef.value?.getAllText() ?? "";
        const body = stripLeadingChapterTitleFromBody(
          text,
          lastChapterTitle.value,
        );
        const r = await window.colorTxt.bookSourceSaveChapterCache({
          name: d.name || "",
          bookUrl,
          chapterUrl: ch.url,
          content: body,
          cacheDir: deps.effectiveCacheDir.value.trim() || undefined,
        });
        if (!r.ok) {
          appToast(r.message || "保存到缓存失败", { kind: "warning" });
          return;
        }
        lastChapterBody.value = body;
        deps.markChapterCached(ch.url);
        deps.readerRef.value?.markReaderEditSaved?.();
        readerEditorDirty.value = false;
        appToast("已保存到缓存", { kind: "success", duration: 1200 });
      });
    } finally {
      readerChapterSaving.value = false;
    }
  }

  /**
   * 局部编辑：按展示管线物理区间改写，写回章节缓存并刷新阅读展示。
   * 写回内容为「替换 + 转换后」的物理文（与选区映射一致）；再渲染时会再次套用展示管线。
   */
  async function onApplyPartialPhysicalEdit(payload: {
    range: AnnotationRange;
    text: string;
  }) {
    if (readerEditMode.value) return;
    if (readerChapterSaving.value) return;
    if (chapterContentBusy.value || deps.readerBootLoading.value) {
      appToast("请等待当前章节加载完成后再编辑。", { kind: "info" });
      return;
    }
    const ch = deps.displayChapters.value[deps.currentDisplayIndex.value];
    const d = deps.detail();
    const it = deps.item();
    const bookUrl = d.bookUrl?.trim() || it.bookUrl?.trim();
    if (!ch?.url?.trim() || !bookUrl) {
      appToast("无法保存：缺少章节信息", { kind: "warning" });
      return;
    }

    const nextLines = replaceTextInPhysicalLines(
      lastReaderPhysicalLines.value,
      payload.range,
      payload.text,
    );
    if (!nextLines) {
      appToast("无法应用局部编辑（选区映射失败）。", { kind: "danger" });
      return;
    }
    const nextText = nextLines.join("\n");
    const hadTitle = lastChapterTitle.value.trim().length > 0;
    let nextTitle = lastChapterTitle.value;
    let nextBody: string;
    if (hadTitle) {
      const nl = nextText.indexOf("\n");
      if (nl < 0) {
        nextTitle = nextText;
        nextBody = "";
      } else {
        nextTitle = nextText.slice(0, nl);
        nextBody = nextText.slice(nl + 1);
      }
    } else {
      nextBody = nextText;
    }

    readerChapterSaving.value = true;
    try {
      await appLoading.with("保存中", async () => {
        const r = await window.colorTxt.bookSourceSaveChapterCache({
          name: d.name || "",
          bookUrl,
          chapterUrl: ch.url,
          content: nextBody,
          cacheDir: deps.effectiveCacheDir.value.trim() || undefined,
        });
        if (!r.ok) {
          appToast(r.message || "保存到缓存失败", { kind: "warning" });
          return;
        }

        lastChapterTitle.value = nextTitle;
        lastChapterBody.value = nextBody;
        lastReaderPhysicalLines.value = nextLines;
        deps.markChapterCached(ch.url);

        const anchor = captureEditViewportAnchor();
        await renderChapterText(lastChapterTitle.value, lastChapterBody.value, {
          resetScroll: false,
        });
        deps.readerRef.value?.refreshChapterStickyScroll?.();
        await settleReaderViewport();
        await deps.readerRef.value?.restoreViewportToRestoreAnchor?.(
          anchor,
          lastDisplayLineToPhysicalLine.value ?? undefined,
        );
        appToast("已保存局部修改", { kind: "success", duration: 1200 });
      });
    } finally {
      readerChapterSaving.value = false;
    }
  }

  async function loadChapterAtDisplayIndex(
    index: number,
    options?: {
      smoothScroll?: boolean;
      preferCache?: boolean;
      /** 切章后视口：默认顶部；上一章边界切章用底部且无过渡 */
      scrollTo?: "top" | "bottom";
    },
  ) {
    const ch = deps.displayChapters.value[index];
    if (!ch) return;
    if (!(await confirmIfReaderEditDiscard())) return;
    if (readerEditMode.value) {
      readerEditMode.value = false;
      readerEditorDirty.value = false;
    }
    const contentIndex = contentIndexFor(ch);
    if (contentIndex < 0) {
      // 分卷标题：不拉正文规则（对齐 Legado），仅展示卷名
      if (ch.isVolume) {
        if (!(await confirmIfReaderEditDiscard())) return;
        if (readerEditMode.value) {
          readerEditMode.value = false;
          readerEditorDirty.value = false;
        }
        deps.currentDisplayIndex.value = index;
        cancelChapterLoad();
        readerContentKey.value = `findbook://volume#${encodeURIComponent(ch.url)}`;
        lastChapterTitle.value = ch.title;
        lastChapterBody.value = "";
        totalLineCount.value = 0;
        await renderChapterText(ch.title, "");
        void deps.scrollChapterListToCurrent({
          smooth: options?.smoothScroll ?? true,
        });
      }
      return;
    }
    const preferCache = options?.preferCache !== false;
    const fromCache = preferCache && deps.isChapterCached(ch);
    const wantSmooth = options?.smoothScroll ?? true;
    deps.currentDisplayIndex.value = index;
    loading.value = true;
    showChapterLoadingUi.value = !fromCache;
    cancelChapterLoad();
    // 先启动侧栏居中动画，避免与 Monaco 正文写入抢主线程导致卡顿
    const scrollDone = deps.scrollChapterListToCurrent({ smooth: wantSmooth });
    if (!fromCache) {
      // 未缓存 / 强制刷新：遮罩盖住旧正文，切章期间不做 Monaco 清空（避免卡列表动画）
      readerContentKey.value = null;
      lastChapterTitle.value = "";
      lastChapterBody.value = "";
      lastRenderedReaderText.value = "";
      totalLineCount.value = 0;
    }
    const listLen = deps.displayChapters.value.length;
    const readingIdx = readingOrderIndexFromDisplay(
      index,
      listLen,
      deps.chapterSortDesc.value,
    );
    const nextDisplayIdx = displayIndexForReadingOrder(
      readingIdx + 1,
      listLen,
      deps.chapterSortDesc.value,
    );
    const nextInReadingOrder =
      readingIdx + 1 < listLen
        ? deps.displayChapters.value[nextDisplayIdx]
        : undefined;
    const chapterUrlsInReadingOrder = contentChaptersInReadingOrder(
      deps.contentChapters.value,
    ).map((c) => c.url);
    const d = deps.detail();
    const it = deps.item();
    try {
      const loaded = await loadChapterContent({
        bookSourceUrl: it.origin,
        book: {
          ...d,
          kind: d.kind || it.kind || "",
          origin: it.origin,
          originName: it.originName,
        },
        chapterUrl: ch.url,
        chapterTitle: ch.title,
        chapterIndex: contentIndex,
        isVolume: ch.isVolume,
        nextChapterUrl: nextInReadingOrder?.url,
        chapterUrls: chapterUrlsInReadingOrder,
        cacheDir: deps.effectiveCacheDir.value.trim() || undefined,
        preferCache,
      });
      if (loaded == null) {
        readerContentKey.value = null;
        lastChapterTitle.value = ch.title;
        lastChapterBody.value = "";
        lastRenderedReaderText.value = "";
        return;
      }
      const { content: body, displayTitle } = loaded;
      // 缓存命中往往立刻返回：等列表动画结束再写正文，避免与 rAF 平滑滚动抢帧
      if (wantSmooth) await scrollDone;
      deps.markChapterCached(ch.url);
      readerContentKey.value = `findbook://${d.bookUrl}#${ch.url}`;
      // IPC 返回缓存/联网原文；文本替换在 renderChapterText 中与「转换」一并套用
      lastChapterTitle.value = displayTitle || ch.title;
      lastChapterBody.value = body;
      await renderChapterText(lastChapterTitle.value, body, {
        resetScroll: options?.scrollTo !== "bottom",
      });
      if (deps.isInBookshelf(d.bookUrl, it.origin)) {
        deps.updateReadProgress(d.bookUrl, it.origin, contentIndex, ch.title);
      }
    } finally {
      loading.value = false;
      showChapterLoadingUi.value = false;
      if (options?.scrollTo === "bottom") {
        await ensureChapterScrollAtBottom();
      } else {
        await ensureChapterScrollAtTop();
      }
    }
  }

  function isChapterLoading(index: number): boolean {
    return showChapterLoadingUi.value && index === deps.currentDisplayIndex.value;
  }

  async function refreshCurrentChapterDisplay() {
    if (readerEditMode.value) return;
    if (!lastChapterBody.value) return;
    await renderChapterText(lastChapterTitle.value, lastChapterBody.value, {
      resetScroll: false,
    });
  }

  /** 关闭阅读器时清会话态（不取消 IPC：由调用方 cancelChapterLoad） */
  function resetChapterSessionUi() {
    loading.value = false;
    showChapterLoadingUi.value = false;
    readerEditMode.value = false;
    readerEditorDirty.value = false;
    readerContentKey.value = null;
    lastChapterBody.value = "";
    lastChapterTitle.value = "";
    lastRenderedReaderText.value = "";
    totalLineCount.value = 0;
    lastDisplayLineToPhysicalLine.value = null;
    lastReaderPhysicalLines.value = [];
  }

  function clearReaderEditFlags() {
    readerEditMode.value = false;
    readerEditorDirty.value = false;
  }

  return {
    readerContentKey,
    lastChapterTitle,
    lastChapterBody,
    lastRenderedReaderText,
    totalLineCount,
    readerEditMode,
    readerEditorDirty,
    readerChapterSaving,
    loading,
    showChapterLoadingUi,
    chapterLoading,
    chapterError,
    logs,
    cancelChapterLoad,
    chapterContentBusy,
    cachedReplaceRules,
    textReplaceActive,
    refreshReplaceRulesCache,
    ensureReplaceRulesCache,
    applyDisplayReplaceTitle,
    applyDisplayReplaceBody,
    contentIndexFor,
    renderChapterText,
    canEnterReaderEditMode,
    confirmIfReaderEditDiscard,
    onReaderEditDirtyChange,
    onToggleReaderEdit,
    onSaveReaderChapter,
    onApplyPartialPhysicalEdit,
    loadChapterAtDisplayIndex,
    isChapterLoading,
    refreshCurrentChapterDisplay,
    resetChapterSessionUi,
    clearReaderEditFlags,
    viewportDisplayLineToPhysicalLine,
    getPhysicalLineContent,
  };
}
