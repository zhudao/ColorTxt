/** 对齐 Legado `ReplaceRule`：正文/标题替换净化 */

/**
 * 规则分区：主窗口与找书各自独立（分 localStorage 键），互不覆盖、不互相同步渲染。
 * - `app` → `colortxt:replaceRules:app`
 * - `findBook` → `colortxt:replaceRules:findBook`（阅读 + 整书导出随下载请求传入主进程）
 */
export type ReplaceRuleBucket = "app" | "findBook";

/** 主窗口规则变更（仅本窗口渲染进程） */
export const appReplaceRulesChangedEvent = "colortxt:app-replace-rules-changed";
/** 找书窗口规则变更（仅本窗口渲染进程） */
export const findBookReplaceRulesChangedEvent =
  "colortxt:find-book-replace-rules-changed";

export function replaceRulesChangedEventFor(
  bucket: ReplaceRuleBucket,
): string {
  return bucket === "app"
    ? appReplaceRulesChangedEvent
    : findBookReplaceRulesChangedEvent;
}

export type ReplaceRule = {
  id: number;
  name: string;
  /** Legado 导入兼容；UI 已不展示分组，有值时保留 */
  group?: string;
  pattern: string;
  replacement: string;
  /**
   * 替换范围：可选（空=全部）。
   * 范围字符串包含当前书名或书源 URL 时命中；可拼多本书名（对齐 Legado `scope`）。
   */
  scope?: string;
  scopeTitle: boolean;
  scopeContent: boolean;
  /**
   * 排除范围：可选（命中则跳过）。
   * 匹配方式同 `scope`（对齐 Legado `excludeScope`）。
   */
  excludeScope?: string;
  isEnabled: boolean;
  isRegex: boolean;
  timeoutMillisecond: number;
  /** 排序（越小越靠前） */
  order: number;
};

export type ReplaceRuleListItem = Pick<
  ReplaceRule,
  | "id"
  | "name"
  | "group"
  | "pattern"
  | "replacement"
  | "scope"
  | "scopeTitle"
  | "scopeContent"
  | "excludeScope"
  | "isEnabled"
  | "isRegex"
  | "timeoutMillisecond"
  | "order"
>;

export function getValidTimeoutMillisecond(rule: {
  timeoutMillisecond?: number;
}): number {
  const t = rule.timeoutMillisecond;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return 3000;
  return Math.floor(t);
}

export function isReplaceRuleValid(rule: Pick<ReplaceRule, "pattern" | "isRegex">): boolean {
  const pattern = rule.pattern?.trim() ?? "";
  if (!pattern) return false;
  if (!rule.isRegex) return true;
  try {
    // 优先 `u`：与套用时一致，并避免增补平面字符类在无 `u` 下的异常语义
    // eslint-disable-next-line no-new
    new RegExp(pattern, "u");
  } catch {
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch {
      return false;
    }
  }
  if (pattern.endsWith("|") && !pattern.endsWith("\\|")) return false;
  return true;
}

export function displayReplaceRuleName(rule: Pick<ReplaceRule, "name">): string {
  // return rule.name?.trim() || "未命名";
  return rule.name?.trim() || "";
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === 0 || v === 1) return Boolean(v);
  if (v === "0" || v === "1") return v === "1";
  return fallback;
}

function asOptionalString(v: unknown): string {
  if (v == null || typeof v !== "string") return "";
  return v.trim();
}

/** 导出用：可选字符串字段用空字符串，避免 JSON 出现 null（对齐 Legado） */
export function replaceRuleForExport(rule: ReplaceRule): ReplaceRule {
  return {
    ...rule,
    group: rule.group ?? "",
    scope: rule.scope ?? "",
    excludeScope: rule.excludeScope ?? "",
  };
}

/** 规范化单条规则（兼容 Legado JSON 字段） */
export function normalizeReplaceRule(raw: unknown, fallbackId?: number): ReplaceRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pattern = typeof o.pattern === "string" ? o.pattern : "";
  if (!pattern.trim() && typeof o.name !== "string") return null;

  let id =
    typeof o.id === "number" && Number.isFinite(o.id)
      ? Math.floor(o.id)
      : typeof o.id === "string" && /^\d+$/.test(o.id.trim())
        ? Number(o.id.trim())
        : fallbackId ?? Date.now();

  const orderRaw = o.order ?? o.sortOrder;
  const order =
    typeof orderRaw === "number" && Number.isFinite(orderRaw)
      ? Math.floor(orderRaw)
      : Number.MIN_SAFE_INTEGER;

  const timeoutRaw = o.timeoutMillisecond ?? o.timeout;
  const timeoutMillisecond =
    typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw)
      ? Math.floor(timeoutRaw)
      : 3000;

  return {
    id,
    name: typeof o.name === "string" ? o.name : "",
    group: asOptionalString(o.group),
    pattern,
    replacement: typeof o.replacement === "string" ? o.replacement : "",
    scope: asOptionalString(o.scope),
    scopeTitle: asBool(o.scopeTitle, false),
    scopeContent: asBool(o.scopeContent, true),
    excludeScope: asOptionalString(o.excludeScope),
    isEnabled: asBool(o.isEnabled, true),
    isRegex: asBool(o.isRegex, true),
    timeoutMillisecond,
    order,
  };
}

/** 解析 Legado / 彩读替换净化 JSON（单条、数组、或 `{ replaceRules: [] }`） */
export function parseReplaceRuleJson(text: string): ReplaceRule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  let list: unknown[] = [];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.replaceRules)) list = o.replaceRules;
    else if (o.pattern != null || o.name != null) list = [parsed];
  }
  const out: ReplaceRule[] = [];
  const seen = new Set<number>();
  let i = 0;
  for (const item of list) {
    const rule = normalizeReplaceRule(item, Date.now() + i);
    i += 1;
    if (!rule || !rule.pattern.trim()) continue;
    let id = rule.id;
    while (seen.has(id)) id += 1;
    seen.add(id);
    out.push({ ...rule, id });
  }
  return out;
}
