/**
 * 朗读会话：系统 / Edge（主进程 MP3）/ DashScope（SSE）。
 * Edge / DashScope 播放模型：切段 + AudioContext 时间线排播、
 * Edge 多段并行 fetch（buffer 4）；DashScope 按段合成后逐段排播。
 * 暴露 `speakChunks` / `onChunkChange` 供后续「上一句 / 下一句」按段跳转。
 */

import type { VoiceReadEmotionId } from "@shared/voiceReadEmotion";
import type { VoiceReadPausePoint } from "@shared/voiceReadSynthesis";
import {
  applyPunctuationPausesToPcm,
  clonePausePoints,
} from "@shared/voiceReadPunctuationPauses";
import type { VoiceReadSettings } from "../../constants/voiceRead";
import {
  clampVoiceReadVolume,
  voiceReadSingleVoiceId,
} from "../../constants/voiceRead";
import type { VoiceReadSpeakChunk } from "./voiceReadVoiceResolve";
import {
  voiceReadChunkCacheKey,
} from "./voiceReadAudioCache";
import {
  synthesizeVoiceReadViaIpc,
  toVoiceReadSynthesisRequest,
} from "./voiceReadSynthesisClient";
import {
  voiceReadChunkUnitsForEngine,
  voiceReadEdgeFetchBufferSize,
  voiceReadPlaybackKind,
  voiceReadPcmClientPlaybackRate,
  voiceReadRequiresSerialChunkFetch,
} from "./voiceReadEngineRouting";
import {
  hasVoiceReadSpeakableText,
  splitVoiceReadChunks,
} from "./voiceReadTextChunks";

export type { VoiceReadSpeakChunk } from "./voiceReadVoiceResolve";

/** Edge 解码音频载荷：mp3/wav 数据 + 标点停顿点（音频内 ms） */
export type EdgeMp3Payload = {
  data: ArrayBuffer;
  pauses: VoiceReadPausePoint[];
};

const DASH_PCM_SAMPLE_RATE = 24000;
/** 已合成段保留在内存，跳转不重拉 */
const EDGE_MP3_CACHE_LIMIT = 64;
const DASH_PCM_CACHE_LIMIT = 48;
/** 解码后短于该时长视为无效，避免零时长段连排导致高亮连跳 */
const MIN_DECODED_CHUNK_DURATION_SEC = 0.05;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 行跳转 / 停止朗读时预期的合成中断，不应冒泡为 Uncaught */
function isVoiceReadPlaybackAbortError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg === "aborted" || msg === "interrupted";
}

/** Edge / IPC 解码音频：MP3 或 WAV 头 */
function isDecodedAudioPayloadValid(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 10) return false;
  const u8 = new Uint8Array(buf, 0, Math.min(buf.byteLength, 4));
  if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return true;
  if (u8[0] === 0xff && (u8[1]! & 0xe0) === 0xe0) return true;
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) {
    return true;
  }
  return false;
}

function isDecodeAudioDataEncodingError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "EncodingError") return true;
  if (err instanceof Error && /decode audio/i.test(err.message)) return true;
  return false;
}

function normalizeLineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function applyGainPlaybackVolume(
  gain: GainNode | null,
  volume: number,
): void {
  if (!gain) return;
  gain.gain.value = clampVoiceReadVolume(volume);
}

function chunkCacheKey(
  settings: VoiceReadSettings,
  chunkText: string,
  voiceId: string,
  emotion?: VoiceReadEmotionId,
  speechSlot?: VoiceReadSpeakChunk["speechSlot"],
  language?: string,
  dialect?: string,
): string {
  return voiceReadChunkCacheKey(
    settings,
    chunkText,
    voiceId,
    emotion,
    speechSlot,
    language,
    dialect,
  );
}

function chunkCacheKeyFor(
  settings: VoiceReadSettings,
  chunk: VoiceReadSpeakChunk,
): string {
  return chunkCacheKey(
    settings,
    chunk.text,
    chunk.voiceId,
    chunk.emotion,
    chunk.speechSlot,
    chunk.volcengineLanguage,
    chunk.volcengineDialect,
  );
}

function chunkSpeechMode(
  chunk: VoiceReadSpeakChunk,
): { language: string; dialect: string } | undefined {
  if (
    chunk.volcengineLanguage === undefined &&
    chunk.volcengineDialect === undefined
  ) {
    return undefined;
  }
  return {
    language: chunk.volcengineLanguage ?? "",
    dialect: chunk.volcengineDialect ?? "",
  };
}

function lineCacheKey(
  settings: VoiceReadSettings,
  text: string,
  voiceId?: string,
  emotion?: VoiceReadEmotionId,
  speechSlot?: VoiceReadSpeakChunk["speechSlot"],
): string {
  return chunkCacheKey(
    settings,
    text,
    voiceId ?? voiceReadSingleVoiceId(settings),
    emotion,
    speechSlot,
  );
}

function normalizeSpeakChunks(
  chunks: VoiceReadSpeakChunk[],
): VoiceReadSpeakChunk[] {
  return chunks
    .map((c) => ({
      text: normalizeLineText(c.text),
      voiceId: c.voiceId.trim() || "",
      emotion: c.emotion,
      speechSlot: c.speechSlot,
      volcengineLanguage: c.volcengineLanguage,
      volcengineDialect: c.volcengineDialect,
    }))
    .filter((c) => c.text.length > 0 && hasVoiceReadSpeakableText(c.text));
}

type PreparedDashLine = {
  pcm: Uint8Array;
  sampleRate: number;
};

export type VoiceReadPreviewDownload = {
  blob: Blob;
  filename: string;
};

function concatArrayBuffers(parts: ArrayBuffer[]): ArrayBuffer {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), off);
    off += p.byteLength;
  }
  return out.buffer;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function float32ToPcm16le(channel: Float32Array): Uint8Array {
  const out = new Uint8Array(channel.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < channel.length; i++) {
    const s = Math.max(-1, Math.min(1, channel[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

function pcm16leToWav(pcm: Uint8Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return buffer;
}

function voiceReadPreviewFilename(
  settings: VoiceReadSettings,
  ext: string,
): string {
  const voice = voiceReadSingleVoiceId(settings);
  const safe = voice.replace(/[^\w\u4e00-\u9fff.-]+/g, "_").slice(0, 48);
  return `彩读试听-${safe}.${ext}`;
}

export class VoiceReadLinePlayer {
  /** 每一段（句）开始播放时回调，便于 UI 与「上/下一句」对齐 chunk 索引 */
  onChunkChange?: (index: number, total: number) => void;
  /** 当前播放路径正在等待 TTS 合成（非 warmLine 预取） */
  onSynthesizingChange?: (active: boolean) => void;

  /**
   * 仅 Edge：当前行切段与会话设置（无活跃 Edge 会话时为 null）。
   * 供后续从 `chunks.slice(fromIndex)` 重播剩余段，对齐 session segments。
   */
  getEdgeSpeakContext(): {
    chunks: readonly VoiceReadSpeakChunk[];
    settings: VoiceReadSettings;
  } | null {
    if (!this.edgeChunks.length || !this.edgeSettings) return null;
    return { chunks: [...this.edgeChunks], settings: this.edgeSettings };
  }

  private static readonly EDGE_BUFFER_SIZE = 4;

  private stopped = false;
  private playbackSessionGen = 0;
  private activeDashSessionId = 0;
  private activeEdgeSessionId = 0;
  /** 与 edgeScheduledEnd / edgeHasAudioData 绑定的会话，避免多段排播串线 */
  private edgeTimelineSessionId = 0;
  private playbackSynthesisDepth = 0;

  private prefetchKey: string | null = null;
  private prefetchPromise: Promise<PreparedDashLine> | null = null;
  private prefetchDashAbort: AbortController | null = null;
  private readonly edgeMp3Cache = new Map<string, EdgeMp3Payload>();
  private readonly edgeMp3Inflight = new Map<string, Promise<EdgeMp3Payload>>();
  private readonly dashPcmCache = new Map<string, PreparedDashLine>();
  private readonly dashPcmInflight = new Map<
    string,
    Promise<PreparedDashLine>
  >();
  /** 作废后：在途合成完成时不再写回缓存 */
  private readonly edgeSkipCacheKeys = new Set<string>();
  private readonly dashSkipCacheKeys = new Set<string>();

  /** Edge 会话 */
  private edgeFetchBuffer = new Map<number, Promise<EdgeMp3Payload>>();
  private edgeFetchBufferLimit = VoiceReadLinePlayer.EDGE_BUFFER_SIZE;
  private edgeProducerIndex = 0;
  private edgeProducerWake: (() => void) | null = null;
  private edgeChunks: VoiceReadSpeakChunk[] = [];
  private edgeSettings: VoiceReadSettings | null = null;
  private edgeAudioCtx: AudioContext | null = null;
  private edgeGain: GainNode | null = null;
  private edgeScheduledEnd = 0;
  private edgeCheckTimer: ReturnType<typeof setInterval> | null = null;
  private edgeAllChunksDone = false;
  private edgeHasAudioData = false;
  private edgePlayingNotified = false;
  private edgeChunkStartTimers = new Set<ReturnType<typeof setTimeout>>();
  private edgePausedAt = 0;
  /** 按排程顺序依次触发 onChunkChange，防止多段同时 notify 高亮连跳 */
  private timelineScheduleOrdinal = 0;
  private timelineNotifyThroughOrdinal = -1;

  /** DashScope 会话 */
  private dashAudioCtx: AudioContext | null = null;
  private dashGain: GainNode | null = null;
  private dashScheduledEnd = 0;
  private dashAbort: AbortController | null = null;
  private dashCheckTimer: ReturnType<typeof setInterval> | null = null;
  private dashAllChunksDone = false;
  private dashHasAudioData = false;
  private dashChunkStartTimers = new Set<ReturnType<typeof setTimeout>>();
  private dashPausedAt = 0;
  private dashSessionSettings: VoiceReadSettings | null = null;
  /** 播放中临时音量（优先于 settings.volume） */
  private playbackVolumeOverride: number | null = null;

  private resolvePlaybackVolume(settings: VoiceReadSettings): number {
    return clampVoiceReadVolume(
      this.playbackVolumeOverride ?? settings.volume,
    );
  }

  isPaused(): boolean {
    if (this.edgeAudioCtx) return this.edgeAudioCtx.state === "suspended";
    if (this.dashAudioCtx) return this.dashAudioCtx.state === "suspended";
    if (typeof window !== "undefined" && window.speechSynthesis?.paused) {
      return true;
    }
    return false;
  }

  /** 播放中调节音量（不影响 TTS 合成缓存） */
  setPlaybackVolume(volume: number): void {
    const v = clampVoiceReadVolume(volume);
    this.playbackVolumeOverride = v;
    applyGainPlaybackVolume(this.edgeGain, v);
    applyGainPlaybackVolume(this.dashGain, v);
  }

  pause(): void {
    if (this.edgeAudioCtx?.state === "running") {
      void this.edgeAudioCtx.suspend();
      this.edgePausedAt = Date.now();
      for (const t of this.edgeChunkStartTimers) clearTimeout(t);
      this.edgeChunkStartTimers.clear();
    }
    if (this.dashAudioCtx?.state === "running") {
      this.dashPausedAt = Date.now();
      for (const t of this.dashChunkStartTimers) clearTimeout(t);
      this.dashChunkStartTimers.clear();
    }
    void this.dashAudioCtx?.suspend();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.pause();
    }
  }

  resume(): void {
    if (this.edgePausedAt > 0) {
      const pausedSec = (Date.now() - this.edgePausedAt) / 1000;
      this.edgeScheduledEnd += pausedSec;
      this.edgePausedAt = 0;
    }
    if (this.dashPausedAt > 0) {
      const pausedSec = (Date.now() - this.dashPausedAt) / 1000;
      this.dashScheduledEnd += pausedSec;
      this.dashPausedAt = 0;
    }
    void this.edgeAudioCtx?.resume();
    void this.dashAudioCtx?.resume();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.resume();
    }
  }

  private cloneEdgeMp3Payload(p: EdgeMp3Payload): EdgeMp3Payload {
    return {
      data: p.data.slice(0),
      pauses: clonePausePoints(p.pauses),
    };
  }

  private cloneDashPrepared(p: PreparedDashLine): PreparedDashLine {
    return {
      pcm: p.pcm.slice(),
      sampleRate: p.sampleRate,
    };
  }

  private touchEdgeMp3Cache(key: string, data: EdgeMp3Payload): void {
    if (this.edgeMp3Cache.has(key)) this.edgeMp3Cache.delete(key);
    this.edgeMp3Cache.set(key, data);
    while (this.edgeMp3Cache.size > EDGE_MP3_CACHE_LIMIT) {
      const oldest = this.edgeMp3Cache.keys().next().value;
      if (oldest === undefined) break;
      this.edgeMp3Cache.delete(oldest);
    }
  }

  private touchDashPcmCache(key: string, data: PreparedDashLine): void {
    if (this.dashPcmCache.has(key)) this.dashPcmCache.delete(key);
    this.dashPcmCache.set(key, data);
    while (this.dashPcmCache.size > DASH_PCM_CACHE_LIMIT) {
      const oldest = this.dashPcmCache.keys().next().value;
      if (oldest === undefined) break;
      this.dashPcmCache.delete(oldest);
    }
  }

  /** 取 Edge MP3（命中缓存则立即返回副本，不删缓存项） */
  private setPlaybackSynthesizing(active: boolean): void {
    const prev = this.playbackSynthesisDepth > 0;
    if (active) {
      this.playbackSynthesisDepth += 1;
    } else {
      this.playbackSynthesisDepth = Math.max(
        0,
        this.playbackSynthesisDepth - 1,
      );
    }
    const now = this.playbackSynthesisDepth > 0;
    if (prev !== now) this.onSynthesizingChange?.(now);
  }

  private resetPlaybackSynthesizing(): void {
    if (this.playbackSynthesisDepth <= 0) return;
    this.playbackSynthesisDepth = 0;
    this.onSynthesizingChange?.(false);
  }

  /** 每次中止或新开播放会话时递增，令旧会话的异步收尾不再改动 UI / AudioContext */
  private bumpPlaybackSession(): number {
    this.playbackSessionGen += 1;
    return this.playbackSessionGen;
  }

  private isPlaybackSessionCurrent(sessionId: number): boolean {
    return sessionId === this.playbackSessionGen;
  }

  private isEdgePlaybackCaughtUp(sessionId: number): boolean {
    if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return false;
    if (sessionId !== this.edgeTimelineSessionId) return true;
    if (!this.edgeHasAudioData || !this.edgeAudioCtx) return true;
    if (this.edgeAudioCtx.state === "suspended") return false;
    return this.edgeAudioCtx.currentTime >= this.edgeScheduledEnd - 0.05;
  }

  /** 浏览器可能在中途 suspend AudioContext；非用户暂停时尝试恢复，避免多段排播卡死 */
  private async ensureEdgeAudioRunning(): Promise<void> {
    const ctx = this.edgeAudioCtx;
    if (!ctx || ctx.state !== "suspended" || this.edgePausedAt > 0) return;
    try {
      await ctx.resume();
    } catch {
      // 无用户手势时 resume 可能失败，下一轮重试
    }
  }

  private async ensureDashAudioRunning(): Promise<void> {
    const ctx = this.dashAudioCtx;
    if (!ctx || ctx.state !== "suspended" || this.dashPausedAt > 0) return;
    try {
      await ctx.resume();
    } catch {
      // ignore
    }
  }

  private async awaitEdgePlaybackCaughtUp(sessionId: number): Promise<void> {
    for (;;) {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) {
        throw new Error("aborted");
      }
      await this.ensureEdgeAudioRunning();
      if (this.isEdgePlaybackCaughtUp(sessionId)) return;
      await sleepMs(20);
    }
  }

  private isDashPlaybackCaughtUp(): boolean {
    if (this.stopped) return false;
    if (!this.dashHasAudioData || !this.dashAudioCtx) return true;
    if (this.dashAudioCtx.state === "suspended") return false;
    return this.dashAudioCtx.currentTime >= this.dashScheduledEnd - 0.05;
  }

  /**
   * 仅在「时间线已播完排程、下一段仍未就绪」时亮合成 UI。
   * 边播边预合成、缓存命中、时间线仍有缓冲时不显示。
   */
  private async awaitWhenPlaybackBlocked<T>(
    sessionId: number,
    playbackCaughtUp: () => boolean,
    work: Promise<T>,
  ): Promise<T> {
    if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) {
      throw new Error("aborted");
    }

    let uiActive = false;
    const syncUi = () => {
      if (!this.isPlaybackSessionCurrent(sessionId)) return;
      const want =
        playbackCaughtUp() &&
        this.isPlaybackSessionCurrent(sessionId) &&
        !this.stopped;
      if (want && !uiActive) {
        uiActive = true;
        this.setPlaybackSynthesizing(true);
      } else if (!want && uiActive) {
        uiActive = false;
        this.setPlaybackSynthesizing(false);
      }
    };

    try {
      while (true) {
        if (!this.isPlaybackSessionCurrent(sessionId)) {
          throw new Error("aborted");
        }
        let raced:
          | { kind: "done"; v: T }
          | { kind: "tick" };
        try {
          raced = await Promise.race([
            work.then((v) => ({ kind: "done" as const, v })),
            sleepMs(80).then(() => ({ kind: "tick" as const })),
          ]);
        } catch (err) {
          if (
            !this.isPlaybackSessionCurrent(sessionId) ||
            this.stopped ||
            isVoiceReadPlaybackAbortError(err)
          ) {
            throw new Error("aborted");
          }
          throw err;
        }
        if (raced.kind === "done") return raced.v;
        if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) {
          if (uiActive) {
            uiActive = false;
            this.setPlaybackSynthesizing(false);
          }
          throw new Error("aborted");
        }
        syncUi();
      }
    } catch (err) {
      if (isVoiceReadPlaybackAbortError(err)) {
        throw new Error("aborted");
      }
      throw err;
    } finally {
      if (uiActive) {
        uiActive = false;
        this.setPlaybackSynthesizing(false);
      }
    }
  }

  private invalidateEdgeChunkCache(
    settings: VoiceReadSettings,
    chunk: VoiceReadSpeakChunk,
  ): void {
    const k = chunkCacheKeyFor(settings, chunk);
    this.edgeMp3Cache.delete(k);
    this.edgeMp3Inflight.delete(k);
  }

  /** 预取队列用：挂上 rejection 处理，避免 producer 先于 consumer await 时 Uncaught */
  private enqueueEdgeMp3Fetch(
    settings: VoiceReadSettings,
    chunk: VoiceReadSpeakChunk,
  ): Promise<EdgeMp3Payload> {
    const p = this.getEdgeMp3(settings, chunk);
    void p.catch(() => {});
    return p;
  }

  private async getEdgeMp3(
    settings: VoiceReadSettings,
    chunk: VoiceReadSpeakChunk,
  ): Promise<EdgeMp3Payload> {
    const text = chunk.text;
    const voiceId = chunk.voiceId;
    const emotion = chunk.emotion;
    const speechSlot = chunk.speechSlot;
    if (!hasVoiceReadSpeakableText(text)) {
      return Promise.reject(new Error("无可朗读内容"));
    }
    const k = chunkCacheKeyFor(settings, chunk);
    const cached = this.edgeMp3Cache.get(k);
    if (cached) {
      if (!isDecodedAudioPayloadValid(cached.data)) {
        this.edgeMp3Cache.delete(k);
      } else {
        this.touchEdgeMp3Cache(k, cached);
        return this.cloneEdgeMp3Payload(cached);
      }
    }
    const inflight = this.edgeMp3Inflight.get(k);
    if (inflight) return this.cloneEdgeMp3Payload(await inflight);

    const request = this.fetchIpcDecodedAudio(
      settings,
      text,
      voiceId,
      emotion,
      speechSlot,
      chunkSpeechMode(chunk),
    )
      .then((payload) => {
        if (!isDecodedAudioPayloadValid(payload.data)) {
          throw new Error("语音合成返回无效音频");
        }
        const copy = this.cloneEdgeMp3Payload(payload);
        if (!this.edgeSkipCacheKeys.delete(k)) {
          this.touchEdgeMp3Cache(k, copy);
        }
        return copy;
      })
      .finally(() => {
        this.edgeMp3Inflight.delete(k);
      });
    this.edgeMp3Inflight.set(k, request);
    return this.cloneEdgeMp3Payload(await request);
  }

  private async getDashChunkPrepared(
    settings: VoiceReadSettings,
    chunk: VoiceReadSpeakChunk,
    signal: AbortSignal,
  ): Promise<PreparedDashLine> {
    const text = chunk.text;
    const voiceId = chunk.voiceId;
    const emotion = chunk.emotion;
    const speechSlot = chunk.speechSlot;
    if (!hasVoiceReadSpeakableText(text)) {
      return Promise.reject(new Error("无可朗读内容"));
    }
    const k = chunkCacheKeyFor(settings, chunk);
    const cached = this.dashPcmCache.get(k);
    if (cached) {
      this.touchDashPcmCache(k, cached);
      return this.cloneDashPrepared(cached);
    }
    const inflight = this.dashPcmInflight.get(k);
    if (inflight) {
      try {
        return this.cloneDashPrepared(await inflight);
      } catch (err) {
        if (!isVoiceReadPlaybackAbortError(err)) throw err;
      }
    }

    const request = this.fetchIpcPcm(
      settings,
      text,
      voiceId,
      signal,
      emotion,
      speechSlot,
      chunkSpeechMode(chunk),
    )
      .then((pcm) => {
        const prep: PreparedDashLine = {
          pcm: pcm.pcm.slice(),
          sampleRate: pcm.sampleRate,
        };
        if (!this.dashSkipCacheKeys.delete(k)) {
          this.touchDashPcmCache(k, prep);
        }
        return prep;
      })
      .finally(() => {
        this.dashPcmInflight.delete(k);
      });
    void request.catch(() => {});
    this.dashPcmInflight.set(k, request);
    return this.cloneDashPrepared(await request);
  }

  /** 仅清 DashScope 行级预取指针；合成结果缓存保留 */
  private discardDashPrefetchOnly(): void {
    this.prefetchKey = null;
    this.prefetchPromise = null;
    this.prefetchDashAbort?.abort();
    this.prefetchDashAbort = null;
  }

  discardPrefetch(): void {
    this.discardDashPrefetchOnly();
  }

  /** 换文件 / 换音色参数时清空（stop 与行跳转不清空） */
  clearSynthesisCache(): void {
    this.edgeMp3Cache.clear();
    this.edgeMp3Inflight.clear();
    this.dashPcmCache.clear();
    this.dashPcmInflight.clear();
    this.edgeSkipCacheKeys.clear();
    this.dashSkipCacheKeys.clear();
    this.discardDashPrefetchOnly();
  }

  /**
   * 作废当前行各切段缓存（「重新生成」用当前 effective 设置强制重拉 TTS）。
   * 在途请求返回时不会写回缓存。
   */
  invalidateLineSynthesis(
    settings: VoiceReadSettings,
    text: string,
    speakChunks?: VoiceReadSpeakChunk[],
  ): void {
    if (settings.engine === "system") return;
    const use =
      speakChunks && speakChunks.length > 0
        ? normalizeSpeakChunks(speakChunks)
        : (() => {
            const t = normalizeLineText(text);
            if (!t) return [];
            const units = voiceReadChunkUnitsForEngine(settings.engine);
            const parts = splitVoiceReadChunks(t, units);
            const texts = parts.length > 0 ? parts : [t];
            return texts.map(
              (part): VoiceReadSpeakChunk => ({
                text: part,
                voiceId: voiceReadSingleVoiceId(settings),
                speechSlot: "single",
              }),
            );
          })();
    if (use.length === 0) return;

    for (const c of use) {
      const k = chunkCacheKeyFor(settings, c);
      this.edgeMp3Cache.delete(k);
      this.edgeMp3Inflight.delete(k);
      this.edgeSkipCacheKeys.add(k);
      this.dashPcmCache.delete(k);
      this.dashPcmInflight.delete(k);
      this.dashSkipCacheKeys.add(k);
    }

    if (use.length === 1) {
      const lineKey = lineCacheKey(
        settings,
        text,
        use[0]!.voiceId,
        use[0]!.emotion,
        use[0]!.speechSlot,
      );
      this.dashPcmCache.delete(lineKey);
      this.dashPcmInflight.delete(lineKey);
      this.dashSkipCacheKeys.add(lineKey);
      if (this.prefetchKey === lineKey) {
        this.discardDashPrefetchOnly();
      }
    } else {
      this.discardDashPrefetchOnly();
    }
  }

  /** 预生成 speak chunks（供上一行/下一行跳转前 warm） */
  warmSpeakChunks(
    settings: VoiceReadSettings,
    chunks: VoiceReadSpeakChunk[],
  ): void {
    if (settings.engine === "system") return;
    if (
      this.activeEdgeSessionId > 0 &&
      voiceReadRequiresSerialChunkFetch(settings)
    ) {
      return;
    }
    const use = normalizeSpeakChunks(chunks);
    if (use.length === 0) return;
    if (voiceReadPlaybackKind(settings.engine) === "pcm") {
      const c = use[0];
      if (!c) return;
      const k = chunkCacheKeyFor(settings, c);
      if (this.dashPcmCache.has(k) || this.dashPcmInflight.has(k)) return;
      const ac = new AbortController();
      void this.getDashChunkPrepared(settings, c, ac.signal).catch(() => {});
      return;
    }
    for (const c of use) {
      const k = chunkCacheKeyFor(settings, c);
      if (this.edgeMp3Cache.has(k) || this.edgeMp3Inflight.has(k)) continue;
      void this.getEdgeMp3(settings, c).catch(() => {});
    }
  }

  /** @deprecated 使用 warmSpeakChunks */
  warmLine(settings: VoiceReadSettings, text: string): void {
    const t = normalizeLineText(text);
    if (!t || !hasVoiceReadSpeakableText(t)) return;
    const units = voiceReadChunkUnitsForEngine(settings.engine);
    const parts = splitVoiceReadChunks(t, units);
    const texts = parts.length > 0 ? parts : [t];
    this.warmSpeakChunks(
      settings,
      texts.map((part) => ({
        text: part,
        voiceId: voiceReadSingleVoiceId(settings),
        speechSlot: "single",
      })),
    );
  }

  isLineSynthesisCached(
    settings: VoiceReadSettings,
    speakChunks: VoiceReadSpeakChunk[],
  ): boolean {
    if (settings.engine === "system") return true;
    const use = normalizeSpeakChunks(speakChunks);
    if (use.length === 0) return true;
    if (voiceReadPlaybackKind(settings.engine) === "pcm") {
      return use.every((c) =>
        this.dashPcmCache.has(chunkCacheKeyFor(settings, c)),
      );
    }
    return use.every((c) =>
      this.edgeMp3Cache.has(chunkCacheKeyFor(settings, c)),
    );
  }

  /** 预取下一行 speak chunks */
  startPrefetch(
    settings: VoiceReadSettings,
    chunks: VoiceReadSpeakChunk[],
  ): void {
    this.discardDashPrefetchOnly();
    this.warmSpeakChunks(settings, chunks);
    if (voiceReadPlaybackKind(settings.engine) !== "pcm") return;
    const use = normalizeSpeakChunks(chunks);
    if (use.length !== 1) return;
    const c = use[0]!;
    const key = chunkCacheKeyFor(settings, c);
    if (this.dashPcmCache.has(key) || this.dashPcmInflight.has(key)) return;
    this.prefetchDashAbort = new AbortController();
    this.prefetchKey = key;
    this.prefetchPromise = this.getDashChunkPrepared(
      settings,
      c,
      this.prefetchDashAbort.signal,
    );
    void this.prefetchPromise.catch(() => {});
  }

  stop(): void {
    this.stopped = true;
    this.discardPrefetch();
    this.abortActivePlayback();
  }

  /**
   * 暂停：中止当前 AudioContext，保留 Edge/Dash 合成缓存与进行中的预取。
   */
  pausePlayback(): void {
    this.stopped = true;
    this.resetPlaybackSynthesizing();
    this.discardDashPrefetchOnly();
    this.abortActivePlayback();
  }

  /**
   * 行内跳转时中止播放：保留 Edge 段缓存，仅取消 Dash 行级预取（`jumpToChunk` 前 stop）。
   */
  stopForLineJump(): void {
    this.stopped = true;
    this.discardDashPrefetchOnly();
    this.abortActivePlayback();
  }

  /**
   * 从指定段索引重播剩余段（`_sessionSegments.slice(index)` 后 `speak`）。
   */
  jumpToChunk(
    settings: VoiceReadSettings,
    chunks: VoiceReadSpeakChunk[],
    startIndex: number,
  ): Promise<void> {
    const parts = normalizeSpeakChunks(chunks);
    if (parts.length === 0 || startIndex < 0 || startIndex >= parts.length) {
      return Promise.resolve();
    }
    const remaining = parts.slice(startIndex);
    this.abortActivePlayback();
    this.stopped = false;
    this.discardDashPrefetchOnly();
    if (settings.engine === "system") {
      return this.speakSystemChunks(settings, remaining);
    }
    if (voiceReadPlaybackKind(settings.engine) === "decoded") {
      return this.speakEdgeChunks(settings, remaining);
    }
    return this.speakDashChunks(settings, remaining);
  }

  /**
   * 朗读已切好的多段（同一次会话）。后续「上一句 / 下一句」可只改 `chunks` 与起始索引重入。
   * 等待当前 Edge/Dash 时间线播完（连续朗读切批前调用，避免下一批过早 abort 造成听感重复）
   */
  async waitForPlaybackSettled(): Promise<void> {
    if (this.stopped) return;
    if (this.edgeAudioCtx && this.edgeHasAudioData) {
      await this.awaitEdgePlaybackDrain(this.activeEdgeSessionId);
      return;
    }
    if (this.dashAudioCtx && this.dashHasAudioData) {
      await this.awaitDashPlaybackDrain(this.activeDashSessionId);
    }
  }

  speakChunks(
    settings: VoiceReadSettings,
    chunks: VoiceReadSpeakChunk[],
  ): Promise<void> {
    const use = normalizeSpeakChunks(chunks);
    if (use.length === 0) return Promise.resolve();
    this.abortActivePlayback();
    this.stopped = false;
    if (settings.engine === "system") {
      return this.speakSystemChunks(settings, use);
    }
    if (voiceReadPlaybackKind(settings.engine) === "decoded") {
      return this.speakEdgeChunks(settings, use);
    }
    return this.speakDashChunks(settings, use);
  }

  speakLine(
    settings: VoiceReadSettings,
    text: string,
    speakChunks?: VoiceReadSpeakChunk[],
  ): Promise<void> {
    const t = normalizeLineText(text);
    if (!t || !hasVoiceReadSpeakableText(t)) return Promise.resolve();

    const built =
      speakChunks && speakChunks.length > 0
        ? normalizeSpeakChunks(speakChunks)
        : (() => {
            const units = voiceReadChunkUnitsForEngine(settings.engine);
            const parts = splitVoiceReadChunks(t, units);
            const texts = parts.length > 0 ? parts : [t];
            return texts.map(
              (part): VoiceReadSpeakChunk => ({
                text: part,
                voiceId: voiceReadSingleVoiceId(settings),
                speechSlot: "single",
              }),
            );
          })();

    const key =
      built.length === 1
        ? chunkCacheKeyFor(settings, built[0]!)
        : null;
    let dashPrepared: Promise<PreparedDashLine> | null = null;
    if (voiceReadPlaybackKind(settings.engine) === "pcm" && key) {
      if (this.prefetchKey === key && this.prefetchPromise) {
        dashPrepared = this.prefetchPromise;
        this.prefetchKey = null;
        this.prefetchPromise = null;
      }
    }
    this.discardDashPrefetchOnly();

    this.abortActivePlayback();
    this.stopped = false;
    const sessionId = this.bumpPlaybackSession();

    if (settings.engine === "system") {
      return this.speakSystemChunks(settings, built);
    }

    if (
      voiceReadPlaybackKind(settings.engine) === "pcm" &&
      dashPrepared &&
      built.length === 1
    ) {
      const playPrepared = async (p: PreparedDashLine) => {
        if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
        await this.playDashSingleBuffer(settings, p.pcm, p.sampleRate, sessionId);
      };
      const loadPrepared =
        key && this.dashPcmCache.has(key)
          ? dashPrepared
          : this.awaitWhenPlaybackBlocked(
              sessionId,
              () => this.isDashPlaybackCaughtUp(),
              dashPrepared,
            );
      return loadPrepared.then(playPrepared, () =>
        this.speakDashChunks(settings, built),
      );
    }

    if (voiceReadPlaybackKind(settings.engine) === "decoded") {
      return this.speakEdgeChunks(settings, built);
    }

    return this.speakDashChunks(settings, built);
  }

  private abortActivePlayback(): void {
    this.bumpPlaybackSession();
    this.activeEdgeSessionId = 0;
    this.activeDashSessionId = 0;
    this.edgeTimelineSessionId = 0;
    this.dashAbort?.abort();
    this.dashAbort = null;
    if (this.dashCheckTimer) {
      clearInterval(this.dashCheckTimer);
      this.dashCheckTimer = null;
    }
    for (const t of this.dashChunkStartTimers) clearTimeout(t);
    this.dashChunkStartTimers.clear();
    this.dashPausedAt = 0;
    if (this.dashAudioCtx) {
      void this.dashAudioCtx.close();
      this.dashAudioCtx = null;
    }
    this.dashGain = null;
    this.dashScheduledEnd = 0;

    if (this.edgeCheckTimer) {
      clearInterval(this.edgeCheckTimer);
      this.edgeCheckTimer = null;
    }
    for (const t of this.edgeChunkStartTimers) clearTimeout(t);
    this.edgeChunkStartTimers.clear();
    this.edgeFetchBuffer.clear();
    this.edgeProducerWake?.();
    this.edgeProducerWake = null;
    if (this.edgeAudioCtx) {
      void this.edgeAudioCtx.close();
      this.edgeAudioCtx = null;
    }
    this.edgeGain = null;
    this.edgeScheduledEnd = 0;
    this.edgeChunks = [];
    this.edgeSettings = null;
    this.dashSessionSettings = null;
    this.playbackVolumeOverride = null;

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.resetPlaybackSynthesizing();
  }

  private async fetchIpcDecodedAudio(
    settings: VoiceReadSettings,
    text: string,
    voiceId: string,
    emotion?: VoiceReadEmotionId,
    speechSlot?: VoiceReadSpeakChunk["speechSlot"],
    speechMode?: { language: string; dialect: string },
  ): Promise<EdgeMp3Payload> {
    const r = await synthesizeVoiceReadViaIpc(
      toVoiceReadSynthesisRequest(
        settings,
        text,
        voiceId,
        emotion,
        speechSlot,
        speechMode,
      ),
    );
    if (!r.ok) {
      throw new Error(r.error || "语音合成失败");
    }
    if (r.result.format !== "mp3" && r.result.format !== "wav") {
      throw new Error("语音合成返回了不支持的音频格式");
    }
    return { data: r.result.data, pauses: clonePausePoints(r.result.pauses) };
  }

  private async fetchIpcPcm(
    settings: VoiceReadSettings,
    text: string,
    voiceId: string,
    signal: AbortSignal,
    emotion?: VoiceReadEmotionId,
    speechSlot?: VoiceReadSpeakChunk["speechSlot"],
    speechMode?: { language: string; dialect: string },
  ): Promise<{ pcm: Uint8Array; sampleRate: number }> {
    if (signal.aborted) throw new Error("interrupted");
    const r = await synthesizeVoiceReadViaIpc(
      toVoiceReadSynthesisRequest(
        settings,
        text,
        voiceId,
        emotion,
        speechSlot,
        speechMode,
      ),
      signal,
    );
    if (signal.aborted) throw new Error("interrupted");
    if (!r.ok) {
      throw new Error(r.error || "语音合成失败");
    }
    if (r.result.format !== "pcm_s16le" || !r.result.sampleRate) {
      throw new Error("语音合成返回了不支持的 PCM 格式");
    }
    return {
      pcm: new Uint8Array(r.result.data),
      sampleRate: r.result.sampleRate,
    };
  }

  private async speakSystemChunks(
    settings: VoiceReadSettings,
    chunks: VoiceReadSpeakChunk[],
  ): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      if (this.stopped) return;
      this.onChunkChange?.(i, chunks.length);
      const c = chunks[i]!;
      await this.speakSystemOne(settings, c.text, c.voiceId);
    }
  }

  private speakSystemOne(
    settings: VoiceReadSettings,
    text: string,
    voiceId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        reject(new Error("当前环境不支持系统语音"));
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = settings.rate;
      u.pitch = settings.pitch;
      u.volume = this.resolvePlaybackVolume(settings);
      const vid = voiceId.trim() || voiceReadSingleVoiceId(settings);
      if (vid) {
        const v = window.speechSynthesis
          .getVoices()
          .find((x) => x.voiceURI === vid || x.name === vid);
        if (v) u.voice = v;
      }
      u.onend = () => {
        if (this.stopped) return;
        resolve();
      };
      u.onerror = (ev) => {
        if (this.stopped) return;
        if (ev.error === "canceled" || ev.error === "interrupted") {
          resolve();
          return;
        }
        reject(new Error(ev.error || "系统语音出错"));
      };
      window.speechSynthesis.speak(u);
    });
  }

  /** buffer 4 + producer + 时间线 decodeAndSchedule */
  private async speakEdgeChunks(
    settings: VoiceReadSettings,
    chunks: VoiceReadSpeakChunk[],
  ): Promise<void> {
    const sessionId = this.bumpPlaybackSession();
    this.activeEdgeSessionId = sessionId;
    this.edgeTimelineSessionId = sessionId;
    const BUFFER = voiceReadEdgeFetchBufferSize(settings);
    this.edgeFetchBufferLimit = BUFFER;
    this.edgeChunks = chunks;
    this.edgeSettings = settings;
    this.edgeAllChunksDone = false;
    this.edgeHasAudioData = false;
    this.edgePlayingNotified = false;
    this.edgePausedAt = 0;
    this.timelineScheduleOrdinal = 0;
    this.timelineNotifyThroughOrdinal = -1;
    this.edgeFetchBuffer.clear();
    this.edgeProducerIndex = 0;

    this.edgeAudioCtx = new AudioContext();
    this.edgeGain = this.edgeAudioCtx.createGain();
    this.edgeGain.connect(this.edgeAudioCtx.destination);
    applyGainPlaybackVolume(this.edgeGain, this.resolvePlaybackVolume(settings));
    this.edgeScheduledEnd = 0;

    if (this.edgeAudioCtx.state === "suspended") {
      await this.edgeAudioCtx.resume();
    }

    this.edgeCheckTimer = setInterval(() => {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
      if (this.edgeAudioCtx?.state === "suspended") return;
      if (this.edgeAllChunksDone && this.edgeAudioCtx) {
        if (!this.edgeHasAudioData) {
          this.cleanupEdgeSession(sessionId);
          return;
        }
        const ct = this.edgeAudioCtx.currentTime;
        if (ct >= this.edgeScheduledEnd - 0.05) {
          this.cleanupEdgeSession(sessionId);
        }
      }
    }, 200);

    const prewarm = Math.min(BUFFER, chunks.length);
    for (let p = 0; p < prewarm; p++) {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
      const ch = chunks[p]!;
      this.edgeFetchBuffer.set(p, this.enqueueEdgeMp3Fetch(settings, ch));
    }
    this.edgeProducerIndex = prewarm;
    void this.runEdgeProducer(sessionId, settings, chunks);

    let edgeChunkError: unknown = null;
    for (let i = 0; i < chunks.length; i++) {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) break;
      const settings = this.edgeSettings;
      const ch = chunks[i];
      if (!settings || !ch) break;
      if (i > 0 && this.edgeHasAudioData) {
        await this.awaitEdgePlaybackCaughtUp(sessionId);
      }
      try {
        await this.playEdgeChunkAtIndex(sessionId, i, chunks.length, settings, ch);
      } catch (e) {
        if (isVoiceReadPlaybackAbortError(e)) break;
        const msg = (e as Error)?.message ?? "";
        if (/无可朗读内容/.test(msg)) {
          this.edgeFetchBuffer.delete(i);
          this.edgeProducerWake?.();
          continue;
        }
        if (!edgeChunkError) edgeChunkError = e;
        throw e;
      }
      this.edgeFetchBuffer.delete(i);
      this.edgeProducerWake?.();
    }

    if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
    if (edgeChunkError && !this.edgeHasAudioData) {
      this.cleanupEdgeSession(sessionId);
      throw edgeChunkError instanceof Error
        ? edgeChunkError
        : new Error(String(edgeChunkError));
    }
    this.edgeAllChunksDone = true;
    // 必须等本行实际播完再 resolve，否则连续朗读时下一行 `speakLine` 会立刻 abort 掉本行 AudioContext（试听只有一行故不易发现）
    await this.awaitEdgePlaybackDrain(sessionId);
  }

  /** 等 Edge 时间线播放到 scheduledEnd（与 setInterval 清理条件一致） */
  private async awaitEdgePlaybackDrain(sessionId: number): Promise<void> {
    for (;;) {
      if (!this.isPlaybackSessionCurrent(sessionId)) return;
      if (!this.edgeAudioCtx) return;
      if (this.stopped) return;
      const ctx = this.edgeAudioCtx;
      if (ctx.state === "suspended") {
        await this.ensureEdgeAudioRunning();
        await sleepMs(50);
        continue;
      }
      if (this.edgeAllChunksDone && !this.edgeHasAudioData) {
        this.cleanupEdgeSession(sessionId);
        return;
      }
      if (
        this.edgeAllChunksDone &&
        this.edgeHasAudioData &&
        ctx.currentTime >= this.edgeScheduledEnd - 0.05
      ) {
        this.cleanupEdgeSession(sessionId);
        return;
      }
      await sleepMs(50);
    }
  }

  private async runEdgeProducer(
    sessionId: number,
    settings: VoiceReadSettings,
    chunks: VoiceReadSpeakChunk[],
  ): Promise<void> {
    const BUFFER = this.edgeFetchBufferLimit;
    while (this.edgeProducerIndex < chunks.length) {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
      while (this.edgeFetchBuffer.size >= BUFFER) {
        if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
        await new Promise<void>((resolve) => {
          this.edgeProducerWake = resolve;
        });
        this.edgeProducerWake = null;
      }
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
      const idx = this.edgeProducerIndex++;
      const ch = chunks[idx]!;
      this.edgeFetchBuffer.set(idx, this.enqueueEdgeMp3Fetch(settings, ch));
    }
  }

  private async waitEdgeChunk(
    sessionId: number,
    index: number,
  ): Promise<EdgeMp3Payload> {
    while (!this.edgeFetchBuffer.has(index)) {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) {
        throw new Error("aborted");
      }
      const ch = this.edgeChunks[index];
      const settings = this.edgeSettings;
      if (ch && settings) {
        this.edgeFetchBuffer.set(
          index,
          this.enqueueEdgeMp3Fetch(settings, ch),
        );
        this.edgeProducerWake?.();
      }
      await sleepMs(50);
    }
    const promise = this.edgeFetchBuffer.get(index)!;
    return this.awaitWhenPlaybackBlocked(
      sessionId,
      () => this.isEdgePlaybackCaughtUp(sessionId),
      promise,
    );
  }

  /** 拉取并解码单段；合成/解码失败时作废缓存并重试（含主进程自动重试后仍失败） */
  private async playEdgeChunkAtIndex(
    sessionId: number,
    index: number,
    total: number,
    settings: VoiceReadSettings,
    chunk: VoiceReadSpeakChunk,
  ): Promise<void> {
    if (!hasVoiceReadSpeakableText(chunk.text)) return;

    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) {
        throw new Error("aborted");
      }
      if (attempt > 0) {
        this.invalidateEdgeChunkCache(settings, chunk);
        await sleepMs(200 * attempt);
        if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) {
          throw new Error("aborted");
        }
      }

      let payload: EdgeMp3Payload;
      try {
        payload =
          attempt === 0
            ? await this.waitEdgeChunk(sessionId, index)
            : await this.getEdgeMp3(settings, chunk);
      } catch (e) {
        if (isVoiceReadPlaybackAbortError(e)) throw e;
        if (/无可朗读内容/.test((e as Error)?.message ?? "")) return;
        if (attempt < maxAttempts - 1) continue;
        throw e;
      }

      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) {
        throw new Error("aborted");
      }
      if (!isDecodedAudioPayloadValid(payload.data)) {
        this.invalidateEdgeChunkCache(settings, chunk);
        if (attempt < maxAttempts - 1) continue;
        throw new Error("Edge TTS 返回无效音频");
      }

      try {
        await this.edgeDecodeAndSchedule(
          sessionId,
          payload,
          settings,
          index,
          total,
        );
        return;
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        const retryable =
          isDecodeAudioDataEncodingError(e) || /音频过短/.test(msg);
        if (retryable && attempt < maxAttempts - 1) {
          this.invalidateEdgeChunkCache(settings, chunk);
          continue;
        }
        throw e;
      }
    }
  }

  private async edgeDecodeAndSchedule(
    sessionId: number,
    payload: EdgeMp3Payload,
    settings: VoiceReadSettings,
    index: number,
    total: number,
  ): Promise<void> {
    if (
      !this.isPlaybackSessionCurrent(sessionId) ||
      sessionId !== this.edgeTimelineSessionId ||
      !this.edgeAudioCtx ||
      !this.edgeGain ||
      this.stopped
    ) {
      throw new Error("aborted");
    }
    if (!isDecodedAudioPayloadValid(payload.data)) {
      throw new Error("语音合成音频无效");
    }

    let audioBuffer = await this.edgeAudioCtx.decodeAudioData(
      payload.data.slice(0),
    );
    if (
      !this.isPlaybackSessionCurrent(sessionId) ||
      sessionId !== this.edgeTimelineSessionId ||
      !this.edgeAudioCtx ||
      !this.edgeGain ||
      this.stopped
    ) {
      throw new Error("aborted");
    }
    if (audioBuffer.duration < MIN_DECODED_CHUNK_DURATION_SEC) {
      throw new Error("语音合成音频过短");
    }
    const ctx = this.edgeAudioCtx;
    const gain = this.edgeGain;
    if (!ctx || !gain) throw new Error("aborted");
    audioBuffer = this.applyPunctuationPauses(
      ctx,
      audioBuffer,
      payload.pauses,
      settings,
    );

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(gain);

    const startAt = Math.max(ctx.currentTime, this.edgeScheduledEnd);
    if (!this.isPlaybackSessionCurrent(sessionId)) {
      throw new Error("aborted");
    }
    src.start(startAt);
    const scheduleOrdinal = this.timelineScheduleOrdinal++;
    await this.scheduleEdgeChunkNotify(
      sessionId,
      index,
      total,
      startAt,
      ctx,
      scheduleOrdinal,
    );
    if (sessionId !== this.edgeTimelineSessionId) {
      throw new Error("aborted");
    }
    this.edgeScheduledEnd = startAt + audioBuffer.duration;
    this.edgeHasAudioData = true;

    if (!this.edgePlayingNotified) {
      this.edgePlayingNotified = true;
    }
  }

  /**
   * 按标点停顿点处理解码后的 PCM：把 [fromMs, toMs] 自然间隙替换为
   * kind 对应时长的干净静音（按时速缩放；0 表示不插）。
   */
  private applyPunctuationPauses(
    ctx: AudioContext,
    buffer: AudioBuffer,
    pauses: VoiceReadPausePoint[],
    settings: VoiceReadSettings,
  ): AudioBuffer {
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }
    const out = applyPunctuationPausesToPcm(
      channels,
      buffer.sampleRate,
      pauses,
      {
        pauseSentenceMs: settings.pauseSentenceMs,
        pauseCommaMs: settings.pauseCommaMs,
        rate: settings.rate,
      },
    );
    if (out.length === channels.length && out[0] === channels[0]) {
      return buffer;
    }
    const newBuf = ctx.createBuffer(
      out.length,
      Math.max(1, out[0]?.length ?? 1),
      buffer.sampleRate,
    );
    for (let c = 0; c < out.length; c++) {
      newBuf.getChannelData(c).set(out[c]!);
    }
    return newBuf;
  }

  private cleanupEdgeSession(forSessionId: number): void {
    if (forSessionId !== this.activeEdgeSessionId) return;
    if (forSessionId === this.edgeTimelineSessionId) {
      this.edgeTimelineSessionId = 0;
    }
    if (this.edgeCheckTimer) {
      clearInterval(this.edgeCheckTimer);
      this.edgeCheckTimer = null;
    }
    for (const t of this.edgeChunkStartTimers) clearTimeout(t);
    this.edgeChunkStartTimers.clear();
    if (this.edgeAudioCtx) {
      void this.edgeAudioCtx.close();
      this.edgeAudioCtx = null;
    }
    this.edgeGain = null;
    this.edgeScheduledEnd = 0;
    this.timelineScheduleOrdinal = 0;
    this.timelineNotifyThroughOrdinal = -1;
    this.edgeFetchBuffer.clear();
    this.edgeProducerWake?.();
    this.edgeProducerWake = null;
    this.edgeChunks = [];
    this.edgeSettings = null;
  }

  /** DashScope：流式 + scheduleFlush 排时间线 */
  private async speakDashChunks(
    settings: VoiceReadSettings,
    chunks: VoiceReadSpeakChunk[],
  ): Promise<void> {
    const sessionId = this.bumpPlaybackSession();
    this.activeDashSessionId = sessionId;
    this.dashSessionSettings = settings;
    this.dashAbort = new AbortController();
    const sessionSignal = this.dashAbort.signal;
    this.dashAllChunksDone = false;
    this.dashHasAudioData = false;
    this.timelineScheduleOrdinal = 0;
    this.timelineNotifyThroughOrdinal = -1;

    this.dashAudioCtx = new AudioContext();
    this.dashGain = this.dashAudioCtx.createGain();
    this.dashGain.connect(this.dashAudioCtx.destination);
    applyGainPlaybackVolume(this.dashGain, this.resolvePlaybackVolume(settings));
    this.dashScheduledEnd = 0;

    if (this.dashAudioCtx.state === "suspended") {
      await this.dashAudioCtx.resume();
    }

    this.dashCheckTimer = setInterval(() => {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
      if (this.dashAudioCtx?.state === "suspended") return;
      if (this.dashAllChunksDone && this.dashAudioCtx) {
        if (!this.dashHasAudioData) {
          this.cleanupDashSession(sessionId);
          return;
        }
        const ct = this.dashAudioCtx.currentTime;
        if (ct >= this.dashScheduledEnd - 0.05) {
          this.cleanupDashSession(sessionId);
        }
      }
    }, 200);

    for (let i = 0; i < chunks.length; i++) {
      if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) break;
      try {
        await this.dashStreamChunk(
          sessionId,
          settings,
          chunks[i]!,
          i,
          chunks.length,
          sessionSignal,
        );
      } catch (e) {
        if (
          isVoiceReadPlaybackAbortError(e) ||
          !this.isPlaybackSessionCurrent(sessionId) ||
          this.stopped
        ) {
          break;
        }
        throw e;
      }
    }

    if (!this.isPlaybackSessionCurrent(sessionId) || this.stopped) return;
    this.dashAllChunksDone = true;
    await this.awaitDashPlaybackDrain(sessionId);
  }

  /** 等 Dash 排播时间线播放到 scheduledEnd */
  private async awaitDashPlaybackDrain(sessionId: number): Promise<void> {
    for (;;) {
      if (!this.isPlaybackSessionCurrent(sessionId)) return;
      if (!this.dashAudioCtx) return;
      if (this.stopped) return;
      const ctx = this.dashAudioCtx;
      if (ctx.state === "suspended") {
        await this.ensureDashAudioRunning();
        await sleepMs(50);
        continue;
      }
      if (this.dashAllChunksDone && !this.dashHasAudioData) {
        this.cleanupDashSession(sessionId);
        return;
      }
      if (
        this.dashAllChunksDone &&
        this.dashHasAudioData &&
        ctx.currentTime >= this.dashScheduledEnd - 0.05
      ) {
        this.cleanupDashSession(sessionId);
        return;
      }
      await sleepMs(50);
    }
  }

  private async dashStreamChunk(
    sessionId: number,
    settings: VoiceReadSettings,
    chunk: VoiceReadSpeakChunk,
    index: number,
    total: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      !this.isPlaybackSessionCurrent(sessionId) ||
      this.stopped ||
      signal.aborted
    ) {
      return;
    }
    try {
      const fetchPrepared = this.getDashChunkPrepared(
        settings,
        chunk,
        signal,
      );
      const prepared = this.dashPcmCache.has(
        chunkCacheKeyFor(settings, chunk),
      )
        ? await fetchPrepared
        : await this.awaitWhenPlaybackBlocked(
            sessionId,
            () => this.isDashPlaybackCaughtUp(),
            fetchPrepared,
          );
      if (
        !this.isPlaybackSessionCurrent(sessionId) ||
        this.stopped ||
        signal.aborted
      ) {
        return;
      }
      this.scheduleDashChunkPlayback(
        sessionId,
        prepared.pcm,
        prepared.sampleRate,
        index,
        total,
      );
    } catch (e) {
      if (
        !this.isPlaybackSessionCurrent(sessionId) ||
        this.stopped ||
        signal.aborted ||
        isVoiceReadPlaybackAbortError(e)
      ) {
        return;
      }
      throw e;
    }
  }

  /** 按 AudioContext 时间线在 startAt 触发 onChunkChange（不用墙钟 setTimeout，避免 suspend 时高亮抢跑） */
  private scheduleEdgeChunkNotify(
    sessionId: number,
    index: number,
    total: number,
    startAt: number,
    ctx: AudioContext,
    scheduleOrdinal: number,
  ): Promise<void> {
    return this.runTimelineChunkNotify(
      sessionId,
      index,
      total,
      startAt,
      ctx,
      () => this.ensureEdgeAudioRunning(),
      scheduleOrdinal,
    );
  }

  /** 与 Edge 一致：在排播时间线 startAt 触发 onChunkChange，而非合成开始时 */
  private scheduleDashChunkNotify(
    sessionId: number,
    index: number,
    total: number,
    startAt: number,
    ctx: AudioContext,
    scheduleOrdinal: number,
  ): void {
    void this.runTimelineChunkNotify(
      sessionId,
      index,
      total,
      startAt,
      ctx,
      () => this.ensureDashAudioRunning(),
      scheduleOrdinal,
    );
  }

  private async runTimelineChunkNotify(
    sessionId: number,
    index: number,
    total: number,
    startAt: number,
    ctx: AudioContext,
    ensureRunning: () => Promise<void>,
    scheduleOrdinal: number,
  ): Promise<void> {
    for (;;) {
      if (this.stopped || !this.isPlaybackSessionCurrent(sessionId)) return;
      if (ctx.state === "closed") return;
      while (scheduleOrdinal > this.timelineNotifyThroughOrdinal + 1) {
        if (this.stopped || !this.isPlaybackSessionCurrent(sessionId)) return;
        await sleepMs(20);
      }
      await ensureRunning();
      if (ctx.currentTime >= startAt - 0.02) {
        if (this.stopped || !this.isPlaybackSessionCurrent(sessionId)) return;
        this.onChunkChange?.(index, total);
        this.timelineNotifyThroughOrdinal = scheduleOrdinal;
        return;
      }
      await sleepMs(20);
    }
  }

  private scheduleDashChunkPlayback(
    sessionId: number,
    pcm: Uint8Array,
    sampleRate: number,
    index: number,
    total: number,
  ): void {
    if (
      !this.isPlaybackSessionCurrent(sessionId) ||
      !this.dashAudioCtx ||
      !this.dashGain ||
      this.stopped
    ) {
      return;
    }

    const numSamples = Math.floor(pcm.length / 2);
    if (numSamples === 0) return;

    const ctx = this.dashAudioCtx;
    const gain = this.dashGain;
    const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < numSamples; i++) {
      channelData[i] = view.getInt16(i * 2, true) / 32768;
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    const s = this.dashSessionSettings;
    src.playbackRate.value = voiceReadPcmClientPlaybackRate(
      s?.engine ?? "dashscope",
      s?.rate ?? 1,
    );
    src.connect(gain);

    const startAt = Math.max(ctx.currentTime, this.dashScheduledEnd);
    const scheduleOrdinal = this.timelineScheduleOrdinal++;
    if (!this.isPlaybackSessionCurrent(sessionId)) return;
    src.start(startAt);
    this.scheduleDashChunkNotify(
      sessionId,
      index,
      total,
      startAt,
      ctx,
      scheduleOrdinal,
    );
    this.dashScheduledEnd =
      startAt + audioBuffer.duration / src.playbackRate.value;
    this.dashHasAudioData = true;
  }

  private cleanupDashSession(forSessionId: number): void {
    if (forSessionId !== this.activeDashSessionId) return;
    if (this.dashCheckTimer) {
      clearInterval(this.dashCheckTimer);
      this.dashCheckTimer = null;
    }
    for (const t of this.dashChunkStartTimers) clearTimeout(t);
    this.dashChunkStartTimers.clear();
    this.dashPausedAt = 0;
    if (this.dashAudioCtx) {
      void this.dashAudioCtx.close();
      this.dashAudioCtx = null;
    }
    this.dashGain = null;
    this.dashScheduledEnd = 0;
    this.dashSessionSettings = null;
  }

  /** 预取命中：整行 PCM 一次排进时间线（无切段 SSE） */
  private async playDashSingleBuffer(
    settings: VoiceReadSettings,
    pcm: Uint8Array,
    sampleRate: number,
    sessionId: number,
  ): Promise<void> {
    if (this.stopped || !this.isPlaybackSessionCurrent(sessionId)) return;
    this.dashAudioCtx = new AudioContext();
    this.dashGain = this.dashAudioCtx.createGain();
    this.dashGain.connect(this.dashAudioCtx.destination);
    applyGainPlaybackVolume(this.dashGain, this.resolvePlaybackVolume(settings));
    this.dashScheduledEnd = 0;

    if (this.dashAudioCtx.state === "suspended") {
      await this.dashAudioCtx.resume();
    }

    const numSamples = Math.floor(pcm.length / 2);
    if (numSamples === 0) throw new Error("语音合成返回的音频数据无效");

    const ctx = this.dashAudioCtx;
    const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < numSamples; i++) {
      channelData[i] = view.getInt16(i * 2, true) / 32768;
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.playbackRate.value = voiceReadPcmClientPlaybackRate(
      settings.engine,
      settings.rate,
    );
    src.connect(this.dashGain!);

    await new Promise<void>((resolve, reject) => {
      src.onended = () => {
        if (
          !this.stopped &&
          this.isPlaybackSessionCurrent(sessionId)
        ) {
          resolve();
        }
      };
      try {
        const startAt = Math.max(ctx.currentTime, this.dashScheduledEnd);
        const scheduleOrdinal = this.timelineScheduleOrdinal++;
        if (!this.isPlaybackSessionCurrent(sessionId)) {
          resolve();
          return;
        }
        src.start(startAt);
        this.scheduleDashChunkNotify(
          sessionId,
          0,
          1,
          startAt,
          ctx,
          scheduleOrdinal,
        );
        this.dashScheduledEnd =
          startAt + audioBuffer.duration / src.playbackRate.value;
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

    if (this.dashAudioCtx) {
      void this.dashAudioCtx.close();
      this.dashAudioCtx = null;
    }
    this.dashGain = null;
  }

  /**
   * 从试听合成缓存拼出可下载文件（解码类：MP3/WAV；PCM 类：WAV；系统语音不支持）。
   */
  async buildLineDownloadable(
    settings: VoiceReadSettings,
    text: string,
    speakChunks?: VoiceReadSpeakChunk[],
  ): Promise<VoiceReadPreviewDownload | null> {
    const t = normalizeLineText(text);
    if (!t || settings.engine === "system") return null;

    const built =
      speakChunks && speakChunks.length > 0
        ? normalizeSpeakChunks(speakChunks)
        : (() => {
            const units = voiceReadChunkUnitsForEngine(settings.engine);
            const parts = splitVoiceReadChunks(t, units);
            const texts = parts.length > 0 ? parts : [t];
            return texts.map(
              (part): VoiceReadSpeakChunk => ({
                text: part,
                voiceId: voiceReadSingleVoiceId(settings),
                speechSlot: "single",
              }),
            );
          })();

    if (voiceReadPlaybackKind(settings.engine) === "decoded") {
      const payloads: EdgeMp3Payload[] = [];
      for (const c of built) {
        const payload = await this.getEdgeMp3(settings, c);
        if (!payload.data.byteLength) return null;
        payloads.push(payload);
      }
      const applyPauses =
        (settings.pauseSentenceMs > 0 || settings.pauseCommaMs > 0) &&
        payloads.some((p) => p.pauses.length > 0);
      if (!applyPauses) {
        const parts = payloads.map((p) => p.data);
        const ext =
          built.length === 1 &&
          isDecodedAudioPayloadValid(parts[0]!) &&
          new Uint8Array(parts[0]!, 0, 4)[0] === 0x52
            ? "wav"
            : "mp3";
        return {
          blob: new Blob([concatArrayBuffers(parts)], {
            type: ext === "wav" ? "audio/wav" : "audio/mpeg",
          }),
          filename: voiceReadPreviewFilename(settings, ext),
        };
      }

      const reuse =
        this.edgeAudioCtx && this.edgeAudioCtx.state !== "closed"
          ? this.edgeAudioCtx
          : null;
      const ctx = reuse ?? new AudioContext();
      try {
        const pcmParts: Float32Array[] = [];
        let sampleRate = 24000;
        for (const payload of payloads) {
          let buf = await ctx.decodeAudioData(payload.data.slice(0));
          buf = this.applyPunctuationPauses(
            ctx,
            buf,
            payload.pauses,
            settings,
          );
          pcmParts.push(buf.getChannelData(0).slice());
          sampleRate = buf.sampleRate;
        }
        const pcm = float32ToPcm16le(concatFloat32(pcmParts));
        if (!pcm.length) return null;
        return {
          blob: new Blob([pcm16leToWav(pcm, sampleRate)], {
            type: "audio/wav",
          }),
          filename: voiceReadPreviewFilename(settings, "wav"),
        };
      } finally {
        if (!reuse) void ctx.close();
      }
    }

    const signal = new AbortController().signal;
    const pcmParts: Uint8Array[] = [];
    let sampleRate = DASH_PCM_SAMPLE_RATE;
    for (const c of built) {
      const prep = await this.getDashChunkPrepared(settings, c, signal);
      pcmParts.push(prep.pcm);
      sampleRate = prep.sampleRate;
    }
    const pcm = concatUint8Arrays(pcmParts);
    if (!pcm.length) return null;
    return {
      blob: new Blob([pcm16leToWav(pcm, sampleRate)], { type: "audio/wav" }),
      filename: voiceReadPreviewFilename(settings, "wav"),
    };
  }
}
