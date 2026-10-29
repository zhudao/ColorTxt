import type { CharacterRosterEntry } from "@shared/characterTypes";
import type { VoiceReadEmotionId } from "@shared/voiceReadEmotion";
import { VOICE_READ_EMOTION_AUTO } from "@shared/voiceReadEmotion";
import type { VoiceReadQuoteAttribution } from "@shared/voiceReadSpeakerIpc";
import { parseCharacterAliasesInput } from "@shared/characterAliases";
import { absorbVoiceReadAiSpeakerTokenUsage } from "./voiceReadAiSpeakerTokenUsage";

export type VoiceReadSpeakerCacheKey = string;

export type VoiceReadSpeakerAttributionResult = {
  quotes: VoiceReadQuoteAttribution[];
  narrationEmotion?: VoiceReadEmotionId;
};

type CacheEntry = VoiceReadSpeakerAttributionResult;

const cache = new Map<VoiceReadSpeakerCacheKey, CacheEntry>();
const inflight = new Map<
  VoiceReadSpeakerCacheKey,
  Promise<VoiceReadSpeakerAttributionResult>
>();
/** 作废后：在途 AI 识别完成时不再写回缓存 */
const skipCacheKeys = new Set<VoiceReadSpeakerCacheKey>();

let rosterVersion = 0;

export function bumpVoiceReadSpeakerRosterVersion(): void {
  rosterVersion += 1;
  cache.clear();
  inflight.clear();
  skipCacheKeys.clear();
}

function rosterVersionToken(roster: readonly CharacterRosterEntry[]): string {
  return roster
    .map(
      (r) =>
        `${r.displayName}\u0001${r.aliases}\u0001${r.voiceReadVoiceId ?? ""}\u0001${r.gender}`,
    )
    .join("\u0002");
}

/** 供设置页试听等场景构造缓存键 */
export function voiceReadSpeakerRosterToken(
  roster: readonly CharacterRosterEntry[],
): string {
  return rosterVersionToken(roster);
}

export function voiceReadSpeakerCacheKey(
  bookPath: string,
  lineNo: number,
  lineText: string,
  dialogueTexts: string[],
  roster: readonly CharacterRosterEntry[],
  includeEmotion = false,
  contextToken = "",
): VoiceReadSpeakerCacheKey {
  return [
    bookPath,
    String(lineNo),
    lineText,
    dialogueTexts.join("\u0001"),
    String(rosterVersion),
    rosterVersionToken(roster),
    includeEmotion ? "emo1" : "emo0",
    contextToken,
  ].join("\u0003");
}

export function getCachedSpeakerAttribution(
  key: VoiceReadSpeakerCacheKey,
): VoiceReadSpeakerAttributionResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  return {
    quotes: hit.quotes.map((q) => ({ ...q })),
    narrationEmotion: hit.narrationEmotion,
  };
}

/** @deprecated 使用 getCachedSpeakerAttribution */
export function getCachedQuoteAttributions(
  key: VoiceReadSpeakerCacheKey,
): VoiceReadQuoteAttribution[] | null {
  return getCachedSpeakerAttribution(key)?.quotes ?? null;
}

export function setCachedSpeakerAttribution(
  key: VoiceReadSpeakerCacheKey,
  result: VoiceReadSpeakerAttributionResult,
): void {
  cache.set(key, {
    quotes: result.quotes.map((q) => ({ ...q })),
    narrationEmotion: result.narrationEmotion,
  });
}

export function clearVoiceReadSpeakerCache(): void {
  cache.clear();
  inflight.clear();
  skipCacheKeys.clear();
}

/** 强制下次对该行重新 AI 识别（「重新合成」用） */
export function invalidateCachedQuoteAttributions(
  key: VoiceReadSpeakerCacheKey,
): void {
  cache.delete(key);
  inflight.delete(key);
  skipCacheKeys.add(key);
}

function unknownQuotes(count: number): VoiceReadQuoteAttribution[] {
  return Array.from({ length: count }, () => ({
    kind: "unknown" as const,
    speaker: null,
    emotion: VOICE_READ_EMOTION_AUTO,
  }));
}

function unknownAttribution(count: number): VoiceReadSpeakerAttributionResult {
  return {
    quotes: unknownQuotes(count),
    narrationEmotion: VOICE_READ_EMOTION_AUTO,
  };
}

export async function attributeDialogueQuotes(
  line: string,
  quoteTexts: string[],
  roster: readonly CharacterRosterEntry[],
  cacheKey: VoiceReadSpeakerCacheKey,
  includeEmotion = false,
  context?: { before?: string[]; after?: string[] },
): Promise<VoiceReadSpeakerAttributionResult> {
  if (quoteTexts.length === 0) {
    return { quotes: [], narrationEmotion: VOICE_READ_EMOTION_AUTO };
  }
  const hit = getCachedSpeakerAttribution(cacheKey);
  if (hit && hit.quotes.length === quoteTexts.length) return hit;

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const rosterPayload = roster.map((r) => ({
    displayName: r.displayName,
    aliases: parseCharacterAliasesInput(r.aliases),
  }));
  const contextBefore = (context?.before ?? [])
    .map((t) => t.trim())
    .filter(Boolean);
  const contextAfter = (context?.after ?? [])
    .map((t) => t.trim())
    .filter(Boolean);

  const work = window.colorTxt
    .voiceReadAttributeSpeakers({
      line,
      dialogueTexts: quoteTexts,
      roster: rosterPayload,
      includeEmotion,
      contextBefore,
      contextAfter,
    })
    .then((r) => {
      if (r.ok) {
        absorbVoiceReadAiSpeakerTokenUsage({
          tokenUsage: r.tokenUsage,
          tokenUsageAvailable: r.tokenUsageAvailable,
        });
      }
      if (!r.ok) {
        return unknownAttribution(quoteTexts.length);
      }
      const quotes = r.quotes.slice(0, quoteTexts.length);
      while (quotes.length < quoteTexts.length) {
        quotes.push({
          kind: "unknown",
          speaker: null,
          emotion: VOICE_READ_EMOTION_AUTO,
        });
      }
      const result: VoiceReadSpeakerAttributionResult = {
        quotes,
        narrationEmotion: r.narrationEmotion ?? VOICE_READ_EMOTION_AUTO,
      };
      if (!skipCacheKeys.delete(cacheKey)) {
        setCachedSpeakerAttribution(cacheKey, result);
      }
      return result;
    })
    .catch(() => unknownAttribution(quoteTexts.length))
    .finally(() => {
      inflight.delete(cacheKey);
    });

  inflight.set(cacheKey, work);
  return work;
}

/** @deprecated 使用 attributeDialogueQuotes */
export async function attributeDialogueSpeakers(
  line: string,
  quoteTexts: string[],
  roster: readonly CharacterRosterEntry[],
  cacheKey: VoiceReadSpeakerCacheKey,
): Promise<VoiceReadQuoteAttribution[]> {
  const r = await attributeDialogueQuotes(
    line,
    quoteTexts,
    roster,
    cacheKey,
  );
  return r.quotes;
}
