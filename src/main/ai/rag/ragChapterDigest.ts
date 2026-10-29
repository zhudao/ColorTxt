import type { AIChatEndpoint } from "@shared/aiTypes";
import { formatAiToolChapterHeading } from "@shared/aiChapterRefPrompt";
import {
  ZERO_TOKEN_USAGE,
  addTokenUsage,
  type AITokenUsageTotals,
} from "@shared/aiTokenUsage";
import type { ChapterChunkRow } from "./vectorDb";
import { chatCompletionOnce } from "../chat/chat";

/** 本章原文字数 ≤ 此值时不压缩，原样返回 mergedMarkdown */
export const RAG_CHAPTER_NO_COMPRESS_CHARS = 10_000;

/** 超长章分段压缩后，交给 Agent 的 mergedMarkdown 总字数上限 */
export const RAG_CHAPTER_DIGEST_MAX_CHARS = 10_000;

/** 单次送入压缩模型的原文字符数（与阈值对齐，超长章按「每 1 万字一段」切） */
export const RAG_DIGEST_SEGMENT_RAW_CHARS = RAG_CHAPTER_NO_COMPRESS_CHARS;

const DIGEST_MIN_PER_SEGMENT = 180;

export type ChapterDigestProgressUi = {
  /** 折叠标题：读取章节原文（M/N） */
  title: string;
  /** 折叠正文：说明 + 当前进度（两行） */
  detail: string;
};

export function chapterDigestProgressUi(
  currentSegment: number,
  totalSegments: number,
): ChapterDigestProgressUi {
  return {
    title: `读取章节原文（${currentSegment}/${totalSegments}）`,
    detail: [
      "本章超过 1 万字，正在按每 1 万字一段压缩为全章提要。",
      `当前进度：${currentSegment}/${totalSegments}`,
    ].join("\n"),
  };
}

export function mergeChapterChunkRows(rows: ChapterChunkRow[]): string {
  let text = "";
  for (const r of rows) {
    const piece = `\n\n---\n${formatAiToolChapterHeading(r.chapterIndex, r.chapterTitle)}\n${r.content}`;
    text += piece;
  }
  return text.trim();
}

function splitTextForDigest(text: string, maxChunk: number): string[] {
  const segments: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxChunk, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > i + Math.floor(maxChunk * 0.45)) end = nl + 1;
    }
    const part = text.slice(i, end).trim();
    if (part) segments.push(part);
    i = end;
  }
  return segments;
}

function allocateDigestBudgets(
  segmentLengths: number[],
  maxTotal: number,
): number[] {
  const total = segmentLengths.reduce((a, b) => a + b, 0);
  if (total <= 0 || maxTotal <= 0) {
    return segmentLengths.map(() => 0);
  }
  const budgets = segmentLengths.map((len) =>
    Math.max(
      DIGEST_MIN_PER_SEGMENT,
      Math.floor((maxTotal * len) / total),
    ),
  );
  let sum = budgets.reduce((a, b) => a + b, 0);
  while (sum > maxTotal) {
    let idx = 0;
    for (let i = 1; i < budgets.length; i++) {
      if (budgets[i]! > budgets[idx]!) idx = i;
    }
    if (budgets[idx]! <= DIGEST_MIN_PER_SEGMENT) break;
    budgets[idx]!--;
    sum--;
  }
  while (sum < maxTotal && budgets.length > 0) {
    let idx = 0;
    for (let i = 1; i < budgets.length; i++) {
      if (segmentLengths[i]! > segmentLengths[idx]!) idx = i;
    }
    budgets[idx]!++;
    sum++;
  }
  return budgets;
}

async function compressOneSegment(
  chat: AIChatEndpoint,
  segmentText: string,
  maxOutChars: number,
  segmentIndex: number,
  segmentTotal: number,
  signal?: AbortSignal,
): Promise<{ text: string; usage: AITokenUsageTotals | null }> {
  const user = [
    `将下列小说章节片段（第 ${segmentIndex + 1}/${segmentTotal} 段）压缩为简明提要。`,
    `要求：保留情节推进、人物、冲突与伏笔；不编造；简体中文；**不超过 ${maxOutChars} 字**。`,
    "",
    "---",
    segmentText,
  ].join("\n");

  const { text: raw, usage } = await chatCompletionOnce({
    chat,
    messages: [
      {
        role: "system",
        content:
          "你是阅读助手，只做忠实压缩摘要，不评价、不剧透式发挥。",
      },
      { role: "user", content: user },
    ],
    maxTokens: Math.min(chat.maxTokens, Math.max(256, maxOutChars * 2)),
    temperature: Math.min(chat.temperature, 0.4),
    signal,
  });

  const t = raw.trim();
  const text =
    t.length <= maxOutChars ? t : `${t.slice(0, maxOutChars)}…`;
  return { text, usage };
}

/** 将超长章节正文压缩为不超过 maxDigestChars 的提要（主进程内多次调用对话模型） */
export async function compressChapterToDigest(opts: {
  chat: AIChatEndpoint;
  fullText: string;
  maxDigestChars?: number;
  signal?: AbortSignal;
  /** 开始压缩第 currentSegment 段（1-based），共 totalSegments 段 */
  onSegmentProgress?: (
    currentSegment: number,
    totalSegments: number,
  ) => void;
}): Promise<{ digest: string; usage: AITokenUsageTotals }> {
  const maxDigest = opts.maxDigestChars ?? RAG_CHAPTER_DIGEST_MAX_CHARS;
  const segments = splitTextForDigest(
    opts.fullText,
    RAG_DIGEST_SEGMENT_RAW_CHARS,
  );
  if (segments.length === 0) {
    return { digest: "", usage: { ...ZERO_TOKEN_USAGE } };
  }

  const total = segments.length;
  let usageAcc = { ...ZERO_TOKEN_USAGE };

  if (segments.length === 1) {
    opts.onSegmentProgress?.(1, 1);
    const one = await compressOneSegment(
      opts.chat,
      segments[0]!,
      maxDigest,
      0,
      1,
      opts.signal,
    );
    usageAcc = addTokenUsage(usageAcc, one.usage);
    return { digest: one.text, usage: usageAcc };
  }

  const budgets = allocateDigestBudgets(
    segments.map((s) => s.length),
    maxDigest,
  );
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    opts.onSegmentProgress?.(i + 1, total);
    const part = await compressOneSegment(
      opts.chat,
      segments[i]!,
      budgets[i] ?? DIGEST_MIN_PER_SEGMENT,
      i,
      segments.length,
      opts.signal,
    );
    usageAcc = addTokenUsage(usageAcc, part.usage);
    if (part.text) parts.push(part.text);
  }

  let merged = parts.join("\n\n---\n\n");
  if (merged.length > maxDigest) {
    merged = `${merged.slice(0, maxDigest)}…`;
  }
  return { digest: merged, usage: usageAcc };
}
