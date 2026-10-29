/** 对话模型 / 文生图 独立配置方案（主进程 / preload / renderer 对齐） */

import {
  type AIChatEndpoint,
  type AIConfig,
  type AITxt2ImgConfig,
  defaultAIConfig,
  defaultTxt2ImgConfig,
  EMPTY_TOKEN_PRICE_PER_MILLION,
  MAX_TOOL_ROUNDS_MAX,
  MAX_TOOL_ROUNDS_MIN,
  normalizeTokenPricePerMillion,
  normalizeTxt2ImgConfig,
} from "./aiTypes";
import {
  CHAT_API_PROVIDER_CUSTOM_PRESET,
  findChatProviderPresetByBaseUrl,
  findTxt2ImgBackendPreset,
  normalizeChatPresetBaseUrl,
} from "./apiEndpointPresets";
import { normalizeSystemPromptExtraMode } from "./aiSystemPromptPresets";

export const MAX_AI_ENDPOINT_PROFILES = 12;
export const LEGACY_DEFAULT_PROFILE_ID = "profile-default";

export interface AiChatProfile {
  id: string;
  name: string;
  chat: AIChatEndpoint;
  updatedAt?: number;
}

export interface AiTxt2ImgProfile {
  id: string;
  name: string;
  txt2img: AITxt2ImgConfig;
  updatedAt?: number;
}

export function normalizeChatEndpoint(raw: unknown): AIChatEndpoint {
  const d = structuredClone(defaultAIConfig.chat);
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.baseUrl === "string") d.baseUrl = o.baseUrl;
  if (typeof o.apiKey === "string") d.apiKey = o.apiKey;
  if (typeof o.model === "string") {
    const m = o.model.trim();
    d.model = m.length > 200 ? m.slice(0, 200) : m;
  }
  if (typeof o.temperature === "number" && Number.isFinite(o.temperature)) {
    d.temperature = Math.min(2, Math.max(0, o.temperature));
  }
  if (typeof o.maxTokens === "number" && Number.isFinite(o.maxTokens)) {
    d.maxTokens = Math.min(128_000, Math.max(256, Math.trunc(o.maxTokens)));
  }
  if (
    typeof o.slidingWindowSize === "number" &&
    Number.isFinite(o.slidingWindowSize)
  ) {
    d.slidingWindowSize = Math.min(64, Math.max(1, Math.trunc(o.slidingWindowSize)));
  }
  if (
    typeof o.maxToolRounds === "number" &&
    Number.isFinite(o.maxToolRounds)
  ) {
    d.maxToolRounds = Math.min(
      MAX_TOOL_ROUNDS_MAX,
      Math.max(MAX_TOOL_ROUNDS_MIN, Math.trunc(o.maxToolRounds)),
    );
  }
  if (typeof o.systemPromptExtra === "string") {
    const t = o.systemPromptExtra;
    d.systemPromptExtra = t.length > 8_000 ? t.slice(0, 8_000) : t;
  }
  d.systemPromptExtraMode = normalizeSystemPromptExtraMode(
    o.systemPromptExtraMode,
    d.systemPromptExtra,
  );
  d.tokenPricePerMillion = normalizeTokenPricePerMillion(o.tokenPricePerMillion);
  if (d.baseUrl.trim()) {
    d.baseUrl = normalizeChatPresetBaseUrl(d.baseUrl);
  }
  return d;
}

function normalizeProfileName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 80);
}

/** 对话方案未命名时，下拉 placeholder / 列表回退文案 */
export function resolveChatProfileProviderLabel(chat: AIChatEndpoint): string {
  const hit = findChatProviderPresetByBaseUrl(chat.baseUrl);
  if (hit) return hit.label;
  if (chat.baseUrl.trim()) return CHAT_API_PROVIDER_CUSTOM_PRESET.label;
  return "";
}

/** 文生图方案未命名时，下拉 placeholder / 列表回退文案 */
export function resolveTxt2ImgProfileProviderLabel(
  txt2img: AITxt2ImgConfig,
): string {
  const hit = findTxt2ImgBackendPreset(txt2img.backend);
  return hit?.label ?? txt2img.backend;
}

function normalizeProfileId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = raw.trim().slice(0, 64);
  return t;
}

export function createChatProfile(opts?: {
  id?: string;
  name?: string;
  chat?: AIChatEndpoint;
}): AiChatProfile {
  return {
    id: opts?.id?.trim() || crypto.randomUUID(),
    name: normalizeProfileName(opts?.name),
    chat: normalizeChatEndpoint(opts?.chat ?? defaultAIConfig.chat),
    updatedAt: Date.now(),
  };
}

export function createTxt2ImgProfile(opts?: {
  id?: string;
  name?: string;
  txt2img?: AITxt2ImgConfig;
}): AiTxt2ImgProfile {
  return {
    id: opts?.id?.trim() || crypto.randomUUID(),
    name: normalizeProfileName(opts?.name),
    txt2img: normalizeTxt2ImgConfig(opts?.txt2img ?? defaultTxt2ImgConfig),
    updatedAt: Date.now(),
  };
}

export function normalizeChatProfile(raw: unknown): AiChatProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = normalizeProfileId(o.id);
  if (!id) return null;
  return {
    id,
    name: normalizeProfileName(o.name),
    chat: normalizeChatEndpoint(o.chat),
    updatedAt:
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : undefined,
  };
}

export function normalizeTxt2ImgProfile(raw: unknown): AiTxt2ImgProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = normalizeProfileId(o.id);
  if (!id) return null;
  return {
    id,
    name: normalizeProfileName(o.name),
    txt2img: normalizeTxt2ImgConfig(o.txt2img),
    updatedAt:
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : undefined,
  };
}

export function normalizeChatProfiles(
  raw: unknown,
  fallbackChat?: AIChatEndpoint,
): AiChatProfile[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      createChatProfile({
        id: LEGACY_DEFAULT_PROFILE_ID,
        name: "",
        chat: fallbackChat,
      }),
    ];
  }
  const seen = new Set<string>();
  const out: AiChatProfile[] = [];
  for (const item of raw) {
    const p = normalizeChatProfile(item);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= MAX_AI_ENDPOINT_PROFILES) break;
  }
  return out.length > 0
    ? out
    : [
        createChatProfile({
          id: LEGACY_DEFAULT_PROFILE_ID,
          name: "",
          chat: fallbackChat,
        }),
      ];
}

export function normalizeTxt2ImgProfiles(
  raw: unknown,
  fallbackTxt2img?: AITxt2ImgConfig,
): AiTxt2ImgProfile[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      createTxt2ImgProfile({
        id: LEGACY_DEFAULT_PROFILE_ID,
        name: "",
        txt2img: fallbackTxt2img,
      }),
    ];
  }
  const seen = new Set<string>();
  const out: AiTxt2ImgProfile[] = [];
  for (const item of raw) {
    const p = normalizeTxt2ImgProfile(item);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= MAX_AI_ENDPOINT_PROFILES) break;
  }
  return out.length > 0
    ? out
    : [
        createTxt2ImgProfile({
          id: LEGACY_DEFAULT_PROFILE_ID,
          name: "",
          txt2img: fallbackTxt2img,
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

export function migrateChatProfilesInConfig(cfg: AIConfig): void {
  const hadProfiles =
    Array.isArray(cfg.chatProfiles) && cfg.chatProfiles.length > 0;
  cfg.chatProfiles = normalizeChatProfiles(
    hadProfiles ? cfg.chatProfiles : undefined,
    cfg.chat,
  );
  cfg.activeChatProfileId = resolveActiveProfileId(
    hadProfiles ? cfg.activeChatProfileId : LEGACY_DEFAULT_PROFILE_ID,
    cfg.chatProfiles,
  );
}

export function migrateTxt2ImgProfilesInConfig(cfg: AIConfig): void {
  const hadProfiles =
    Array.isArray(cfg.txt2imgProfiles) && cfg.txt2imgProfiles.length > 0;
  cfg.txt2imgProfiles = normalizeTxt2ImgProfiles(
    hadProfiles ? cfg.txt2imgProfiles : undefined,
    cfg.txt2img,
  );
  cfg.activeTxt2ImgProfileId = resolveActiveProfileId(
    hadProfiles ? cfg.activeTxt2ImgProfileId : LEGACY_DEFAULT_PROFILE_ID,
    cfg.txt2imgProfiles,
  );
}

export function applyActiveChatProfileToConfig(cfg: AIConfig): void {
  migrateChatProfilesInConfig(cfg);
  const hit = cfg.chatProfiles.find((p) => p.id === cfg.activeChatProfileId);
  if (hit) {
    cfg.chat = normalizeChatEndpoint(hit.chat);
  }
}

/** 读取当前活跃对话方案端点（优先 chatProfiles，避免 cfg.chat 与方案列表不同步） */
export function readActiveChatEndpoint(cfg: AIConfig): AIChatEndpoint {
  const profiles = normalizeChatProfiles(cfg.chatProfiles, cfg.chat);
  const activeId =
    typeof cfg.activeChatProfileId === "string"
      ? cfg.activeChatProfileId.trim()
      : "";
  const hit =
    (activeId ? profiles.find((p) => p.id === activeId) : undefined) ??
    profiles[0];
  if (hit) return normalizeChatEndpoint(hit.chat);
  return normalizeChatEndpoint(cfg.chat);
}

export function applyActiveTxt2ImgProfileToConfig(cfg: AIConfig): void {
  migrateTxt2ImgProfilesInConfig(cfg);
  const hit = cfg.txt2imgProfiles.find(
    (p) => p.id === cfg.activeTxt2ImgProfileId,
  );
  if (hit) {
    cfg.txt2img = normalizeTxt2ImgConfig(hit.txt2img);
  }
}

/** 读取当前活跃文生图方案配置（优先 txt2imgProfiles，避免 cfg.txt2img 与方案列表不同步） */
export function readActiveTxt2ImgConfig(cfg: AIConfig): AITxt2ImgConfig {
  const profiles = normalizeTxt2ImgProfiles(cfg.txt2imgProfiles, cfg.txt2img);
  const activeId =
    typeof cfg.activeTxt2ImgProfileId === "string"
      ? cfg.activeTxt2ImgProfileId.trim()
      : "";
  const hit =
    (activeId ? profiles.find((p) => p.id === activeId) : undefined) ??
    profiles[0];
  if (hit) return normalizeTxt2ImgConfig(hit.txt2img);
  return normalizeTxt2ImgConfig(cfg.txt2img);
}

export function applyAllActiveProfilesToConfig(cfg: AIConfig): void {
  applyActiveChatProfileToConfig(cfg);
  applyActiveTxt2ImgProfileToConfig(cfg);
}

export function ensureAiConfigProfiles(cfg: AIConfig): AIConfig {
  const next = structuredClone(cfg);
  migrateChatProfilesInConfig(next);
  migrateTxt2ImgProfilesInConfig(next);
  applyAllActiveProfilesToConfig(next);
  return next;
}

export function stripProfileApiKeysForDisk(cfg: AIConfig): void {
  for (const p of cfg.chatProfiles) {
    p.chat.apiKey = "";
  }
  for (const p of cfg.txt2imgProfiles) {
    p.txt2img.apiKey = "";
  }
}

export function collectChatProfileApiKeys(
  profiles: AiChatProfile[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of profiles) {
    const k = p.chat.apiKey.trim();
    if (k) out[p.id] = k;
  }
  return out;
}

export function collectTxt2ImgProfileApiKeys(
  profiles: AiTxt2ImgProfile[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of profiles) {
    const k = p.txt2img.apiKey.trim();
    if (k) out[p.id] = k;
  }
  return out;
}

export function parseProfileKeysBlob(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k !== "string" || typeof v !== "string") continue;
      const id = k.trim().slice(0, 64);
      if (!id) continue;
      out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeProfileKeysBlob(
  map: Record<string, string>,
): string {
  const out: Record<string, string> = {};
  for (const [id, key] of Object.entries(map)) {
    const k = key.trim();
    if (k) out[id] = k;
  }
  return JSON.stringify(out);
}

export function hydrateChatProfilesApiKeys(
  profiles: AiChatProfile[],
  keys: Record<string, string>,
): void {
  for (const p of profiles) {
    const vault = keys[p.id];
    if (vault) {
      p.chat.apiKey = vault;
    } else if (p.chat.apiKey.trim()) {
      keys[p.id] = p.chat.apiKey.trim();
    }
  }
}

export function hydrateTxt2ImgProfilesApiKeys(
  profiles: AiTxt2ImgProfile[],
  keys: Record<string, string>,
): void {
  for (const p of profiles) {
    const vault = keys[p.id];
    if (vault) {
      p.txt2img.apiKey = vault;
    } else if (p.txt2img.apiKey.trim()) {
      keys[p.id] = p.txt2img.apiKey.trim();
    }
  }
}

/**
 * 升级合并配置后 profile id 变化时，将保险库中无主（孤儿）密钥挂回活跃方案。
 * 不挪动仍属于其它现存方案的密钥。
 */
export function reconcileOrphanProfileKeys(
  profiles: Array<{ id: string }>,
  activeProfileId: string,
  keys: Record<string, string>,
): boolean {
  const activeId = activeProfileId.trim();
  if (!activeId || keys[activeId]?.trim()) return false;

  const profileIds = new Set(profiles.map((p) => p.id));
  const orphans = Object.entries(keys).filter(
    ([id, key]) => key.trim() && !profileIds.has(id),
  );
  if (orphans.length === 0) return false;

  const chosen =
    orphans.length === 1
      ? orphans[0]![1].trim()
      : (
          orphans.find(([id]) => id === LEGACY_DEFAULT_PROFILE_ID) ?? orphans[0]
        )![1].trim();
  keys[activeId] = chosen;
  return true;
}

/** 保存时合并保险库既有映射：更新当前方案，保留未匹配 id 的孤儿密钥 */
export function mergeProfileKeyMapsForSave(
  profiles: Array<{ id: string }>,
  collected: Record<string, string>,
  existingVault: Record<string, string>,
): Record<string, string> {
  const profileIds = new Set(profiles.map((p) => p.id));
  const out: Record<string, string> = {};

  for (const [id, key] of Object.entries(existingVault)) {
    const k = key.trim();
    if (k && !profileIds.has(id)) out[id] = k;
  }
  for (const [id, key] of Object.entries(collected)) {
    const k = key.trim();
    if (k) out[id] = k;
  }
  return out;
}

export function defaultChatProfileResetEndpoint(): AIChatEndpoint {
  const chat = structuredClone(defaultAIConfig.chat);
  chat.tokenPricePerMillion = { ...EMPTY_TOKEN_PRICE_PER_MILLION };
  return chat;
}

export function defaultTxt2ImgProfileResetConfig(): AITxt2ImgConfig {
  return structuredClone(defaultTxt2ImgConfig);
}
