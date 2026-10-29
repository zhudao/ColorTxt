import type { CharacterRosterEntry } from "@shared/characterTypes";
import {
  normalizeVolcengineSpeechModePair,
  type VolcengineSpeechSlot,
} from "@shared/voiceReadVolcengineAudio";
import type { VoiceReadSettings } from "../../constants/voiceRead";
import {
  voiceReadMultiDialogueFemaleVoiceId,
  voiceReadMultiDialogueMaleVoiceId,
  voiceReadMultiDialogueVoiceId,
} from "../../constants/voiceRead";
import { buildLineSpeakChunks } from "./voiceReadLineBuild";
import { VoiceReadLinePlayer } from "./voiceReadLinePlayer";

type CharacterVoicePreviewEntry = Pick<
  CharacterRosterEntry,
  | "gender"
  | "voiceReadVoiceId"
  | "voiceReadLanguage"
  | "voiceReadDialect"
  | "voiceReadSampleLine"
>;

export function resolveCharacterVoicePreviewVoiceId(
  entry: Pick<CharacterRosterEntry, "gender" | "voiceReadVoiceId">,
  settings: VoiceReadSettings,
): string {
  const custom = entry.voiceReadVoiceId?.trim();
  if (custom) return custom;
  if (entry.gender === "male") {
    return voiceReadMultiDialogueMaleVoiceId(settings);
  }
  if (entry.gender === "female") {
    return voiceReadMultiDialogueFemaleVoiceId(settings);
  }
  return voiceReadMultiDialogueVoiceId(settings);
}

function previewSpeechSlot(
  entry: Pick<CharacterRosterEntry, "gender" | "voiceReadVoiceId">,
): VolcengineSpeechSlot | undefined {
  if (entry.voiceReadVoiceId?.trim()) return undefined;
  if (entry.gender === "male") return "dialogueMale";
  if (entry.gender === "female") return "dialogueFemale";
  return "dialogue";
}

export function characterVoicePreviewSettings(
  entry: Pick<CharacterRosterEntry, "gender" | "voiceReadVoiceId">,
  settings: VoiceReadSettings,
): VoiceReadSettings {
  return {
    ...settings,
    scheme: "single",
    single: {
      voiceId: resolveCharacterVoicePreviewVoiceId(entry, settings),
    },
  };
}

export async function speakCharacterVoiceSample(
  player: VoiceReadLinePlayer,
  settings: VoiceReadSettings,
  entry: CharacterVoicePreviewEntry,
): Promise<void> {
  const text = entry.voiceReadSampleLine?.trim() ?? "";
  if (!text) return;
  const previewSettings = characterVoicePreviewSettings(entry, settings);
  const chunks = buildLineSpeakChunks(previewSettings, text, []).chunks;
  const custom = entry.voiceReadVoiceId?.trim();
  const slot = previewSpeechSlot(entry);
  const mode = custom
    ? normalizeVolcengineSpeechModePair({
        language: entry.voiceReadLanguage,
        dialect: entry.voiceReadDialect,
      })
    : undefined;
  const patched = chunks.map((chunk) => ({
    ...chunk,
    speechSlot: slot,
    volcengineLanguage: mode?.language,
    volcengineDialect: mode?.dialect,
  }));
  if (patched.length > 0) {
    await player.speakChunks(previewSettings, patched);
  } else {
    await player.speakLine(previewSettings, text);
  }
}
