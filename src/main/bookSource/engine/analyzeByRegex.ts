/** 对齐 Legado AnalyzeByRegex：用正则捕获组提取列表/单项 */

/**
 * 将 Java/Legado 嵌入式标志转为 JS RegExp flags。
 * 例：`(?s)(\d+)"…`（部分书源目录）→ pattern 去 `(?s)`，flags 加 `s`。
 * 勿误伤 `(?:` 非捕获组。
 */
export function compileLegadoRegex(
  pattern: string,
  baseFlags = "g",
): RegExp | null {
  let pat = String(pattern ?? "");
  let flags = baseFlags;
  const addFlag = (f: string) => {
    if (!flags.includes(f)) flags += f;
  };
  const applyJavaFlags = (javaFlags: string) => {
    if (javaFlags.includes("i")) addFlag("i");
    if (javaFlags.includes("m")) addFlag("m");
    if (javaFlags.includes("s")) addFlag("s");
    if (javaFlags.includes("u")) addFlag("u");
  };
  // 仅匹配 (?imsux) / (?is) 等，排除 (?=) (?!) (?<=) (?<!) (?:) (?<name>)
  const javaFlagRe = /\(\?([imsux]+)\)/g;
  pat = pat.replace(javaFlagRe, (_, f: string) => {
    applyJavaFlags(f);
    return "";
  });
  try {
    return new RegExp(pat, flags);
  } catch {
    return null;
  }
}

export function regexGetElement(
  text: string,
  regs: string[],
  index = 0,
): string[] | null {
  if (index >= regs.length) return null;
  const re = compileLegadoRegex(regs[index]!);
  if (!re) return null;
  const m = re.exec(text);
  if (!m) return null;

  if (index + 1 === regs.length) {
    const info: string[] = [];
    for (let g = 0; g <= m.length - 1; g++) {
      info.push(m[g] ?? "");
    }
    return info;
  }

  let joined = "";
  re.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text))) {
    joined += mm[0];
  }
  return regexGetElement(joined, regs, index + 1);
}

export function regexGetElements(
  text: string,
  regs: string[],
  index = 0,
): string[][] {
  if (index >= regs.length) return [];
  const re = compileLegadoRegex(regs[index]!);
  if (!re) return [];
  const first = re.exec(text);
  if (!first) return [];

  if (index + 1 === regs.length) {
    const books: string[][] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const info: string[] = [];
      for (let g = 0; g <= m.length - 1; g++) {
        info.push(m[g] ?? "");
      }
      books.push(info);
    }
    return books;
  }

  let joined = "";
  re.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text))) {
    joined += mm[0];
  }
  return regexGetElements(joined, regs, index + 1);
}

export function parseRegexRuleList(rule: string): string[] {
  let r = rule.trim();
  if (r.startsWith(":")) r = r.slice(1);
  return r
    .split("&&")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function looksLikeLegadoRegexRule(rule: string): boolean {
  const t = rule.trim();
  if (!t) return false;
  if (t.startsWith(":")) return true;
  if (/^\$\d{1,2}(?:@|##|$)/.test(t)) return false;
  if (t.startsWith("$.") || t.startsWith("$[")) return false;
  // Legado CSS：a[id][target]@text、tag.li@text 等带 @提取类型，勿因 `[` 误判为 Regex
  if (
    /@(?:text|textNodes|ownText|html|all|href|src|content|value)\b/i.test(t) ||
    /^@@/.test(t) ||
    /^@css:/i.test(t) ||
    /^class\.|^tag\.|^id\./.test(t) ||
    /\][@\s]*@/.test(t)
  ) {
    return false;
  }
  if (/\\(\?:|\.|\d|\+|\*|\?|\[)/.test(t) && !/^(class|tag|id)\./.test(t)) {
    return true;
  }
  return false;
}
