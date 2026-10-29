import vm from "node:vm";
import type { BookSourceRecord } from "@shared/bookSource/types";
import type { JsExtensionHost } from "./jsExtensions";
import {
  LEGADO_FOREACH_SERIAL_NAME,
  collectLoginCheckJsAsyncNames,
  inlineBookSourceCommentEvals,
  prepareLegadoAsyncJs,
  prepareLegadoJs,
} from "./legadoAsyncJs";
import {
  wrapLegadoBookForJs,
  wrapLegadoChapterForJs,
  type LegadoVariableSync,
} from "./legadoRuleEntity";
import { createJavaImporter, createOrgPackage, createPackagesStub } from "./legadoJavaShims";
import { ensureLegadoListApi } from "./legadoJsList";
import {
  createLegadoJson,
  ensureBookSourceJsLib,
  getJsLibAsyncFunctionNames,
  legadoForEachSerial,
  runInBookSourceJsScope,
} from "./sharedJsScope";
import {
  BOOK_SOURCE_JS_TIMEOUT_MS,
  raceWithJsTimeout,
  runWithJsEvalDeadline,
  runWithJsEvalDeadlineAsync,
  toBookSourceJsTimeoutError,
} from "./bookSourceJsTimeout";
import { runWithBookSourceJsHost, runWithBookSourceJsHostAsync } from "./bookSourceJsContext";

export type JsEvalContext = {
  source?: BookSourceRecord;
  /** 显式 null：绑定为 falsy（对齐 Legado 源登录无 book 时 `if(book)` 为假） */
  book?: Record<string, unknown> | null;
  chapter?: Record<string, unknown> | null;
  result?: unknown;
  /** Legado evalJS：src 为规则页正文，result 为链式上一段输出 */
  src?: unknown;
  baseUrl?: string;
  key?: string;
  page?: number;
  host: JsExtensionHost;
  /** 规则 JS 中 java 绑定（AnalyzeRule / AnalyzeUrl），缺省用 host.javaBindings */
  java?: Record<string, unknown>;
  bookVariableSync?: LegadoVariableSync;
  chapterVariableSync?: LegadoVariableSync;
};

function buildVmSandbox(
  java: Record<string, unknown>,
  ctx: Omit<JsEvalContext, "host"> & { host: JsExtensionHost },
): Record<string, unknown> {
  const host = ctx.host;
  const book =
    ctx.book === null ? null : wrapLegadoBookForJs(ctx.book, ctx.bookVariableSync);
  const chapter =
    ctx.chapter === null
      ? null
      : wrapLegadoChapterForJs(ctx.chapter, ctx.chapterVariableSync);
  const result = ensureLegadoListApi(ctx.result ?? "");
  const src = ensureLegadoListApi(
    ctx.src !== undefined ? ctx.src : result,
  );
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
    java,
    source: host.sourceWrapper,
    book,
    chapter,
    result,
    /** Legado 模板/脚本里 `$` 常指当前 result（JSON 项上 `$.book_id` 作 JS 属性访问） */
    $: result,
    baseUrl: ctx.baseUrl ?? "",
    key: ctx.key ?? "",
    page: ctx.page ?? 1,
    cookie: host.cookieBindings,
    cache: host.cacheBindings,
    src,
    [LEGADO_FOREACH_SERIAL_NAME]: legadoForEachSerial,
    JavaImporter: function JavaImporter() {
      return createJavaImporter((msg) => host.log(msg));
    },
    Packages: createPackagesStub(),
    org: createOrgPackage(),
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function shouldUseBookSourceJsScope(
  source: BookSourceRecord | undefined,
  useSharedJsScope?: boolean,
): boolean {
  if (useSharedJsScope === false) return false;
  return Boolean(source);
}

function runVmScript(code: string, sandbox: Record<string, unknown>): unknown {
  vm.createContext(sandbox);
  try {
    return vm.runInContext(code, sandbox, {
      timeout: BOOK_SOURCE_JS_TIMEOUT_MS,
    });
  } catch (e) {
    throw toBookSourceJsTimeoutError(e);
  }
}

/** `.map(async () => …)` / 含 await 的回调会得到 Promise[]；对齐 Legado 同步 map 串行结算 */
async function settleLegadoJsResult(value: unknown): Promise<unknown> {
  if (!Array.isArray(value) || value.length === 0) return value;
  const hasThenable = value.some(
    (v) =>
      v != null &&
      (typeof v === "object" || typeof v === "function") &&
      typeof (v as { then?: unknown }).then === "function",
  );
  if (!hasThenable) return value;
  // 勿 Promise.all：回调若已启动则无法撤销并行；串行 await 至少保证结算顺序
  const out: unknown[] = [];
  for (const v of value) {
    out.push(await v);
  }
  return out;
}

export function evalJs(
  script: string,
  ctx: Omit<JsEvalContext, "host"> & { host?: JsExtensionHost },
  options: { useSharedJsScope?: boolean; throwOnError?: boolean } = {},
): unknown {
  const host = ctx.host;
  if (!host) return "";
  try {
    return runWithBookSourceJsHost(host, () =>
      runWithJsEvalDeadline(() => {
      const inlined = inlineBookSourceCommentEvals(
        script,
        ctx.source?.bookSourceComment,
      );
      const body = prepareLegadoJs(inlined);
      const code = `(function(){\n${body}\n})()`;
      if (shouldUseBookSourceJsScope(ctx.source, options.useSharedJsScope)) {
        return runInBookSourceJsScope(ctx.source!, host, code, ctx);
      }
      const sandbox = buildVmSandbox(ctx.java ?? host.javaBindings, {
        ...ctx,
        host,
      });
      return runVmScript(code, sandbox);
    }),
    );
  } catch (e) {
    const err = toBookSourceJsTimeoutError(e);
    host.log(`JS 错误: ${err.message}`);
    if (options.throwOnError) throw err;
    return "";
  }
}

/** 支持 java.startBrowserAwait / java.ajax 等异步 Legado API（自动插入 await） */
export async function evalJsAsync(
  script: string,
  ctx: Omit<JsEvalContext, "host"> & { host?: JsExtensionHost },
  options: { legadoAsync?: boolean; useSharedJsScope?: boolean } = {},
): Promise<unknown> {
  const host = ctx.host;
  if (!host) return "";
  const legadoAsync = options.legadoAsync !== false;
  try {
    return await runWithBookSourceJsHostAsync(host, () =>
      runWithJsEvalDeadlineAsync(async () => {
      const inlined = inlineBookSourceCommentEvals(
        script,
        ctx.source?.bookSourceComment,
      );

      if (shouldUseBookSourceJsScope(ctx.source, options.useSharedJsScope)) {
        // 先加载 jsLib，以便把其中的 async 函数名并入 await 注入
        ensureBookSourceJsLib(ctx.source!, host);
        const jsLibAsyncNames = getJsLibAsyncFunctionNames(ctx.source?.jsLib);
        // loginCheckJs 里 objStringify 后经 java.put 传递的 util.* async 方法也须按名 await
        const asyncNames = [
          ...new Set([
            ...jsLibAsyncNames,
            ...collectLoginCheckJsAsyncNames(
              ctx.source?.loginCheckJs,
              jsLibAsyncNames,
            ),
          ]),
        ];
        const body = legadoAsync
          ? prepareLegadoAsyncJs(inlined, asyncNames)
          : prepareLegadoJs(inlined);
        const code = legadoAsync ? body : `(function(){\n${body}\n})()`;
        const result = runInBookSourceJsScope(ctx.source!, host, code, ctx, {
          async: legadoAsync,
        });
        if (!legadoAsync) return result;
        // sharedJsScope 异步路径已内嵌 raceWithJsTimeout
        return await settleLegadoJsResult(await (result as Promise<unknown>));
      }

      const body = legadoAsync
        ? prepareLegadoAsyncJs(inlined)
        : prepareLegadoJs(inlined);
      const sandbox = buildVmSandbox(ctx.java ?? host.javaBindings, {
        ...ctx,
        host,
      });
      // prepareLegadoAsyncJs 已是 (async () => { ... })()；同步则包 IIFE
      const code = legadoAsync ? body : `(function(){\n${body}\n})()`;
      const runResult = runVmScript(code, sandbox);
      if (!legadoAsync) return runResult;
      return await settleLegadoJsResult(
        await raceWithJsTimeout(Promise.resolve(runResult as Promise<unknown>)),
      );
    }),
    );
  } catch (e) {
    const err = toBookSourceJsTimeoutError(e);
    host.log(`JS 错误: ${err.message}`);
    throw err;
  }
}

export function evalJsExpression(
  script: string,
  ctx: JsEvalContext,
): unknown {
  const trimmed = script.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<js>") || trimmed.includes("</js>")) {
    const inner = trimmed
      .replace(/^<js>/, "")
      .replace(/<\/js>$/, "")
      .trim();
    return evalJs(inner, ctx);
  }
  if (trimmed.startsWith("@js:") || trimmed.startsWith("@js:\n")) {
    return evalJs(trimmed.replace(/^@js:\n?/, ""), ctx);
  }
  // 交给 prepareLegadoJs 统一补 return，避免 return (return (...)) 双重包装
  return evalJs(trimmed, ctx);
}
