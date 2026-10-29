import { fileListKey, persistKey } from "../../constants/appUi";
import {
  cloneDefaultFileCategoryCatalog,
  type FileCategoryDefinition,
} from "../../constants/fileCategories";
import {
  basenameFromPath,
  mergeTxtFileLists,
  type TxtFileItem,
} from "../../services/fileListService";
import {
  loadPersistedSettingsData,
  loadTxtFileListSnapshot,
  persistSettingsData,
  persistTxtFileListSnapshot,
} from "../../stores/cacheStore";

const DEFAULT_NEW_CATEGORY_COLOR = "#64748B";

function ensureCategoryInCatalog(
  catalog: FileCategoryDefinition[],
  categoryName: string,
): FileCategoryDefinition[] {
  const name = categoryName.trim();
  if (!name) return catalog;
  if (catalog.some((c) => c.name === name)) return catalog;
  return [...catalog, { name, color: DEFAULT_NEW_CATEGORY_COLOR }];
}

/** 将找书下载的文件加入主界面侧栏文件列表，并按需创建分类 */
export function addFindBookDownloadToMainFileList(
  filePath: string,
  size: number,
  categoryName = "",
) {
  const category = categoryName.trim();
  const existing = loadTxtFileListSnapshot(localStorage, fileListKey);
  const item: TxtFileItem = {
    name: basenameFromPath(filePath),
    path: filePath,
    size,
  };
  if (category) item.category = category;
  const merged = mergeTxtFileLists(existing, [item]);
  persistTxtFileListSnapshot(localStorage, fileListKey, merged);

  if (!category) return;

  const loaded = loadPersistedSettingsData(localStorage, persistKey);
  const data = loaded?.data ?? {};
  const catalog =
    data.fileCategoryCatalog && data.fileCategoryCatalog.length > 0
      ? data.fileCategoryCatalog.map((c) => ({ ...c }))
      : cloneDefaultFileCategoryCatalog();
  const nextCatalog = ensureCategoryInCatalog(catalog, category);
  if (nextCatalog.length !== catalog.length) {
    persistSettingsData(localStorage, persistKey, {
      ...data,
      fileCategoryCatalog: nextCatalog,
    });
  }
}
