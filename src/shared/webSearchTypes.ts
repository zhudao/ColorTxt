/** 网络搜索引擎（右键菜单） */

export type WebSearchEngine = {
  id: string;
  name: string;
  /** 含 `%s` 占位符的搜索 URL 模板 */
  urlTemplate: string;
};

export type WebSearchSettings = {
  engines: WebSearchEngine[];
};
