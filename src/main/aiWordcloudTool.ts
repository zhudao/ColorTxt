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
import { chatCompletionOnce } from "./aiChat";
import { fetchChapterPlainTextFromRenderer } from "./aiChapterPlainTextBridge";
import { getOrBuildChapterFreq } from "./aiSegmentCache";
import {
  countTermsInChapters,
  fetchChaptersPlainTextRange,
  mergeFreqMaps,
  pickSampleChapterIndices,
  topWordsFromFreq,
} from "./aiWordcloudChapterFetch";

const SAMPLE_CHAPTER_COUNT = 12;
const SAMPLE_CHARS_PER_CHAPTER = 2000;
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

function dedupeSemanticTerms(terms: readonly string[], max = 120): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const s = t.trim();
    if (!s || s.length > 40 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

async function refineSemanticTerms(opts: {
  semanticQuery: string;
  candidates: readonly string[];
  chat: AIChatEndpoint;
  onTokenUsage?: (usage: AITokenUsageTotals) => void;
  onProgress?: WordcloudToolProgress;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (opts.candidates.length === 0) return [];

  opts.onProgress?.(
    SEMANTIC_REFINE_PROGRESS_TITLE,
    semanticExtractProgressDetail(
      "正在按用户语义筛选候选词…",
      `候选 ${opts.candidates.length} 项`,
    ),
  );

  const { text, usage } = await chatCompletionOnce({
    chat: opts.chat,
    signal: opts.signal,
    maxTokens: 4096,
    temperature: Math.min(opts.chat.temperature, 0.15),
    messages: [
      { role: "system", content: buildSemanticRefineSystemPrompt() },
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
  const refined = dedupeSemanticTerms(parseTermsFromLlmJson(text)).filter((t) =>
    candidateSet.has(t),
  );
  if (refined.length > 0) return refined;
  return dedupeSemanticTerms(opts.candidates);
}

async function extractSemanticTerms(opts: {
  semanticQuery: string;
  sampleTexts: string[];
  chat: AIChatEndpoint;
  onTokenUsage?: (usage: AITokenUsageTotals) => void;
  onProgress?: WordcloudToolProgress;
  signal?: AbortSignal;
}): Promise<string[]> {
  const joined = opts.sampleTexts
    .map((t, i) => `--- 抽样 ${i + 1} ---\n${t.slice(0, SAMPLE_CHARS_PER_CHAPTER)}`)
    .join("\n\n");

  opts.onProgress?.(
    SEMANTIC_EXTRACT_PROGRESS_TITLE,
    "正在向模型请求词项列表…",
  );

  const { text, usage } = await chatCompletionOnce({
    chat: opts.chat,
    signal: opts.signal,
    maxTokens: 4096,
    temperature: Math.min(opts.chat.temperature, 0.3),
    messages: [
      {
        role: "system",
        content: buildSemanticExtractSystemPrompt(opts.semanticQuery),
      },
      {
        role: "user",
        content: `正文抽样：\n${joined}`,
      },
    ],
  });
  if (usage && opts.onTokenUsage) opts.onTokenUsage(usage);

  opts.onProgress?.(
    SEMANTIC_EXTRACT_PROGRESS_TITLE,
    semanticExtractProgressDetail(
      "正在解析模型返回的词项…",
      "当前进度：已收到响应",
    ),
  );

  const extracted = dedupeSemanticTerms(parseTermsFromLlmJson(text));
  const terms = await refineSemanticTerms({
    semanticQuery: opts.semanticQuery,
    candidates: extracted,
    chat: opts.chat,
    onTokenUsage: opts.onTokenUsage,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });

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
  const configMax = normalizeWordcloudMaxWords(ctx.aiConfig.wordcloudMaxWords);
  const maxWords =
    typeof args.maxWords === "number" && Number.isFinite(args.maxWords)
      ? Math.min(
          configMax,
          Math.max(WORDCLOUD_MAX_WORDS_MIN, Math.trunc(args.maxWords)),
        )
      : configMax;

  const chapterCount = Math.max(1, ctx.chapterCount);
  const { min, max } = resolveChapterRange(
    chapterCount,
    scope,
    chapterIndex,
    ctx.spoilerMaxChapterIndex,
  );

  ctx.onProgress?.("构建分词缓存", `章节 ${min + 1}–${max + 1} / ${chapterCount}`);

  let cacheHits = 0;
  let totalChars = 0;
  const chapterSlices = await fetchChaptersPlainTextRange({
    webContents: ctx.webContents,
    chapterCount,
    minChapterIndex: min,
    maxChapterIndex: max,
    onProgress: (cur, tot) => {
      ctx.onProgress?.("构建分词缓存", `${cur}/${tot} 章`);
    },
  });

  if (chapterSlices.length === 0) {
    throw new Error("无法从阅读器取得章节正文，请确认书籍已加载");
  }

  const freqMaps: Map<string, number>[] = [];
  for (const slice of chapterSlices) {
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
    const sampleIdx = pickSampleChapterIndices(max, SAMPLE_CHAPTER_COUNT);
    const sampleTexts: string[] = [];
    const sampleTotal = sampleIdx.length;
    for (let i = 0; i < sampleIdx.length; i++) {
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
            SAMPLE_CHARS_PER_CHAPTER,
          )) ?? "";
        if (t.trim()) sampleTexts.push(t);
      }
    }
    if (sampleTexts.length === 0) {
      throw new Error("无法抽样章节正文以抽取语义词项");
    }
    const terms = await extractSemanticTerms({
      semanticQuery,
      sampleTexts,
      chat: ctx.chat,
      onTokenUsage: ctx.onTokenUsage,
      onProgress: ctx.onProgress,
      signal: ctx.signal,
    });
    termsExtracted = terms.length;
    ctx.onProgress?.(
      "统计词频",
      semanticExtractProgressDetail(
        `在 ${chapterSlices.length} 章正文中统计 ${terms.length} 个候选词`,
        "当前进度：计数中",
      ),
    );
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
