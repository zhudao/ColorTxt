/**
 * Legado/GSON 宽松 JSON：单引号字符串、无引号键、字符串内未转义控制字符。
 * 独立成文件，避免 analyzeUrl ↔ sourceRequestHeaders 循环依赖。
 */

import vm from "node:vm";

/** 单引号字面量转双引号，并转义内部 `"`（供 body: '{"a":1}' 一类 UrlOption） */
export function normalizeLegadoLooseJson(raw: string): string {
  return raw
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) => {
      const escaped = String(inner)
        .replace(/\\'/g, "'")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      return `"${escaped}"`;
    })
    .replace(/(\{|,)\s*([a-zA-Z_-][\w-]*)\s*:/g, '$1"$2":');
}

function maskJsonStringLiterals(text: string): { masked: string; parts: string[] } {
  const parts: string[] = [];
  const masked = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => {
    parts.push(m);
    return `\0S${parts.length - 1}\0`;
  });
  return { masked, parts };
}

function unmaskJsonStringLiterals(text: string, parts: string[]): string {
  return text.replace(/\0S(\d+)\0/g, (_, i) => parts[Number(i)] ?? "");
}

/**
 * Next.js `__INITIAL_STATE__` 等为 JS 对象字面量，常含 `undefined`/`NaN`/`Infinity`。
 * 标准 JSON.parse 会报 `Unexpected token 'u'`；须仅在字符串外替换为 JSON 可接受形式。
 */
export function normalizeJsLiteralForJson(raw: string): string {
  const { masked, parts } = maskJsonStringLiterals(raw);
  const normalized = masked
    .replace(/:\s*undefined\b/g, ":null")
    .replace(/([,\[])\s*undefined\b/g, "$1null")
    .replace(/:\s*NaN\b/g, ":null")
    .replace(/([,\[])\s*NaN\b/g, "$1null")
    .replace(/:\s*-Infinity\b/g, ":null")
    .replace(/:\s*Infinity\b/g, ":null")
    .replace(/([,\[])\s*-Infinity\b/g, "$1null")
    .replace(/([,\[])\s*Infinity\b/g, "$1null");
  return unmaskJsonStringLiterals(normalized, parts);
}

/** 仅对 `{…}` / `[…]` 形态、且 JSON 全失败时：按 JS 对象字面量求值（对齐页面内联 state） */
function parseJsObjectLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (!/^[\[{]/.test(trimmed)) {
    throw new SyntaxError("not a JS object/array literal");
  }
  const sandbox = Object.create(null) as Record<string, unknown>;
  vm.createContext(sandbox);
  return vm.runInContext(`(${trimmed})`, sandbox, { timeout: 1000 });
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * 把 JSON 字符串字面量里的裸控制字符转成 `\n`/`\r`/`\t`/`\u00xx`。
 * 发现分类等规则常把多行 `@js:` 直接写进 JSON，GSON 可解析，标准 JSON.parse 会报
 * `Bad control character in string literal`。
 */
export function escapeControlCharsInJsonStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) {
        out += c;
        escaped = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        escaped = true;
        continue;
      }
      if (c === '"') {
        out += c;
        inString = false;
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        if (c === "\n") out += "\\n";
        else if (c === "\r") out += "\\r";
        else if (c === "\t") out += "\\t";
        else out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      out += c;
    } else {
      if (c === '"') inString = true;
      out += c;
    }
  }
  return out;
}

/** 标准 JSON → 控制字符转义 → 单引号/无引号键 → JS 字面量，依次尝试 */
export function parseLegadoLenientJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const escaped = escapeControlCharsInJsonStrings(trimmed);
  const jsNorm = normalizeJsLiteralForJson(trimmed);
  const jsNormEscaped = normalizeJsLiteralForJson(escaped);
  const candidates = uniqueStrings([
    trimmed,
    escaped,
    normalizeLegadoLooseJson(trimmed),
    normalizeLegadoLooseJson(escaped),
    jsNorm,
    jsNormEscaped,
    normalizeLegadoLooseJson(jsNorm),
    normalizeLegadoLooseJson(jsNormEscaped),
  ]);
  let lastErr: unknown;
  for (const text of candidates) {
    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      lastErr = e;
    }
  }
  if (/^[\[{]/.test(trimmed)) {
    try {
      return parseJsObjectLiteral(trimmed);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? "JSON parse failed"));
}

export function parseLegadoLooseJsonObject(
  raw: string,
): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseLegadoLenientJson(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return null;
}
