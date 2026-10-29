/**
 * Legado 书源 JS 在 Rhino 中同步调用 java.startBrowserAwait / java.ajax；
 * 在 Node 中须自动插入 await，并用 AsyncFunction 执行。
 *
 * Rhino 另有两类与标准 JS 不兼容的写法，须在 eval 前预处理：
 * 1. `.map([a,b]=>` — 数组解构箭头参数须写成 `.map(([a,b])=>`
 * 2. 脚本末尾表达式（如 `JSON.stringify(list)`）Rhino 会作为返回值，Node 须补 `return`
 * 3. 正则 `\ ({1,4}`（空格后误写 `({n,m}`）→ `( {1,4}`，否则 V8 `Nothing to repeat`
 * 4. `function f(key){ let key = … }` — Rhino 允许形参与 let 同名，V8 会 SyntaxError
 * 5. 零宽/格式字符（如 `getSource\u200b()`）— Rhino 可跑，V8 `missing ) after argument list`
 * 6. `let (x = expr) body` — Mozilla JS 1.7 let 表达式；V8 `Unexpected identifier`
 */

/**
 * 去掉书源 JS 中的零宽/格式字符（部分书源 `source.getSource​()` 等）。
 * 须在 inline / prepare 之前执行。
 */
export function stripLegadoJsFormatChars(script: string): string {
  return script.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
}

/** Legado/Rhino：`.map([title,id]=>` → `.map(([title,id])=>` */
export function fixRhinoBareArrayArrowParams(script: string): string {
  return script.replace(
    /(\.[\w$]+\s*\(\s*)\[([^\]]+)\]\s*=>/g,
    "$1([$2])=>",
  );
}

/**
 * 部分书源剥 HTML 标签的正则写成 `\ ({1,4}`（`\` + 空格 + `({n,m}`）。
 * V8 会解析成「空格」后开分组，分组内开头就是量词 → `Nothing to repeat`。
 * 语义应为 `( {1,4}`（分组内 1～4 个空格）。此处改写以对齐可运行结果。
 */
export function fixRhinoIncompatibleRegexLiterals(script: string): string {
  return script.replace(/\\ \(\{(\d+(?:,\d*)?)\}/g, "( {$1}");
}

/**
 * Rhino/Mozilla JS 1.7 let 表达式：`let (x = expr) body` / `let (a=1, b=2) body`。
 * V8 抛 `SyntaxError: Unexpected identifier '…'`，整段 jsLib 加载失败后，
 * 源内自定义 `function Map` 进不了作用域，发现分类再写 `Map('…')` 会撞原生构造器。
 * 改写为 `((x = expr), (body))`（绑定侧已有 `let x` 声明时即为赋值）。
 */
export function fixRhinoLetExpressions(script: string): string {
  if (!/\blet\s*\(/.test(script)) return script;
  const held: string[] = [];
  const masked = script.replace(
    /`(?:\\[\s\S]|\$\{(?:[^{}]|\{[^}]*\})*\}|[^`\\$]|\$(?!\{))*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,
    (m) => {
      held.push(m);
      return `\0STR${held.length - 1}\0`;
    },
  );
  let out = "";
  let i = 0;
  while (i < masked.length) {
    const rest = masked.slice(i);
    const m = /\blet\s*\(/.exec(rest);
    if (!m || m.index == null) {
      out += masked.slice(i);
      break;
    }
    const start = i + m.index;
    out += masked.slice(i, start);
    const bindOpen = start + m[0].length - 1;
    const bindClose = findMatchingParen(masked, bindOpen);
    if (bindClose < 0) {
      out += masked.slice(start);
      break;
    }
    const bindings = masked.slice(bindOpen + 1, bindClose).trim();
    // 须像 `id = expr`（可多组逗号分隔）；否则原样保留
    if (!/^[\w$]+\s*=/.test(bindings)) {
      out += masked.slice(start, bindClose + 1);
      i = bindClose + 1;
      continue;
    }
    let bodyStart = bindClose + 1;
    while (bodyStart < masked.length && /\s/.test(masked[bodyStart]!)) {
      bodyStart++;
    }
    let depth = 0;
    let bodyEnd = bodyStart;
    for (; bodyEnd < masked.length; bodyEnd++) {
      const ch = masked[bodyEnd]!;
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth--;
        continue;
      }
      if (ch === ";" && depth === 0) break;
    }
    const body = masked.slice(bodyStart, bodyEnd).trim();
    if (!body) {
      out += masked.slice(start, bodyEnd);
      i = bodyEnd;
      continue;
    }
    out += `((${bindings}), (${body}))`;
    i = bodyEnd;
  }
  return out.replace(/\0STR(\d+)\0/g, (_, n) => held[Number(n)]!);
}

/**
 * Rhino 允许 `function f(key){ let key = "…" }`（形参与体内 let/const 同名）；
 * V8 抛 `SyntaxError: Identifier 'key' has already been declared`，整段 jsLib 加载失败
 * （如 check_token 未进入共享作用域）。将冲突形参改名为 `_legado_$n_$name`。
 */
export function fixRhinoParamLetRedeclarations(script: string): string {
  let out = "";
  let i = 0;
  while (i < script.length) {
    const rest = script.slice(i);
    const m = /(?:async\s+)?function\b\s*([\w$]*)\s*\(/.exec(rest);
    if (!m || m.index == null) {
      out += script.slice(i);
      break;
    }
    const fnStart = i + m.index;
    out += script.slice(i, fnStart);
    const header = m[0];
    const paramsOpen = fnStart + header.length - 1; // '('
    const paramsClose = findMatchingParen(script, paramsOpen);
    if (paramsClose < 0) {
      out += script.slice(fnStart);
      break;
    }
    let bodyOpen = paramsClose + 1;
    while (bodyOpen < script.length && /\s/.test(script[bodyOpen]!)) bodyOpen++;
    if (script[bodyOpen] !== "{") {
      // 无函数体（罕见）；原样拷贝签名后继续
      out += script.slice(fnStart, bodyOpen);
      i = bodyOpen;
      continue;
    }
    const bodyClose = findMatchingBrace(script, bodyOpen);
    if (bodyClose < 0) {
      out += script.slice(fnStart);
      break;
    }
    const paramsRaw = script.slice(paramsOpen + 1, paramsClose);
    const body = script.slice(bodyOpen + 1, bodyClose);
    const fixedParams = renameParamsRedeclaredWithLetConst(paramsRaw, body);
    out +=
      header.slice(0, -1) +
      "(" +
      fixedParams +
      ")" +
      script.slice(paramsClose + 1, bodyOpen) +
      "{" +
      body +
      "}";
    i = bodyClose + 1;
  }
  return out;
}

/** 形参列表中与函数体内 `let`/`const`/`var` 同名的项改名 */
function renameParamsRedeclaredWithLetConst(
  paramsRaw: string,
  body: string,
): string {
  const names = splitFunctionParamNames(paramsRaw);
  if (!names.length) return paramsRaw;
  const redeclared = names.filter((name) =>
    new RegExp(`\\b(?:let|const|var)\\s+${escapeRegExp(name)}\\b`).test(body),
  );
  if (!redeclared.length) return paramsRaw;
  let out = paramsRaw;
  let n = 0;
  for (const name of redeclared) {
    const repl = `_legado_p${n++}_${name}`;
    out = out.replace(
      new RegExp(`(^|[,\\s])(${escapeRegExp(name)})(?=\\s*([,)=]|$))`, "g"),
      `$1${repl}`,
    );
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitFunctionParamNames(paramsRaw: string): string[] {
  const names: string[] = [];
  for (const part of paramsRaw.split(",")) {
    const t = part.trim();
    if (!t) continue;
    // 跳过解构 / rest：`{a}`, `[a]`, `...a`
    if (/^[{[]/.test(t) || t.startsWith("...")) continue;
    const id = t.replace(/\s*=\s*[\s\S]*$/, "").trim();
    if (/^[\w$]+$/.test(id)) names.push(id);
  }
  return names;
}

function hasLegadoTopLevelStatements(script: string): boolean {
  if (
    /(?:^|\n)\s*(?:const|let|var|function|for|while|if|try|class|import|export|eval)\b/.test(
      script,
    )
  ) {
    return true;
  }
  if (/(?:^|\n)\s*[\w$]+\s*=\s*/.test(script)) return true;
  // 多语句：`eval(...); run(...)` 等，勿整体包成 return (a; b)
  const withoutTrailingSemi = script.replace(/;\s*$/, "");
  return /;\s*\S/.test(withoutTrailingSemi);
}

/** 多行 JSON.stringify({ ... }) 等：从末尾回溯到表达式起始行（仅匹配 ()[]，避免 if { } 块误判） */
function findTrailingExpressionStartLine(lines: string[], endLineIdx: number): number {
  let depth = 0;
  for (let li = endLineIdx; li >= 0; li--) {
    const line = lines[li];
    for (let ci = line.length - 1; ci >= 0; ci--) {
      const c = line[ci];
      if (c === ")" || c === "]") depth++;
      else if (c === "(" || c === "[") {
        depth--;
        if (depth === 0 && (li < endLineIdx || ci > 0)) return li;
      }
    }
  }
  return endLineIdx;
}

/**
 * 多行三元续行：`cond ?\n  a : b` 或 `cond\n  ? a\n  : b`。
 * 返回表达式起始行；非三元续行返回 -1。
 */
function findTrailingTernaryStartLine(lines: string[], endLineIdx: number): number {
  let k = endLineIdx - 1;
  while (k >= 0 && !lines[k]!.trim()) k--;
  if (k < 0) return -1;
  const prev = lines[k]!.trim();
  const last = lines[endLineIdx]!.trim();
  const prevEndsOp = /[?:]\s*$/.test(prev);
  const lastStartsOp = /^[?:]/.test(last);
  if (!prevEndsOp && !lastStartsOp) return -1;

  let start = endLineIdx;
  for (let j = endLineIdx; j >= 0; j--) {
    const t = lines[j]!.trim();
    if (!t) continue;
    start = j;
    let p = j - 1;
    while (p >= 0 && !lines[p]!.trim()) p--;
    if (p < 0) break;
    const pt = lines[p]!.trim();
    // 上一行以三元/运算符收尾，或本行以 `?`/`:` 开头 → 继续并入
    if (/[?:+\-*/%&|,=]\s*$/.test(pt) || /^[?:]/.test(t)) continue;
    break;
  }
  const slice = lines.slice(start, endLineIdx + 1).join("\n");
  if (!/\?/.test(slice)) return -1;
  return start;
}

/** 跳过正则字面量；start 指向开头 `/`，返回结束下标（flags 之后） */
function skipRegexLiteral(src: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      i++;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      i++;
      continue;
    }
    if (ch === "/") {
      i++;
      while (i < src.length && /[gimsuy]/.test(src[i]!)) i++;
      return i;
    }
    if (ch === "\n" || ch === "\r") return i;
    i++;
  }
  return i;
}

/**
 * 上一非空白 token 是否允许出现正则字面量（避免把除法 `/` 当成正则）。
 * 注释与字符串内不会走到这里。
 */
function canStartRegexLiteral(src: string, slashIdx: number): boolean {
  let i = slashIdx - 1;
  while (i >= 0 && /[ \t\n\r]/.test(src[i]!)) i--;
  if (i < 0) return true;
  const ch = src[i]!;
  if ("([{,;=:!&|?~%^<>+-*%".includes(ch)) return true;
  // return /x/、case /x/: 等
  if (/[A-Za-z_$]/.test(ch)) {
    let j = i;
    while (j >= 0 && /[A-Za-z0-9_$]/.test(src[j]!)) j--;
    const word = src.slice(j + 1, i + 1);
    return /^(?:return|case|throw|typeof|delete|void|new|in|of|instanceof|else|do|yield|await)$/.test(
      word,
    );
  }
  return false;
}

type MatchDelim = "{" | "(";

/**
 * 从开括号匹配到对应闭括号；跳过字符串、模板、行/块注释、正则字面量。
 * （注释里的引号、正则字符类里的 `'` 否则会破坏括号深度，导致 jsLib 提升 async 死循环）
 */
function findMatchingDelim(src: string, openIdx: number, open: MatchDelim): number {
  const close = open === "{" ? "}" : ")";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;

  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (inSingle) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && i + 1 < src.length) {
      const next = src[i + 1]!;
      if (next === "/") {
        i = src.indexOf("\n", i + 2);
        if (i < 0) return -1;
        continue;
      }
      if (next === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) return -1;
        i = end + 1;
        continue;
      }
      if (canStartRegexLiteral(src, i)) {
        i = skipRegexLiteral(src, i) - 1;
        continue;
      }
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingBrace(src: string, openIdx: number): number {
  return findMatchingDelim(src, openIdx, "{");
}

function findMatchingParen(src: string, openIdx: number): number {
  return findMatchingDelim(src, openIdx, "(");
}

/** Rhino：`with(obj){ ... finalExpr }` 的值即脚本返回值（正文 AES 解密等） */
export function ensureLegadoWithBlockReturn(script: string): string {
  if (!/\bwith\s*\(/.test(script)) return script;

  let result = script;
  const withRe = /\bwith\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = withRe.exec(result))) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = findMatchingParen(result, parenOpen);
    if (parenClose < 0) continue;

    let braceOpen = parenClose + 1;
    while (braceOpen < result.length && /\s/.test(result[braceOpen]!)) braceOpen++;
    if (result[braceOpen] !== "{") continue;

    const braceClose = findMatchingBrace(result, braceOpen);
    if (braceClose < 0) continue;

    const inner = result.slice(braceOpen + 1, braceClose);
    const innerLines = inner.split("\n");
    let li = innerLines.length - 1;
    while (li >= 0) {
      const t = innerLines[li]?.trim() ?? "";
      if (!t || t === "}" || t === "{") {
        li--;
        continue;
      }
      if (/^(function|async function)\b/.test(t)) break;
      if (t.startsWith("return ")) break;

      const indent = innerLines[li]?.match(/^\s*/)?.[0] ?? "";
      const expr = t.replace(/;\s*$/, "");
      innerLines[li] = `${indent}return ${expr};`;
      break;
    }

    const newInner = innerLines.join("\n");
    result = result.slice(0, braceOpen + 1) + newInner + result.slice(braceClose);
    withRe.lastIndex = braceOpen + 1 + newInner.length;
  }

  return result;
}

function legadoDeclAssignReturnName(line: string): string | null {
  const m = line.trim().match(/^(?:var|let|const)\s+([\w$]+)\s*=/);
  return m?.[1] ?? null;
}

/**
 * `if (cond) a = expr`（无花括号）：Rhino 完成值是赋值结果。
 * 用于末行补 `return a`，避免写成非法的 `return if (...)`。
 */
function legadoSingleLineIfAssignName(line: string): string | null {
  const t = line.trim().replace(/;\s*$/, "");
  if (!/^if\s*\(/.test(t)) return null;
  let depth = 0;
  let i = t.indexOf("(");
  if (i < 0) return null;
  for (; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  if (depth !== 0) return null;
  const rest = t.slice(i).trim();
  if (rest.startsWith("{")) return null;
  const m = rest.match(/^([\w$]+)\s*=/);
  return m?.[1] ?? null;
}

/** 是否整行（或仅）为 JS 行注释 / 块注释 */
function isLegadoCommentOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith("//")) return true;
  return /^\/\*[\s\S]*\*\/$/.test(t);
}

/**
 * 单行内多个顶层语句（如 `java.put(...);java.put(...);result`）时，
 * 返回最后一句起始下标；无顶层 `;` 则返回 0。
 */
function findLastTopLevelStatementStart(line: string): number {
  let lastSemi = -1;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inSingle) {
      if (ch === "\\") escape = true;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") escape = true;
      else if (ch === "`") inTemplate = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }
    if (ch === "/" && i + 1 < line.length) {
      const next = line[i + 1]!;
      if (next === "/") break;
      if (next === "*") {
        const end = line.indexOf("*/", i + 2);
        if (end < 0) break;
        i = end + 1;
        continue;
      }
      if (canStartRegexLiteral(line, i)) {
        i = skipRegexLiteral(line, i) - 1;
        continue;
      }
    }
    if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
    else if (
      ch === ";" &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthBrace === 0
    ) {
      lastSemi = i;
    }
  }
  if (lastSemi < 0) return 0;
  let start = lastSemi + 1;
  while (start < line.length && /\s/.test(line[start]!)) start++;
  return start;
}

/** 让 Node 与 Rhino eval 一样返回脚本最终结果 */
export function ensureLegadoScriptReturn(script: string): string {
  const trimmed = script.trim();
  if (!trimmed) return trimmed;

  if (!hasLegadoTopLevelStatements(trimmed)) {
    const expr = trimmed.replace(/;\s*$/, "");
    if (/^return\s+\([\s\S]*\)\s*;?\s*$/.test(trimmed)) return trimmed;
    const wrapped = `return (${expr});`;
    /**
     * 多语句靠换行 ASI 分隔时（如 `java.put('k',key)\n'https://…'`），
     * 整体包进 `return (…)` 后括号内不再 ASI，会变成 Unexpected string。
     * 能通过语法检查则整包返回；否则走下方「末行表达式 return」。
     */
    try {
      // eslint-disable-next-line no-new-func -- 仅作语法探测
      new Function(wrapped);
      return wrapped;
    } catch {
      // fall through
    }
  }

  const lines = trimmed.split("\n");
  let i = lines.length - 1;
  // 跳过末尾空行与纯注释（如 `//java.log(a)`），否则会收成 `return //…; })()`，
  // 行注释吃掉 IIFE 收尾 → Unexpected end of input（部分论坛书源 bookList）
  while (i >= 0 && isLegadoCommentOnlyLine(lines[i]!)) i--;
  if (i < 0) return trimmed;

  const last = lines[i]!.trim();
  // 仅看最后一行：函数体内的 return 不影响顶层表达式作返回值（Legado/Rhino 行为）
  if (!last || last.startsWith("return ")) return trimmed;

  /**
   * 单行多语句须先于「整行 var x=… → return x」处理。
   * 否则 `var l=…;if(…){a+l}else{b}` 会被收成 `return l`，丢掉 if 里的真正返回值。
   *
   * 先去掉行尾分号再找「最后一句」：否则
   * `sign=md5(); r=…; "http://…"+r;` 会把空语句当最后一句，落到下方把整行写成
   * `return sign=md5(); …`，return 在首个 `;` 处结束，只返回 MD5（发现分类 URL 变成
   * `http://host/<md5>`）。
   */
  const lastBody = last.replace(/;\s*$/, "");
  const lastStmtStartInLine = findLastTopLevelStatementStart(lastBody);
  if (lastStmtStartInLine > 0) {
    const indent = lines[i].match(/^\s*/)?.[0] ?? "";
    const before = lastBody.slice(0, lastStmtStartInLine);
    const stmt = lastBody.slice(lastStmtStartInLine).trim();
    if (stmt.startsWith("return ")) return trimmed;
    // 末行仅为 `});` / `);`（闭括号 + 分号）时 stmt 为空，不是多语句；
    // 若此处直接 return，会漏掉 `List.map(…);` / `JSON.stringify($$);` 的顶层 return
    if (stmt) {
      // if/else / for / while：交给 ensureLegadoIfElseBranchReturn，勿写成 `return if`
      if (/^(if|for|while|switch|try|with)\b/.test(stmt)) {
        lines[i] = `${indent}${before}${stmt}`;
        return lines.join("\n");
      }
      const declName = legadoDeclAssignReturnName(stmt);
      if (declName) {
        lines[i] = `${indent}${before}${stmt}; return ${declName};`;
      } else {
        lines[i] = `${indent}${before}return ${stmt};`;
      }
      return lines.join("\n");
    }
  }

  const declNameFromLast = legadoDeclAssignReturnName(lastBody);
  if (declNameFromLast) {
    const indent = lines[i].match(/^\s*/)?.[0] ?? "";
    return `${trimmed}\n${indent}return ${declNameFromLast};`;
  }
  // `if (cond) a = …`：补 return a（勿 `return if`）
  const ifAssignName = legadoSingleLineIfAssignName(lastBody);
  if (ifAssignName) {
    return `${trimmed}\nreturn ${ifAssignName};`;
  }
  /**
   * switch/if 等块末尾给 result 赋值：Rhino 从作用域读 result，Node 须补 return。
   * 末行常为 `}` 或 `};`（部分书源 if/else 后多余分号）；若只认 `endsWith("}")`，
   * `};` 会落到下方被改成 `return }` → SyntaxError，搜索 bookUrl 整批失败。
   */
  const lastNoTrailSemi = lastBody;
  if (lastNoTrailSemi.endsWith("}")) {
    if (/\bresult\s*=/.test(trimmed) && !/\breturn\s+result\b/.test(trimmed)) {
      return `${trimmed}\nreturn result;`;
    }
    /**
     * Rhino：`list\nif(list==""){"提示"}` — if 未命中时 completion 仍为上一表达式。
     * Node 须在块后补 `return list`（部分论坛书源正文）；仅认裸标识符，避免
     * `doSomething()\nif…` 被写成 `return doSomething()` 而二次调用。
     */
    let prevIdx = i - 1;
    while (prevIdx >= 0 && isLegadoCommentOnlyLine(lines[prevIdx]!)) prevIdx--;
    if (prevIdx >= 0) {
      const prev = lines[prevIdx]!.trim().replace(/;\s*$/, "");
      if (
        /^[\w$]+$/.test(prev) &&
        !/^(if|else|for|while|function|try|catch|switch|return|true|false|null|undefined)$/.test(
          prev,
        )
      ) {
        const afterPrev = lines.slice(prevIdx + 1).join("\n");
        if (!new RegExp(String.raw`\breturn\s+${prev}\b`).test(afterPrev)) {
          return `${trimmed}\nreturn ${prev};`;
        }
      }
    }
    // 勿在块外一律 `return url`：url 常仅在 if 内赋值，未进入分支会 ReferenceError
    // （部分书源 tocUrl 等）。`url=…` 由 injectTrailingReturnInBraceBlock 在分支内补 return。
    return trimmed;
  }

  /**
   * 多行三元：`cond ?\n  a : b` — 勿把末行写成 `return a : b`（Unexpected token return）。
   * return 加在含条件/`?` 的起始行。
   */
  {
    const ternStart = findTrailingTernaryStartLine(lines, i);
    if (ternStart >= 0 && ternStart < i) {
      const start = lines[ternStart].trim();
      if (!start.startsWith("return ")) {
        const indent = lines[ternStart].match(/^\s*/)?.[0] ?? "";
        lines[ternStart] = `${indent}return ${start.replace(/;\s*$/, "")}`;
      }
      if (!lines[i].trimEnd().endsWith(";")) {
        lines[i] = `${lines[i].trimEnd()};`;
      }
      return lines.join("\n");
    }
  }

  /**
   * 尾部 IIFE：`(()=>{...})();` 末行是 `})();`。
   * 若写成 `return })();`，ASI 会变成 `return;`，IIFE 结果被丢掉。
   */
  if (/^[)}\]]*\s*\)\s*\(\s*\)\s*;?\s*$/.test(last)) {
    const expr = trimmed.replace(/;\s*$/, "");
    if (/^\(/.test(expr) && !/^\s*return\b/.test(expr)) {
      return `return ${expr};`;
    }
    /**
     * 顶层声明 + 尾部 IIFE（部分书源 bookList：一串 function 后
     * `(() => { return handlerFactory()() })()`）：向上找 IIFE 起始行补 return，
     * 否则 IIFE 结果被丢掉且 promise 脱管（外层拿到 undefined，内部错误变 unhandled）。
     */
    for (let j = i; j >= 1; j--) {
      if (!lines[j].trim().startsWith("(")) continue;
      // 上一非空行须为语句边界（`}`/`;`），避免把前一表达式的续行当成 IIFE 起点
      let k = j - 1;
      while (k >= 0 && !lines[k].trim()) k--;
      const prev = k >= 0 ? lines[k].trim() : "";
      if (prev && !/[;}]$/.test(prev)) continue;
      const tailExpr = lines
        .slice(j, i + 1)
        .join("\n")
        .trim()
        .replace(/;\s*$/, "");
      if (/^\s*return\b/.test(tailExpr)) return trimmed;
      try {
        // eslint-disable-next-line no-new-func -- 仅作语法探测：确认 j..i 是完整表达式
        new Function(`return (${tailExpr});`);
      } catch {
        continue;
      }
      const head = lines.slice(0, j).join("\n");
      const indent = lines[j].match(/^\s*/)?.[0] ?? "";
      return `${head}\n${indent}return ${tailExpr};`;
    }
    return trimmed;
  }

  // 单行模板字符串：`${...}` 含 `}`，不可当多行表达式回溯（否则会误 return 上一句变量）
  const lastExpr = lastBody;
  if (lastExpr.startsWith("`") && lastExpr.endsWith("`")) {
    const indent = lines[i].match(/^\s*/)?.[0] ?? "";
    lines[i] = `${indent}return ${lastExpr};`;
    return lines.join("\n");
  }

  // 顶层 if/for 等语句后的单行返回值（如 loginCheckJs 末尾 result）勿回溯到 if 行
  // 不用 `}` 触发回溯：否则 `/files/...${sid}/...` 一类模板会被当成多行并跳到上一句
  const looksMultilineExpr =
    /[)\]]/.test(lastBody) &&
    !/^(if|else|for|while|function|try|catch|class)\b/.test(lastBody);
  const startLine = looksMultilineExpr
    ? findTrailingExpressionStartLine(lines, i)
    : i;
  const start = lines[startLine].trim();
  if (start.startsWith("return ")) return trimmed;

  const declNameFromStart = legadoDeclAssignReturnName(start);
  if (declNameFromStart) {
    const indent = lines[startLine].match(/^\s*/)?.[0] ?? "";
    return `${trimmed}\n${indent}return ${declNameFromStart};`;
  }

  const withoutSemi = start.replace(/;\s*$/, "");
  const indent = lines[startLine].match(/^\s*/)?.[0] ?? "";
  lines[startLine] = `${indent}return ${withoutSemi}`;
  if (startLine === i && !lines[i].trimEnd().endsWith(";")) {
    lines[i] = `${lines[i].trimEnd()};`;
  }
  return lines.join("\n");
}

/** `if (...) { foo() } else { bar() }` 以及分支末尾裸表达式补 return（对齐 Legado/Rhino） */
export function ensureLegadoIfElseBranchReturn(script: string): string {
  // 仅当整段脚本就是「if { a() } else { b() }」时用简写（发现页 category/tag 分支）
  let s = script.replace(
    /^(\s*if\s*\([\s\S]*?\)\s*\{\s*)([\w$]+\(\))(\s*\}\s*else\s*\{\s*)([\w$]+\(\))(\s*\})\s*$/,
    "$1return $2$3return $4$5",
  );
  // `if (cond) expr; else { …; expr }` / 有无花括号均可（SF 轻小说 kind 等）：
  // 仅处理脚本末尾的 if/else，给分支末表达式补 return
  return injectReturnIntoIfElseBranchEnds(s);
}

/** 跳过空白与行/块注释（if 链后的 `//}catch…` 不算后续语句） */
function skipLegadoTrailingNoise(script: string, from: number): number {
  let i = from;
  while (i < script.length) {
    while (i < script.length && /\s/.test(script[i]!)) i++;
    if (i >= script.length) break;
    if (script.startsWith("//", i)) {
      while (i < script.length && script[i] !== "\n") i++;
      continue;
    }
    if (script.startsWith("/*", i)) {
      const end = script.indexOf("*/", i + 2);
      if (end < 0) return script.length;
      i = end + 2;
      continue;
    }
    break;
  }
  return i;
}

/** if/else 链结束后是否还有顶层语句（loginCheckJs 在 if 后还有 `result`） */
function ifElseChainIsTerminal(
  script: string,
  ifStart: number,
  chainEnd: number,
): boolean {
  if (braceDepthBefore(script, ifStart) !== 0) return false;
  return skipLegadoTrailingNoise(script, chainEnd + 1) >= script.length;
}

/**
 * 顶层 `try { …; expr } catch (e) { …; expr }`：分支末尾表达式补 return。
 * 目录 tocUrl 常见写法；若只认 if/else，整段以 `}` 结尾时 ensureLegadoScriptReturn
 * 不会补 return → 返回 undefined → tocUrl 回退详情页。
 */
export function ensureLegadoTryCatchBranchReturn(script: string): string {
  let result = script;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const tryRe = /\btry\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = tryRe.exec(result))) {
      const tryStart = m.index;
      if (braceDepthBefore(result, tryStart) !== 0) {
        tryRe.lastIndex = tryStart + 1;
        continue;
      }
      const tryBraceOpen = m.index + m[0].length - 1;
      const tryBraceClose = findMatchingBrace(result, tryBraceOpen);
      if (tryBraceClose < 0) {
        tryRe.lastIndex = tryStart + 1;
        continue;
      }

      let after = tryBraceClose + 1;
      while (after < result.length && /\s/.test(result[after]!)) after++;
      let chainEnd = tryBraceClose;
      const catchBlocks: Array<{ open: number; close: number }> = [];

      while (/^catch\b/.test(result.slice(after))) {
        after += 5;
        while (after < result.length && /\s/.test(result[after]!)) after++;
        if (result[after] === "(") {
          const parenClose = findMatchingParen(result, after);
          if (parenClose < 0) break;
          after = parenClose + 1;
          while (after < result.length && /\s/.test(result[after]!)) after++;
        }
        if (result[after] !== "{") break;
        const catchClose = findMatchingBrace(result, after);
        if (catchClose < 0) break;
        catchBlocks.push({ open: after, close: catchClose });
        chainEnd = catchClose;
        after = catchClose + 1;
        while (after < result.length && /\s/.test(result[after]!)) after++;
      }

      if (/^finally\b/.test(result.slice(after))) {
        after += 7;
        while (after < result.length && /\s/.test(result[after]!)) after++;
        if (result[after] === "{") {
          const finClose = findMatchingBrace(result, after);
          if (finClose >= 0) chainEnd = finClose;
        }
      }

      if (!ifElseChainIsTerminal(result, tryStart, chainEnd)) {
        tryRe.lastIndex = tryStart + 1;
        continue;
      }

      const tryInj = injectTrailingReturnInBraceBlock(
        result,
        tryBraceOpen,
        tryBraceClose,
      );
      if (tryInj.changed) {
        result = tryInj.text;
        changed = true;
        tryRe.lastIndex = Math.max(tryInj.nextIndex, tryStart + 1);
        continue;
      }

      let catchChanged = false;
      for (const cb of catchBlocks) {
        const catchInj = injectTrailingReturnInBraceBlock(
          result,
          cb.open,
          cb.close,
        );
        if (catchInj.changed) {
          result = catchInj.text;
          changed = true;
          catchChanged = true;
          tryRe.lastIndex = Math.max(catchInj.nextIndex, tryStart + 1);
          break;
        }
      }
      if (catchChanged) continue;

      tryRe.lastIndex = Math.max(chainEnd + 1, tryStart + 1);
    }
    if (!changed) break;
  }
  return result;
}

/**
 * 无花括号单语句结束下标（含末尾 `;`；若靠 ASI 在 `else` 前结束则不含换行）。
 * `from` 为语句起点（已跳过前导空白亦可）。
 */
function findBracelessStatementEnd(src: string, from: number): number {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (i >= src.length || src[i] === "{") return -1;

  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;

  for (; i < src.length; i++) {
    const ch = src[i]!;

    if (escape) {
      escape = false;
      continue;
    }
    if (inSingle) {
      if (ch === "\\") escape = true;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") escape = true;
      else if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && i + 1 < src.length) {
      const next = src[i + 1]!;
      if (next === "/") {
        const nl = src.indexOf("\n", i + 2);
        i = nl < 0 ? src.length : nl;
        continue;
      }
      if (next === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) return src.length - 1;
        i = end + 1;
        continue;
      }
      if (canStartRegexLiteral(src, i)) {
        i = skipRegexLiteral(src, i) - 1;
        continue;
      }
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "(") {
      depthParen++;
      continue;
    }
    if (ch === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (ch === "[") {
      depthBracket++;
      continue;
    }
    if (ch === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
      continue;
    }
    if (ch === "{") {
      depthBrace++;
      continue;
    }
    if (ch === "}") {
      if (depthBrace === 0) return Math.max(from, i - 1);
      depthBrace--;
      continue;
    }

    if (depthParen !== 0 || depthBracket !== 0 || depthBrace !== 0) continue;

    if (ch === ";") return i;

    // ASI：换行后紧跟 else → 语句在换行前结束
    if (ch === "\n" || ch === "\r") {
      let j = i + 1;
      if (ch === "\r" && src[j] === "\n") j++;
      while (j < src.length && /[ \t\f\v]/.test(src[j]!)) j++;
      if (/^else\b/.test(src.slice(j))) {
        let end = i - 1;
        while (end >= from && /[ \t\f\v]/.test(src[end]!)) end--;
        return end >= from ? end : -1;
      }
    }
  }

  let end = src.length - 1;
  while (end >= from && /\s/.test(src[end]!)) end--;
  return end >= from ? end : -1;
}

/** 跳过前导空白与行/块注释（SF bookList：`if(cond)\n//旧代码\nexpr;`） */
function skipLegadoLeadingCommentsAndWs(src: string, from: number): number {
  let i = Math.max(0, from);
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (i >= src.length) break;
    if (src.startsWith("//", i)) {
      const nl = src.indexOf("\n", i + 2);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return src.length;
      i = end + 2;
      continue;
    }
    break;
  }
  return i;
}

/** 无花括号分支表达式前补 return（对齐 Rhino 以末表达式为返回值） */
function injectReturnIntoBracelessStatement(
  src: string,
  start: number,
  end: number,
): { text: string; changed: boolean; nextIndex: number } {
  if (start < 0 || end < start || end >= src.length) {
    return { text: src, changed: false, nextIndex: end + 1 };
  }
  // 不可把 return 插到前导注释前：`return //旧代码` 会吃掉真表达式并弄断 else
  const exprStart = skipLegadoLeadingCommentsAndWs(src, start);
  if (exprStart > end) {
    return { text: src, changed: false, nextIndex: end + 1 };
  }
  const raw = src.slice(exprStart, end + 1);
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("return ")) {
    return { text: src, changed: false, nextIndex: end + 1 };
  }
  if (/^(if|for|while|switch|try|function|async|with)\b/.test(trimmed)) {
    return { text: src, changed: false, nextIndex: end + 1 };
  }
  const leadWs = raw.match(/^\s*/)?.[0] ?? "";
  const expr = trimmed.replace(/;\s*$/, "");
  if (!expr || /^(continue|break|throw)\b/.test(expr)) {
    return { text: src, changed: false, nextIndex: end + 1 };
  }
  const rewritten = `${leadWs}return ${expr};`;
  const text = src.slice(0, exprStart) + rewritten + src.slice(end + 1);
  return {
    text,
    changed: true,
    nextIndex: exprStart + rewritten.length,
  };
}

/**
 * then 分支结束后（花括号 `}` 或无括号语句末尾），定位整条 if/else 链终点。
 * 支持 `else {…}` / `else stmt;` / `else if (…) …`。
 */
function findIfElseChainEnd(script: string, thenEnd: number): number {
  let end = thenEnd;
  let after = thenEnd + 1;
  while (after < script.length && /\s/.test(script[after]!)) after++;
  while (/^else\b/.test(script.slice(after))) {
    after += 4;
    while (after < script.length && /\s/.test(script[after]!)) after++;
    if (/^if\s*\(/.test(script.slice(after))) {
      const ifMatch = /^if\s*\(/.exec(script.slice(after));
      if (!ifMatch) break;
      const parenOpen = after + ifMatch[0].length - 1;
      const parenClose = findMatchingParen(script, parenOpen);
      if (parenClose < 0) break;
      let bodyStart = parenClose + 1;
      while (bodyStart < script.length && /\s/.test(script[bodyStart]!)) bodyStart++;
      if (script[bodyStart] === "{") {
        const braceClose = findMatchingBrace(script, bodyStart);
        if (braceClose < 0) break;
        end = braceClose;
        after = braceClose + 1;
      } else {
        const stmtEnd = findBracelessStatementEnd(script, bodyStart);
        if (stmtEnd < 0) break;
        end = stmtEnd;
        after = stmtEnd + 1;
      }
      while (after < script.length && /\s/.test(script[after]!)) after++;
      continue;
    }
    if (script[after] === "{") {
      const elseClose = findMatchingBrace(script, after);
      if (elseClose < 0) break;
      return elseClose;
    }
    const elseStmtEnd = findBracelessStatementEnd(script, after);
    if (elseStmtEnd < 0) break;
    return elseStmtEnd;
  }
  return end;
}

/** 处理 else / else if 分支：花括号块或无括号单语句补 return */
function injectReturnIntoElseBranch(
  src: string,
  elseKeywordStart: number,
): { text: string; changed: boolean; nextIndex: number } | null {
  let after = elseKeywordStart + 4;
  while (after < src.length && /\s/.test(src[after]!)) after++;
  if (/^if\s*\(/.test(src.slice(after))) {
    // else if：交给外层下一次扫描 if
    return null;
  }
  if (src[after] === "{") {
    const elseClose = findMatchingBrace(src, after);
    if (elseClose < 0) return null;
    return injectTrailingReturnInBraceBlock(src, after, elseClose);
  }
  const elseEnd = findBracelessStatementEnd(src, after);
  if (elseEnd < 0) return null;
  return injectReturnIntoBracelessStatement(src, after, elseEnd);
}

/** 在顶层 if/else 分支末尾表达式前插入 return（含无花括号分支；不改写已有 return） */
function injectReturnIntoIfElseBranchEnds(script: string): string {
  let result = script;
  // 反复扫描，直到无法再改写
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const ifRe = /\bif\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = ifRe.exec(result))) {
      const startIdx = m.index;
      const parenOpen = m.index + m[0].length - 1;
      const parenClose = findMatchingParen(result, parenOpen);
      if (parenClose < 0) {
        ifRe.lastIndex = startIdx + 1;
        continue;
      }

      let bodyStart = parenClose + 1;
      while (bodyStart < result.length && /\s/.test(result[bodyStart]!)) bodyStart++;

      const bracedThen = result[bodyStart] === "{";
      let thenEnd: number;
      if (bracedThen) {
        thenEnd = findMatchingBrace(result, bodyStart);
        if (thenEnd < 0) {
          ifRe.lastIndex = startIdx + 1;
          continue;
        }
      } else {
        thenEnd = findBracelessStatementEnd(result, bodyStart);
        if (thenEnd < 0) {
          ifRe.lastIndex = startIdx + 1;
          continue;
        }
      }

      const chainEnd = findIfElseChainEnd(result, thenEnd);
      // loginCheckJs：`if (…) { …; java.log(…) } \n result` — if 非末尾语句时勿往分支里塞 return
      if (!ifElseChainIsTerminal(result, startIdx, chainEnd)) {
        ifRe.lastIndex = Math.max(thenEnd + 1, startIdx + 1);
        continue;
      }

      if (bracedThen) {
        const injected = injectTrailingReturnInBraceBlock(result, bodyStart, thenEnd);
        if (injected.changed) {
          result = injected.text;
          changed = true;
          ifRe.lastIndex = Math.max(injected.nextIndex, startIdx + 1);
          continue;
        }
      } else {
        const injected = injectReturnIntoBracelessStatement(
          result,
          bodyStart,
          thenEnd,
        );
        if (injected.changed) {
          result = injected.text;
          changed = true;
          ifRe.lastIndex = Math.max(injected.nextIndex, startIdx + 1);
          continue;
        }
      }

      // else / else if 紧随其后
      let after = thenEnd + 1;
      while (after < result.length && /\s/.test(result[after]!)) after++;
      if (!/^else\b/.test(result.slice(after))) {
        ifRe.lastIndex = Math.max(thenEnd + 1, startIdx + 1);
        continue;
      }
      const elseInj = injectReturnIntoElseBranch(result, after);
      if (elseInj?.changed) {
        result = elseInj.text;
        changed = true;
        ifRe.lastIndex = Math.max(elseInj.nextIndex, startIdx + 1);
        continue;
      }
      ifRe.lastIndex = Math.max(thenEnd + 1, startIdx + 1);
    }
    if (!changed) break;
  }
  return result;
}

/** 计算 `src[0..endExclusive)` 内未闭合的 `{` 深度（跳过字符串/注释/正则） */
function braceDepthBefore(src: string, endExclusive: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;

  for (let i = 0; i < endExclusive && i < src.length; i++) {
    const ch = src[i]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (inSingle) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && i + 1 < src.length) {
      const next = src[i + 1]!;
      if (next === "/") {
        const nl = src.indexOf("\n", i + 2);
        i = nl < 0 ? src.length : nl;
        continue;
      }
      if (next === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) break;
        i = end + 1;
        continue;
      }
      if (canStartRegexLiteral(src, i)) {
        i = skipRegexLiteral(src, i) - 1;
        continue;
      }
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
  }
  return depth;
}

/** 表达式在字符串/正则/模板外是否含 `;`（多语句） */
function legadoExprHasTopLevelSemicolon(expr: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inSingle) {
      if (ch === "\\") escape = true;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") escape = true;
      else if (ch === "`") inTemplate = false;
      continue;
    }
    if (ch === "/" && i + 1 < expr.length) {
      const next = expr[i + 1]!;
      if (next === "/") return false; // 行注释：后续不再有顶层语句
      if (next === "*") {
        const end = expr.indexOf("*/", i + 2);
        if (end < 0) return false;
        i = end + 1;
        continue;
      }
      if (canStartRegexLiteral(expr, i)) {
        i = skipRegexLiteral(expr, i) - 1;
        continue;
      }
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }
    if (ch === ";") return true;
  }
  return false;
}

function injectTrailingReturnInBraceBlock(
  src: string,
  braceOpen: number,
  braceClose: number,
): { text: string; changed: boolean; nextIndex: number } {
  const inner = src.slice(braceOpen + 1, braceClose);
  const innerLines = inner.split("\n");
  let lineStart = 0;
  const lineStarts: number[] = [];
  for (let i = 0; i < innerLines.length; i++) {
    lineStarts.push(lineStart);
    lineStart += (innerLines[i]?.length ?? 0) + 1;
  }
  let li = innerLines.length - 1;
  while (li >= 0) {
    const t = innerLines[li]?.trim() ?? "";
    if (!t || t === "}" || t === "{") {
      li--;
      continue;
    }
    // for/while/if 体内的末行不可当分支返回值（urlEncode 等）
    if (braceDepthBefore(inner, lineStarts[li] ?? 0) !== 0) {
      li--;
      continue;
    }
    if (/^(function|async function|if|else|for|while|try|catch|switch)\b/.test(t)) {
      break;
    }
    if (t.startsWith("return ")) break;
    // continue/break 是控制流语句，不是返回值（误写成 return continue 会 SyntaxError）
    if (/^(continue|break)\b/.test(t)) break;

    const indent = innerLines[li]?.match(/^\s*/)?.[0] ?? "";
    const expr = t.replace(/;\s*$/, "");
    // java.put/log 等副作用：保留执行，再 return 其写入的 result/url（勿 return put 本身）
    if (/^java\.(put|log|toast|startBrowser|startBrowserAwait)\s*\(/.test(expr)) {
      let retVar: string | null = null;
      const putArg = expr.match(
        /^java\.put\s*\(\s*(['"])[^'"]*\1\s*,\s*([\w$]+)\s*\)/,
      );
      if (putArg?.[2]) retVar = putArg[2];
      if (!retVar) {
        for (let j = li - 1; j >= 0; j--) {
          const prev = innerLines[j]?.trim() ?? "";
          if (!prev) continue;
          if (/^result\s*=/.test(prev)) {
            retVar = "result";
            break;
          }
          if (/^url\s*=/.test(prev)) {
            retVar = "url";
            break;
          }
          break;
        }
      }
      if (retVar) {
        innerLines[li] = `${indent}${expr};\n${indent}return ${retVar};`;
        const newInner = innerLines.join("\n");
        const text =
          src.slice(0, braceOpen + 1) + newInner + src.slice(braceClose);
        return {
          text,
          changed: true,
          nextIndex: braceOpen + 1 + newInner.length + 1,
        };
      }
      li--;
      continue;
    }
    // 分支内单表达式（含 `java.get('x')+l`）补 return；排除控制流与多语句。
    // 勿用 `/[;]/` 粗测：书源正则常含 `&quot;`（实体以 `;` 结尾），会误判为多语句，
    // 导致 try 末尾三元无法 return（只能靠 catch 赋值 + 外层 `return result` 刷 TypeError 日志）。
    // 勿把 `class` 列入关键字：`/class="…"/` 同样会被 `\bclass\b` 误伤。
    if (/\b(if|for|while|switch|try|function)\b/.test(expr)) {
      break;
    }
    // 顶层 `;` 多语句：`json=…; url=…` → 对末句补 return（部分书源 tocUrl 等）
    if (legadoExprHasTopLevelSemicolon(expr)) {
      const lastStart = findLastTopLevelStatementStart(expr);
      if (lastStart > 0) {
        const before = expr.slice(0, lastStart);
        const stmt = expr.slice(lastStart).trim();
        if (
          stmt &&
          !stmt.startsWith("return ") &&
          !/^(if|for|while|switch|try|with|continue|break|function)\b/.test(stmt)
        ) {
          const declName = legadoDeclAssignReturnName(stmt);
          const assignName = stmt.match(/^([\w$]+)\s*=/)?.[1];
          let rewritten: string | null = null;
          if (declName) {
            rewritten = `${indent}${before}${stmt}; return ${declName};`;
          } else if (assignName) {
            rewritten = `${indent}${before}${stmt}; return ${assignName};`;
          } else {
            rewritten = `${indent}${before}return ${stmt};`;
          }
          innerLines[li] = rewritten;
          const newInner = innerLines.join("\n");
          const text =
            src.slice(0, braceOpen + 1) + newInner + src.slice(braceClose);
          return {
            text,
            changed: true,
            nextIndex: braceOpen + 1 + newInner.length + 1,
          };
        }
      }
      break;
    }
    // 保留字/字面量可作表达式；排除不可出现在 return 后的标识符式关键字
    if (
      /^(continue|break|case|default|else|catch|finally|do|while|for|function|class|import|export|throw|yield|await)$/.test(
        expr,
      )
    ) {
      break;
    }
    innerLines[li] = `${indent}return ${expr};`;
    const newInner = innerLines.join("\n");
    const text =
      src.slice(0, braceOpen + 1) + newInner + src.slice(braceClose);
    return {
      text,
      changed: true,
      nextIndex: braceOpen + 1 + newInner.length + 1,
    };
  }
  return { text: src, changed: false, nextIndex: braceClose + 1 };
}

/** `if(result){ eval(result) }` → 补 return eval(result)（Legado/Rhino 会返回 eval 结果） */
export function ensureLegadoIfEvalReturn(script: string): string {
  return script.replace(
    /(\bif\s*\(\s*result\s*\)\s*\{\s*)eval\s*\(\s*result\s*\)/g,
    "$1return eval(result)",
  );
}

/**
 * 快照 `result` 并仅给**数组**补 List.toArray（字符串/对象原样保留，避免打断 .replace/.map）。
 * 用 `let result` 阴影全局，避免 await java.ajax 期间嵌套 @js 覆盖共享沙箱。
 * List API 须不可枚举：`for (i in $)` / `for (i in result)` 不可扫到 toArray 等键。
 */
export const LEGADO_RESULT_LIST_PRELUDE = `let result = (() => {
  const r = globalThis.result;
  if (Array.isArray(r) && typeof r.toArray !== "function") {
    const def = (k, v) => Object.defineProperty(r, k, {
      configurable: true, writable: true, enumerable: false, value: v
    });
    def("toArray", function () { return this.slice(); });
    def("isEmpty", function () { return this.length === 0; });
    def("size", function () { return this.length; });
    def("get", function (i) { return this[i]; });
  }
  return r;
})();`;

/**
 * 脚本已自带 `let/const/var result` 时用此版：只给**沙箱**上的 result 补 List API，
 * 不可读写裸标识符 `result`——与后续声明同处一作用域时，`typeof result` 也会踩 TDZ
 * （`Cannot access 'result' before initialization`，如发现分类 `let result=[]`）。
 */
export const LEGADO_RESULT_LIST_PRELUDE_INPLACE = `(() => {
  const r = globalThis.result;
  if (!Array.isArray(r) || typeof r.toArray === "function") return;
  const def = (k, v) => Object.defineProperty(r, k, {
    configurable: true, writable: true, enumerable: false, value: v
  });
  def("toArray", function () { return this.slice(); });
  def("isEmpty", function () { return this.length === 0; });
  def("size", function () { return this.length; });
  def("get", function (i) { return this[i]; });
})();`;

/** 同步/异步 Legado JS 通用预处理 */
export function prepareLegadoJs(script: string): string {
  let s = stripLegadoJsFormatChars(script).trim();
  if (/^<js>/i.test(s)) {
    s = s.replace(/^<js>/i, "").replace(/<\/js>\s*$/i, "").trim();
  } else if (/^@js:/i.test(s)) {
    s = s.replace(/^@js:\s*/i, "").trim();
  } else if (/^js:/i.test(s)) {
    s = s.replace(/^js:\s*/i, "").trim();
  }
  s = fixRhinoBareArrayArrowParams(s);
  s = fixRhinoIncompatibleRegexLiterals(s);
  s = fixRhinoLetExpressions(s);
  s = fixRhinoParamLetRedeclarations(s);
  s = ensureLegadoWithBlockReturn(s);
  s = ensureLegadoIfElseBranchReturn(s);
  s = ensureLegadoTryCatchBranchReturn(s);
  s = ensureLegadoIfEvalReturn(s);
  s = ensureLegadoScriptReturn(s);
  // 必须在 return 补全之后：prelude 本身不是返回值
  // 仅当脚本会用到 result 时注入；字符串 result 必须保持可 .replace
  if (!/\bresult\b/.test(s) && !/\bresult\b/.test(script)) {
    return s;
  }
  if (/\b(?:let|const|var)\s+result\b/.test(s)) {
    s = `${LEGADO_RESULT_LIST_PRELUDE_INPLACE}\n${s}`;
  } else {
    s = `${LEGADO_RESULT_LIST_PRELUDE}\n${s}`;
  }
  return s;
}

/** 仅将函数体内含 await 的 function / 箭头函数提升为 async（避免 urlEncode 等同步 helper 变 Promise） */
export function promoteFunctionsToAsyncForAwait(script: string): string {
  if (!/\bawait\b/.test(script)) return script;
  return promoteBlockArrowsToAsync(
    promoteArrowAssignmentsToAsync(
      promoteClassicFunctionsToAsync(script),
    ),
  );
}

function promoteClassicFunctionsToAsync(script: string): string {
  let out = "";
  let pos = 0;
  const headRe =
    /\b(?:(?:var|let|const)\s+\w+\s*=\s*)?(async\s+)?function(\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g;

  let m: RegExpExecArray | null;
  while ((m = headRe.exec(script))) {
    out += script.slice(pos, m.index);
    const braceIdx = m.index + m[0].length - 1;
    const endBrace = findMatchingBrace(script, braceIdx);
    if (endBrace < 0) {
      // 无法匹配体：跳过本头，避免 pos 回退导致无限拼接
      out += m[0];
      pos = m.index + m[0].length;
      headRe.lastIndex = pos;
      continue;
    }
    const head = script.slice(m.index, braceIdx + 1);
    const body = promoteClassicFunctionsToAsync(
      script.slice(braceIdx + 1, endBrace),
    );
    let fullFn = `${head}${body}}`;
    if (!m[1] && /\bawait\b/.test(fullFn)) {
      fullFn = fullFn.replace(
        /(\b(?:var|let|const)\s+\w+\s*=\s*)?function\b/,
        "$1async function",
      );
    }
    out += fullFn;
    pos = endBrace + 1;
    headRe.lastIndex = pos;
  }
  out += script.slice(pos);
  return out;
}

/** `getData = (uri) => { await ... }` / `run = Path => { await getData() }` */
function promoteArrowAssignmentsToAsync(script: string): string {
  let out = "";
  let pos = 0;
  const headRe =
    /\b(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?((?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{)/g;

  let m: RegExpExecArray | null;
  while ((m = headRe.exec(script))) {
    out += script.slice(pos, m.index);
    const braceIdx = m.index + m[0].length - 1;
    const endBrace = findMatchingBrace(script, braceIdx);
    if (endBrace < 0) {
      out += m[0];
      pos = m.index + m[0].length;
      headRe.lastIndex = pos;
      continue;
    }
    const head = script.slice(m.index, braceIdx + 1);
    const body = promoteArrowAssignmentsToAsync(
      script.slice(braceIdx + 1, endBrace),
    );
    let fullFn = `${head}${body}}`;
    if (!m[2] && /\bawait\b/.test(fullFn)) {
      fullFn = fullFn.replace(
        /^((?:(?:var|let|const)\s+)?[A-Za-z_$][\w$]*\s*=\s*)/,
        "$1async ",
      );
    }
    out += fullFn;
    pos = endBrace + 1;
    headRe.lastIndex = pos;
  }
  out += script.slice(pos);
  return out;
}

/**
 * `arr.forEach(node => { await ... })` / `(x) => { await ... }`：
 * 回调体含 await 时须标成 async（赋值箭头由 promoteArrowAssignmentsToAsync 处理）。
 */
function promoteBlockArrowsToAsync(script: string): string {
  let out = "";
  let pos = 0;
  // 单参数或一层括号参数；嵌套默认值较少见于书源 forEach
  const headRe =
    /(\basync\s+)?(\((?:[^()]|\([^()]*\))*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g;

  let m: RegExpExecArray | null;
  while ((m = headRe.exec(script))) {
    out += script.slice(pos, m.index);
    const braceIdx = m.index + m[0].length - 1;
    const endBrace = findMatchingBrace(script, braceIdx);
    if (endBrace < 0) {
      out += m[0];
      pos = m.index + m[0].length;
      headRe.lastIndex = pos;
      continue;
    }
    const head = script.slice(m.index, braceIdx + 1);
    const body = promoteBlockArrowsToAsync(
      script.slice(braceIdx + 1, endBrace),
    );
    let fullFn = `${head}${body}}`;
    if (!m[1] && /\bawait\b/.test(fullFn)) {
      fullFn = `async ${fullFn}`;
    }
    out += fullFn;
    pos = endBrace + 1;
    headRe.lastIndex = pos;
  }
  out += script.slice(pos);
  return out;
}

/** 收集脚本中已声明的 async function / async 箭头赋值名 */
export function collectAsyncFunctionNames(script: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /\basync\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*async\s+function\b/g,
    /\b(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*async\s+(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    // 属性赋值：`u.login = async function()` / `u.handNovels = async (…) =>`
    // （loginCheckJs 把 util 方法 objStringify 后经 java.put 传给规则脚本再 eval 还原，
    //  调用点 `util.login()` 须能按名注入 await）
    /\b[A-Za-z_$][\w$]*\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*async\s+function\b/g,
    /\b[A-Za-z_$][\w$]*\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*async\s+(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(script))) {
      if (m[1]) names.add(m[1]);
    }
  }
  return [...names];
}

/**
 * 将 `eval(String(source.bookSourceComment))` /
 * `eval(String(source.getSource().bookSourceComment))` 展开为注释正文，
 * 使 prepare 可改写其中的 java.ajaxAll 等异步调用，并保持与 Legado `eval` 相同作用域。
 */
export function inlineBookSourceCommentEvals(
  script: string,
  sourceComment: string | null | undefined,
): string {
  if (sourceComment == null || sourceComment === "") {
    return stripLegadoJsFormatChars(script);
  }
  const cleaned = stripLegadoJsFormatChars(script);
  // source.bookSourceComment 或 source.getSource().bookSourceComment（部分书源等）
  const commentRef =
    String.raw`source(?:\s*\.\s*getSource\s*\(\s*\))?\s*\.\s*bookSourceComment`;
  const hasCommentEval = new RegExp(
    String.raw`\beval\s*\(\s*(?:String\s*\(\s*)?${commentRef}`,
  ).test(cleaned);
  if (!hasCommentEval) return cleaned;
  // 注释自身再 eval 自身时避免死循环
  if (
    new RegExp(
      String.raw`\beval\s*\(\s*(?:String\s*\(\s*)?${commentRef}`,
    ).test(sourceComment)
  ) {
    return cleaned;
  }
  return cleaned
    .replace(
      new RegExp(
        String.raw`\beval\s*\(\s*String\s*\(\s*${commentRef}\s*\)\s*\)\s*;?`,
        "g",
      ),
      // 必须用函数替换：字符串替换会把注释里的 $$ 吃成 $（MDN: $$ → $）
      () => `${sourceComment}\n`,
    )
    .replace(
      new RegExp(String.raw`\beval\s*\(\s*${commentRef}\s*\)\s*;?`, "g"),
      () => `${sourceComment}\n`,
    );
}

/**
 * 对 async 函数的调用补 await。
 * Legado/Rhino 中嵌套函数调用是同步阻塞的；Node 中须逐层 await 才能等 toast 等副作用完成。
 */
export function awaitAsyncFunctionCalls(
  script: string,
  extraNames: readonly string[] = [],
): string {
  const names = [
    ...new Set([...collectAsyncFunctionNames(script), ...extraNames]),
  ];
  if (!names.length) return script;

  let s = script;
  for (const name of names) {
    const escaped = name.replace(/\$/g, "\\$");
    // 裸调用：getWbiEnc(
    s = s.replace(
      new RegExp(
        `(?<![\\w.$])(?<!(?:await|function)\\s)${escaped}\\s*\\(`,
        "g",
      ),
      `await ${name}(`,
    );
    // 成员调用：this.getWbiEnc( / obj.getWbiEnc(
    s = s.replace(
      new RegExp(
        `(?<!\\bawait\\s)(\\b(?:this|[A-Za-z_$][\\w$]*)\\s*\\.\\s*)${escaped}\\s*\\(`,
        "g",
      ),
      `await $1${name}(`,
    );
  }
  return s.replace(/\bawait\s+await\s+/g, "await ");
}

/** 沙箱注入的串行 forEach helper 名（见 sharedJsScope / rhinoRuntime） */
export const LEGADO_FOREACH_SERIAL_NAME = "__legadoForEachSerial";

/**
 * `novels.forEach(async v => { await java.ajax… })`：Rhino 中同步阻塞；
 * Node 原生 forEach 不等回调，函数会在列表处理完成前返回（详情字段缺失）。
 * 改写为 `await __legadoForEachSerial(novels, async v => …)` 串行结算。
 */
function rewriteAsyncForEachSerial(script: string): string {
  return script.replace(
    /\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*forEach\s*\(\s*async\b/g,
    (_m, expr: string) => `await ${LEGADO_FOREACH_SERIAL_NAME}(${expr}, async`,
  );
}

/** 顶层逗号切分实参（跳过字符串/括号嵌套） */
function splitTopLevelArgs(argsInner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: "'" | '"' | "`" | null = null;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < argsInner.length; i++) {
    const c = argsInner[i]!;
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(argsInner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(argsInner.slice(start));
  return out;
}

/** 调用点第 i 个实参是否为含 await 的（或 async）函数字面量 */
function findAsyncCallbackArgPositions(
  script: string,
  name: string,
  paramCount: number,
): Set<number> {
  const out = new Set<number>();
  const escaped = name.replace(/\$/g, "\\$");
  const callRe = new RegExp(`(?<!function\\s)\\b${escaped}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(script))) {
    const open = m.index + m[0].length - 1;
    const close = findMatchingParen(script, open);
    if (close < 0) continue;
    const args = splitTopLevelArgs(script.slice(open + 1, close));
    for (let i = 0; i < Math.min(args.length, paramCount); i++) {
      const a = args[i]!.trim();
      const isFnLiteral =
        /^(?:async\b|function\b|\((?:[^()]|\([^()]*\))*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(
          a,
        );
      if (!isFnLiteral) continue;
      if (/^async\b/.test(a) || /\bawait\b/.test(a)) out.add(i);
    }
  }
  return out;
}

/**
 * 回调形参被调用时补 await（单次改写一个函数体）。
 * jsLib 常见 `cacheGetAndSet(key, supplyFunc)`：调用点传入含 `await java.ajax`
 * 的回调后 supplyFunc() 返回 Promise —— 不 await 会把 Promise 当结果写缓存
 * （JSON.stringify(Promise) === "{}"，二次读取拿到坏缓存）。
 */
function awaitAsyncCallbackParamInvocationsOnce(script: string): string | null {
  const defRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(script))) {
    const params = m[2]!
      .split(",")
      .map((p) => p.trim())
      .filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
    if (!params.length) continue;
    const bodyOpen = m.index + m[0].length - 1;
    const bodyClose = findMatchingBrace(script, bodyOpen);
    if (bodyClose < 0) continue;
    const asyncIdx = findAsyncCallbackArgPositions(script, m[1]!, params.length);
    if (!asyncIdx.size) continue;

    const body = script.slice(bodyOpen + 1, bodyClose);
    let newBody = body;
    for (const idx of asyncIdx) {
      const p = params[idx];
      if (!p) continue;
      newBody = newBody.replace(
        new RegExp(
          `(?<![\\w$.])(?<!await\\s)(?<!function\\s)(?<!new\\s)${p.replace(/\$/g, "\\$")}\\s*\\(`,
          "g",
        ),
        `await ${p}(`,
      );
    }
    if (newBody !== body) {
      return script.slice(0, bodyOpen + 1) + newBody + script.slice(bodyClose);
    }
  }
  return null;
}

function awaitAsyncCallbackParamInvocations(script: string): string {
  let s = script;
  for (let i = 0; i < 16; i++) {
    const next = awaitAsyncCallbackParamInvocationsOnce(s);
    if (next == null) break;
    s = next;
  }
  return s;
}

/** 交替提升 async 与补 await，直到嵌套调用链稳定 */
export function promoteLegadoAsyncCallChain(
  script: string,
  extraAsyncNames: readonly string[] = [],
): string {
  let s = script;
  for (let i = 0; i < 8; i++) {
    let next = awaitAsyncFunctionCalls(
      promoteFunctionsToAsyncForAwait(s),
      extraAsyncNames,
    );
    next = rewriteAsyncForEachSerial(next);
    next = awaitAsyncCallbackParamInvocations(next);
    if (next === s) break;
    s = next;
  }
  return s;
}

const JAVA_HTTP_CHAIN_MEMBER =
  /^(matchAll|match|trim|replace|split|slice|substring|indexOf|includes|startsWith|body|header|headers|code|url|raw)\s*\(/;

/**
 * 判断 `java.get(...)` 实参是否为 HTTP 调用（对齐 jsExtensions.isHttpGetKey 的可静态判定部分）：
 * - 两参数（含 header）→ HTTP
 * - 单参数且字面量以 http(s):// 或 // 开头 → HTTP
 * 单参数变量键如 `java.get("headers")` / `java.get(key)` 不 await，避免与源变量 API 冲突。
 */
function isJavaGetHttpCallArgs(argsInner: string): boolean {
  const trimmed = argsInner.trim();
  if (!trimmed) return false;

  let depth = 0;
  let inStr: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth += 1;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      continue;
    }
    if (depth === 0 && c === ",") return true;
  }

  return (
    /^(['"`])https?:\/\//i.test(trimmed) || /^(['"`])\/\//.test(trimmed)
  );
}

/**
 * 仅为 HTTP 形态的 `java.get` 注入 await；源变量 `java.get("key")` 保持同步。
 */
function awaitJavaGetHttpCalls(script: string): string {
  let s = script;
  const prefixRe = /(?<!await\s{1,4})\bjava\.get\s*\(/g;
  while (true) {
    prefixRe.lastIndex = 0;
    let rewritten = false;
    let m: RegExpExecArray | null;
    while ((m = prefixRe.exec(s))) {
      const start = m.index;
      const openParen = start + m[0].length - 1;
      const closeParen = findMatchingParen(s, openParen);
      if (closeParen < 0) continue;
      const argsInner = s.slice(openParen + 1, closeParen);
      if (!isJavaGetHttpCallArgs(argsInner)) continue;
      s = `${s.slice(0, start)}await java.get(${argsInner})${s.slice(closeParen + 1)}`;
      rewritten = true;
      break;
    }
    if (!rewritten) break;
  }
  return s;
}

function wrapAwaitJavaHttpMemberAccess(script: string): string {
  const methods = ["ajax", "connect", "post", "get"] as const;
  let s = script;

  for (const method of methods) {
    const prefix = `await java.${method}(`;
    while (true) {
      let wrapAt = -1;
      let wrapClose = -1;

      for (let pos = 0; pos < s.length; ) {
        const start = s.indexOf(prefix, pos);
        if (start < 0) break;
        pos = start + 1;

        const openParen = start + prefix.length - 1;
        const closeParen = findMatchingParen(s, openParen);
        if (closeParen < 0) continue;

        const after = s.slice(closeParen + 1);
        if (!after.startsWith(".") || !JAVA_HTTP_CHAIN_MEMBER.test(after.slice(1))) {
          continue;
        }

        const alreadyWrapped =
          start > 0 && s[start - 1] === "(" && s[closeParen + 1] === ")";
        if (alreadyWrapped) continue;

        wrapAt = start;
        wrapClose = closeParen;
      }

      if (wrapAt < 0) break;
      s = `${s.slice(0, wrapAt)}(${s.slice(wrapAt, wrapClose + 1)})${s.slice(wrapClose + 1)}`;
    }
  }

  return s;
}

/**
 * 注入 java.ajax / post / get(HTTP) 等 await，并提升含 await 的函数为 async。
 * 不包 IIFE、不补顶层 return（供 jsLib 共享作用域与规则脚本共用）。
 */
export function injectLegadoAsyncAwaits(
  script: string,
  extraAsyncNames: readonly string[] = [],
): string {
  let s = script;

  // startBrowserAwait(...).body() / .code() / .url()
  s = s.replace(
    /java\.startBrowserAwait\(((?:[^()]|\([^()]*\))*)\)\.(body|code|url)\(\)/g,
    "(await java.startBrowserAwait($1)).$2()",
  );

  const asyncJavaCalls = [
    "startBrowserAwait",
    "ajax",
    "ajaxAll",
    "connect",
    "post",
    "getVerificationCode",
    "refreshTocUrl",
    "reGetBook",
    // loginCheckJs：`java.webView(...); result = java.getStrResponse()` 须先等 Cookie 再重请求
    "webView",
    "webViewGetOverrideUrl",
    "webViewGetSource",
    "getStrResponse",
    "getResponse",
  ] as const;
  for (const name of asyncJavaCalls) {
    s = s.replace(
      new RegExp(`(?<!await\\s{1,4})\\bjava\\.${name}\\s*\\(`, "g"),
      `await java.${name}(`,
    );
  }

  s = awaitJavaGetHttpCalls(s);

  s = s.replace(
    /await\s+java\.ajaxAll\(((?:[^()]|\([^()]*\))*)\)\s*\[/g,
    "(await java.ajaxAll($1))[",
  );

  s = injectJsoupConnectAwaits(s);

  s = wrapAwaitJavaHttpMemberAccess(s);
  s = s.replace(/\bawait\s+await\s+/g, "await ");
  s = promoteLegadoAsyncCallChain(s, extraAsyncNames);
  s = wrapAwaitCallMemberAccess(s);
  return s.replace(/\bawait\s+await\s+/g, "await ");
}

/**
 * jsLib 专用：异步注入并收集需在规则脚本中 await 的函数名。
 * （双点号等 Rhino 预处理由 sharedJsScope.prepareJsLib 负责）
 */
export function prepareJsLibAsyncBody(script: string): {
  code: string;
  asyncFunctionNames: string[];
} {
  const code = injectLegadoAsyncAwaits(script);
  return {
    code,
    asyncFunctionNames: collectAsyncFunctionNames(code),
  };
}

const loginCheckAsyncNamesCache = new Map<string, string[]>();

/**
 * loginCheckJs 中转 async 的函数名（如 `u.login = function(){ startBrowserAwait… }`）。
 * 这类方法经 objStringify → java.put → 规则脚本 eval 还原后仍是 async 函数，
 * 规则脚本中 `util.login()` 等调用点须按名注入 await，否则拿到悬空 Promise
 * （登录窗取消时变成 unhandledRejection，列表也会在登录完成前就返回）。
 */
export function collectLoginCheckJsAsyncNames(
  loginCheckJs: string | null | undefined,
  extraAsyncNames: readonly string[] = [],
): string[] {
  const raw = loginCheckJs?.trim();
  if (!raw) return [];
  const key = `${raw.length}\0${extraAsyncNames.join(",")}\0${raw.slice(0, 200)}`;
  const cached = loginCheckAsyncNamesCache.get(key);
  if (cached) return cached;
  let names: string[] = [];
  try {
    names = collectAsyncFunctionNames(
      injectLegadoAsyncAwaits(fixRhinoBareArrayArrowParams(raw), extraAsyncNames),
    );
  } catch {
    /* 收集失败时按无 async 名处理 */
  }
  loginCheckAsyncNamesCache.set(key, names);
  return names;
}

export function prepareLegadoAsyncJs(
  script: string,
  extraAsyncNames: readonly string[] = [],
): string {
  let s = prepareLegadoJs(script);
  s = injectLegadoAsyncAwaits(s, extraAsyncNames);
  return `(async () => {\n${s}\n})()`;
}

/**
 * `org.jsoup.Jsoup.connect(url).….get()` / `.post()` / `.execute()`：
 * Rhino 同步阻塞；Node 中 `.get()` 已改为 Promise，须自动补 await，
 * 否则搜索 lastChapter 等会对每条结果 spawnSync，卡死主进程 UI。
 */
function injectJsoupConnectAwaits(script: string): string {
  const connectRe =
    /(?<![\w.$])(?:Packages\s*\.\s*)?(?:org\s*\.\s*jsoup\s*\.\s*)?Jsoup\s*\.\s*connect\s*\(/gi;
  let s = script;
  let searchFrom = 0;
  while (searchFrom < s.length) {
    connectRe.lastIndex = searchFrom;
    const m = connectRe.exec(s);
    if (!m || m.index == null) break;
    const exprStart = m.index;
    const before = s.slice(Math.max(0, exprStart - 8), exprStart);
    if (/\bawait\s*$/.test(before)) {
      searchFrom = exprStart + m[0].length;
      continue;
    }
    const openParen = exprStart + m[0].length - 1;
    const connectClose = findMatchingParen(s, openParen);
    if (connectClose < 0) {
      searchFrom = openParen + 1;
      continue;
    }
    let pos = connectClose + 1;
    let lastMethod: string | null = null;
    while (true) {
      const chain = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(s.slice(pos));
      if (!chain) break;
      lastMethod = chain[1] ?? null;
      const methodOpen = pos + chain[0].length - 1;
      const methodClose = findMatchingParen(s, methodOpen);
      if (methodClose < 0) break;
      pos = methodClose + 1;
      if (
        lastMethod === "get" ||
        lastMethod === "post" ||
        lastMethod === "execute"
      ) {
        break;
      }
    }
    if (
      lastMethod !== "get" &&
      lastMethod !== "post" &&
      lastMethod !== "execute"
    ) {
      searchFrom = pos;
      continue;
    }
    s = `${s.slice(0, exprStart)}await ${s.slice(exprStart)}`;
    searchFrom = pos + "await ".length;
  }
  return s;
}

/**
 * `await fn(...).member` 实际是 `await (fn(...).member)`（. 优先于 await）。
 * 异步 fn 返回 Promise 时须写成 `(await fn(...)).member`。
 * 同样处理 `await this.fn(...).member`，以及紧跟的再调用 / 下标：
 * `await handlerFactory()()` / `await fn(...)[0]` 须包成 `(await fn(...))()`，
 * 否则是对 Promise 本身调用（"handlerFactory(...) is not a function"）。
 */
function wrapAwaitCallMemberAccess(script: string): string {
  let s = script;
  while (true) {
    let wrapAt = -1;
    let wrapClose = -1;

    for (let pos = 0; pos < s.length; ) {
      const m =
        /\bawait\s+(?:this|[A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/.exec(
          s.slice(pos),
        );
      if (!m) break;
      const start = pos + m.index!;
      pos = start + 1;

      const openParen = start + m[0].length - 1;
      const closeParen = findMatchingParen(s, openParen);
      if (closeParen < 0) continue;

      const after = s.slice(closeParen + 1);
      const isMemberAccess =
        after.startsWith(".") && /^[A-Za-z_$]/.test(after.slice(1));
      // 仅认紧贴的 `(`/`[`（无空白），避免误伤下一行以 `(` 开头的独立语句
      const isImmediateCallOrIndex =
        after.startsWith("(") || after.startsWith("[");
      if (!isMemberAccess && !isImmediateCallOrIndex) {
        continue;
      }

      const alreadyWrapped =
        start > 0 && s[start - 1] === "(" && s[closeParen + 1] === ")";
      if (alreadyWrapped) continue;

      wrapAt = start;
      wrapClose = closeParen;
    }

    if (wrapAt < 0) break;
    s = `${s.slice(0, wrapAt)}(${s.slice(wrapAt, wrapClose + 1)})${s.slice(wrapClose + 1)}`;
  }

  return s;
}
