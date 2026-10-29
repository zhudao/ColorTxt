import type { Cheerio, CheerioAPI } from "cheerio";

export type LegadoAttrSelector = {
  attr: string;
  op: "=" | "$=" | "^=" | "*=" | "~=";
  values: string[];
};

/** Legado/书源常用 meta 属性选择器：[name$=author]、[name~=a|b|c] */
export function parseLegadoAttrSelector(segment: string): LegadoAttrSelector | null {
  const seg = segment.trim();
  const m = seg.match(/^\[([\w-]+)(=|\$=|\^=|\*=|~=)([^\]]+)\]$/);
  if (!m) return null;
  const values = m[3]
    .split("|")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  if (!values.length) return null;
  return {
    attr: m[1],
    op: m[2] as LegadoAttrSelector["op"],
    values,
  };
}

export function isLegadoAttrSelectorSegment(segment: string): boolean {
  return parseLegadoAttrSelector(segment) != null;
}

/**
 * Cheerio/css-select 要求含空格、冒号等的属性值加引号；
 * Jsoup 对无引号值更宽松（如书源 `div[style=text-indent: 2em;]`）。
 * 对齐 Legado：给无引号且含特殊字符的属性值补双引号。
 */
export function quoteLegadoCssUnquotedAttrValues(css: string): string {
  return css.replace(
    /\[(\s*[\w-]+\s*)(=|\$=|\^=|\*=|~=)([^\]]*)\]/g,
    (full, attrWithWs: string, op: string, raw: string) => {
      const value = raw.trim();
      if (!value) return full;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        return full;
      }
      // 无引号且含 CSS 属性值禁用字符时补引号
      if (!/[\s"'`=<>/:;(),]/.test(value)) return full;
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `[${attrWithWs.trim()}${op}"${escaped}"]`;
    },
  );
}

/**
 * Legado 书源属性 `~=` 表示「包含」（与 `*=` 相同），而标准 CSS `~=` 是空格分隔整词匹配。
 * Cheerio/css-select 按 CSS 语义会漏掉 `href` 含 `rcatalog` 却整词不是 `catalog` 的链接
 *（如 `a[href~=catalog]` → 部分书源目录）。仅改写属性选择器内的 `~=`，不影响兄弟组合器 `A ~ B`。
 */
export function normalizeLegadoCssAttrContains(css: string): string {
  const withContains = css.replace(/\[(\s*[\w-]+\s*)~=([^\]]*)\]/g, "[$1*=$2]");
  return quoteLegadoCssUnquotedAttrValues(withContains);
}

export function matchLegadoAttrValue(
  attrValue: string | undefined,
  sel: LegadoAttrSelector,
): boolean {
  if (attrValue == null) return false;
  const v = attrValue;
  switch (sel.op) {
    case "=":
      return sel.values.some((x) => v === x);
    case "$=":
      return sel.values.some((x) => v.endsWith(x));
    case "^=":
      return sel.values.some((x) => v.startsWith(x));
    case "*=":
    case "~=":
      return sel.values.some((x) => v.includes(x));
    default:
      return false;
  }
}

export function queryLegadoAttrSelector(
  $: CheerioAPI,
  segment: string,
): Cheerio<any> {
  const parsed = parseLegadoAttrSelector(segment);
  if (!parsed) {
    try {
      return $(segment);
    } catch {
      return $("");
    }
  }
  // Legado AnalyzeByJSoup：带引号的 [name="og:image"] 等走 CSS 选择器
  if (parsed.op === "=" && parsed.values.length === 1) {
    try {
      const viaCss = $(`[${parsed.attr}="${parsed.values[0]}"]`);
      if (viaCss.length) return viaCss;
    } catch {
      /* fallback to meta scan */
    }
  }
  const matched: any[] = [];
  $("meta, link, [name], [property], [content]").each((_, el) => {
    const val = $(el).attr(parsed.attr);
    if (matchLegadoAttrValue(val, parsed)) matched.push(el);
  });
  return $(matched);
}
