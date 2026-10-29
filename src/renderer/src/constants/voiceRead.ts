import type { VoiceReadEdgeTtsRequest } from "@shared/voiceReadEdgeIpc";
import { voiceReadEngineSupportsEmotion, voiceReadEmotionActive } from "@shared/voiceReadEmotion";
import {
  defaultVoiceReadEngineConfig,
  engineConfigFingerprint,
  mergeVoiceReadEngineConfig,
  type VoiceReadEngineConfig,
} from "@shared/voiceReadEngineConfig";
import {
  getVoiceReadEngineMeta,
  normalizeVoiceReadEngineId,
  voiceReadEngineIsConfigured,
  voiceReadEngineRequiresApiKey,
  voiceReadEngineSupportsMultiVoiceScheme,
  type VoiceReadEngineId,
} from "@shared/voiceReadEngines";
import {
  DEFAULT_VOICE_READ_MULTI,
  DEFAULT_VOICE_READ_SINGLE,
  normalizeVoiceReadProfileSettingsFromPartial,
  type VoiceReadDialogueQuoteStyle,
  type VoiceReadProfileSettings,
} from "@shared/voiceReadProfiles";

export type { VoiceReadEngineId } from "@shared/voiceReadEngines";
export type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
export type {
  VoiceReadScheme,
  VoiceReadDialogueQuoteStyle,
  VoiceReadSingleVoiceSettings,
  VoiceReadMultiVoiceSettings,
} from "@shared/voiceReadProfiles";

/** 与 localStorage / SettingsApplyPayload 对齐的语音朗读设置 */
export type VoiceReadSettings = VoiceReadProfileSettings;

export const VOICE_READ_DIALOGUE_QUOTE_OPTIONS: {
  id: VoiceReadDialogueQuoteStyle;
  label: string;
}[] = [
  { id: "double", label: "“”" },
  { id: "single", label: "‘’" },
  { id: "corner", label: "「」" },
  { id: "doubleCorner", label: "『』" },
];

export const VOICE_READ_DIALOGUE_QUOTE_DEFAULTS: VoiceReadDialogueQuoteStyle[] =
  [...DEFAULT_VOICE_READ_MULTI.dialogueQuoteStyles];

export const defaultVoiceReadSettings: VoiceReadSettings =
  normalizeVoiceReadProfileSettingsFromPartial(undefined);

export const voiceReadRateMin = 0.5;
export const voiceReadRateMax = 2;
export const voiceReadPitchMin = 0.5;
export const voiceReadPitchMax = 2;
export const voiceReadVolumeMin = 0;
export const voiceReadVolumeMax = 1;
export const voiceReadPauseSentenceMin = 0;
export const voiceReadPauseSentenceMax = 1200;
export const voiceReadPauseCommaMin = 0;
export const voiceReadPauseCommaMax = 600;

export { DASHSCOPE_TTS_VOICES } from "@shared/voiceReadDashscopeVoices";

export function clampVoiceReadRate(v: number): number {
  if (!Number.isFinite(v)) return defaultVoiceReadSettings.rate;
  return Math.max(voiceReadRateMin, Math.min(voiceReadRateMax, v));
}

export function clampVoiceReadPitch(v: number): number {
  if (!Number.isFinite(v)) return defaultVoiceReadSettings.pitch;
  return Math.max(voiceReadPitchMin, Math.min(voiceReadPitchMax, v));
}

export function clampVoiceReadPauseSentence(v: number): number {
  if (!Number.isFinite(v)) return defaultVoiceReadSettings.pauseSentenceMs;
  return Math.max(
    voiceReadPauseSentenceMin,
    Math.min(voiceReadPauseSentenceMax, v),
  );
}

export function clampVoiceReadPauseComma(v: number): number {
  if (!Number.isFinite(v)) return defaultVoiceReadSettings.pauseCommaMs;
  return Math.max(
    voiceReadPauseCommaMin,
    Math.min(voiceReadPauseCommaMax, v),
  );
}

export function clampVoiceReadVolume(v: number): number {
  if (!Number.isFinite(v)) return defaultVoiceReadSettings.volume;
  return Math.max(voiceReadVolumeMin, Math.min(voiceReadVolumeMax, v));
}

/** 变更时不应使 TTS 合成缓存失效的字段（如 volume、标点停顿时长）除外 */
export function voiceReadSettingsSynthesisFingerprint(
  settings: VoiceReadSettings,
): string {
  return [
    settings.engine,
    settings.scheme,
    JSON.stringify(settings.single),
    JSON.stringify(settings.multi),
    settings.rate,
    settings.pitch,
    settings.emotionEnabled !== false ? "1" : "0",
    engineConfigFingerprint(settings.engineConfig),
  ].join("\u0001");
}

function syncEngineConfigDashscopeKey(
  engineConfig: VoiceReadEngineConfig,
  dashscopeApiKey: string,
): VoiceReadEngineConfig {
  const key = dashscopeApiKey.trim();
  if (key) return { ...engineConfig, dashscopeApiKey: key };
  const { dashscopeApiKey: _drop, ...rest } = engineConfig;
  return rest;
}

export function mergeVoiceReadSettings(
  raw: Partial<VoiceReadSettings> | undefined,
): VoiceReadSettings {
  const merged = normalizeVoiceReadProfileSettingsFromPartial(raw);
  const engine = normalizeVoiceReadEngineId(merged.engine, "edge");
  const rawObj =
    raw && typeof raw === "object" ? (raw as Partial<VoiceReadSettings>) : {};
  const engineConfigExplicit = rawObj.engineConfig !== undefined;
  const legacyDash =
    typeof rawObj.dashscopeApiKey === "string"
      ? rawObj.dashscopeApiKey
      : merged.dashscopeApiKey;
  const engineConfig = mergeVoiceReadEngineConfig(
    rawObj.engineConfig ?? merged.engineConfig,
    engineConfigExplicit ? undefined : legacyDash,
  );
  const dashscopeApiKey =
    engineConfig.dashscopeApiKey?.trim() ?? legacyDash.trim();
  return {
    ...merged,
    engine,
    rate: clampVoiceReadRate(merged.rate),
    pitch: clampVoiceReadPitch(merged.pitch),
    pauseSentenceMs: clampVoiceReadPauseSentence(merged.pauseSentenceMs),
    pauseCommaMs: clampVoiceReadPauseComma(merged.pauseCommaMs),
    volume: clampVoiceReadVolume(merged.volume),
    dashscopeApiKey,
    engineConfig: syncEngineConfigDashscopeKey(engineConfig, dashscopeApiKey),
  };
}

export function voiceReadSingleVoiceId(settings: VoiceReadSettings): string {
  return (
    settings.single.voiceId.trim() || DEFAULT_VOICE_READ_SINGLE.voiceId
  );
}

export function voiceReadMultiNarrationVoiceId(
  settings: VoiceReadSettings,
): string {
  return (
    settings.multi.narrationVoiceId.trim() ||
    DEFAULT_VOICE_READ_MULTI.narrationVoiceId
  );
}

export function voiceReadMultiDialogueVoiceId(
  settings: VoiceReadSettings,
): string {
  return (
    settings.multi.dialogueVoiceId.trim() ||
    DEFAULT_VOICE_READ_MULTI.dialogueVoiceId
  );
}

export function voiceReadMultiDialogueMaleVoiceId(
  settings: VoiceReadSettings,
): string {
  return (
    settings.multi.dialogueMaleVoiceId.trim() ||
    DEFAULT_VOICE_READ_MULTI.dialogueMaleVoiceId
  );
}

export function voiceReadMultiDialogueFemaleVoiceId(
  settings: VoiceReadSettings,
): string {
  return (
    settings.multi.dialogueFemaleVoiceId.trim() ||
    DEFAULT_VOICE_READ_MULTI.dialogueFemaleVoiceId
  );
}

export function voiceReadAiSpeakerRecognitionActive(
  settings: Pick<
    VoiceReadSettings,
    "scheme" | "multi" | "engine" | "engineConfig"
  >,
  globalAiEnabled: boolean,
): boolean {
  return (
    voiceReadEngineSupportsMultiVoiceScheme(
      settings.engine,
      settings.engineConfig,
    ) &&
    settings.scheme === "multi" &&
    settings.multi.aiSpeakerRecognitionEnabled !== false &&
    globalAiEnabled
  );
}

export { voiceReadEngineSupportsEmotion, voiceReadEmotionActive };

export function voiceReadAiEmotionRecognitionActive(
  settings: Pick<
    VoiceReadSettings,
    "scheme" | "multi" | "engine" | "engineConfig" | "emotionEnabled"
  >,
  globalAiEnabled: boolean,
): boolean {
  return (
    voiceReadEmotionActive(settings) &&
    voiceReadAiSpeakerRecognitionActive(settings, globalAiEnabled)
  );
}

export function voiceReadDashScopeRequiresApiKey(
  settings: Pick<VoiceReadSettings, "engine" | "dashscopeApiKey" | "engineConfig">,
): boolean {
  if (settings.engine !== "dashscope") return false;
  return voiceReadEngineRequiresApiKey(settings.engine, settings.engineConfig);
}

export function voiceReadEngineRequiresCredentials(
  settings: Pick<VoiceReadSettings, "engine" | "engineConfig">,
): boolean {
  return voiceReadEngineRequiresApiKey(settings.engine, settings.engineConfig);
}

export function voiceReadEngineIsReady(
  settings: Pick<VoiceReadSettings, "engine" | "engineConfig">,
): boolean {
  return voiceReadEngineIsConfigured(settings.engine, settings.engineConfig);
}

export function voiceReadEngineSupportsPitch(
  engine: VoiceReadEngineId,
): boolean {
  return getVoiceReadEngineMeta(engine).supportsPitch;
}

export function voiceReadEngineSupportsRate(
  engine: VoiceReadEngineId,
): boolean {
  return getVoiceReadEngineMeta(engine).supportsRate;
}

export function voiceReadEngineSupportsPunctuationPauses(
  engine: VoiceReadEngineId,
): boolean {
  return getVoiceReadEngineMeta(engine).supportsPunctuationPauses;
}

export function inferLangFromEdgeVoiceId(voiceId: string): string {
  const idx = voiceId.indexOf("-");
  if (idx <= 0) return "zh-CN";
  const second = voiceId.indexOf("-", idx + 1);
  if (second < 0) return "zh-CN";
  return voiceId.slice(0, second);
}

export function toVoiceReadEdgeTtsRequest(
  settings: VoiceReadSettings,
  text: string,
  voiceIdOverride?: string,
): VoiceReadEdgeTtsRequest {
  const voice =
    (voiceIdOverride ?? voiceReadSingleVoiceId(settings)).trim() ||
    DEFAULT_VOICE_READ_SINGLE.voiceId;
  return {
    text,
    voice,
    lang: inferLangFromEdgeVoiceId(voice),
    rate: settings.rate,
    pitch: settings.pitch,
  };
}

export function effectiveVoiceReadVoiceId(
  settings: VoiceReadSettings,
  resolvedVoiceId?: string,
): string {
  if (resolvedVoiceId?.trim()) return resolvedVoiceId.trim();
  return voiceReadSingleVoiceId(settings);
}

export {
  defaultSingleVoiceIdForEngine,
  defaultVoiceIdForEngine,
  voiceReadEngineSupportsMultiVoiceScheme,
} from "@shared/voiceReadEngines";

export { defaultVoiceReadEngineConfig };
