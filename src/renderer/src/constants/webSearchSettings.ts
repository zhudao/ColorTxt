import type { WebSearchEngine, WebSearchSettings } from "@shared/webSearchTypes";

export const DEFAULT_WEB_SEARCH_ENGINES: readonly WebSearchEngine[] = [
  {
    id: "google",
    name: "Google",
    urlTemplate: "https://www.google.com/search?q=%s",
  },
  {
    id: "bing",
    name: "Bing",
    urlTemplate: "https://www.bing.com/search?q=%s",
  },
  {
    id: "baidu",
    name: "百度",
    urlTemplate: "https://www.baidu.com/s?wd=%s",
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    urlTemplate: "https://duckduckgo.com/?q=%s",
  },
  {
    id: "wikipedia-zh",
    name: "维基百科",
    urlTemplate: "https://zh.wikipedia.org/w/index.php?search=%s",
  },
];

export const defaultWebSearchSettings: WebSearchSettings = {
  engines: DEFAULT_WEB_SEARCH_ENGINES.map((e) => ({ ...e })),
};

function isWebSearchEngine(v: unknown): v is WebSearchEngine {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.trim().length > 0 &&
    typeof o.name === "string" &&
    o.name.trim().length > 0 &&
    typeof o.urlTemplate === "string" &&
    o.urlTemplate.includes("%s")
  );
}

/**
 * 合并设置。删除的引擎不会被默认列表补回。
 * 仅当设置缺失或 `engines` 非数组时使用默认种子；显式空数组保持为空。
 * 若数组非空但全部非法，则回退默认种子。
 */
export function mergeWebSearchSettings(
  partial: Partial<WebSearchSettings> | null | undefined,
): WebSearchSettings {
  if (!partial || !Array.isArray(partial.engines)) {
    return {
      engines: DEFAULT_WEB_SEARCH_ENGINES.map((e) => ({ ...e })),
    };
  }
  if (partial.engines.length === 0) {
    return { engines: [] };
  }
  const engines = partial.engines
    .filter(isWebSearchEngine)
    .map((e) => ({
      id: e.id.trim(),
      name: e.name.trim(),
      urlTemplate: e.urlTemplate.trim(),
    }));
  if (!engines.length) {
    return {
      engines: DEFAULT_WEB_SEARCH_ENGINES.map((e) => ({ ...e })),
    };
  }
  return { engines };
}

/** 用选中文本替换模板中全部 `%s`（已 encodeURIComponent） */
export function buildWebSearchUrl(
  urlTemplate: string,
  query: string,
): string | null {
  const template = urlTemplate.trim();
  if (!template.includes("%s")) return null;
  const encoded = encodeURIComponent(query);
  const url = template.split("%s").join(encoded);
  try {
    // 允许 http(s) 与自定义协议（如 Everything 的 es:）
    return new URL(url).href;
  } catch {
    return null;
  }
}

export function newWebSearchEngineId(): string {
  return `custom:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
