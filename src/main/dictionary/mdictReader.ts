/**
 * MDict (.mdx / .mdd) via mdict-js.
 * Lookup MDX entries; resolve images / audio / css from companion MDD.
 */
import { createRequire } from "node:module";
import { open as fsOpen, readFile } from "node:fs/promises";
import path from "node:path";
import { buildLookupCandidates } from "./lookupCandidates";
import { looksLikeOggSpeex, oggSpeexToWav } from "./speexToWav";

const require = createRequire(import.meta.url);

type WordDefinition = { keyText: string; definition: string };
type MdictInstance = {
  lookup(word: string): WordDefinition;
};

type MdictCtor = new (path: string) => MdictInstance;

function loadMdictCtor(): MdictCtor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = require("mdict-js");
  const Ctor = mod?.default ?? mod?.Mdict ?? mod;
  if (typeof Ctor !== "function") {
    throw new Error("mdict-js: Mdict constructor not found");
  }
  return Ctor as MdictCtor;
}

const Mdict = loadMdictCtor();
const cache = new Map<string, MdictInstance>();
/** mddPath + "\0" + lookupKey → data URL 或 null（未命中） */
const resourceDataCache = new Map<string, string | null>();

function getMdict(filePath: string): MdictInstance {
  let inst = cache.get(filePath);
  if (!inst) {
    inst = new Mdict(filePath);
    cache.set(filePath, inst);
  }
  return inst;
}

export function clearMdictCache(filePath?: string): void {
  if (filePath) {
    cache.delete(filePath);
    const prefix = `${filePath}\0`;
    for (const k of resourceDataCache.keys()) {
      if (k.startsWith(prefix)) resourceDataCache.delete(k);
    }
  } else {
    cache.clear();
    resourceDataCache.clear();
  }
}

/** 读 MDX header：UTF-16LE XML；Encrypted bit0=记录块加密 → unsupported */
export async function readMdxHeaderEncrypted(mdxPath: string): Promise<{
  title?: string;
  encrypt: number;
}> {
  const fh = await fsOpen(mdxPath, "r");
  try {
    const sizeBuf = Buffer.alloc(4);
    await fh.read(sizeBuf, 0, 4, 0);
    const headerByteSize = sizeBuf.readUInt32BE(0);
    if (headerByteSize === 0 || headerByteSize > 1024 * 1024) {
      throw new Error(`MDX header size out of range: ${headerByteSize}`);
    }
    const xmlBuf = Buffer.alloc(headerByteSize);
    await fh.read(xmlBuf, 0, headerByteSize, 4);
    const xml = xmlBuf.toString("utf16le").replace(/\0+$/g, "");
    const attrs: Record<string, string> = {};
    for (const m of xml.matchAll(/(\w+)="((?:.|\r|\n)*?)"/g)) {
      attrs[m[1]!] = m[2]!;
    }
    let encrypt = 0;
    const encVal = attrs["Encrypted"];
    if (!encVal || encVal === "" || encVal === "No") encrypt = 0;
    else if (encVal === "Yes") encrypt = 1;
    else {
      const n = parseInt(encVal, 10);
      encrypt = Number.isFinite(n) ? n : 0;
    }
    return {
      title: attrs["Title"]?.trim() || undefined,
      encrypt,
    };
  } finally {
    await fh.close();
  }
}

/** 去掉 script；保留 style 留给外挂/资源 CSS 注入路径；去掉 MDX 尾部 NUL */
export function simplifyMdictHtml(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/\u0000+/g, "");
  return s.trim();
}

function extractLinkTarget(definition: string): string | null {
  // MDX 记录常以 \\r\\n\\0 结尾；\\0 不是 trim() 空白，会污染 LINK 目标键
  const t = definition
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^@@@LINK=/i.test(t)) {
    return t.replace(/^@@@LINK=/i, "").trim() || null;
  }
  return null;
}

export type MdictLookupResult = {
  keyText: string;
  definition: string;
};

function mimeFromResourcePath(resourcePath: string): string {
  const ext = path.extname(resourcePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".spx":
      // Speex：浏览器不能播，解析时转成 WAV
      return "audio/speex";
    case ".aac":
      return "audio/aac";
    case ".m4a":
      return "audio/mp4";
    case ".css":
      return "text/css";
    default:
      return "application/octet-stream";
  }
}

/** 清洗 MDX 里常见的脏路径（含 \\u001f 分隔符），生成 MDD 查找候选键 */
export function mddKeyCandidates(raw: string): string[] {
  let s = String(raw ?? "").trim();
  if (!s) return [];
  s = s.replace(/^(?:sound|entry|file|res):\/\//i, "");
  s = s.replace(/[\u0000-\u001f\u007f]+/g, "");
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  s = s.replace(/^["']+|["']+$/g, "").trim();
  if (!s || /^https?:\/\//i.test(s) || /^data:/i.test(s)) return [];

  s = s.replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  while (s.startsWith("/")) s = s.slice(1);

  const forward = s;
  const back = s.replace(/\//g, "\\");
  const out: string[] = [];
  const push = (k: string) => {
    if (k && !out.includes(k)) out.push(k);
  };
  push(`\\${back}`);
  push(back);
  push(`/${forward}`);
  push(forward);
  // 部分词库键大小写不一致
  push(`\\${back.toLowerCase()}`);
  push(`\\${back.toUpperCase()}`);
  return out;
}

async function lookupMddDataUrl(
  mddPaths: string[],
  rawPath: string,
): Promise<string | null> {
  const keys = mddKeyCandidates(rawPath);
  if (!keys.length || !mddPaths.length) return null;

  for (const mddPath of mddPaths) {
    let mdd: MdictInstance;
    try {
      mdd = getMdict(mddPath);
    } catch {
      continue;
    }
    for (const key of keys) {
      const cacheKey = `${mddPath}\0${key}`;
      if (resourceDataCache.has(cacheKey)) {
        const cached = resourceDataCache.get(cacheKey);
        if (cached) return cached;
        continue;
      }
      let def: WordDefinition;
      try {
        def = mdd.lookup(key);
      } catch {
        resourceDataCache.set(cacheKey, null);
        continue;
      }
      const b64 = def?.definition;
      if (!b64) {
        resourceDataCache.set(cacheKey, null);
        continue;
      }
      let mime = mimeFromResourcePath(def.keyText || key);
      let outB64 = b64;
      const rawBuf = Buffer.from(b64, "base64");
      const wantSpeex =
        /\.spx$/i.test(def.keyText || key) ||
        mime === "audio/speex" ||
        looksLikeOggSpeex(rawBuf);
      if (wantSpeex) {
        try {
          const wav = await oggSpeexToWav(rawBuf);
          if (wav?.length) {
            outB64 = wav.toString("base64");
            mime = "audio/wav";
          }
        } catch {
          /* keep original bytes; playback may still fail */
        }
      }
      const dataUrl = `data:${mime};base64,${outB64}`;
      resourceDataCache.set(cacheKey, dataUrl);
      for (const alt of keys) {
        if (alt !== key) resourceDataCache.set(`${mddPath}\0${alt}`, dataUrl);
      }
      return dataUrl;
    }
  }
  return null;
}

async function resolveResourceDataUrl(
  mddPaths: string[],
  rawPath: string,
): Promise<string | null> {
  return lookupMddDataUrl(mddPaths, rawPath);
}

function decodeMddCssText(base64: string): string {
  try {
    return Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

async function loadExternalCss(cssPaths: string[]): Promise<string[]> {
  const chunks: string[] = [];
  for (const p of cssPaths) {
    try {
      const text = await readFile(p, "utf8");
      const t = text.trim();
      if (t) chunks.push(t);
    } catch {
      /* skip missing */
    }
  }
  return chunks;
}

async function replaceAttrUrls(
  html: string,
  attrName: string,
  mddPaths: string[],
  opts?: { onlySoundProtocol?: boolean },
): Promise<string> {
  const re = new RegExp(
    `(\\b${attrName}\\s*=\\s*)(["'])([^"']*)\\2`,
    "gi",
  );
  const matches = [...html.matchAll(re)];
  if (!matches.length) return html;
  let out = "";
  let last = 0;
  for (const m of matches) {
    const idx = m.index ?? 0;
    out += html.slice(last, idx);
    const full = m[0]!;
    const prefix = m[1]!;
    const quote = m[2]!;
    const raw = m[3]!;
    const trimmed = raw.trim();
    let replacement = full;
    if (trimmed && !/^data:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
      const isSoundProtocol = /^(?:sound|res):\/\//i.test(trimmed);
      if (!opts?.onlySoundProtocol || isSoundProtocol) {
        const dataUrl = await resolveResourceDataUrl(mddPaths, trimmed);
        if (dataUrl) {
          replacement = `${prefix}${quote}${dataUrl}${quote}`;
        } else if (isSoundProtocol) {
          replacement = `${prefix}${quote}#${quote}`;
        }
      }
    }
    out += replacement;
    last = idx + full.length;
  }
  out += html.slice(last);
  return out;
}

/**
 * 将 MDX HTML 中的相对资源改写为 data URL，并注入外挂 / MDD 内 CSS。
 */
export async function resolveMdictResources(
  html: string,
  opts: { mddPaths?: string[]; cssPaths?: string[] },
): Promise<string> {
  const mddPaths = (opts.mddPaths ?? []).filter(Boolean);
  const cssPaths = (opts.cssPaths ?? []).filter(Boolean);
  let s = html;

  const cssChunks = await loadExternalCss(cssPaths);
  /** 词库声明过外挂/内联样式（解析后 link/style 会被剥掉，前端靠此标记套浅底板） */
  let sawDictStylesheet = cssChunks.length > 0;

  // <link rel=stylesheet href="xxx.css"> → 从 mdd 取 CSS 后去掉 link
  const linkRe = /<link\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  const linkMatches = [...s.matchAll(linkRe)];
  if (linkMatches.length) {
    let out = "";
    let last = 0;
    for (const m of linkMatches) {
      const idx = m.index ?? 0;
      out += s.slice(last, idx);
      const full = m[0]!;
      const href = m[2]!;
      if (/\.css(?:\?|#|$)/i.test(href) || /stylesheet/i.test(full)) {
        sawDictStylesheet = true;
        const dataUrl = await lookupMddDataUrl(mddPaths, href);
        if (dataUrl) {
          const comma = dataUrl.indexOf(",");
          const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
          const css = decodeMddCssText(b64).trim();
          if (css) cssChunks.push(css);
        }
        // 去掉死链 / 已注入的 link
      } else {
        out += full;
      }
      last = idx + full.length;
    }
    out += s.slice(last);
    s = out;
  }

  // 去掉仍留在释义里的内联 <style>（词典自带样式改由上方注入，避免重复/脚本风险）
  if (/<style[\s\S]*?<\/style>/i.test(s)) sawDictStylesheet = true;
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");

  // 图片
  s = await replaceAttrUrls(s, "src", mddPaths);

  // sound:// → data:audio；并给 <a> 打上 dictSound 便于点击播放
  const aRe = /<a\b([^>]*?)>/gi;
  const aMatches = [...s.matchAll(aRe)];
  if (aMatches.length) {
    let out = "";
    let last = 0;
    for (const m of aMatches) {
      const idx = m.index ?? 0;
      out += s.slice(last, idx);
      const full = m[0]!;
      const attrs = m[1]!;
      const hrefM = attrs.match(/\bhref\s*=\s*(["'])([^"']*)\1/i);
      if (!hrefM) {
        out += full;
        last = idx + full.length;
        continue;
      }
      const href = hrefM[2]!.trim();
      if (/^(?:entry|bword):\/\//i.test(href)) {
        let target = href.replace(/^(?:entry|bword):\/\//i, "").trim();
        try {
          target = decodeURIComponent(target);
        } catch {
          /* keep */
        }
        target = target
          .replace(/&amp;/gi, "&")
          .replace(/[\u0000-\u001f\u007f]+/g, "")
          .trim();
        if (!target) {
          const nextAttrs = attrs.replace(
            /\bhref\s*=\s*(["'])[^"']*\1/i,
            'href="#"',
          );
          out += `<a${nextAttrs}>`;
          last = idx + full.length;
          continue;
        }
        const esc = target
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        let nextAttrs = attrs.replace(
          /\bhref\s*=\s*(["'])[^"']*\1/i,
          'href="#"',
        );
        if (!/\bclass\s*=/i.test(nextAttrs)) {
          nextAttrs += ` class="dictEntry"`;
        } else if (!/\bdictEntry\b/.test(nextAttrs)) {
          nextAttrs = nextAttrs.replace(
            /\bclass\s*=\s*(["'])([^"']*)\1/i,
            (_mm, q: string, cls: string) => `class=${q}${cls} dictEntry${q}`,
          );
        }
        if (/\bdata-dict-entry\s*=/i.test(nextAttrs)) {
          nextAttrs = nextAttrs.replace(
            /\bdata-dict-entry\s*=\s*(["'])[^"']*\1/i,
            `data-dict-entry="${esc}"`,
          );
        } else {
          nextAttrs += ` data-dict-entry="${esc}"`;
        }
        out += `<a${nextAttrs}>`;
        last = idx + full.length;
        continue;
      }
      if (!/^(?:sound|res):\/\//i.test(href)) {
        out += full;
        last = idx + full.length;
        continue;
      }
      const dataUrl = await resolveResourceDataUrl(mddPaths, href);
      if (!dataUrl) {
        const nextAttrs = attrs.replace(
          /\bhref\s*=\s*(["'])[^"']*\1/i,
          'href="#"',
        );
        out += `<a${nextAttrs}>`;
        last = idx + full.length;
        continue;
      }
      let nextAttrs = attrs.replace(
        /\bhref\s*=\s*(["'])[^"']*\1/i,
        `href="${dataUrl}"`,
      );
      if (!/\bclass\s*=/i.test(nextAttrs)) {
        nextAttrs += ` class="dictSound"`;
      } else if (!/\bdictSound\b/.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(
          /\bclass\s*=\s*(["'])([^"']*)\1/i,
          (_mm, q: string, cls: string) => `class=${q}${cls} dictSound${q}`,
        );
      }
      if (!/\bdata-dict-sound\s*=/i.test(nextAttrs)) {
        nextAttrs += ` data-dict-sound="1"`;
      }
      out += `<a${nextAttrs}>`;
      last = idx + full.length;
    }
    out += s.slice(last);
    s = out;
  }

  // 未改写到的残留 sound href（非 <a> 场景极少）
  s = await replaceAttrUrls(s, "href", mddPaths, {
    onlySoundProtocol: true,
  });

  if (cssChunks.length) {
    const css = cssChunks.join("\n");
    s = `<style>${css}</style>${s}`;
  }

  // MDD 缺 CSS 时 link 已被剥掉，前端仍需识别「依赖词库样式」的释义
  if (sawDictStylesheet && !/<!--colortxt-legacy-css-->/.test(s)) {
    s = `<!--colortxt-legacy-css-->${s}`;
  }

  return s;
}

/**
 * 查词并跟随 @@@LINK=（最多 5 跳）。
 * 传入 mdd/css 时会把释义里的图片与语音资源改成 data URL。
 */
export async function lookupMdict(
  mdxPath: string,
  word: string,
  resourceOpts?: { mddPaths?: string[]; cssPaths?: string[] },
): Promise<MdictLookupResult | null> {
  const mdict = getMdict(mdxPath);
  const candidates = buildLookupCandidates(word);
  for (const cand of candidates) {
    let current = cand;
    for (let hop = 0; hop < 6; hop++) {
      let def: WordDefinition;
      try {
        def = mdict.lookup(current);
      } catch {
        break;
      }
      if (!def?.definition) break;
      const link = extractLinkTarget(def.definition);
      if (link && hop < 5) {
        current = link;
        continue;
      }
      let definition = simplifyMdictHtml(def.definition);
      if (
        resourceOpts &&
        ((resourceOpts.mddPaths?.length ?? 0) > 0 ||
          (resourceOpts.cssPaths?.length ?? 0) > 0)
      ) {
        definition = await resolveMdictResources(definition, resourceOpts);
      } else {
        // 无资源时仍去掉 style，与旧行为一致
        definition = definition.replace(/<style[\s\S]*?<\/style>/gi, "").trim();
      }
      return {
        keyText: def.keyText || current,
        definition,
      };
    }
  }
  return null;
}

/** 测试 / 调试用：按路径取 MDD 资源 data URL */
export async function lookupMddDataUrlForTest(
  mddPaths: string[],
  rawPath: string,
): Promise<string | null> {
  return resolveResourceDataUrl(mddPaths, rawPath);
}
