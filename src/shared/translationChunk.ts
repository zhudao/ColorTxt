/** 翻译请求按服务商字数上限切分（优先段落 / 句子边界） */

import type { TranslationProviderId } from "./translationTypes";

/** 各服务单次请求保守上限（UTF-16 code unit 近似字符数） */
export const TRANSLATION_PROVIDER_MAX_CHARS: Record<
  TranslationProviderId,
  number
> = {
  /** Edge 通道偏严；官方 Azure 更高，此处按免费通道保守取值 */
  microsoft: 4500,
  google: 4500,
  /** 对齐 Readest Android 通道经验值 */
  yandex: 600,
  deepl: 10000,
  /** AI：按字符切输入；输出另受 maxTokens 约束 */
  ai: 8000,
  baidu: 5000,
  youdao: 4500,
  tencent: 5000,
  volcengine: 4500,
  aliyun: 4500,
};

const BREAK_CHARS = new Set([
  "\n",
  "。",
  "！",
  "？",
  "；",
  ".",
  "!",
  "?",
  ";",
  "…",
]);

/**
 * 将长文本切成不超过 `maxLength` 的片段。
 * 优先在段落空行、换行、句读处切开，避免拆开代理对。
 */
export function splitTextIntoTranslationChunks(
  text: string,
  maxLength: number,
): string[] {
  const limit = Math.max(1, Math.floor(maxLength));
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      let cut = -1;
      const para = window.lastIndexOf("\n\n");
      if (para >= Math.floor(limit * 0.35)) cut = para + 2;
      if (cut < 0) {
        const nl = window.lastIndexOf("\n");
        if (nl >= Math.floor(limit * 0.4)) cut = nl + 1;
      }
      if (cut < 0) {
        for (let i = window.length - 1; i >= Math.floor(limit * 0.4); i--) {
          if (BREAK_CHARS.has(window[i]!)) {
            cut = i + 1;
            break;
          }
        }
      }
      if (cut < 0) {
        const sp = window.lastIndexOf(" ");
        if (sp >= Math.floor(limit * 0.5)) cut = sp + 1;
      }
      if (cut > 0) end = start + cut;
      // 避免切开代理对（高位在 end-1）
      if (
        end > start &&
        end < text.length &&
        text.charCodeAt(end - 1) >= 0xd800 &&
        text.charCodeAt(end - 1) <= 0xdbff
      ) {
        end -= 1;
      }
      if (end <= start) {
        end = Math.min(start + limit, text.length);
      }
    }
    const piece = text.slice(start, end);
    if (piece) chunks.push(piece);
    start = end;
  }
  return chunks.length > 0 ? chunks : [text];
}

export function translationMaxCharsForProvider(
  provider: TranslationProviderId,
): number {
  return TRANSLATION_PROVIDER_MAX_CHARS[provider] ?? 4500;
}
