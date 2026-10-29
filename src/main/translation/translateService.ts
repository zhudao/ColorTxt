import { createHash, createHmac, randomUUID } from "node:crypto";
import { fetchViaChromiumNet } from "../bookSource/engine/chromiumNetFetch";
import type {
  TranslationProviderId,
  TranslationRequest,
  TranslationResponse,
  TranslationSettings,
} from "@shared/translationTypes";
import {
  DEFAULT_TRANSLATION_AI_MAX_TOKENS,
  getActiveTranslationAiEndpoint,
  normalizeTranslationAiMaxTokens,
  normalizeTranslationAiProfiles,
} from "@shared/translationAiProfiles";
import {
  splitTextIntoTranslationChunks,
  translationMaxCharsForProvider,
} from "@shared/translationChunk";
import { reapplySourceLineIndents } from "@shared/translationIndent";
import {
  addTokenUsage,
  extractUsageFromChatJson,
  ZERO_TOKEN_USAGE,
  type AITokenUsageTotals,
} from "@shared/aiTokenUsage";
import { applyOpenAiCompatAuthHeaders } from "@shared/apiEndpointPresets";

const FETCH_TIMEOUT_MS = 20_000;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function httpText(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}): Promise<{ status: number; body: string }> {
  const res = await fetchViaChromiumNet({
    url: opts.url,
    method: opts.method ?? "GET",
    headers: opts.headers,
    body: opts.body ?? null,
    timeoutMs: FETCH_TIMEOUT_MS,
    useCookieJar: false,
  });
  return { status: res.statusCode, body: res.body };
}

async function httpJson<T = unknown>(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}): Promise<{ status: number; json: T; body: string }> {
  const r = await httpText(opts);
  let json = null as T;
  try {
    json = JSON.parse(r.body) as T;
  } catch {
    /* ignore */
  }
  return { status: r.status, json, body: r.body };
}

/** UI 语言码 → 各厂商 */
export function mapLang(
  uiLang: string,
  provider: TranslationProviderId,
): string {
  const code = uiLang.trim() || "zh-CN";
  const short = code.split("-")[0]!.toLowerCase();

  if (provider === "microsoft") {
    if (code === "zh-CN" || code === "zh") return "zh-Hans";
    if (code === "zh-TW") return "zh-Hant";
    return code;
  }
  if (provider === "yandex") {
    if (short === "zh") return "zh";
    return short;
  }
  if (provider === "baidu") {
    const m: Record<string, string> = {
      "zh-CN": "zh",
      "zh-TW": "cht",
      en: "en",
      ja: "jp",
      ko: "kor",
      fr: "fra",
      de: "de",
      es: "spa",
      pt: "pt",
      "pt-BR": "pt",
      ru: "ru",
      it: "it",
      ar: "ara",
      th: "th",
      vi: "vie",
      id: "id",
      tr: "tr",
      pl: "pl",
      nl: "nl",
      sv: "swe",
      uk: "ukr",
    };
    return m[code] ?? m[short] ?? short;
  }
  if (provider === "youdao") {
    const m: Record<string, string> = {
      "zh-CN": "zh-CHS",
      "zh-TW": "zh-CHT",
      en: "en",
      ja: "ja",
      ko: "ko",
      fr: "fr",
      de: "de",
      es: "es",
      pt: "pt",
      "pt-BR": "pt",
      ru: "ru",
      it: "it",
      ar: "ar",
      th: "th",
      vi: "vi",
      id: "id",
      tr: "tr",
      pl: "pl",
      nl: "nl",
      sv: "sv",
      uk: "uk",
    };
    return m[code] ?? m[short] ?? short;
  }
  // google / deepl / tencent / volc / aliyun / ai：短码或常见映射
  if (provider === "deepl") {
    if (code === "zh-CN" || code === "zh-TW" || short === "zh") return "ZH";
    if (code === "pt-BR") return "PT-BR";
    return short.toUpperCase();
  }
  if (provider === "tencent" || provider === "volcengine" || provider === "aliyun") {
    if (code === "zh-CN" || code === "zh") return "zh";
    if (code === "zh-TW") return "zh-TW";
    return short;
  }
  // google / ai
  if (code === "zh-CN") return "zh-CN";
  if (code === "zh-TW") return "zh-TW";
  return short;
}

// —— Microsoft（Edge 公开端点，无需鉴权；旧 /translate/auth 已 404）——
async function translateMicrosoft(
  text: string,
  targetLang: string,
  sourceLang?: string,
): Promise<string> {
  const from =
    sourceLang?.trim() && sourceLang !== "auto"
      ? mapLang(sourceLang, "microsoft")
      : "";
  const params = new URLSearchParams({
    from,
    to: mapLang(targetLang, "microsoft"),
    isEnterpriseClient: "false",
  });
  const r = await httpJson<
    Array<{ translations?: Array<{ text?: string }> }>
  >({
    url: `https://edge.microsoft.com/translate/translatetext?${params}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    // Body 为纯字符串数组（非 [{ text }]）
    body: JSON.stringify([text]),
  });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`微软翻译失败 (${r.status})`);
  }
  const out = r.json?.[0]?.translations?.[0]?.text;
  if (!out) throw new Error("微软翻译返回空结果");
  return out;
}

// —— Google ——
async function translateGoogle(
  text: string,
  targetLang: string,
  sourceLang?: string,
): Promise<string> {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("dt", "t");
  url.searchParams.set(
    "sl",
    sourceLang?.trim() && sourceLang !== "auto"
      ? mapLang(sourceLang, "google")
      : "auto",
  );
  url.searchParams.set("tl", mapLang(targetLang, "google"));
  url.searchParams.set("q", text);
  const r = await httpJson<unknown>({ url: url.toString() });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Google 翻译失败 (${r.status})`);
  }
  const data = r.json;
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error("Google 翻译返回格式异常");
  }
  const joined = (data[0] as unknown[])
    .filter((seg) => Array.isArray(seg) && seg[0])
    .map((seg) => String((seg as unknown[])[0]))
    .join("");
  if (!joined) throw new Error("Google 翻译返回空结果");
  return joined;
}

// —— Yandex（Android 客户端通道：本地生成 sid，无需网页会话）——
async function translateYandex(
  text: string,
  targetLang: string,
  sourceLang?: string,
): Promise<string> {
  const ucid = randomUUID().replace(/-/g, "");
  const sid = `${ucid}-0-0`;
  const to = mapLang(targetLang, "yandex");
  const from =
    sourceLang?.trim() && sourceLang !== "auto"
      ? mapLang(sourceLang, "yandex")
      : "";
  // 仅目标语言时由服务端自动检测源语言；`auto-xx` 不被支持
  const lang = from ? `${from}-${to}` : to;
  const params = new URLSearchParams({
    sid,
    srv: "android",
    format: "text",
  });
  const body = new URLSearchParams({ text, lang });
  const r = await httpJson<{ text?: string[]; code?: number; message?: string }>(
    {
      url: `https://translate.yandex.net/api/v1/tr.json/translate?${params}`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "ru.yandex.translate/21.15.4.21402814 (Xiaomi Redmi Note 8; Android 11)",
      },
      body: body.toString(),
    },
  );
  if (r.status < 200 || r.status >= 300 || (r.json?.code && r.json.code !== 200)) {
    throw new Error(
      `Yandex 翻译失败 (${r.status}${r.json?.message ? `: ${r.json.message}` : ""})`,
    );
  }
  const out = Array.isArray(r.json?.text) ? r.json!.text!.join("") : "";
  if (!out) throw new Error("Yandex 翻译返回空结果");
  return out;
}

// —— DeepL ——
function isOfficialDeepLHost(hostname: string): boolean {
  return (
    hostname === "api.deepl.com" ||
    hostname === "api-free.deepl.com" ||
    hostname.endsWith(".deepl.com")
  );
}

async function translateDeepL(
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<string> {
  const apiKey = settings.deeplApiKey.trim();
  if (!apiKey) throw new Error("请先在翻译设置中填写 DeepL API Key");
  const rawBase =
    settings.deeplBaseUrl.trim() || "https://api-free.deepl.com/v2";
  const withoutTrail = rawBase.replace(/\/+$/, "");
  const baseNoTranslate = withoutTrail.replace(/\/translate$/i, "");
  let mode: "deepl" | "deeplx" = "deepl";
  try {
    const u = new URL(baseNoTranslate);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (!isOfficialDeepLHost(u.hostname) && last !== "v2") mode = "deeplx";
  } catch {
    mode = "deeplx";
  }

  if (mode === "deepl") {
    const form = new URLSearchParams();
    form.set("text", text);
    form.set("target_lang", mapLang(targetLang, "deepl"));
    if (sourceLang?.trim() && sourceLang !== "auto") {
      form.set("source_lang", mapLang(sourceLang, "deepl"));
    }
    const r = await httpJson<{
      translations?: Array<{ text?: string }>;
      message?: string;
    }>({
      url: `${baseNoTranslate}/translate`,
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(
        r.json?.message || `DeepL 翻译失败 (${r.status})`,
      );
    }
    const out = r.json?.translations?.[0]?.text;
    if (!out) throw new Error("DeepL 翻译返回空结果");
    return out;
  }

  // DeepLX
  const translateUrl = withoutTrail.endsWith("/translate")
    ? withoutTrail
    : `${baseNoTranslate}/translate`;
  const payload: Record<string, string> = {
    text,
    target_lang: mapLang(targetLang, "deepl"),
  };
  if (sourceLang?.trim() && sourceLang !== "auto") {
    payload.source_lang = mapLang(sourceLang, "deepl");
  }
  const r = await httpJson<{
    data?: string;
    translation?: string;
    text?: string;
  }>({
    url: translateUrl,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`DeepLX 翻译失败 (${r.status})`);
  }
  const out =
    (typeof r.json?.data === "string" && r.json.data) ||
    (typeof r.json?.translation === "string" && r.json.translation) ||
    (typeof r.json?.text === "string" && r.json.text) ||
    "";
  if (!out) throw new Error("DeepLX 翻译返回空结果");
  return out;
}

// —— Baidu ——
async function translateBaidu(
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<string> {
  const appid = settings.baiduAppId.trim();
  const secret = settings.baiduSecret.trim();
  if (!appid || !secret) {
    throw new Error("请先在翻译设置中填写百度应用 ID 与密钥");
  }
  const salt = String(Date.now());
  const sign = createHash("md5")
    .update(appid + text + salt + secret)
    .digest("hex");
  const params = new URLSearchParams({
    q: text,
    from:
      sourceLang?.trim() && sourceLang !== "auto"
        ? mapLang(sourceLang, "baidu")
        : "auto",
    to: mapLang(targetLang, "baidu"),
    appid,
    salt,
    sign,
  });
  const r = await httpJson<{
    error_code?: string;
    error_msg?: string;
    trans_result?: Array<{ dst?: string }>;
  }>({
    url: `https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`,
  });
  if (r.json?.error_code) {
    throw new Error(
      `百度翻译错误 ${r.json.error_code}: ${r.json.error_msg || ""}`,
    );
  }
  const out = (r.json?.trans_result || [])
    .map((x) => x.dst || "")
    .join("\n")
    .trim();
  if (!out) throw new Error("百度翻译返回空结果");
  return out;
}

// —— Youdao ——
function youdaoInput(q: string): string {
  if (q.length <= 20) return q;
  return `${q.slice(0, 10)}${q.length}${q.slice(-10)}`;
}

async function translateYoudao(
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<string> {
  const appKey = settings.youdaoAppKey.trim();
  const appSecret = settings.youdaoAppSecret.trim();
  if (!appKey || !appSecret) {
    throw new Error("请先在翻译设置中填写有道应用 ID 与应用密钥");
  }
  const salt = randomUUID();
  const curtime = String(Math.floor(Date.now() / 1000));
  const sign = createHash("sha256")
    .update(appKey + youdaoInput(text) + salt + curtime + appSecret)
    .digest("hex");
  const form = new URLSearchParams({
    q: text,
    from:
      sourceLang?.trim() && sourceLang !== "auto"
        ? mapLang(sourceLang, "youdao")
        : "auto",
    to: mapLang(targetLang, "youdao"),
    appKey,
    salt,
    sign,
    signType: "v3",
    curtime,
  });
  const r = await httpJson<{
    errorCode?: string;
    translation?: string[];
  }>({
    url: "https://openapi.youdao.com/api",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (r.json?.errorCode && r.json.errorCode !== "0") {
    throw new Error(`有道翻译错误码 ${r.json.errorCode}`);
  }
  const out = (r.json?.translation || []).join("").trim();
  if (!out) throw new Error("有道翻译返回空结果");
  return out;
}

// —— Tencent TC3 ——
function sha256Hex(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}
function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

async function translateTencent(
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<string> {
  const secretId = settings.tencentSecretId.trim();
  const secretKey = settings.tencentSecretKey.trim();
  if (!secretId || !secretKey) {
    throw new Error("请先在翻译设置中填写腾讯 SecretId / SecretKey");
  }
  const region = settings.tencentRegion.trim() || "ap-guangzhou";
  const host = "tmt.tencentcloudapi.com";
  const service = "tmt";
  const action = "TextTranslate";
  const version = "2018-03-21";
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({
    SourceText: text,
    Source:
      sourceLang?.trim() && sourceLang !== "auto"
        ? mapLang(sourceLang, "tencent")
        : "auto",
    Target: mapLang(targetLang, "tencent"),
    ProjectId: 0,
  });
  const hashedPayload = sha256Hex(payload);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning)
    .update(stringToSign)
    .digest("hex");
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const r = await httpJson<{
    Response?: {
      TargetText?: string;
      Error?: { Message?: string };
    };
  }>({
    url: `https://${host}`,
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": version,
      "X-TC-Region": region,
    },
    body: payload,
  });
  if (r.json?.Response?.Error?.Message) {
    const msg = r.json.Response.Error.Message.trim();
    const lower = msg.toLowerCase();
    if (
      lower.includes("service has not been opened") ||
      lower.includes("not been activated") ||
      lower.includes("service is not activated")
    ) {
      throw new Error(
        "腾讯翻译：机器翻译（TMT）尚未开通。请到腾讯云控制台开通「机器翻译」后再试：https://console.cloud.tencent.com/tmt",
      );
    }
    throw new Error(`腾讯翻译：${msg}`);
  }
  const out = r.json?.Response?.TargetText?.trim();
  if (!out) throw new Error("腾讯翻译返回空结果");
  return out;
}

// —— Volcengine ——
async function translateVolcengine(
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<string> {
  const accessKeyId = settings.volcAccessKeyId.trim();
  const secretKey = settings.volcSecretKey.trim();
  if (!accessKeyId || !secretKey) {
    throw new Error("请先在翻译设置中填写火山 Access Key");
  }
  const region = settings.volcRegion.trim() || "cn-north-1";
  const host = "translate.volcengineapi.com";
  const service = "translate";
  const method = "POST";
  const path = "/";
  const query = "Action=TranslateText&Version=2020-06-01";
  const now = new Date();
  const xDate =
    now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const shortDate = xDate.slice(0, 8);
  const payloadObj: Record<string, unknown> = {
    TargetLanguage: mapLang(targetLang, "volcengine"),
    TextList: [text],
  };
  if (sourceLang?.trim() && sourceLang !== "auto") {
    payloadObj.SourceLanguage = mapLang(sourceLang, "volcengine");
  }
  const payload = JSON.stringify(payloadObj);
  const xContentSha256 = sha256Hex(payload);
  const canonicalHeaders = [
    `content-type:application/json`,
    `host:${host}`,
    `x-content-sha256:${xContentSha256}`,
    `x-date:${xDate}`,
  ].join("\n");
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders + "\n",
    signedHeaders,
    xContentSha256,
  ].join("\n");
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmacSha256(secretKey, shortDate);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");
  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const r = await httpJson<{
    TranslationList?: Array<{ Translation?: string }>;
    ResponseMetadata?: { Error?: { Message?: string } };
  }>({
    url: `https://${host}/?${query}`,
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      Host: host,
      "X-Date": xDate,
      "X-Content-Sha256": xContentSha256,
    },
    body: payload,
  });
  if (r.json?.ResponseMetadata?.Error?.Message) {
    throw new Error(`火山翻译：${r.json.ResponseMetadata.Error.Message}`);
  }
  const out = r.json?.TranslationList?.[0]?.Translation?.trim();
  if (!out) throw new Error("火山翻译返回空结果");
  return out;
}

// —— Aliyun RPC ——
function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

async function translateAliyun(
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<string> {
  const accessKeyId = settings.aliyunAccessKeyId.trim();
  const accessKeySecret = settings.aliyunAccessKeySecret.trim();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("请先在翻译设置中填写阿里云 AccessKey");
  }
  const params: Record<string, string> = {
    Format: "JSON",
    Version: "2018-10-12",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ""),
    SignatureVersion: "1.0",
    SignatureNonce: randomUUID(),
    Action: "TranslateGeneral",
    FormatType: "text",
    SourceLanguage:
      sourceLang?.trim() && sourceLang !== "auto"
        ? mapLang(sourceLang, "aliyun")
        : "auto",
    TargetLanguage: mapLang(targetLang, "aliyun"),
    SourceText: text,
    Scene: "general",
  };
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
    .join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(sorted)}`;
  const signature = createHmac("sha1", `${accessKeySecret}&`)
    .update(stringToSign)
    .digest("base64");
  params.Signature = signature;
  const body = Object.keys(params)
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
    .join("&");
  const r = await httpJson<{
    Code?: string;
    Message?: string;
    Data?: { Translated?: string };
  }>({
    url: "https://mt.cn-hangzhou.aliyuncs.com/",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (r.json?.Code && String(r.json.Code) !== "200") {
    throw new Error(
      `阿里翻译错误 ${r.json.Code}: ${r.json.Message || ""}`,
    );
  }
  const out = r.json?.Data?.Translated?.trim();
  if (!out) throw new Error("阿里翻译返回空结果");
  return out;
}

// —— AI（独立 OpenAI 兼容配置，不依赖对话方案）——
function langDisplayName(code: string): string {
  const langMap: Record<string, string> = {
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    ja: "Japanese",
    ko: "Korean",
    en: "English",
    fr: "French",
    de: "German",
    es: "Spanish",
    pt: "Portuguese",
    "pt-BR": "Portuguese",
    it: "Italian",
    ru: "Russian",
    ar: "Arabic",
    th: "Thai",
    vi: "Vietnamese",
    id: "Indonesian",
    tr: "Turkish",
    pl: "Polish",
    nl: "Dutch",
    sv: "Swedish",
    ug: "Uyghur",
  };
  return langMap[code] || code;
}

function isChineseLanguage(code: string): boolean {
  const c = code.trim();
  return c === "zh-CN" || c === "zh-TW" || c === "zh" || c.startsWith("zh-");
}

/** 对齐 ReadAny：中文目标语时短词/文言需释义或白话，避免同语原文照搬 */
function buildAiTranslationPrompt(
  targetLang: string,
  sourceLang?: string,
): string {
  const targetLangName = langDisplayName(targetLang);
  const outputRule =
    "Only output the translation, no explanations or additional text.";
  const chineseRule = isChineseLanguage(targetLang)
    ? ` When translating to ${targetLangName}, if the source text is Classical/Literary Chinese or archaic Chinese, translate it into modern vernacular ${targetLangName}; for example, "学而不思则罔，思而不学则殆" should become a modern-language rendering of the meaning, not the original sentence. If a same-language literal translation would be identical, output a concise modern paraphrase. Do not mention source, author, title, background, citations, commentary, or analysis. For short Chinese words or single characters, output the most likely modern meaning in context instead of copying the source text.`
    : "";
  const src = sourceLang?.trim() || "";
  const conversionRule =
    isChineseLanguage(src) || isChineseLanguage(targetLang)
      ? " Important: Even if the source text appears similar to the target language (e.g. Traditional Chinese to Simplified Chinese), you must still perform the conversion."
      : "";
  return `You are a professional translator. Translate the following text to ${targetLangName}. ${outputRule}${chineseRule}${conversionRule}`;
}

async function translateAiChunk(
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<{ text: string; usage: AITokenUsageTotals | null }> {
  const profiles = normalizeTranslationAiProfiles(settings.aiProfiles);
  const ep = getActiveTranslationAiEndpoint(
    profiles,
    settings.activeAiProfileId ?? "",
  );
  const baseUrl = ep.baseUrl.trim();
  const model = ep.model.trim();
  const apiKey = ep.apiKey.trim();
  const maxTokens = normalizeTranslationAiMaxTokens(
    ep.maxTokens || settings.aiMaxTokens || DEFAULT_TRANSLATION_AI_MAX_TOKENS,
  );
  if (!baseUrl || !model) {
    throw new Error("请先在翻译设置中配置 AI 翻译的接口地址与模型");
  }
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  applyOpenAiCompatAuthHeaders(headers, baseUrl, apiKey || "");
  const system = buildAiTranslationPrompt(targetLang, sourceLang);
  const r = await httpJson<{
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  }>({
    url,
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
    }),
  });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(
      r.json?.error?.message || `AI 翻译失败 (${r.status})`,
    );
  }
  const out = r.json?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error("AI 翻译返回空结果");
  return { text: out, usage: extractUsageFromChatJson(r.json) };
}

async function translateAi(
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<{
  text: string;
  tokenUsage: AITokenUsageTotals;
  tokenUsageAvailable: boolean;
}> {
  const maxChars = translationMaxCharsForProvider("ai");
  const chunks = splitTextIntoTranslationChunks(text, maxChars);
  const parts: string[] = [];
  let usage = { ...ZERO_TOKEN_USAGE };
  let anyUsage = false;
  for (const chunk of chunks) {
    const r = await translateAiChunk(chunk, targetLang, settings, sourceLang);
    parts.push(r.text);
    if (r.usage) {
      usage = addTokenUsage(usage, r.usage);
      anyUsage = true;
    }
  }
  return {
    text: parts.join(chunks.length > 1 ? "\n\n" : ""),
    tokenUsage: usage,
    tokenUsageAvailable: anyUsage,
  };
}

async function translateProviderOnce(
  provider: TranslationProviderId,
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<string> {
  switch (provider) {
    case "microsoft":
      return translateMicrosoft(text, targetLang, sourceLang);
    case "google":
      return translateGoogle(text, targetLang, sourceLang);
    case "yandex":
      return translateYandex(text, targetLang, sourceLang);
    case "deepl":
      return translateDeepL(text, targetLang, settings, sourceLang);
    case "baidu":
      return translateBaidu(text, targetLang, settings, sourceLang);
    case "youdao":
      return translateYoudao(text, targetLang, settings, sourceLang);
    case "tencent":
      return translateTencent(text, targetLang, settings, sourceLang);
    case "volcengine":
      return translateVolcengine(text, targetLang, settings, sourceLang);
    case "aliyun":
      return translateAliyun(text, targetLang, settings, sourceLang);
    case "ai":
      throw new Error("AI 翻译请走 translateAi");
    default:
      throw new Error(`未知翻译服务：${provider}`);
  }
}

async function translateWithChunks(
  provider: TranslationProviderId,
  text: string,
  targetLang: string,
  settings: TranslationSettings,
  sourceLang?: string,
): Promise<string> {
  const maxChars = translationMaxCharsForProvider(provider);
  const chunks = splitTextIntoTranslationChunks(text, maxChars);
  if (chunks.length === 1) {
    return translateProviderOnce(
      provider,
      chunks[0]!,
      targetLang,
      settings,
      sourceLang,
    );
  }
  const parts: string[] = [];
  for (const chunk of chunks) {
    parts.push(
      await translateProviderOnce(
        provider,
        chunk,
        targetLang,
        settings,
        sourceLang,
      ),
    );
  }
  return parts.join("\n\n");
}

export async function translateText(
  req: TranslationRequest,
): Promise<TranslationResponse> {
  // 勿对正文 trim：会去掉选区首行缩进；仅用 trim 判断是否为空
  const text = String(req.text ?? "");
  if (!text.trim()) return { ok: false, message: "没有可翻译的文本" };
  const settings = req.settings;
  const provider = settings.provider;
  const targetLang = settings.targetLang || "zh-CN";
  const sourceLang = req.sourceLang;

  try {
    if (provider === "ai") {
      const r = await translateAi(text, targetLang, settings, sourceLang);
      return {
        ok: true,
        translated: reapplySourceLineIndents(text, r.text),
        provider,
        tokenUsage: r.tokenUsage,
        tokenUsageAvailable: r.tokenUsageAvailable,
      };
    }
    const translated = await translateWithChunks(
      provider,
      text,
      targetLang,
      settings,
      sourceLang,
    );
    return {
      ok: true,
      translated: reapplySourceLineIndents(text, translated),
      provider,
    };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
