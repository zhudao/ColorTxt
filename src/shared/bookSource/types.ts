/** Legado 书源类型：0 文本 */
export const BOOK_SOURCE_TYPE_TEXT = 0;

export type BookSourceRuleSearch = {
  bookList?: string;
  name?: string;
  author?: string;
  kind?: string;
  wordCount?: string;
  lastChapter?: string;
  intro?: string;
  coverUrl?: string;
  bookUrl?: string;
  checkKeyWord?: string;
};

export type BookSourceRuleBookInfo = {
  init?: string;
  name?: string;
  author?: string;
  kind?: string;
  wordCount?: string;
  lastChapter?: string;
  intro?: string;
  coverUrl?: string;
  tocUrl?: string;
  canReName?: string;
  updateTime?: string;
  downloadUrls?: string;
};

export type BookSourceRuleToc = {
  preUpdateJs?: string;
  chapterList?: string;
  chapterName?: string;
  chapterUrl?: string;
  formatJs?: string;
  isVolume?: string;
  updateTime?: string;
  isVip?: string;
  isPay?: string;
  nextTocUrl?: string;
};

export type BookSourceRuleContent = {
  content?: string;
  /** 正文页章节名（Legado `title`，优先于 chapterName） */
  title?: string;
  chapterName?: string;
  nextContentUrl?: string;
  webJs?: string;
  sourceRegex?: string;
  replaceRegex?: string;
  subContent?: string;
  imageStyle?: string;
  imageDecode?: string;
  payAction?: string;
};

export type BookSourceRuleExplore = {
  url?: string;
  bookList?: string;
  name?: string;
  author?: string;
  kind?: string;
  wordCount?: string;
  lastChapter?: string;
  intro?: string;
  coverUrl?: string;
  bookUrl?: string;
};

/** Legado 发现分类 flex 样式 */
export type ExploreKindStyle = {
  layout_flexGrow?: number;
  layout_flexShrink?: number;
  layout_flexBasisPercent?: number;
  layout_wrapBefore?: boolean;
  layoutGrow?: number;
  layoutWrapBefore?: boolean;
};

/** Legado 发现分类（exploreUrl 解析结果） */
export type ExploreKind = {
  title: string;
  url?: string;
  style?: ExploreKindStyle;
};

/** Legado 书源 JSON 结构（文本源） */
export type BookSourceRecord = {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceGroup?: string;
  bookSourceType: number;
  bookUrlPattern?: string;
  customOrder?: number;
  enabled?: boolean;
  enabledExplore?: boolean;
  jsLib?: string;
  enabledCookieJar?: boolean;
  concurrentRate?: string;
  header?: string;
  loginUrl?: string;
  loginUi?: string;
  loginCheckJs?: string;
  coverDecodeJs?: string;
  bookSourceComment?: string;
  variableComment?: string;
  lastUpdateTime?: number;
  respondTime?: number;
  weight?: number;
  exploreUrl?: string;
  searchUrl?: string;
  ruleSearch?: BookSourceRuleSearch;
  ruleBookInfo?: BookSourceRuleBookInfo;
  ruleToc?: BookSourceRuleToc;
  ruleContent?: BookSourceRuleContent;
  ruleExplore?: BookSourceRuleExplore;
};

export type SearchBookItem = {
  id: string;
  name: string;
  author: string;
  kind?: string;
  wordCount?: string;
  intro?: string;
  lastChapter?: string;
  coverUrl?: string;
  /** 封面原始 HTTP URL（持久化；colortxt-local 失效时可重新代理） */
  coverSourceUrl?: string;
  bookUrl: string;
  origin: string;
  originName: string;
  /** 搜索 @put 写入的变量（如 id），须随书带入详情/目录 */
  variable?: Record<string, string>;
  /**
   * 对齐 Legado `SearchBook.infoHtml`：
   * `getInfoItem`（列表空/链接即详情）时缓存详情 HTML，供 `getBookInfo` 免二次请求。
   */
  infoHtml?: string;
  /**
   * 搜索 getInfoItem 时响应最终 URL（对齐 Legado `analyzeBookList` 的 baseUrl/redirectUrl=res.url）。
   * 供 `java.refreshBookUrl()` 得到真实书籍页，而非仍停在搜索接口的地址。
   */
  infoUrl?: string;
  /** 对齐 Legado：getInfoItem 阶段已解析的 tocUrl */
  tocUrl?: string;
};

/**
 * 对齐 Legado `Book`：搜索/发现 `searchBookToBook` 起即为 Book，
 * 详情完善同一对象，目录/正文/书架全程携带。
 */
export type Book = {
  name: string;
  author: string;
  intro: string;
  coverUrl: string;
  coverSourceUrl?: string;
  kind: string;
  wordCount?: string;
  lastChapter?: string;
  updateTime?: string;
  tocUrl: string;
  bookUrl: string;
  origin?: string;
  originName?: string;
  variable?: Record<string, string>;
  /** 对齐 Legado `Book.infoHtml`：详情页 HTML 缓存 */
  infoHtml?: string;
  /**
   * 搜索 getInfoItem 时响应最终 URL（对齐 Legado redirectUrl）。
   * 正文同页解析时用于绝对化 `nextContentUrl`，避免仍用搜索页 URL。
   */
  infoUrl?: string;
  /** 对齐 Legado `Book.tocHtml`：目录与详情同页时缓存正文供 `getChapterList` */
  tocHtml?: string;
};

export type BookChapter = {
  title: string;
  url: string;
  isVolume: boolean;
  isVip: boolean;
  isPay?: boolean;
  /** 目录副信息（对齐 Legado BookChapter.tag / ruleToc.updateTime） */
  tag?: string;
};

export type BookSourceGetBookInfoPayload = {
  bookSourceUrl: string;
  bookUrl: string;
  name: string;
  author: string;
  /** 搜索/发现列表带入（对齐 Legado SearchBook.toBook，详情解析为空时不覆盖） */
  kind?: string;
  wordCount?: string;
  intro?: string;
  lastChapter?: string;
  coverUrl?: string;
  /** 搜索 @put 变量（对齐 Legado Book.variable） */
  variable?: Record<string, string>;
  /** 对齐 Legado SearchBook.infoHtml */
  infoHtml?: string;
  /** 搜索详情响应最终 URL（res.url） */
  infoUrl?: string;
  /** 搜索 getInfoItem 已解析的 tocUrl */
  tocUrl?: string;
};

export type BookInfoSeed = Pick<
  BookSourceGetBookInfoPayload,
  | "kind"
  | "wordCount"
  | "intro"
  | "lastChapter"
  | "coverUrl"
  | "variable"
  | "infoHtml"
  | "infoUrl"
  | "tocUrl"
> & {
  origin?: string;
  originName?: string;
};

export type BookSourceGetChapterListPayload = {
  bookSourceUrl: string;
  book: Book;
};

export type BookSourceGetChapterContentPayload = {
  bookSourceUrl: string;
  book: Book;
  chapterUrl: string;
  chapterTitle: string;
  chapterIndex: number;
  /** 分卷标题章（对齐 Legado BookChapter.isVolume） */
  isVolume?: boolean;
  nextChapterUrl?: string;
  /**
   * 全书章节 URL 列表（内容章，阅读序）。
   * 对齐 Legado：nextContentUrl 若已是目录中其它章则停止翻页。
   */
  chapterUrls?: string[];
  /** 章节正文离线缓存根目录；空则用默认 userData/book_cache */
  cacheDir?: string;
  /** 默认 true；false 时忽略本地缓存，重新联网拉取并覆盖写入 */
  preferCache?: boolean;
};

export type BookSourceImportStatus = "new" | "update" | "exists";

export type BookSourceImportPreviewItem = {
  source: BookSourceRecord;
  status: BookSourceImportStatus;
};

export type BookSourceListItem = {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceGroup?: string;
  enabled: boolean;
  bookSourceType: number;
  lastUpdateTime: number;
  customOrder: number;
  /** 配置了 loginUrl（Legado hasLoginUrl） */
  hasLoginUrl: boolean;
  /** 配置了搜索 searchUrl */
  hasSearchUrl: boolean;
  /** 配置了发现页 exploreUrl */
  hasExploreUrl: boolean;
  enabledExplore: boolean;
  /** 最近一次探测响应耗时（毫秒） */
  respondTime?: number;
  /** 智能排序权重 */
  weight?: number;
};

export type BookSourceSearchProgressEvent = {
  searchId: string;
  type: "progress";
  completed: number;
  total: number;
};

export type BookSourceSearchResultEvent = {
  searchId: string;
  type: "result";
  items: SearchBookItem[];
};

export type BookSourceSearchSourceDoneEvent = {
  searchId: string;
  type: "sourceDone";
  sourceUrl: string;
  sourceName: string;
  itemCount: number;
  failed: boolean;
  error?: string;
  logs?: string[];
};

export type BookSourceSearchDoneEvent = {
  searchId: string;
  type: "done";
  cancelled?: boolean;
  /** 是否还有下一页（任一书源可继续翻页） */
  hasMore?: boolean;
};

export type BookSourceSearchLoadMoreDoneEvent = {
  searchId: string;
  type: "loadMoreDone";
  hasMore: boolean;
};

export type BookSourceSearchLoadMoreStartEvent = {
  searchId: string;
  type: "loadMoreStart";
  /** 本次翻页待请求的书源数 */
  total: number;
};

export type BookSourceSearchEvent =
  | BookSourceSearchProgressEvent
  | BookSourceSearchResultEvent
  | BookSourceSearchSourceDoneEvent
  | BookSourceSearchDoneEvent
  | BookSourceSearchLoadMoreStartEvent
  | BookSourceSearchLoadMoreDoneEvent;

export type BookSourceDownloadProgressEvent = {
  downloadId: string;
  type: "progress";
  current: number;
  total: number;
  chapterName?: string;
  /** 当前正在缓存的章节 URL（开始拉取时带上） */
  chapterUrl?: string;
};

export type BookSourceDownloadDoneEvent = {
  downloadId: string;
  type: "done";
  /** 整书导出路径；仅离线缓存时为空字符串 */
  filePath: string;
  bookName: string;
};

export type BookSourceDownloadErrorEvent = {
  downloadId: string;
  type: "error";
  message: string;
};

export type BookSourceDownloadEvent =
  | BookSourceDownloadProgressEvent
  | BookSourceDownloadDoneEvent
  | BookSourceDownloadErrorEvent;

export type BookSourceDownloadRequest = {
  bookUrl: string;
  bookSourceUrl: string;
  name: string;
  author: string;
  /** 整书 .txt 输出目录；cacheOnly 时可为空 */
  outputDir: string;
  /** 章节正文离线缓存根目录；空则用默认 userData/book_cache */
  cacheDir?: string;
  /** 仅缓存章节正文，不导出整书文件 */
  cacheOnly?: boolean;
};

export function isTextBookSource(source: BookSourceRecord): boolean {
  const t = source.bookSourceType;
  return t === BOOK_SOURCE_TYPE_TEXT || t === undefined || t === null;
}

export function normalizeBookSource(raw: unknown): BookSourceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.bookSourceUrl === "string" ? o.bookSourceUrl.trim() : "";
  const name =
    typeof o.bookSourceName === "string" ? o.bookSourceName.trim() : "";
  if (!url || !name) return null;
  const type =
    typeof o.bookSourceType === "number" ? o.bookSourceType : BOOK_SOURCE_TYPE_TEXT;
  if (type !== BOOK_SOURCE_TYPE_TEXT) return null;
  return { ...(o as BookSourceRecord), bookSourceUrl: url, bookSourceName: name, bookSourceType: type };
}

export function parseBookSourceJson(text: string): BookSourceRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(data) ? data : [data];
  const out: BookSourceRecord[] = [];
  for (const item of arr) {
    const s = normalizeBookSource(item);
    if (s) out.push(s);
  }
  return out;
}
