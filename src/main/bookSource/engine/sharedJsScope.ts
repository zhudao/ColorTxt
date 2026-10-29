import { createHash } from "node:crypto";
import vm from "node:vm";
import type { BookSourceRecord } from "@shared/bookSource/types";
import type { JsExtensionHost } from "./jsExtensions";
import {
  fixRhinoBareArrayArrowParams,
  fixRhinoLetExpressions,
  fixRhinoParamLetRedeclarations,
  LEGADO_FOREACH_SERIAL_NAME,
  prepareJsLibAsyncBody,
} from "./legadoAsyncJs";
import {
  wrapLegadoBookForJs,
  wrapLegadoChapterForJs,
  type LegadoVariableSync,
} from "./legadoRuleEntity";
import { createJavaImporter, createOrgPackage, createPackagesStub } from "./legadoJavaShims";
import { isJsoupElementLike } from "./legadoJsoupShim";
import { ensureLegadoListApi } from "./legadoJsList";
import { parseLegadoLenientJson } from "./legadoLooseJson";
import {
  BOOK_SOURCE_JS_TIMEOUT_MS,
  raceWithJsTimeout,
  toBookSourceJsTimeoutError,
} from "./bookSourceJsTimeout";

type SharedScopeEntry = {
  sandbox: Record<string, unknown>;
  asyncFunctionNames: string[];
};

const scopeCache = new Map<string, SharedScopeEntry>();

/** java.lang.String 等 shim / jsLib 异步预处理变更时递增，避免沿用过期 sandbox */
const JS_LIB_SHIM_VERSION = "17";

/**
 * 串行 forEach：对齐 Rhino 同步阻塞；供 rewriteAsyncForEachSerial 注入调用。
 */
export async function legadoForEachSerial(
  list: unknown,
  callback: (item: unknown, index: number, array: unknown[]) => unknown,
  thisArg?: unknown,
): Promise<void> {
  const arr = Array.isArray(list)
    ? list
    : list == null
      ? []
      : [list];
  for (let i = 0; i < arr.length; i++) {
    await callback.call(thisArg, arr[i], i, arr);
  }
}

/**
 * Legado/Jayway：JsonPath 中间结果多为 JSONArray/JSONObject，`String(result)` 仍是合法 JSON，
 * 故书源常写 `JSON.parse(result)`。Node 对普通 object/array 的 String 是 `[object Object]`，会报错。
 * 已是对象时直接返回（对齐该兼容写法）；数组再挂串行 async map（见 ensureLegadoListApi）。
 */
export function createLegadoJson(): JSON {
  return {
    parse(text: unknown, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
      if (text != null && typeof text === "object") {
        const obj = Array.isArray(text) ? ensureLegadoListApi(text) : text;
        return reviver ? JSON.parse(JSON.stringify(obj), reviver) : obj;
      }
      const parsed = parseLegadoLenientJson(String(text));
      const out = Array.isArray(parsed) ? ensureLegadoListApi(parsed) : parsed;
      return reviver ? JSON.parse(JSON.stringify(out), reviver) : out;
    },
    stringify: JSON.stringify.bind(JSON),
  } as JSON;
}

/** 嵌套 eval（如 await java.ajax 触发 header @js）会覆盖同沙箱绑定，须进出成对恢复 */
const SANDBOX_EVAL_BINDINGS = [
  "result",
  "src",
  "$",
  "java",
  "book",
  "chapter",
  "baseUrl",
  "key",
  "page",
] as const;

/** 跨 await 后，嵌套 eval 出的函数（如 objParse 还原的 util.login）可能改向宿主 globalThis 查自由变量 */
const HOST_MIRROR_BINDINGS = ["java", "source", "cookie", "cache"] as const;

const hostMirrorDepth = new Map<string, number>();
const hostMirrorSaved = new Map<string, unknown>();

function pushHostMirrorBindings(sandbox: Record<string, unknown>): void {
  for (const key of HOST_MIRROR_BINDINGS) {
    const depth = hostMirrorDepth.get(key) ?? 0;
    if (depth === 0) {
      hostMirrorSaved.set(
        key,
        Object.prototype.hasOwnProperty.call(globalThis, key)
          ? (globalThis as Record<string, unknown>)[key]
          : undefined,
      );
    }
    hostMirrorDepth.set(key, depth + 1);
    (globalThis as Record<string, unknown>)[key] = sandbox[key];
  }
}

function popHostMirrorBindings(): void {
  for (const key of HOST_MIRROR_BINDINGS) {
    const depth = hostMirrorDepth.get(key) ?? 0;
    if (depth <= 1) {
      hostMirrorDepth.delete(key);
      if (hostMirrorSaved.has(key)) {
        const saved = hostMirrorSaved.get(key);
        hostMirrorSaved.delete(key);
        if (saved === undefined) {
          delete (globalThis as Record<string, unknown>)[key];
        } else {
          (globalThis as Record<string, unknown>)[key] = saved;
        }
      }
    } else {
      hostMirrorDepth.set(key, depth - 1);
    }
  }
}

const SANDBOX_RESERVED = new Set([
  "globalThis",
  "javaImport",
  "JavaImporter",
  "Packages",
  "org",
  LEGADO_FOREACH_SERIAL_NAME,
]);

function jsLibCacheKey(jsLib: string): string {
  return createHash("md5")
    .update(jsLib)
    .update(JS_LIB_SHIM_VERSION)
    .digest("hex");
}

/**
 * Rhino/E4X 残留：`obj..prop`（Legado 可解析，Node 为 SyntaxError）。
 * 仅改代码中的标识符连写；字符串内 JSONPath `$..` / `..major` 等保持不动。
 */
export function fixRhinoDoubleDotPropertyAccess(script: string): string {
  const held: string[] = [];
  const masked = script.replace(
    /`(?:\\[\s\S]|\$\{(?:[^{}]|\{[^}]*\})*\}|[^`\\$]|\$(?!\{))*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,
    (m) => {
      held.push(m);
      return `\0STR${held.length - 1}\0`;
    },
  );
  let fixed = masked;
  let prev = "";
  while (fixed !== prev) {
    prev = fixed;
    fixed = fixed.replace(
      /([A-Za-z_$][\w$]*)\.\.([A-Za-z_$][\w$]*)/g,
      "$1.$2",
    );
  }
  return fixed.replace(/\0STR(\d+)\0/g, (_, n) => held[Number(n)]!);
}

function prepareJsLib(script: string): {
  code: string;
  asyncFunctionNames: string[];
} {
  const normalized = fixRhinoParamLetRedeclarations(
    fixRhinoLetExpressions(
      fixRhinoDoubleDotPropertyAccess(
        fixRhinoBareArrayArrowParams(script.trim()),
      ),
    ),
  );
  return prepareJsLibAsyncBody(normalized);
}

function promoteJsLibGlobals(
  sandbox: Record<string, unknown>,
  builtinKeys: ReadonlySet<string>,
): void {
  const javaImport = sandbox.javaImport;
  if (javaImport && typeof javaImport === "object") {
    for (const [key, value] of Object.entries(javaImport)) {
      if (key === "importPackage" || typeof value !== "function") continue;
      sandbox[key] = value;
    }
  }
  // 对齐 Legado 共享 Scriptable：仅 bind jsLib 定义的函数（勿 bind Array/String 等内建构造器，
  // 否则 Array.isArray 等静态方法丢失 → TypeError: Array.isArray is not a function）。
  for (const [key, value] of Object.entries(sandbox)) {
    if (builtinKeys.has(key) || SANDBOX_RESERVED.has(key)) continue;
    if (typeof value !== "function") continue;
    sandbox[key] = (value as (...args: unknown[]) => unknown).bind(sandbox);
  }
}

function createSandboxShell(log: (msg: string) => void): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {
    String,
    Number,
    Boolean,
    Array,
    Object,
    JSON: createLegadoJson(),
    Math,
    Date,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    Packages: createPackagesStub(),
    org: createOrgPackage(),
    JavaImporter: function JavaImporter() {
      return createJavaImporter(log);
    },
    [LEGADO_FOREACH_SERIAL_NAME]: legadoForEachSerial,
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadSharedJsLib(jsLib: string, log: (msg: string) => void): SharedScopeEntry {
  const key = jsLibCacheKey(jsLib);
  const cached = scopeCache.get(key);
  if (cached) return cached;

  const sandbox = createSandboxShell(log);
  const builtinKeys = new Set(Object.keys(sandbox));
  vm.createContext(sandbox);
  let asyncFunctionNames: string[] = [];
  try {
    const prepared = prepareJsLib(jsLib);
    asyncFunctionNames = prepared.asyncFunctionNames;
    vm.runInContext(prepared.code, sandbox, {
      timeout: BOOK_SOURCE_JS_TIMEOUT_MS,
    });
    promoteJsLibGlobals(sandbox, builtinKeys);
  } catch (e) {
    const err = toBookSourceJsTimeoutError(e);
    log(`jsLib 加载失败: ${err.message}`);
    // 失败勿入缓存，否则修预处理后同进程仍命中空沙箱（check_token 等缺失）
    return { sandbox, asyncFunctionNames: [] };
  }
  const entry = { sandbox, asyncFunctionNames };
  scopeCache.set(key, entry);
  return entry;
}

export function clearSharedJsLibCache(jsLib?: string | null): void {
  if (!jsLib?.trim()) {
    scopeCache.clear();
    return;
  }
  scopeCache.delete(jsLibCacheKey(jsLib.trim()));
}

/** 当前已加载 jsLib 中的 async 函数名（供规则脚本注入 await） */
export function getJsLibAsyncFunctionNames(
  jsLib: string | null | undefined,
): string[] {
  const text = jsLib?.trim();
  if (!text) return [];
  return scopeCache.get(jsLibCacheKey(text))?.asyncFunctionNames ?? [];
}

type RunScopeBindings = {
  java: Record<string, unknown>;
  source: Record<string, unknown>;
  book: Record<string, unknown> | null;
  chapter: Record<string, unknown> | null;
  result: unknown;
  /** 与 result 同步的别名（`$.field` 误当 JS 时） */
  $: unknown;
  baseUrl: string;
  key: string;
  page: number;
  cookie: Record<string, unknown>;
  cache: Record<string, unknown>;
  src: unknown;
};

function wrapLegadoMapLike(data: Record<string, string>): Record<string, unknown> & {
  get(key: string): string;
} {
  return {
    ...data,
    get(key: string) {
      return data[key] ?? "";
    },
  };
}

function coerceLegadoMap(value: unknown): Record<string, unknown> & {
  get(key: string): string;
} {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown> & { get?: unknown };
    if (typeof obj.get === "function") {
      return obj as Record<string, unknown> & { get(key: string): string };
    }
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "get") continue;
      data[k] = String(v ?? "");
    }
    return wrapLegadoMapLike(data);
  }
  return wrapLegadoMapLike({});
}

/** 规则 JS 的 result：字符串/数字等原样传入；扁平 string map 才包装；嵌套 JSON 保持结构供 JSONPath */
function coerceLegadoResult(value: unknown): unknown {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  // 保持 Array.isArray + .map/.filter；仅挂 toArray（勿换成无 map 的 plain object）
  if (Array.isArray(value)) return ensureLegadoListApi(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Jsoup Element：须保留 .outerHtml/.attr/.select（目录 isVip 等 `@js:result.outerHtml()`）
    // 若走下方 coerceLegadoMap，方法会被 String(fn) 成字符串 → outerHtml is not a function
    if (isJsoupElementLike(value)) return value;
    // 已有 .get 的 Map 风格对象原样返回
    if (typeof obj.get === "function") return value;
    // Legado StrResponse / Connection：body()/url()/raw() 为方法，不可当扁平 map 包掉
    // （否则 loginCheckJs 的 result.body() 变成 TypeError: result.body is not a function）
    if (
      typeof obj.body === "function" &&
      (typeof obj.url === "function" || typeof obj.raw === "function")
    ) {
      return value;
    }
    // API JSON（含嵌套 object/array）不可 stringify，否则 init 后 JSONPath 全失效
    const nested = Object.entries(obj).some(([k, v]) => {
      if (k === "get") return false;
      return v != null && typeof v === "object";
    });
    if (nested) return value;
    return coerceLegadoMap(value);
  }
  return value;
}

function applyBindings(
  sandbox: Record<string, unknown>,
  bindings: Partial<RunScopeBindings>,
): void {
  for (const [key, value] of Object.entries(bindings)) {
    if (value !== undefined) {
      sandbox[key] = value;
    }
  }
  // result 更新时保持 $ 别名（嵌套 ajax 恢复绑定后也一致）
  if (Object.prototype.hasOwnProperty.call(bindings, "result")) {
    sandbox.$ = bindings.result;
  }
  sandbox.globalThis = sandbox;
}

/** 绑定已在 sandbox 上；勿用形参注入，避免与书源内 `let baseUrl` 等声明冲突（Legado/Rhino 作用域行为） */
function wrapAsyncScriptWithBindings(script: string): string {
  const trimmed = script.trim();
  if (/^\(async\s*\(\)\s*=>\s*\{[\s\S]*\}\)\(\)$/.test(trimmed)) {
    return trimmed;
  }
  return `(async () => {
${trimmed}
})()`;
}

function buildBindings(
  host: JsExtensionHost,
  ctx: {
    book?: Record<string, unknown> | null;
    chapter?: Record<string, unknown> | null;
    result?: unknown;
    src?: unknown;
    baseUrl?: string;
    key?: string;
    page?: number;
    java?: Record<string, unknown>;
    bookVariableSync?: LegadoVariableSync;
    chapterVariableSync?: LegadoVariableSync;
  },
): Partial<RunScopeBindings> {
  const book =
    ctx.book === null ? null : wrapLegadoBookForJs(ctx.book, ctx.bookVariableSync);
  const chapter =
    ctx.chapter === null
      ? null
      : wrapLegadoChapterForJs(ctx.chapter, ctx.chapterVariableSync);
  const result = coerceLegadoResult(ctx.result);
  const src = ctx.src !== undefined ? coerceLegadoResult(ctx.src) : result;
  return {
    java: ctx.java ?? host.javaBindings,
    source: host.sourceWrapper,
    book,
    chapter,
    result,
    /** 与 result 同步：误把 `$.field` 当 JS 时仍能取到列表项字段 */
    $: result,
    baseUrl: ctx.baseUrl ?? "",
    key: ctx.key ?? "",
    page: ctx.page ?? 1,
    cookie: host.cookieBindings,
    cache: host.cacheBindings,
    src,
  };
}

function pickScopeResult(current: unknown, initial: unknown, runResult: unknown): unknown {
  if (runResult !== undefined) return runResult;
  if (current !== initial) return current;
  return runResult;
}

function snapshotSandboxEvalBindings(
  sandbox: Record<string, unknown>,
): Record<string, unknown> {
  const saved: Record<string, unknown> = {};
  for (const key of SANDBOX_EVAL_BINDINGS) {
    saved[key] = sandbox[key];
  }
  return saved;
}

function restoreSandboxEvalBindings(
  sandbox: Record<string, unknown>,
  saved: Record<string, unknown>,
): void {
  for (const key of SANDBOX_EVAL_BINDINGS) {
    if (Object.prototype.hasOwnProperty.call(saved, key)) {
      sandbox[key] = saved[key];
    }
  }
}

export function runInBookSourceJsScope(
  source: BookSourceRecord,
  host: JsExtensionHost,
  script: string,
  ctx: {
    book?: Record<string, unknown> | null;
    chapter?: Record<string, unknown> | null;
    result?: unknown;
    src?: unknown;
    baseUrl?: string;
    key?: string;
    page?: number;
    java?: Record<string, unknown>;
    bookVariableSync?: LegadoVariableSync;
    chapterVariableSync?: LegadoVariableSync;
  },
  options: { async?: boolean } = {},
): unknown {
  const jsLib = source.jsLib?.trim();
  const bindings = buildBindings(host, ctx);
  const sandbox = jsLib
    ? loadSharedJsLib(jsLib, (msg) => host.log(msg)).sandbox
    : createSandboxShell((msg) => host.log(msg));

  if (!jsLib) vm.createContext(sandbox);
  // 共享 jsLib 沙箱可重入：await java.ajax 内再跑 header/@js/loginCheckJs 会改 result
  const savedBindings = snapshotSandboxEvalBindings(sandbox);
  applyBindings(sandbox, bindings);
  // Node vm：嵌套 eval 出的 async 函数在 await 之后，自由变量 `java` 可能读到 undefined。
  // 用 getter 兜底到 host.javaBindings，避免 util.login 等还原函数在登录窗返回后崩溃。
  const javaCell: { current: unknown } = {
    current: bindings.java ?? host.javaBindings,
  };
  Object.defineProperty(sandbox, "java", {
    configurable: true,
    enumerable: true,
    get() {
      return javaCell.current ?? host.javaBindings;
    },
    set(v: unknown) {
      javaCell.current = v;
    },
  });
  pushHostMirrorBindings(sandbox);

  const runScript = options.async ? wrapAsyncScriptWithBindings(script) : script;
  const initialResult = sandbox.result;

  const finish = (value: unknown): unknown => {
    restoreSandboxEvalBindings(sandbox, savedBindings);
    popHostMirrorBindings();
    return value;
  };

  try {
    const runResult = vm.runInContext(runScript, sandbox, {
      timeout: BOOK_SOURCE_JS_TIMEOUT_MS,
    });
    if (options.async) {
      return raceWithJsTimeout(
        Promise.resolve(runResult as Promise<unknown>)
          .then((v) => pickScopeResult(sandbox.result, initialResult, v))
          .then(finish, (err) => {
            restoreSandboxEvalBindings(sandbox, savedBindings);
            popHostMirrorBindings();
            throw err;
          }),
      );
    }
    return finish(pickScopeResult(sandbox.result, initialResult, runResult));
  } catch (e) {
    restoreSandboxEvalBindings(sandbox, savedBindings);
    popHostMirrorBindings();
    throw toBookSourceJsTimeoutError(e);
  }
}

export function ensureBookSourceJsLib(
  source: BookSourceRecord,
  host: JsExtensionHost,
): void {
  const jsLib = source.jsLib?.trim();
  if (!jsLib) return;
  loadSharedJsLib(jsLib, (msg) => host.log(msg));
}
