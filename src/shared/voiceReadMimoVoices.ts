/** MiMo 预置音色（仅 mimo-v*-tts 模型；描述来源：小米 MiMo 官方文档 + Studio 试听印象） */

export type MimoTtsVoiceGroup = "chinese" | "english";
export type MimoTtsVoiceGender = "male" | "female";

export type MimoTtsVoice = {
  id: string;
  nameZh: string;
  label: string;
  description: string;
  gender: MimoTtsVoiceGender;
  group: MimoTtsVoiceGroup;
  lang: string;
};

const GROUP_LABELS: Record<MimoTtsVoiceGroup, string> = {
  chinese: "中文",
  english: "英文",
};

function mimoVoice(
  id: string,
  nameZh: string,
  description: string,
  gender: MimoTtsVoiceGender,
  group: MimoTtsVoiceGroup,
  lang: string,
): MimoTtsVoice {
  const label = id === nameZh ? nameZh : `${nameZh} (${id})`;
  return { id, nameZh, label, description, gender, group, lang };
}

export const MIMO_TTS_VOICES: readonly MimoTtsVoice[] = [
  mimoVoice(
    "mimo_default",
    "MiMo 默认",
    "系统默认音色，中国集群一般为冰糖",
    "female",
    "chinese",
    "zh-CN",
  ),
  mimoVoice(
    "冰糖",
    "冰糖",
    "清甜明快，自然亲切的女声",
    "female",
    "chinese",
    "zh-CN",
  ),
  mimoVoice(
    "茉莉",
    "茉莉",
    "温柔淡雅，适合旁白与朗读",
    "female",
    "chinese",
    "zh-CN",
  ),
  mimoVoice(
    "苏打",
    "苏打",
    "清爽阳光，语气自然的男声",
    "male",
    "chinese",
    "zh-CN",
  ),
  mimoVoice(
    "白桦",
    "白桦",
    "沉稳干净，偏磁性的男声",
    "male",
    "chinese",
    "zh-CN",
  ),
  mimoVoice(
    "Mia",
    "Mia",
    "自然流畅的美式英语女声",
    "female",
    "english",
    "en-US",
  ),
  mimoVoice(
    "Chloe",
    "Chloe",
    "清晰明快的英语女声",
    "female",
    "english",
    "en-US",
  ),
  mimoVoice(
    "Milo",
    "Milo",
    "年轻有活力的英语男声",
    "male",
    "english",
    "en-US",
  ),
  mimoVoice(
    "Dean",
    "Dean",
    "低沉稳重的英语男声",
    "male",
    "english",
    "en-US",
  ),
];

const MIMO_TTS_VOICE_BY_ID = new Map(
  MIMO_TTS_VOICES.map((v) => [v.id, v] as const),
);

export function findMimoTtsVoice(id: string): MimoTtsVoice | undefined {
  return MIMO_TTS_VOICE_BY_ID.get(id.trim());
}

export function groupMimoTtsVoices(
  voices: readonly MimoTtsVoice[] = MIMO_TTS_VOICES,
): [string, readonly MimoTtsVoice[]][] {
  const order: MimoTtsVoiceGroup[] = ["chinese", "english"];
  const grouped = new Map<string, MimoTtsVoice[]>();
  for (const voice of voices) {
    const key = GROUP_LABELS[voice.group];
    const bucket = grouped.get(key) ?? [];
    bucket.push(voice);
    grouped.set(key, bucket);
  }
  return order
    .map((g) => GROUP_LABELS[g])
    .filter((label) => grouped.has(label))
    .map((label) => [label, grouped.get(label)!] as const);
}
