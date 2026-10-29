import { engineConfigFingerprint } from "@shared/voiceReadEngineConfig";
import { voiceReadEmotionCacheToken } from "@shared/voiceReadEmotion";
import type { VoiceReadEmotionId } from "@shared/voiceReadEmotion";
import { clonePausePoints } from "@shared/voiceReadPunctuationPauses";
import type { VolcengineSpeechSlot } from "@shared/voiceReadVolcengineAudio";
import type { VoiceReadSettings } from "../../constants/voiceRead";
import type { VoiceReadSynthesisResult } from "@shared/voiceReadSynthesis";

export type PreparedIpcAudio = VoiceReadSynthesisResult;

const IPC_AUDIO_CACHE_LIMIT = 64;

function normalizeLineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function voiceReadChunkCacheKey(
  settings: VoiceReadSettings,
  chunkText: string,
  voiceId: string,
  emotion?: VoiceReadEmotionId,
  speechSlot?: VolcengineSpeechSlot,
  language?: string,
  dialect?: string,
): string {
  const t = normalizeLineText(chunkText);
  return [
    settings.engine,
    voiceId.trim(),
    speechSlot ?? "",
    language ?? "",
    dialect ?? "",
    settings.rate,
    settings.pitch,
    engineConfigFingerprint(settings.engineConfig),
    voiceReadEmotionCacheToken(emotion),
    t,
  ].join("\u0001");
}

export class VoiceReadAudioCache {
  private readonly cache = new Map<string, PreparedIpcAudio>();
  private readonly inflight = new Map<string, Promise<PreparedIpcAudio>>();
  private readonly skipKeys = new Set<string>();

  get(key: string): PreparedIpcAudio | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    this.touch(key, hit);
    return hit;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  hasInflight(key: string): boolean {
    return this.inflight.has(key);
  }

  markSkip(key: string): void {
    this.skipKeys.add(key);
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.inflight.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
    this.skipKeys.clear();
  }

  async getOrFetch(
    key: string,
    fetcher: () => Promise<PreparedIpcAudio>,
  ): Promise<PreparedIpcAudio> {
    const cached = this.get(key);
    if (cached) return this.clonePrepared(cached);

    const inflight = this.inflight.get(key);
    if (inflight) return this.clonePrepared(await inflight);

    const request = fetcher()
      .then((prep) => {
        if (!this.skipKeys.delete(key)) {
          this.touch(key, prep);
        }
        return prep;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return this.clonePrepared(await request);
  }

  private touch(key: string, value: PreparedIpcAudio): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    while (this.cache.size > IPC_AUDIO_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private clonePrepared(prep: PreparedIpcAudio): PreparedIpcAudio {
    if (prep.format === "pcm_s16le") {
      return {
        format: prep.format,
        sampleRate: prep.sampleRate,
        data: prep.data.slice(0),
      };
    }
    return {
      format: prep.format,
      data: prep.data.slice(0),
      sampleRate: prep.sampleRate,
      pauses: clonePausePoints(prep.pauses),
    };
  }
}
