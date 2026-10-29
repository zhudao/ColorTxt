import {
  cloneDefaultFileCategoryCatalog,
  FILE_CATEGORY_FILTER_ALL,
  normalizeCategoryFilter,
  parseFileCategoryCatalog,
  type FileCategoryDefinition,
} from "../constants/fileCategories";

const BOOKSHELF_CATEGORY_FILTER_KEY = "colortxt:findBookBookshelfCategory";
/** 书架分类目录（与主界面文件分类目录独立，仅默认值相同） */
export const BOOKSHELF_CATEGORY_CATALOG_KEY =
  "colortxt:findBookBookshelfCategoryCatalog";

/** 读取书架分类目录（缺省为与主界面相同的默认分类） */
export function loadBookshelfCategoryCatalog(): FileCategoryDefinition[] {
  try {
    const raw = localStorage.getItem(BOOKSHELF_CATEGORY_CATALOG_KEY);
    if (raw) {
      const catalog = parseFileCategoryCatalog(JSON.parse(raw));
      if (catalog) return catalog;
    }
  } catch {
    /* ignore */
  }
  return cloneDefaultFileCategoryCatalog();
}

/** 写回书架分类目录 */
export function saveBookshelfCategoryCatalog(
  catalog: FileCategoryDefinition[],
): void {
  try {
    localStorage.setItem(
      BOOKSHELF_CATEGORY_CATALOG_KEY,
      JSON.stringify(catalog.map((c) => ({ ...c }))),
    );
  } catch {
    /* ignore */
  }
}

export function loadBookshelfCategoryFilter(): string {
  try {
    const raw = localStorage.getItem(BOOKSHELF_CATEGORY_FILTER_KEY);
    if (raw) return normalizeCategoryFilter(raw);
  } catch {
    /* ignore */
  }
  return FILE_CATEGORY_FILTER_ALL;
}

export function saveBookshelfCategoryFilter(filter: string): void {
  try {
    localStorage.setItem(
      BOOKSHELF_CATEGORY_FILTER_KEY,
      normalizeCategoryFilter(filter),
    );
  } catch {
    /* ignore */
  }
}
