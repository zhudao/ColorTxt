import type { VoiceReadEngineId } from "@shared/voiceReadEngines";
import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import type {
  VoiceReadHealthCheckResult,
  VoiceReadSynthesisRequest,
  VoiceReadSynthesisResult,
  VoiceReadVoiceOption,
} from "@shared/voiceReadSynthesis";
import { dashscopeTtsProvider } from "./providers/dashscopeProvider";
import { edgeTtsProvider } from "./providers/edgeProvider";
import { mimoTtsProvider } from "./providers/mimoProvider";
import { minimaxTtsProvider } from "./providers/minimaxProvider";
import { volcengineTtsProvider } from "./providers/volcengineProvider";
import { winSapiTtsProvider } from "./providers/winSapiProvider";
import type { VoiceReadTtsProvider } from "./providers/types";

const PROVIDERS: VoiceReadTtsProvider[] = [
  edgeTtsProvider,
  dashscopeTtsProvider,
  minimaxTtsProvider,
  mimoTtsProvider,
  volcengineTtsProvider,
  ...(process.platform === "win32" ? [winSapiTtsProvider] : []),
];

const PROVIDER_MAP = new Map<VoiceReadEngineId, VoiceReadTtsProvider>(
  PROVIDERS.map((p) => [p.engineId, p]),
);

export function getVoiceReadTtsProvider(
  engine: VoiceReadEngineId,
): VoiceReadTtsProvider | null {
  return PROVIDER_MAP.get(engine) ?? null;
}

export async function synthesizeVoiceReadAudio(
  req: VoiceReadSynthesisRequest,
  signal: AbortSignal,
): Promise<VoiceReadSynthesisResult> {
  const provider = getVoiceReadTtsProvider(req.engine);
  if (!provider) {
    throw new Error(`不支持的语音引擎：${req.engine}`);
  }
  return provider.synthesize(req, signal);
}

export async function listVoiceReadVoices(
  engine: VoiceReadEngineId,
  config: VoiceReadEngineConfig,
  signal?: AbortSignal,
): Promise<VoiceReadVoiceOption[]> {
  const provider = getVoiceReadTtsProvider(engine);
  if (!provider?.listVoices) return [];
  return provider.listVoices(config, signal);
}

export async function healthCheckVoiceReadEngine(
  engine: VoiceReadEngineId,
  config: VoiceReadEngineConfig,
  signal?: AbortSignal,
): Promise<VoiceReadHealthCheckResult> {
  const provider = getVoiceReadTtsProvider(engine);
  if (!provider?.healthCheck) {
    return { ok: false, message: "该引擎不支持连接测试" };
  }
  return provider.healthCheck(config, signal);
}
