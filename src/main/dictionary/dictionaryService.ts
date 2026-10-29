/**
 * Dictionary lookup: local providers serial, network providers parallel.
 * Local and network groups overlap in wall-clock time.
 */
import { app } from "electron";
import path from "node:path";
import {
  BUILTIN_DICTIONARY_IDS,
  type DictionaryLookupRequest,
  type DictionaryLookupResponse,
  type DictionaryLookupResultItem,
  type DictionarySettings,
  type ImportedDictionary,
} from "@shared/dictionaryTypes";
import { buildLookupCandidates } from "./lookupCandidates";
import { StarDictReader } from "./stardictReader";
import { DictReader } from "./dictReader";
import { SlobReader } from "./slobReader";
import { BglReader } from "./bglReader";
import { lookupMdict, clearMdictCache } from "./mdictReader";
import {
  DICTIONARY_PROVIDER_TIMEOUT_MS,
  lookupWikipedia,
  lookupWiktionary,
  raceTimeout,
} from "./networkProviders";

const BUILTIN_LABELS: Record<string, string> = {
  [BUILTIN_DICTIONARY_IDS.wiktionary]: "Wiktionary",
  [BUILTIN_DICTIONARY_IDS.wikipedia]: "Wikipedia",
};

export function getDictionariesRoot(localCacheDir?: string | null): string {
  const t = typeof localCacheDir === "string" ? localCacheDir.trim() : "";
  if (t) return path.normalize(t);
  return path.join(app.getPath("userData"), "dictionaries");
}

/** 上次查词/导入用的根目录；变更时清缓存 */
let lastDictionariesRoot = "";

export function syncDictionariesRoot(localCacheDir?: string | null): string {
  const root = getDictionariesRoot(localCacheDir);
  if (root !== lastDictionariesRoot) {
    dropDictionaryCaches();
    clearMdictCache();
    lastDictionariesRoot = root;
  }
  return root;
}

function looksLikeHtml(content: string): boolean {
  const head = content.trim().slice(0, 800);
  return /<[a-z][\s\S]*>/i.test(head);
}

function contentFormatOf(content: string): "html" | "text" {
  return looksLikeHtml(content) ? "html" : "text";
}

function displayName(
  settings: DictionarySettings,
  providerId: string,
): string {
  if (BUILTIN_LABELS[providerId]) return BUILTIN_LABELS[providerId]!;
  const local = settings.importedDictionaries.find((d) => d.id === providerId);
  if (local) return local.name;
  return providerId;
}

function bundleFile(
  dict: ImportedDictionary,
  rel: string | undefined,
  root: string,
): string | null {
  if (!rel) return null;
  return path.join(root, dict.bundleDir, rel);
}

const stardictCache = new Map<string, StarDictReader>();
const dictCache = new Map<string, DictReader>();
const slobCache = new Map<string, SlobReader>();
const bglCache = new Map<string, BglReader>();

async function getStarDict(
  dict: ImportedDictionary,
  root: string,
): Promise<StarDictReader> {
  const cached = stardictCache.get(dict.id);
  if (cached) return cached;
  const reader = new StarDictReader();
  const ifo = bundleFile(dict, dict.files.ifo, root);
  const idx = bundleFile(dict, dict.files.idx, root);
  const body = bundleFile(dict, dict.files.dict, root);
  if (!ifo || !idx || !body) throw new Error("StarDict files incomplete");
  await reader.load({
    ifo,
    idx,
    dict: body,
    syn: bundleFile(dict, dict.files.syn, root) ?? undefined,
    idxOffsets: bundleFile(dict, dict.files.idxOffsets, root) ?? undefined,
    synOffsets: bundleFile(dict, dict.files.synOffsets, root) ?? undefined,
  });
  stardictCache.set(dict.id, reader);
  return reader;
}

async function getDict(
  dict: ImportedDictionary,
  root: string,
): Promise<DictReader> {
  const cached = dictCache.get(dict.id);
  if (cached) return cached;
  const reader = new DictReader();
  const index = bundleFile(dict, dict.files.index, root);
  const body = bundleFile(dict, dict.files.dict, root);
  if (!index || !body) throw new Error("DICT files incomplete");
  await reader.load({ index, dict: body });
  dictCache.set(dict.id, reader);
  return reader;
}

async function getSlob(
  dict: ImportedDictionary,
  root: string,
): Promise<SlobReader> {
  const cached = slobCache.get(dict.id);
  if (cached) return cached;
  const reader = new SlobReader();
  const slob = bundleFile(dict, dict.files.slob, root);
  if (!slob) throw new Error("Slob file missing");
  await reader.load(slob);
  slobCache.set(dict.id, reader);
  return reader;
}

async function getBgl(
  dict: ImportedDictionary,
  root: string,
): Promise<BglReader> {
  const cached = bglCache.get(dict.id);
  if (cached) return cached;
  const reader = new BglReader();
  const bgl = bundleFile(dict, dict.files.bgl, root);
  if (!bgl) throw new Error("BGL file missing");
  await reader.load(bgl);
  bglCache.set(dict.id, reader);
  return reader;
}

export function dropDictionaryCaches(id?: string): void {
  if (id) {
    stardictCache.delete(id);
    dictCache.delete(id);
    slobCache.delete(id);
    bglCache.delete(id);
  } else {
    stardictCache.clear();
    dictCache.clear();
    slobCache.clear();
    bglCache.clear();
  }
}

async function lookupLocal(
  dict: ImportedDictionary,
  word: string,
  root: string,
): Promise<DictionaryLookupResultItem | null> {
  if (dict.unsupported) return null;
  const title = dict.name;
  const candidates = buildLookupCandidates(word);

  if (dict.kind === "stardict") {
    const reader = await getStarDict(dict, root);
    if (!reader.isSupportedSametype()) return null;
    for (const c of candidates) {
      const entry = await reader.lookupWithSynonym(c);
      if (!entry) continue;
      const content = await reader.readDefinitionText(entry);
      if (!content.trim()) continue;
      return {
        providerId: dict.id,
        title,
        content,
        contentFormat: contentFormatOf(content),
        sourceKind: "local",
      };
    }
    return null;
  }

  if (dict.kind === "dict") {
    const reader = await getDict(dict, root);
    for (const c of candidates) {
      const entry = await reader.lookup(c);
      if (!entry) continue;
      const content = await reader.readText(entry);
      if (!content.trim()) continue;
      return {
        providerId: dict.id,
        title,
        content,
        contentFormat: contentFormatOf(content),
        sourceKind: "local",
      };
    }
    return null;
  }

  if (dict.kind === "slob") {
    const reader = await getSlob(dict, root);
    for (const c of candidates) {
      const content = await reader.lookupText(c);
      if (!content?.trim()) continue;
      return {
        providerId: dict.id,
        title,
        content,
        contentFormat: contentFormatOf(content),
        sourceKind: "local",
      };
    }
    return null;
  }

  if (dict.kind === "bgl") {
    const reader = await getBgl(dict, root);
    for (const c of candidates) {
      const entries = reader.findEntries(c);
      if (!entries.length) continue;
      const content = entries.map((e) => e.definition).join("\n\n");
      if (!content.trim()) continue;
      return {
        providerId: dict.id,
        title,
        content,
        contentFormat: contentFormatOf(content),
        sourceKind: "local",
      };
    }
    return null;
  }

  if (dict.kind === "mdict") {
    const mdx = bundleFile(dict, dict.files.mdx, root);
    if (!mdx) return null;
    const mddPaths = (dict.files.mdd ?? [])
      .map((rel) => bundleFile(dict, rel, root))
      .filter((p): p is string => !!p);
    const cssPaths = (dict.files.css ?? [])
      .map((rel) => bundleFile(dict, rel, root))
      .filter((p): p is string => !!p);
    const hit = await lookupMdict(mdx, word, { mddPaths, cssPaths });
    if (!hit?.definition.trim()) return null;
    return {
      providerId: dict.id,
      title,
      content: hit.definition,
      contentFormat: contentFormatOf(hit.definition),
      sourceKind: "local",
    };
  }

  return null;
}

async function lookupProvider(
  providerId: string,
  word: string,
  settings: DictionarySettings,
  root: string,
  lang?: string,
): Promise<DictionaryLookupResultItem | null> {
  const title = displayName(settings, providerId);

  if (providerId === BUILTIN_DICTIONARY_IDS.wiktionary) {
    const content = await lookupWiktionary(word, lang);
    if (!content?.trim()) return null;
    return {
      providerId,
      title,
      content,
      contentFormat: contentFormatOf(content),
      sourceKind: "network",
    };
  }

  if (providerId === BUILTIN_DICTIONARY_IDS.wikipedia) {
    const content = await lookupWikipedia(word, lang);
    if (!content?.trim()) return null;
    return {
      providerId,
      title,
      content,
      contentFormat: contentFormatOf(content),
      sourceKind: "network",
    };
  }

  const local = settings.importedDictionaries.find((d) => d.id === providerId);
  if (local) {
    try {
      return await lookupLocal(local, word, root);
    } catch {
      return null;
    }
  }

  return null;
}

function isLocalProviderId(
  settings: DictionarySettings,
  providerId: string,
): boolean {
  return settings.importedDictionaries.some((d) => d.id === providerId);
}

export async function lookup(
  request: DictionaryLookupRequest,
): Promise<DictionaryLookupResponse> {
  const word = String(request.word ?? "").trim();
  if (!word) {
    return { ok: false, message: "Empty word" };
  }
  const settings = request.settings;
  if (!settings || typeof settings !== "object") {
    return { ok: false, message: "Invalid settings" };
  }

  const root = syncDictionariesRoot(settings.localCacheDir);

  const enabledIds = (settings.providerOrder ?? []).filter(
    (id) => settings.providerEnabled?.[id] !== false,
  );
  const localIds = enabledIds.filter((id) => isLocalProviderId(settings, id));
  const networkIds = enabledIds.filter((id) => !isLocalProviderId(settings, id));

  const byId = new Map<string, DictionaryLookupResultItem>();

  // 网络词典并行启动（与本地串行重叠，缩短总等待）
  const networkPromise = Promise.all(
    networkIds.map(async (id) => {
      try {
        const item = await raceTimeout(
          lookupProvider(id, word, settings, root, request.lang),
          DICTIONARY_PROVIDER_TIMEOUT_MS + 2_000,
        );
        return { id, item };
      } catch {
        return { id, item: null as DictionaryLookupResultItem | null };
      }
    }),
  );

  // 本地词典串行，避免多本大词库同时抢磁盘/解析
  for (const id of localIds) {
    try {
      const item = await lookupProvider(id, word, settings, root, request.lang);
      if (!item) continue;
      const emptyContent = !item.content?.trim();
      if (emptyContent) continue;
      byId.set(id, item);
    } catch {
      /* skip */
    }
  }

  const networkSettled = await networkPromise;
  for (const { id, item } of networkSettled) {
    if (!item) continue;
    const emptyContent = !item.content?.trim();
    if (emptyContent) continue;
    byId.set(id, item);
  }

  const results: DictionaryLookupResultItem[] = [];
  for (const id of enabledIds) {
    const item = byId.get(id);
    if (item) results.push(item);
  }

  return { ok: true, word, results };
}
