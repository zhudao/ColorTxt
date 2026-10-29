/** MiniMax 语音合成模型预设（设置页建议列表，新→旧排序） */

import { DEFAULT_MINIMAX_TTS_MODEL } from "./voiceReadEngineDefaults";

export { DEFAULT_MINIMAX_TTS_MODEL } from "./voiceReadEngineDefaults";

export const MINIMAX_TTS_MODEL_SUGGESTIONS: readonly string[] = [
  "speech-2.8-hd",
  "speech-2.8-turbo",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "speech-02-hd",
  "speech-02-turbo",
  "speech-01-hd",
  "speech-01-turbo",
];

export function getMinimaxTtsModelSuggestions(): readonly string[] {
  return MINIMAX_TTS_MODEL_SUGGESTIONS;
}

export function normalizeMinimaxTtsModel(raw: unknown): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  return t || DEFAULT_MINIMAX_TTS_MODEL;
}
