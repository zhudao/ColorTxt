import type { BookSourceRecord } from "@shared/bookSource/types";
import { normalizeBookSourceBaseUrl } from "@shared/bookSource/url";
import { getLoginHeader } from "../store/bookSourceStore";
import { createJsExtensionHost, type JsExtensionHost } from "./jsExtensions";
import { evalJsAsync } from "./rhinoRuntime";
import {
  normalizeLegadoLooseJson,
  parseLegadoLooseJsonObject,
} from "./legadoLooseJson";

type HeaderResolveContext = {
  baseUrl?: string;
  host?: JsExtensionHost;
  logs?: string[];
};

/** Legado 书源 header 常用单引号 / 无引号键，GSON 可解析但标准 JSON 不行 */
export function parseLegadoHeaderJson(raw: string): Record<string, string> | null {
  const parsed = parseLegadoLooseJsonObject(raw);
  if (!parsed) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

export { normalizeLegadoLooseJson };

function parseStaticHeaderJson(raw: string | undefined | null): Record<string, string> {
  if (!raw?.trim()) return {};
  return parseLegadoHeaderJson(raw) ?? {};
}

async function parseHeaderField(
  raw: string | undefined | null,
  source: BookSourceRecord,
  ctx: HeaderResolveContext & { baseUrl: string },
): Promise<Record<string, string>> {
  const h = raw?.trim();
  if (!h) return {};
  if (h.startsWith("@js:") || /^<js>/i.test(h)) {
    const host = ctx.host ?? createJsExtensionHost(source, ctx.logs ?? []);
    let script = h;
    if (h.startsWith("@js:")) script = h.slice(4).trim();
    else script = h.replace(/^<js>/i, "").replace(/<\/js>$/i, "").trim();
    try {
      // 须走 jsLib 共享作用域：有些书源 header 里 `Map("cookie")` 是书源自定义函数，
      // 关闭共享域时 Node VM 会落到原生 Map → Constructor Map requires 'new'
      const out = await evalJsAsync(script, {
        source,
        host,
        baseUrl: ctx.baseUrl,
      });
      const text = String(out ?? "").trim();
      if (!text) return {};
      return parseStaticHeaderJson(text);
    } catch {
      return {};
    }
  }
  return parseStaticHeaderJson(h);
}

/** 同步解析静态 JSON header（不含 @js:） */
export function buildSourceRequestHeaders(
  source?: BookSourceRecord,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (source?.header?.trim()) {
    const h = source.header.trim();
    if (!h.startsWith("@js:") && !/^<js>/i.test(h)) {
      Object.assign(out, parseStaticHeaderJson(h));
    }
  }
  if (source) {
    const lh = getLoginHeader(source.bookSourceUrl);
    if (lh?.trim() && !lh.trim().startsWith("@js:") && !/^<js>/i.test(lh.trim())) {
      Object.assign(out, parseStaticHeaderJson(lh));
    }
  }
  return out;
}

/** 解析书源 header / 登录头（支持 @js: 动态 JSON） */
export async function resolveSourceRequestHeaders(
  source: BookSourceRecord | undefined,
  ctx: HeaderResolveContext = {},
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!source) return out;
  const baseUrl = normalizeBookSourceBaseUrl(ctx.baseUrl ?? source.bookSourceUrl);
  const shared = { ...ctx, baseUrl };
  Object.assign(out, await parseHeaderField(source.header, source, shared));
  const lh = getLoginHeader(source.bookSourceUrl);
  Object.assign(out, await parseHeaderField(lh, source, shared));
  return out;
}

export function headersToLoadUrlExtraHeaders(
  headers: Record<string, string>,
): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
}
