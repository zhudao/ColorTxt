import type { BookSourceRecord } from "@shared/bookSource/types";
import { nativeImage } from "electron";
import { normalizeBookSourceBaseUrl, resolveAbsoluteUrl } from "@shared/bookSource/url";
import { registerRemoteCoverBytes } from "../../colortxtLocalProtocol";
import { cookieHeaderForUrl } from "./cookieManager";
import { createJsExtensionHost } from "./jsExtensions";
import { resolveSourceRequestHeaders } from "./sourceRequestHeaders";
import { evalJs } from "./rhinoRuntime";
import {
  splitUrlFetchOptions,
  type UrlFetchOptions,
} from "./analyzeUrl";
import { getBookSourceDispatcher } from "./httpProxy";

const COVER_FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** CDN 常返回 application/octet-stream，需按魔数识别 */
function sniffImageMime(body: Buffer): string | null {
  if (body.length < 12) return null;
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (
    body[0] === 0x89 &&
    body[1] === 0x50 &&
    body[2] === 0x4e &&
    body[3] === 0x47
  ) {
    return "image/png";
  }
  if (body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46) return "image/gif";
  if (
    body[0] === 0x52 &&
    body[1] === 0x49 &&
    body[2] === 0x46 &&
    body[3] === 0x46 &&
    body[8] === 0x57 &&
    body[9] === 0x45 &&
    body[10] === 0x42 &&
    body[11] === 0x50
  ) {
    return "image/webp";
  }
  if (body[0] === 0x42 && body[1] === 0x4d) return "image/bmp";
  if (
    body.length >= 12 &&
    body[4] === 0x66 &&
    body[5] === 0x74 &&
    body[6] === 0x79 &&
    body[7] === 0x70
  ) {
    const brand = body.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) {
      return "image/heic";
    }
  }
  return null;
}

function resolveCoverResponseMime(contentType: string | null, body: Buffer): string | null {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct.startsWith("image/")) return ct;
  return sniffImageMime(body);
}

function normalizeCoverUrl(raw: string, source: BookSourceRecord, baseUrl: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("colortxt-local:")) return url;
  if (url.startsWith("//")) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) {
    url = resolveAbsoluteUrl(
      normalizeBookSourceBaseUrl(baseUrl || source.bookSourceUrl),
      url,
    );
  }
  return url;
}

function applyCoverDecodeJs(
  source: BookSourceRecord,
  url: string,
  logs: string[],
): string {
  const script = source.coverDecodeJs?.trim();
  if (!script) return url;
  const host = createJsExtensionHost(source, logs);
  const out = evalJs(script, {
    source,
    host,
    result: url,
    baseUrl: source.bookSourceUrl,
  });
  const decoded = String(out ?? "").trim();
  return decoded || url;
}

/** Legado AnalyzeUrl.getGlideUrl：书源 header + URL 后缀 headers（后者覆盖） */
function mergeCoverFetchHeaders(
  sourceHeaders: Record<string, string>,
  urlOptions: UrlFetchOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...sourceHeaders,
    ...(urlOptions.headers ?? {}),
  };
  if (!headers["User-Agent"] && !headers["user-agent"]) {
    headers["User-Agent"] = COVER_FETCH_UA;
  }
  return headers;
}

/** 书源规则解析后的封面 HTTP URL（可持久化，供书架等场景重新代理） */
export function resolveCoverSourceUrl(
  source: BookSourceRecord,
  rawCoverUrl: string | undefined,
  baseUrl: string,
  logs: string[] = [],
): string | undefined {
  const trimmed = rawCoverUrl?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("colortxt-local:")) return undefined;
  if (/^[\[\]{},]+$/.test(trimmed)) return undefined;
  const { urlPart } = splitUrlFetchOptions(trimmed);
  if (!urlPart.trim() || /^[\[\]{},]+$/.test(urlPart.trim())) return undefined;
  let url = applyCoverDecodeJs(source, urlPart, logs);
  url = normalizeCoverUrl(url, source, baseUrl);
  if (!url || /\/[\[\]]$/.test(url) || /^[\[\]{},]+$/.test(url)) return undefined;
  return url || undefined;
}

function isHeicMime(mime: string): boolean {
  const ct = mime.toLowerCase();
  return ct.includes("heic") || ct.includes("heif");
}

async function convertHeicToJpeg(body: Buffer, logs: string[]): Promise<Buffer | null> {
  try {
    const mod = await import("heic-convert");
    const convert = mod.default ?? mod;
    const out = await convert({
      buffer: body,
      format: "JPEG",
      quality: 0.92,
    });
    const jpeg = Buffer.from(out);
    return jpeg.length > 32 ? jpeg : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`HEIC 转 JPEG 失败: ${msg}`);
    return null;
  }
}

async function convertCoverBytesForDisplay(
  body: Buffer,
  mime: string,
  logs: string[] = [],
): Promise<{ body: Buffer; mime: string }> {
  if (!isHeicMime(mime)) {
    return { body, mime };
  }
  const heicJpeg = await convertHeicToJpeg(body, logs);
  if (heicJpeg) return { body: heicJpeg, mime: "image/jpeg" };
  try {
    const img = nativeImage.createFromBuffer(body);
    if (!img.isEmpty()) {
      return { body: Buffer.from(img.toJPEG(92)), mime: "image/jpeg" };
    }
  } catch {
    /* nativeImage 在 Windows 上通常无法解码 HEIC */
  }
  logs.push("封面 HEIC 无法解码，已跳过");
  return { body, mime };
}

/** 拉取已规范化的封面 HTTP URL，返回 colortxt-local 代理地址 */
export async function fetchCoverDisplayUrl(
  source: BookSourceRecord,
  httpCoverUrl: string,
  logs: string[] = [],
  baseUrl?: string,
  urlOptions: UrlFetchOptions = {},
): Promise<string | undefined> {
  const { urlPart, options } = splitUrlFetchOptions(httpCoverUrl.trim());
  const url = urlPart.trim();
  if (!url) return undefined;
  if (url.startsWith("data:") || url.startsWith("colortxt-local:")) return url;

  const mergedOptions: UrlFetchOptions = {
    ...urlOptions,
    headers: { ...(urlOptions.headers ?? {}), ...(options.headers ?? {}) },
  };

  const cacheKey = `${source.bookSourceUrl}\0${url}`;
  const sourceHeaders = await resolveSourceRequestHeaders(source, {
    baseUrl: normalizeBookSourceBaseUrl(baseUrl || source.bookSourceUrl),
    logs,
  });
  const headers = mergeCoverFetchHeaders(sourceHeaders, mergedOptions);
  if (source.enabledCookieJar) {
    const ck = cookieHeaderForUrl(url);
    if (ck) {
      headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${ck}` : ck;
    }
  }

  try {
    const res = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      dispatcher: getBookSourceDispatcher(),
    } as RequestInit & { dispatcher?: unknown });
    if (!res.ok) {
      logs.push(`封面 HTTP ${res.status}: ${url.slice(0, 96)}`);
      return undefined;
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < 32) {
      logs.push(`封面内容过短: ${url.slice(0, 96)}`);
      return undefined;
    }
    const ct = resolveCoverResponseMime(res.headers.get("content-type"), body);
    if (!ct) {
      logs.push(
        `封面非图片 (${res.headers.get("content-type") ?? "unknown"}): ${url.slice(0, 96)}`,
      );
      return undefined;
    }
    const displayBytes = await convertCoverBytesForDisplay(body, ct, logs);
    if (isHeicMime(displayBytes.mime)) return undefined;
    return registerRemoteCoverBytes(cacheKey, displayBytes.body, displayBytes.mime);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`封面加载失败: ${msg}`);
    return undefined;
  }
}

/** 带书源 Referer / Cookie / 登录头的封面代理 URL（colortxt-local://cover/…） */
export async function resolveBookCoverDisplayUrl(
  source: BookSourceRecord,
  rawCoverUrl: string | undefined,
  baseUrl: string,
  logs: string[] = [],
): Promise<string | undefined> {
  const trimmed = rawCoverUrl?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("colortxt-local:")) return trimmed;
  if (trimmed.startsWith("data:")) return trimmed;

  const { urlPart, options } = splitUrlFetchOptions(trimmed);
  const sourceUrl = resolveCoverSourceUrl(source, urlPart, baseUrl, logs);
  if (!sourceUrl) return undefined;
  if (sourceUrl.startsWith("data:")) return sourceUrl;
  return fetchCoverDisplayUrl(source, sourceUrl, logs, baseUrl, options);
}
