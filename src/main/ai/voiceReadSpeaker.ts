import type { AIChatEndpoint } from "@shared/aiTypes";
import type { AITokenUsageTotals } from "@shared/aiTokenUsage";
import {
  normalizeVoiceReadEmotion,
  VOICE_READ_EMOTION_AUTO,
  type VoiceReadEmotionId,
} from "@shared/voiceReadEmotion";
import type {
  VoiceReadAttributeSpeakersRequest,
  VoiceReadQuoteAttribution,
  VoiceReadQuoteVoiceKind,
} from "@shared/voiceReadSpeakerIpc";
import { chatCompletionOnce } from "./chat/chat";

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return m ? m[1]!.trim() : t;
}

function normalizeQuoteKind(raw: unknown): VoiceReadQuoteVoiceKind {
  if (typeof raw !== "string") return "unknown";
  const k = raw.trim().toLowerCase();
  if (
    k === "narration" ||
    k === "非对白" ||
    k === "旁白" ||
    k === "non_dialogue"
  ) {
    return "narration";
  }
  if (k === "male" || k === "男声" || k === "男") return "male";
  if (k === "female" || k === "女声" || k === "女") return "female";
  return "unknown";
}

function unknownQuotes(count: number): VoiceReadQuoteAttribution[] {
  return Array.from({ length: count }, () => ({
    kind: "unknown" as const,
    speaker: null,
    emotion: VOICE_READ_EMOTION_AUTO,
  }));
}

function parseQuoteEmotion(
  raw: unknown,
  kind: VoiceReadQuoteVoiceKind,
): VoiceReadEmotionId {
  if (kind === "narration") {
    const e = normalizeVoiceReadEmotion(raw);
    return e === VOICE_READ_EMOTION_AUTO ? "calm" : e;
  }
  return normalizeVoiceReadEmotion(raw);
}

function buildRosterNameMap(
  roster: VoiceReadAttributeSpeakersRequest["roster"],
): Map<string, string> {
  const nameSet = new Map<string, string>();
  for (const r of roster) {
    const dn = r.displayName.trim();
    if (dn) nameSet.set(dn.toLowerCase(), dn);
    for (const a of r.aliases) {
      const al = a.trim();
      if (al) nameSet.set(al.toLowerCase(), dn);
    }
  }
  return nameSet;
}

function normalizeSpeaker(
  raw: unknown,
  nameSet: Map<string, string>,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return nameSet.get(key) ?? raw.trim();
}

function parseQuoteAttribution(
  raw: unknown,
  nameSet: Map<string, string>,
  includeEmotion: boolean,
): VoiceReadQuoteAttribution {
  if (!raw || typeof raw !== "object") {
    return { kind: "unknown", speaker: null, emotion: VOICE_READ_EMOTION_AUTO };
  }
  const o = raw as Record<string, unknown>;
  const kind = normalizeQuoteKind(o.kind ?? o.type ?? o.label);
  const speaker = normalizeSpeaker(o.speaker ?? o.name, nameSet);
  const emotion = includeEmotion
    ? parseQuoteEmotion(o.emotion, kind)
    : VOICE_READ_EMOTION_AUTO;
  if (kind === "narration") {
    return { kind: "narration", speaker: null, emotion };
  }
  return { kind, speaker, emotion };
}

function parseLegacySpeakers(
  speakers: unknown[],
  quoteCount: number,
  nameSet: Map<string, string>,
): VoiceReadQuoteAttribution[] {
  const out: VoiceReadQuoteAttribution[] = [];
  for (let i = 0; i < quoteCount; i++) {
    const speaker = normalizeSpeaker(speakers[i], nameSet);
    out.push({ kind: "unknown", speaker, emotion: VOICE_READ_EMOTION_AUTO });
  }
  return out;
}

export async function attributeVoiceReadSpeakers(
  chat: AIChatEndpoint,
  req: VoiceReadAttributeSpeakersRequest,
  signal?: AbortSignal,
): Promise<{
  quotes: VoiceReadQuoteAttribution[];
  narrationEmotion: VoiceReadEmotionId;
  tokenUsage: AITokenUsageTotals | null;
}> {
  const quoteTexts = req.dialogueTexts.map((t) => t.trim()).filter(Boolean);
  if (quoteTexts.length === 0) {
    return {
      quotes: [],
      narrationEmotion: VOICE_READ_EMOTION_AUTO,
      tokenUsage: null,
    };
  }

  const includeEmotion = req.includeEmotion === true;

  const rosterLines =
    req.roster.length > 0
      ? req.roster
          .map((r) => {
            const aliasPart =
              r.aliases.length > 0
                ? `（别名：${r.aliases.map((a) => `「${a}」`).join("、")}）`
                : "";
            return `- ${r.displayName}${aliasPart}`;
          })
          .join("\n")
      : "（无角色卡）";

  const quoteList = quoteTexts
    .map((t, i) => `${i + 1}. 「${t}」`)
    .join("\n");

  const contextBefore = (req.contextBefore ?? [])
    .map((t) => t.trim())
    .filter(Boolean);
  const contextAfter = (req.contextAfter ?? [])
    .map((t) => t.trim())
    .filter(Boolean);

  const emotionBlock = includeEmotion
    ? `

同时根据当前行原文（含引号外引导语、叙述）及上下参考文标注朗读情绪 emotion：
- 用简短中文自然语言描述语气/情绪（10～30 字），如「语气关切、略带担忧」「冷淡、不带感情」「哽咽、压抑悲伤」「俏皮、略带调侃」等，可覆盖任意细腻情绪。
- 不确定或无需强调时填 auto（由引擎根据文本推断）。
- kind 为 narration 时 emotion 一般用「语气平静、自然」或 auto。
- 对白应结合引导语判断，如「冷冷地说」「哽咽道」等。

另输出 narrationEmotion 表示本行引号外旁白段的整体情绪（一般用「语气平静、自然」或 auto）。`
    : "";

  const jsonShape = includeEmotion
    ? `{ "quotes": [ { "kind": "narration"|"male"|"female"|"unknown", "speaker": string|null, "emotion": string }, ... ], "narrationEmotion": string }`
    : `{ "quotes": [ { "kind": "narration"|"male"|"female"|"unknown", "speaker": string|null }, ... ] }`;

  const system = `你是中文小说「引号内文本」朗读分类助手。
用户会给出当前行原文、按顺序提取的引号内文本列表，以及上下邻近原文（仅供参考）。请只对当前行的每一条引号内文本判断应如何朗读：

1. kind = "narration"（非对白 / 旁白）：引号内不是角色说出来的话，而是旁白中的强调、术语、招式名、书名、反话、借用等；或无法当作对白朗读的内容。
2. kind = "male" | "female" | "unknown"（对白）：角色说出来的话。无法确定性别时用 "unknown"。

说话人 speaker：若对白且能对应角色表中的 displayName，填该名（可用别名推断，但输出必须是角色表 displayName）；否则填 null。
kind 为 "narration" 时 speaker 必须为 null。

注意：
- 引导语可在引号前或后，如「杨过道："…"」或「"…"杨过道。」；也可能出现在上一行/下一行；没有引导语时，两人轮流对话需结合上文/下文推断说话人与性别。
- 上文/下文只用于推断，不要为它们输出 quotes，也不要改写当前行。
- 不要仅凭「引号」就假设是对白；强调、术语、招式名等应为 narration。
- 不要自行穷举招式等特例，根据语义判断是否为角色开口说话。${emotionBlock}

输出必须是单一 JSON 对象，不要 Markdown、不要代码围栏：
${jsonShape}
quotes 数组长度必须与引号条数相同，顺序一一对应。`;

  const beforeBlock =
    contextBefore.length > 0
      ? `## 上文（仅供参考，勿标注）
${contextBefore.map((t, i) => `${i + 1}. ${t}`).join("\n")}

`
      : "";
  const afterBlock =
    contextAfter.length > 0
      ? `
## 下文（仅供参考，勿标注）
${contextAfter.map((t, i) => `${i + 1}. ${t}`).join("\n")}
`
      : "";

  const user = `## 角色表
${rosterLines}

${beforeBlock}## 当前行原文
${req.line.trim()}

## 引号内文本列表（按顺序）
${quoteList}
${afterBlock}
请输出 JSON。`;

  const { text: raw, usage } = await chatCompletionOnce({
    chat,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: Math.min(chat.maxTokens, 768),
    temperature: Math.min(chat.temperature, 0.3),
    signal,
  });

  const stripped = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped) as unknown;
  } catch {
    return {
      quotes: unknownQuotes(quoteTexts.length),
      narrationEmotion: VOICE_READ_EMOTION_AUTO,
      tokenUsage: usage,
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      quotes: unknownQuotes(quoteTexts.length),
      narrationEmotion: VOICE_READ_EMOTION_AUTO,
      tokenUsage: usage,
    };
  }

  const nameSet = buildRosterNameMap(req.roster);
  const record = parsed as Record<string, unknown>;
  const rawQuotes = record.quotes;
  const narrationEmotion = includeEmotion
    ? normalizeVoiceReadEmotion(record.narrationEmotion)
    : VOICE_READ_EMOTION_AUTO;

  if (Array.isArray(rawQuotes)) {
    const out: VoiceReadQuoteAttribution[] = [];
    for (let i = 0; i < quoteTexts.length; i++) {
      out.push(parseQuoteAttribution(rawQuotes[i], nameSet, includeEmotion));
    }
    return { quotes: out, narrationEmotion, tokenUsage: usage };
  }

  const rawSpeakers = record.speakers;
  if (Array.isArray(rawSpeakers)) {
    return {
      quotes: parseLegacySpeakers(rawSpeakers, quoteTexts.length, nameSet),
      narrationEmotion,
      tokenUsage: usage,
    };
  }

  return {
    quotes: unknownQuotes(quoteTexts.length),
    narrationEmotion,
    tokenUsage: usage,
  };
}
