/** 小米 MiMo 语音合成模型预设（设置页建议列表） */

import { DEFAULT_MIMO_TTS_MODEL } from "./voiceReadEngineDefaults";

export { DEFAULT_MIMO_TTS_MODEL } from "./voiceReadEngineDefaults";

export const MIMO_TTS_MODEL_SUGGESTIONS: readonly string[] = [
  "mimo-v2.5-tts",
  "mimo-v2.5-tts-voicedesign",
  "mimo-v2.5-tts-voiceclone",
];

const MIMO_VOICE_DESIGN_MODEL_PATTERN = /^mimo-v[\d.]+-tts-voicedesign$/i;
const MIMO_VOICE_CLONE_MODEL_PATTERN = /^mimo-v[\d.]+-tts-voiceclone$/i;
const MIMO_PRESET_MODEL_PATTERN = /^mimo-v[\d.]+-tts$/i;

export function getMimoTtsModelSuggestions(): readonly string[] {
  return MIMO_TTS_MODEL_SUGGESTIONS;
}

export function normalizeMimoTtsModel(raw: unknown): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  return t || DEFAULT_MIMO_TTS_MODEL;
}

export function isMimoTtsVoiceDesignModel(model: string): boolean {
  return MIMO_VOICE_DESIGN_MODEL_PATTERN.test(model.trim());
}

export function isMimoTtsVoiceCloneModel(model: string): boolean {
  return MIMO_VOICE_CLONE_MODEL_PATTERN.test(model.trim());
}

export function isMimoTtsPresetModel(model: string): boolean {
  const m = model.trim();
  if (!m) return true;
  if (isMimoTtsVoiceDesignModel(m) || isMimoTtsVoiceCloneModel(m)) {
    return false;
  }
  return MIMO_PRESET_MODEL_PATTERN.test(m);
}
