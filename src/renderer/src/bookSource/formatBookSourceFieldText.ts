/** 书源字段全屏 Monaco 语言与格式化（JS 对齐 legado-E：js-beautify） */

import jsBeautify from "js-beautify";

export type BookSourceMonacoLanguage = "javascript" | "json" | "plaintext";

const JSON_FIELD_KEYS = new Set(["loginUi", "header"]);
const PLAINTEXT_FIELD_KEYS = new Set([
  "bookUrlPattern",
  "sourceRegex",
  "replaceRegex",
]);

/**
 * 多数字段用 javascript 仅取其着色（诊断在全屏编辑器内已关闭，避免规则 DSL 误报）。
 * JSON / 纯正则字段单独区分。
 */
export function bookSourceFieldMonacoLanguage(
  fieldKey: string,
): BookSourceMonacoLanguage {
  if (JSON_FIELD_KEYS.has(fieldKey)) return "json";
  if (PLAINTEXT_FIELD_KEYS.has(fieldKey)) return "plaintext";
  return "javascript";
}

export type FormatBookSourceFieldResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

/** 与 legado-E CodeEditViewModel.webFormatCode 选项对齐 */
const JS_BEAUTIFY_OPTS: jsBeautify.JSBeautifyOptions = {
  indent_size: 4,
  indent_char: " ",
  preserve_newlines: true,
  max_preserve_newlines: 5,
  brace_style: "collapse",
  space_before_conditional: true,
  unescape_strings: false,
  jslint_happy: false,
  end_with_newline: false,
  wrap_line_length: 0,
  comma_first: false,
};

function formatJsonText(text: string): FormatBookSourceFieldResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, text };
  try {
    return {
      ok: true,
      text: JSON.stringify(JSON.parse(trimmed), null, 2),
    };
  } catch {
    return { ok: false, message: "JSON 格式无效，无法格式化" };
  }
}

function beautifyJsCode(code: string): string {
  return jsBeautify.js(code, JS_BEAUTIFY_OPTS);
}

/**
 * 对齐 legado-E formatCode：整段 JS，或抽出 `<js>` / `@js:` / `@webjs:` 内代码美化。
 */
function formatLegadoStyleJs(text: string): string {
  const normalized = text.replace(/\r\n|\r/g, "\n");

  if (/<js>/i.test(normalized)) {
    return normalized.replace(/<js>([\s\S]*?)<\/js>/gi, (_m, inner: string) => {
      const formatted = beautifyJsCode(inner.trim());
      return `<js>\n${formatted}\n</js>`;
    });
  }

  const atJs = normalized.indexOf("@js:");
  if (atJs >= 0) {
    const before = normalized.slice(0, atJs).trimEnd();
    const code = normalized.slice(atJs + 4);
    const formatted = beautifyJsCode(code);
    return `${before ? `${before}\n` : ""}@js:\n${formatted}`;
  }

  const atWebJs = normalized.indexOf("@webjs:");
  if (atWebJs >= 0) {
    const before = normalized.slice(0, atWebJs).trimEnd();
    const code = normalized.slice(atWebJs + 7);
    const formatted = beautifyJsCode(code);
    return `${before ? `${before}\n` : ""}@webjs:\n${formatted}`;
  }

  return beautifyJsCode(normalized);
}

export function formatBookSourceFieldText(
  text: string,
  language: BookSourceMonacoLanguage,
): FormatBookSourceFieldResult {
  if (language === "json") {
    return formatJsonText(text);
  }
  if (language === "plaintext") {
    const t = text.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      const asJson = formatJsonText(text);
      if (asJson.ok) return asJson;
    }
    // 规则字段里常嵌 `<js>` / `@js:`，按 legado 方式美化
    if (/<js>|@js:|@webjs:/i.test(text)) {
      try {
        return { ok: true, text: formatLegadoStyleJs(text) };
      } catch {
        return { ok: false, message: "格式化失败" };
      }
    }
    return { ok: true, text };
  }
  try {
    return { ok: true, text: formatLegadoStyleJs(text) };
  } catch {
    return { ok: false, message: "格式化失败" };
  }
}
