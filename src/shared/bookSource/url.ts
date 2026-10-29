/** Legado bookSourceUrl：`##` 后为注释；`,` 后为 fetch 选项，均不参与 URL 拼接 */
export function normalizeBookSourceBaseUrl(url: string): string {
  let trimmed = url.trim();
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx >= 0) trimmed = trimmed.slice(0, commaIdx).trim();
  const hashIdx = trimmed.indexOf("##");
  if (hashIdx >= 0) trimmed = trimmed.slice(0, hashIdx).trim();
  return trimmed;
}

/**
 * 折叠 http(s) URL 路径中的重复斜杠（保留 `https://`）。
 * 详情页 baseUrl 常带尾 `/`，书源写 `{{baseUrl}}/catalog/` 会拼出 `//catalog/` → 404。
 */
export function normalizeHttpUrlPath(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  const optMatch = /,\s*(?=\{)/.exec(trimmed);
  const main = optMatch?.index != null ? trimmed.slice(0, optMatch.index) : trimmed;
  const suffix = optMatch?.index != null ? trimmed.slice(optMatch.index) : "";
  const m = main.match(/^(https?:\/\/[^/?#]+)([/?#][\s\S]*)?$/i);
  if (!m) return trimmed;
  const origin = m[1]!;
  const pathQuery = m[2] ?? "";
  if (!pathQuery.startsWith("/")) return trimmed;
  const q = pathQuery.search(/[?#]/);
  const path = q >= 0 ? pathQuery.slice(0, q) : pathQuery;
  const rest = q >= 0 ? pathQuery.slice(q) : "";
  return origin + path.replace(/\/{2,}/g, "/") + rest + suffix;
}

/** 书源封面等远程 URL：保留原始协议（部分站点 https 不可用） */
export function normalizeRemoteImageUrl(url?: string): string | undefined {
  const u = url?.trim();
  return u || undefined;
}

/** Legado SearchModel 结果分级：完全匹配 / 包含 / 其他 */
export type SearchMatchTier = "exact" | "contains" | "other";

export function searchMatchTier(
  name: string,
  author: string,
  key: string,
): SearchMatchTier {
  const kw = key.trim();
  if (!kw) return "other";
  if (name === kw || author === kw) return "exact";
  if (name.includes(kw) || author.includes(kw)) return "contains";
  return "other";
}

const TIER_RANK: Record<SearchMatchTier, number> = {
  exact: 0,
  contains: 1,
  other: 2,
};

/** 用于结果排序：对齐 Legado mergeItems 优先级 */
export function searchResultRelevance(
  name: string,
  author: string,
  key: string,
): number {
  const tier = searchMatchTier(name, author, key);
  return 100 - TIER_RANK[tier] * 20;
}

/** 对齐 Legado NetworkUtils.getAbsoluteURL */
export function resolveAbsoluteUrl(
  baseUrl: string,
  relativePath: string,
): string {
  const trimmed = relativePath.trim();
  /**
   * UrlOption 常跨行：`/path,{\n  "body":…\n}`。
   * 不可只取首行（会剩 `…,{`），也不能把整段交给 URL()。
   */
  if (/,\s*\{/.test(trimmed)) {
    const optIdx = /,\s*(?=\{)/.exec(trimmed)?.index;
    if (optIdx != null && optIdx > 0) {
      const pathOnly = trimmed.slice(0, optIdx).trim().split(/\r?\n/)[0]?.trim() ?? "";
      const suffix = trimmed.slice(optIdx);
      const base = normalizeBookSourceBaseUrl(baseUrl);
      if (/^https?:\/\//i.test(pathOnly)) {
        return normalizeHttpUrlPath(pathOnly) + suffix;
      }
      if (pathOnly.startsWith("data:") || pathOnly.startsWith("javascript")) {
        return pathOnly + suffix;
      }
      if (!base) return pathOnly + suffix;
      try {
        return normalizeHttpUrlPath(new URL(pathOnly, base).href) + suffix;
      } catch {
        return normalizeHttpUrlPath(pathOnly) + suffix;
      }
    }
  }
  // 多行相对路径（如 a@href 命中多链后 join）不可整体交给 URL()，否则会拼出 /a//b//c
  const rel = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
  const base = normalizeBookSourceBaseUrl(baseUrl);
  if (!base) return normalizeHttpUrlPath(rel);
  if (/^https?:\/\//i.test(rel)) return normalizeHttpUrlPath(rel);
  if (rel.startsWith("data:") || rel.startsWith("javascript")) return rel;
  try {
    return normalizeHttpUrlPath(new URL(rel, base).href);
  } catch {
    return normalizeHttpUrlPath(rel);
  }
}

/** 书源 WebView 登录页 URL（无 loginUi 时使用） */
export function resolveWebLoginUrl(source: {
  bookSourceUrl: string;
  loginUrl?: string | null;
}): string {
  const raw = source.loginUrl?.trim();
  if (!raw) return source.bookSourceUrl;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("@js:") || raw.startsWith("<js>")) {
    return source.bookSourceUrl;
  }
  if (/function\s+\w+|=>\s*\{|\bjava\./.test(raw)) {
    return source.bookSourceUrl;
  }
  return resolveAbsoluteUrl(source.bookSourceUrl, raw);
}
