import {
  isVoiceReadFilterRuleValid,
  type VoiceReadFilterRule,
} from "../../constants/voiceReadSpeak";
import { hasVoiceReadSpeakableText } from "./voiceReadTextChunks";
import type { VoiceReadSpeakChunk } from "./voiceReadVoiceResolve";

function compileFilterRegex(pattern: string): RegExp | null {
  // `s`：`.` 匹配换行（括号等可跨行）；`m`：`^`/`$` 仍按行锚点（全文拼接后过滤）
  try {
    return new RegExp(pattern, "gums");
  } catch {
    try {
      return new RegExp(pattern, "gms");
    } catch {
      try {
        return new RegExp(pattern, "gus");
      } catch {
        try {
          return new RegExp(pattern, "gs");
        } catch {
          try {
            return new RegExp(pattern, "gu");
          } catch {
            try {
              return new RegExp(pattern, "g");
            } catch {
              return null;
            }
          }
        }
      }
    }
  }
}

/** 命中段换成空格，换行保留，行数/行号不变。 */
function maskFilterMatch(match: string): string {
  return match.replace(/[^\n\r]/g, " ");
}

function applyLiteralFilter(text: string, pattern: string): string {
  if (!pattern) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const j = text.indexOf(pattern, i);
    if (j < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, j) + maskFilterMatch(pattern);
    i = j + pattern.length;
  }
  return out;
}

function applyOneFilterRule(text: string, rule: VoiceReadFilterRule): string {
  const pattern = rule.pattern;
  if (!pattern) return text;
  if (!isVoiceReadFilterRuleValid(rule)) return text;
  try {
    if (rule.isRegex) {
      const re = compileFilterRegex(pattern);
      if (!re) return text;
      return text.replace(re, maskFilterMatch);
    }
    return applyLiteralFilter(text, pattern);
  } catch {
    return text;
  }
}

function hasEnabledFilterRule(rules: readonly VoiceReadFilterRule[]): boolean {
  return rules.some((r) => r.isEnabled && r.pattern.trim());
}

/** 按 order 套用已启用规则；跨行命中时保留换行。 */
export function applyVoiceReadFilterRules(
  text: string,
  rules: readonly VoiceReadFilterRule[],
): string {
  if (!text || !hasEnabledFilterRule(rules)) return text;
  let out = text;
  const sorted = [...rules].sort((a, b) => a.order - b.order);
  for (const rule of sorted) {
    if (!rule.isEnabled) continue;
    if (!rule.pattern.trim()) continue;
    out = applyOneFilterRule(out, rule);
  }
  return out;
}

/**
 * 按行过滤：先拼成全文再匹配，以便括号等规则跨行命中；
 * 换行保留，结果行数与输入对齐。
 */
export function applyVoiceReadFilterRulesToLines(
  lines: readonly string[],
  rules: readonly VoiceReadFilterRule[],
): string[] {
  if (lines.length === 0) return [];
  if (!hasEnabledFilterRule(rules)) return lines.slice();
  const filtered = applyVoiceReadFilterRules(lines.join("\n"), rules);
  const out = filtered.split("\n");
  if (out.length === lines.length) return out;
  if (out.length < lines.length) {
    while (out.length < lines.length) out.push("");
    return out;
  }
  return out.slice(0, lines.length);
}

export function voiceReadTextIsSpeakableAfterFilter(
  text: string,
  rules: readonly VoiceReadFilterRule[],
): boolean {
  return hasVoiceReadSpeakableText(applyVoiceReadFilterRules(text, rules));
}

export function filterVoiceReadSpeakChunks(
  chunks: readonly VoiceReadSpeakChunk[],
  rules: readonly VoiceReadFilterRule[],
): VoiceReadSpeakChunk[] {
  if (!hasEnabledFilterRule(rules)) {
    return chunks.map((c) => ({ ...c }));
  }
  const out: VoiceReadSpeakChunk[] = [];
  for (const chunk of chunks) {
    const text = applyVoiceReadFilterRules(chunk.text, rules);
    if (!hasVoiceReadSpeakableText(text)) continue;
    out.push({ ...chunk, text });
  }
  return out;
}
