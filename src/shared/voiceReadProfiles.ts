/** 语音朗读配置方案（主进程 / preload / renderer 对齐） */

import { reconcileOrphanProfileKeys } from "./aiEndpointProfiles";
import {
  extractProfileSecrets,
  hydrateEngineConfigSecrets,
  mergeVoiceReadEngineConfig,
  parseProfileSecretsBlob,
  serializeProfileSecretsBlob,
  type VoiceReadEngineConfig,
  type VoiceReadProfileSecrets,
} from "./voiceReadEngineConfig";
import {
  getVoiceReadEngineMeta,
  defaultMultiVoiceIdsForEngine,
  defaultSingleVoiceIdForEngine,
  normalizeVoiceReadEngineId,
  voiceReadEngineSupportsMultiVoiceScheme,
  type VoiceReadEngineId,
} from "./voiceReadEngines";

export type { VoiceReadEngineId } from "./voiceReadEngines";

export const MAX_VOICE_READ_PROFILES = 12;
export const LEGACY_DEFAULT_VOICE_READ_PROFILE_ID = "profile-default";

export type VoiceReadScheme = "single" | "multi";
export type VoiceReadDialogueQuoteStyle =
  | "double"
  | "single"
  | "corner"
  | "doubleCorner";

const VALID_DIALOGUE_QUOTE_STYLES = new Set<VoiceReadDialogueQuoteStyle>([
  "double",
  "single",
  "corner",
  "doubleCorner",
]);

const DEFAULT_DIALOGUE_QUOTE_STYLES: VoiceReadDialogueQuoteStyle[] = [
  "double",
  "single",
  "corner",
  "doubleCorner",
];

function normalizeDialogueQuoteStyles(
  raw: unknown,
): VoiceReadDialogueQuoteStyle[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DIALOGUE_QUOTE_STYLES];
  const out: VoiceReadDialogueQuoteStyle[] = [];
  const seen = new Set<VoiceReadDialogueQuoteStyle>();
  for (const item of raw) {
    if (
      typeof item === "string" &&
      VALID_DIALOGUE_QUOTE_STYLES.has(item as VoiceReadDialogueQuoteStyle) &&
      !seen.has(item as VoiceReadDialogueQuoteStyle)
    ) {
      const id = item as VoiceReadDialogueQuoteStyle;
      seen.add(id);
      out.push(id);
    }
  }
  return out.length > 0 ? out : [...DEFAULT_DIALOGUE_QUOTE_STYLES];
}

/** 单音色方案专用语音 */
export type VoiceReadSingleVoiceSettings = {
  voiceId: string;
};

/** 旁白/对白多音色方案专用语音与对白选项 */
export type VoiceReadMultiVoiceSettings = {
  narrationVoiceId: string;
  dialogueVoiceId: string;
  dialogueMaleVoiceId: string;
  dialogueFemaleVoiceId: string;
  dialogueQuoteStyles: VoiceReadDialogueQuoteStyle[];
  aiSpeakerRecognitionEnabled: boolean;
};

export const DEFAULT_VOICE_READ_SINGLE: VoiceReadSingleVoiceSettings = {
  voiceId: defaultSingleVoiceIdForEngine("edge"),
};

export const DEFAULT_VOICE_READ_MULTI: VoiceReadMultiVoiceSettings = {
  ...defaultMultiVoiceIdsForEngine("edge"),
  dialogueQuoteStyles: [...DEFAULT_DIALOGUE_QUOTE_STYLES],
  aiSpeakerRecognitionEnabled: true,
};

function readSettingsObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function mergeVoiceReadSingleVoiceSettings(
  raw: unknown,
  engineDefaultVoiceId?: string,
): VoiceReadSingleVoiceSettings {
  const src = readSettingsObject(raw);
  const fallback =
    engineDefaultVoiceId?.trim() || DEFAULT_VOICE_READ_SINGLE.voiceId;
  const voiceId =
    typeof src.voiceId === "string" && src.voiceId.trim()
      ? src.voiceId.trim()
      : fallback;
  return { voiceId };
}

export function mergeVoiceReadMultiVoiceSettings(
  raw: unknown,
): VoiceReadMultiVoiceSettings {
  const src = readSettingsObject(raw);
  const d = DEFAULT_VOICE_READ_MULTI;
  const pickVoice = (key: keyof VoiceReadMultiVoiceSettings, fallback: string) => {
    const v = src[key];
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  };
  return {
    narrationVoiceId: pickVoice("narrationVoiceId", d.narrationVoiceId),
    dialogueVoiceId: pickVoice("dialogueVoiceId", d.dialogueVoiceId),
    dialogueMaleVoiceId: pickVoice("dialogueMaleVoiceId", d.dialogueMaleVoiceId),
    dialogueFemaleVoiceId: pickVoice(
      "dialogueFemaleVoiceId",
      d.dialogueFemaleVoiceId,
    ),
    dialogueQuoteStyles: normalizeDialogueQuoteStyles(src.dialogueQuoteStyles),
    aiSpeakerRecognitionEnabled: src.aiSpeakerRecognitionEnabled !== false,
  };
}

/** 方案内 settings 快照（不含试听文案） */
export type VoiceReadProfileSettings = {
  scheme: VoiceReadScheme;
  single: VoiceReadSingleVoiceSettings;
  multi: VoiceReadMultiVoiceSettings;
  engine: VoiceReadEngineId;
  rate: number;
  pitch: number;
  /** 句末停顿（。！？…）时长 ms；0 表示不插入停顿（仅 Edge TTS 生效） */
  pauseSentenceMs: number;
  /** 句中停顿（，；：、）时长 ms；0 表示不插入停顿（仅 Edge TTS 生效） */
  pauseCommaMs: number;
  /** 播放音量，0～1；不参与 TTS 合成与音频缓存键 */
  volume: number;
  /** 为 false 时不向支持情绪的引擎传递语气/情绪参数 */
  emotionEnabled: boolean;
  /** 磁盘快照不含明文密钥 */
  dashscopeApiKey: string;
  engineConfig: VoiceReadEngineConfig;
};

export interface VoiceReadProfile {
  id: string;
  name: string;
  settings: VoiceReadProfileSettings;
  updatedAt?: number;
}

function normalizeProfileName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 80);
}

function normalizeProfileId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 64);
}

/** 方案未命名时，下拉 placeholder / 列表回退文案 */
export function resolveVoiceReadProfileLabel(
  settings: Pick<
    VoiceReadProfileSettings,
    "scheme" | "engine" | "multi"
  >,
): string {
  const schemeLabel = settings.scheme === "multi" ? "旁白/对白" : "单音色";
  const engineLabel = getVoiceReadEngineMeta(settings.engine).label;
  let label = `${engineLabel} · ${schemeLabel}`;
  if (
    settings.scheme === "multi" &&
    settings.multi.aiSpeakerRecognitionEnabled !== false
  ) {
    label += " · AI 识别";
  }
  return label;
}

export function createVoiceReadProfile(opts?: {
  id?: string;
  name?: string;
  settings?: VoiceReadProfileSettings;
}): VoiceReadProfile {
  return {
    id: opts?.id?.trim() || crypto.randomUUID(),
    name: normalizeProfileName(opts?.name),
    settings: opts?.settings ??
      normalizeVoiceReadProfileSettingsFromPartial(undefined),
    updatedAt: Date.now(),
  };
}

export function normalizeVoiceReadProfile(
  raw: unknown,
  normalizeSettings: (partial: unknown) => VoiceReadProfileSettings,
): VoiceReadProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = normalizeProfileId(o.id);
  if (!id) return null;
  return {
    id,
    name: normalizeProfileName(o.name),
    settings: normalizeSettings(o.settings ?? o),
    updatedAt:
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : undefined,
  };
}

export function normalizeVoiceReadProfiles(
  raw: unknown,
  fallbackSettings: VoiceReadProfileSettings,
  normalizeSettings: (partial: unknown) => VoiceReadProfileSettings,
): VoiceReadProfile[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      createVoiceReadProfile({
        id: LEGACY_DEFAULT_VOICE_READ_PROFILE_ID,
        name: "",
        settings: fallbackSettings,
      }),
    ];
  }
  const seen = new Set<string>();
  const out: VoiceReadProfile[] = [];
  for (const item of raw) {
    const p = normalizeVoiceReadProfile(item, normalizeSettings);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= MAX_VOICE_READ_PROFILES) break;
  }
  return out.length > 0
    ? out
    : [
        createVoiceReadProfile({
          id: LEGACY_DEFAULT_VOICE_READ_PROFILE_ID,
          name: "",
          settings: fallbackSettings,
        }),
      ];
}

function resolveActiveProfileId(
  activeId: unknown,
  profiles: Array<{ id: string }>,
): string {
  const id = typeof activeId === "string" ? activeId.trim() : "";
  if (id && profiles.some((p) => p.id === id)) return id;
  return profiles[0]!.id;
}

export function collectVoiceReadProfileApiKeys(
  profiles: VoiceReadProfile[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of profiles) {
    const k = p.settings.engineConfig.dashscopeApiKey?.trim();
    if (k) out[p.id] = k;
  }
  return out;
}

export function serializeVoiceReadProfileSecrets(
  profiles: VoiceReadProfile[],
): string {
  const secrets: Record<string, VoiceReadProfileSecrets> = {};
  for (const p of profiles) {
    const extracted = extractProfileSecrets(p.settings.engineConfig);
    if (Object.keys(extracted).length > 0) secrets[p.id] = extracted;
  }
  return serializeProfileSecretsBlob(secrets);
}

/** 结构化 secrets blob：孤儿 profile id 的密钥挂回活跃方案 */
export function reconcileOrphanVoiceReadSecrets(
  profiles: VoiceReadProfile[],
  activeProfileId: string,
  secretsByProfile: Record<string, VoiceReadProfileSecrets>,
): boolean {
  const activeId = activeProfileId.trim();
  if (!activeId) return false;
  const activeSecrets = secretsByProfile[activeId];
  if (activeSecrets && Object.keys(activeSecrets).length > 0) return false;

  const profileIds = new Set(profiles.map((p) => p.id));
  const orphans = Object.entries(secretsByProfile).filter(
    ([id, sec]) => !profileIds.has(id) && Object.keys(sec).length > 0,
  );
  if (orphans.length === 0) return false;

  const chosen =
    orphans.length === 1
      ? orphans[0]![1]
      : (
          orphans.find(([id]) => id === LEGACY_DEFAULT_VOICE_READ_PROFILE_ID) ??
          orphans[0]
        )![1];
  secretsByProfile[activeId] = { ...chosen };
  return true;
}

export function mergeVoiceReadProfileSecretsForSave(
  profiles: VoiceReadProfile[],
  existingVault: Record<string, VoiceReadProfileSecrets>,
): Record<string, VoiceReadProfileSecrets> {
  const profileIds = new Set(profiles.map((p) => p.id));
  const out: Record<string, VoiceReadProfileSecrets> = {};

  for (const [id, sec] of Object.entries(existingVault)) {
    if (!profileIds.has(id) && Object.keys(sec).length > 0) {
      out[id] = { ...sec };
    }
  }
  for (const p of profiles) {
    const extracted = extractProfileSecrets(p.settings.engineConfig);
    if (Object.keys(extracted).length > 0) {
      out[p.id] = extracted;
    }
  }
  return out;
}

export function hydrateVoiceReadProfilesApiKeys(
  profiles: VoiceReadProfile[],
  keys: Record<string, string>,
  secretsBlob?: string,
  activeProfileId?: string,
): boolean {
  let migrated = false;
  const parsed = secretsBlob?.trim()
    ? parseProfileSecretsBlob(secretsBlob)
    : {};
  const hasStructured = Object.keys(parsed).length > 0;
  const activeId = activeProfileId?.trim() ?? "";
  if (hasStructured) {
    if (
      activeId &&
      reconcileOrphanVoiceReadSecrets(profiles, activeId, parsed)
    ) {
      migrated = true;
    }
    for (const p of profiles) {
      const vault = parsed[p.id];
      if (!vault) continue;
      hydrateEngineConfigSecrets(p.settings.engineConfig, vault);
      if (vault.dashscopeApiKey) {
        p.settings.dashscopeApiKey = vault.dashscopeApiKey;
      }
    }
    return migrated;
  }
  if (activeId && reconcileOrphanProfileKeys(profiles, activeId, keys)) {
    migrated = true;
  }
  for (const p of profiles) {
    const legacy = keys[p.id];
    if (legacy) {
      hydrateEngineConfigSecrets(p.settings.engineConfig, {
        dashscopeApiKey: legacy,
      });
      p.settings.dashscopeApiKey = legacy;
    }
  }
  return migrated;
}

function stripVoiceReadProfileSettingsApiKeys(
  settings: VoiceReadProfileSettings,
): VoiceReadProfileSettings {
  return {
    ...settings,
    dashscopeApiKey: "",
    engineConfig: {
      ...settings.engineConfig,
      dashscopeApiKey: undefined,
      minimaxApiKey: undefined,
      mimoApiKey: undefined,
      volcengineApiKey: undefined,
    },
  };
}

/** localStorage 落盘：剥掉方案与根级快照中的 API 密钥明文 */
export function stripVoiceReadSettingsApiKeysForDisk(
  settings: VoiceReadProfileSettings,
): VoiceReadProfileSettings {
  return stripVoiceReadProfileSettingsApiKeys(settings);
}

export function stripVoiceReadProfileApiKeysForDisk(
  profiles: VoiceReadProfile[],
): VoiceReadProfile[] {
  return profiles.map((p) => ({
    ...p,
    settings: stripVoiceReadProfileSettingsApiKeys(p.settings),
  }));
}

export type VoiceReadProfilesBundle = {
  profiles: VoiceReadProfile[];
  activeProfileId: string;
};

export function ensureVoiceReadProfilesBundle(
  rawProfiles: unknown,
  rawActiveId: unknown,
  fallbackSettings: VoiceReadProfileSettings,
  normalizeSettings: (partial: unknown) => VoiceReadProfileSettings,
): VoiceReadProfilesBundle {
  const profiles = normalizeVoiceReadProfiles(
    rawProfiles,
    fallbackSettings,
    normalizeSettings,
  );
  const activeProfileId = resolveActiveProfileId(rawActiveId, profiles);
  return { profiles, activeProfileId };
}

export function normalizeVoiceReadProfileSettingsFromPartial(
  partial: unknown,
): VoiceReadProfileSettings {
  const src = readSettingsObject(partial);
  const legacyDash =
    typeof src.dashscopeApiKey === "string" ? src.dashscopeApiKey : "";
  const engineConfig = mergeVoiceReadEngineConfig(src.engineConfig, legacyDash);
  const engine = normalizeVoiceReadEngineId(src.engine, "edge");
  const engineDefaultVoiceId = defaultSingleVoiceIdForEngine(engine);
  const schemeRaw = src.scheme === "multi" ? "multi" : "single";
  const scheme =
    schemeRaw === "multi" &&
    voiceReadEngineSupportsMultiVoiceScheme(engine, engineConfig)
      ? "multi"
      : "single";
  return {
    scheme,
    engine,
    single: mergeVoiceReadSingleVoiceSettings(src.single, engineDefaultVoiceId),
    multi: mergeVoiceReadMultiVoiceSettings(src.multi),
    rate: typeof src.rate === "number" ? src.rate : 1,
    pitch: typeof src.pitch === "number" ? src.pitch : 1,
    // 默认关闭：老存档无字段保持原听感；0 表示关闭（仅 Edge TTS 生效）
    pauseSentenceMs:
      typeof src.pauseSentenceMs === "number" ? src.pauseSentenceMs : 0,
    pauseCommaMs:
      typeof src.pauseCommaMs === "number" ? src.pauseCommaMs : 0,
    volume: typeof src.volume === "number" ? src.volume : 1,
    emotionEnabled: src.emotionEnabled !== false,
    dashscopeApiKey: engineConfig.dashscopeApiKey?.trim() ?? legacyDash.trim(),
    engineConfig,
  };
}
