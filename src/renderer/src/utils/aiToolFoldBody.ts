/** 工具折叠「结果」正文：JSON 美化 + 高亮，或纯文本转义 */

export type ToolFoldBodySource = {
  full: string;
  preview: string;
  /** 列表/标题用入参摘要 */
  argsPreview?: string;
  /** 完整入参 JSON，折叠「请求」区优先使用 */
  argsJson?: string;
  status?: "running" | "done" | "error";
  progressMessage?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 从 `JSON.stringify(..., null, 2)` 的文本中读出双引号字符串的内层原文（保留 \\n 等转义写法） */
function readJsonStringLiteral(
  src: string,
  openQuoteIdx: number,
): { innerRaw: string; afterIdx: number } | null {
  if (src[openQuoteIdx] !== '"') return null;
  let i = openQuoteIdx + 1;
  let inner = "";
  const len = src.length;
  while (i < len) {
    const ch = src[i]!;
    if (ch === "\\") {
      if (i + 1 >= len) return null;
      const e = src[i + 1]!;
      if (
        e === "u" &&
        i + 5 < len &&
        /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))
      ) {
        inner += src.slice(i, i + 6);
        i += 6;
        continue;
      }
      inner += "\\" + e;
      i += 2;
      continue;
    }
    if (ch === '"') return { innerRaw: inner, afterIdx: i + 1 };
    inner += ch;
    i++;
  }
  return null;
}

/** 对已是「标准 2 空格」缩进的 JSON 文本加高亮，不改变空白与换行 */
function highlightPrettyJsonHtml(pretty: string): string {
  let i = 0;
  const len = pretty.length;
  let out = "";
  while (i < len) {
    const c = pretty[i]!;
    if (c === '"') {
      const r = readJsonStringLiteral(pretty, i);
      if (!r) {
        out += escapeHtml(c);
        i++;
        continue;
      }
      let j = r.afterIdx;
      while (j < len && (pretty[j] === " " || pretty[j] === "\t")) j++;
      const isKey = pretty[j] === ":";
      const innerEsc = escapeHtml(r.innerRaw);
      const cls = isKey ? "aiJsonKey" : "aiJsonStr";
      out += `<span class="${cls}">"${innerEsc}"</span>`;
      i = r.afterIdx;
      continue;
    }

    const nextDigit =
      pretty[i + 1] !== undefined &&
      pretty[i + 1]! >= "0" &&
      pretty[i + 1]! <= "9";
    if ((c === "-" && nextDigit) || (c >= "0" && c <= "9")) {
      const start = i;
      i++;
      while (i < len && /[0-9.eE+-]/.test(pretty[i]!)) i++;
      out += `<span class="aiJsonNum">${escapeHtml(pretty.slice(start, i))}</span>`;
      continue;
    }

    if (pretty.startsWith("true", i)) {
      out += `<span class="aiJsonKw">true</span>`;
      i += 4;
      continue;
    }
    if (pretty.startsWith("false", i)) {
      out += `<span class="aiJsonKw">false</span>`;
      i += 5;
      continue;
    }
    if (pretty.startsWith("null", i)) {
      out += `<span class="aiJsonKw">null</span>`;
      i += 4;
      continue;
    }

    out += escapeHtml(c);
    i++;
  }
  return out;
}

function toolBodyDisplayHtml(raw: string): { html: string; isJson: boolean } {
  const t = raw.trim();
  if (!t) return { html: "", isJson: false };
  try {
    const parsed: unknown = JSON.parse(t);
    const pretty = JSON.stringify(parsed, null, 2);
    return {
      html: highlightPrettyJsonHtml(pretty),
      isJson: true,
    };
  } catch {
    return { html: escapeHtml(raw), isJson: false };
  }
}

export function toolFoldArgsRendered(tool: {
  argsJson?: string;
  argsPreview?: string;
}): { html: string; isJson: boolean } {
  const raw = (tool.argsJson ?? tool.argsPreview ?? "").trim();
  if (!raw) return { html: "", isJson: false };
  if (raw === "（与上一轮相同，已跳过执行）") {
    return { html: escapeHtml(raw), isJson: false };
  }
  return toolBodyDisplayHtml(raw);
}

/** 章节压缩进度：「当前进度：M/N」中的 M/N 用 warning 色加粗 */
function renderToolProgressHtml(progress: string): string {
  const lines = progress.split("\n");
  const htmlLines = lines.map((line) => {
    const m = /^当前进度：(\d+)\/(\d+)\s*$/.exec(line);
    if (m) {
      return `当前进度：<span class="aiDigestProgressFrac">${escapeHtml(m[1]!)}/${escapeHtml(m[2]!)}</span>`;
    }
    return escapeHtml(line);
  });
  return htmlLines.join("\n");
}

export function toolFoldBodyRendered(tool: ToolFoldBodySource): {
  html: string;
  isJson: boolean;
} {
  const raw = tool.full.trim() || tool.preview.trim();
  if (!raw) {
    const progress = (tool.progressMessage ?? "").trim();
    if (tool.status === "running" && progress) {
      return { html: renderToolProgressHtml(progress), isJson: false };
    }
    return { html: escapeHtml("（执行中…）"), isJson: false };
  }
  return toolBodyDisplayHtml(raw);
}
