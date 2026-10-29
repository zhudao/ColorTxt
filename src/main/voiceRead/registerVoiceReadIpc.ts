import { ipcMain } from "electron";
import {
  VOICE_READ_IPC_CANCEL_SYNTHESIS,
  VOICE_READ_IPC_HEALTH_CHECK,
  VOICE_READ_IPC_LIST_VOICES,
  VOICE_READ_IPC_SYNTHESIZE,
  type VoiceReadHealthCheckIpcResult,
  type VoiceReadHealthCheckPayload,
  type VoiceReadListVoicesIpcResult,
  type VoiceReadListVoicesPayload,
  type VoiceReadSynthesizeIpcResult,
  type VoiceReadSynthesizePayload,
} from "@shared/voiceReadSynthesisIpc";
import { isVoiceReadEngineId } from "@shared/voiceReadEngines";
import { normalizeVoiceReadEmotion } from "@shared/voiceReadEmotion";
import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import {
  normalizeSynthesisResultForIpc,
  toPlainVoiceReadEngineConfig,
} from "@shared/voiceReadIpcSerialize";
import type { VoiceReadSynthesisRequest } from "@shared/voiceReadSynthesis";
import {
  normalizeVolcengineExplicitDialect,
  normalizeVolcengineExplicitLanguage,
  parseVolcengineSpeechSlot,
} from "@shared/voiceReadVolcengineAudio";
import {
  healthCheckVoiceReadEngine,
  listVoiceReadVoices,
  synthesizeVoiceReadAudio,
} from "./providerRegistry";

const synthesisAbortControllers = new Map<string, AbortController>();

function parseSynthesisRequestId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const requestId = (raw as Record<string, unknown>).requestId;
  if (typeof requestId !== "string") return null;
  const normalized = requestId.trim();
  if (!normalized || normalized.length > 80) return null;
  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
}

function synthesisAbortKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`;
}

function parseSynthesisRequest(raw: unknown): VoiceReadSynthesisRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isVoiceReadEngineId(o.engine)) return null;
  const text = typeof o.text === "string" ? o.text : "";
  const voiceId = typeof o.voiceId === "string" ? o.voiceId : "";
  const rate =
    typeof o.rate === "number" && Number.isFinite(o.rate) ? o.rate : 1;
  const pitch =
    typeof o.pitch === "number" && Number.isFinite(o.pitch) ? o.pitch : 1;
  const engineConfig = toPlainVoiceReadEngineConfig(o.engineConfig);
  const emotionRaw = o.emotion;
  const emotion =
    typeof emotionRaw === "string" && emotionRaw.trim()
      ? normalizeVoiceReadEmotion(emotionRaw)
      : undefined;
  return {
    engine: o.engine,
    text,
    voiceId,
    rate,
    pitch,
    engineConfig,
    emotion: emotion === "auto" ? undefined : emotion,
    volcengineSpeechSlot: parseVolcengineSpeechSlot(o.volcengineSpeechSlot),
    volcengineLanguage:
      o.volcengineLanguage === undefined
        ? undefined
        : normalizeVolcengineExplicitLanguage(o.volcengineLanguage),
    volcengineDialect:
      o.volcengineDialect === undefined
        ? undefined
        : normalizeVolcengineExplicitDialect(o.volcengineDialect),
  };
}

function parseEngineConfigPayload(
  raw: unknown,
): { engine: import("@shared/voiceReadEngines").VoiceReadEngineId; engineConfig: VoiceReadEngineConfig } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isVoiceReadEngineId(o.engine)) return null;
  return {
    engine: o.engine,
    engineConfig: toPlainVoiceReadEngineConfig(o.engineConfig),
  };
}

export function registerVoiceReadIpcHandlers(): void {
  ipcMain.handle(
    VOICE_READ_IPC_SYNTHESIZE,
    async (evt, raw: unknown): Promise<VoiceReadSynthesizeIpcResult> => {
      const req = parseSynthesisRequest(raw);
      const requestId = parseSynthesisRequestId(raw);
      if (!req || !requestId) return { ok: false, error: "无效请求" };
      const ac = new AbortController();
      const key = synthesisAbortKey(evt.sender.id, requestId);
      synthesisAbortControllers.get(key)?.abort();
      synthesisAbortControllers.set(key, ac);
      const abortOnSenderDestroyed = () => ac.abort();
      evt.sender.once("destroyed", abortOnSenderDestroyed);
      try {
        const result = normalizeSynthesisResultForIpc(
          await synthesizeVoiceReadAudio(req, ac.signal),
        );
        return { ok: true, result };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      } finally {
        evt.sender.removeListener("destroyed", abortOnSenderDestroyed);
        if (synthesisAbortControllers.get(key) === ac) {
          synthesisAbortControllers.delete(key);
        }
      }
    },
  );

  ipcMain.handle(VOICE_READ_IPC_CANCEL_SYNTHESIS, (evt, raw: unknown) => {
    const requestId = parseSynthesisRequestId(raw);
    if (requestId) {
      const key = synthesisAbortKey(evt.sender.id, requestId);
      synthesisAbortControllers.get(key)?.abort();
      synthesisAbortControllers.delete(key);
    }
    return { ok: true as const };
  });

  ipcMain.handle(
    VOICE_READ_IPC_LIST_VOICES,
    async (_evt, raw: unknown): Promise<VoiceReadListVoicesIpcResult> => {
      const parsed = parseEngineConfigPayload(raw);
      if (!parsed) return { ok: false, error: "无效请求" };
      try {
        const voices = await listVoiceReadVoices(
          parsed.engine,
          parsed.engineConfig,
        );
        return { ok: true, voices };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    VOICE_READ_IPC_HEALTH_CHECK,
    async (_evt, raw: unknown): Promise<VoiceReadHealthCheckIpcResult> => {
      const parsed = parseEngineConfigPayload(raw);
      if (!parsed) return { ok: false, error: "无效请求" };
      try {
        const result = await healthCheckVoiceReadEngine(
          parsed.engine,
          parsed.engineConfig,
        );
        return { ok: true, result };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
}

export type {
  VoiceReadSynthesizePayload,
  VoiceReadListVoicesPayload,
  VoiceReadHealthCheckPayload,
};
