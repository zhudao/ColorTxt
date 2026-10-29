/** 常见 HTML 命名实体 → Unicode（小写键名） */
const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: "\u0020",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  laquo: "\u00ab",
  raquo: "\u00bb",
};

const GENERIC_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s[^>]*)?\/?>/gi;
const NUMERIC_DEC_ENTITY_RE = /&#(\d+);/g;
const NUMERIC_HEX_ENTITY_RE = /&#x([0-9a-fA-F]+);/g;
const NAMED_ENTITY_RE = /&([a-zA-Z]+);/g;

function decodeNumericEntity(raw: string, radix: 10 | 16): string {
  const cp = Number.parseInt(raw, radix);
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return `&#${raw};`;
  if (cp >= 0xd800 && cp <= 0xdfff) return `&#${raw};`;
  return String.fromCodePoint(cp);
}

function decodeHtmlEntitiesOnce(text: string): string {
  let out = text.replace(NUMERIC_DEC_ENTITY_RE, (_, dec: string) =>
    decodeNumericEntity(dec, 10),
  );
  out = out.replace(NUMERIC_HEX_ENTITY_RE, (_, hex: string) =>
    decodeNumericEntity(hex, 16),
  );
  out = out.replace(NAMED_ENTITY_RE, (match, name: string) => {
    const decoded = HTML_NAMED_ENTITIES[name.toLowerCase()];
    return decoded ?? match;
  });
  return out;
}

/** 解码 `&#…;` / `&nbsp;` / `&gt;` 等 HTML 实体（多轮以处理 `&amp;lt;`） */
export function decodeHtmlEntities(text: string): string {
  let out = text;
  for (let i = 0; i < 6; i++) {
    const next = decodeHtmlEntitiesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** 移除简单 HTML 标签（含 br/img/span 等；保留标签内文本） */
export function stripSimpleHtmlTags(text: string): string {
  return text.replace(GENERIC_TAG_RE, "");
}

/**
 * 清理正文中的 HTML 转换残留：去标签、解码实体。
 * 不删解码后的站宣内容（交给「移除广告/引流」等 AI 子任务）。
 */
export function cleanHtmlRemnantsInText(text: string): string {
  return decodeHtmlEntities(stripSimpleHtmlTags(text));
}
