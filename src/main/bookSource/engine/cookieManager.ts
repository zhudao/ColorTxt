import { CookieJar } from "tough-cookie";
import { getDomain } from "tldts";
import {
  getCookieJar,
  saveCookieJar,
} from "../store/bookSourceStore";

const jarByDomain = new Map<string, CookieJar>();

export function getDomainFromUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname;
  } catch {
    return url;
  }
}

/**
 * Legado NetworkUtils.getSubDomain：Cookie 按可注册域（eTLD+1）归档，子域共享。
 * 登录常发生在 accounts.example.com，业务请求在 www.example.com——按完整主机名归档会取不到登录态。
 * IP / localhost 等无可注册域时退回主机名。
 */
export function getCookieStoreDomain(url: string): string {
  const host = getDomainFromUrl(url);
  return getDomain(host) ?? host;
}

/** 设为域级 Cookie（Domain=storeDomain），子域名请求也能匹配；非法域名退回 host-only */
function setDomainWideCookie(
  jar: CookieJar,
  storeDomain: string,
  name: string,
  value: string,
): void {
  try {
    jar.setCookieSync(
      `${name}=${value}; Domain=${storeDomain}; Path=/`,
      `https://${storeDomain}/`,
    );
  } catch {
    try {
      jar.setCookieSync(`${name}=${value}`, `https://${storeDomain}/`);
    } catch {
      /* ignore invalid */
    }
  }
}

function loadJar(storeDomain: string): CookieJar {
  let jar = jarByDomain.get(storeDomain);
  if (!jar) {
    jar = new CookieJar();
    const stored = getCookieJar(storeDomain);
    for (const [name, value] of Object.entries(stored)) {
      setDomainWideCookie(jar, storeDomain, name, value);
    }
    jarByDomain.set(storeDomain, jar);
  }
  return jar;
}

/** 枚举 jar 内全部 Cookie（含子域 host-only / HttpOnly），getCookiesSync(裸域) 会漏掉子域 Cookie */
function allJarCookies(jar: CookieJar): { key: string; value: string }[] {
  try {
    const cookies = jar.serializeSync()?.cookies ?? [];
    return cookies
      .filter((c) => typeof c.key === "string" && c.key)
      .map((c) => ({ key: String(c.key), value: String(c.value ?? "") }));
  } catch {
    return [];
  }
}

export function persistJar(storeDomain: string): void {
  const jar = jarByDomain.get(storeDomain);
  if (!jar) return;
  const map: Record<string, string> = {};
  for (const c of allJarCookies(jar)) {
    map[c.key] = c.value;
  }
  saveCookieJar(storeDomain, map);
}

export function cookieHeaderForUrl(url: string): string {
  const jar = loadJar(getCookieStoreDomain(url));
  try {
    return jar.getCookieStringSync(url) || "";
  } catch {
    return "";
  }
}

export function setCookieFromResponse(url: string, setCookie: string | string[]): void {
  const storeDomain = getCookieStoreDomain(url);
  const jar = loadJar(storeDomain);
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const h of headers) {
    if (!h) continue;
    try {
      jar.setCookieSync(h, url);
    } catch {
      /* ignore */
    }
  }
  persistJar(storeDomain);
}

export function getCookieKey(domain: string, name: string): string | null {
  const jar = loadJar(getCookieStoreDomain(domain));
  const found = allJarCookies(jar).find((c) => c.key === name);
  return found?.value ?? null;
}

function parseCookiePairs(cookie: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookie?.trim()) return map;
  for (const segment of cookie.split(";")) {
    const part = segment.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    if (value || value === "null") map[name] = value;
  }
  return map;
}

function mapToCookieHeader(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function resolveCookieUrl(url: string): string {
  return url.includes("://") ? url : `https://${url}`;
}

/** Legado CookieStore.setCookie：按 url 二级域名保存整段 Cookie */
export function setCookieForUrl(url: string, cookie?: string | null): void {
  const absUrl = resolveCookieUrl(url);
  const storeDomain = getCookieStoreDomain(absUrl);
  if (!cookie?.trim()) {
    removeDomainCookies(storeDomain);
    return;
  }
  const jar = new CookieJar();
  const pairs = parseCookiePairs(cookie);
  if (Object.keys(pairs).length === 0) {
    try {
      jar.setCookieSync(cookie.trim(), absUrl);
    } catch {
      /* ignore invalid Set-Cookie */
    }
  } else {
    for (const [name, value] of Object.entries(pairs)) {
      setDomainWideCookie(jar, storeDomain, name, value);
    }
  }
  jarByDomain.set(storeDomain, jar);
  persistJar(storeDomain);
}

/** Legado CookieStore.replaceCookie：与已有 Cookie 合并后保存 */
export function replaceCookieForUrl(url: string, cookie: string): void {
  if (!cookie?.trim()) return;
  const absUrl = resolveCookieUrl(url);
  const merged = {
    ...parseCookiePairs(cookieHeaderForUrl(absUrl)),
    ...parseCookiePairs(cookie),
  };
  setCookieForUrl(absUrl, mapToCookieHeader(merged));
}

export function cookieStringToMap(cookie: string): Record<string, string> {
  return parseCookiePairs(cookie);
}

export function mapToCookieString(
  cookieMap: Record<string, string> | null | undefined,
): string {
  if (!cookieMap || !Object.keys(cookieMap).length) return "";
  return mapToCookieHeader(cookieMap);
}

export function removeDomainCookies(domain: string): void {
  const storeDomain = getCookieStoreDomain(domain);
  jarByDomain.delete(storeDomain);
  saveCookieJar(storeDomain, {});
  // 兼容旧版本按完整主机名归档的残留行（如 www.<域名>），一并清空
  if (storeDomain !== domain) {
    jarByDomain.delete(domain);
    saveCookieJar(domain, {});
  }
}
