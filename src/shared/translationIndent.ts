/** 翻译后按选区文本回填行首缩进（含普通空格 / Tab / NBSP / 全角空格等） */

/** 单行内的前导空白（不含换行；`\s` 含 \u00a0、\u3000 等） */
const LEADING_WS = /^\s*/;

export function leadingLineIndent(line: string): string {
  return line.match(LEADING_WS)?.[0] ?? "";
}

export function stripLeadingLineIndent(line: string): string {
  return line.replace(LEADING_WS, "");
}

/**
 * 把选区原文每行行首缩进套到译文对应行。
 * 行数一致时按行号；否则按非空行对齐；仍对不上则原样返回。
 */
export function reapplySourceLineIndents(
  source: string,
  translated: string,
): string {
  if (!translated) return translated;
  const srcLines = source.split(/\r?\n/);
  const dstLines = translated.split(/\r?\n/);

  if (srcLines.length === dstLines.length) {
    return dstLines
      .map(
        (line, i) =>
          leadingLineIndent(srcLines[i]!) + stripLeadingLineIndent(line),
      )
      .join("\n");
  }

  if (srcLines.length <= 1) return translated;

  const srcBodies = srcLines
    .map((line) => ({
      ws: leadingLineIndent(line),
      body: stripLeadingLineIndent(line),
    }))
    .filter((x) => x.body.length > 0);
  const dstBodies = dstLines
    .map((line, i) => ({ i, body: stripLeadingLineIndent(line) }))
    .filter((x) => x.body.length > 0);
  if (srcBodies.length === 0 || srcBodies.length !== dstBodies.length) {
    return translated;
  }

  const out = dstLines.slice();
  for (let k = 0; k < dstBodies.length; k++) {
    const di = dstBodies[k]!.i;
    out[di] = srcBodies[k]!.ws + stripLeadingLineIndent(dstLines[di]!);
  }
  return out.join("\n");
}
