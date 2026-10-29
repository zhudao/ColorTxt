/**
 * 从 Edge Read Aloud 官方音色列表生成 src/shared/voiceReadEdgeTtsVoices.ts
 * 运行: node scripts/generate-edge-tts-voices.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src/shared/voiceReadEdgeTtsVoices.ts");

const EDGE_VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";

/** 微软/Azure 中文文档中的通用译名（拼音 → 汉字） */
const ZH_VOICE_NAMES = {
  Xiaoxiao: "晓晓",
  Xiaoyi: "晓伊",
  Yunjian: "云健",
  Yunxi: "云希",
  Yunxia: "云夏",
  Yunyang: "云扬",
  Xiaobei: "晓北",
  Xiaoni: "晓妮",
  HiuGaai: "晓佳",
  HiuMaan: "晓曼",
  WanLung: "云龙",
  HsiaoChen: "晓臻",
  HsiaoYu: "晓雨",
  YunJhe: "云哲",
};

const PERSONALITY_ZH = {
  Warm: "温暖",
  Lively: "活泼",
  Passion: "激情",
  Sunshine: "阳光",
  Cute: "可爱",
  Professional: "专业",
  Reliable: "可靠",
  Humorous: "幽默",
  Bright: "明亮",
  Friendly: "友善",
  Positive: "积极",
};

const CATEGORY_ZH = {
  News: "新闻",
  Novel: "小说",
  Cartoon: "卡通",
  Sports: "体育",
  Dialect: "方言",
  General: "通用",
};

function shortVoiceName(shortName) {
  const parts = shortName.split("-");
  const last = parts[parts.length - 1] ?? shortName;
  return last.replace(/Neural$/u, "");
}

function isZhLocale(locale) {
  return locale.toLowerCase().startsWith("zh");
}

function describeVoice(voice) {
  const tag = voice.VoiceTag ?? {};
  const personalities = (tag.VoicePersonalities ?? [])
    .map((p) => p.trim())
    .filter(Boolean);
  const categories = (tag.ContentCategories ?? [])
    .map((c) => c.trim())
    .filter(Boolean);
  const zh = isZhLocale(voice.Locale);
  const parts = [];
  const joiner = zh ? "、" : ", ";
  if (personalities.length) {
    parts.push(
      personalities
        .map((p) => (zh ? (PERSONALITY_ZH[p] ?? p) : p))
        .join(joiner),
    );
  }
  if (categories.length) {
    parts.push(
      categories.map((c) => (zh ? (CATEGORY_ZH[c] ?? c) : c)).join(joiner),
    );
  }
  return parts.join(" · ") || undefined;
}

function buildLabel(name, nameZh, shortName) {
  if (nameZh) return `${nameZh} (${name})`;
  return name;
}

function tsString(value) {
  return JSON.stringify(value);
}

async function main() {
  const res = await fetch(EDGE_VOICES_URL);
  if (!res.ok) throw new Error(`Edge voices API ${res.status}`);
  const payload = await res.json();
  const apiVoices = payload.value ?? payload;
  if (!Array.isArray(apiVoices)) throw new Error("Unexpected API shape");

  const sorted = [...apiVoices].sort((a, b) =>
    a.ShortName.localeCompare(b.ShortName),
  );

  const lines = [];
  lines.push("/** Edge Read Aloud 音色表（由 scripts/generate-edge-tts-voices.mjs 生成） */");
  lines.push("");
  lines.push('export type EdgeTtsVoiceGender = "male" | "female";');
  lines.push("");
  lines.push("export type EdgeTtsVoice = {");
  lines.push("  id: string;");
  lines.push("  lang: string;");
  lines.push("  gender: EdgeTtsVoiceGender;");
  lines.push("  /** 英文短名，如 Xiaoxiao */");
  lines.push("  name: string;");
  lines.push("  /** 官方/通用中文名（仅中文及相关方言音色） */");
  lines.push("  nameZh?: string;");
  lines.push("  /** 下拉主行文案 */");
  lines.push("  label: string;");
  lines.push("  /** 下拉副行说明 */");
  lines.push("  description?: string;");
  lines.push("};");
  lines.push("");
  lines.push("function edgeVoice(");
  lines.push("  id: string,");
  lines.push("  lang: string,");
  lines.push('  gender: EdgeTtsVoiceGender,');
  lines.push("  name: string,");
  lines.push("  label: string,");
  lines.push("  nameZh?: string,");
  lines.push("  description?: string,");
  lines.push("): EdgeTtsVoice {");
  lines.push("  return { id, lang, gender, name, nameZh, label, description };");
  lines.push("}");
  lines.push("");
  lines.push("/** 与 Edge Read Aloud 在线列表同步的 Neural 音色 */");
  lines.push("export const EDGE_TTS_VOICES: readonly EdgeTtsVoice[] = [");

  for (const v of sorted) {
    const id = v.ShortName;
    const lang = v.Locale;
    const gender = v.Gender === "Male" ? "male" : "female";
    const name = shortVoiceName(id);
    const nameZh = isZhLocale(lang) ? (ZH_VOICE_NAMES[name] ?? undefined) : undefined;
    const description = describeVoice(v);
    const label = buildLabel(name, nameZh, id);
    const args = [
      tsString(id),
      tsString(lang),
      tsString(gender),
      tsString(name),
      tsString(label),
    ];
    if (nameZh) args.push(tsString(nameZh));
    else if (description) args.push("undefined");
    if (description) {
      if (!nameZh) args.push(tsString(description));
      else args.push(tsString(description));
    }
    // Fix args: edgeVoice(id, lang, gender, name, label, nameZh?, description?)
    const callArgs = [
      tsString(id),
      tsString(lang),
      tsString(gender),
      tsString(name),
      tsString(label),
    ];
    if (nameZh) {
      callArgs.push(tsString(nameZh));
      if (description) callArgs.push(tsString(description));
    } else if (description) {
      callArgs.push("undefined", tsString(description));
    }
    lines.push(`  edgeVoice(${callArgs.join(", ")}),`);
  }

  lines.push("];");
  lines.push("");
  lines.push("export function findEdgeTtsVoice(id: string): EdgeTtsVoice | undefined {");
  lines.push('  const key = id.trim();');
  lines.push("  return EDGE_TTS_VOICES.find((v) => v.id === key);");
  lines.push("}");
  lines.push("");
  lines.push("export function inferEdgeVoiceGender(id: string): EdgeTtsVoiceGender | undefined {");
  lines.push("  return findEdgeTtsVoice(id)?.gender;");
  lines.push("}");
  lines.push("");

  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`Wrote ${sorted.length} voices to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
