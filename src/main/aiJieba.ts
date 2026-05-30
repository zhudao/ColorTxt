import { createRequire } from "node:module";
import { Jieba } from "@node-rs/jieba";

const require = createRequire(import.meta.url);
const { dict } = require("@node-rs/jieba/dict") as { dict: Buffer };

/** bump when tokenizer rules or jieba dict changes */
export const AI_SEGMENT_VERSION = 1;

let jieba: Jieba | null = null;

function getJieba(): Jieba {
  if (!jieba) jieba = Jieba.withDict(dict);
  return jieba;
}

function isValidToken(w: string): boolean {
  const t = w.trim();
  if (!t) return false;
  if (/^[\d\s\p{P}\p{S}]+$/u.test(t)) return false;
  if (t.length === 1 && !/[\u4e00-\u9fff]/.test(t)) return false;
  return true;
}

/** 分词并过滤无效 token */
export function tokenizeForWordcloud(text: string): string[] {
  if (!text.trim()) return [];
  return getJieba()
    .cut(text, true)
    .map((w) => w.trim())
    .filter(isValidToken);
}

/** 统计词频 */
export function countTokens(tokens: readonly string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return freq;
}
