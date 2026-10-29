import { createHash } from "node:crypto";
import type { BookSourceRecord, ExploreKind } from "@shared/bookSource/types";
import {
  getCacheValue,
  putCacheValue,
  removeCacheValue,
} from "../store/bookSourceStore";
import { createJsExtensionHost } from "./jsExtensions";
import { parseLegadoLenientJson } from "./legadoLooseJson";
import { evalJsAsync } from "./rhinoRuntime";

const kindsMemoryCache = new Map<string, ExploreKind[]>();
const kindsInflight = new Map<string, Promise<ExploreKind[]>>();

function exploreKindsCacheKey(source: BookSourceRecord): string {
  return createHash("md5")
    .update(source.bookSourceUrl + (source.exploreUrl ?? ""))
    .digest("hex");
}

function isJsonArray(text: string): boolean {
  const t = text.trim();
  return t.startsWith("[");
}

function isValidExploreRuleCache(text: string): boolean {
  const t = text.trim();
  if (!t || t === "undefined" || t === "null" || t === "[]") return false;
  if (isJsonArray(t)) {
    try {
      const parsed = parseLegadoLenientJson(t) as unknown;
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }
  return t.includes("::");
}

function isBrokenExploreKinds(kinds: ExploreKind[]): boolean {
  return (
    kinds.length === 1 &&
    kinds[0]?.title === "undefined" &&
    !kinds[0]?.url?.trim()
  );
}

function parseExploreKindsJson(ruleStr: string): ExploreKind[] {
  // 对齐 Legado GSON：允许多行 @js: 写在 url 字符串里（裸换行等控制字符）
  const parsed = parseLegadoLenientJson(ruleStr) as unknown;
  if (!Array.isArray(parsed)) return [];
  const kinds: ExploreKind[] = [];
  for (const item of parsed) {
    if (item == null) continue;
    if (typeof item === "string") {
      const t = item.trim();
      if (!t) continue;
      try {
        const obj = parseLegadoLenientJson(t) as ExploreKind;
        if (obj?.title?.trim()) kinds.push(obj);
      } catch {
        kinds.push({ title: t });
      }
      continue;
    }
    if (typeof item === "object" && "title" in item) {
      const k = item as ExploreKind;
      if (k.title?.trim()) kinds.push(k);
    }
  }
  return kinds;
}

function parseKindLines(ruleStr: string): ExploreKind[] {
  const kinds: ExploreKind[] = [];
  for (const kindStr of ruleStr.split(/(?:&&|\n)+/)) {
    const trimmed = kindStr.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("::");
    const title = parts[0]?.trim() ?? "";
    const url = parts[1]?.trim();
    kinds.push({ title, url: url || undefined });
  }
  return kinds;
}

function isEmptyExploreKinds(kinds: ExploreKind[]): boolean {
  return kinds.length === 0;
}

async function resolveExploreRuleStr(
  source: BookSourceRecord,
  exploreUrl: string,
  cacheKey: string,
  logs: string[],
): Promise<string> {
  if (
    !exploreUrl.startsWith("<js>") &&
    !exploreUrl.startsWith("<JS>") &&
    !exploreUrl.startsWith("@js:")
  ) {
    return exploreUrl;
  }

  const cacheSubKey = `exploreKinds:${cacheKey}`;
  const cached = getCacheValue(source.bookSourceUrl, cacheSubKey);
  if (cached && isValidExploreRuleCache(cached)) return cached.trim();
  if (cached) removeCacheValue(source.bookSourceUrl, cacheSubKey);

  const jsStr = exploreUrl.startsWith("@js:")
    ? exploreUrl.slice(4).trim()
    : exploreUrl.slice(4, exploreUrl.lastIndexOf("<")).trim();
  const host = createJsExtensionHost(source, logs);
  const raw = await evalJsAsync(
    jsStr,
    { source, host, page: 1 },
    { legadoAsync: true },
  );
  if (raw === undefined || raw === null) {
    logs.push("发现分类 JS 未返回结果");
    if (host.logs.length) logs.push(...host.logs);
    return "";
  }
  const out = String(raw).trim();
  if (!out) logs.push("发现分类 JS 返回空字符串");
  else if (out === "[]") logs.push("发现分类 JS 返回空数组");
  if (isValidExploreRuleCache(out)) {
    putCacheValue(source.bookSourceUrl, cacheSubKey, out);
  } else if (out) {
    logs.push(`发现分类 JS 返回非常规格式: ${out.slice(0, 200)}`);
  }
  return out;
}

export async function getExploreKinds(
  source: BookSourceRecord,
  logs: string[] = [],
): Promise<ExploreKind[]> {
  const exploreUrl = source.exploreUrl?.trim();
  if (!exploreUrl) return [];

  const cacheKey = exploreKindsCacheKey(source);
  const mem = kindsMemoryCache.get(cacheKey);
  if (mem && mem.length > 0 && !isBrokenExploreKinds(mem)) return mem;
  if (mem) kindsMemoryCache.delete(cacheKey);

  const inflight = kindsInflight.get(cacheKey);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const ruleStr = await resolveExploreRuleStr(
        source,
        exploreUrl,
        cacheKey,
        logs,
      );
      if (!ruleStr.trim()) {
        if (!logs.length) logs.push("发现分类规则为空");
        return [];
      }

      if (isJsonArray(ruleStr)) {
        return parseExploreKindsJson(ruleStr);
      }
      return parseKindLines(ruleStr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : "";
      return [{ title: `ERROR:${msg}`, url: stack || msg }];
    }
  })();

  kindsInflight.set(cacheKey, task);
  try {
    const kinds = await task;
    if (!isEmptyExploreKinds(kinds) && !isBrokenExploreKinds(kinds)) {
      kindsMemoryCache.set(cacheKey, kinds);
    }
    return kinds;
  } finally {
    kindsInflight.delete(cacheKey);
  }
}

export function clearExploreKindsCache(source: BookSourceRecord): void {
  const cacheKey = exploreKindsCacheKey(source);
  kindsMemoryCache.delete(cacheKey);
  removeCacheValue(source.bookSourceUrl, `exploreKinds:${cacheKey}`);
}
