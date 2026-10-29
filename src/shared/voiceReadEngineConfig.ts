import { normalizeDashscopeTtsModel } from "./voiceReadDashscopeModels";
import {
  normalizeVolcenginePitch,
  normalizeVolcengineSlotSpeechModes,
  normalizeVolcengineTtsSampleRate,
  volcengineSlotSpeechModesFingerprint,
  type VolcengineSlotSpeechModeMap,
} from "./voiceReadVolcengineAudio";
import {
  isMimoTtsVoiceDesignModel,
  normalizeMimoTtsModel,
} from "./voiceReadMimoModels";
import { normalizeMinimaxTtsModel } from "./voiceReadMinimaxModels";

/** 语音朗读引擎连接配置（主进程 / preload / renderer 对齐） */

export type VoiceReadEngineConfig = {
  dashscopeApiKey?: string;
  dashscopeModel?: string;
  minimaxApiKey?: string;
  minimaxModel?: string;
  mimoApiKey?: string;
  mimoModel?: string;
  /** 火山引擎语音技术控制台签发的新版 API Key */
  volcengineApiKey?: string;
  /** 豆包语音合成 PCM 采样率（Hz）；缺省 24000 */
  volcengineSampleRate?: number;
  /** 官方 `post_process.pitch` 半音 [-12, 12]；缺省 0 */
  volcenginePitch?: number;
  /** 各朗读槽位的语种/方言（旁白/对白等各自独立） */
  volcengineSlotSpeechModes?: VolcengineSlotSpeechModeMap;
  /** VoiceDesign 模型：音色/风格自然语言描述 */
  mimoVoiceDescription?: string;
  /** VoiceDesign 模型：是否对 assistant 原文做智能润色（optimize_text_preview） */
  mimoOptimizeTextPreview?: boolean;
  /** VoiceClone 模型：本地参考音频路径（mp3/wav） */
  mimoReferenceAudioPath?: string;
};

export const defaultVoiceReadEngineConfig = (): VoiceReadEngineConfig => ({});

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t || undefined;
}

function normalizeOptionalBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  return undefined;
}

function hasOwnStringField(
  src: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(src, key);
}

function mergeOptionalSecretField(
  src: Record<string, unknown>,
  key:
    | "dashscopeApiKey"
    | "minimaxApiKey"
    | "mimoApiKey"
    | "volcengineApiKey",
  fallback?: string,
): string | undefined {
  if (hasOwnStringField(src, key)) {
    return normalizeOptionalString(src[key]);
  }
  return normalizeOptionalString(fallback);
}

export function mergeVoiceReadEngineConfig(
  raw: unknown,
  legacyDashscopeApiKey?: string,
): VoiceReadEngineConfig {
  const src =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    dashscopeApiKey: mergeOptionalSecretField(
      src,
      "dashscopeApiKey",
      legacyDashscopeApiKey,
    ),
    dashscopeModel: normalizeDashscopeTtsModel(src.dashscopeModel),
    minimaxApiKey: mergeOptionalSecretField(src, "minimaxApiKey"),
    minimaxModel: normalizeMinimaxTtsModel(src.minimaxModel),
    mimoApiKey: mergeOptionalSecretField(src, "mimoApiKey"),
    mimoModel: normalizeMimoTtsModel(src.mimoModel),
    volcengineApiKey: mergeOptionalSecretField(src, "volcengineApiKey"),
    volcengineSampleRate: normalizeVolcengineTtsSampleRate(
      src.volcengineSampleRate,
    ),
    volcenginePitch: normalizeVolcenginePitch(src.volcenginePitch),
    volcengineSlotSpeechModes: normalizeVolcengineSlotSpeechModes(
      src.volcengineSlotSpeechModes,
    ),
    mimoVoiceDescription: normalizeOptionalString(src.mimoVoiceDescription),
    mimoOptimizeTextPreview: normalizeOptionalBoolean(src.mimoOptimizeTextPreview),
    mimoReferenceAudioPath: normalizeOptionalString(src.mimoReferenceAudioPath),
  };
}

export function engineConfigFingerprint(
  config: VoiceReadEngineConfig,
): string {
  const secretMark = (v?: string) => (v?.trim() ? `#${v.trim().length}` : "");
  return [
    secretMark(config.dashscopeApiKey),
    config.dashscopeModel?.trim() ?? "",
    secretMark(config.minimaxApiKey),
    config.minimaxModel?.trim() ?? "",
    secretMark(config.mimoApiKey),
    config.mimoModel?.trim() ?? "",
    secretMark(config.volcengineApiKey),
    String(normalizeVolcengineTtsSampleRate(config.volcengineSampleRate)),
    String(normalizeVolcenginePitch(config.volcenginePitch)),
    volcengineSlotSpeechModesFingerprint(config.volcengineSlotSpeechModes),
    config.mimoVoiceDescription?.trim() ?? "",
    isMimoTtsVoiceDesignModel(config.mimoModel?.trim() ?? "")
      ? config.mimoOptimizeTextPreview === true
        ? "opt1"
        : "opt0"
      : "",
    config.mimoReferenceAudioPath?.trim() ?? "",
  ].join("\u0002");
}

export type VoiceReadProfileSecrets = {
  dashscopeApiKey?: string;
  minimaxApiKey?: string;
  mimoApiKey?: string;
  volcengineApiKey?: string;
};

export function extractProfileSecrets(
  config: VoiceReadEngineConfig,
): VoiceReadProfileSecrets {
  const out: VoiceReadProfileSecrets = {};
  const d = config.dashscopeApiKey?.trim();
  if (d) out.dashscopeApiKey = d;
  const m = config.minimaxApiKey?.trim();
  if (m) out.minimaxApiKey = m;
  const mi = config.mimoApiKey?.trim();
  if (mi) out.mimoApiKey = mi;
  const v = config.volcengineApiKey?.trim();
  if (v) out.volcengineApiKey = v;
  return out;
}

export function hydrateEngineConfigSecrets(
  config: VoiceReadEngineConfig,
  secrets: VoiceReadProfileSecrets,
): void {
  if (secrets.dashscopeApiKey) config.dashscopeApiKey = secrets.dashscopeApiKey;
  if (secrets.minimaxApiKey) config.minimaxApiKey = secrets.minimaxApiKey;
  if (secrets.mimoApiKey) config.mimoApiKey = secrets.mimoApiKey;
  if (secrets.volcengineApiKey) {
    config.volcengineApiKey = secrets.volcengineApiKey;
  }
}

export function parseProfileSecretsBlob(blob: string): Record<string, VoiceReadProfileSecrets> {
  if (!blob.trim()) return {};
  try {
    const parsed = JSON.parse(blob) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, VoiceReadProfileSecrets> = {};
    for (const [profileId, value] of Object.entries(parsed)) {
      if (!profileId.trim() || !value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const legacyDash = typeof v.dashscopeApiKey === "string" ? v.dashscopeApiKey : undefined;
      const legacyFlat = typeof v === "string" ? (v as string) : undefined;
      if (legacyFlat && !legacyDash) {
        out[profileId] = { dashscopeApiKey: legacyFlat.trim() };
        continue;
      }
      const secrets: VoiceReadProfileSecrets = {};
      if (typeof v.dashscopeApiKey === "string" && v.dashscopeApiKey.trim()) {
        secrets.dashscopeApiKey = v.dashscopeApiKey.trim();
      }
      if (typeof v.minimaxApiKey === "string" && v.minimaxApiKey.trim()) {
        secrets.minimaxApiKey = v.minimaxApiKey.trim();
      }
      if (typeof v.mimoApiKey === "string" && v.mimoApiKey.trim()) {
        secrets.mimoApiKey = v.mimoApiKey.trim();
      }
      if (
        typeof v.volcengineApiKey === "string" &&
        v.volcengineApiKey.trim()
      ) {
        secrets.volcengineApiKey = v.volcengineApiKey.trim();
      }
      if (Object.keys(secrets).length > 0) out[profileId] = secrets;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeProfileSecretsBlob(
  secretsByProfile: Record<string, VoiceReadProfileSecrets>,
): string {
  return JSON.stringify(secretsByProfile);
}
