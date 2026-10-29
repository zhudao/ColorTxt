/** MiniMax 音色性别（API 无 gender 字段，由 id / 名称 / 描述推断） */

export type MinimaxVoiceGender = "male" | "female";

function inferMinimaxGenderFromVoiceId(id: string): MinimaxVoiceGender | undefined {
  const s = id.trim();
  if (!s) return undefined;

  if (/^female(?:[-_]|$)/i.test(s)) return "female";
  if (/^male(?:[-_]|$)/i.test(s)) return "male";
  if (/presenter_female/i.test(s)) return "female";
  if (/presenter_male/i.test(s)) return "male";

  if (/(?:^|[_-])Female(?:[_-]|$)/i.test(s)) return "female";
  if (/(?:^|[_-])Male(?:[_-]|$)/i.test(s)) return "male";

  if (
    /(?:Young_Man|Gentleman|Straightforward_Boy|Pure-hearted_Boy|PlayfulMan|ProfessionalHost(?:（|\()M(?:\)|）)|_Boy(?:_|$)|clever_boy|cute_boy|bingjiao_didi|junlang_nanyou|chunzhen_xuedi|lengdan_xiongzhang|badao_shaoye|nanyou|didi|xiongzhang|shaoye)/i.test(
      s,
    )
  ) {
    return "male";
  }

  if (
    /(?:Mature_Woman|Warm_Girl|Soft_Girl|Crisp_Girl|CuteGirl|KindWoman|GentleLady|ProfessionalHost(?:（|\()F(?:\)|）)|Wise_Women|Sweet_Lady|Arrogant_Miss|Warm_Bestie|Kind-hearted_Antie|lovely_girl|qiaopi_mengmei|wumei_yujie|diadia_xuemei|danya_xuejie|tianxin_xiaoling|mengmei|xuemei|xuejie|_Girl(?:_|$)|_Lady(?:_|$)|_Miss(?:_|$)|_Woman(?:_|$)|_Women(?:_|$)|_Bestie|_Antie)/i.test(
      s,
    )
  ) {
    return "female";
  }

  return undefined;
}

function inferMinimaxGenderFromText(text: string): MinimaxVoiceGender | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const femalePatterns = [
    /女(?:声|童|生|青年|性|王|主播|主持|教师)/,
    /(?:少年|青年|中年|老年)女/,
    /少女/,
    /御姐/,
    /学姐/,
    /学妹/,
    /姐姐/,
    /妹妹/,
    /女童/,
    /女孩/,
    /小姐/,
    /闺蜜/,
    /大婶/,
    /空姐/,
    /奶奶/,
    /萌妹/,
    /公主/,
    /女声/,
    /女性/,
  ] as const;

  for (const pattern of femalePatterns) {
    if (pattern.test(t)) return "female";
  }

  const malePatterns = [
    /男(?:声|童|生|青年|性|主播|主持|教师)/,
    /(?:少年|青年|中年|老年)男/,
    /男童/,
    /男孩/,
    /学弟/,
    /学长/,
    /哥哥/,
    /弟弟/,
    /男友/,
    /少爷/,
    /公子/,
    /王子/,
    /竹马/,
    /小哥/,
    /大爷/,
    /男主播/,
    /播报男/,
    /男性/,
  ] as const;

  for (const pattern of malePatterns) {
    if (pattern.test(t)) return "male";
  }

  return undefined;
}

export function inferMinimaxVoiceGender(
  voiceId: string,
  label?: string,
  description?: string,
): MinimaxVoiceGender | undefined {
  const fromId = inferMinimaxGenderFromVoiceId(voiceId);
  if (fromId) return fromId;

  const text = [label, description].filter(Boolean).join(" ");
  return inferMinimaxGenderFromText(text);
}
