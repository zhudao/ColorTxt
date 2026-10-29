/** 豆包语音合成 2.0 `audio_params` / `additions.post_process`：采样率、语速、音调 */

export const VOLCENGINE_TTS_SAMPLE_RATES = [
  8000, 16000, 22050, 24000, 32000, 44100, 48000,
] as const;

export type VolcengineTtsSampleRate = (typeof VOLCENGINE_TTS_SAMPLE_RATES)[number];

export const DEFAULT_VOLCENGINE_TTS_SAMPLE_RATE: VolcengineTtsSampleRate = 24000;

const SAMPLE_RATE_SET = new Set<number>(VOLCENGINE_TTS_SAMPLE_RATES);

export function isVolcengineTtsSampleRate(
  raw: unknown,
): raw is VolcengineTtsSampleRate {
  return typeof raw === "number" && SAMPLE_RATE_SET.has(raw);
}

export function normalizeVolcengineTtsSampleRate(
  raw: unknown,
): VolcengineTtsSampleRate {
  if (isVolcengineTtsSampleRate(raw)) return raw;
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    if (isVolcengineTtsSampleRate(parsed)) return parsed;
  }
  return DEFAULT_VOLCENGINE_TTS_SAMPLE_RATE;
}

export function formatVolcengineTtsSampleRateLabel(
  rate: VolcengineTtsSampleRate,
): string {
  const khz =
    rate % 1000 === 0
      ? String(rate / 1000)
      : (rate / 1000).toFixed(2).replace(/\.?0+$/, "");
  const label = `${khz} kHz`;
  return rate === DEFAULT_VOLCENGINE_TTS_SAMPLE_RATE
    ? `${label}（默认）`
    : label;
}

/**
 * 应用语速 0.5–2.0 → `audio_params.speech_rate` [-50, 100]
 *（0.5x → -50，1.0 → 0，2.0 → 100）。
 */
export function volcengineSpeechRateFromPlaybackRate(rate: number): number {
  const clamped = Math.max(0.5, Math.min(2, Number.isFinite(rate) ? rate : 1));
  return Math.round((clamped - 1) * 100);
}

/** 官方 `additions.post_process.pitch`：整数半音，0 为默认、不传 */
export const VOLCENGINE_PITCH_MIN = -12;
export const VOLCENGINE_PITCH_MAX = 12;
export const DEFAULT_VOLCENGINE_PITCH = 0;

export function normalizeVolcenginePitch(raw: unknown): number {
  let n: number | undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    n = raw;
  } else if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
    n = Number(raw.trim());
  }
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_VOLCENGINE_PITCH;
  return Math.max(
    VOLCENGINE_PITCH_MIN,
    Math.min(VOLCENGINE_PITCH_MAX, Math.round(n)),
  );
}

export function formatVolcenginePitchLabel(pitch: number): string {
  const n = normalizeVolcenginePitch(pitch);
  return n > 0 ? `+${n}` : String(n);
}

/** 不传 `explicit_language` 时官方为中英混 */
export const VOLCENGINE_MIXED_LANGUAGE_ID = "";

const LANGUAGE_API_BY_LABEL: Readonly<Record<string, string>> = {
  中文: VOLCENGINE_MIXED_LANGUAGE_ID,
  日文: "ja",
  日语: "ja",
  印尼: "id",
  印尼语: "id",
  墨西哥西班牙语: "es-mx",
  西班牙语: "es-mx",
  墨西哥西语: "es-mx",
  美式英语: "en",
  英式英语: "en",
  澳洲英语: "en",
  英文: "en",
  英语: "en",
  巴西葡萄牙语: "pt-br",
  葡萄牙语: "pt-br",
  韩语: "ko",
  法语: "fr",
  德语: "de",
  马来语: "ms",
  俄语: "ru",
  泰语: "th",
  菲律宾语: "fil",
  越南语: "vi",
  意大利语: "it",
  阿拉伯语: "ar",
};

const LANGUAGE_LABEL_BY_API: Readonly<Record<string, string>> = {
  ja: "日语",
  id: "印尼",
  "es-mx": "西班牙语",
  en: "英语",
  "pt-br": "葡萄牙语",
  "zh-cn": "中文",
  ko: "韩语",
  fr: "法语",
  de: "德语",
  ms: "马来语",
  ru: "俄语",
  th: "泰语",
  fil: "菲律宾语",
  vi: "越南语",
  it: "意大利语",
  ar: "阿拉伯语",
};

const DIALECT_API_BY_LABEL: Readonly<Record<string, string>> = {
  东北: "dongbei",
  陕西: "shaanxi",
  四川: "sichuan",
  北京: "beijing",
  河南: "henan",
  天津: "tianjin",
  上海: "shanghai",
  粤语: "yue",
};

const DIALECT_LABEL_BY_API: Readonly<Record<string, string>> = {
  dongbei: "东北",
  shaanxi: "陕西",
  sichuan: "四川",
  beijing: "北京",
  henan: "河南",
  tianjin: "天津",
  shanghai: "上海",
  yue: "粤语",
};

const LANGUAGE_API_SET = new Set([
  ...Object.values(LANGUAGE_API_BY_LABEL).filter(Boolean),
  "zh-cn",
]);

const DIALECT_API_SET = new Set(Object.values(DIALECT_API_BY_LABEL));

export function normalizeVolcengineExplicitLanguage(raw: unknown): string {
  if (typeof raw !== "string") return VOLCENGINE_MIXED_LANGUAGE_ID;
  const t = raw.trim().toLowerCase();
  if (!t) return VOLCENGINE_MIXED_LANGUAGE_ID;
  return LANGUAGE_API_SET.has(t) ? t : VOLCENGINE_MIXED_LANGUAGE_ID;
}

export function normalizeVolcengineExplicitDialect(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = raw.trim().toLowerCase();
  if (!t) return "";
  return DIALECT_API_SET.has(t) ? t : "";
}

export function formatVolcengineLanguageLabel(apiCode: string): string {
  if (!apiCode) return "中英混";
  return LANGUAGE_LABEL_BY_API[apiCode] ?? apiCode;
}

export function formatVolcengineDialectLabel(apiCode: string): string {
  if (!apiCode) return "默认";
  return DIALECT_LABEL_BY_API[apiCode] ?? apiCode;
}

export function volcengineLanguageApiCodeFromLabel(label: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_API_BY_LABEL, label)) {
    return LANGUAGE_API_BY_LABEL[label];
  }
  return undefined;
}

export function volcengineDialectApiCodeFromLabel(label: string): string | undefined {
  return DIALECT_API_BY_LABEL[label];
}

export type VolcengineSpeechModeOption = {
  id: string;
  label: string;
};

export function volcengineLanguageOptionsFromLabels(
  languages: readonly string[],
): VolcengineSpeechModeOption[] {
  const extras = new Map<string, string>();
  let hasChinese = false;
  for (const label of languages) {
    const code = volcengineLanguageApiCodeFromLabel(label);
    if (code === undefined) continue;
    if (!code) {
      hasChinese = true;
      continue;
    }
    if (!extras.has(code)) extras.set(code, formatVolcengineLanguageLabel(code));
  }
  if (hasChinese && extras.size > 0) {
    return [
      { id: VOLCENGINE_MIXED_LANGUAGE_ID, label: formatVolcengineLanguageLabel("") },
      ...[...extras].map(([id, label]) => ({ id, label })),
    ];
  }
  if (!hasChinese && extras.size > 1) {
    return [...extras].map(([id, label]) => ({ id, label }));
  }
  return [];
}

export function volcengineDialectOptionsFromLabels(
  dialects: readonly string[],
): VolcengineSpeechModeOption[] {
  const options: VolcengineSpeechModeOption[] = [];
  const seen = new Set<string>();
  for (const label of dialects) {
    const code = volcengineDialectApiCodeFromLabel(label);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    options.push({ id: code, label: formatVolcengineDialectLabel(code) });
  }
  if (options.length === 0) return [];
  return [
    { id: "", label: formatVolcengineDialectLabel("") },
    ...options,
  ];
}

export function mergeVolcengineLanguageOptions(
  languageLists: readonly (readonly string[])[],
): VolcengineSpeechModeOption[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of languageLists) {
    for (const label of list) {
      if (seen.has(label)) continue;
      seen.add(label);
      merged.push(label);
    }
  }
  return volcengineLanguageOptionsFromLabels(merged);
}

export function mergeVolcengineDialectOptions(
  dialectLists: readonly (readonly string[])[],
): VolcengineSpeechModeOption[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of dialectLists) {
    for (const label of list) {
      if (seen.has(label)) continue;
      seen.add(label);
      merged.push(label);
    }
  }
  return volcengineDialectOptionsFromLabels(merged);
}

export function resolveVolcengineSpeechMode(options: {
  voiceLanguages: readonly string[];
  voiceDialects: readonly string[];
  requestedLanguage?: string;
  requestedDialect?: string;
}): { explicitLanguage?: string; explicitDialect?: string } {
  const languageOptions = volcengineLanguageOptionsFromLabels(
    options.voiceLanguages,
  );
  const requestedLanguage = normalizeVolcengineExplicitLanguage(
    options.requestedLanguage,
  );
  const explicitLanguage = languageOptions.some(
    (item) => item.id === requestedLanguage,
  )
    ? requestedLanguage || undefined
    : undefined;

  /** 指定非中英混语种时不能再带方言，否则会报「语种和方言不对应」 */
  if (explicitLanguage) {
    return { explicitLanguage };
  }

  const dialectOptions = volcengineDialectOptionsFromLabels(
    options.voiceDialects,
  );
  const requestedDialect = normalizeVolcengineExplicitDialect(
    options.requestedDialect,
  );
  const explicitDialect = dialectOptions.some(
    (item) => item.id === requestedDialect,
  )
    ? requestedDialect || undefined
    : undefined;
  return { explicitLanguage, explicitDialect };
}

export type VolcengineSpeechSlot =
  | "single"
  | "narration"
  | "dialogue"
  | "dialogueMale"
  | "dialogueFemale";

const VOLCENGINE_SPEECH_SLOTS: readonly VolcengineSpeechSlot[] = [
  "single",
  "narration",
  "dialogue",
  "dialogueMale",
  "dialogueFemale",
];

function isVolcengineSpeechSlot(raw: string): raw is VolcengineSpeechSlot {
  return (VOLCENGINE_SPEECH_SLOTS as readonly string[]).includes(raw);
}

export function parseVolcengineSpeechSlot(
  raw: unknown,
): VolcengineSpeechSlot | undefined {
  return typeof raw === "string" && isVolcengineSpeechSlot(raw)
    ? raw
    : undefined;
}

export type VolcengineSlotSpeechModeMap = Partial<
  Record<VolcengineSpeechSlot, { language?: string; dialect?: string }>
>;

export function normalizeVolcengineSlotSpeechModes(
  raw: unknown,
): VolcengineSlotSpeechModeMap | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: VolcengineSlotSpeechModeMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isVolcengineSpeechSlot(key)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const src = value as Record<string, unknown>;
    const language = normalizeVolcengineExplicitLanguage(src.language);
    const dialect = language
      ? ""
      : normalizeVolcengineExplicitDialect(src.dialect);
    if (!language && !dialect) continue;
    out[key] = { language, dialect };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function volcengineSlotSpeechModesFingerprint(
  map: VolcengineSlotSpeechModeMap | undefined,
): string {
  if (!map) return "";
  return VOLCENGINE_SPEECH_SLOTS.map((slot) => {
    const mode = map[slot];
    if (!mode) return "";
    return `${slot}=${normalizeVolcengineExplicitLanguage(mode.language)}\t${normalizeVolcengineExplicitDialect(mode.dialect)}`;
  })
    .filter(Boolean)
    .join("\u0003");
}

export function storedVolcengineSlotSpeechMode(
  config: {
    volcengineSlotSpeechModes?: VolcengineSlotSpeechModeMap;
  },
  slot: VolcengineSpeechSlot | null | undefined,
): { language: string; dialect: string } {
  const stored = slot ? config.volcengineSlotSpeechModes?.[slot] : undefined;
  return normalizeVolcengineSpeechModePair(stored);
}

export function normalizeVolcengineSpeechModePair(
  raw: { language?: string; dialect?: string } | undefined,
): { language: string; dialect: string } {
  const language = normalizeVolcengineExplicitLanguage(raw?.language);
  return {
    language,
    dialect: language
      ? ""
      : normalizeVolcengineExplicitDialect(raw?.dialect),
  };
}

export function upsertVolcengineSlotSpeechMode(
  map: VolcengineSlotSpeechModeMap | undefined,
  slot: VolcengineSpeechSlot,
  patch: { language?: string; dialect?: string },
): VolcengineSlotSpeechModeMap | undefined {
  const current = map?.[slot] ?? {};
  const language = normalizeVolcengineExplicitLanguage(
    patch.language !== undefined ? patch.language : current.language,
  );
  const dialect = language
    ? ""
    : normalizeVolcengineExplicitDialect(
        patch.dialect !== undefined ? patch.dialect : current.dialect,
      );
  const next: VolcengineSlotSpeechModeMap = { ...(map ?? {}) };
  if (!language && !dialect) {
    delete next[slot];
  } else {
    next[slot] = { language, dialect };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
