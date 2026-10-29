import {
  TRANSLATION_PROVIDER_IDS,
  TRANSLATION_SECRET_FIELD_KEYS,
  TRANSLATION_TARGET_LANGS,
  type TranslationProviderId,
  type TranslationProviderSecrets,
  type TranslationSettings,
} from "@shared/translationTypes";
import {
  EMPTY_TOKEN_PRICE_PER_MILLION,
  normalizeTokenPricePerMillion,
} from "@shared/aiTypes";
import {
  collectTranslationAiProfileApiKeys,
  createTranslationAiProfile,
  getActiveTranslationAiEndpoint,
  hydrateTranslationAiProfilesApiKeys,
  normalizeTranslationAiEndpoint,
  normalizeTranslationAiMaxTokens,
  normalizeTranslationAiProfiles,
  resolveActiveTranslationAiProfileId,
  resolveTranslationAiProfileProviderLabel,
  stripTranslationAiProfilesApiKeys,
  type TranslationAiEndpoint,
  type TranslationAiProfile,
  MAX_TRANSLATION_AI_PROFILES,
  DEFAULT_TRANSLATION_AI_MAX_TOKENS,
  TRANSLATION_AI_MAX_TOKENS_MIN,
  TRANSLATION_AI_MAX_TOKENS_MAX,
} from "@shared/translationAiProfiles";

export {
  MAX_TRANSLATION_AI_PROFILES,
  DEFAULT_TRANSLATION_AI_MAX_TOKENS,
  TRANSLATION_AI_MAX_TOKENS_MIN,
  TRANSLATION_AI_MAX_TOKENS_MAX,
  createTranslationAiProfile,
  resolveTranslationAiProfileProviderLabel,
  type TranslationAiEndpoint,
  type TranslationAiProfile,
};

export const defaultTranslationSettings: TranslationSettings = (() => {
  const profile = createTranslationAiProfile({
    id: "profile-default",
    name: "",
  });
  return {
    provider: "microsoft",
    targetLang: "zh-CN",
    showOriginal: true,
    deeplApiKey: "",
    deeplBaseUrl: "",
    aiProfiles: [profile],
    activeAiProfileId: profile.id,
    aiBaseUrl: "",
    aiApiKey: "",
    aiModel: "",
    aiMaxTokens: DEFAULT_TRANSLATION_AI_MAX_TOKENS,
    aiShowTokenUsage: true,
    aiTokenPricePerMillion: { ...EMPTY_TOKEN_PRICE_PER_MILLION },
    baiduAppId: "",
    baiduSecret: "",
    youdaoAppKey: "",
    youdaoAppSecret: "",
    tencentSecretId: "",
    tencentSecretKey: "",
    tencentRegion: "ap-guangzhou",
    volcAccessKeyId: "",
    volcSecretKey: "",
    volcRegion: "cn-north-1",
    aliyunAccessKeyId: "",
    aliyunAccessKeySecret: "",
  };
})();

const knownTargetLangs = new Set(TRANSLATION_TARGET_LANGS.map((x) => x.code));

function isProviderId(v: unknown): v is TranslationProviderId {
  return (
    typeof v === "string" &&
    (TRANSLATION_PROVIDER_IDS as readonly string[]).includes(v)
  );
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** 将当前扁平 AI 字段写回活跃方案 */
export function syncFlatAiIntoActiveProfile(
  settings: TranslationSettings,
): TranslationSettings {
  const profiles = settings.aiProfiles.map((p) => ({
    ...p,
    endpoint: {
      ...p.endpoint,
      tokenPricePerMillion: { ...p.endpoint.tokenPricePerMillion },
    },
  }));
  const activeId = resolveActiveTranslationAiProfileId(
    settings.activeAiProfileId,
    profiles,
  );
  const idx = profiles.findIndex((p) => p.id === activeId);
  if (idx < 0) {
    return {
      ...settings,
      aiProfiles: profiles,
      activeAiProfileId: activeId,
    };
  }
  profiles[idx] = {
    ...profiles[idx]!,
    endpoint: normalizeTranslationAiEndpoint({
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      maxTokens: settings.aiMaxTokens,
      tokenPricePerMillion: settings.aiTokenPricePerMillion,
    }),
    updatedAt: Date.now(),
  };
  return {
    ...settings,
    aiProfiles: profiles,
    activeAiProfileId: activeId,
  };
}

/** 用活跃方案覆盖扁平 AI 字段 */
export function applyActiveAiProfileToFlat(
  settings: TranslationSettings,
): TranslationSettings {
  const profiles = settings.aiProfiles;
  const activeId = resolveActiveTranslationAiProfileId(
    settings.activeAiProfileId,
    profiles,
  );
  const ep = getActiveTranslationAiEndpoint(profiles, activeId);
  return {
    ...settings,
    activeAiProfileId: activeId,
    aiBaseUrl: ep.baseUrl,
    aiApiKey: ep.apiKey,
    aiModel: ep.model,
    aiMaxTokens: ep.maxTokens,
    aiTokenPricePerMillion: { ...ep.tokenPricePerMillion },
  };
}

export function selectTranslationAiProfile(
  settings: TranslationSettings,
  profileId: string,
): TranslationSettings {
  const synced = syncFlatAiIntoActiveProfile(mergeTranslationSettings(settings));
  return applyActiveAiProfileToFlat({
    ...synced,
    activeAiProfileId: profileId,
  });
}

export function mergeTranslationSettings(
  partial: Partial<TranslationSettings> | null | undefined,
): TranslationSettings {
  const targetLang = str(partial?.targetLang, defaultTranslationSettings.targetLang);
  const flatAi = {
    baseUrl: str(partial?.aiBaseUrl),
    apiKey: str(partial?.aiApiKey),
    model: str(partial?.aiModel),
    maxTokens: normalizeTranslationAiMaxTokens(
      partial?.aiMaxTokens ?? DEFAULT_TRANSLATION_AI_MAX_TOKENS,
    ),
    tokenPricePerMillion: normalizeTokenPricePerMillion(
      partial?.aiTokenPricePerMillion,
    ),
  };
  const aiProfiles = normalizeTranslationAiProfiles(partial?.aiProfiles);
  const activeAiProfileId = resolveActiveTranslationAiProfileId(
    str(partial?.activeAiProfileId),
    aiProfiles,
  );
  const base: TranslationSettings = {
    provider: isProviderId(partial?.provider)
      ? partial.provider
      : defaultTranslationSettings.provider,
    targetLang: knownTargetLangs.has(targetLang)
      ? targetLang
      : defaultTranslationSettings.targetLang,
    showOriginal:
      typeof partial?.showOriginal === "boolean"
        ? partial.showOriginal
        : defaultTranslationSettings.showOriginal,
    deeplApiKey: str(partial?.deeplApiKey),
    deeplBaseUrl: str(partial?.deeplBaseUrl),
    aiProfiles,
    activeAiProfileId,
    aiBaseUrl: flatAi.baseUrl,
    aiApiKey: flatAi.apiKey,
    aiModel: flatAi.model,
    aiMaxTokens: flatAi.maxTokens,
    aiShowTokenUsage:
      typeof partial?.aiShowTokenUsage === "boolean"
        ? partial.aiShowTokenUsage
        : defaultTranslationSettings.aiShowTokenUsage,
    aiTokenPricePerMillion: flatAi.tokenPricePerMillion,
    baiduAppId: str(partial?.baiduAppId),
    baiduSecret: str(partial?.baiduSecret),
    youdaoAppKey: str(partial?.youdaoAppKey),
    youdaoAppSecret: str(partial?.youdaoAppSecret),
    tencentSecretId: str(partial?.tencentSecretId),
    tencentSecretKey: str(partial?.tencentSecretKey),
    tencentRegion:
      str(partial?.tencentRegion).trim() ||
      defaultTranslationSettings.tencentRegion,
    volcAccessKeyId: str(partial?.volcAccessKeyId),
    volcSecretKey: str(partial?.volcSecretKey),
    volcRegion:
      str(partial?.volcRegion).trim() || defaultTranslationSettings.volcRegion,
    aliyunAccessKeyId: str(partial?.aliyunAccessKeyId),
    aliyunAccessKeySecret: str(partial?.aliyunAccessKeySecret),
  };

  // 表单镜像有值时写回活跃方案，再同步扁平字段
  const hasFlatMirror =
    Boolean(flatAi.baseUrl.trim()) ||
    Boolean(flatAi.apiKey.trim()) ||
    Boolean(flatAi.model.trim()) ||
    partial?.aiMaxTokens != null ||
    partial?.aiTokenPricePerMillion != null;
  if (hasFlatMirror) {
    return applyActiveAiProfileToFlat(syncFlatAiIntoActiveProfile(base));
  }
  return applyActiveAiProfileToFlat(base);
}

/** localStorage 落盘：剥掉翻译凭证明文 */
export function stripTranslationSecretsForDisk(
  settings: TranslationSettings,
): TranslationSettings {
  const next = { ...settings };
  for (const k of TRANSLATION_SECRET_FIELD_KEYS) {
    next[k] = "";
  }
  next.aiApiKey = "";
  next.aiProfiles = stripTranslationAiProfilesApiKeys(next.aiProfiles);
  return next;
}

export function collectTranslationSecrets(
  settings: TranslationSettings,
): TranslationProviderSecrets {
  const synced = syncFlatAiIntoActiveProfile(mergeTranslationSettings(settings));
  const out: TranslationProviderSecrets = {};
  for (const k of TRANSLATION_SECRET_FIELD_KEYS) {
    const v = synced[k]?.trim();
    if (v) out[k] = v;
  }
  const aiProfileKeys = collectTranslationAiProfileApiKeys(synced.aiProfiles);
  if (Object.keys(aiProfileKeys).length) out.aiProfileKeys = aiProfileKeys;
  return out;
}

export function applyTranslationSecrets(
  settings: TranslationSettings,
  secrets: TranslationProviderSecrets | null | undefined,
): TranslationSettings {
  if (!secrets || typeof secrets !== "object") {
    return mergeTranslationSettings(settings);
  }
  const next = mergeTranslationSettings(settings);
  for (const k of TRANSLATION_SECRET_FIELD_KEYS) {
    const v = secrets[k];
    if (typeof v === "string" && v.trim()) next[k] = v;
  }

  const profileKeys =
    secrets.aiProfileKeys && typeof secrets.aiProfileKeys === "object"
      ? secrets.aiProfileKeys
      : {};
  hydrateTranslationAiProfilesApiKeys(next.aiProfiles, profileKeys);

  return applyActiveAiProfileToFlat(next);
}

export function parseTranslationSecretsBlob(
  raw: string,
): TranslationProviderSecrets {
  const t = raw.trim();
  if (!t) return {};
  try {
    const o = JSON.parse(t) as unknown;
    if (!o || typeof o !== "object") return {};
    const src = o as Record<string, unknown>;
    const out: TranslationProviderSecrets = {};
    for (const k of TRANSLATION_SECRET_FIELD_KEYS) {
      const v = src[k];
      if (typeof v === "string" && v.trim()) out[k] = v;
    }
    if (src.aiProfileKeys && typeof src.aiProfileKeys === "object") {
      const fromObj: Record<string, string> = {};
      for (const [id, v] of Object.entries(
        src.aiProfileKeys as Record<string, unknown>,
      )) {
        const pid = id.trim().slice(0, 64);
        if (pid && typeof v === "string" && v.trim()) fromObj[pid] = v;
      }
      if (Object.keys(fromObj).length) out.aiProfileKeys = fromObj;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeTranslationSecrets(
  secrets: TranslationProviderSecrets,
): string {
  const clean: TranslationProviderSecrets = {};
  for (const k of TRANSLATION_SECRET_FIELD_KEYS) {
    const v = secrets[k]?.trim();
    if (v) clean[k] = v;
  }
  if (secrets.aiProfileKeys && typeof secrets.aiProfileKeys === "object") {
    const map: Record<string, string> = {};
    for (const [id, key] of Object.entries(secrets.aiProfileKeys)) {
      const k = key?.trim();
      if (k) map[id] = k;
    }
    if (Object.keys(map).length) clean.aiProfileKeys = map;
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : "";
}

/**
 * 计算写入保险库的 payload。
 * 返回 `null` 表示应跳过写入：当前收集结果为空，且保险库也解不出任何密钥
 * （常见于开发版 / 发布版 Electron safeStorage 互不解），此时空写会误删密文。
 * 返回 `{ providerKeys: "" }` 表示用户确已清空（保险库仍能解密出旧值），应删除 slot。
 */
export async function resolveTranslationSecretsWritePayload(
  settings: TranslationSettings,
  readVaultKeys: () => Promise<string>,
): Promise<{ providerKeys: string } | null> {
  const serialized = serializeTranslationSecrets(
    collectTranslationSecrets(settings),
  );
  if (serialized) return { providerKeys: serialized };
  let existingRaw = "";
  try {
    existingRaw = await readVaultKeys();
  } catch {
    return null;
  }
  const existing = parseTranslationSecretsBlob(existingRaw);
  if (!serializeTranslationSecrets(existing)) return null;
  return { providerKeys: "" };
}
