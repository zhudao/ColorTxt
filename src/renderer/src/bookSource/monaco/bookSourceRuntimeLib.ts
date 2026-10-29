/**
 * 书源 JS 运行时声明文本（供 Monaco javascriptDefaults.addExtraLib）。
 * 不作为项目 ambient 类型，避免污染 vue-tsc。
 * 对齐引擎注入；签名以补全与简短说明为准。
 */

export const BOOK_SOURCE_RUNTIME_LIB_PATH =
  "ts:colortxt-book-source-runtime.d.ts";

export const BOOK_SOURCE_RUNTIME_DTS = `
/** Legado StrResponse */
interface LegadoStrResponse {
  body(): string;
  url(): string;
  code(): number;
  headers(): Record<string, string> & { get(name: string): string };
  header(name: string): string;
  message(): string;
}

interface LegadoSymmetricCrypto {
  encryptBase64(data: string): string;
  decryptBase64(data: string): string;
  encryptHex?(data: string): string;
  decryptHex?(data: string): string;
  encrypt?(data: string): string;
  decrypt?(data: string): string;
}

interface BookSourceJava {
  /** GET/POST（URL 可带 ,{} 后缀），返回响应体字符串 */
  ajax(url: string | unknown): Promise<string> | string;
  /** 并发请求，返回 StrResponse[]（.body()） */
  ajaxAll(urls: Array<string | unknown>, skipRateLimit?: boolean): Promise<LegadoStrResponse[]>;
  /** HTTP GET（带 header）或读书源变量（单参数 key） */
  get(urlOrKey: string, header?: unknown): Promise<LegadoStrResponse> | string;
  connect(url: string, header?: unknown): Promise<LegadoStrResponse>;
  post(url: string, body: unknown, header?: unknown): Promise<LegadoStrResponse>;

  put(key: string, value: unknown): string;
  log(msg: unknown): void;
  toast(msg: unknown): void;
  longToast(msg: unknown): void;

  importScript(path: string): unknown;
  cacheFile(url: string, saveTime?: number): Promise<string> | string;
  readTxtFile(path: string, charset?: string): string;

  base64Encode(s: unknown): string;
  base64Decode(s: unknown): string;
  base64DecodeToByteArray(s: unknown): number[];
  hexDecodeToString(hex: unknown): string;
  hexDecodeToByteArray(hex: unknown): number[];
  md5Encode(s: unknown): string;
  md5Encode16(s: unknown): string;
  digestHex(data: unknown, algorithm: unknown): string;
  HMacHex(data: unknown, algorithm: unknown, key: unknown): string;
  HMacBase64(data: unknown, algorithm: unknown, key: unknown): string;
  encodeURI(str: unknown, charset?: unknown): string;

  createSymmetricCrypto(transformation: unknown, key: unknown, iv?: unknown): LegadoSymmetricCrypto;
  aesDecodeToString(data: unknown, key: unknown, transformation: unknown, iv: unknown): string;
  aesBase64DecodeToString(data: unknown, key: unknown, transformation: unknown, iv: unknown): string;
  desEncodeToBase64String(...args: unknown[]): string;
  tripleDESEncodeBase64Str(...args: unknown[]): string;
  tripleDESEncodeArgsBase64Str(...args: unknown[]): string;
  tripleDESDecodeStr(...args: unknown[]): string;
  tripleDESDecodeArgsBase64Str(...args: unknown[]): string;

  t2s(text: unknown): string;
  s2t(text: unknown): string;
  randomUUID(): string;
  timeFormat(ts: unknown): string;
  timeFormatUTC(time: unknown, format: unknown, offsetHours: unknown): string;
  toNumChapter(s: unknown): string;
  androidId(): string;
  /** 请求 UA（与 getWebViewUA 不同） */
  getUserAgent(): string;
  /** WebView / Chromium UA */
  getWebViewUA(): string;
  getCookie(domain: string): string;

  putLoginHeader(headerJson: string): void;
  getLoginHeader(): string;
  setVariable(key: string, value: string): void;
  getVariable(key: string): string;
  startBrowser(url: string, title: string): void;
  startBrowserAwait(url: string, title: string, refetchAfterSuccess?: boolean): Promise<LegadoStrResponse>;
  getVerificationCode(imageUrl: unknown): Promise<string> | string;

  webView(html: unknown, url: unknown, js?: unknown, header?: unknown, cacheFirst?: boolean): Promise<string>;
  webViewGetOverrideUrl(
    html: unknown,
    url: unknown,
    js: unknown,
    overrideUrlRegex: unknown,
    header?: unknown,
    cacheFirst?: boolean,
    delayTime?: unknown,
  ): Promise<string>;

  /** 对当前正文/上下文应用规则 */
  getString(rule: string, content?: unknown): string;
  getStringList(rule: string, content?: unknown): string[];
  getElements(rule: string, content?: unknown): unknown[];
  getElement(selector: string): unknown;
  setContent(content: unknown, baseUrl?: string): unknown;
  /** 详情最终 URL，常用于 tocUrl */
  refreshBookUrl(): string;
  /** 重新拉详情写回 tocUrl（preUpdateJs） */
  refreshTocUrl(): Promise<void> | void;
  /** 精确搜索后刷新详情（preUpdateJs） */
  reGetBook(): Promise<void> | void;

  initUrl(): unknown;
  getHeaderMap(): Record<string, string>;
  getStrResponse(): Promise<LegadoStrResponse>;
  getResponse(): Promise<LegadoStrResponse>;

  ruleUrl?: string;
  url?: string;

  getReadBookConfig(): string;
  readBookConfig(): string;
  getReadBookConfigMap(): Record<string, unknown>;
  getThemeMode(): string;
  getThemeConfig(): string;
  getThemeConfigMap(): Record<string, unknown>;
}

interface BookSourceSource {
  bookSourceUrl: string;
  bookSourceName: string;
  header: string;
  loginUrl: string;
  loginCheckJs: string;
  bookSourceComment: string;
  variableComment: string;
  key: string;
  getKey(): string;
  getTag(): string;
  getSource(): BookSourceSource;
  getLoginInfoMap(): Record<string, string>;
  getLoginHeaderMap(): Record<string, string> | null;
  getLoginInfo(): string;
  putLoginInfo(info: string | object): boolean;
  removeLoginInfo(): void;
  get(key: string): string | null;
  put(key: string, value: unknown): void;
  getVariable(): string;
  setVariable(value: unknown): void;
  putConcurrent(value: unknown): void;
  getLoginHeader(): string;
}

interface BookSourceBook {
  name?: string;
  author?: string;
  intro?: string;
  coverUrl?: string;
  kind?: string;
  tocUrl?: string;
  bookUrl?: string;
  wordCount?: string;
  lastChapter?: string;
  origin?: string;
  originName?: string;
  /** 字符串变量（可 += 累加） */
  variable?: string;
  [key: string]: unknown;
}

interface BookSourceChapter {
  title?: string;
  url?: string;
  isVolume?: boolean;
  isVip?: boolean;
  isPay?: boolean;
  variable?: string;
  [key: string]: unknown;
}

interface BookSourceCache {
  get(key: string): string | null;
  put(key: string, value: unknown, saveTime?: number): void;
  getFile(key: string): string | null;
  putFile(key: string, value: unknown, saveTime?: number): void;
  delete(key: string): void;
  getFromMemory(key: string): unknown;
  putMemory(key: string, value: unknown): void;
  deleteMemory(key: string): void;
  getInt(key: string): number | null;
  getLong(key: string): number | null;
  getDouble(key: string): number | null;
  getFloat(key: string): number | null;
}

interface BookSourceCookie {
  getKey(domain: string, name: string): string;
  getCookie(domain: string): string;
  removeCookie(urlOrKey: string): void;
  setCookie(url: string, cookie?: unknown): void;
  replaceCookie(url: string, cookie: unknown): void;
  cookieToMap(cookie: unknown): Record<string, string>;
  mapToCookie(map: unknown): string;
}

/** 宿主 API（JsExtensions） */
declare const java: BookSourceJava;
/** 当前书源 */
declare const source: BookSourceSource;
/** 当前书籍 */
declare const book: BookSourceBook;
/** 当前章节 */
declare const chapter: BookSourceChapter;
/** 规则链当前结果 */
declare const result: unknown;
/** 同 result */
declare const $: unknown;
/** 原始响应正文 */
declare const src: unknown;
declare const baseUrl: string;
declare const key: string;
declare const page: number;
declare const cookie: BookSourceCookie;
declare const cache: BookSourceCache;
`.trimStart();
