export type LegadoCompoundSplit = {
  parts: string[];
  /** 首次出现的组合分隔符；无则为 && */
  joiner: "&&" | "||" | "%%";
};

/**
 * Legado kind 等字段：`&&` / `||` 拆成多段分别取值（不切断 {{}}、{$.}、<js>）
 * 与 splitSourceRule 的链式 && 不同。
 */
export function splitLegadoCompoundRule(rule: string): LegadoCompoundSplit {
  const trimmed = rule.trim();
  if (!trimmed) return { parts: [], joiner: "&&" };

  const parts: string[] = [];
  let buf = "";
  let joiner: "&&" | "||" | "%%" = "&&";
  let joinerSet = false;
  let i = 0;

  const flush = () => {
    const t = buf.trim();
    if (t) parts.push(t);
    buf = "";
  };

  while (i < trimmed.length) {
    const rest = trimmed.slice(i);

    if (/^<js>/i.test(rest)) {
      const end = findJsBlockEnd(rest);
      if (end < 0) {
        buf += rest;
        break;
      }
      buf += rest.slice(0, end);
      i += end;
      continue;
    }

    if (/^@js:/i.test(rest)) {
      const body = rest.slice(4);
      const splitAt = findAtJsBodySplitIndex(body);
      let end = rest.length;
      if (splitAt >= 0) end = splitAt + 4;
      buf += rest.slice(0, end);
      i += end;
      continue;
    }

    if (rest.startsWith("{{")) {
      const close = trimmed.indexOf("}}", i + 2);
      if (close < 0) {
        buf += rest[0];
        i++;
        continue;
      }
      buf += trimmed.slice(i, close + 2);
      i = close + 2;
      continue;
    }

    if (rest.startsWith("{$.")) {
      let depth = 0;
      let j = i;
      while (j < trimmed.length) {
        const ch = trimmed[j];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            buf += trimmed.slice(i, j + 1);
            i = j + 1;
            break;
          }
        }
        j++;
      }
      if (depth !== 0) {
        buf += trimmed[i];
        i++;
      }
      continue;
    }

    if (rest.startsWith("&&") || rest.startsWith("||") || rest.startsWith("%%")) {
      const op = rest.startsWith("%%") ? "%%" : rest.startsWith("||") ? "||" : "&&";
      flush();
      if (!joinerSet) {
        joiner = op;
        joinerSet = true;
      }
      i += op.length;
      continue;
    }

    buf += trimmed[i];
    i++;
  }

  flush();
  return { parts: parts.length ? parts : [trimmed], joiner };
}

const JS_OPEN = /^<js>/i;
const JS_CLOSE = /<\/js>/i;
const AT_JS_OPEN = /^@js:/i;
const AT_WEBJS_OPEN = /^@webjs:/i;

/**
 * 去掉 `<js>`/`</js>`、`@js:`、`js:` 标记。
 * 书源规则常带前导换行/空格，必须先 trim 再判（否则会留下字面量标签导致语法错误）。
 */
export function stripLegadoJsRuleMarkers(rule: string): string {
  let s = rule.trim();
  if (/^<js>/i.test(s)) {
    s = s.replace(/^<js>/i, "").replace(/<\/js>\s*$/i, "").trim();
  } else if (/^@js:/i.test(s)) {
    s = s.replace(/^@js:\s*/i, "").trim();
  } else if (/^js:/i.test(s)) {
    s = s.replace(/^js:\s*/i, "").trim();
  }
  return s;
}

/** 是否为 JS 规则块（允许前导空白） */
export function isLegadoJsRule(rule: string): boolean {
  const t = rule.trim();
  return /^<js>/i.test(t) || /^@js:/i.test(t) || /^js:/i.test(t);
}

/**
 * @js: 脚本体换行后的下一段 Legado 规则行。
 * 须排除：
 * - JS 单行注释（//java.log、// 中文说明等）
 * - JS 正则字面量及后续表达式（`/pat/g,`、`/vip/.test(result)`），勿当成 XPath `/path`
 * 否则会截断 searchUrl / replaceRegex / isVip 等多行脚本。
 */
function isLegadoRuleLineAfterJs(line: string): boolean {
  const t = line.trimStart();
  if (!t) return false;
  // JS 正则：整行 `/pat/flags`，或 `/pat/.test(...)` / `/pat/ &&` 等（如 isVip 判断）
  {
    const m = t.match(/^\/(?:\\.|[^/\n])+\/[gimsuyd]*/i);
    if (m) {
      const rest = t.slice(m[0].length).replace(/^\s+/, "");
      if (
        !rest ||
        /^[,;]?\s*$/.test(rest) ||
        /^[.\[\])]/.test(rest) ||
        /^(?:&&|\|\||\?)/.test(rest)
      ) {
        return false;
      }
    }
  }
  /**
   * 纯 JSONPath 续行：`$.a` / `$..a` / `$[0]` / `$['k']`。
   * 勿匹配 `$[i].select(...)` 等 JS（Legado `@js:([\w\W]*)` 贪婪吃到规则末尾）。
   */
  if (/^\$/.test(t)) {
    const lineOnly = t.trimEnd();
    if (/^\$\[[A-Za-z_$]/.test(lineOnly)) return false;
    if (/^\$\.[.\w\[\]*'"]+$/.test(lineOnly)) return true;
    if (/^\$\[[0-9]+\]$/.test(lineOnly)) return true;
    if (/^\$\[['\"][^'\"]+['\"]\]$/.test(lineOnly)) return true;
    return false;
  }
  if (/^@(?:json|Json|XPath|xpath|css|Css):/.test(t)) return true;
  if (/^\/[^/\s]/.test(t)) return true;
  if (t.startsWith("//")) {
    if (/^\/\/[\w-]+\./.test(t)) return false;
    if (/^\/\/\s/.test(t)) return false;
    if (/^\/\/\s*[\u4e00-\u9fff]/.test(t)) return false;
    return /^\/\/(?:\*|[\w-]+(?:@|\[|$))/i.test(t);
  }
  return false;
}

function findAtJsBodySplitIndex(body: string): number {
  let pos = 0;
  while (pos < body.length) {
    const nl = body.indexOf("\n", pos);
    if (nl < 0) return -1;
    const lineEnd = body.indexOf("\n", nl + 1);
    const line = body.slice(nl + 1, lineEnd >= 0 ? lineEnd : undefined);
    if (isLegadoRuleLineAfterJs(line)) return nl;
    pos = nl + 1;
  }
  return -1;
}

/** Legado 无 <js> 包裹时：脚本 + 换行 + $.path */
function splitScriptJsonCompound(
  text: string,
): { script: string; jsonRule: string } | null {
  const trimmed = text.trim();
  const m = trimmed.match(/^([\s\S]*?\n)(\$[\.\[][^\n&]*)\s*$/);
  if (!m?.[1] || !m[2]) return null;
  if (!looksLikeLegadoJs(m[1])) return null;
  return { script: m[1].trim(), jsonRule: m[2].trim() };
}

/** Legado `ruleA||ruleB` 备选；`<js>` / `@js:` / `{{}}` 内部的 `||` 是 JS/JSONPath 逻辑或，不能拆 */
export function shouldSplitOrAlternatives(rule: string): boolean {
  if (!rule.includes("||")) return false;
  const trimmed = rule.trim();
  if (/^@js:/im.test(trimmed) || /^@webjs:/im.test(trimmed)) return false;
  // 规则链（selector||alt + <js> + ##）的 || 在首段内处理，勿整段拆开
  if (splitSourceRule(rule).length > 1) return false;
  const outsideJs = rule
    .replace(/<js>[\s\S]*?<\/js>/gi, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "")
    .replace(/@webjs:[\s\S]*?(?=(?:&&|\|\||$|@js:|@webjs:|@json:|@Json:|@XPath:|@xpath:|@css:|\/\/|\/[^/]))/gi, "");
  return outsideJs.includes("||");
}

export function looksLikeLegadoJs(rule: string): boolean {
  const t = rule.trim();
  if (!t) return false;
  if (JS_OPEN.test(t) || AT_JS_OPEN.test(t)) return true;
  if (
    /^(?:var |let |const |function |if\s*\(|for\s*\(|while\s*\(|return )/.test(t)
  ) {
    return true;
  }
  if (/\bjava\.(?:ajax|md5Encode|get|put|getString|startBrowserAwait|refreshBookUrl|refreshTocUrl|reGetBook|refreshBook)\b/.test(t)) {
    return true;
  }
  if (t.includes("== '") || t.includes('== "') || t.includes("!=")) {
    return true;
  }
  if (
    t.includes("\n") &&
    (t.includes("function ") || t.includes("=>"))
  ) {
    return true;
  }
  return false;
}

function wrapJsBlock(script: string): string {
  const body = script.trim();
  if (JS_OPEN.test(body)) return body;
  if (AT_JS_OPEN.test(body)) return body;
  return `<js>\n${body}\n</js>`;
}

export function wrapLegadoJsRule(rule: string): string {
  const t = rule.trim();
  if (/^<js>/i.test(t) || /^@js:/i.test(t)) return t;
  return `@js:\n${t}`;
}

/** @webjs: 多行脚本；截断规则同 @js: */
export function splitAtWebJsRule(rule: string): { webJsPart: string; rest: string } {
  const trimmed = rule.trim();
  const body = trimmed.replace(AT_WEBJS_OPEN, "").trimStart();
  const splitAt = findAtJsBodySplitIndex(body);
  if (splitAt >= 0) {
    return {
      webJsPart: `@webjs:${body.slice(0, splitAt).trimEnd()}`,
      rest: body.slice(splitAt).trim(),
    };
  }
  return { webJsPart: trimmed, rest: "" };
}

/** @js: 多行脚本；仅当换行后出现 JSON/选择器规则段时才截断 */
export function splitAtJsRule(rule: string): { jsPart: string; rest: string } {
  const trimmed = rule.trim();
  const body = trimmed.replace(AT_JS_OPEN, "").trimStart();
  const splitAt = findAtJsBodySplitIndex(body);
  if (splitAt >= 0) {
    return {
      jsPart: `@js:${body.slice(0, splitAt).trimEnd()}`,
      rest: body.slice(splitAt).trim(),
    };
  }
  return { jsPart: trimmed, rest: "" };
}

function findJsBlockEnd(text: string): number {
  const m = JS_CLOSE.exec(text);
  return m?.index != null ? m.index + m[0].length : -1;
}

function mergeOrphanAtJsSegments(parts: string[]): string[] {
  const merged: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/^@js:\s*$/i.test(part.trim()) && i + 1 < parts.length) {
      merged.push(`${part.trim()}\n${parts[i + 1]}`);
      i++;
      continue;
    }
    merged.push(part);
  }
  return merged;
}

export function splitSourceRule(rule: string): string[] {
  const trimmed = rule.trim();
  if (!trimmed) return [];

  const out: string[] = [];
  let remaining = trimmed;

  while (remaining) {
    remaining = remaining.trimStart();
    if (!remaining) break;

    if (JS_OPEN.test(remaining)) {
      const end = findJsBlockEnd(remaining);
      if (end < 0) {
        out.push(remaining);
        break;
      }
      out.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
      continue;
    }

    if (AT_WEBJS_OPEN.test(remaining)) {
      const { webJsPart, rest } = splitAtWebJsRule(remaining);
      out.push(webJsPart);
      remaining = rest;
      continue;
    }

    if (AT_JS_OPEN.test(remaining)) {
      const { jsPart, rest } = splitAtJsRule(remaining);
      out.push(jsPart);
      remaining = rest;
      continue;
    }

    const jsStart = remaining.search(/(?:<js>|@js:|@webjs:)/i);
    const chunk = jsStart < 0 ? remaining : remaining.slice(0, jsStart);
    const compound = splitScriptJsonCompound(chunk);
    if (compound) {
      out.push(wrapJsBlock(compound.script));
      out.push(compound.jsonRule);
      remaining = jsStart < 0 ? "" : remaining.slice(jsStart);
      continue;
    }
    const chunkTrimmed = chunk.trim();
    if (chunkTrimmed) out.push(chunkTrimmed);
    remaining = jsStart < 0 ? "" : remaining.slice(jsStart);
  }

  return mergeOrphanAtJsSegments(out.length ? out : [trimmed]);
}
