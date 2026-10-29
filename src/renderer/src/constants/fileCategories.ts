/** 侧栏文件分类：默认名称与颜色（用户可在「分类管理」中增删改） */
export type FileCategoryDefinition = { name: string; color: string };

/** 「分类管理」表格行：与上次保存对比，用于同步侧栏文件列表项上的 `category` 字段 */
export type CategoryEditorRow = { key: string; name: string; color: string };

export const DEFAULT_FILE_CATEGORY_CATALOG: readonly FileCategoryDefinition[] = [
  { name: "玄幻", color: "#7C3AED" },
  { name: "仙侠", color: "#0891B2" },
  { name: "都市", color: "#EA580C" },
  { name: "历史", color: "#92400E" },
  { name: "游戏", color: "#16A34A" },
  { name: "科幻", color: "#2563EB" },
  { name: "悬疑", color: "#DB2777" },
] as const;

/** 列表行「未分类」左边框色 */
export const UNCATEGORIZED_LIST_BORDER_COLOR = "#64748B";

export const FILE_CATEGORY_FILTER_ALL = "__all__";
export const FILE_CATEGORY_FILTER_UNCATEGORIZED = "__uncategorized__";

/** 下拉项「分类管理」：点击仅打开弹窗，不写入 fileCategory 持久值 */
export const FILE_CATEGORY_ACTION_MANAGE = "__manage_categories__";

export type FileSortMode =
  | "nameAsc"
  | "nameDesc"
  | "pathAsc"
  | "pathDesc"
  | "sizeAsc"
  | "sizeDesc"
  | "progressAsc"
  | "progressDesc"
  | "lastReadAtAsc"
  | "lastReadAtDesc"
  | "addedAtAsc"
  | "addedAtDesc";

export const DEFAULT_FILE_SORT: FileSortMode = "nameAsc";

/** 侧栏文件列表展示：扁平列表 / 路径树 */
export type FileListViewMode = "list" | "tree";

export const DEFAULT_FILE_LIST_VIEW_MODE: FileListViewMode = "list";

export const FILE_LIST_VIEW_MODES: readonly FileListViewMode[] = [
  "list",
  "tree",
] as const;

export function isFileListViewMode(x: unknown): x is FileListViewMode {
  return x === "list" || x === "tree";
}

export function parseFileListViewMode(x: unknown): FileListViewMode {
  return isFileListViewMode(x) ? x : DEFAULT_FILE_LIST_VIEW_MODE;
}

export const FILE_SORT_MODES: readonly FileSortMode[] = [
  "nameAsc",
  "nameDesc",
  "pathAsc",
  "pathDesc",
  "sizeAsc",
  "sizeDesc",
  "progressAsc",
  "progressDesc",
  "lastReadAtAsc",
  "lastReadAtDesc",
  "addedAtAsc",
  "addedAtDesc",
] as const;

export function isFileSortMode(x: string | undefined): x is FileSortMode {
  return x !== undefined && (FILE_SORT_MODES as readonly string[]).includes(x);
}

export function normalizeCategoryFilter(
  x: string | undefined,
): typeof FILE_CATEGORY_FILTER_ALL | typeof FILE_CATEGORY_FILTER_UNCATEGORIZED | string {
  if (x === FILE_CATEGORY_FILTER_UNCATEGORIZED) return FILE_CATEGORY_FILTER_UNCATEGORIZED;
  if (!x || x === FILE_CATEGORY_FILTER_ALL) return FILE_CATEGORY_FILTER_ALL;
  return x;
}

/** 与侧栏 `filesByCategory` 一致：trim 后非空为已分类，否则为未分类 */
export function effectiveFileListItemCategory(category: string | undefined): string {
  return (category ?? "").trim();
}

/** 返回当前筛选下应从列表移除的文件路径（不含「全部」语义以外的用途时勿传 `__all__`） */
export function filePathsMatchingCategoryFilter(
  files: readonly { path: string; category?: string }[],
  categoryFilter: string,
): string[] {
  const f = normalizeCategoryFilter(categoryFilter);
  if (f === FILE_CATEGORY_FILTER_ALL) {
    return files.map((x) => x.path);
  }
  if (f === FILE_CATEGORY_FILTER_UNCATEGORIZED) {
    return files
      .filter((x) => !effectiveFileListItemCategory(x.category))
      .map((x) => x.path);
  }
  return files
    .filter((x) => effectiveFileListItemCategory(x.category) === f)
    .map((x) => x.path);
}

/** 确认框等 UI：筛选器的人读名称 */
export function displayNameForCategoryFilter(categoryFilter: string): string {
  const f = normalizeCategoryFilter(categoryFilter);
  if (f === FILE_CATEGORY_FILTER_UNCATEGORIZED) return "未分类";
  return f;
}

export function cloneDefaultFileCategoryCatalog(): FileCategoryDefinition[] {
  return DEFAULT_FILE_CATEGORY_CATALOG.map((c) => ({ ...c }));
}

export function parseFileCategoryCatalog(
  raw: unknown,
): FileCategoryDefinition[] | null {
  if (!Array.isArray(raw)) return null;
  const out: FileCategoryDefinition[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const color = typeof o.color === "string" ? o.color.trim() : "";
    if (!name || !color) continue;
    out.push({ name, color });
  }
  return out.length ? out : null;
}
