import type { StrResponse } from "./analyzeUrl";

/**
 * Legado `headers()`：可按下标取头，也可 `.get(name)`。
 * 用 `Record<string, unknown>` 承载头字段，避免 `get` 与 `Record<string, string>` 索引签名冲突。
 */
export type LegadoHeaderMap = Record<string, unknown> & {
  get(key: string): string;
};

/** Legado StrResponse 在 JS 中的方法接口 */
export type LegadoStrResponseJs = {
  body: () => string;
  url: () => string;
  code: () => number;
  headers: () => LegadoHeaderMap;
  header: (name: string) => string;
  message: () => string;
  callTime: () => number;
  raw: () => StrResponse;
};

/** Legado Connection 响应（java.post/get/connect 返回值） */
export type LegadoConnectionResponseJs = LegadoStrResponseJs;

export type LegadoResponseMeta = {
  statusCode?: number;
  startTime?: number;
  message?: string;
};

function headerLookup(
  headers: Record<string, string>,
  name: string,
): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return "";
}

/** Legado Map：headers().get(name) */
function wrapLegadoHeaderMap(headers: Record<string, string>): LegadoHeaderMap {
  return {
    ...headers,
    get(key: string) {
      return headerLookup(headers, key);
    },
  };
}

export function toLegadoStrResponse(
  res: StrResponse,
  meta: LegadoResponseMeta = {},
): LegadoStrResponseJs {
  const statusCode = meta.statusCode ?? res.statusCode ?? 200;
  const startTime = meta.startTime ?? Date.now();
  const message = meta.message ?? res.statusMessage ?? "";
  return {
    body: () => res.body,
    url: () => res.url,
    code: () => statusCode,
    headers: () => wrapLegadoHeaderMap({ ...res.headers }),
    header: (name: string) => headerLookup(res.headers, name),
    message: () => message,
    callTime: () => Date.now() - startTime,
    raw: () => res,
  };
}

export function toLegadoConnectionResponse(
  res: StrResponse,
  meta: LegadoResponseMeta = {},
): LegadoConnectionResponseJs {
  const wrapped = toLegadoStrResponse(res, meta);
  return {
    ...wrapped,
    raw: () => ({
      ...res,
      request: () => ({
        url: () => res.url,
      }),
    }),
  };
}

/** Legado Jsoup Connection.Response（java.get/post，含 headers(name) 返回数组） */
export type LegadoJsoupResponseJs = Omit<LegadoStrResponseJs, "headers"> & {
  headers: {
    (): LegadoHeaderMap;
    (name: string): string[];
  };
};

export function toLegadoJsoupResponse(
  res: StrResponse,
  meta: LegadoResponseMeta = {},
): LegadoJsoupResponseJs {
  const wrapped = toLegadoStrResponse(res, meta);
  const headersFn = ((name?: string) => {
    if (name == null || name === "") return wrapped.headers();
    const val = wrapped.header(name);
    if (!val) return [];
    return [val];
  }) as LegadoJsoupResponseJs["headers"];
  return {
    ...wrapped,
    headers: headersFn,
    raw: () => ({
      ...res,
      request: () => ({
        url: () => res.url,
      }),
    }),
  };
}

export function fromLegadoCheckResult(
  checked: unknown,
  fallback: StrResponse,
): StrResponse {
  if (checked == null || checked === "") return fallback;
  if (typeof checked === "string") {
    return { ...fallback, body: checked };
  }
  if (typeof checked === "object") {
    if (typeof (checked as LegadoStrResponseJs).body === "function") {
      const js = checked as LegadoStrResponseJs;
      return {
        url: typeof js.url === "function" ? String(js.url()) : fallback.url,
        body: String(js.body()),
        headers: fallback.headers,
        statusCode:
          typeof js.code === "function" ? js.code() : fallback.statusCode,
      };
    }
    const plain = checked as StrResponse;
    if (typeof plain.body === "string") {
      return {
        url: plain.url || fallback.url,
        body: plain.body,
        headers: plain.headers ?? fallback.headers,
        statusCode: plain.statusCode ?? fallback.statusCode,
      };
    }
  }
  return fallback;
}
