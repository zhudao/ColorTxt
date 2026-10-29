import type {
  BookSourceDownloadEvent,
  BookSourceDownloadRequest,
  BookSourceImportPreviewItem,
  BookSourceListItem,
  BookSourceRecord,
  BookSourceSearchEvent,
  Book,
  BookChapter,
  BookSourceGetBookInfoPayload,
  BookSourceGetChapterListPayload,
  BookSourceGetChapterContentPayload,
  ExploreKind,
  SearchBookItem,
} from "./types";
import type { LoginUiRow } from "./loginUi";

export const BOOK_SOURCE_IPC = {
  list: "bookSource:list",
  get: "bookSource:get",
  save: "bookSource:save",
  delete: "bookSource:delete",
  toggle: "bookSource:toggle",
  importPreview: "bookSource:importPreview",
  importCommit: "bookSource:importCommit",
  fetchUrl: "bookSource:fetchUrl",
  fetchUrlAbort: "bookSource:fetchUrlAbort",
  readFile: "bookSource:readFile",
  search: "bookSource:search",
  searchCancel: "bookSource:searchCancel",
  searchLoadMore: "bookSource:searchLoadMore",
  searchEvent: "bookSource:searchEvent",
  download: "bookSource:download",
  downloadCancel: "bookSource:downloadCancel",
  downloadEvent: "bookSource:downloadEvent",
  getLoginInfo: "bookSource:getLoginInfo",
  setLoginInfo: "bookSource:setLoginInfo",
  /** 求值 loginUi（@js:/<js>）得到登录框按钮/输入行 */
  getLoginUi: "bookSource:getLoginUi",
  browserLogin: "bookSource:browserLogin",
  login: "bookSource:login",
  /** 执行正文规则 payAction（对齐 Legado ReadBookActivity.payAction） */
  payAction: "bookSource:payAction",
  getLoginHeader: "bookSource:getLoginHeader",
  removeLoginHeader: "bookSource:removeLoginHeader",
  /** 清除书源域名下 Cookie（对齐 Legado CookieStore.removeCookie） */
  clearCookie: "bookSource:clearCookie",
  reorder: "bookSource:reorder",
  applyCustomOrders: "bookSource:applyCustomOrders",
  exploreKinds: "bookSource:exploreKinds",
  exploreBooks: "bookSource:exploreBooks",
  exploreClearKindsCache: "bookSource:exploreClearKindsCache",
  getBookInfo: "bookSource:getBookInfo",
  resolveCoverDisplay: "bookSource:resolveCoverDisplay",
  getChapterList: "bookSource:getChapterList",
  getChapterContent: "bookSource:getChapterContent",
  /** 查询哪些章节 URL 已有离线正文缓存 */
  chapterCacheStatus: "bookSource:chapterCacheStatus",
  /** 写入/覆盖单章正文离线缓存（阅读器编辑保存） */
  saveChapterCache: "bookSource:saveChapterCache",
  /** 清除某本书的章节正文离线缓存 */
  clearChapterCache: "bookSource:clearChapterCache",
  /** 清除缓存目录下的全部章节正文离线缓存 */
  clearAllChapterCache: "bookSource:clearAllChapterCache",
  getSourceVariable: "bookSource:getSourceVariable",
  setSourceVariable: "bookSource:setSourceVariable",
  getBookVariable: "bookSource:getBookVariable",
  setBookVariable: "bookSource:setBookVariable",
  /** 主进程 → 渲染进程：请求显示图片验证码 */
  captchaRequest: "bookSource:captchaRequest",
  /** 主进程 → 渲染进程：关闭指定验证码弹框 */
  captchaDismiss: "bookSource:captchaDismiss",
  /** 主进程 → 渲染进程：`java.toast` / `java.longToast` → appToast */
  toast: "bookSource:toast",
  /** 渲染进程 → 主进程：提交验证码 */
  captchaReply: "bookSource:captchaReply",
  /** 校验书源（对齐 Legado CheckSource） */
  checkStart: "bookSource:checkStart",
  checkCancel: "bookSource:checkCancel",
  checkEvent: "bookSource:checkEvent",
  checkGetConfig: "bookSource:checkGetConfig",
  checkSetConfig: "bookSource:checkSetConfig",
  /** 找书全局 HTTP 代理（Legado 格式字符串；空/null 表示关闭） */
  setHttpProxy: "bookSource:setHttpProxy",
  getHttpProxy: "bookSource:getHttpProxy",
  /** 用指定代理（或直连）探测 URL 连通性 */
  testHttpProxy: "bookSource:testHttpProxy",
} as const;

export type BookSourceCheckConfig = {
  keyword: string;
  timeout: number;
  /** 同时校验的书源数 */
  concurrency: number;
  checkSearch: boolean;
  checkDiscovery: boolean;
  checkInfo: boolean;
  checkCategory: boolean;
  checkContent: boolean;
};

export type BookSourceCheckEvent =
  | {
      type: "progress";
      completed: number;
      total: number;
      sourceUrl: string;
      sourceName: string;
      message: string;
    }
  | {
      /** 校验过程中间态（如开始校验、获取目录链接） */
      type: "sourceStatus";
      sourceUrl: string;
      sourceName: string;
      message: string;
    }
  | {
      type: "sourceDone";
      sourceUrl: string;
      sourceName: string;
      ok: boolean;
      message: string;
      bookSourceGroup?: string;
      respondTime?: number;
    }
  | {
      type: "done";
      cancelled: boolean;
      completed: number;
      total: number;
    };

export type BookSourceCaptchaRequest = {
  requestId: string;
  sourceName: string;
  imageDataUrl: string;
};

export type BookSourceCaptchaReply = {
  requestId: string;
  ok: boolean;
  code: string;
};

/** `java.toast` / `java.longToast` → 渲染进程 appToast */
export type BookSourceToastEvent = {
  message: string;
  /** 对齐 Legado longToast：稍长展示时间 */
  long?: boolean;
};

export type BookSourceLoginOptions = {
  /** loginUi 按钮的 action（JS 或 http URL） */
  buttonAction?: string;
};

export type BookSourceLoginResult = {
  ok: boolean;
  message?: string;
  logs?: string[];
};

export type BookSourcePayActionPayload = {
  bookSourceUrl: string;
  book: Book;
  chapter: BookChapter;
  cacheDir?: string;
};

export type BookSourcePayActionResult = {
  ok: boolean;
  message?: string;
  cancelled?: boolean;
  /** 购买成功：主进程已删该章缓存，渲染层应刷新目录并重载正文 */
  refresh?: boolean;
  logs?: string[];
};

export type BookSourceResolveCoverPayload = {
  bookSourceUrl: string;
  /** 已规范化的封面 HTTP URL（优先） */
  coverSourceUrl?: string;
  /** 书架/搜索带入的 coverUrl（可为 colortxt-local 或 http） */
  coverUrl?: string;
  bookUrl?: string;
  name?: string;
  author?: string;
  kind?: string;
  wordCount?: string;
  intro?: string;
  lastChapter?: string;
};

export type BookSourceResolveCoverResult = {
  coverUrl?: string;
  coverSourceUrl?: string;
  logs?: string[];
  message?: string;
};

export type BookSourceImportCommitPayload = {
  addUrls: string[];
  updateUrls: string[];
  sources: BookSourceRecord[];
};

export type BookSourceIpcApi = {
  bookSourceList: () => Promise<BookSourceListItem[]>;
  bookSourceGet: (url: string) => Promise<BookSourceRecord | null>;
  bookSourceSave: (source: BookSourceRecord) => Promise<{ ok: boolean; message?: string }>;
  bookSourceDelete: (urls: string[]) => Promise<{ ok: boolean }>;
  bookSourceToggle: (url: string, enabled: boolean) => Promise<{ ok: boolean }>;
  bookSourceImportPreview: (
    sources: BookSourceRecord[],
  ) => Promise<BookSourceImportPreviewItem[]>;
  bookSourceImportCommit: (
    payload: BookSourceImportCommitPayload,
  ) => Promise<{ ok: boolean; added: number; updated: number }>;
  bookSourceFetchUrl: (
    url: string,
    options?: { requestId?: number },
  ) => Promise<{
    ok: boolean;
    text?: string;
    message?: string;
    aborted?: boolean;
  }>;
  bookSourceFetchUrlAbort: (requestId: number) => Promise<{ ok: boolean }>;
  bookSourceReadFile: (filePath: string) => Promise<{ ok: boolean; text?: string; message?: string }>;
  bookSourceSearch: (
    key: string,
    options?: { sourceUrls?: string[]; precisionSearch?: boolean },
  ) => Promise<{ searchId: string }>;
  bookSourceSearchCancel: (searchId: string) => Promise<void>;
  bookSourceSearchLoadMore: (searchId: string) => Promise<{ ok: boolean }>;
  onBookSourceSearchEvent: (cb: (ev: BookSourceSearchEvent) => void) => () => void;
  bookSourceDownload: (
    req: BookSourceDownloadRequest,
  ) => Promise<{ downloadId: string }>;
  bookSourceDownloadCancel: (downloadId: string) => Promise<void>;
  onBookSourceDownloadEvent: (cb: (ev: BookSourceDownloadEvent) => void) => () => void;
  bookSourceGetLoginInfo: (url: string) => Promise<Record<string, string>>;
  bookSourceSetLoginInfo: (
    url: string,
    info: Record<string, string>,
  ) => Promise<{ ok: boolean }>;
  bookSourceGetLoginUi: (
    sourceUrl: string,
  ) => Promise<{ rows: LoginUiRow[]; logs?: string[]; message?: string }>;
  bookSourceBrowserLogin: (
    sourceUrl: string,
    title?: string,
  ) => Promise<{ ok: boolean; message?: string; cancelled?: boolean }>;
  bookSourceLogin: (
    sourceUrl: string,
    loginData: Record<string, string>,
    options?: BookSourceLoginOptions,
  ) => Promise<BookSourceLoginResult>;
  bookSourcePayAction: (
    payload: BookSourcePayActionPayload,
  ) => Promise<BookSourcePayActionResult>;
  bookSourceGetLoginHeader: (sourceUrl: string) => Promise<string>;
  bookSourceRemoveLoginHeader: (sourceUrl: string) => Promise<{ ok: boolean }>;
  bookSourceClearCookie: (
    sourceUrl: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  bookSourceReorder: (
    url: string,
    position: "top" | "bottom",
  ) => Promise<{ ok: boolean }>;
  bookSourceApplyCustomOrders: (
    updates: Array<{ url: string; customOrder: number }>,
  ) => Promise<{ ok: boolean }>;
  bookSourceExploreKinds: (
    sourceUrl: string,
  ) => Promise<{ kinds: ExploreKind[]; logs?: string[]; message?: string }>;
  bookSourceExploreBooks: (payload: {
    sourceUrl: string;
    exploreUrl: string;
    page?: number;
  }) => Promise<{ items: SearchBookItem[]; logs?: string[]; message?: string }>;
  bookSourceExploreClearKindsCache: (
    sourceUrl: string,
  ) => Promise<{ ok: boolean }>;
  bookSourceGetBookInfo: (
    payload: BookSourceGetBookInfoPayload,
  ) => Promise<{ detail?: Book; logs?: string[]; message?: string }>;
  bookSourceResolveCoverDisplay: (
    payload: BookSourceResolveCoverPayload,
  ) => Promise<BookSourceResolveCoverResult>;
  bookSourceGetChapterList: (
    payload: BookSourceGetChapterListPayload,
  ) => Promise<{ chapters?: BookChapter[]; logs?: string[]; message?: string }>;
  bookSourceGetChapterContent: (
    payload: BookSourceGetChapterContentPayload,
  ) => Promise<{
    content?: string;
    fromCache?: boolean;
    displayTitle?: string;
    logs?: string[];
    message?: string;
  }>;
  bookSourceChapterCacheStatus: (payload: {
    name: string;
    bookUrl: string;
    chapterUrls: string[];
    cacheDir?: string;
  }) => Promise<{ cachedUrls: string[] }>;
  bookSourceSaveChapterCache: (payload: {
    name: string;
    bookUrl: string;
    chapterUrl: string;
    content: string;
    cacheDir?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  bookSourceClearChapterCache: (payload: {
    name: string;
    bookUrl: string;
    cacheDir?: string;
  }) => Promise<{ ok: boolean; cleared?: boolean; message?: string }>;
  bookSourceClearAllChapterCache: (payload?: {
    cacheDir?: string;
  }) => Promise<{ ok: boolean; cleared?: boolean; message?: string }>;
  bookSourceGetSourceVariable: (sourceUrl: string) => Promise<string>;
  bookSourceSetSourceVariable: (
    sourceUrl: string,
    variable: string,
  ) => Promise<{ ok: boolean }>;
  bookSourceGetBookVariable: (bookUrl: string) => Promise<string>;
  bookSourceSetBookVariable: (
    bookUrl: string,
    variable: string,
  ) => Promise<{ ok: boolean }>;
  onBookSourceCaptchaRequest: (
    cb: (payload: BookSourceCaptchaRequest) => void,
  ) => () => void;
  onBookSourceCaptchaDismiss: (
    cb: (payload: { requestId: string }) => void,
  ) => () => void;
  onBookSourceToast: (cb: (ev: BookSourceToastEvent) => void) => () => void;
  bookSourceCaptchaReply: (
    payload: BookSourceCaptchaReply,
  ) => Promise<{ ok: boolean }>;
  bookSourceCheckStart: (
    sourceUrls: string[],
    options?: { keyword?: string },
  ) => Promise<{ ok: boolean; message?: string }>;
  bookSourceCheckCancel: () => Promise<{ ok: boolean }>;
  bookSourceCheckGetConfig: () => Promise<BookSourceCheckConfig>;
  bookSourceCheckSetConfig: (
    patch: Partial<BookSourceCheckConfig>,
  ) => Promise<BookSourceCheckConfig>;
  onBookSourceCheckEvent: (cb: (ev: BookSourceCheckEvent) => void) => () => void;
  bookSourceSetHttpProxy: (
    proxy: string | null,
  ) => Promise<{ ok: boolean }>;
  bookSourceGetHttpProxy: () => Promise<string | null>;
  bookSourceTestHttpProxy: (payload: {
    /** Legado 代理字符串；空/null 表示直连 */
    proxy?: string | null;
    url: string;
  }) => Promise<{ ok: boolean; message?: string }>;
};
