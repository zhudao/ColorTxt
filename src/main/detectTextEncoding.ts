import { open } from "node:fs/promises";
import iconv from "iconv-lite";
import jschardet from "jschardet";

const SAMPLE_BYTES = 64 * 1024;
/** 短样本上 chardet 统计不可靠，需结合字节结构启发式 */
const SHORT_SAMPLE_BYTES = 512;
const CHARDET_CONFIDENCE_MIN = 0.7;

const WESTERN_CHARDET_ENCODINGS = new Set([
  "ascii",
  "iso-8859-1",
  "iso-8859-2",
  "iso-8859-15",
  "windows-1250",
  "windows-1252",
  "latin1",
  "latin-1",
  "cp1252",
]);

function normalizeEncodingName(raw: string): string {
  const u = raw.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
  if (!u) return "utf8";
  if (u === "utf-8" || u === "utf8") return "utf8";
  if (u === "gb2312" || u === "gbk" || u === "gb-2312") return "gb18030";
  if (u === "utf-16le" || u === "utf-16-le") return "utf16le";
  if (u === "utf-16be" || u === "utf-16-be") return "utf16be";
  return raw.trim();
}

function encodingFromBom(sample: Buffer): string | null {
  if (
    sample.length >= 3 &&
    sample[0] === 0xef &&
    sample[1] === 0xbb &&
    sample[2] === 0xbf
  ) {
    return "utf8";
  }
  if (sample.length >= 2) {
    if (sample[0] === 0xff && sample[1] === 0xfe) return "utf16le";
    if (sample[0] === 0xfe && sample[1] === 0xff) return "utf16be";
  }
  return null;
}

function isAsciiOnly(sample: Buffer): boolean {
  for (let i = 0; i < sample.length; i++) {
    if (sample[i]! >= 0x80) return false;
  }
  return true;
}

function isValidUtf8(sample: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function isGbkLead(byte: number): boolean {
  return byte >= 0x81 && byte <= 0xfe;
}

function isGbkTrail(byte: number): boolean {
  return (byte >= 0x40 && byte <= 0x7e) || (byte >= 0x80 && byte <= 0xfe);
}

/** 非 ASCII 字节是否均可按 GBK/GB18030 双字节序列解析（含尾部不完整时仍视为可能为中文 ANSI） */
function looksLikeGbkFamily(sample: Buffer): boolean {
  let i = 0;
  let hasHighByte = false;
  while (i < sample.length) {
    const b = sample[i]!;
    if (b < 0x80) {
      i++;
      continue;
    }
    hasHighByte = true;
    if (!isGbkLead(b)) return false;
    if (i + 1 >= sample.length) return true;
    if (!isGbkTrail(sample[i + 1]!)) return false;
    i += 2;
  }
  return hasHighByte;
}

function isChineseLocale(locale: string | undefined): boolean {
  const l = (locale ?? "").toLowerCase();
  return l.startsWith("zh");
}

function shouldPreferGbkFamily(
  sample: Buffer,
  chardetEncoding: string | undefined,
  confidence: number,
  locale: string | undefined,
): boolean {
  if (!looksLikeGbkFamily(sample) || isValidUtf8(sample)) return false;

  const enc = (chardetEncoding ?? "").toLowerCase().replace(/\s+/g, "");
  if (sample.length < SHORT_SAMPLE_BYTES) return true;
  if (confidence < CHARDET_CONFIDENCE_MIN) return true;
  if (enc && WESTERN_CHARDET_ENCODINGS.has(enc)) return true;
  if (isChineseLocale(locale) && enc !== "gb18030" && enc !== "gb2312" && enc !== "gbk") {
    return confidence < 0.9;
  }
  return false;
}

/**
 * 根据文件头字节推断文本编码（供 iconv-lite 解码）。
 * @param locale 可选，如 Electron `app.getLocale()`（`zh-CN`），用于低置信度时的中文 ANSI 回退。
 */
export function detectEncodingFromSample(
  sample: Buffer,
  locale?: string,
): string {
  if (sample.length === 0) return "utf8";

  const bom = encodingFromBom(sample);
  if (bom) return bom;
  if (isAsciiOnly(sample)) return "utf8";
  if (isValidUtf8(sample)) return "utf8";

  const detected = jschardet.detect(sample);
  const chardetEnc =
    typeof detected?.encoding === "string" ? detected.encoding.trim() : "";
  const confidence =
    typeof detected?.confidence === "number" ? detected.confidence : 0;

  if (
    shouldPreferGbkFamily(sample, chardetEnc || undefined, confidence, locale)
  ) {
    return "gb18030";
  }

  if (chardetEnc && confidence >= CHARDET_CONFIDENCE_MIN) {
    const normalized = normalizeEncodingName(chardetEnc);
    if (iconv.encodingExists(normalized)) return normalized;
  }

  if (chardetEnc) {
    const normalized = normalizeEncodingName(chardetEnc);
    if (iconv.encodingExists(normalized)) return normalized;
  }

  if (looksLikeGbkFamily(sample)) return "gb18030";
  return "utf8";
}

export async function detectTextFileEncoding(
  filePath: string,
  locale?: string,
): Promise<string> {
  const fd = await open(filePath, "r");
  const header = Buffer.alloc(SAMPLE_BYTES);
  const { bytesRead } = await fd.read(header, 0, header.length, 0);
  await fd.close();
  if (bytesRead === 0) return "utf8";
  return detectEncodingFromSample(header.subarray(0, bytesRead), locale);
}

function isUtf8RequestCharset(charset?: string): boolean {
  const cs = charset?.trim().toLowerCase();
  return !cs || cs === "utf-8" || cs === "utf8";
}

function decodeWithEncoding(raw: Buffer, encoding: string): string | undefined {
  const normalized = normalizeEncodingName(encoding);
  if (!iconv.encodingExists(normalized)) return undefined;
  try {
    return iconv.decode(raw, normalized);
  } catch {
    return undefined;
  }
}

/** 从 HTML 头部 meta 标签解析 charset（书源站点常见 gbk 但未写 Content-Type charset） */
function parseHtmlCharsetFromSample(sample: Buffer): string | undefined {
  const head = sample.subarray(0, Math.min(sample.length, 8192)).toString("latin1");
  const meta =
    head.match(/<meta[^>]+charset=["']?\s*([a-z0-9_-]+)/i) ??
    head.match(/charset\s*=\s*["']?\s*([a-z0-9_-]+)/i);
  const enc = meta?.[1]?.trim();
  if (!enc) return undefined;
  const normalized = normalizeEncodingName(enc);
  return iconv.encodingExists(normalized) ? normalized : enc;
}

export type DecodeHttpResponseBodyOptions = {
  /** 书源 URL 选项或 searchUrl 内嵌 JSON 指定的 charset */
  charset?: string;
  contentType?: string | null;
  locale?: string;
};

/**
 * 解码书源 HTTP 响应体：Content-Type charset → 请求 charset → HTML meta → 字节探测。
 */
export function decodeHttpResponseBody(
  raw: Buffer,
  opts: DecodeHttpResponseBodyOptions = {},
): string {
  const ctCharset = opts.contentType?.match(/charset=([^;]+)/i)?.[1]?.trim();
  if (ctCharset) {
    const decoded = decodeWithEncoding(raw, ctCharset);
    if (decoded != null) return decoded;
  }

  const reqCharset = opts.charset?.trim();
  if (reqCharset && !isUtf8RequestCharset(reqCharset)) {
    const decoded = decodeWithEncoding(raw, reqCharset);
    if (decoded != null) return decoded;
  }

  const metaCharset = parseHtmlCharsetFromSample(raw);
  if (metaCharset) {
    const decoded = decodeWithEncoding(raw, metaCharset);
    if (decoded != null) return decoded;
  }

  if (!reqCharset || isUtf8RequestCharset(reqCharset)) {
    if (!isValidUtf8(raw)) {
      const detected = detectEncodingFromSample(raw, opts.locale ?? "zh-CN");
      if (detected !== "utf8") {
        const decoded = decodeWithEncoding(raw, detected);
        if (decoded != null) return decoded;
      }
    }
    return raw.toString("utf8");
  }

  const decoded = decodeWithEncoding(raw, reqCharset);
  return decoded ?? raw.toString("utf8");
}
