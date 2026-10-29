/**
 * 文本替换规则：渲染进程 localStorage。
 * `app` / `findBook` 分键存储，互不影响。
 */
import {
  normalizeReplaceRule,
  type ReplaceRule,
  type ReplaceRuleBucket,
} from "@shared/bookSource/replaceRule";

const STORAGE_KEY: Record<ReplaceRuleBucket, string> = {
  app: "colortxt:replaceRules:app",
  findBook: "colortxt:replaceRules:findBook",
};

const memory: Record<ReplaceRuleBucket, ReplaceRule[] | null> = {
  app: null,
  findBook: null,
};

function cloneRule(r: ReplaceRule): ReplaceRule {
  return { ...r };
}

function readFromStorage(bucket: ReplaceRuleBucket): ReplaceRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY[bucket]);
    if (!raw?.trim()) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ReplaceRule[] = [];
    const seen = new Set<number>();
    let i = 0;
    for (const item of parsed) {
      const rule = normalizeReplaceRule(item, Date.now() + i);
      i += 1;
      if (!rule || !rule.pattern.trim()) continue;
      let id = rule.id;
      while (seen.has(id)) id += 1;
      seen.add(id);
      out.push({ ...rule, id });
    }
    out.sort((a, b) => a.order - b.order || a.id - b.id);
    return out;
  } catch {
    return [];
  }
}

function writeToStorage(bucket: ReplaceRuleBucket, rules: ReplaceRule[]): void {
  localStorage.setItem(STORAGE_KEY[bucket], JSON.stringify(rules));
}

function ensureLoaded(bucket: ReplaceRuleBucket): ReplaceRule[] {
  if (memory[bucket] == null) {
    memory[bucket] = readFromStorage(bucket);
  }
  return memory[bucket]!;
}

export function listReplaceRulesLocal(bucket: ReplaceRuleBucket): ReplaceRule[] {
  return ensureLoaded(bucket).map(cloneRule);
}

/**
 * 整表提交：按数组顺序写 order，跳过无效规则。
 */
export function commitReplaceRulesLocal(
  bucket: ReplaceRuleBucket,
  rules: ReplaceRule[],
): ReplaceRule[] {
  const saved: ReplaceRule[] = [];
  let order = 0;
  for (const raw of rules) {
    const rule = normalizeReplaceRule(raw);
    if (!rule || !rule.pattern.trim()) continue;
    if (!Number.isFinite(rule.id) || rule.id <= 0) {
      rule.id = Date.now() + order;
    }
    while (saved.some((s) => s.id === rule.id)) rule.id += 1;
    rule.order = order;
    order += 1;
    saved.push(cloneRule(rule));
  }
  memory[bucket] = saved;
  writeToStorage(bucket, saved);
  return saved.map(cloneRule);
}

/** 测试或窗口重载前可清内存缓存（下次 list 再读盘） */
export function invalidateReplaceRulesLocalCache(
  bucket?: ReplaceRuleBucket,
): void {
  if (bucket) {
    memory[bucket] = null;
    return;
  }
  memory.app = null;
  memory.findBook = null;
}
