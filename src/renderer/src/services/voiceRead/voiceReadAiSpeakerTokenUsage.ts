import {
  addTokenUsage,
  ZERO_TOKEN_USAGE,
  type AITokenUsageTotals,
} from "@shared/aiTokenUsage";
import { ref } from "vue";

export const voiceReadAiSpeakerTokenUsage = ref<AITokenUsageTotals>({
  ...ZERO_TOKEN_USAGE,
});
export const voiceReadAiSpeakerTokenUsageAvailable = ref(false);

export function absorbVoiceReadAiSpeakerTokenUsage(part: {
  tokenUsage?: AITokenUsageTotals | null;
  tokenUsageAvailable?: boolean;
}): void {
  if (part.tokenUsage) {
    voiceReadAiSpeakerTokenUsage.value = addTokenUsage(
      voiceReadAiSpeakerTokenUsage.value,
      part.tokenUsage,
    );
  }
  if (part.tokenUsageAvailable === true) {
    voiceReadAiSpeakerTokenUsageAvailable.value = true;
  }
}

export function clearVoiceReadAiSpeakerTokenUsage(): void {
  voiceReadAiSpeakerTokenUsage.value = { ...ZERO_TOKEN_USAGE };
  voiceReadAiSpeakerTokenUsageAvailable.value = false;
}

export function hydrateVoiceReadAiSpeakerTokenUsage(raw: {
  usage?: Partial<AITokenUsageTotals> | null;
  available?: boolean;
}): void {
  const u = raw.usage;
  if (u && typeof u === "object") {
    const merged = addTokenUsage(ZERO_TOKEN_USAGE, {
      promptTokens: typeof u.promptTokens === "number" ? u.promptTokens : 0,
      completionTokens:
        typeof u.completionTokens === "number" ? u.completionTokens : 0,
      totalTokens: typeof u.totalTokens === "number" ? u.totalTokens : 0,
      promptCacheHitTokens:
        typeof u.promptCacheHitTokens === "number"
          ? u.promptCacheHitTokens
          : undefined,
    });
    voiceReadAiSpeakerTokenUsage.value = merged;
  } else {
    voiceReadAiSpeakerTokenUsage.value = { ...ZERO_TOKEN_USAGE };
  }
  voiceReadAiSpeakerTokenUsageAvailable.value = raw.available === true;
}

export function voiceReadAiSpeakerTokenUsagePersistPayload(): {
  usage: AITokenUsageTotals;
  available: boolean;
} {
  return {
    usage: { ...voiceReadAiSpeakerTokenUsage.value },
    available: voiceReadAiSpeakerTokenUsageAvailable.value,
  };
}
