import type { WebContents } from "electron";
import type {
  AIChatEndpoint,
  AIConfig,
  AIWordcloudMode,
  AIWordcloudToolResult,
} from "@shared/aiTypes";
import {
  normalizeWordcloudMaxWords,
  WORDCLOUD_MAX_WORDS_MIN,
} from "@shared/aiTypes";
import { isAiWordcloudStopword } from "@shared/aiWordcloudStopwords";
import {
  buildSemanticExtractSystemPrompt,
  buildSemanticRefineSystemPrompt,
  buildSemanticRefineUserContent,
} from "@shared/aiWordcloudSemanticFocus";
import type { AITokenUsageTotals } from "@shared/aiTokenUsage";
import { chatCompletionOnce } from "../chat/chat";
import { fetchChapterPlainTextFromRenderer } from "../rag/chapterPlainTextBridge";
import { getOrBuildChapterFreq } from "../rag/segmentCache";
import { isFetchAborted } from "../txt2img/shared";
import {
  countTermsInChapters,
  fetchChaptersPlainTextRange,
  mergeFreqMaps,
  pickSampleChapterIndices,
  topWordsFromFreq,
} from "./wordcloudChapterFetch";

/** 用户停止检索：携带已抽到的词项，供调用方返回部分结果 */
class WordcloudStoppedWithTerms extends Error {
  readonly terms: string[];
  constructor(terms: string[]) {
    super("Stopped");
    this.name = "WordcloudStoppedWithTerms";
    this.terms = terms;
  }
}

function isWordcloudAbort(e: unknown, signal?: AbortSignal): boolean {
  return isFetchAborted(e) || signal?.aborted === true;
}

function throwStoppedOrAbort(
  signal: AbortSignal | undefined,
  partialTerms: readonly string[],
  candidateMax: number,
): never {
  const partial = dedupeSemanticTerms(partialTerms, candidateMax);
  if (partial.length > 0) throw new WordcloudStoppedWithTerms(partial);
  throwIfAborted(signal);
  throw new DOMException("Aborted", "AbortError");
}

/** 词云展示：抽样与候选上限（控制体积与出图质量） */
const SAMPLE_CHAPTER_COUNT = 12;
const SAMPLE_CHARS_PER_CHAPTER = 2000;
const WORDCLOUD_CANDIDATE_MAX = 120;
const WORDCLOUD_LLM_MAX_TOKENS = 4096;

/**
 * 高亮词 AI 检索（unlimitedTerms）：加大抽样、分批抽取、抬高候选上限。
 * 仍受模型输出与抽样覆盖约束，但不再卡在 50～120。
 */
const COLLECT_SAMPLE_CHAPTER_COUNT = 48;
const COLLECT_SAMPLE_CHARS_PER_CHAPTER = 4000;
/** 每批送给抽取模型的抽样章数 */
const COLLECT_EXTRACT_BATCH_SIZE = 8;
const COLLECT_CANDIDATE_MAX = 2000;
const COLLECT_LLM_MAX_TOKENS = 8192;
/** 二次筛选单次候选上限（过大时分块 refine 再合并） */
const COLLECT_REFINE_CHUNK = 250;

const SEMANTIC_EXTRACT_PROGRESS_TITLE = "按语义抽取词项";
const SEMANTIC_REFINE_PROGRESS_TITLE = "按语义筛选词项";

function semanticExtractProgressDetail(
  line1: string,
  progressLine?: string,
): string {
  const lines = [line1];
  if (progressLine?.trim()) lines.push(progressLine);
  return lines.join("\n");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export type WordcloudToolProgress = (
  title: string,
  detail?: string,
) => void;

export type RunWordcloudToolContext = {
  bookHash: string;
  chapterCount: number;
  spoilerMaxChapterIndex: number | null;
  webContents: WebContents;
  chat: AIChatEndpoint;
  aiConfig: AIConfig;
  onProgress?: WordcloudToolProgress;
  onTokenUsage?: (usage: AITokenUsageTotals) => void;
  signal?: AbortSignal;
};

type SemanticCollectOpts = {
  collectMax: boolean;
  sampleCharsPerChapter: number;
  candidateMax: number;
  llmMaxTokens: number;
};

function parseMode(raw: unknown): AIWordcloudMode {
  const m = String(raw ?? "").trim();
  if (m === "semantic") return "semantic";
  return "general";
}

function resolveChapterRange(
  chapterCount: number,
  scope: "full" | "chapter",
  chapterIndex: number,
  spoilerMaxChapterIndex: number | null,
): { min: number; max: number } {
  let max =
    spoilerMaxChapterIndex != null
      ? Math.min(spoilerMaxChapterIndex, chapterCount - 1)
      : chapterCount - 1;
  if (max < 0) max = 0;
  if (scope === "chapter") {
    const ci = Math.max(0, Math.min(chapterIndex, chapterCount - 1));
    return { min: ci, max: ci };
  }
  return { min: 0, max };
}

function parseTermsFromLlmJson(raw: string): string[] {
  const text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence?.[1] ?? text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const arr = body.match(/"([^"]{1,40})"/g);
    if (!arr) return [];
    return arr.map((s) => s.slice(1, -1).trim()).filter(Boolean);
  }
  if (Array.isArray(parsed)) {
    return parsed
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    const terms = o.terms;
    if (Array.isArray(terms)) {
      return terms
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean);
    }
  }
  return [];
}

function dedupeSemanticTerms(
  terms: readonly string[],
  max = WORDCLOUD_CANDIDATE_MAX,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const limit = Number.isFinite(max) && max > 0 ? max : Number.MAX_SAFE_INTEGER;
  for (const t of terms) {
    const s = t.trim();
    if (!s || s.length > 40 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  const n = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) {
    out.push(arr.slice(i, i + n) as T[]);
  }
  return out;
}

async function refineSemanticTermsChunk(opts: {
  semanticQuery: string;
  candidates: readonly string[];
  chat: AIChatEndpoint;
  collect: SemanticCollectOpts;
  onTokenUsage?: (usage: AITokenUsageTotals) => void;
  onProgress?: WordcloudToolProgress;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (opts.candidates.length === 0) return [];

  const { text, usage } = await chatCompletionOnce({
    chat: opts.chat,
    signal: opts.signal,
    maxTokens: opts.collect.llmMaxTokens,
    temperature: Math.min(opts.chat.temperature, 0.15),
    messages: [
      {
        role: "system",
        content: buildSemanticRefineSystemPrompt({
          collectMax: opts.collect.collectMax,
        }),
      },
      {
        role: "user",
        content: buildSemanticRefineUserContent(
          opts.semanticQuery,
          opts.candidates,
        ),
      },
    ],
  });
  if (usage && opts.onTokenUsage) opts.onTokenUsage(usage);

  const candidateSet = new Set(opts.candidates);
  const refined = dedupeSemanticTerms(
    parseTermsFromLlmJson(text),
    opts.collect.candidateMax,
  ).filter((t) => candidateSet.has(t));
  if (refined.length > 0) return refined;
  return dedupeSemanticTerms(opts.candidates, opts.collect.candidateMax);
}

async function refineSemanticTerms(opts: {
  semanticQuery: string;
  candidates: readonly string[];
  chat: AIChatEndpoint;
  collect: SemanticCollectOpts;
  onTokenUsage?: (usage: AITokenUsageTotals) => void;
  onProgress?: WordcloudToolProgress;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (opts.candidates.length === 0) return [];

  const chunks =
    opts.collect.collectMax && opts.candidates.length > COLLECT_REFINE_CHUNK
      ? chunkArray(opts.candidates, COLLECT_REFINE_CHUNK)
      : [opts.candidates];

  opts.onProgress?.(
    SEMANTIC_REFINE_PROGRESS_TITLE,
    semanticExtractProgressDetail(
      "正在按用户语义筛选候选词…",
      chunks.length > 1
        ? `候选 ${opts.candidates.length} 项，分 ${chunks.length} 批`
        : `候选 ${opts.candidates.length} 项`,
    ),
  );

  const merged: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      throwIfAborted(opts.signal);
      if (chunks.length > 1) {
        opts.onProgress?.(
          SEMANTIC_REFINE_PROGRESS_TITLE,
          semanticExtractProgressDetail(
            "正在按用户语义筛选候选词…",
            `当前进度：${i + 1}/${chunks.length}`,
          ),
        );
      }
      const part = await refineSemanticTermsChunk({
        ...opts,
        candidates: chunks[i]!,
      });
      merged.push(...part);
    } catch (e) {
      if (e instanceof WordcloudStoppedWithTerms) throw e;
      if (isWordcloudAbort(e, opts.signal)) {
        // 已筛完的批次优先；尚未筛完则退回抽取候选（仍是已检索到的词）
        throwStoppedOrAbort(
          opts.signal,
          merged.length > 0 ? merged : opts.candidates,
          opts.collect.candidateMax,
        );
      }
      throw e;
    }
  }
  return dedupeSemanticTerms(merged, opts.collect.candidateMax);
}

async function extractSemanticTermsFromSamples(opts: {
  semanticQuery: string;
  sampleTexts: string[];
  chat: AIChatEndpoint;
  collect: SemanticCollectOpts;
  onTokenUsage?: (usage: AITokenUsageTotals) => void;
  onProgress?: WordcloudToolProgress;
  signal?: AbortSignal;
  batchLabel?: string;
}): Promise<string[]> {
  const joined = opts.sampleTexts
    .map(
      (t, i) =>
        `--- 抽样 ${i + 1} ---\n${t.slice(0, opts.collect.sampleCharsPerChapter)}`,
    )
    .join("\n\n");

  opts.onProgress?.(
    SEMANTIC_EXTRACT_PROGRESS_TITLE,
    opts.batchLabel?.trim()
      ? `正在向模型请求词项列表…（${opts.batchLabel}）`
      : "正在向模型请求词项列表…",
  );

  const { text, usage } = await chatCompletionOnce({
    chat: opts.chat,
    signal: opts.signal,
    maxTokens: opts.collect.llmMaxTokens,
    temperature: Math.min(opts.chat.temperature, 0.3),
    messages: [
      {
        role: "system",
        content: buildSemanticExtractSystemPrompt(opts.semanticQuery, {
          collectMax: opts.collect.collectMax,
        }),
      },
      {
        role: "user",
        content: `正文抽样：\n${joined}`,
      },
    ],
  });
  if (usage && opts.onTokenUsage) opts.onTokenUsage(usage);

  return dedupeSemanticTerms(
    parseTermsFromLlmJson(text),
    opts.collect.candidateMax,
  );
}

async function extractSemanticTerms(opts: {
  semanticQuery: string;
  sampleTexts: string[];
  chat: AIChatEndpoint;
  collect: SemanticCollectOpts;
  onTokenUsage?: (usage: AITokenUsageTotals) => void;
  onProgress?: WordcloudToolProgress;
  signal?: AbortSignal;
}): Promise<string[]> {
  const batches =
    opts.collect.collectMax &&
    opts.sampleTexts.length > COLLECT_EXTRACT_BATCH_SIZE
      ? chunkArray(opts.sampleTexts, COLLECT_EXTRACT_BATCH_SIZE)
      : [opts.sampleTexts];

  const extractedAll: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    try {
      throwIfAborted(opts.signal);
      const batch = batches[i]!;
      const part = await extractSemanticTermsFromSamples({
        ...opts,
        sampleTexts: batch,
        batchLabel:
          batches.length > 1 ? `${i + 1}/${batches.length}` : undefined,
      });
      extractedAll.push(...part);
      if (extractedAll.length >= opts.collect.candidateMax) break;
    } catch (e) {
      if (e instanceof WordcloudStoppedWithTerms) throw e;
      if (isWordcloudAbort(e, opts.signal)) {
        throwStoppedOrAbort(
          opts.signal,
          extractedAll,
          opts.collect.candidateMax,
        );
      }
      throw e;
    }
  }

  opts.onProgress?.(
    SEMANTIC_EXTRACT_PROGRESS_TITLE,
    semanticExtractProgressDetail(
      "正在解析模型返回的词项…",
      `当前进度：已合并 ${Math.min(extractedAll.length, opts.collect.candidateMax)} 项候选`,
    ),
  );

  const extracted = dedupeSemanticTerms(
    extractedAll,
    opts.collect.candidateMax,
  );
  let terms: string[];
  try {
    terms = await refineSemanticTerms({
      semanticQuery: opts.semanticQuery,
      candidates: extracted,
      chat: opts.chat,
      collect: opts.collect,
      onTokenUsage: opts.onTokenUsage,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof WordcloudStoppedWithTerms) throw e;
    if (isWordcloudAbort(e, opts.signal)) {
      throwStoppedOrAbort(opts.signal, extracted, opts.collect.candidateMax);
    }
    throw e;
  }

  opts.onProgress?.(
    SEMANTIC_EXTRACT_PROGRESS_TITLE,
    semanticExtractProgressDetail(
      `已确定 ${terms.length} 个词项`,
      "当前进度：准备统计词频",
    ),
  );

  return terms;
}

export async function runWordcloudTool(
  args: Record<string, unknown>,
  ctx: RunWordcloudToolContext,
): Promise<AIWordcloudToolResult> {
  const title = String(args.title ?? "").trim();
  if (!title) throw new Error("缺少有效的 title");

  const mode = parseMode(args.mode);
  const semanticQuery = String(args.semanticQuery ?? "").trim();
  if (mode === "semantic" && !semanticQuery) {
    throw new Error("mode=semantic 时必须提供 semanticQuery（用户语义描述）");
  }

  const scopeRaw = String(args.scope ?? "full").trim();
  const scope: "full" | "chapter" =
    scopeRaw === "chapter" ? "chapter" : "full";
  const chapterIndex =
    typeof args.chapterIndex === "number" && Number.isFinite(args.chapterIndex)
      ? Math.trunc(args.chapterIndex)
      : 0;
  /** 高亮词 AI 检索等：放宽抽取/返回，不受词云词项上限约束 */
  const unlimitedTerms = args.unlimitedTerms === true;
  const configMax = normalizeWordcloudMaxWords(ctx.aiConfig.wordcloudMaxWords);
  const maxWords = unlimitedTerms
    ? Number.POSITIVE_INFINITY
    : typeof args.maxWords === "number" && Number.isFinite(args.maxWords)
      ? Math.min(
          configMax,
          Math.max(WORDCLOUD_MAX_WORDS_MIN, Math.trunc(args.maxWords)),
        )
      : configMax;

  const collect: SemanticCollectOpts = unlimitedTerms
    ? {
        collectMax: true,
        sampleCharsPerChapter: COLLECT_SAMPLE_CHARS_PER_CHAPTER,
        candidateMax: COLLECT_CANDIDATE_MAX,
        llmMaxTokens: COLLECT_LLM_MAX_TOKENS,
      }
    : {
        collectMax: false,
        sampleCharsPerChapter: SAMPLE_CHARS_PER_CHAPTER,
        candidateMax: WORDCLOUD_CANDIDATE_MAX,
        llmMaxTokens: WORDCLOUD_LLM_MAX_TOKENS,
      };

  const chapterCount = Math.max(1, ctx.chapterCount);
  const { min, max } = resolveChapterRange(
    chapterCount,
    scope,
    chapterIndex,
    ctx.spoilerMaxChapterIndex,
  );

  ctx.onProgress?.("构建分词缓存", `章节 ${min + 1}–${max + 1} / ${chapterCount}`);
  throwIfAborted(ctx.signal);

  let cacheHits = 0;
  let totalChars = 0;
  const chapterSlices = await fetchChaptersPlainTextRange({
    webContents: ctx.webContents,
    chapterCount,
    minChapterIndex: min,
    maxChapterIndex: max,
    onProgress: (cur, tot) => {
      throwIfAborted(ctx.signal);
      ctx.onProgress?.("构建分词缓存", `${cur}/${tot} 章`);
    },
  });

  if (chapterSlices.length === 0) {
    throw new Error("无法从阅读器取得章节正文，请确认书籍已加载");
  }

  const freqMaps: Map<string, number>[] = [];
  for (const slice of chapterSlices) {
    throwIfAborted(ctx.signal);
    const { freq, cacheHit, charCount } = getOrBuildChapterFreq(
      ctx.bookHash,
      slice.chapterIndex,
      slice.text,
      undefined,
      ctx.aiConfig,
    );
    if (cacheHit) cacheHits++;
    totalChars += charCount;
    freqMaps.push(freq);
  }

  let words: Array<{ text: string; weight: number }>;
  let termsExtracted: number | undefined;

  if (mode === "general") {
    const merged = mergeFreqMaps(freqMaps);
    for (const key of [...merged.keys()]) {
      if (isAiWordcloudStopword(key)) merged.delete(key);
    }
    words = topWordsFromFreq(merged, maxWords);
  } else {
    const queryHint = semanticQuery.slice(0, 48);
    ctx.onProgress?.(
      SEMANTIC_EXTRACT_PROGRESS_TITLE,
      semanticExtractProgressDetail(`语义：${queryHint}`, "正在准备抽样章节…"),
    );
    const sampleCount = unlimitedTerms
      ? COLLECT_SAMPLE_CHAPTER_COUNT
      : SAMPLE_CHAPTER_COUNT;
    const sampleChars = collect.sampleCharsPerChapter;
    const sampleIdx = pickSampleChapterIndices(max, sampleCount);
    const sampleTexts: string[] = [];
    const sampleTotal = sampleIdx.length;
    for (let i = 0; i < sampleIdx.length; i++) {
      throwIfAborted(ctx.signal);
      const idx = sampleIdx[i]!;
      ctx.onProgress?.(
        SEMANTIC_EXTRACT_PROGRESS_TITLE,
        semanticExtractProgressDetail(
          "正在抽样章节正文…",
          `当前进度：${i + 1}/${sampleTotal}`,
        ),
      );
      const hit = chapterSlices.find((s) => s.chapterIndex === idx);
      if (hit) sampleTexts.push(hit.text);
      else {
        const t =
          (await fetchChapterPlainTextFromRenderer(
            ctx.webContents,
            idx,
            sampleChars,
          )) ?? "";
        if (t.trim()) sampleTexts.push(t);
      }
    }
    if (sampleTexts.length === 0) {
      throw new Error("无法抽样章节正文以抽取语义词项");
    }
    let terms: string[];
    let stoppedEarly = false;
    try {
      terms = await extractSemanticTerms({
        semanticQuery,
        sampleTexts,
        chat: ctx.chat,
        collect,
        onTokenUsage: ctx.onTokenUsage,
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      });
    } catch (e) {
      if (e instanceof WordcloudStoppedWithTerms) {
        terms = e.terms;
        stoppedEarly = true;
      } else {
        throw e;
      }
    }
    termsExtracted = terms.length;
    if (!stoppedEarly) {
      ctx.onProgress?.(
        "统计词频",
        semanticExtractProgressDetail(
          `在 ${chapterSlices.length} 章正文中统计 ${terms.length} 个候选词`,
          "当前进度：计数中",
        ),
      );
    }
    // 词频统计为本地同步，停止后仍可用已抽词项排序
    const termFreq = countTermsInChapters(chapterSlices, terms);
    words = topWordsFromFreq(termFreq, maxWords);
  }

  return {
    type: "wordcloud",
    title,
    mode,
    ...(mode === "semantic" ? { semanticQuery } : {}),
    scope,
    ...(scope === "chapter" ? { chapterIndex } : {}),
    words,
    stats: {
      totalChars,
      uniqueTerms: words.length,
      cacheHits,
      ...(termsExtracted != null ? { termsExtracted } : {}),
    },
  };
}
