/** IPC 结构化克隆用：剥离 Vue 响应式代理，保证可序列化 */

import { mergeVoiceReadEngineConfig } from "./voiceReadEngineConfig";
import { normalizeVoiceReadEmotion } from "./voiceReadEmotion";
import { clonePausePoints } from "./voiceReadPunctuationPauses";
import type { VoiceReadEngineId } from "./voiceReadEngines";
import type {
  VoiceReadHealthCheckRequest,
  VoiceReadListVoicesRequest,
  VoiceReadSynthesisRequest,
  VoiceReadSynthesisResult,
} from "./voiceReadSynthesis";
import {
  normalizeVolcengineExplicitDialect,
  normalizeVolcengineExplicitLanguage,
  parseVolcengineSpeechSlot,
} from "./voiceReadVolcengineAudio";

export function toPlainVoiceReadEngineConfig(
  raw: unknown,
  legacyDashscopeApiKey?: string,
) {
  return mergeVoiceReadEngineConfig(raw, legacyDashscopeApiKey);
}

export function toPlainVoiceReadSynthesisRequest(
  req: VoiceReadSynthesisRequest,
): VoiceReadSynthesisRequest {
  return {
    engine: req.engine,
    text: req.text,
    voiceId: req.voiceId,
    rate: req.rate,
    pitch: req.pitch,
    emotion: req.emotion
      ? normalizeVoiceReadEmotion(req.emotion)
      : undefined,
    volcengineSpeechSlot: parseVolcengineSpeechSlot(req.volcengineSpeechSlot),
    volcengineLanguage:
      req.volcengineLanguage === undefined
        ? undefined
        : normalizeVolcengineExplicitLanguage(req.volcengineLanguage),
    volcengineDialect:
      req.volcengineDialect === undefined
        ? undefined
        : normalizeVolcengineExplicitDialect(req.volcengineDialect),
    engineConfig: toPlainVoiceReadEngineConfig(req.engineConfig),
  };
}

export function toPlainVoiceReadEnginePayload(
  engine: VoiceReadEngineId,
  engineConfig: unknown,
): VoiceReadListVoicesRequest {
  return {
    engine,
    engineConfig: toPlainVoiceReadEngineConfig(engineConfig),
  };
}

export function toPlainVoiceReadHealthCheckPayload(
  engine: VoiceReadEngineId,
  engineConfig: unknown,
): VoiceReadHealthCheckRequest {
  return toPlainVoiceReadEnginePayload(engine, engineConfig);
}

/** 主进程返回前：避免 Node Buffer 视图导致 IPC 克隆失败 */
export function arrayBufferForIpc(data: ArrayBuffer): ArrayBuffer {
  return data.slice(0);
}

export function normalizeSynthesisResultForIpc(
  result: VoiceReadSynthesisResult,
): VoiceReadSynthesisResult {
  return {
    format: result.format,
    sampleRate: result.sampleRate,
    data: arrayBufferForIpc(result.data),
    pauses: result.pauses ? clonePausePoints(result.pauses) : undefined,
  };
}
