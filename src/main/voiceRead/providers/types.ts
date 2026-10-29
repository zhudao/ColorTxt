import type { VoiceReadEngineId } from "@shared/voiceReadEngines";
import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import type {
  VoiceReadHealthCheckResult,
  VoiceReadSynthesisRequest,
  VoiceReadSynthesisResult,
  VoiceReadVoiceOption,
} from "@shared/voiceReadSynthesis";

export interface VoiceReadTtsProvider {
  readonly engineId: VoiceReadEngineId;
  synthesize(
    req: VoiceReadSynthesisRequest,
    signal: AbortSignal,
  ): Promise<VoiceReadSynthesisResult>;
  listVoices?(
    config: VoiceReadEngineConfig,
    signal?: AbortSignal,
  ): Promise<VoiceReadVoiceOption[]>;
  healthCheck?(
    config: VoiceReadEngineConfig,
    signal?: AbortSignal,
  ): Promise<VoiceReadHealthCheckResult>;
}
