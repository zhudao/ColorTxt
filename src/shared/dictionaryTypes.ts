/** 词典相关跨进程类型 */

export type DictionaryProviderKind =
  | "builtin"
  | "stardict"
  | "mdict"
  | "dict"
  | "slob"
  | "bgl";

export const BUILTIN_DICTIONARY_IDS = {
  wiktionary: "builtin:wiktionary",
  wikipedia: "builtin:wikipedia",
} as const;

export type BuiltinDictionaryId =
  (typeof BUILTIN_DICTIONARY_IDS)[keyof typeof BUILTIN_DICTIONARY_IDS];

export type ImportedDictionaryKind =
  | "stardict"
  | "mdict"
  | "dict"
  | "slob"
  | "bgl";

export type ImportedDictionaryFiles = {
  ifo?: string;
  idx?: string;
  dict?: string;
  syn?: string;
  idxOffsets?: string;
  synOffsets?: string;
  mdx?: string;
  mdd?: string[];
  css?: string[];
  index?: string;
  slob?: string;
  bgl?: string;
};

export type ImportedDictionary = {
  id: string;
  kind: ImportedDictionaryKind;
  name: string;
  /** 相对 userData/dictionaries 的子目录名（通常等于 id） */
  bundleDir: string;
  files: ImportedDictionaryFiles;
  addedAt: number;
  unsupported?: boolean;
  unsupportedReason?: string;
};

export type DictionarySettings = {
  /** 展示与查询顺序（含 builtin / local） */
  providerOrder: string[];
  providerEnabled: Record<string, boolean>;
  importedDictionaries: ImportedDictionary[];
  /**
   * 本地词典缓存目录（绝对路径）；空或未设时 merge 为默认 userData/dictionaries
   */
  localCacheDir: string;
};

export type DictionaryLookupResultItem = {
  providerId: string;
  title: string;
  /** 条目正文（纯文本或简易 HTML） */
  content: string;
  contentFormat: "text" | "html";
  sourceKind: "local" | "network";
};

export type DictionaryLookupRequest = {
  word: string;
  settings: DictionarySettings;
  /** 可选：优先语言（如 zh / en） */
  lang?: string;
};

export type DictionaryLookupResponse =
  | { ok: true; word: string; results: DictionaryLookupResultItem[] }
  | { ok: false; message: string };

export type DictionaryImportRequest = {
  /** 用户选择的绝对路径 */
  filePaths: string[];
  /** 覆盖默认缓存目录；空则用默认 */
  localCacheDir?: string;
};

export type DictionaryImportResponse =
  | {
      ok: true;
      imported: ImportedDictionary[];
      orphanNames: string[];
      message?: string;
    }
  | { ok: false; message: string };

export type DictionaryRemoveRequest = {
  id: string;
  bundleDir: string;
  /** 覆盖默认缓存目录；空则用默认 */
  localCacheDir?: string;
};

export type DictionaryRemoveResponse =
  | { ok: true }
  | { ok: false; message: string };

export const DICTIONARY_IPC = {
  lookup: "dictionary:lookup",
  import: "dictionary:import",
  remove: "dictionary:remove",
} as const;
