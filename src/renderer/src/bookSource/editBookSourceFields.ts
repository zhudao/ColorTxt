/** 编辑书源各 Tab 字段配置 */
export type BookSourceFieldDef = {
  /** 书源 JSON 中的字段名（根级或 ruleXxx 下的键） */
  key: string;
  /** 中文展示名 */
  label: string;
  rulePath?: string;
  multiline?: boolean;
};

/**
 * 编辑书源输入框自动增高上限（约 10 行）。
 * 与 AutoResizeTextarea / HighlightedCodeTextarea 的
 * font-size:13px、line-height:1.45、padding-y:8px 对齐。
 */
export const EDIT_BOOK_SOURCE_TEXTAREA_MAX_LINES = 10;
export const EDIT_BOOK_SOURCE_TEXTAREA_MAX_HEIGHT_PX = Math.ceil(
  13 * 1.45 * EDIT_BOOK_SOURCE_TEXTAREA_MAX_LINES + 8 * 2,
);

export const BOOK_SOURCE_BASIC_FIELDS: BookSourceFieldDef[] = [
  { key: "bookSourceUrl", label: "源 URL" },
  { key: "bookSourceName", label: "源名称" },
  { key: "bookSourceGroup", label: "源分组" },
  { key: "bookSourceComment", label: "源注释", multiline: true },
  { key: "loginUrl", label: "登录 URL", multiline: true },
  { key: "loginUi", label: "登录 UI", multiline: true },
  { key: "loginCheckJs", label: "登录检查 JS", multiline: true },
  { key: "coverDecodeJs", label: "封面解密", multiline: true },
  { key: "bookUrlPattern", label: "书籍 URL 正则" },
  { key: "header", label: "请求头", multiline: true },
  { key: "variableComment", label: "变量说明", multiline: true },
  { key: "concurrentRate", label: "并发率" },
  { key: "jsLib", label: "jsLib", multiline: true },
];

function ruleFields(
  prefix: string,
  fields: Array<[string, string]>,
): BookSourceFieldDef[] {
  return fields.map(([key, label]) => ({
    key,
    label,
    rulePath: prefix,
    multiline: true,
  }));
}

export const BOOK_SOURCE_SEARCH_FIELDS = ruleFields("ruleSearch", [
  ["searchUrl", "搜索地址"],
  ["checkKeyWord", "校验关键字"],
  ["bookList", "书籍列表规则"],
  ["name", "书名规则"],
  ["author", "作者规则"],
  ["kind", "分类规则"],
  ["wordCount", "字数规则"],
  ["lastChapter", "最新章节规则"],
  ["intro", "简介规则"],
  ["coverUrl", "封面规则"],
  ["bookUrl", "详情页 URL 规则"],
]);

export const BOOK_SOURCE_EXPLORE_FIELDS = [
  { key: "exploreUrl", label: "发现地址规则", multiline: true },
  ...ruleFields("ruleExplore", [
    ["bookList", "书籍列表规则"],
    ["name", "书名规则"],
    ["author", "作者规则"],
    ["kind", "分类规则"],
    ["wordCount", "字数规则"],
    ["lastChapter", "最新章节规则"],
    ["intro", "简介规则"],
    ["coverUrl", "封面规则"],
    ["bookUrl", "详情页 URL 规则"],
  ]),
];

export const BOOK_SOURCE_DETAIL_FIELDS = ruleFields("ruleBookInfo", [
  ["init", "预处理规则"],
  ["name", "书名规则"],
  ["author", "作者规则"],
  ["kind", "分类规则"],
  ["wordCount", "字数规则"],
  ["lastChapter", "最新章节规则"],
  ["intro", "简介规则"],
  ["coverUrl", "封面规则"],
  ["tocUrl", "目录 URL 规则"],
  ["canReName", "允许修改书名作者"],
  ["downloadUrls", "下载 URL 规则"],
]);

export const BOOK_SOURCE_TOC_FIELDS = ruleFields("ruleToc", [
  ["preUpdateJs", "更新之前 JS"],
  ["chapterList", "目录列表规则"],
  ["chapterName", "章节名称规则"],
  ["chapterUrl", "章节 URL 规则"],
  ["formatJs", "格式化规则"],
  ["isVolume", "Volume 标示"],
  ["updateTime", "更新时间"],
  ["isVip", "VIP 标识"],
  ["isPay", "购买标识"],
  ["nextTocUrl", "目录下一页规则"],
]);

export const BOOK_SOURCE_CONTENT_FIELDS = ruleFields("ruleContent", [
  ["content", "正文规则"],
  ["title", "章节名称规则"],
  ["chapterName", "章节名称规则（旧）"],
  ["nextContentUrl", "正文下一页 URL 规则"],
  ["webJs", "WebView JS"],
  ["sourceRegex", "资源正则"],
  ["replaceRegex", "替换规则"],
  ["subContent", "副正文"],
  ["imageStyle", "图片样式"],
  ["imageDecode", "图片解密"],
  ["payAction", "购买操作"],
]);

export type BookSourceEditTab =
  | "basic"
  | "search"
  | "explore"
  | "detail"
  | "toc"
  | "content";

export const BOOK_SOURCE_TABS: { id: BookSourceEditTab; label: string }[] = [
  { id: "basic", label: "基本" },
  { id: "search", label: "搜索" },
  { id: "explore", label: "发现" },
  { id: "detail", label: "详情" },
  { id: "toc", label: "目录" },
  { id: "content", label: "正文" },
];
