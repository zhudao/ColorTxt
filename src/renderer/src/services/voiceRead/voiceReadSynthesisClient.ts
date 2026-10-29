import type { VoiceReadEmotionId } from "@shared/voiceReadEmotion";
import type { VoiceReadSettings } from "../../constants/voiceRead";
import type { VoiceReadSynthesisRequest } from "@shared/voiceReadSynthesis";
import type { VoiceReadSynthesizeIpcResult } from "@shared/voiceReadSynthesisIpc";
import {
  VOICE_READ_IPC_HEALTH_CHECK,
  VOICE_READ_IPC_LIST_VOICES,
  VOICE_READ_IPC_SYNTHESIZE,
} from "@shared/voiceReadSynthesisIpc";
import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import type { VoiceReadEngineId } from "@shared/voiceReadEngines";
import type { VolcengineSpeechSlot } from "@shared/voiceReadVolcengineAudio";
import {
  toPlainVoiceReadEngineConfig,
  toPlainVoiceReadHealthCheckPayload,
  toPlainVoiceReadSynthesisRequest,
} from "@shared/voiceReadIpcSerialize";

let synthesisRequestSequence = 0;

function nextSynthesisRequestId(): string {
  synthesisRequestSequence =
    synthesisRequestSequence >= Number.MAX_SAFE_INTEGER
      ? 1
      : synthesisRequestSequence + 1;
  return `${Date.now().toString(36)}-${synthesisRequestSequence.toString(36)}`;
}

export function toVoiceReadSynthesisRequest(
  settings: VoiceReadSettings,
  text: string,
  voiceId: string,
  emotion?: VoiceReadEmotionId,
  speechSlot?: VolcengineSpeechSlot,
  speechMode?: { language?: string; dialect?: string },
): VoiceReadSynthesisRequest {
  return toPlainVoiceReadSynthesisRequest({
    engine: settings.engine,
    text,
    voiceId,
    rate: settings.rate,
    pitch: settings.pitch,
    emotion,
    volcengineSpeechSlot: speechSlot,
    volcengineLanguage: speechMode ? speechMode.language : undefined,
    volcengineDialect: speechMode ? speechMode.dialect : undefined,
    engineConfig: toPlainVoiceReadEngineConfig(
      settings.engineConfig,
      settings.dashscopeApiKey,
    ),
  });
}

export async function synthesizeVoiceReadViaIpc(
  req: VoiceReadSynthesisRequest,
  signal?: AbortSignal,
): Promise<VoiceReadSynthesizeIpcResult> {
  if (signal?.aborted) {
    return { ok: false, error: "interrupted" };
  }
  const requestId = nextSynthesisRequestId();
  const cancel = () => {
    void window.colorTxt
      .voiceReadCancelSynthesis({ requestId })
      .catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) {
    signal.removeEventListener("abort", cancel);
    return { ok: false, error: "interrupted" };
  }

  try {
    const r = (await window.colorTxt.voiceReadSynthesize({
      ...toPlainVoiceReadSynthesisRequest(req),
      requestId,
    })) as VoiceReadSynthesizeIpcResult;
    if (signal?.aborted) {
      return { ok: false, error: "interrupted" };
    }
    return r;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function listVoiceReadVoicesViaIpc(
  engine: VoiceReadEngineId,
  engineConfig: VoiceReadEngineConfig,
) {
  return window.colorTxt.voiceReadListVoices(
    toPlainVoiceReadHealthCheckPayload(engine, engineConfig),
  );
}

export async function healthCheckVoiceReadViaIpc(
  engine: VoiceReadEngineId,
  engineConfig: VoiceReadEngineConfig,
) {
  return window.colorTxt.voiceReadHealthCheck(
    toPlainVoiceReadHealthCheckPayload(engine, engineConfig),
  );
}

export {
  VOICE_READ_IPC_HEALTH_CHECK,
  VOICE_READ_IPC_LIST_VOICES,
  VOICE_READ_IPC_SYNTHESIZE,
};
