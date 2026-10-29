/** AI 翻译多套配置方案（与对话 / 语音方案模式对齐） */

import {
  CHAT_API_PROVIDER_CUSTOM_PRESET,
  findChatProviderPresetByBaseUrl,
  normalizeChatPresetBaseUrl,
} from "./apiEndpointPresets";
import { parseProfileKeysBlob, serializeProfileKeysBlob } from "./aiEndpointProfiles";
import {
  EMPTY_TOKEN_PRICE_PER_MILLION,
  normalizeTokenPricePerMillion,
  type AITokenPricePerMillion,
} from "./aiTypes";

export { parseProfileKeysBlob, serializeProfileKeysBlob };

export const MAX_TRANSLATION_AI_PROFILES = 12;

/** AI 翻译单次回复 max_tokens 默认（长选区译文需要更大输出） */
export const DEFAULT_TRANSLATION_AI_MAX_TOKENS = 8192;
export const TRANSLATION_AI_MAX_TOKENS_MIN = 256;
export const TRANSLATION_AI_MAX_TOKENS_MAX = 128000;

export type TranslationAiEndpoint = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 单次翻译回复最大 token 数 */
  maxTokens: number;
  /** 每百万 Token 单价（用于消耗条估算花费） */
  tokenPricePerMillion: AITokenPricePerMillion;
};

export type TranslationAiProfile = {
  id: string;
  name: string;
  endpoint: TranslationAiEndpoint;
  updatedAt?: number;
};

export const emptyTranslationAiEndpoint: TranslationAiEndpoint = {
  baseUrl: "",
  apiKey: "",
  model: "",
  maxTokens: DEFAULT_TRANSLATION_AI_MAX_TOKENS,
  tokenPricePerMillion: { ...EMPTY_TOKEN_PRICE_PER_MILLION },
};

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function normalizeProfileName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 80);
}

function normalizeProfileId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 64);
}

export function normalizeTranslationAiMaxTokens(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : DEFAULT_TRANSLATION_AI_MAX_TOKENS;
  if (!Number.isFinite(n)) return DEFAULT_TRANSLATION_AI_MAX_TOKENS;
  return Math.min(
    TRANSLATION_AI_MAX_TOKENS_MAX,
    Math.max(TRANSLATION_AI_MAX_TOKENS_MIN, Math.round(n)),
  );
}

export function normalizeTranslationAiEndpoint(
  raw: Partial<TranslationAiEndpoint> | null | undefined,
): TranslationAiEndpoint {
  let baseUrl = str(raw?.baseUrl).trim();
  if (baseUrl) baseUrl = normalizeChatPresetBaseUrl(baseUrl);
  const model = str(raw?.model).trim();
  return {
    baseUrl,
    apiKey: str(raw?.apiKey),
    model: model.length > 200 ? model.slice(0, 200) : model,
    maxTokens: normalizeTranslationAiMaxTokens(raw?.maxTokens),
    tokenPricePerMillion: normalizeTokenPricePerMillion(
      raw?.tokenPricePerMillion,
    ),
  };
}

/** 方案未命名时，下拉 placeholder / 列表回退文案 */
export function resolveTranslationAiProfileProviderLabel(
  endpoint: TranslationAiEndpoint,
): string {
  const hit = findChatProviderPresetByBaseUrl(endpoint.baseUrl);
  if (hit) return hit.label;
  if (endpoint.baseUrl.trim()) return CHAT_API_PROVIDER_CUSTOM_PRESET.label;
  return "";
}

export function createTranslationAiProfile(opts?: {
  id?: string;
  name?: string;
  endpoint?: Partial<TranslationAiEndpoint>;
}): TranslationAiProfile {
  return {
    id: opts?.id?.trim() || crypto.randomUUID(),
    name: normalizeProfileName(opts?.name),
    endpoint: normalizeTranslationAiEndpoint(opts?.endpoint),
    updatedAt: Date.now(),
  };
}

export function normalizeTranslationAiProfile(
  raw: unknown,
): TranslationAiProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = normalizeProfileId(o.id);
  if (!id) return null;
  const endpointRaw =
    o.endpoint && typeof o.endpoint === "object"
      ? (o.endpoint as Partial<TranslationAiEndpoint>)
      : {
          baseUrl: str(o.baseUrl),
          apiKey: str(o.apiKey),
          model: str(o.model),
        };
  return {
    id,
    name: normalizeProfileName(o.name),
    endpoint: normalizeTranslationAiEndpoint(endpointRaw),
    updatedAt:
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : undefined,
  };
}

export function normalizeTranslationAiProfiles(
  raw: unknown,
): TranslationAiProfile[] {
  const out: TranslationAiProfile[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const p = normalizeTranslationAiProfile(item);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
      if (out.length >= MAX_TRANSLATION_AI_PROFILES) break;
    }
  }
  if (out.length > 0) return out;
  return [createTranslationAiProfile({ name: "" })];
}

export function resolveActiveTranslationAiProfileId(
  activeId: string,
  profiles: TranslationAiProfile[],
): string {
  const id = activeId.trim();
  if (id && profiles.some((p) => p.id === id)) return id;
  return profiles[0]?.id ?? "";
}

export function getActiveTranslationAiEndpoint(
  profiles: TranslationAiProfile[],
  activeId: string,
): TranslationAiEndpoint {
  const id = resolveActiveTranslationAiProfileId(activeId, profiles);
  const hit = profiles.find((p) => p.id === id) ?? profiles[0];
  return hit
    ? normalizeTranslationAiEndpoint(hit.endpoint)
    : { ...emptyTranslationAiEndpoint };
}

export function collectTranslationAiProfileApiKeys(
  profiles: TranslationAiProfile[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of profiles) {
    const k = p.endpoint.apiKey.trim();
    if (k) out[p.id] = k;
  }
  return out;
}

export function hydrateTranslationAiProfilesApiKeys(
  profiles: TranslationAiProfile[],
  keys: Record<string, string> | null | undefined,
): void {
  if (!keys) return;
  for (const p of profiles) {
    const vault = keys[p.id];
    if (typeof vault === "string" && vault.trim()) {
      p.endpoint.apiKey = vault;
    }
  }
}

export function stripTranslationAiProfilesApiKeys(
  profiles: TranslationAiProfile[],
): TranslationAiProfile[] {
  return profiles.map((p) => ({
    ...p,
    endpoint: { ...p.endpoint, apiKey: "" },
  }));
}
