import type { VoiceReadDialogueQuoteStyle } from "../../constants/voiceRead";
import { hasVoiceReadSpeakableText } from "./voiceReadTextChunks";
import {
  parseVoiceSegments,
  type VoiceReadQuoteCarry,
} from "./voiceReadSegments";

/** 单向最多扫描的非空行数（含锚点与锚点外再多收的一行） */
export const VOICE_READ_SPEAKER_CONTEXT_MAX_SCAN = 15;

export type VoiceReadSpeakerLineContext = {
  /** 当前行之上：从上到下（远→近） */
  before: string[];
  /** 当前行之下：从上到下（近→远） */
  after: string[];
};

export function normalizeVoiceReadSpeakerLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * 纯对白行：切段后有效内容全是 dialogue（无旁白/引导语）。
 * 整行旁白、或「某某道："…"」均为非纯对白。
 */
export function isPureDialogueLine(
  line: string,
  quoteStyles: readonly VoiceReadDialogueQuoteStyle[],
  carry: VoiceReadQuoteCarry = null,
): boolean {
  const raw = normalizeVoiceReadSpeakerLine(line);
  if (!raw || !hasVoiceReadSpeakableText(raw)) return false;
  const { segments } = parseVoiceSegments(raw, { quoteStyles, carry });
  let hasDialogue = false;
  for (const seg of segments) {
    if (!seg.text.trim()) continue;
    if (seg.kind !== "dialogue") return false;
    hasDialogue = true;
  }
  return hasDialogue;
}

/**
 * 向两侧收集说话人识别参考上下文：
 * 穿过纯对白行，收到首个非纯对白行后，再多收一行；中间纯对白一并保留。
 */
export function collectVoiceReadSpeakerLineContext(opts: {
  /** 当前行号（与 getLine 同一套编号；阅读器一般为 1-based） */
  lineNo: number;
  quoteStyles: readonly VoiceReadDialogueQuoteStyle[];
  getLine: (lineNo: number) => string;
  /** 最大行号（含）；缺省时向下最多空探 maxScan 次不可朗读行后停止 */
  maxLineNo?: number;
  /** 最小行号（含）；默认 1 */
  minLineNo?: number;
  maxScan?: number;
}): VoiceReadSpeakerLineContext {
  const maxScan = opts.maxScan ?? VOICE_READ_SPEAKER_CONTEXT_MAX_SCAN;
  const quoteStyles = opts.quoteStyles;
  const getLine = opts.getLine;
  const lineNo = opts.lineNo;
  const minLineNo = opts.minLineNo ?? 1;
  const maxLineNo = opts.maxLineNo;

  const before: string[] = [];
  let beforeState: "seek" | "extra" | "done" = "seek";
  let beforeScanned = 0;
  let beforeEmptyStreak = 0;
  for (let dist = 1; beforeState !== "done" && beforeScanned < maxScan; dist++) {
    const ln = lineNo - dist;
    if (ln < minLineNo) break;
    const t = normalizeVoiceReadSpeakerLine(getLine(ln));
    if (!t || !hasVoiceReadSpeakableText(t)) {
      beforeEmptyStreak += 1;
      if (beforeEmptyStreak > maxScan) break;
      continue;
    }
    beforeEmptyStreak = 0;
    beforeScanned += 1;
    if (beforeState === "seek") {
      before.unshift(t);
      if (!isPureDialogueLine(t, quoteStyles)) {
        beforeState = "extra";
      }
    } else {
      before.unshift(t);
      beforeState = "done";
    }
  }

  const after: string[] = [];
  let afterState: "seek" | "extra" | "done" = "seek";
  let afterScanned = 0;
  let afterEmptyStreak = 0;
  for (let dist = 1; afterState !== "done" && afterScanned < maxScan; dist++) {
    const ln = lineNo + dist;
    if (maxLineNo != null && ln > maxLineNo) break;
    const t = normalizeVoiceReadSpeakerLine(getLine(ln));
    if (!t || !hasVoiceReadSpeakableText(t)) {
      afterEmptyStreak += 1;
      if (maxLineNo == null && afterEmptyStreak > maxScan) break;
      continue;
    }
    afterEmptyStreak = 0;
    afterScanned += 1;
    if (afterState === "seek") {
      after.push(t);
      if (!isPureDialogueLine(t, quoteStyles)) {
        afterState = "extra";
      }
    } else {
      after.push(t);
      afterState = "done";
    }
  }

  return { before, after };
}

/** 供缓存键：上下文原文指纹 */
export function voiceReadSpeakerContextCacheToken(
  ctx: VoiceReadSpeakerLineContext,
): string {
  return `${ctx.before.join("\u0001")}\u0002${ctx.after.join("\u0001")}`;
}
