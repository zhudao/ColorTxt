/** 角色别名：解析、合并与展示（侧栏编辑与主进程检索共用） */

const ALIAS_SPLIT_RE = /[,，|]+/;

/** 将用户输入的别名字符串拆为列表（支持中英文逗号与竖线） */
export function parseCharacterAliasesInput(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  return text
    .split(ALIAS_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

function aliasDedupeKey(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 合并用户填写与检索识别的别名，去重并排除与角色名相同的项。
 * 顺序：用户输入在前，检索识别在后。
 */
export function mergeCharacterAliases(opts: {
  displayName?: string;
  userInput?: string;
  discovered?: readonly string[];
}): string[] {
  const main = opts.displayName?.trim() ?? "";
  const mainKey = main ? aliasDedupeKey(main) : "";
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const a = raw.trim();
    if (!a) return;
    const key = aliasDedupeKey(a);
    if (mainKey && key === mainKey) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };

  for (const a of parseCharacterAliasesInput(opts.userInput ?? "")) {
    push(a);
  }
  for (const a of opts.discovered ?? []) {
    push(a);
  }
  return out;
}

/** 别名列表以中文逗号拼接，供输入框展示与持久化 */
export function formatCharacterAliasesList(aliases: readonly string[]): string {
  return aliases
    .map((a) => a.trim())
    .filter(Boolean)
    .join("，");
}

const MAX_ALIAS_ITEMS = 12;
const MAX_ALIAS_ITEM_CHARS = 48;

/** 规范化 LLM / 检索返回的别名候选 */
export function normalizeAliasCandidates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, MAX_ALIAS_ITEMS)) {
    if (typeof row !== "string") continue;
    const a = row.trim().slice(0, MAX_ALIAS_ITEM_CHARS);
    if (!a) continue;
    const key = aliasDedupeKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function cleanQuotedAlias(raw: string): string {
  return raw
    .trim()
    .replace(/^[「『"'']+|[」』"'']+$/g, "")
    .trim();
}

/**
 * 从身份/简介等汇总文本中抽取「人称 XXX」「绰号 XXX」等引号内别名。
 * 用于 LLM 未填 aliases 数组时的兜底。
 */
export function extractAliasesFromPortraitText(
  text: string,
  displayName?: string,
): string[] {
  const src = text.trim();
  if (!src) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const mainKey = displayName?.trim() ? aliasDedupeKey(displayName) : "";

  const push = (raw: string) => {
    const a = cleanQuotedAlias(raw);
    if (!a || a.length < 2 || a.length > MAX_ALIAS_ITEM_CHARS) return;
    if (/^(?:男|女|少年|少女|青年|中年|老年)$/.test(a)) return;
    const key = aliasDedupeKey(a);
    if (mainKey && key === mainKey) return;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(a);
  };

  const reRenCheng =
    /(?:江湖)?人称(?:为|叫)?[^，。；\n]*?[「『"']([^「』""'，,、；;或和及]+)[」』"'](?:\s*[或和及]\s*[「『"']([^「』""'，,、；;]+)[」』"''])?/g;
  let m: RegExpExecArray | null;
  while ((m = reRenCheng.exec(src)) !== null) {
    push(m[1] ?? "");
    if (m[2]) push(m[2]);
  }

  const reCue =
    /(?:绰号|外号|又称|又名|又叫|别称|称之|道号|尊号|诨号|混号|号称)(?:为|是|叫)?\s*[「『"']([^「』""'，,、；;]+)[」』"'']/g;
  while ((m = reCue.exec(src)) !== null) {
    push(m[1] ?? "");
  }

  return found;
}

export function extractAliasesFromPortraitFields(opts: {
  displayName?: string;
  identity?: string;
  bio?: string;
  appearance?: string;
  excerptQuotes?: readonly string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushAll = (list: readonly string[]) => {
    for (const a of list) {
      const key = aliasDedupeKey(a);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  };
  const name = opts.displayName;
  for (const text of [opts.identity, opts.bio, opts.appearance]) {
    if (text?.trim()) {
      pushAll(extractAliasesFromPortraitText(text, name));
    }
  }
  for (const q of opts.excerptQuotes ?? []) {
    if (q?.trim()) {
      pushAll(extractAliasesFromPortraitText(q, name));
    }
  }
  return out;
}
