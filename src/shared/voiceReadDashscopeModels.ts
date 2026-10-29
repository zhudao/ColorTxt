/** 阿里云通义 DashScope Qwen3-TTS 模型预设 */

import { DEFAULT_DASHSCOPE_TTS_MODEL } from "./voiceReadEngineDefaults";

export { DEFAULT_DASHSCOPE_TTS_MODEL } from "./voiceReadEngineDefaults";
export const DASHSCOPE_TTS_MODEL_SUGGESTIONS: readonly string[] = [
  "qwen3-tts-instruct-flash",
  "qwen3-tts-flash",
];

export function getDashscopeTtsModelSuggestions(): readonly string[] {
  return DASHSCOPE_TTS_MODEL_SUGGESTIONS;
}

export function normalizeDashscopeTtsModel(raw: unknown): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return DEFAULT_DASHSCOPE_TTS_MODEL;
  const lower = t.toLowerCase();
  if (lower.includes("instruct") && lower.includes("qwen3") && lower.includes("tts")) {
    return "qwen3-tts-instruct-flash";
  }
  if (lower.includes("qwen3") && lower.includes("tts")) {
    return "qwen3-tts-flash";
  }
  return t;
}

export function dashscopeTtsModelSupportsInstructions(model: string): boolean {
  return normalizeDashscopeTtsModel(model).includes("instruct");
}
