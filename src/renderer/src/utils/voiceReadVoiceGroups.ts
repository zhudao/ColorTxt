import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import {
  EDGE_TTS_VOICES,
  findEdgeTtsVoice,
  type EdgeTtsVoice,
} from "@shared/voiceReadEdgeTtsVoices";
import {
  defaultMultiVoiceIdsForEngine,
  defaultSingleVoiceIdForEngine,
  type VoiceReadEngineId,
} from "@shared/voiceReadEngines";
import {
  type VoiceReadMultiVoiceSettings,
  type VoiceReadSingleVoiceSettings,
} from "@shared/voiceReadProfiles";
import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import type { VoiceReadVoiceOption } from "@shared/voiceReadSynthesis";
import {
  DASHSCOPE_TTS_VOICES,
} from "../constants/voiceRead";
import {
  dashscopeVoiceGroupsToSelectItems,
} from "./voiceReadDashscopeVoiceSelect";
import { edgeVoiceGroupsToSelectItems } from "./voiceReadEdgeVoiceSelect";
import {
  minimaxFlatVoiceOptionsToSelectItems,
  minimaxVoiceGroupsToSelectItems,
} from "./voiceReadMinimaxVoiceSelect";
import { mimoVoiceGroupsToSelectItems } from "./voiceReadMimoVoiceSelect";
import { MINIMAX_TTS_VOICES } from "../constants/voiceReadMinimax";
import { minimaxVoiceCatalog } from "../services/voiceRead/minimaxVoiceCatalog";
import { winSapiVoiceCatalog } from "../services/voiceRead/winSapiVoiceCatalog";
import {
  findMimoTtsVoice,
  MIMO_TTS_VOICES,
} from "@shared/voiceReadMimoVoices";
import {
  findVolcengineTtsVoice,
  VOLCENGINE_TTS_VOICE_GROUPS,
  VOLCENGINE_TTS_VOICES,
} from "@shared/voiceReadVolcengineVoices";
import {
  VOLCENGINE_VOICE_SELECT_ITEMS,
} from "./voiceReadVolcengineVoiceSelect";

export type VoiceSelectOption = { id: string; label: string };

export type VoiceOptionGroup = readonly [
  locale: string,
  options: readonly VoiceSelectOption[],
];

const LOCALE_LABEL_OVERRIDES: Record<string, string> = {
  und: "未指定语言",
  "minimax-system": "系统音色",
  "minimax-voice_cloning": "快速复刻",
  "minimax-voice_generation": "文生音色",
  "zh-CN": "中文（简体，中国）",
  "zh-CN-liaoning": "中文（东北官话，辽宁）",
  "zh-CN-shaanxi": "中文（中原官话，陕西）",
  "zh-HK": "中文（繁体，香港）",
  "zh-TW": "中文（繁体，台湾）",
  "en-AU": "英语（澳大利亚）",
  "en-CA": "英语（加拿大）",
  "en-GB": "英语（英国）",
  "en-IN": "英语（印度）",
  "en-US": "英语（美国）",
};

function normalizeLocaleCode(locale: string): string {
  const trimmed = locale.trim().replace(/_/g, "-");
  if (!trimmed) return "und";
  const [language, ...rest] = trimmed.split("-");
  if (!rest.length) return language.toLowerCase();
  return [
    language.toLowerCase(),
    ...rest.map((part) =>
      part.length === 4
        ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`
        : part.toUpperCase(),
    ),
  ].join("-");
}

function resolveDisplayLocale(): string {
  try {
    const runtimeLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (runtimeLocale) return normalizeLocaleCode(runtimeLocale);
  } catch {
    // fall through
  }
  return "zh-CN";
}

/** 语种分组标题（固定中文 UI） */
export function getLocaleDisplayLabel(locale: string): string {
  const normalizedLocale = normalizeLocaleCode(locale || "und");
  const override = LOCALE_LABEL_OVERRIDES[normalizedLocale];
  if (override) return override;

  const resolvedDisplayLocale = resolveDisplayLocale();
  try {
    const [language, maybeScriptOrRegion, maybeRegion] =
      normalizedLocale.split("-");
    const languageNames = new Intl.DisplayNames([resolvedDisplayLocale, "en"], {
      type: "language",
    });
    const regionNames = new Intl.DisplayNames([resolvedDisplayLocale, "en"], {
      type: "region",
    });
    const scriptNames = new Intl.DisplayNames([resolvedDisplayLocale, "en"], {
      type: "script",
    });

    const languageLabel = languageNames.of(language);
    const extras: string[] = [];

    if (maybeScriptOrRegion) {
      if (maybeScriptOrRegion.length === 4) {
        const scriptLabel = scriptNames.of(maybeScriptOrRegion);
        if (scriptLabel) extras.push(scriptLabel);
        if (maybeRegion) {
          const regionLabel = regionNames.of(maybeRegion);
          if (regionLabel) extras.push(regionLabel);
        }
      } else {
        const regionLabel = regionNames.of(maybeScriptOrRegion);
        if (regionLabel) extras.push(regionLabel);
      }
    }

    if (languageLabel && extras.length > 0) {
      return `${languageLabel}（${extras.join("，")}）`;
    }
    if (languageLabel) return languageLabel;
  } catch {
    // fall through
  }

  return normalizedLocale;
}

export function compareVoiceLanguage(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  const aZh = aLower.startsWith("zh") ? -2 : 0;
  const bZh = bLower.startsWith("zh") ? -2 : 0;
  const aEn = aLower.startsWith("en") ? -1 : 0;
  const bEn = bLower.startsWith("en") ? -1 : 0;
  return aZh - bZh || aEn - bEn || a.localeCompare(b);
}

export function groupEdgeTtsVoices(
  voices: readonly EdgeTtsVoice[] = EDGE_TTS_VOICES,
): VoiceOptionGroup[] {
  const grouped = new Map<string, EdgeTtsVoice[]>();
  for (const voice of voices) {
    const bucket = grouped.get(voice.lang) ?? [];
    bucket.push(voice);
    grouped.set(voice.lang, bucket);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => compareVoiceLanguage(a, b))
    .map(
      ([lang, items]) =>
        [
          lang,
          [...items]
            .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))
            .map((v) => ({ id: v.id, label: v.label })),
        ] as const,
    );
}

function groupEdgeTtsVoicesRaw(
  voices: readonly EdgeTtsVoice[] = EDGE_TTS_VOICES,
): ReadonlyArray<readonly [string, readonly EdgeTtsVoice[]]> {
  const grouped = new Map<string, EdgeTtsVoice[]>();
  for (const voice of voices) {
    const bucket = grouped.get(voice.lang) ?? [];
    bucket.push(voice);
    grouped.set(voice.lang, bucket);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => compareVoiceLanguage(a, b))
    .map(
      ([lang, items]) =>
        [
          lang,
          [...items].sort((a, b) =>
            a.label.localeCompare(b.label, "zh-CN"),
          ),
        ] as const,
    );
}

export type SystemVoiceOption = {
  id: string;
  label: string;
  lang: string;
  isDefault?: boolean;
};

function compareSystemVoice(
  a: SystemVoiceOption,
  b: SystemVoiceOption,
): number {
  if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
  return a.label.localeCompare(b.label) || a.lang.localeCompare(b.lang);
}

export function getSystemVoiceOptions(
  voices: SpeechSynthesisVoice[],
): SystemVoiceOption[] {
  const deduped = new Map<string, SystemVoiceOption>();
  for (const voice of voices) {
    const option: SystemVoiceOption = {
      id: voice.voiceURI || voice.name,
      label: voice.name,
      lang: voice.lang || "und",
      isDefault: voice.default,
    };
    const existing = deduped.get(option.id);
    if (!existing || (!existing.isDefault && option.isDefault)) {
      deduped.set(option.id, option);
    }
  }
  return Array.from(deduped.values()).sort(compareSystemVoice);
}

export function groupSystemVoices(
  voices: SpeechSynthesisVoice[],
): VoiceOptionGroup[] {
  const grouped = new Map<string, SystemVoiceOption[]>();
  for (const voice of getSystemVoiceOptions(voices)) {
    const bucket = grouped.get(voice.lang) ?? [];
    bucket.push(voice);
    grouped.set(voice.lang, bucket);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => compareVoiceLanguage(a, b))
    .map(
      ([lang, items]) =>
        [
          lang,
          [...items]
            .sort(compareSystemVoice)
            .map((v) => ({ id: v.id, label: v.label })),
        ] as const,
    );
}

/** 将语种分组转为 AppCustomSelect 列表项（含分组标题） */
export function voiceGroupsToSelectItems(
  groups: readonly VoiceOptionGroup[],
): CustomSelectItem[] {
  const items: CustomSelectItem[] = [];
  for (const [locale, options] of groups) {
    items.push({ kind: "groupLabel", label: getLocaleDisplayLabel(locale) });
    for (const opt of options) {
      items.push({ kind: "item", id: opt.id, label: opt.label });
    }
  }
  return items;
}

export function flatVoiceOptionsToSelectItems(
  options: readonly VoiceSelectOption[],
): CustomSelectItem[] {
  return options.map((o) => ({
    kind: "item" as const,
    id: o.id,
    label: o.label,
  }));
}

export function listVoiceOptionsForEngine(
  engine: VoiceReadEngineId,
  systemVoices: SpeechSynthesisVoice[],
  _engineConfig?: VoiceReadEngineConfig,
): readonly VoiceSelectOption[] {
  switch (engine) {
    case "system":
      return getSystemVoiceOptions(systemVoices).map((v) => ({
        id: v.id,
        label: v.label,
      }));
    case "edge":
      return EDGE_TTS_VOICES.map((v) => ({ id: v.id, label: v.label }));
    case "winSapi":
      return winSapiVoiceOptions().map((v) => ({
        id: v.id,
        label: v.label,
      }));
    case "dashscope":
      return DASHSCOPE_TTS_VOICES.map((v) => ({ id: v.id, label: v.label }));
    case "minimax":
      return minimaxVoiceOptions();
    case "mimo":
      return MIMO_TTS_VOICES.map((v) => ({ id: v.id, label: v.label }));
    case "volcengine":
      return VOLCENGINE_TTS_VOICES.map((v) => ({
        id: v.id,
        label: v.label,
      }));
    default:
      return [];
  }
}

export function groupMinimaxVoices(
  voices: readonly VoiceReadVoiceOption[],
): VoiceOptionGroup[] {
  const order = [
    "minimax-system",
    "minimax-voice_cloning",
    "minimax-voice_generation",
  ];
  const grouped = new Map<string, VoiceSelectOption[]>();
  for (const voice of voices) {
    const locale = voice.locale?.trim() || "minimax-system";
    const bucket = grouped.get(locale) ?? [];
    bucket.push({ id: voice.id, label: voice.label });
    grouped.set(locale, bucket);
  }
  const locales = [
    ...order.filter((l) => grouped.has(l)),
    ...Array.from(grouped.keys()).filter((l) => !order.includes(l)).sort(),
  ];
  return locales.map(
    (locale) =>
      [
        locale,
        [...(grouped.get(locale) ?? [])].sort((a, b) =>
          a.label.localeCompare(b.label),
        ),
      ] as const,
  );
}

function groupMinimaxVoicesRaw(
  voices: readonly VoiceReadVoiceOption[],
): ReadonlyArray<readonly [string, readonly VoiceReadVoiceOption[]]> {
  const order = [
    "minimax-system",
    "minimax-voice_cloning",
    "minimax-voice_generation",
  ];
  const grouped = new Map<string, VoiceReadVoiceOption[]>();
  for (const voice of voices) {
    const locale = voice.locale?.trim() || "minimax-system";
    const bucket = grouped.get(locale) ?? [];
    bucket.push(voice);
    grouped.set(locale, bucket);
  }
  const locales = [
    ...order.filter((l) => grouped.has(l)),
    ...Array.from(grouped.keys()).filter((l) => !order.includes(l)).sort(),
  ];
  return locales.map(
    (locale) =>
      [
        locale,
        [...(grouped.get(locale) ?? [])].sort((a, b) =>
          a.label.localeCompare(b.label),
        ),
      ] as const,
  );
}

function minimaxVoiceOptions(): readonly VoiceReadVoiceOption[] {
  const catalog = minimaxVoiceCatalog.value;
  if (catalog?.length) {
    return catalog;
  }
  return MINIMAX_TTS_VOICES.map((v) => ({ id: v.id, label: v.label }));
}

function winSapiVoiceOptions(): readonly VoiceReadVoiceOption[] {
  return winSapiVoiceCatalog.value ?? [];
}

function groupWinSapiVoices(
  voices: readonly VoiceReadVoiceOption[],
): VoiceOptionGroup[] {
  const grouped = new Map<string, VoiceSelectOption[]>();
  for (const v of voices) {
    const locale = normalizeLocaleCode(v.locale || "und");
    const bucket = grouped.get(locale) ?? [];
    bucket.push({ id: v.id, label: v.label });
    grouped.set(locale, bucket);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => compareVoiceLanguage(a, b))
    .map(([locale, options]) => [locale, options] as const);
}

const VOLCENGINE_VOICE_OPTION_GROUPS: VoiceOptionGroup[] =
  VOLCENGINE_TTS_VOICE_GROUPS.map(
    ([label, voices]) =>
      [
        label,
        voices.map((voice) => ({ id: voice.id, label: voice.label })),
      ] as const,
  );

export function getVoiceGroupsForEngine(
  engine: VoiceReadEngineId,
  systemVoices: SpeechSynthesisVoice[],
): VoiceOptionGroup[] | "flat" {
  if (engine === "system") return groupSystemVoices(systemVoices);
  if (engine === "edge") return groupEdgeTtsVoices();
  if (engine === "winSapi" && winSapiVoiceOptions().length) {
    return groupWinSapiVoices(winSapiVoiceOptions());
  }
  if (engine === "minimax" && minimaxVoiceCatalog.value?.length) {
    return groupMinimaxVoices(minimaxVoiceCatalog.value);
  }
  if (engine === "volcengine") {
    return VOLCENGINE_VOICE_OPTION_GROUPS;
  }
  return "flat";
}

export function voiceSelectItemsForEngine(
  engine: VoiceReadEngineId,
  systemVoices: SpeechSynthesisVoice[],
  engineConfig?: VoiceReadEngineConfig,
): CustomSelectItem[] {
  if (engine === "dashscope") {
    return dashscopeVoiceGroupsToSelectItems();
  }
  if (engine === "mimo") {
    return mimoVoiceGroupsToSelectItems();
  }
  if (engine === "volcengine") {
    return VOLCENGINE_VOICE_SELECT_ITEMS as CustomSelectItem[];
  }
  if (engine === "edge") {
    return edgeVoiceGroupsToSelectItems(
      groupEdgeTtsVoicesRaw(),
      getLocaleDisplayLabel,
    );
  }
  if (engine === "winSapi") {
    const groups = groupWinSapiVoices(winSapiVoiceOptions());
    if (groups.length === 0) return [];
    return voiceGroupsToSelectItems(groups);
  }
  if (engine === "minimax") {
    const voices = minimaxVoiceOptions();
    if (minimaxVoiceCatalog.value?.length) {
      return minimaxVoiceGroupsToSelectItems(
        groupMinimaxVoicesRaw(voices),
        getLocaleDisplayLabel,
      );
    }
    return minimaxFlatVoiceOptionsToSelectItems(voices);
  }
  const groups = getVoiceGroupsForEngine(engine, systemVoices);
  if (groups === "flat") {
    return flatVoiceOptionsToSelectItems(
      listVoiceOptionsForEngine(engine, systemVoices, engineConfig),
    );
  }
  return voiceGroupsToSelectItems(groups);
}

export function resolveDefaultVoicePatchForEngine(
  engine: VoiceReadEngineId,
  systemVoices: SpeechSynthesisVoice[],
): {
  single: VoiceReadSingleVoiceSettings;
  multi: Pick<
    VoiceReadMultiVoiceSettings,
    | "narrationVoiceId"
    | "dialogueVoiceId"
    | "dialogueMaleVoiceId"
    | "dialogueFemaleVoiceId"
  >;
} {
  let singleVoiceId = defaultSingleVoiceIdForEngine(engine);
  if (engine === "system") {
    singleVoiceId = systemVoices[0]?.voiceURI ?? "";
  }
  if (engine === "winSapi") {
    const voices = winSapiVoiceOptions();
    const isNatural = (label: string) =>
      /\bNatural\b/i.test(label) ||
      (!/Desktop/i.test(label) &&
        /Microsoft\s+(Xiaoxiao|Yunxi|Yunjian|Yunyang|Xiaochen|Xiaoyi)\b/i.test(
          label,
        ));
    const zhNatural = voices.find(
      (v) =>
        isNatural(v.label) && (v.locale ?? "").toLowerCase().startsWith("zh"),
    );
    singleVoiceId =
      zhNatural?.id ||
      voices.find((v) => isNatural(v.label))?.id ||
      voices.find((v) => (v.locale ?? "").toLowerCase().startsWith("zh"))?.id ||
      voices[0]?.id ||
      "";
    const multiBase = singleVoiceId;
    return {
      single: { voiceId: singleVoiceId },
      multi: {
        narrationVoiceId: multiBase,
        dialogueVoiceId: multiBase,
        dialogueMaleVoiceId:
          voices.find(
            (v) =>
              isNatural(v.label) &&
              (v.gender === "male" || /yunxi|yunjian|kangkang/i.test(v.label)),
          )?.id || multiBase,
        dialogueFemaleVoiceId:
          voices.find(
            (v) =>
              isNatural(v.label) &&
              (v.gender === "female" ||
                /xiaoxiao|xiaoyi|huihui|yaoyao/i.test(v.label)),
          )?.id || multiBase,
      },
    };
  }
  return {
    single: { voiceId: singleVoiceId },
    multi: defaultMultiVoiceIdsForEngine(engine),
  };
}

export function isVoiceIdValidForEngine(
  engine: VoiceReadEngineId,
  voiceId: string,
  systemVoices: SpeechSynthesisVoice[],
  engineConfig?: VoiceReadEngineConfig,
): boolean {
  const id = voiceId.trim();
  if (!id) return false;
  return listVoiceOptionsForEngine(engine, systemVoices, engineConfig).some(
    (v) => v.id === id,
  );
}

export function resolveVoiceReadDisplayLabel(
  engine: VoiceReadEngineId,
  voiceId: string,
  systemVoices: SpeechSynthesisVoice[],
): string {
  const id = voiceId.trim();
  if (!id) return "";

  if (engine === "edge") {
    const v = findEdgeTtsVoice(id);
    return v?.label ?? id.replace(/Neural$/u, "");
  }
  if (engine === "dashscope") {
    return DASHSCOPE_TTS_VOICES.find((v) => v.id === id)?.label ?? id;
  }
  if (engine === "minimax") {
    const hit = minimaxVoiceOptions().find((v) => v.id === id);
    return hit?.label ?? id;
  }
  if (engine === "mimo") {
    return findMimoTtsVoice(id)?.label ?? id;
  }
  if (engine === "volcengine") {
    return findVolcengineTtsVoice(id)?.label ?? id;
  }
  if (engine === "winSapi") {
    return winSapiVoiceOptions().find((v) => v.id === id)?.label ?? id;
  }
  const flat = listVoiceOptionsForEngine(engine, systemVoices);
  const hit = flat.find((v) => v.id === id);
  if (hit) return hit.label;
  const sys = getSystemVoiceOptions(systemVoices).find((v) => v.id === id);
  return sys?.label ?? id;
}
