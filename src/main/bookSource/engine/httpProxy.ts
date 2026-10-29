import { Agent, ProxyAgent, type Dispatcher } from "undici";
import {
  SocksProxyAgent,
  type SocksProxyAgentOptions,
} from "socks-proxy-agent";

export type ParsedProxy = {
  uri: string;
  type: "http" | "socks";
};

const PROXY_RE =
  /^(http|socks4|socks5):\/\/([^:@/]+):(\d{2,5})(?:@([^@]*)@([^@]*))?$/i;

/** 对齐 Legado SSLHelper.unsafe*：书源站常见证书过期/自签 */
const INSECURE_TLS = { rejectUnauthorized: false } as const;

let insecureAgent: Agent | undefined;

/** 无代理时的默认 dispatcher（忽略 HTTPS 证书校验） */
export function getInsecureTlsAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { ...INSECURE_TLS } });
  }
  return insecureAgent;
}

/** Legado getProxyClient 代理字符串解析 */
export function parseLegadoProxy(raw: string): ParsedProxy | null {
  const text = raw.trim();
  if (!text) return null;
  const m = PROXY_RE.exec(text);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  const host = m[2]!;
  const port = m[3]!;
  const username = m[4] ?? "";
  const password = m[5] ?? "";
  const auth =
    username !== "" || password !== ""
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : "";
  if (scheme === "http") {
    return { type: "http", uri: `http://${auth}${host}:${port}` };
  }
  const socksScheme = scheme === "socks4" ? "socks4" : "socks5";
  return { type: "socks", uri: `${socksScheme}://${auth}${host}:${port}` };
}

const dispatcherCache = new Map<string, Dispatcher>();

/** 找书设置里的全局默认代理（书源 header / opts.proxy 优先） */
let defaultBookSourceProxy: string | undefined;

export function setDefaultBookSourceProxy(proxy?: string | null): void {
  const text = String(proxy ?? "").trim();
  defaultBookSourceProxy = text && parseLegadoProxy(text) ? text : undefined;
}

export function getDefaultBookSourceProxy(): string | undefined {
  return defaultBookSourceProxy;
}

export function getProxyDispatcher(proxy?: string | null): Dispatcher | undefined {
  const parsed = parseLegadoProxy(String(proxy ?? "").trim());
  if (!parsed) return undefined;
  const cached = dispatcherCache.get(parsed.uri);
  if (cached) return cached;
  const dispatcher =
    parsed.type === "http"
      ? new ProxyAgent({
          uri: parsed.uri,
          requestTls: { ...INSECURE_TLS },
        })
      : (new SocksProxyAgent(
          parsed.uri,
          // 运行时可进 https.Agent；类型仅并了 http.AgentOptions，需断言
          { ...INSECURE_TLS } as SocksProxyAgentOptions,
        ) as unknown as Dispatcher);
  dispatcherCache.set(parsed.uri, dispatcher);
  return dispatcher;
}

/** 书源 HTTP / 封面：显式 proxy → 全局默认 → 不校验证书的 Agent（对齐 Legado OkHttp） */
export function getBookSourceDispatcher(proxy?: string | null): Dispatcher {
  return (
    getProxyDispatcher(proxy) ??
    getProxyDispatcher(defaultBookSourceProxy) ??
    getInsecureTlsAgent()
  );
}

/** 从请求头中提取 proxy 并移除，对齐 Legado AnalyzeUrl headerMap */
export function extractProxyFromHeaders(
  headers: Record<string, string>,
): { headers: Record<string, string>; proxy?: string } {
  const out = { ...headers };
  const direct = out.proxy ?? out.Proxy;
  if (direct?.trim()) {
    delete out.proxy;
    delete out.Proxy;
    return { headers: out, proxy: direct.trim() };
  }
  return { headers: out };
}
