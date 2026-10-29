/**
 * Online dictionaries: Wiktionary / Wikipedia.
 */
import { fetchViaChromiumNet } from "../bookSource/engine/chromiumNetFetch";

/** 词典联网单次请求超时（需 VPN 时避免长时间卡住） */
export const DICTIONARY_FETCH_TIMEOUT_MS = 8_000;

/** 单个网络词典 provider 总预算（含多次串行请求） */
export const DICTIONARY_PROVIDER_TIMEOUT_MS = 10_000;

export function looksChinese(word: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(word);
}

/** 超时后返回 null，不抛错（底层请求可能仍在跑，但查词可继续） */
export function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetchViaChromiumNet({
      url,
      method: "GET",
      timeoutMs: DICTIONARY_FETCH_TIMEOUT_MS,
      useCookieJar: false,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    return JSON.parse(res.body) as unknown;
  } catch {
    return null;
  }
}

function formatWiktionaryRest(
  json: unknown,
  preferLang?: string,
): string | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const langKeys = Object.keys(root).filter(
    (k) => Array.isArray(root[k]) && k !== "error",
  );
  if (!langKeys.length) return null;

  const prefer = preferLang?.split("-")[0]?.toLowerCase();
  const order = prefer
    ? [
        ...langKeys.filter((k) => k.toLowerCase() === prefer),
        ...langKeys.filter((k) => k.toLowerCase() !== prefer),
      ]
    : langKeys;

  const parts: string[] = [];
  for (const lang of order.slice(0, 3)) {
    const entries = root[lang];
    if (!Array.isArray(entries)) continue;

    let langLabel = lang;
    const chunks: string[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.language === "string" && e.language.trim()) {
        langLabel = e.language.trim();
      }
      const pos = typeof e.partOfSpeech === "string" ? e.partOfSpeech : "";
      const defs = Array.isArray(e.definitions) ? e.definitions : [];
      const items: string[] = [];
      for (const d of defs) {
        if (!d || typeof d !== "object") continue;
        const def = d as Record<string, unknown>;
        const definition =
          typeof def.definition === "string"
            ? stripHtmlToText(def.definition)
            : "";
        if (definition) items.push(`<li>${escapeHtml(definition)}</li>`);
      }
      if (!pos && !items.length) continue;
      if (pos) {
        chunks.push(`<p class="dictWtPos">${escapeHtml(pos)}</p>`);
      }
      if (items.length) {
        chunks.push(`<ol class="dictZhDefs">${items.join("")}</ol>`);
      }
    }
    if (!chunks.length) continue;
    parts.push(`<p class="dictZhLang">${escapeHtml(langLabel)}</p>`);
    parts.push(...chunks);
  }
  const html = parts.join("").trim();
  return html || null;
}

function parseRedirect(wikitext: string): string | null {
  const match = wikitext.match(/\{\{zh-see\|([^|}]+)/);
  return match?.[1] ?? null;
}

function parsePinyin(wikitext: string): string | null {
  const pronMatch = wikitext.match(/\{\{zh-pron[\s\S]*?\}\}/);
  if (!pronMatch) return null;
  const mMatch = pronMatch[0].match(/\|m=([^|}\n]+)/);
  return mMatch?.[1]?.trim() ?? null;
}

function cleanWikiMarkup(text: string): string {
  let result = text;
  result = result.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1");
  result = result.replace(/\{\{lb\|zh\|([^}]*)\}\}/g, (_m, params: string) => {
    const labels = params
      .split("|")
      .filter((p) => p !== "_" && p !== "zh")
      .join(", ");
    return labels ? `(${labels})` : "";
  });
  result = result.replace(/\{\{[^}]*\}\}/g, "");
  result = result.replace(/\s{2,}/g, " ").trim();
  return result;
}

function parseZhDefinitions(wikitext: string): string[] {
  const defSectionMatch = wikitext.match(
    /===Definitions===\s*\n(?:\{\{[^}]*\}\}\s*\n)?([\s\S]*?)(?=\n===|\n==(?!=))/,
  );
  if (!defSectionMatch) return [];
  return defSectionMatch[1]!
    .split("\n")
    .filter((line) => /^#[^#*:]/.test(line))
    .map((line) => cleanWikiMarkup(line.replace(/^#\s*/, "")))
    .filter((line) => line.length > 0);
}

async function fetchChineseWiktionary(word: string): Promise<string | null> {
  const fetchWikitext = async (w: string): Promise<string | null> => {
    const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(w)}&prop=wikitext&format=json&origin=*`;
    const json = await fetchJson(url);
    if (!json || typeof json !== "object") return null;
    const parse = (json as Record<string, unknown>).parse;
    if (!parse || typeof parse !== "object") return null;
    const wt = (parse as Record<string, unknown>).wikitext;
    if (!wt || typeof wt !== "object") return null;
    const star = (wt as Record<string, unknown>)["*"];
    return typeof star === "string" ? star : null;
  };

  let wikitext = await fetchWikitext(word);
  if (!wikitext) return null;
  const redirect = parseRedirect(wikitext);
  if (redirect) {
    wikitext = await fetchWikitext(redirect);
    if (!wikitext) return null;
  }
  const pinyin = parsePinyin(wikitext);
  const defs = parseZhDefinitions(wikitext);
  if (!pinyin && defs.length === 0) return null;

  // HTML closely mirrors Readest chineseDict rendering (pinyin + list), ASCII-only source.
  const parts: string[] = [];
  const headword = redirect ?? word;
  parts.push(`<p class="dictZhWord">${escapeHtml(headword)}</p>`);
  if (pinyin) {
    parts.push(`<p class="dictZhPinyin">${escapeHtml(pinyin)}</p>`);
  }
  parts.push(`<p class="dictZhLang">Chinese</p>`);
  if (defs.length) {
    parts.push("<ol class=\"dictZhDefs\">");
    for (const d of defs) {
      parts.push(`<li>${escapeHtml(d)}</li>`);
    }
    parts.push("</ol>");
  }
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function lookupWiktionary(
  word: string,
  lang?: string,
): Promise<string | null> {
  return raceTimeout(lookupWiktionaryInner(word, lang), DICTIONARY_PROVIDER_TIMEOUT_MS);
}

async function lookupWiktionaryInner(
  word: string,
  lang?: string,
): Promise<string | null> {
  const w = word.trim();
  if (!w) return null;

  if (looksChinese(w) || lang?.toLowerCase().startsWith("zh")) {
    const zh = await fetchChineseWiktionary(w);
    if (zh) return zh;
  }

  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`;
  const json = await fetchJson(url);
  return formatWiktionaryRest(json, lang);
}

export async function lookupWikipedia(
  word: string,
  lang?: string,
): Promise<string | null> {
  return raceTimeout(lookupWikipediaInner(word, lang), DICTIONARY_PROVIDER_TIMEOUT_MS);
}

async function lookupWikipediaInner(
  word: string,
  lang?: string,
): Promise<string | null> {
  const w = word.trim();
  if (!w) return null;
  const langCode = (
    lang?.split("-")[0] ||
    (looksChinese(w) ? "zh" : "en")
  ).toLowerCase();
  const url = `https://${langCode}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w)}`;
  const json = await fetchJson(url);
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.type === "disambiguation") {
    const extract =
      typeof o.extract === "string" ? o.extract.trim() : "";
    return extract || null;
  }
  const title = typeof o.title === "string" ? o.title : w;
  const description =
    typeof o.description === "string" ? o.description.trim() : "";
  const extractHtml =
    typeof o.extract_html === "string" ? o.extract_html.trim() : "";
  const extract = typeof o.extract === "string" ? o.extract.trim() : "";
  if (!extractHtml && !extract && !description) return null;

  // titles.display may include markup like <span class="mw-page-title-main">?</span>
  const titlesObj =
    o.titles && typeof o.titles === "object"
      ? (o.titles as Record<string, unknown>)
      : null;
  const displayRaw =
    typeof titlesObj?.display === "string" ? titlesObj.display : "";
  const displayTitle = stripHtmlToText(displayRaw) || title;

  // Readest-style title card + extract_html (keeps bold lead-in).
  const titleHtml = escapeHtml(displayTitle);
  const descHtml = description
    ? `<p class="dictWikiDesc">${escapeHtml(description)}</p>`
    : "";
  const body = extractHtml
    ? `<div class="dictWikiExtract">${extractHtml}</div>`
    : extract
      ? `<div class="dictWikiExtract"><p>${escapeHtml(extract)}</p></div>`
      : "";
  return `<div class="dictWikiTitle">${titleHtml}${descHtml}</div>${body}`;
}
