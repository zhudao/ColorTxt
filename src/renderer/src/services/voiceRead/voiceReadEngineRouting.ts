import {
  isMimoTtsVoiceCloneModel,
  normalizeMimoTtsModel,
} from "@shared/voiceReadMimoModels";
import {
  getVoiceReadEngineMeta,
  voiceReadEngineBakesSpeechRate,
  voiceReadEngineUsesPcmPlayback,
  type VoiceReadEngineId,
} from "@shared/voiceReadEngines";
import type { VoiceReadSettings } from "../../constants/voiceRead";
import {
  VOICE_READ_CHUNK_UNITS_DEFAULT,
  VOICE_READ_CHUNK_UNITS_EDGE,
} from "./voiceReadTextChunks";

export type VoiceReadPlaybackKind = "system" | "pcm" | "decoded";

export function voiceReadPlaybackKind(
  engine: VoiceReadEngineId,
): VoiceReadPlaybackKind {
  if (engine === "system") return "system";
  if (voiceReadEngineUsesPcmPlayback(engine)) return "pcm";
  return "decoded";
}

export function voiceReadChunkUnitsForEngine(engine: VoiceReadEngineId): number {
  return getVoiceReadEngineMeta(engine).shortChunks
    ? VOICE_READ_CHUNK_UNITS_EDGE
    : VOICE_READ_CHUNK_UNITS_DEFAULT;
}

/** MiMo 声音复刻每段都上传参考音，并行预取易导致 API/排播乱序 */
export function voiceReadRequiresSerialChunkFetch(
  settings: VoiceReadSettings,
): boolean {
  // Windows SAPI COM / PowerShell 桥不宜并行多段合成
  if (settings.engine === "winSapi") return true;
  if (settings.engine !== "mimo") return false;
  return isMimoTtsVoiceCloneModel(
    normalizeMimoTtsModel(settings.engineConfig.mimoModel),
  );
}

export function voiceReadEdgeFetchBufferSize(settings: VoiceReadSettings): number {
  return voiceReadRequiresSerialChunkFetch(settings) ? 1 : 4;
}

/** PCM 引擎客户端播放速率：火山已在合成时写入 speech_rate，此处固定 1 */
export function voiceReadPcmClientPlaybackRate(
  engine: VoiceReadEngineId,
  rate: number,
): number {
  if (voiceReadEngineBakesSpeechRate(engine)) return 1;
  const n = Number.isFinite(rate) ? rate : 1;
  return Math.max(0.5, Math.min(2, n));
}
