export type LoginUiRow = {
  name: string;
  type: "text" | "password" | "button" | "toggle" | "select" | string;
  action?: string;
  /** toggle/select 的候选值（含尾随空格，如 `"🚫 "`） */
  chars?: string[];
  /** toggle/select 初始值 / text 默认值 */
  default?: string;
  style?: Record<string, unknown>;
};

/** 从 @js: / <js>…</js> 包裹的 loginUi 中取出可执行 JS，纯 JSON 返回 null */
export function extractLoginUiJs(raw: string): string | null {
  const s = raw.trim();
  if (/^@js:/i.test(s)) return s.replace(/^@js:/i, "");
  if (/^<js>/i.test(s)) {
    const end = s.lastIndexOf("<");
    return end > 4 ? s.slice(4, end) : s.slice(4);
  }
  return null;
}

/** 解析书源 loginUi（部分源使用 JS 对象字面量而非严格 JSON） */
export function parseLoginUi(raw?: string | LoginUiRow[] | null): LoginUiRow[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  const s = raw.trim();
  if (!s) return [];
  // @js:/<js> 需主进程执行后才能得到行，静态解析拿不到（返回空由调用方回退到 IPC）
  if (extractLoginUiJs(s) != null) return [];
  try {
    const parsed = JSON.parse(s) as LoginUiRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    try {
      const normalized = s.replace(
        /(\{|,)\s*([a-zA-Z_][\w]*)\s*:/g,
        '$1"$2":',
      );
      const parsed = JSON.parse(normalized) as LoginUiRow[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

/** loginUi 是否含 @js:/<js>（需异步经主进程求值才能得到行） */
export function loginUiNeedsEval(raw?: string | null): boolean {
  return typeof raw === "string" && extractLoginUiJs(raw) != null;
}

export function collectLoginFormData(
  rows: LoginUiRow[],
  form: Record<string, string>,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const row of rows) {
    if (row.type === "text" || row.type === "password") {
      data[row.name] = form[row.name] ?? "";
    }
  }
  return data;
}
