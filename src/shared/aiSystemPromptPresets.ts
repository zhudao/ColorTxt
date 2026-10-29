/** AI 对话方案：附加系统提示词的内置预设（设置 → AI 阅读助手） */

export const AI_SYSTEM_PROMPT_PRESET_NONE_ID = "none";
export const AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID = "custom";

export type SystemPromptExtraMode =
  | typeof AI_SYSTEM_PROMPT_PRESET_NONE_ID
  | typeof AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID
  | "literary-fiction"
  | "excerpt-objective";

export type AiSystemPromptPreset = {
  id: SystemPromptExtraMode;
  label: string;
  description: string;
  text: string;
};

/** 下拉可选项（「无」= 禁用；内置预设 / 自定义 = 使用下方文本框，可选预设后再编辑） */
export const AI_SYSTEM_PROMPT_PRESETS: readonly AiSystemPromptPreset[] = [
  {
    id: AI_SYSTEM_PROMPT_PRESET_NONE_ID,
    label: "无",
    description: "不附加额外系统提示词",
    text: "",
  },
  {
    id: "literary-fiction",
    label: "虚构文学分析",
    description:
      "将内容视为虚构创作，侧重文学分析与原文依据，减少不必要的拒答",
    text: `用户正在阅读虚构文学作品。请将所有讨论视为对虚构文本的文学分析、情节梳理、人物塑造与风格研究，而非现实事件或真实人物。

对原文片段中已出现的暴力、性描写、粗俗用语、非法行为等：可以出于文学分析、情节梳理、人物塑造研究而客观引用、概括或分析其在叙事中的作用；不要因题材敏感而直接拒答。

禁止美化、鼓励或指导现实中的违法与伤害行为；禁止编造原文未出现的内容。仍须严格依据检索片段与用户给出的原文作答；材料不足时如实说明。`,
  },
  {
    id: "excerpt-objective",
    label: "摘录与客观描述",
    description: "仅摘录、中性概括与可核验描述，不作道德评判",
    text: `用户正在阅读虚构文学作品。回答时优先给出与问题相关的原文摘录、中性概括与可核验的事实性描述。

不对人物行为作道德评判，不使用「应当」「可耻」等评判性措辞。若原文含敏感描写，可原文引用或中性转述；不要扩写、不要无故拒绝。

不得编造未在原文出现的细节；材料不足时如实说明。`,
  },
  {
    id: AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID,
    label: "自定义",
    description: "在下方文本框中编写附加系统提示词",
    text: "",
  },
];

const MODE_IDS = new Set<string>(
  AI_SYSTEM_PROMPT_PRESETS.map((p) => p.id),
);

export function isSystemPromptExtraMode(
  raw: string,
): raw is SystemPromptExtraMode {
  return MODE_IDS.has(raw);
}

/** 是否为内置预设（非「无」、非「自定义」） */
export function isBuiltInSystemPromptPresetMode(
  mode: SystemPromptExtraMode,
): boolean {
  return (
    mode !== AI_SYSTEM_PROMPT_PRESET_NONE_ID &&
    mode !== AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID
  );
}

/** 读取/迁移对话方案中的模式（兼容仅有 systemPromptExtra 文本的旧配置） */
export function normalizeSystemPromptExtraMode(
  rawMode: unknown,
  legacyExtraText: string,
): SystemPromptExtraMode {
  const t = legacyExtraText.trim();
  if (typeof rawMode === "string" && isSystemPromptExtraMode(rawMode)) {
    if (isBuiltInSystemPromptPresetMode(rawMode)) {
      const preset = AI_SYSTEM_PROMPT_PRESETS.find((p) => p.id === rawMode);
      if (preset && preset.text.trim() !== t) {
        return AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID;
      }
    }
    return rawMode;
  }
  if (!t) return AI_SYSTEM_PROMPT_PRESET_NONE_ID;
  for (const p of AI_SYSTEM_PROMPT_PRESETS) {
    if (
      p.id === AI_SYSTEM_PROMPT_PRESET_NONE_ID ||
      p.id === AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID
    ) {
      continue;
    }
    if (p.text.trim() === t) return p.id;
  }
  return AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID;
}

export function systemPromptPresetDisplayLabel(
  mode: SystemPromptExtraMode,
): string {
  return (
    AI_SYSTEM_PROMPT_PRESETS.find((p) => p.id === mode)?.label ?? "无"
  );
}

/** 按模式解析实际拼进 system 的附加提示词（非「无」时使用文本框内容） */
export function resolveEffectiveSystemPromptExtra(
  mode: SystemPromptExtraMode,
  customText: string,
): string {
  if (mode === AI_SYSTEM_PROMPT_PRESET_NONE_ID) return "";
  return customText.trim();
}

export function resolveEffectiveSystemPromptExtraFromChat(chat: {
  systemPromptExtraMode: SystemPromptExtraMode;
  systemPromptExtra: string;
}): string {
  return resolveEffectiveSystemPromptExtra(
    chat.systemPromptExtraMode,
    chat.systemPromptExtra,
  );
}

/** 将用户在对话方案中配置的附加系统提示词拼入主 system（与阅读助手一致） */
export function appendChatSystemPromptExtra(
  baseSystem: string,
  extra: string | undefined | null,
): string {
  const e = (extra ?? "").trim();
  if (!e) return baseSystem.trim();
  return `${baseSystem.trim()}\n\n## 用户在设置中附加的系统提示词\n${e}`;
}
