/**
 * 书源规则轻量语法高亮（对齐 legado-E CodeView 正则规则）。
 * 输出已转义的 HTML 片段，供 textarea 叠层渲染。
 */

/** 对齐 CodeView：过长则跳过着色，避免卡顿 */
export const BOOK_SOURCE_HIGHLIGHT_MAX_LEN = 8192;

/** 对齐 CodeView 的 mUpdateDelayTime */
export const BOOK_SOURCE_HIGHLIGHT_DEBOUNCE_MS = 500;

export type BookSourceHighlightClass =
  | "bsHl-legado"
  | "bsHl-json"
  | "bsHl-jsWrap"
  | "bsHl-jsOp"
  | "bsHl-jsKw";

type PatternDef = {
  /** 须带 g 标志；匹配时 later 覆盖 earlier（同 CodeView 依次 setSpan） */
  re: RegExp;
  cls: BookSourceHighlightClass;
};

/** 移植自 legado-E CodeViewExtensions.kt */
const PATTERNS: PatternDef[] = [
  {
    re: /\|\||&&|%%|@js:|@Json:|@css:|@@|@XPath:|@webjs:/g,
    cls: "bsHl-legado",
  },
  {
    re: /"[A-Za-z0-9]*?":|"|\{|\}|\[|\]/g,
    cls: "bsHl-json",
  },
  {
    re: /\\n/g,
    cls: "bsHl-jsWrap",
  },
  {
    // 较长运算符优先，避免被单字符切开
    re: /\|::|==|!=|>=|<=|->|\+=|-=|%=|:|>|<|=|%|\+|-|\^|&|\?|\*/g,
    cls: "bsHl-jsOp",
  },
  {
    re: /\b(?:var|let|const)\b/g,
    cls: "bsHl-jsKw",
  },
];

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 将书源字段文本转为带着色 span 的 HTML（已转义）。
 * 空串或超长时仅转义、不着色。
 */
export function highlightBookSourceCode(text: string): string {
  if (!text || text.length > BOOK_SOURCE_HIGHLIGHT_MAX_LEN) {
    return escapeHtml(text);
  }

  const classes = new Array<BookSourceHighlightClass | null>(text.length).fill(
    null,
  );

  for (const { re, cls } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      for (let i = start; i < end; i++) {
        classes[i] = cls;
      }
      if (m[0].length === 0) {
        re.lastIndex++;
      }
    }
  }

  let html = "";
  let i = 0;
  while (i < text.length) {
    const cls = classes[i];
    let j = i + 1;
    while (j < text.length && classes[j] === cls) j++;
    const chunk = escapeHtml(text.slice(i, j));
    html += cls ? `<span class="${cls}">${chunk}</span>` : chunk;
    i = j;
  }
  return html;
}

/** 不需要语法高亮的元数据字段 key */
const PLAIN_BOOK_SOURCE_FIELD_KEYS = new Set([
  "bookSourceUrl",
  "bookSourceName",
  "bookSourceGroup",
  "bookSourceComment",
  "concurrentRate",
  "variableComment",
  "checkKeyWord",
]);

export function bookSourceFieldUsesHighlight(fieldKey: string): boolean {
  return !PLAIN_BOOK_SOURCE_FIELD_KEYS.has(fieldKey);
}

/** 对齐 CodeView.mIndentCharacterList：行末遇这些字符时多缩进一层 */
const AUTO_INDENT_TRIGGER_CHARS = new Set(["{", "+", "-", "*", "/", "="]);

/**
 * 计算 Enter 后应追加的缩进（不含换行符本身）。
 * 对齐 legado-E CodeView.autoIndent：复制当前行行首空白；
 * 若行内未闭合 `(` 或行末有效字符属于触发集，再追加一个 Tab。
 */
export function computeAutoIndentAfterNewline(
  text: string,
  cursor: number,
): string {
  let iStart = cursor - 1;
  let dataBefore = false;
  let pt = 0;

  while (iStart > -1) {
    const c = text[iStart]!;
    if (c === "\n") break;
    if (c !== " " && c !== "\t") {
      if (!dataBefore) {
        if (AUTO_INDENT_TRIGGER_CHARS.has(c)) --pt;
        dataBefore = true;
      }
      if (c === "(") --pt;
      else if (c === ")") ++pt;
    }
    --iStart;
  }

  let indent = "";
  // 有上一行换行，或位于首行：都取本行行首空白（legado 首行会跳过，此处补全）
  const lineStart = iStart > -1 ? iStart + 1 : 0;
  let iEnd = lineStart;
  const charAtCursor = cursor < text.length ? text[cursor]! : "\n";
  while (iEnd < cursor) {
    const c = text[iEnd]!;
    // 对齐 CodeView：行首 `//` 注释时跳过
    if (
      charAtCursor !== "\n" &&
      c === "/" &&
      iEnd + 1 < cursor &&
      text[iEnd + 1] === "/"
    ) {
      iEnd += 2;
      break;
    }
    if (c !== " " && c !== "\t") break;
    ++iEnd;
  }
  indent += text.slice(lineStart, iEnd);

  if (pt < 0) {
    indent += "\t";
  }
  return indent;
}

