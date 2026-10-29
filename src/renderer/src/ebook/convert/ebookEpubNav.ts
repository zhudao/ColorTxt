/**
 * EPUB nav.xhtml / toc.ncx 目录解析（foliate-js 思路简化版）。
 */

import type JSZip from "jszip";
import {
  dedupeEmbeddedTocEntries,
  flattenFoliateStyleTocTree,
  type EmbeddedTocEntry,
} from "./ebookTocTypes";
import { compactFootnoteLinkFragment } from "./ebookFootnoteLinkFragments";

const EPUB_NS = "http://www.idpf.org/2007/ops";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const NCX_NS = "http://www.daisy.org/z3986/2005/ncx/";

function zipPathCompareKey(posixPath: string): string {
  return posixPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function resolveInZip(htmlDirInZip: string, href: string): string {
  const pathOnly = href.split("#")[0]!.trim();
  const stack = htmlDirInZip.replace(/^\//, "").split("/").filter(Boolean);
  for (const seg of pathOnly.split("/")) {
    if (seg === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    if (seg && seg !== ".") stack.push(seg);
  }
  return stack.join("/");
}

function epubLinkKeyFromZipPath(zipPath: string): string {
  const norm = zipPath.replace(/\\/g, "/").trim();
  const seg = norm.split("/").pop();
  return seg && seg.length > 0 ? seg : norm;
}

function getElementText(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** 仅直接子元素；勿用 `getElementsByTagName`（会把嵌套 `li`/`navPoint` 误当作同级） */
function directChildElements(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(
    (el) => el.localName === localName,
  );
}

function childGetter(ns: string) {
  const $ = (parent: Element | Document, local: string) => {
    const list = (parent as Element).getElementsByTagNameNS?.(ns, local);
    if (list && list.length > 0) return list[0] as Element;
    const q = (parent as Document | Element).querySelector?.(
      ns === XHTML_NS ? local : `*[local-name()="${local}"]`,
    );
    return (q as Element | null) ?? null;
  };
  const $$ = (parent: Element, local: string) =>
    Array.from(parent.getElementsByTagNameNS(ns, local));
  const $$$ = (parent: Document, local: string) =>
    Array.from(parent.getElementsByTagNameNS(ns, local));
  return { $, $$, $$$ };
}

type FoliateTocNode = {
  label?: string;
  href?: string;
  subitems?: FoliateTocNode[];
};

function parseNavDocument(
  doc: Document,
  resolve: (url: string) => string,
): FoliateTocNode[] | null {
  const { $, $$$ } = childGetter(XHTML_NS);
  const resolveHref = (href: string | null | undefined) =>
    href ? decodeURI(resolve(href)) : null;

  const parseLI =
    () =>
    ($li: Element): FoliateTocNode => {
      const $a = $($li, "a") ?? $($li, "span");
      const $ol = $($li, "ol");
      const href = resolveHref($a?.getAttribute("href"));
      const label = getElementText($a) || $a?.getAttribute("title") || undefined;
      return {
        label,
        href: href ?? undefined,
        subitems: parseOL($ol) ?? undefined,
      };
    };

  const parseOL = ($ol: Element | null): FoliateTocNode[] | null => {
    if (!$ol) return null;
    return directChildElements($ol, "li").map(parseLI());
  };

  const parseNavEl = ($nav: Element): FoliateTocNode[] | null =>
    parseOL($($nav, "ol"));

  const navEls = new Set<Element>();
  for (const el of $$$(doc, "nav")) navEls.add(el);
  for (const el of doc.querySelectorAll("nav")) navEls.add(el);

  for (const $nav of navEls) {
    const type =
      $nav.getAttributeNS(EPUB_NS, "type")?.split(/\s/) ??
      $nav.getAttribute("epub:type")?.split(/\s/) ??
      [];
    if (type.includes("toc")) {
      return parseNavEl($nav);
    }
  }
  return null;
}

function parseNcxDocument(
  doc: Document,
  resolve: (url: string) => string,
): FoliateTocNode[] | null {
  const { $ } = childGetter(NCX_NS);
  const resolveHref = (href: string | null | undefined) =>
    href ? decodeURI(resolve(href)) : null;

  const parseItem = (el: Element): FoliateTocNode => {
    const $label = $(el, "navLabel");
    const $content = $(el, "content");
    const label = getElementText($label);
    const href = resolveHref($content?.getAttribute("src"));
    if (el.localName === "navPoint") {
      const els = directChildElements(el, "navPoint");
      return {
        label,
        href: href ?? undefined,
        subitems: els.length ? els.map(parseItem) : undefined,
      };
    }
    return { label, href: href ?? undefined };
  };

  const navMap = doc.documentElement
    ? $(doc.documentElement, "navMap")
    : null;
  if (!navMap) return null;
  return directChildElements(navMap, "navPoint").map(parseItem);
}

function resolveUrl(baseHref: string, url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const baseDir = baseHref.includes("/")
    ? baseHref.slice(0, baseHref.lastIndexOf("/"))
    : "";
  if (url.startsWith("/")) return url.replace(/^\/+/, "");
  if (!baseDir) return url;
  return `${baseDir}/${url}`;
}

function resolveEpubTocHrefToTargetId(
  href: string,
  /** OPF 所在目录（ZIP 内）；nav/NCX 经 resolveUrl 后的 href 均相对 OPF 包根 */
  opfDirInZip: string,
  zipPathToLinkStem: ReadonlyMap<string, string>,
): string | null {
  const h = href.trim();
  if (!h || /^https?:\/\//i.test(h)) return null;

  const hashIdx = h.indexOf("#");
  const pathPart = hashIdx >= 0 ? h.slice(0, hashIdx).trim() : h.trim();
  const fragRaw = hashIdx >= 0 ? h.slice(hashIdx + 1) : "";
  const frag = compactFootnoteLinkFragment(fragRaw);

  if (!pathPart) {
    if (!frag) return null;
    return null;
  }

  const zipPath = resolveInZip(opfDirInZip, pathPart);
  const stem =
    zipPathToLinkStem.get(zipPathCompareKey(zipPath)) ??
    epubLinkKeyFromZipPath(zipPath);
  if (frag) return `${stem}#${frag}`;
  return stem;
}

function getOpfNavAndNcxPaths(opfDoc: Document): {
  navPath: string | null;
  ncxPath: string | null;
} {
  type Item = { href: string; media: string; properties: string; id: string };
  const manifest: Item[] = [];
  for (const item of opfDoc.querySelectorAll("manifest > item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    manifest.push({
      id,
      href,
      media: (item.getAttribute("media-type") ?? "").toLowerCase(),
      properties: (item.getAttribute("properties") ?? "").toLowerCase(),
    });
  }
  const byId = new Map(manifest.map((m) => [m.id, m]));
  const navItem = manifest.find((m) =>
    m.properties.split(/\s/).includes("nav"),
  );
  const spine = opfDoc.querySelector("spine");
  const tocId = spine?.getAttribute("toc");
  const ncxItem =
    (tocId ? byId.get(tocId) : undefined) ??
    manifest.find((m) => m.media === "application/x-dtbncx+xml");
  return {
    navPath: navItem?.href ?? null,
    ncxPath: ncxItem?.href ?? null,
  };
}

async function readZipUtf8(
  zip: JSZip,
  path: string,
  findZipFile: (zip: JSZip, p: string) => JSZip.JSZipObject | null,
): Promise<string | null> {
  const f = findZipFile(zip, path);
  if (!f) return null;
  return f.async("string");
}

/**
 * 从 OPF 解析 nav / NCX，将 href 映射为 `epub-NNNN#fragment` 嵌入目录项。
 */
export async function extractEpubEmbeddedTocEntries(params: {
  zip: JSZip;
  opfPath: string;
  opfDoc: Document;
  zipPathToLinkStem: ReadonlyMap<string, string>;
  findZipFile: (zip: JSZip, p: string) => JSZip.JSZipObject | null;
}): Promise<EmbeddedTocEntry[]> {
  const opfDir = params.opfPath.includes("/")
    ? params.opfPath.slice(0, params.opfPath.lastIndexOf("/"))
    : "";
  const { navPath, ncxPath } = getOpfNavAndNcxPaths(params.opfDoc);

  let tree: FoliateTocNode[] | null = null;

  if (navPath) {
    const fullNav = resolveInZip(opfDir, navPath);
    const xml = await readZipUtf8(params.zip, fullNav, params.findZipFile);
    if (xml) {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const resolve = (url: string) => resolveUrl(navPath, url);
      tree = parseNavDocument(doc, resolve);
    }
  }

  if (!tree?.length && ncxPath) {
    const fullNcx = resolveInZip(opfDir, ncxPath);
    const xml = await readZipUtf8(params.zip, fullNcx, params.findZipFile);
    if (xml) {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const resolve = (url: string) => resolveUrl(ncxPath, url);
      tree = parseNcxDocument(doc, resolve);
    }
  }

  if (!tree?.length) return [];

  /** parseNav/parseNCX 内 resolveUrl 产出 OPF 相对路径，勿再用 nav 文件目录二次 resolve */
  const resolveHref = (href: string) =>
    resolveEpubTocHrefToTargetId(href, opfDir, params.zipPathToLinkStem);

  return dedupeEmbeddedTocEntries(
    flattenFoliateStyleTocTree(tree, resolveHref),
  );
}
