import type {
  VoiceReadHealthCheckRequest,
  VoiceReadHealthCheckResult,
  VoiceReadListVoicesRequest,
  VoiceReadSynthesisRequest,
  VoiceReadSynthesisResult,
  VoiceReadVoiceOption,
} from "./voiceReadSynthesis";

export const VOICE_READ_IPC_SYNTHESIZE = "voiceRead:synthesize" as const;
export const VOICE_READ_IPC_CANCEL_SYNTHESIS =
  "voiceRead:cancelSynthesis" as const;
export const VOICE_READ_IPC_LIST_VOICES = "voiceRead:listVoices" as const;
export const VOICE_READ_IPC_HEALTH_CHECK = "voiceRead:healthCheck" as const;

export type VoiceReadSynthesizeIpcResult =
  | { ok: true; result: VoiceReadSynthesisResult }
  | { ok: false; error: string };

export type VoiceReadListVoicesIpcResult =
  | { ok: true; voices: VoiceReadVoiceOption[] }
  | { ok: false; error: string };

export type VoiceReadHealthCheckIpcResult =
  | { ok: true; result: VoiceReadHealthCheckResult }
  | { ok: false; error: string };

export type VoiceReadSynthesizePayload = VoiceReadSynthesisRequest & {
  requestId: string;
};
export type VoiceReadCancelSynthesisPayload = { requestId: string };
export type VoiceReadListVoicesPayload = VoiceReadListVoicesRequest;
export type VoiceReadHealthCheckPayload = VoiceReadHealthCheckRequest;
