/**
 * 「文本替换」纯函数：渲染进程阅读展示。
 * 与「转换」（简繁/全半角）同属展示层变换，阅读路径应在转换之前调用。
 *
 * 「替换为」对齐 Legado `RegexExtensions.replace`：
 * - 普通字符串（支持 `$1` / `$&` 等正则回引用法）
 * - `@js:` 前缀：对每次匹配执行脚本，绑定 `result` = 本次匹配文本，返回值作为替换结果
 */
import {
  getValidTimeoutMillisecond,
  isReplaceRuleValid,
  type ReplaceRule,
} from "./replaceRule";

/**
 * 范围字符串是否命中当前书：范围包含完整书名，或包含书源 URL。
 * 空 name/origin 不参与 `includes`（避免 JS `s.includes("")` 恒为 true）。
 * 同一范围可拼多本书名以同时匹配（如 `《三体：第一部》《三体：第二部》`）。
 */
function scopeContainsBook(
  scopeText: string,
  name: string,
  origin: string,
): boolean {
  const n = String(name ?? "");
  const o = String(origin ?? "");
  return (
    (n.length > 0 && scopeText.includes(n)) ||
    (o.length > 0 && scopeText.includes(o))
  );
}

/** 空范围=全部；否则范围字符串需包含当前书名或书源 URL（对齐 Legado） */
export function scopeMatches(
  scope: string | null | undefined,
  name: string,
  origin: string,
): boolean {
  if (scope == null || !String(scope).trim()) return true;
  return scopeContainsBook(String(scope), name, origin);
}

/** 空排除=不排除；否则范围包含当前书名或书源 URL 则排除（对齐 Legado） */
export function excludeMatches(
  excludeScope: string | null | undefined,
  name: string,
  origin: string,
): boolean {
  if (excludeScope == null || !String(excludeScope).trim()) return false;
  return scopeContainsBook(String(excludeScope), name, origin);
}

/** 对齐 Legado `findEnabledByContentScope` / `findEnabledByTitleScope` */
export function filterEnabledReplaceRules(
  rules: ReplaceRule[],
  bookName: string,
  bookOrigin: string,
  kind: "content" | "title",
): ReplaceRule[] {
  return rules.filter((rule) => {
    if (!rule.isEnabled) return false;
    if (kind === "content" && !rule.scopeContent) return false;
    if (kind === "title" && !rule.scopeTitle) return false;
    if (!scopeMatches(rule.scope, bookName, bookOrigin)) return false;
    if (excludeMatches(rule.excludeScope, bookName, bookOrigin)) return false;
    return true;
  });
}

/** 剥离 `@js:` 前缀（对齐 Legado `replacement.startsWith("@js:")` + substring(4)） */
export function stripReplaceJsPrefix(replacement: string): string | null {
  if (!/^@js:/i.test(replacement)) return null;
  return replacement.replace(/^@js:\s*/i, "");
}

/**
 * 让 Node/浏览器 `Function` 与 Rhino eval 一样返回脚本最终表达式值。
 * 覆盖常见多语句写法（如 `zk={…}; zk[result]`）。
 */
function ensureReplaceJsReturn(script: string): string {
  const trimmed = script.trim();
  if (!trimmed) return "return '';";

  const asExpr = `return (${trimmed.replace(/;\s*$/, "")});`;
  try {
    // eslint-disable-next-line no-new-func -- 仅语法探测
    new Function("result", asExpr);
    return asExpr;
  } catch {
    // 多语句：给末行表达式补 return
  }

  const lines = trimmed.split("\n");
  let i = lines.length - 1;
  while (i >= 0 && !lines[i]!.trim()) i--;
  if (i < 0) return "return '';";

  const indent = lines[i]!.match(/^\s*/)?.[0] ?? "";
  const last = lines[i]!.trim().replace(/;\s*$/, "");
  if (!last || last.startsWith("return ")) return trimmed;

  // 单行多语句：`a=1; b` → `a=1; return (b);`
  const semi = last.lastIndexOf(";");
  if (semi >= 0) {
    const before = last.slice(0, semi + 1);
    const stmt = last.slice(semi + 1).trim();
    if (stmt && !stmt.startsWith("return ")) {
      lines[i] = `${indent}${before} return (${stmt});`;
      return lines.join("\n");
    }
  }

  lines[i] = `${indent}return (${last});`;
  return lines.join("\n");
}

function evalReplaceJs(script: string, result: string): string {
  const body = ensureReplaceJsReturn(script);
  // eslint-disable-next-line no-new-func -- 对齐 Legado Rhino：替换规则用户脚本
  const fn = new Function("result", body);
  const out = fn(result);
  if (out == null) return "";
  return String(out);
}

function compileReplaceRegex(pattern: string): RegExp {
  // 对齐 Java Pattern 的 Unicode 码点语义；无 `u` 时增补平面字会拆成代理对，
  // 易导致字符类异常 / 灾难性回溯（本规则含 𫔯𩠌 等即会卡住）。
  try {
    return new RegExp(pattern, "gu");
  } catch {
    return new RegExp(pattern, "g");
  }
}

function applyOneRule(text: string, rule: ReplaceRule, logs?: string[]): string {
  if (!rule.pattern) return text;
  if (!isReplaceRuleValid(rule)) {
    logs?.push(`文本替换：规则「${rule.name || rule.id}」无效，已跳过`);
    return text;
  }
  try {
    const replacement = rule.replacement ?? "";
    if (rule.isRegex) {
      // 浏览器 / Node 均无法可靠打断同步灾难回溯；timeout 字段保留兼容
      void getValidTimeoutMillisecond(rule);
      const re = compileReplaceRegex(rule.pattern);
      const jsBody = stripReplaceJsPrefix(replacement);
      if (jsBody != null) {
        // 函数回调的返回值按字面量写入（对齐 Legado Matcher.quoteReplacement）
        return text.replace(re, (match) => evalReplaceJs(jsBody, match));
      }
      return text.replace(re, replacement);
    }
    // 非正则：Legado 走字面量 String.replace，不执行 @js:
    return text.split(rule.pattern).join(replacement);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs?.push(`文本替换：规则「${rule.name || rule.id}」出错: ${msg}`);
    console.warn(`[replaceRule] 「${rule.name || rule.id}」`, e);
    return text;
  }
}

export function applyReplaceRulesToText(
  text: string,
  rules: ReplaceRule[],
  logs?: string[],
): string {
  let out = text;
  for (const rule of rules) {
    out = applyOneRule(out, rule, logs);
  }
  return out;
}

/** 正文净化：先按行 trim，再套用规则 */
export function applyContentReplaceWithRules(
  content: string,
  rules: ReplaceRule[],
  logs?: string[],
): string {
  if (!rules.length) return content;
  if (content === "null" || content == null) return content;
  const trimmed = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n");
  return applyReplaceRulesToText(trimmed, rules, logs);
}

/** 章节标题净化 */
export function applyTitleReplaceWithRules(
  title: string,
  rules: ReplaceRule[],
  logs?: string[],
): string {
  if (!rules.length) return title;
  return applyReplaceRulesToText(title.replace(/\r?\n/g, ""), rules, logs);
}

/**
 * 阅读展示全文：正文规则套全文；标题行恢复为套正文前原文再只套标题规则
 *（对齐 Legado 分作用域，避免「仅作用于正文」改写章节标题行）。
 * `titleDisplayLines` 为 1-based 展示行号。
 * 若正文规则改变行数，则无法按行号恢复，退化为在正文替换后的标题行上再套标题规则。
 */
export function applyReplaceRulesToDisplayText(
  text: string,
  contentRules: ReplaceRule[],
  titleRules: ReplaceRule[],
  titleDisplayLines: ReadonlySet<number>,
  logs?: string[],
): string {
  if (!contentRules.length && !titleRules.length) return text;

  const linesBefore = text.length > 0 ? text.split("\n") : [];
  if (!contentRules.length) {
    if (!titleRules.length || titleDisplayLines.size === 0) return text;
    const lines = [...linesBefore];
    for (const lineNo of titleDisplayLines) {
      const idx = lineNo - 1;
      if (idx < 0 || idx >= lines.length) continue;
      lines[idx] = applyTitleReplaceWithRules(lines[idx]!, titleRules, logs);
    }
    return lines.join("\n");
  }

  const afterContent = applyReplaceRulesToText(text, contentRules, logs);
  if (titleDisplayLines.size === 0 && !titleRules.length) return afterContent;

  const linesAfter =
    afterContent.length > 0 ? afterContent.split("\n") : [];
  const sameLineCount = linesAfter.length === linesBefore.length;

  for (const lineNo of titleDisplayLines) {
    const idx = lineNo - 1;
    if (idx < 0 || idx >= linesAfter.length) continue;
    let titleLine = sameLineCount
      ? (linesBefore[idx] ?? linesAfter[idx]!)
      : linesAfter[idx]!;
    if (titleRules.length) {
      titleLine = applyTitleReplaceWithRules(titleLine, titleRules, logs);
    }
    linesAfter[idx] = titleLine;
  }
  return linesAfter.join("\n");
}
