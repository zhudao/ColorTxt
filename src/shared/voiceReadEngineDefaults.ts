/**
 * 各朗读引擎默认模型与音色（单音色 / 多音色槽位）。
 * 修改引擎默认值时请优先改此文件。
 */

import type { VoiceReadEngineId } from "./voiceReadEngines";

export type VoiceReadEngineMultiVoiceDefaults = {
  narrationVoiceId: string;
  dialogueVoiceId: string;
  dialogueMaleVoiceId: string;
  dialogueFemaleVoiceId: string;
};

export type VoiceReadEngineDefaults = {
  /** 通用默认音色：多音色切换引擎、Provider 兜底等 */
  voiceId: string;
  /** 单音色方案默认；缺省同 voiceId */
  singleVoiceId?: string;
  /** 多音色各槽位；缺省四条均用 voiceId */
  multi?: Partial<VoiceReadEngineMultiVoiceDefaults>;
  /** 云端 TTS 默认模型 ID */
  model?: string;
};

export const VOICE_READ_ENGINE_DEFAULTS: Record<
  VoiceReadEngineId,
  VoiceReadEngineDefaults
> = {
  edge: {
    voiceId: "zh-CN-YunjianNeural",
    multi: {
      narrationVoiceId: "zh-CN-YunjianNeural",
      dialogueVoiceId: "zh-CN-YunxiNeural",
      dialogueMaleVoiceId: "zh-CN-YunxiNeural",
      dialogueFemaleVoiceId: "zh-CN-XiaoxiaoNeural",
    },
  },
  system: {
    voiceId: "",
  },
  winSapi: {
    voiceId: "",
  },
  dashscope: {
    voiceId: "Eldric Sage",
    model: "qwen3-tts-instruct-flash",
    singleVoiceId: "Eldric Sage",
    multi: {
      narrationVoiceId: "Eldric Sage",
      dialogueVoiceId: "Ethan",
      dialogueMaleVoiceId: "Moon",
      dialogueFemaleVoiceId: "Serena",
    },
  },
  minimax: {
    voiceId: "Chinese (Mandarin)_Male_Announcer",
    model: "speech-2.8-turbo",
    singleVoiceId: "Chinese (Mandarin)_Male_Announcer",
    multi: {
      narrationVoiceId: "Chinese (Mandarin)_Male_Announcer",
      dialogueVoiceId: "Chinese (Mandarin)_Unrestrained_Young_Man",
      dialogueMaleVoiceId: "chunzhen_xuedi",
      dialogueFemaleVoiceId: "danya_xuejie",
    },
  },
  mimo: {
    voiceId: "冰糖",
    model: "mimo-v2.5-tts",
    singleVoiceId: "冰糖",
    multi: {
      narrationVoiceId: "冰糖",
      dialogueVoiceId: "苏打",
      dialogueMaleVoiceId: "苏打",
      dialogueFemaleVoiceId: "茉莉",
    },
  },
  volcengine: {
    voiceId: "zh_male_ruyaqingnian_uranus_bigtts",
    singleVoiceId: "zh_male_ruyaqingnian_uranus_bigtts",
    multi: {
      narrationVoiceId: "zh_male_ruyaqingnian_uranus_bigtts",
      dialogueVoiceId: "zh_male_linjiananhai_uranus_bigtts",
      dialogueMaleVoiceId: "zh_male_huolixiaoge_uranus_bigtts",
      dialogueFemaleVoiceId: "zh_female_meilinvyou_uranus_bigtts",
    },
  },
};

export const DEFAULT_DASHSCOPE_TTS_MODEL =
  VOICE_READ_ENGINE_DEFAULTS.dashscope.model!;

export const DEFAULT_MINIMAX_TTS_MODEL =
  VOICE_READ_ENGINE_DEFAULTS.minimax.model!;

export const DEFAULT_MIMO_TTS_MODEL =
  VOICE_READ_ENGINE_DEFAULTS.mimo.model!;

function readEngineDefaults(engine: VoiceReadEngineId): VoiceReadEngineDefaults {
  return VOICE_READ_ENGINE_DEFAULTS[engine];
}

export function defaultVoiceIdForEngine(engine: VoiceReadEngineId): string {
  return readEngineDefaults(engine).voiceId;
}

export function defaultSingleVoiceIdForEngine(
  engine: VoiceReadEngineId,
): string {
  const d = readEngineDefaults(engine);
  return d.singleVoiceId?.trim() || d.voiceId;
}

export function defaultMultiVoiceIdsForEngine(
  engine: VoiceReadEngineId,
): VoiceReadEngineMultiVoiceDefaults {
  const d = readEngineDefaults(engine);
  const base = d.voiceId;
  const m = d.multi ?? {};
  return {
    narrationVoiceId: m.narrationVoiceId ?? base,
    dialogueVoiceId: m.dialogueVoiceId ?? base,
    dialogueMaleVoiceId: m.dialogueMaleVoiceId ?? base,
    dialogueFemaleVoiceId: m.dialogueFemaleVoiceId ?? base,
  };
}

export function defaultModelForEngine(
  engine: VoiceReadEngineId,
): string | undefined {
  return readEngineDefaults(engine).model;
}
