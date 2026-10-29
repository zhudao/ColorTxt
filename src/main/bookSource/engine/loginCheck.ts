import { shell } from "electron";
import * as cheerio from "cheerio";
import type { BookSourceRecord } from "@shared/bookSource/types";
import type { AnalyzeUrl, StrResponse } from "./analyzeUrl";
import {
  fromLegadoCheckResult,
  toLegadoStrResponse,
  toLegadoConnectionResponse,
} from "./legadoStrResponse";
import {
  createJsExtensionHost,
  wrapLegadoMapLike,
  type JsExtensionHost,
} from "./jsExtensions";
import {
  getVerificationResult,
  isVerificationCancelled,
  resolveLoginPageUrl,
  VerificationCancelledError,
} from "./sourceVerification";
import {
  clearLoginSessionAck,
  getLoginHeader,
  getLoginInfo,
  getLoginSessionAck,
  putLoginHeader,
  removeLoginHeader,
  setLoginInfo,
} from "../store/bookSourceStore";
import { evalJs, evalJsAsync } from "./rhinoRuntime";
import {
  extractLoginUiJs,
  parseLoginUi,
  type LoginUiRow,
} from "@shared/bookSource/loginUi";
import { queryLegadoSelectorSegment } from "./legadoDefaultRule";

function buildLoginJava(
  analyzeUrl: AnalyzeUrl,
  host: JsExtensionHost,
  source: BookSourceRecord,
): Record<string, unknown> {
  const base = { ...host.javaBindings };
  return {
    ...base,
    // 与 AnalyzeUrl 同步：initUrl() 后须读到新 ruleUrl/url（勿快照）
    get ruleUrl() {
      return analyzeUrl.ruleUrl;
    },
    get url() {
      return analyzeUrl.url;
    },
    initUrl: () => {
      analyzeUrl.initUrl();
      return analyzeUrl;
    },
    getHeaderMap: () => ({ ...analyzeUrl.headerMap }),
    getStrResponse: async () => {
      const res = await analyzeUrl.getStrResponse();
      return toLegadoStrResponse(res, { statusCode: res.statusCode });
    },
    getResponse: async () => {
      const res = await analyzeUrl.getStrResponse();
      return toLegadoConnectionResponse(res, { statusCode: res.statusCode });
    },
    startBrowser: (url: string, title: string) => {
      void getVerificationResult(source.bookSourceUrl, url, title, {
        refetchAfterSuccess: false,
        source,
        host,
      }).catch(() => undefined);
    },
    startBrowserAwait: async (
      url: string,
      title: string,
      refetchAfterSuccess = false,
    ) => {
      try {
        const body = await getVerificationResult(source.bookSourceUrl, url, title, {
          refetchAfterSuccess: refetchAfterSuccess === true,
          source,
          host,
        });
        return toLegadoStrResponse({ url, body, headers: {} });
      } catch (e) {
        if (isVerificationCancelled(e)) {
          return toLegadoStrResponse(
            { url, body: "", headers: {} },
            { statusCode: 0, message: "cancelled" },
          );
        }
        throw e;
      }
    },
    putLoginHeader: (headerJson: string) => {
      putLoginHeader(source.bookSourceUrl, headerJson);
    },
    getLoginHeader: () => getLoginHeader(source.bookSourceUrl),
  };
}

export async function runLoginCheckJs(
  analyzeUrl: AnalyzeUrl,
  source: BookSourceRecord,
  res: StrResponse,
  key: string,
  logs: string[],
): Promise<StrResponse> {
  const raw = source.loginCheckJs?.trim();
  if (!raw) return res;

  const host = createJsExtensionHost(source, logs);
  const legadoResult = toLegadoStrResponse(res);
  const java = buildLoginJava(analyzeUrl, host, source);

  try {
    const checked = await evalJsAsync(
      raw,
      {
        source,
        host,
        java,
        key,
        page: 1,
        result: legadoResult,
        baseUrl: source.bookSourceUrl,
      },
      { legadoAsync: true },
    );
    return fromLegadoCheckResult(checked, res);
  } catch (e) {
    if (isVerificationCancelled(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`loginCheckJs 错误: ${msg}`);
    return res;
  }
}

/**
 * 无 loginCheckJs 但配置了 loginUrl：搜索命中登录页时弹窗等待。
 * （Legado 仅跑 loginCheckJs；此处为未写检查脚本时的启发式。）
 * 用户取消则抛出 VerificationCancelledError，由上层跳过该书源。
 */
export async function awaitLoginForSearchPage(
  source: BookSourceRecord,
  res: StrResponse,
  analyzeUrl: AnalyzeUrl,
  logs: string[],
): Promise<StrResponse> {
  if (source.loginCheckJs?.trim()) return res;
  if (!source.loginUrl?.trim()) return res;
  if (!isLikelyLoginPage(res.body)) return res;

  // 仅认书源级登录确认 / 登录头；域名下匿名 Cookie 不算已登录
  if (hasLoginSession(source)) {
    logs.push(
      `检测到登录页特征但已有登录会话，跳过弹窗：${source.bookSourceName}`,
    );
    return res;
  }
  // 页头/弹层常残留登录 HTML，但书列表已能解析则视为非登录墙
  if (pageAlreadyHasCssBookList(source, res.body)) {
    logs.push(
      `检测到登录页特征但已命中书列表，跳过弹窗：${source.bookSourceName}`,
    );
    return res;
  }

  const host = createJsExtensionHost(source, logs);
  const loginPageUrl = resolveLoginPageUrl(source);
  logs.push(`检测到登录页，等待验证：${source.bookSourceName}`);

  await getVerificationResult(
    source.bookSourceUrl,
    loginPageUrl,
    `登录 · ${source.bookSourceName}`,
    { refetchAfterSuccess: false, source, host },
  );

  return analyzeUrl.getStrResponse();
}

export function hasLoginSession(source: BookSourceRecord): boolean {
  if (getLoginHeader(source.bookSourceUrl)?.trim()) return true;
  return getLoginSessionAck(source.bookSourceUrl);
}

function isLikelyLoginPage(body: string): boolean {
  const s = body.slice(0, 16000);
  // 强特征：单独命中即可（真正登录墙 / 验证页）
  const strong = [
    "账号登录",
    "发送验证码",
    "忘记密码",
    "登录账号即代表",
    "用户登录",
    "Just a moment",
    "百度安全验证",
    "var buid",
    "人机验证",
    "确认您是真人",
  ];
  for (const m of strong) {
    if (s.includes(m)) return true;
  }
  // 弱特征：导航常有 `class="login-info"` / 「注册」链，勿单凭一条就当登录墙
  // （部分站点分类页含 login-info，但书列表可直接解析）
  let weak = 0;
  if (/\bclass\s*=\s*["']login["']/i.test(s)) weak += 1;
  if (/\bid\s*=\s*["']login["']/i.test(s)) weak += 1;
  if (s.includes("注册账号")) weak += 1;
  if (/class\s*=\s*["'][^"']*login-(?:form|box|modal|dialog|panel)[^"']*["']/i.test(s)) {
    weak += 1;
  }
  return weak >= 2;
}

/**
 * 搜索页嵌了登录弹层，但书列表规则已能命中时视为非登录墙。
 * 支持 Legado `class.`/`tag.`/`id.` 与普通 CSS（如部分站点 `class.book-list-table`）。
 */
function pageAlreadyHasCssBookList(
  source: BookSourceRecord,
  body: string,
): boolean {
  const rules = [
    source.ruleSearch?.bookList,
    source.ruleExplore?.bookList,
  ];
  let $: cheerio.CheerioAPI | null = null;
  for (const rule of rules) {
    const raw = rule?.trim();
    if (!raw) continue;
    for (const part of raw.split("||")) {
      const sel = part.trim().split("@")[0]?.trim() ?? "";
      if (!sel) continue;
      // 跳过 XPath / JsonPath / JS
      if (
        sel.startsWith("//")
        || sel.startsWith("$.")
        || sel.startsWith("@js")
        || sel.startsWith("<js>")
        || sel.includes("{{")
      ) {
        continue;
      }
      try {
        $ ??= cheerio.load(body);
        const found = queryLegadoSelectorSegment($, $.root(), sel, true);
        if (found.length > 0) return true;
      } catch {
        /* ignore invalid selector */
      }
    }
  }
  return false;
}

export function runSourceLogin(
  source: BookSourceRecord,
  loginData: Record<string, string>,
  logs: string[] = [],
): void {
  if (Object.keys(loginData).length === 0) {
    setLoginInfo(source.bookSourceUrl, {});
    return;
  }
  setLoginInfo(source.bookSourceUrl, loginData);
  runLoginJs(source, loginData, logs);
}

/**
 * 求值 loginUi 得到按钮/输入行（对齐 Legado SourceLoginDialog.evalUiJs）。
 * `@js:`/`<js>` 需在主进程跑 JS 才能得到行；纯 JSON 直接解析。
 * 源登录场景无 book：显式传 null，使脚本 `if(book)` 为假（否则会渲染正文场景按钮）。
 */
export async function getLoginUiRows(
  source: BookSourceRecord,
  ctx: {
    book?: Record<string, unknown> | null;
    chapter?: Record<string, unknown> | null;
  } = {},
  logs: string[] = [],
): Promise<LoginUiRow[]> {
  const raw = source.loginUi?.trim();
  if (!raw) return [];
  const code = extractLoginUiJs(raw);
  if (code == null) return parseLoginUi(raw);

  const host = createJsExtensionHost(source, logs);
  const loginJs = extractLoginJs(source.loginUrl) ?? "";
  const result = wrapLegadoMapLike(getLoginInfo(source.bookSourceUrl));
  const out = await evalJsAsync(
    `${loginJs}\n${code}`,
    {
      source,
      host,
      book: ctx.book ?? null,
      chapter: ctx.chapter ?? null,
      result,
    },
    { legadoAsync: true },
  );
  if (out == null) return [];
  const json = String(out).trim();
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is LoginUiRow =>
        r != null && typeof r === "object" && typeof (r as LoginUiRow).name === "string",
    );
  } catch (e) {
    logs.push(`loginUi 解析失败: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

export async function runLoginUiButton(
  source: BookSourceRecord,
  loginData: Record<string, string>,
  action: string,
  logs: string[] = [],
): Promise<void> {
  const actionTrim = action.trim();
  if (!actionTrim) return;

  if (/^https?:\/\//i.test(actionTrim)) {
    void shell.openExternal(actionTrim);
    return;
  }

  const host = createJsExtensionHost(source, logs, loginData);
  const loginJs = extractLoginJs(source.loginUrl) ?? "";
  const script = `${loginJs}\n${actionTrim}`;
  const legadoResult = wrapLegadoMapLike(loginData);
  try {
    await evalJsAsync(script, {
      source,
      host,
      book: legadoResult,
      result: legadoResult,
    });
  } catch {
    // 对齐 Legado SourceLoginDialog.handleButtonClick：按钮 JS 错误仅记 AppLog，
    // 不弹错不中断（如部分书源 logout() 里 removeCacheList 对不存在的缓存 forEach 必抛，
    // 但清 Cookie/打开退出页等动作已在报错前完成）。evalJsAsync 已向 logs 记录 JS 错误。
  }
}

function runLoginJs(
  source: BookSourceRecord,
  loginData: Record<string, string>,
  logs: string[],
): void {
  const loginJs = extractLoginJs(source.loginUrl);
  if (!loginJs) return;

  const host = createJsExtensionHost(source, logs, loginData);
  const legadoResult = wrapLegadoMapLike(loginData);
  const script = `${loginJs}
if (typeof login === 'function') {
  login.apply(this);
} else {
  throw new Error('书源未实现 login 函数');
}`;
  evalJs(script, { source, host, book: legadoResult, result: legadoResult });
}

export function clearSourceLoginSession(sourceUrl: string): void {
  setLoginInfo(sourceUrl, {});
  removeLoginHeader(sourceUrl);
  clearLoginSessionAck(sourceUrl);
}

export { VerificationCancelledError, isVerificationCancelled };

function extractLoginJs(loginUrl?: string | null): string | null {
  const raw = loginUrl?.trim();
  if (!raw) return null;
  if (raw.startsWith("@js:")) return raw.slice(4);
  if (raw.startsWith("<js>")) {
    return raw.slice(4, raw.lastIndexOf("<"));
  }
  return raw;
}
