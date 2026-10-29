/**
 * 排版 completion 与输入长度接近；单段正文字数须落在用户 `maxTokens` 能完整输出的范围内。
 * 中文正文在常见对话模型上约 1 字 ≈ 1 completion token，留约 10% 给标点微调与余量。
 */
export const SMART_FORMAT_CHUNK_CHARS_PER_OUTPUT_TOKEN = 0.9;

export const SMART_FORMAT_CHUNK_MAX_CHARS_CAP = 8000;
export const SMART_FORMAT_CHUNK_MIN_CHARS = 1500;

const DEFAULT_MAX_TOKENS = 4096;

/** 由对话 `maxTokens` 推算单段正文字符上限（绝不超过 completion 预算） */
export function resolveSmartFormatChunkMaxChars(maxTokens?: number): number {
  const tokens = Math.max(
    256,
    Math.min(
      128_000,
      Math.trunc(
        typeof maxTokens === "number" && Number.isFinite(maxTokens)
          ? maxTokens
          : DEFAULT_MAX_TOKENS,
      ),
    ),
  );
  const derived = Math.floor(
    tokens * SMART_FORMAT_CHUNK_CHARS_PER_OUTPUT_TOKEN,
  );
  return Math.max(
    SMART_FORMAT_CHUNK_MIN_CHARS,
    Math.min(SMART_FORMAT_CHUNK_MAX_CHARS_CAP, derived),
  );
}

/**
 * 将文本切成不超过 `maxChars` 的块。
 * 优先在换行处切；仅当单行长度超过 `maxChars` 时才在行内硬切。
 */
export function splitTextByMaxChars(text: string, maxChars: number): string[] {
  if (maxChars < 1) return text ? [text] : [];
  if (text.length <= maxChars) return [text];

  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    const remain = text.length - i;
    if (remain <= maxChars) {
      parts.push(text.slice(i));
      break;
    }
    let end = i + maxChars;
    const slice = text.slice(i, end);
    const lastNl = slice.lastIndexOf("\n");
    if (lastNl > 0) {
      end = i + lastNl + 1;
    }
    parts.push(text.slice(i, end));
    i = end;
  }
  return parts;
}

/** 单段请求建议的 completion `max_tokens`（不超过用户配置） */
export function smartFormatCompletionMaxTokens(
  segmentCharLength: number,
  configuredMaxTokens: number,
): number {
  const configured = Math.max(
    256,
    Math.min(128_000, Math.trunc(configuredMaxTokens)),
  );
  const need = Math.ceil(
    Math.max(1, segmentCharLength) /
      SMART_FORMAT_CHUNK_CHARS_PER_OUTPUT_TOKEN,
  );
  return Math.min(configured, Math.max(512, need));
}
