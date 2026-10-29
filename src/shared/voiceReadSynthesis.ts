import type { VoiceReadEngineConfig } from "./voiceReadEngineConfig";
import type { VoiceReadEngineId } from "./voiceReadEngines";

export type VoiceReadAudioFormat = "mp3" | "wav" | "pcm_s16le";

/**
 * 标点停顿点：音频内 [fromMs, toMs] 区间为自然间隙（含 TTS 气息声），
 * 播放端应将其替换为 kind 对应时长的干净静音；fromMs === toMs 表示在 fromMs 处插入。
 * toMs 超过音频总长时按总长处理（段尾停顿）。
 */
export type VoiceReadPausePoint = {
  fromMs: number;
  toMs: number;
  kind: "sentence" | "comma";
};

export type VoiceReadSynthesisResult = {
  format: VoiceReadAudioFormat;
  data: ArrayBuffer;
  sampleRate?: number;
  /** 标点停顿点（当前仅 Edge 引擎返回），播放端解码后在对应时刻插入静音 */
  pauses?: VoiceReadPausePoint[];
};

import type { VoiceReadEmotionId } from "./voiceReadEmotion";
import type { VolcengineSpeechSlot } from "./voiceReadVolcengineAudio";

export type VoiceReadSynthesisRequest = {
  engine: VoiceReadEngineId;
  text: string;
  voiceId: string;
  rate: number;
  pitch: number;
  engineConfig: VoiceReadEngineConfig;
  /** 朗读情绪；auto 或未设置时不传给引擎 */
  emotion?: VoiceReadEmotionId;
  /** 火山引擎按槽位读取语种/方言 */
  volcengineSpeechSlot?: VolcengineSpeechSlot;
  /** 角色专属音色等：覆盖槽位上的语种 */
  volcengineLanguage?: string;
  /** 角色专属音色等：覆盖槽位上的方言 */
  volcengineDialect?: string;
};

export type VoiceReadVoiceOption = {
  id: string;
  label: string;
  locale?: string;
  /** MiniMax 等引擎由客户端推断的性别 */
  gender?: "male" | "female";
  /** 音色说明（如 MiniMax system_voice 的 description） */
  description?: string;
};

export type VoiceReadHealthCheckResult = {
  ok: boolean;
  message?: string;
};

export type VoiceReadListVoicesRequest = {
  engine: VoiceReadEngineId;
  engineConfig: VoiceReadEngineConfig;
};

export type VoiceReadHealthCheckRequest = {
  engine: VoiceReadEngineId;
  engineConfig: VoiceReadEngineConfig;
};
