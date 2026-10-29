export type VoiceReadAutoPauseMode = "off" | "chapters" | "duration";

export type VoiceReadFilterRule = {
  id: string;
  name: string;
  pattern: string;
  isRegex: boolean;
  isEnabled: boolean;
  order: number;
};

export type VoiceReadSpeakSettings = {
  autoPauseMode: VoiceReadAutoPauseMode;
  autoPauseChapterCount: number;
  autoPauseDurationMinutes: number;
  filterRules: VoiceReadFilterRule[];
};

export const VOICE_READ_SPEAK_STORAGE_KEY = "colortxt:voiceReadSpeak";

export const VOICE_READ_SPEAK_CHANGED_EVENT =
  "colortxt:voice-read-speak-changed";

export const VOICE_READ_AUTO_PAUSE_OPTIONS: {
  id: VoiceReadAutoPauseMode;
  label: string;
}[] = [
  { id: "off", label: "不启用" },
  { id: "chapters", label: "章节数" },
  { id: "duration", label: "时长" },
];

export const DEFAULT_VOICE_READ_AUTO_PAUSE_CHAPTER_COUNT = 5;
export const DEFAULT_VOICE_READ_AUTO_PAUSE_DURATION_MINUTES = 30;
export const MIN_VOICE_READ_AUTO_PAUSE_COUNT = 1;

/** 小括号内：() （） 〔〕 ﹝﹞（`.` 在过滤时启用 `s`，可跨行） */
export const VOICE_READ_FILTER_PATTERN_PAREN =
  "[(（〔﹝](.*?)[〕﹞）)]";
/** 中括号内：[] ［］ 【】 〖〗（ASCII `]` 在字符类中需转义） */
export const VOICE_READ_FILTER_PATTERN_BRACKET =
  "[\\[［【〖](.*?)[〗】］\\]]";
/** 大括号内：{} ｛｝ */
export const VOICE_READ_FILTER_PATTERN_BRACE = "[{｛](.*?)[｝}]";
/** 尖括号内：《》 〈〉 ＜＞ «» ‹› */
export const VOICE_READ_FILTER_PATTERN_ANGLE =
  "[《〈＜«‹](.*?)[›»＞〉》]";
export const VOICE_READ_FILTER_PATTERN_BOLD = "(\\*\\*|__)(.*?)(__|\\*\\*)";
export const VOICE_READ_FILTER_PATTERN_ITALIC = "(\\*|_)(.*?)(_|\\*)";

export function newVoiceReadFilterRuleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `vrf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultVoiceReadFilterRules(): VoiceReadFilterRule[] {
  const specs: { name: string; pattern: string }[] = [
    { name: "小括号内", pattern: VOICE_READ_FILTER_PATTERN_PAREN },
    { name: "中括号内", pattern: VOICE_READ_FILTER_PATTERN_BRACKET },
    { name: "大括号内", pattern: VOICE_READ_FILTER_PATTERN_BRACE },
    { name: "尖括号内", pattern: VOICE_READ_FILTER_PATTERN_ANGLE },
    { name: "加粗", pattern: VOICE_READ_FILTER_PATTERN_BOLD },
    { name: "斜体", pattern: VOICE_READ_FILTER_PATTERN_ITALIC },
  ];
  return specs.map((s, i) => ({
    id: `builtin-filter-${i + 1}`,
    name: s.name,
    pattern: s.pattern,
    isRegex: true,
    isEnabled: false,
    order: i,
  }));
}

export function clampVoiceReadAutoPauseCount(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(MIN_VOICE_READ_AUTO_PAUSE_COUNT, Math.floor(v));
}

export function normalizeVoiceReadAutoPauseMode(
  raw: unknown,
): VoiceReadAutoPauseMode {
  if (raw === "chapters" || raw === "duration" || raw === "off") return raw;
  return "off";
}

export function isVoiceReadFilterRuleValid(
  rule: Pick<VoiceReadFilterRule, "pattern" | "isRegex">,
): boolean {
  const pattern = rule.pattern?.trim() ?? "";
  if (!pattern) return false;
  if (!rule.isRegex) return true;
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, "u");
  } catch {
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch {
      return false;
    }
  }
  return true;
}

export function displayVoiceReadFilterRuleName(
  rule: Pick<VoiceReadFilterRule, "name">,
): string {
  return rule.name?.trim() || "";
}

export function cloneVoiceReadFilterRule(
  rule: VoiceReadFilterRule,
): VoiceReadFilterRule {
  return { ...rule };
}

export function cloneVoiceReadSpeakSettings(
  settings: VoiceReadSpeakSettings,
): VoiceReadSpeakSettings {
  return {
    autoPauseMode: settings.autoPauseMode,
    autoPauseChapterCount: settings.autoPauseChapterCount,
    autoPauseDurationMinutes: settings.autoPauseDurationMinutes,
    filterRules: settings.filterRules.map(cloneVoiceReadFilterRule),
  };
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === 0 || v === 1) return Boolean(v);
  if (v === "0" || v === "1") return v === "1";
  return fallback;
}

export function normalizeVoiceReadFilterRule(
  raw: unknown,
  fallbackOrder: number,
): VoiceReadFilterRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pattern = typeof o.pattern === "string" ? o.pattern : "";
  const id =
    typeof o.id === "string" && o.id.trim()
      ? o.id.trim()
      : newVoiceReadFilterRuleId();
  const orderRaw = o.order;
  const order =
    typeof orderRaw === "number" && Number.isFinite(orderRaw)
      ? Math.floor(orderRaw)
      : fallbackOrder;
  return {
    id,
    name: typeof o.name === "string" ? o.name : "",
    pattern,
    isRegex: asBool(o.isRegex, true),
    isEnabled: asBool(o.isEnabled, false),
    order,
  };
}

export function defaultVoiceReadSpeakSettings(): VoiceReadSpeakSettings {
  return {
    autoPauseMode: "off",
    autoPauseChapterCount: DEFAULT_VOICE_READ_AUTO_PAUSE_CHAPTER_COUNT,
    autoPauseDurationMinutes: DEFAULT_VOICE_READ_AUTO_PAUSE_DURATION_MINUTES,
    filterRules: createDefaultVoiceReadFilterRules(),
  };
}

export function mergeVoiceReadSpeakSettings(
  raw: Partial<VoiceReadSpeakSettings> | null | undefined,
): VoiceReadSpeakSettings {
  const d = defaultVoiceReadSpeakSettings();
  const rulesRaw = raw?.filterRules;
  const filterRules: VoiceReadFilterRule[] = [];
  if (Array.isArray(rulesRaw)) {
    const seen = new Set<string>();
    let i = 0;
    for (const item of rulesRaw) {
      const rule = normalizeVoiceReadFilterRule(item, i);
      i += 1;
      if (!rule) continue;
      let id = rule.id;
      while (seen.has(id)) id = newVoiceReadFilterRuleId();
      seen.add(id);
      filterRules.push({ ...rule, id });
    }
    filterRules.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    filterRules.forEach((r, idx) => {
      r.order = idx;
    });
  } else {
    filterRules.push(...d.filterRules);
  }
  return {
    autoPauseMode: normalizeVoiceReadAutoPauseMode(raw?.autoPauseMode),
    autoPauseChapterCount: clampVoiceReadAutoPauseCount(
      raw?.autoPauseChapterCount ?? d.autoPauseChapterCount,
      d.autoPauseChapterCount,
    ),
    autoPauseDurationMinutes: clampVoiceReadAutoPauseCount(
      raw?.autoPauseDurationMinutes ?? d.autoPauseDurationMinutes,
      d.autoPauseDurationMinutes,
    ),
    filterRules,
  };
}

/** 自动暂停倒计时：不足 1 小时 `mm:ss`，否则 `h:mm:ss`（时不补零）。 */
export function formatVoiceReadAutoPauseClock(ms: number): string {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

export function voiceReadFilterRulesFingerprint(
  rules: readonly VoiceReadFilterRule[],
): string {
  return rules
    .filter((r) => r.isEnabled && r.pattern.trim())
    .map((r) => `${r.isRegex ? "1" : "0"}\u0001${r.pattern}`)
    .join("\u0002");
}
