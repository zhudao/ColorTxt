import type { CharacterRosterEntry } from "@shared/characterTypes";
import type { VoiceReadEmotionId } from "@shared/voiceReadEmotion";
import type { VoiceReadQuoteAttribution } from "@shared/voiceReadSpeakerIpc";
import { voiceReadEngineSupportsMultiVoiceScheme } from "@shared/voiceReadEngines";
import type { VoiceReadSettings } from "../../constants/voiceRead";
import { voiceReadSingleVoiceId } from "../../constants/voiceRead";
import { voiceReadChunkUnitsForEngine } from "./voiceReadEngineRouting";
import {
  hasVoiceReadSpeakableText,
  splitVoiceReadChunks,
} from "./voiceReadTextChunks";
import {
  parseVoiceSegments,
  type VoiceReadQuoteCarry,
  type VoiceReadTextSegment,
} from "./voiceReadSegments";
import {
  resolveSpeakChunk,
  type VoiceReadSpeakChunk,
} from "./voiceReadVoiceResolve";

const DEFAULT_QUOTE_OPEN = "\u201C";
const DEFAULT_QUOTE_CLOSE = "\u201D";

/**
 * AI 判为「非对白」的引号段拼回相邻旁白，避免分段合成产生停顿。
 * 保留的对白段附带对应 quoteAttr，避免合并后 attribution 索引错位。
 */
function mergeAiNarrationQuotes(
  segments: readonly VoiceReadTextSegment[],
  quoteAttributions: readonly VoiceReadQuoteAttribution[] | undefined,
  aiFeaturesEnabled: boolean,
): VoiceReadTextSegment[] {
  if (!aiFeaturesEnabled || !quoteAttributions?.length) {
    return segments.map((s) => ({ ...s }));
  }

  const out: VoiceReadTextSegment[] = [];
  let pendingNarration = "";
  let dialogueIdx = 0;

  const flushNarration = () => {
    const t = pendingNarration;
    if (!t) return;
    out.push({ kind: "narration", text: t });
    pendingNarration = "";
  };

  for (const seg of segments) {
    if (!seg.text.trim()) continue;
    if (seg.kind === "narration") {
      pendingNarration += seg.text;
      continue;
    }

    const attr = quoteAttributions[dialogueIdx];
    dialogueIdx += 1;
    if (attr?.kind === "narration") {
      const open = seg.quoteOpen ?? DEFAULT_QUOTE_OPEN;
      const close = seg.quoteClose ?? DEFAULT_QUOTE_CLOSE;
      pendingNarration += `${open}${seg.text}${close}`;
      continue;
    }

    flushNarration();
    out.push({ ...seg, quoteAttr: attr });
  }

  flushNarration();
  return out;
}

function chunkUnitsForEngine(engine: VoiceReadSettings["engine"]): number {
  return voiceReadChunkUnitsForEngine(engine);
}

function splitSegmentToSpeakChunks(
  settings: VoiceReadSettings,
  segment: VoiceReadTextSegment,
  roster: readonly CharacterRosterEntry[],
  quoteAttr: VoiceReadQuoteAttribution | undefined,
  aiFeaturesEnabled: boolean,
  narrationEmotion?: VoiceReadEmotionId,
): VoiceReadSpeakChunk[] {
  const resolved = resolveSpeakChunk(
    settings,
    segment,
    roster,
    quoteAttr,
    aiFeaturesEnabled,
    narrationEmotion,
  );
  const units = chunkUnitsForEngine(settings.engine);
  const parts = splitVoiceReadChunks(resolved.text, units);
  const texts = parts.length > 0 ? parts : [resolved.text];
  return texts.map((text) => ({
    text,
    voiceId: resolved.voiceId,
    emotion: resolved.emotion,
    speechSlot: resolved.speechSlot,
    volcengineLanguage: resolved.volcengineLanguage,
    volcengineDialect: resolved.volcengineDialect,
  }));
}

export type BuildLineSpeakChunksResult = {
  chunks: VoiceReadSpeakChunk[];
  carry: VoiceReadQuoteCarry;
  dialogueSegments: { segmentIndex: number; text: string }[];
  narrationEmotion?: VoiceReadEmotionId;
};

/** 将一行编辑器文本转为可合成的 speak chunks（含 multi 旁白/对白与切段） */
export function buildLineSpeakChunks(
  settings: VoiceReadSettings,
  line: string,
  roster: readonly CharacterRosterEntry[],
  opts: {
    carry?: VoiceReadQuoteCarry;
    quoteAttributions?: VoiceReadQuoteAttribution[];
    narrationEmotion?: VoiceReadEmotionId;
    aiFeaturesEnabled?: boolean;
  } = {},
): BuildLineSpeakChunksResult {
  const aiFeaturesEnabled = opts.aiFeaturesEnabled === true;
  const raw = line.replace(/\s+/g, " ").trim();
  if (!raw || !hasVoiceReadSpeakableText(raw)) {
    return { chunks: [], carry: opts.carry ?? null, dialogueSegments: [] };
  }

  if (
    settings.scheme === "single" ||
    !voiceReadEngineSupportsMultiVoiceScheme(
      settings.engine,
      settings.engineConfig,
    )
  ) {
    const units = chunkUnitsForEngine(settings.engine);
    const parts = splitVoiceReadChunks(raw, units);
    const texts = parts.length > 0 ? parts : [raw];
    return {
      chunks: texts.map((text) => ({
        text,
        voiceId: voiceReadSingleVoiceId(settings),
        speechSlot: "single" as const,
      })),
      carry: null,
      dialogueSegments: [],
    };
  }

  const { segments, carry } = parseVoiceSegments(raw, {
    quoteStyles: settings.multi.dialogueQuoteStyles,
    carry: opts.carry,
  });

  const dialogueSegments: { segmentIndex: number; text: string }[] = [];
  let dialogueIdxForAi = 0;
  for (const seg of segments) {
    if (seg.kind !== "dialogue" || !seg.text.trim()) continue;
    dialogueSegments.push({
      segmentIndex: dialogueIdxForAi,
      text: seg.text.trim(),
    });
    dialogueIdxForAi += 1;
  }

  const mergedSegments = mergeAiNarrationQuotes(
    segments,
    opts.quoteAttributions,
    aiFeaturesEnabled,
  );

  const chunks: VoiceReadSpeakChunk[] = [];

  for (const seg of mergedSegments) {
    if (!seg.text.trim()) continue;
    chunks.push(
      ...splitSegmentToSpeakChunks(
        settings,
        seg,
        roster,
        seg.kind === "dialogue" ? seg.quoteAttr : undefined,
        aiFeaturesEnabled,
        opts.narrationEmotion,
      ),
    );
  }

  return { chunks, carry, dialogueSegments, narrationEmotion: opts.narrationEmotion };
}
