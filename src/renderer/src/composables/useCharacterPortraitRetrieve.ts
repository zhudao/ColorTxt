import {
  computed,
  nextTick,
  ref,
  shallowRef,
  watch,
  type Ref,
} from "vue";
import type {
  CharacterGoldenQuotesResult,
  PortraitExtractResult,
} from "@shared/aiTypes";
import {
  EMPTY_TOKEN_PRICE_PER_MILLION,
  normalizeTokenPricePerMillion,
  type AITokenPricePerMillion,
} from "@shared/aiTypes";
import {
  addTokenUsage,
  type AITokenUsageTotals,
  ZERO_TOKEN_USAGE,
} from "@shared/aiTokenUsage";
import type {
  CharacterBookStylePersisted,
  CharacterGender,
} from "@shared/characterTypes";
import { formatCharacterAliasesList } from "@shared/characterAliases";
import { runAiBookVectorIndexBuild } from "../ai/buildBookVectorIndex";
import { hashBookBrowser } from "../utils/aiBookHash";
import type { Chapter } from "../chapter";
import type ReaderMain from "../components/ReaderMain.vue";

/** 角色侧栏建索引进度：与阅读助手同一套阶段文案，使用独立 embed requestId */
const CHARACTER_INDEX_EMBED_REQUEST_ID = 9_231_001;

function genderFromExtract(
  g: PortraitExtractResult["gender"],
): CharacterGender {
  return g === "male" || g === "female" || g === "unknown" ? g : "unknown";
}

function buildRetrieveThinking(ex: PortraitExtractResult): string {
  const parts: string[] = [];
  if (ex.aliases?.length) {
    parts.push(`【别名】\n${formatCharacterAliasesList(ex.aliases)}`);
  }
  if (ex.confidence_note?.trim()) {
    parts.push(`【可信度】\n${ex.confidence_note.trim()}`);
  }
  if (ex.appearance_zh?.trim()) {
    parts.push(`【外貌汇总】\n${ex.appearance_zh.trim()}`);
  }
  if (ex.excerpts?.length) {
    let startedExcerpts = false;
    for (const e of ex.excerpts.slice(0, 12)) {
      const q = e.quote.trim();
      if (!q) continue;
      if (!startedExcerpts) {
        parts.push("【摘录】");
        startedExcerpts = true;
      }
      const title = e.chapterTitle?.trim();
      const head = title ? `⭐ ${title}` : `⭐ 第 ${e.chapterIndex + 1} 章`;
      parts.push(`${head}\n${q}`);
    }
  }
  return parts.join("\n\n");
}

function isPortraitRetrieveAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

export function useCharacterPortraitRetrieve(opts: {
  draftDisplayName: Ref<string>;
  draftAliases: Ref<string>;
  draftGender: Ref<CharacterGender>;
  draftAgeText: Ref<string>;
  draftIdentity: Ref<string>;
  draftBio: Ref<string>;
  draftRelations: Ref<string>;
  draftPromptZh: Ref<string>;
  draftNegativeZh: Ref<string>;
  draftRetrieveThinking: Ref<string>;
  draftStylePrefix: Ref<string>;
  draftStyleNote: Ref<string>;
  draftVoiceSampleQuotes: Ref<string[]>;
  draftVoiceSampleQuoteIndex: Ref<number>;
  draftVoiceSampleLine: Ref<string>;
  spoilerSafe: Ref<boolean>;
  slideOpen: Ref<boolean>;
  sessionFilePath: Ref<string | null>;
  physicalReaderPath: Ref<string | null>;
  chapters: Ref<readonly Chapter[]>;
  activeChapterIdx: Ref<number>;
  readerMainRef: Ref<InstanceType<typeof ReaderMain> | null>;
  characterBookStyle: Ref<CharacterBookStylePersisted | undefined>;
  sessionBookTitle: Ref<string>;
  panelVisible: Ref<boolean>;
  aiConfigSyncNonce: Ref<number>;
  emitCharacterBookStyle: (style: CharacterBookStylePersisted) => void;
}) {
  const embeddingEnabled = ref(false);
  const chatTokenPricePerMillion = ref<AITokenPricePerMillion>({
    ...EMPTY_TOKEN_PRICE_PER_MILLION,
  });
  const showTokenUsage = ref(true);
  const indexReady = ref(false);
  const bookHash = ref("");

  const extracting = ref(false);
  /** 主进程 portrait extract/infer 中止用，与 `allocatePortraitRetrieveSessionId` 对齐 */
  const portraitRetrieveActiveSid = ref(0);
  /** 与阅读助手思考折叠一致：检索进行中自动展开，结束后收起 */
  const retrieveThinkingFoldOpen = ref(false);
  const retrieveNoticeBanner = ref("");
  /** 当前抽屉内是否已点过「检索」（用于首次检索后显示思考折叠区） */
  const retrieveEverThisDrawer = ref(false);
  const retrieveTokenUsage = ref<AITokenUsageTotals>(ZERO_TOKEN_USAGE);
  const retrieveTokenUsageAvailable = ref(false);
  const retrieveTokenUsageShown = ref(false);

  const retrieveIndexPhase = ref<
    "idle" | "chunking" | "embedding" | "indexing" | "error"
  >("idle");
  const retrieveIndexEmbedCurrent = ref(0);
  const retrieveIndexEmbedTotal = ref(0);
  const retrieveIndexError = ref("");
  const retrieveIndexAbort = shallowRef<AbortController | null>(null);

  const isRetrieveIndexBuilding = computed(() =>
    ["chunking", "embedding", "indexing"].includes(retrieveIndexPhase.value),
  );

  const canRetrieve = computed(
    () =>
      Boolean(opts.draftDisplayName.value.trim()) &&
      !extracting.value &&
      !isRetrieveIndexBuilding.value,
  );

  const showThinkingSection = computed(
    () =>
      extracting.value ||
      retrieveEverThisDrawer.value ||
      Boolean(opts.draftRetrieveThinking.value.trim()),
  );

  watch(
    () => [opts.slideOpen.value, extracting.value] as const,
    async ([active, busy]) => {
      await nextTick();
      if (!active) return;
      retrieveThinkingFoldOpen.value = busy;
    },
    { immediate: true },
  );

  function onRetrieveThinkingFoldContentPointerDown(ev: PointerEvent) {
    const t = ev.currentTarget;
    if (t instanceof HTMLElement) t.focus({ preventScroll: true });
  }

  function clearRetrieveTokenUsage(): void {
    retrieveTokenUsage.value = ZERO_TOKEN_USAGE;
    retrieveTokenUsageAvailable.value = false;
    retrieveTokenUsageShown.value = false;
  }

  function absorbRetrieveTokenUsage(part: {
    tokenUsage?: AITokenUsageTotals;
    tokenUsageAvailable?: boolean;
  }): void {
    if (part.tokenUsage) {
      retrieveTokenUsage.value = addTokenUsage(
        retrieveTokenUsage.value,
        part.tokenUsage,
      );
    }
    if (part.tokenUsageAvailable === true) {
      retrieveTokenUsageAvailable.value = true;
    }
  }

  async function refreshRuntimeFlags() {
    try {
      const c = await window.colorTxt.ai.configGet();
      embeddingEnabled.value = c.embeddingEnabled;
      chatTokenPricePerMillion.value = normalizeTokenPricePerMillion(
        c.chat.tokenPricePerMillion,
      );
      showTokenUsage.value = c.showTokenUsage !== false;
    } catch {
      embeddingEnabled.value = false;
      chatTokenPricePerMillion.value = { ...EMPTY_TOKEN_PRICE_PER_MILLION };
      showTokenUsage.value = true;
    }
  }

  async function refreshBookHash() {
    bookHash.value = "";
    if (!opts.sessionFilePath.value || !opts.physicalReaderPath.value) return;
    try {
      const st = await window.colorTxt.stat(opts.physicalReaderPath.value);
      if (!st.isFile) return;
      bookHash.value = await hashBookBrowser(
        opts.sessionFilePath.value,
        st.size,
        st.mtimeMs,
      );
    } catch {
      bookHash.value = "";
    }
  }

  async function refreshIndexReady() {
    indexReady.value = false;
    if (!bookHash.value || !embeddingEnabled.value) return;
    try {
      indexReady.value = await window.colorTxt.ai.indexHasBook(bookHash.value);
    } catch {
      indexReady.value = false;
    }
  }

  watch(
    () =>
      [
        opts.sessionFilePath.value,
        opts.physicalReaderPath.value,
      ] as const,
    () => {
      void refreshBookHash().then(() => refreshIndexReady());
    },
  );

  watch(
    () => opts.panelVisible.value,
    (vis) => {
      if (vis) {
        void refreshRuntimeFlags().then(() => refreshIndexReady());
      }
    },
    { immediate: true },
  );

  watch(
    () => opts.aiConfigSyncNonce.value,
    (n, prev) => {
      if (n <= 0 || n === prev) return;
      void refreshRuntimeFlags();
    },
  );

  watch(embeddingEnabled, () => {
    void refreshIndexReady();
  });

  watch(bookHash, () => {
    void refreshIndexReady();
  });

  function abortRetrieveIndexBuild() {
    retrieveIndexAbort.value?.abort();
    retrieveIndexAbort.value = null;
    void window.colorTxt.ai.embedAbort(CHARACTER_INDEX_EMBED_REQUEST_ID);
  }

  let nextPortraitRetrieveSessionId = 0;
  function allocatePortraitRetrieveSessionId(): number {
    nextPortraitRetrieveSessionId += 1;
    return nextPortraitRetrieveSessionId;
  }

  async function buildCharacterBookIndex(signal: AbortSignal): Promise<boolean> {
    if (!bookHash.value) {
      retrieveIndexPhase.value = "error";
      retrieveIndexError.value = "无法绑定本书上下文。";
      return false;
    }
    const getText = opts.readerMainRef.value?.getAllText;
    if (!getText) {
      retrieveIndexPhase.value = "error";
      retrieveIndexError.value = "无法读取全书文本，请确认阅读器已加载本书。";
      return false;
    }
    if (signal.aborted) {
      retrieveIndexPhase.value = "idle";
      return false;
    }
    return runAiBookVectorIndexBuild({
      signal,
      embedRequestId: CHARACTER_INDEX_EMBED_REQUEST_ID,
      bookHash: bookHash.value,
      fullText: getText(),
      chapters: [...opts.chapters.value],
      abortMode: "returnFalse",
      hooks: {
        onPhase: (p) => {
          retrieveIndexPhase.value = p;
        },
        onEmbedProgress: (cur, tot) => {
          retrieveIndexEmbedTotal.value = tot;
          retrieveIndexEmbedCurrent.value = cur;
        },
        clearError: () => {
          retrieveIndexError.value = "";
        },
        setError: (m) => {
          retrieveIndexError.value = m;
        },
        setPhaseIdle: () => {
          retrieveIndexPhase.value = "idle";
        },
        setPhaseError: () => {
          retrieveIndexPhase.value = "error";
        },
      },
    });
  }

  function getRetrieveBlockMessage(): string {
    if (!embeddingEnabled.value) {
      return "向量模型未启用：无法从书籍中检索角色描写。";
    }
    return "";
  }

  /** 全书通用画风：已有内容则不再在 AI 检索时重复推断（用户清空后可再次生成） */
  function hasBookStyleForRetrieve(): boolean {
    return Boolean(
      opts.characterBookStyle.value?.stylePrefixZh?.trim() ||
        opts.draftStylePrefix.value.trim(),
    );
  }

  function applyGoldenQuotesRetrieveResult(
    res: CharacterGoldenQuotesResult | { error: string },
  ): void {
    if ("error" in res) return;
    absorbRetrieveTokenUsage(res);
    const quotes = res.quotes.map((q) => q.trim()).filter(Boolean);
    if (quotes.length === 0) return;
    opts.draftVoiceSampleQuotes.value = quotes;
    opts.draftVoiceSampleQuoteIndex.value = 0;
    opts.draftVoiceSampleLine.value = quotes[0]!;
  }

  async function onRetrieve() {
    if (extracting.value || isRetrieveIndexBuilding.value) return;
    retrieveNoticeBanner.value = "";
    if (retrieveIndexPhase.value === "error") {
      retrieveIndexPhase.value = "idle";
      retrieveIndexError.value = "";
    }
    await refreshRuntimeFlags();
    await refreshBookHash();
    await refreshIndexReady();
    const block = getRetrieveBlockMessage();
    if (block) {
      retrieveNoticeBanner.value = block;
      return;
    }

    if (!bookHash.value) return;

    opts.draftRetrieveThinking.value = "";
    clearRetrieveTokenUsage();
    const retrieveSessionId = allocatePortraitRetrieveSessionId();
    portraitRetrieveActiveSid.value = retrieveSessionId;
    retrieveEverThisDrawer.value = true;
    extracting.value = true;

    try {
      let hasIndex = await window.colorTxt.ai.indexHasBook(bookHash.value);
      if (!hasIndex) {
        abortRetrieveIndexBuild();
        const ac = new AbortController();
        retrieveIndexAbort.value = ac;
        try {
          const built = await buildCharacterBookIndex(ac.signal);
          if (!built) return;
        } finally {
          retrieveIndexAbort.value = null;
        }
        await refreshIndexReady();
        hasIndex = await window.colorTxt.ai.indexHasBook(bookHash.value);
        if (!hasIndex) {
          retrieveNoticeBanner.value = "索引未完成，请稍后重试。";
          return;
        }
      }

      const res = await window.colorTxt.ai.portraitExtract({
        bookHash: bookHash.value,
        characterName: opts.draftDisplayName.value.trim(),
        characterAliases: opts.draftAliases.value.trim(),
        spoilerSafe: opts.spoilerSafe.value,
        activeChapterIdx: opts.activeChapterIdx.value,
        retrieveSessionId,
      });
      if ("error" in res) {
        const errText = typeof res.error === "string" ? res.error : "摘录失败";
        if (!/abort|aborted/i.test(errText)) {
          retrieveNoticeBanner.value = errText;
        }
        return;
      }
      const ok = res as PortraitExtractResult;
      opts.draftPromptZh.value = ok.sd_prompt_zh;
      opts.draftNegativeZh.value = ok.negative_zh.trim();
      opts.draftGender.value = genderFromExtract(ok.gender);
      opts.draftAgeText.value = ok.age_text.trim();
      opts.draftIdentity.value = ok.identity_zh.trim();
      opts.draftBio.value = ok.bio_zh.trim();
      opts.draftRelations.value = ok.relations_zh.trim();
      opts.draftAliases.value = formatCharacterAliasesList(ok.aliases ?? []);
      opts.draftRetrieveThinking.value = buildRetrieveThinking(ok);
      absorbRetrieveTokenUsage(ok);
      retrieveTokenUsageShown.value = true;

      const mergedAliasText = formatCharacterAliasesList(ok.aliases ?? []);
      const quotesPromise = window.colorTxt.ai.portraitGoldenQuotes({
        bookHash: bookHash.value,
        characterName: opts.draftDisplayName.value.trim(),
        characterAliases: mergedAliasText,
        spoilerSafe: opts.spoilerSafe.value,
        activeChapterIdx: opts.activeChapterIdx.value,
        retrieveSessionId,
      });

      if (!hasBookStyleForRetrieve()) {
        const title = opts.sessionBookTitle.value.trim();
        const inferPromise = window.colorTxt.ai.portraitInferBookStyle({
          bookHash: bookHash.value,
          ...(title ? { fileTitle: title } : {}),
          spoilerSafe: opts.spoilerSafe.value,
          activeChapterIdx: opts.activeChapterIdx.value,
          retrieveSessionId,
        });
        const [inf, quotesRes] = await Promise.all([
          inferPromise,
          quotesPromise,
        ]);
        if (!("error" in inf)) {
          absorbRetrieveTokenUsage(inf);
          const nextStyle: CharacterBookStylePersisted = {
            stylePrefixZh: inf.style_sd_prefix_zh.trim(),
            styleNoteZh: inf.note_zh.trim(),
            updatedAt: Date.now(),
          };
          opts.draftStylePrefix.value = nextStyle.stylePrefixZh;
          opts.draftStyleNote.value = nextStyle.styleNoteZh ?? "";
          opts.emitCharacterBookStyle(nextStyle);
        }
        applyGoldenQuotesRetrieveResult(quotesRes);
      } else {
        const quotesRes = await quotesPromise;
        applyGoldenQuotesRetrieveResult(quotesRes);
      }

      retrieveNoticeBanner.value = "";
    } catch (e) {
      if (!isPortraitRetrieveAbortError(e)) {
        retrieveNoticeBanner.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      extracting.value = false;
      portraitRetrieveActiveSid.value = 0;
      void window.colorTxt.ai.portraitRetrieveSessionDispose(retrieveSessionId);
      if (!opts.draftRetrieveThinking.value.trim()) {
        retrieveEverThisDrawer.value = false;
      }
    }
  }

  function onStopPortraitRetrieve() {
    abortRetrieveIndexBuild();
    const sid = portraitRetrieveActiveSid.value;
    if (sid !== 0) void window.colorTxt.ai.portraitRetrieveAbort(sid);
  }

  /** 关闭抽屉时：中止建索并清空检索 UI 状态（不含草稿字段） */
  function resetRetrieveUiOnCloseSlide(): void {
    abortRetrieveIndexBuild();
    retrieveIndexPhase.value = "idle";
    retrieveIndexEmbedCurrent.value = 0;
    retrieveIndexEmbedTotal.value = 0;
    retrieveIndexError.value = "";
    retrieveNoticeBanner.value = "";
    retrieveEverThisDrawer.value = false;
  }

  /** 切换或关闭当前书时：中止建索与 LLM，清空检索相关状态 */
  function abortRetrieveOnBookChange(): void {
    abortRetrieveIndexBuild();
    const prSid = portraitRetrieveActiveSid.value;
    if (prSid !== 0) {
      void window.colorTxt.ai.portraitRetrieveAbort(prSid);
      portraitRetrieveActiveSid.value = 0;
      void window.colorTxt.ai.portraitRetrieveSessionDispose(prSid);
    }
    retrieveIndexPhase.value = "idle";
    retrieveIndexEmbedCurrent.value = 0;
    retrieveIndexEmbedTotal.value = 0;
    retrieveIndexError.value = "";
    extracting.value = false;
    retrieveEverThisDrawer.value = false;
    retrieveNoticeBanner.value = "";
    clearRetrieveTokenUsage();
  }

  function markRetrieveFreshForDrawer(): void {
    retrieveEverThisDrawer.value = false;
    retrieveNoticeBanner.value = "";
    clearRetrieveTokenUsage();
  }

  return {
    embeddingEnabled,
    chatTokenPricePerMillion,
    showTokenUsage,
    indexReady,
    bookHash,
    extracting,
    portraitRetrieveActiveSid,
    retrieveThinkingFoldOpen,
    retrieveNoticeBanner,
    retrieveEverThisDrawer,
    retrieveTokenUsage,
    retrieveTokenUsageAvailable,
    retrieveTokenUsageShown,
    retrieveIndexPhase,
    retrieveIndexEmbedCurrent,
    retrieveIndexEmbedTotal,
    retrieveIndexError,
    isRetrieveIndexBuilding,
    canRetrieve,
    showThinkingSection,
    onRetrieveThinkingFoldContentPointerDown,
    clearRetrieveTokenUsage,
    refreshRuntimeFlags,
    refreshBookHash,
    refreshIndexReady,
    abortRetrieveIndexBuild,
    onRetrieve,
    onStopPortraitRetrieve,
    resetRetrieveUiOnCloseSlide,
    abortRetrieveOnBookChange,
    markRetrieveFreshForDrawer,
  };
}
