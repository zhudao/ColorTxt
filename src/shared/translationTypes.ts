/** 选区翻译相关跨进程类型 */

export type TranslationProviderId =
  | "microsoft"
  | "google"
  | "yandex"
  | "deepl"
  | "ai"
  | "baidu"
  | "youdao"
  | "tencent"
  | "volcengine"
  | "aliyun";

export const TRANSLATION_PROVIDER_IDS: readonly TranslationProviderId[] = [
  "ai",
  "microsoft",
  "google",
  "yandex",
  "deepl",
  "baidu",
  "youdao",
  "tencent",
  "volcengine",
  "aliyun",
] as const;

export const TRANSLATION_PROVIDER_LABELS: Record<TranslationProviderId, string> =
  {
    microsoft: "微软翻译",
    google: "Google 翻译",
    yandex: "Yandex 翻译",
    deepl: "DeepL",
    ai: "AI 翻译",
    baidu: "百度翻译",
    youdao: "有道翻译",
    tencent: "腾讯翻译",
    volcengine: "火山翻译",
    aliyun: "阿里翻译",
  };

/** 下拉第二行说明（对齐语音朗读服务商） */
export const TRANSLATION_PROVIDER_DESCRIPTIONS: Record<
  TranslationProviderId,
  string
> = {
  microsoft: "Edge 免费通道，无需配置",
  google: "免费网页接口，无需配置",
  yandex: "免费通道，无需配置",
  deepl: "官方 API / DeepLX，需要 API Key",
  ai: "OpenAI 兼容接口，需自行配置服务商与模型",
  baidu: "官方开放平台，需要 APP ID 与密钥",
  youdao: "官方开放平台，需要应用 ID 与密钥",
  tencent: "腾讯云机器翻译，需要 SecretId / SecretKey",
  volcengine: "火山引擎机器翻译，需要 Access Key",
  aliyun: "阿里云机器翻译，需要 AccessKey",
};

/** Readest TRANSLATOR_LANGS ∪ ReadAny ug */
export const TRANSLATION_TARGET_LANGS: { code: string; label: string }[] = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  // { code: "fr", label: "Français" },
  // { code: "de", label: "Deutsch" },
  // { code: "es", label: "Español" },
  // { code: "pt", label: "Português" },
  // { code: "pt-BR", label: "Português (Brasil)" },
  // { code: "it", label: "Italiano" },
  // { code: "ru", label: "Русский" },
  // { code: "uk", label: "Українська" },
  // { code: "ar", label: "العربية" },
  // { code: "he", label: "עברית" },
  // { code: "fa", label: "فارسی" },
  // { code: "ur", label: "اردو" },
  // { code: "hi", label: "हिन्दी" },
  // { code: "bn", label: "বাংলা" },
  // { code: "ta", label: "தமிழ்" },
  // { code: "si", label: "සිංහල" },
  // { code: "th", label: "ภาษาไทย" },
  // { code: "vi", label: "Tiếng Việt" },
  // { code: "id", label: "Indonesia" },
  // { code: "ms", label: "Melayu" },
  // { code: "tr", label: "Türkçe" },
  // { code: "pl", label: "Polski" },
  // { code: "nl", label: "Nederlands" },
  // { code: "sv", label: "Svenska" },
  // { code: "nb", label: "Bokmål" },
  // { code: "da", label: "Dansk" },
  // { code: "fi", label: "Suomi" },
  // { code: "cs", label: "Čeština" },
  // { code: "sk", label: "Slovenčina" },
  // { code: "sl", label: "Slovenščina" },
  // { code: "hr", label: "Hrvatski" },
  // { code: "bg", label: "Български" },
  // { code: "ro", label: "Română" },
  // { code: "hu", label: "Magyar" },
  // { code: "el", label: "Ελληνικά" },
  // { code: "lt", label: "Lietuvių" },
  // { code: "uz", label: "Oʻzbek" },
  // { code: "km", label: "ខ្មែរ" },
  // { code: "bo", label: "བོད་སྐད་" },
  // { code: "ug", label: "ئۇيغۇرچە" },
];

export type TranslationSettings = {
  provider: TranslationProviderId;
  targetLang: string;
  showOriginal: boolean;
  deeplApiKey: string;
  deeplBaseUrl: string;
  /** AI 翻译多套配置方案 */
  aiProfiles: import("./translationAiProfiles").TranslationAiProfile[];
  /** 当前活跃 AI 翻译方案 id */
  activeAiProfileId: string;
  /**
   * 当前方案的表单镜像（与 activeAiProfile 同步；翻译请求可直接读这些项）
   */
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  /** 当前方案 max_tokens 镜像 */
  aiMaxTokens: number;
  /** 是否在翻译浮层显示 Token 消耗条 */
  aiShowTokenUsage: boolean;
  /** 当前方案 Token 单价镜像 */
  aiTokenPricePerMillion: import("./aiTypes").AITokenPricePerMillion;
  baiduAppId: string;
  baiduSecret: string;
  youdaoAppKey: string;
  youdaoAppSecret: string;
  tencentSecretId: string;
  tencentSecretKey: string;
  tencentRegion: string;
  volcAccessKeyId: string;
  volcSecretKey: string;
  volcRegion: string;
  aliyunAccessKeyId: string;
  aliyunAccessKeySecret: string;
};

/** 需进保险库的扁平字段（签名用标识 + 密钥；AI 方案密钥见 aiProfileKeys） */
export const TRANSLATION_SECRET_FIELD_KEYS = [
  "deeplApiKey",
  "baiduAppId",
  "baiduSecret",
  "youdaoAppKey",
  "youdaoAppSecret",
  "tencentSecretId",
  "tencentSecretKey",
  "volcAccessKeyId",
  "volcSecretKey",
  "aliyunAccessKeyId",
  "aliyunAccessKeySecret",
] as const;

export type TranslationSecretFieldKey =
  (typeof TRANSLATION_SECRET_FIELD_KEYS)[number];

export type TranslationProviderSecrets = Partial<
  Record<TranslationSecretFieldKey, string>
> & {
  /** AI 翻译各方案密钥：profileId → apiKey */
  aiProfileKeys?: Record<string, string>;
};

export type TranslationRequest = {
  text: string;
  settings: TranslationSettings;
  /** 可选：源语言；空则自动检测 */
  sourceLang?: string;
};

export type TranslationResponse =
  | {
      ok: true;
      translated: string;
      provider: TranslationProviderId;
      /** 仅 AI 翻译：本次（含分段合计）token 用量 */
      tokenUsage?: import("./aiTokenUsage").AITokenUsageTotals;
      tokenUsageAvailable?: boolean;
    }
  | { ok: false; message: string };

export const TRANSLATION_IPC = {
  translate: "translate:translate",
} as const;
