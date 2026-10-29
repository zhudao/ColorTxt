import type { CharacterRosterEntry } from "@shared/characterTypes";
import { parseCharacterAliasesInput } from "@shared/characterAliases";
import {
  voiceReadEmotionActive,
  type VoiceReadEmotionId,
  VOICE_READ_EMOTION_AUTO,
} from "@shared/voiceReadEmotion";
import {
  normalizeVolcengineSpeechModePair,
  type VolcengineSpeechSlot,
} from "@shared/voiceReadVolcengineAudio";
import type { VoiceReadQuoteAttribution } from "@shared/voiceReadSpeakerIpc";
import type { VoiceReadSettings } from "../../constants/voiceRead";
import {
  voiceReadMultiDialogueFemaleVoiceId,
  voiceReadMultiDialogueMaleVoiceId,
  voiceReadMultiDialogueVoiceId,
  voiceReadMultiNarrationVoiceId,
  voiceReadSingleVoiceId,
} from "../../constants/voiceRead";
import { voiceReadEngineSupportsMultiVoiceScheme } from "@shared/voiceReadEngines";
import type { VoiceReadTextSegment } from "./voiceReadSegments";

export type VoiceReadSpeakChunk = {
  text: string;
  voiceId: string;
  emotion?: VoiceReadEmotionId;
  /** 火山引擎语种/方言按朗读槽位读取；角色专属音色无槽位 */
  speechSlot?: VolcengineSpeechSlot;
  /** 角色专属音色的语种/方言；设置后覆盖槽位配置 */
  volcengineLanguage?: string;
  volcengineDialect?: string;
};

function aliasDedupeKey(s: string): string {
  return s.trim().toLowerCase();
}

function findCharacterBySpeaker(
  roster: readonly CharacterRosterEntry[],
  speaker: string | null | undefined,
): CharacterRosterEntry | undefined {
  const key = speaker?.trim();
  if (!key) return undefined;
  const want = aliasDedupeKey(key);
  for (const entry of roster) {
    if (aliasDedupeKey(entry.displayName) === want) return entry;
    for (const a of parseCharacterAliasesInput(entry.aliases)) {
      if (aliasDedupeKey(a) === want) return entry;
    }
  }
  return undefined;
}

function dialogueFallbackVoiceId(settings: VoiceReadSettings): string {
  return voiceReadMultiDialogueVoiceId(settings);
}

function maleDialogueVoiceId(settings: VoiceReadSettings): string {
  return voiceReadMultiDialogueMaleVoiceId(settings);
}

function femaleDialogueVoiceId(settings: VoiceReadSettings): string {
  return voiceReadMultiDialogueFemaleVoiceId(settings);
}

function resolveSegmentVoice(
  settings: VoiceReadSettings,
  segment: Pick<VoiceReadTextSegment, "kind">,
  roster: readonly CharacterRosterEntry[],
  quoteAttr?: VoiceReadQuoteAttribution | null,
  aiFeaturesEnabled = false,
): { voiceId: string; speechSlot: VolcengineSpeechSlot | undefined; language?: string; dialect?: string } {
  if (
    settings.scheme === "single" ||
    !voiceReadEngineSupportsMultiVoiceScheme(
      settings.engine,
      settings.engineConfig,
    )
  ) {
    return {
      voiceId: voiceReadSingleVoiceId(settings),
      speechSlot: "single",
    };
  }
  if (segment.kind === "narration") {
    return {
      voiceId: voiceReadMultiNarrationVoiceId(settings),
      speechSlot: "narration",
    };
  }

  const aiOn = aiFeaturesEnabled && quoteAttr != null;
  if (aiOn && quoteAttr.kind === "narration") {
    return {
      voiceId: voiceReadMultiNarrationVoiceId(settings),
      speechSlot: "narration",
    };
  }

  if (!aiOn) {
    return {
      voiceId: dialogueFallbackVoiceId(settings),
      speechSlot: "dialogue",
    };
  }

  const hit = findCharacterBySpeaker(roster, quoteAttr.speaker);
  const charVoice = hit?.voiceReadVoiceId?.trim();
  if (hit && charVoice) {
    const mode = normalizeVolcengineSpeechModePair({
      language: hit.voiceReadLanguage,
      dialect: hit.voiceReadDialect,
    });
    return {
      voiceId: charVoice,
      speechSlot: undefined,
      language: mode.language,
      dialect: mode.dialect,
    };
  }
  if (hit?.gender === "male") {
    return {
      voiceId: maleDialogueVoiceId(settings),
      speechSlot: "dialogueMale",
    };
  }
  if (hit?.gender === "female") {
    return {
      voiceId: femaleDialogueVoiceId(settings),
      speechSlot: "dialogueFemale",
    };
  }
  if (quoteAttr.kind === "male") {
    return {
      voiceId: maleDialogueVoiceId(settings),
      speechSlot: "dialogueMale",
    };
  }
  if (quoteAttr.kind === "female") {
    return {
      voiceId: femaleDialogueVoiceId(settings),
      speechSlot: "dialogueFemale",
    };
  }
  return {
    voiceId: dialogueFallbackVoiceId(settings),
    speechSlot: "dialogue",
  };
}

export function resolveSegmentVoiceId(
  settings: VoiceReadSettings,
  segment: Pick<VoiceReadTextSegment, "kind">,
  roster: readonly CharacterRosterEntry[],
  quoteAttr?: VoiceReadQuoteAttribution | null,
  aiFeaturesEnabled = false,
): string {
  return resolveSegmentVoice(
    settings,
    segment,
    roster,
    quoteAttr,
    aiFeaturesEnabled,
  ).voiceId;
}

function resolveChunkEmotion(
  segment: Pick<VoiceReadTextSegment, "kind">,
  quoteEmotion: VoiceReadEmotionId | undefined,
  narrationEmotion: VoiceReadEmotionId | undefined,
  emotionActive: boolean,
): VoiceReadEmotionId | undefined {
  if (!emotionActive) return undefined;
  if (segment.kind === "narration") {
    const e = narrationEmotion ?? VOICE_READ_EMOTION_AUTO;
    return e === VOICE_READ_EMOTION_AUTO ? undefined : e;
  }
  const e = quoteEmotion ?? VOICE_READ_EMOTION_AUTO;
  return e === VOICE_READ_EMOTION_AUTO ? undefined : e;
}

export function resolveSpeakChunk(
  settings: VoiceReadSettings,
  segment: VoiceReadTextSegment,
  roster: readonly CharacterRosterEntry[],
  quoteAttr?: VoiceReadQuoteAttribution | null,
  aiFeaturesEnabled = false,
  narrationEmotion?: VoiceReadEmotionId,
): VoiceReadSpeakChunk {
  const emotionActive =
    voiceReadEmotionActive(settings) && aiFeaturesEnabled;
  const resolved = resolveSegmentVoice(
    settings,
    segment,
    roster,
    quoteAttr,
    aiFeaturesEnabled,
  );
  return {
    text: segment.text,
    voiceId: resolved.voiceId,
    speechSlot: resolved.speechSlot,
    volcengineLanguage: resolved.language,
    volcengineDialect: resolved.dialect,
    emotion: resolveChunkEmotion(
      segment,
      quoteAttr?.emotion,
      narrationEmotion,
      emotionActive,
    ),
  };
}
