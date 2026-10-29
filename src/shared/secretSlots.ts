/** 主进程密钥保险库 slot 名（勿在 config / localStorage 明文持久化） */

export const SECRET_SLOT_AI_EMBEDDING_API_KEY = "ai.embedding.apiKey";
/** 对话模型配置方案 API 密钥映射（JSON：profileId → apiKey） */
export const SECRET_SLOT_AI_CHAT_PROFILE_KEYS = "ai.chatProfileKeys";
/** 文生图配置方案 API 密钥映射（JSON：profileId → apiKey） */
export const SECRET_SLOT_AI_TXT2IMG_PROFILE_KEYS = "ai.txt2imgProfileKeys";
/** 语音朗读配置方案密钥映射（JSON：profileId → 各 Provider API Key） */
export const SECRET_SLOT_VOICE_READ_PROFILE_KEYS = "voiceRead.profileKeys";
/** WebDAV 密码 */
export const SECRET_SLOT_WEBDAV_PASSWORD = "webdav.password";
/** 翻译服务凭证（JSON：TranslationProviderSecrets） */
export const SECRET_SLOT_TRANSLATION_PROVIDER_KEYS = "translation.providerKeys";

/** 已废弃：仅启动迁移时读取一次，写入后从磁盘清除 */
export const DEPRECATED_SECRET_SLOT_AI_CHAT_API_KEY = "ai.chat.apiKey";
export const DEPRECATED_SECRET_SLOT_AI_TXT2IMG_API_KEY = "ai.txt2img.apiKey";
export const DEPRECATED_SECRET_SLOT_VOICE_READ_DASHSCOPE_API_KEY =
  "voiceRead.dashscopeApiKey";

export const DEPRECATED_SECRET_SLOTS = [
  DEPRECATED_SECRET_SLOT_AI_CHAT_API_KEY,
  DEPRECATED_SECRET_SLOT_AI_TXT2IMG_API_KEY,
  DEPRECATED_SECRET_SLOT_VOICE_READ_DASHSCOPE_API_KEY,
] as const;

export type DeprecatedSecretSlotId = (typeof DEPRECATED_SECRET_SLOTS)[number];

export type SecretSlotId =
  | typeof SECRET_SLOT_AI_EMBEDDING_API_KEY
  | typeof SECRET_SLOT_AI_CHAT_PROFILE_KEYS
  | typeof SECRET_SLOT_AI_TXT2IMG_PROFILE_KEYS
  | typeof SECRET_SLOT_VOICE_READ_PROFILE_KEYS
  | typeof SECRET_SLOT_WEBDAV_PASSWORD
  | typeof SECRET_SLOT_TRANSLATION_PROVIDER_KEYS;

export const ALL_SECRET_SLOT_IDS: readonly SecretSlotId[] = [
  SECRET_SLOT_AI_EMBEDDING_API_KEY,
  SECRET_SLOT_AI_CHAT_PROFILE_KEYS,
  SECRET_SLOT_AI_TXT2IMG_PROFILE_KEYS,
  SECRET_SLOT_VOICE_READ_PROFILE_KEYS,
  SECRET_SLOT_WEBDAV_PASSWORD,
  SECRET_SLOT_TRANSLATION_PROVIDER_KEYS,
];

export function isDeprecatedSecretSlot(
  slot: string,
): slot is DeprecatedSecretSlotId {
  return (DEPRECATED_SECRET_SLOTS as readonly string[]).includes(slot);
}
