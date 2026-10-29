import {
  getBookCustomVariable,
  setBookCustomVariable,
} from "../store/bookSourceStore";

export type LegadoVariableSync = {
  putVariable(key: string, value: string): void;
  getVariable(key: string): string;
};

function normalizeVariable(raw: unknown): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (k === "get" || typeof v === "function") continue;
      out[k] = String(v ?? "");
    }
    // 误把 { url: bookUrl } 当 variable map
    const keys = Object.keys(out);
    if (keys.length === 1 && keys[0] === "url") return {};
    return out;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return normalizeVariable(JSON.parse(raw) as unknown);
    } catch {
      // 自由文本（如部分书源累加正文），不是 JSON map
      return {};
    }
  }
  return {};
}

/** Legado `Book.variable` / `Chapter.variable` 是 String?，不是 Map 对象 */
function initialVariableString(
  raw: unknown,
  map: Record<string, string>,
): string {
  if (typeof raw === "string") return raw;
  if (Object.keys(map).length) {
    try {
      return JSON.stringify(map);
    } catch {
      return "";
    }
  }
  return "";
}

function attachVariableMethods(
  target: Record<string, unknown>,
  variable: Record<string, string>,
  sync?: LegadoVariableSync,
): Record<string, unknown> {
  // 对齐 Legado：variable 字段为字符串（可自由 `+=` 正文，也可存 map 的 JSON）
  let variableStr = initialVariableString(target.variable, variable);
  target.variable = variableStr;

  const persistVariableStr = () => {
    target.variable = variableStr;
    sync?.putVariable("custom", variableStr);
  };

  const persistMapAsJson = () => {
    try {
      variableStr = JSON.stringify(variable);
    } catch {
      variableStr = "";
    }
    persistVariableStr();
  };

  const api: Record<string, unknown> = {
    ...target,
    get(key: string): string {
      if (key === "bookName") return String(target.name ?? "");
      if (key === "title") return String(target.title ?? "");
      if (key in variable) return variable[key] ?? "";
      const direct = target[key];
      return direct == null ? "" : String(direct);
    },
    getVariable(key?: string): string {
      if (key == null || key === "") {
        return variable.custom ?? "";
      }
      if (key === "custom") return variable.custom ?? "";
      const fromVar = variable[key];
      if (fromVar) return fromVar;
      return sync?.getVariable(key) ?? "";
    },
    putVariable(key: string, value?: unknown): string {
      const s = String(value ?? "");
      variable[key] = s;
      persistMapAsJson();
      sync?.putVariable(key, s);
      return s;
    },
    putCustomVariable(value: unknown): string {
      const s = String(value ?? "");
      variable.custom = s;
      persistMapAsJson();
      sync?.putVariable("custom", s);
      return s;
    },
  };

  Object.defineProperty(api, "variable", {
    configurable: true,
    enumerable: true,
    get() {
      return variableStr;
    },
    set(v: unknown) {
      // `book.variable=""` / `book.variable+=html`：按字符串字段写回（部分书源等）
      variableStr = v == null ? "" : String(v);
      if (variableStr.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(variableStr) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const k of Object.keys(variable)) delete variable[k];
            for (const [k, val] of Object.entries(
              parsed as Record<string, unknown>,
            )) {
              if (k === "get" || typeof val === "function") continue;
              variable[k] = String(val ?? "");
            }
          }
        } catch {
          /* 自由文本，保留 variableStr */
        }
      }
      persistVariableStr();
    },
  });

  return api;
}

function alreadyHasVariableStringAccessor(
  base: Record<string, unknown>,
): boolean {
  const desc = Object.getOwnPropertyDescriptor(base, "variable");
  return Boolean(desc && typeof desc.get === "function" && typeof desc.set === "function");
}

/** 供 AnalyzeRule.setBook：Legado Book.variable 可为累加正文的字符串 */
export function createBookVariableSync(bookUrl: string): LegadoVariableSync {
  const url = bookUrl.trim();
  return {
    putVariable: (_key: string, value: string) => {
      if (url) setBookCustomVariable(url, value);
    },
    getVariable: (_key: string) => (url ? getBookCustomVariable(url) : ""),
  };
}

export function wrapLegadoBookForJs(
  book: Record<string, unknown> | undefined | null,
  sync?: LegadoVariableSync,
): Record<string, unknown> {
  if (!book || typeof book !== "object" || Array.isArray(book)) {
    const empty: Record<string, unknown> = { variable: "" };
    return attachVariableMethods(empty, {}, sync);
  }
  const base = book as Record<string, unknown> & {
    get?: unknown;
    putVariable?: unknown;
    putCustomVariable?: unknown;
    getVariable?: unknown;
  };
  if (
    typeof base.putCustomVariable === "function" &&
    typeof base.putVariable === "function" &&
    typeof base.getVariable === "function" &&
    alreadyHasVariableStringAccessor(base)
  ) {
    return base;
  }
  const variable = normalizeVariable(base.variable);
  return attachVariableMethods(base, variable, sync);
}

export function wrapLegadoChapterForJs(
  chapter: Record<string, unknown> | undefined | null,
  sync?: LegadoVariableSync,
): Record<string, unknown> {
  if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) {
    const empty: Record<string, unknown> = { variable: "" };
    return attachVariableMethods(empty, {}, sync);
  }
  const base = chapter as Record<string, unknown> & {
    putVariable?: unknown;
    getVariable?: unknown;
  };
  if (
    typeof base.putVariable === "function" &&
    typeof base.getVariable === "function" &&
    alreadyHasVariableStringAccessor(base)
  ) {
    return base;
  }
  const variable = normalizeVariable(base.variable);
  return attachVariableMethods(base, variable, sync);
}
