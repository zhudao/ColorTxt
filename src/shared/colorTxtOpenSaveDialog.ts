/** 与主进程 `dialog.showOpenDialog` 对齐的可序列化选项（IPC 传入） */
export type ColorTxtOpenDialogOptions = {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  message?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<
    | "openFile"
    | "openDirectory"
    | "multiSelections"
    | "showHiddenFiles"
    | "createDirectory"
    | "promptToCreate"
    | "noResolveAliases"
    | "treatPackageAsDirectory"
    | "dontAddToRecent"
  >;
  securityScopedBookmarks?: boolean;
};

export type ColorTxtOpenDialogResult = {
  canceled: boolean;
  filePaths: string[];
  bookmarks?: string[];
};

/** 与主进程 `dialog.showSaveDialog` 对齐的可序列化选项（IPC 传入） */
export type ColorTxtSaveDialogOptions = {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  message?: string;
  nameFieldLabel?: string;
  showsTagField?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<
    | "showHiddenFiles"
    | "createDirectory"
    | "treatPackageAsDirectory"
    | "showOverwriteConfirmation"
    | "dontAddToRecent"
  >;
  securityScopedBookmarks?: boolean;
};

export type ColorTxtSaveDialogResult = {
  canceled: boolean;
  filePath: string;
  bookmark?: string;
};

/** 「打开电子书」对话框使用的扩展名（与原先主进程 `dialog:openTxt` 一致，不含点） */
export const COLOR_TXT_OPEN_BOOK_EXTENSIONS = [
  "txt",
  "md",
  "epub",
  "mobi",
  "azw3",
  "fb2",
  "fbz",
  "pdf",
] as const;

/**
 * 彩读书包默认扩展名（不含点）：ZIP 容器，扩展名 `.ctz`（ColorTxt Zip）。
 */
export const COLOR_TXT_BOOK_PACK_FILE_EXT = "ctz";

/**
 * 加密彩读书包扩展名（不含点）：CTZE 封装，扩展名 `.ctzx`。
 */
export const COLOR_TXT_BOOK_PACK_ENCRYPTED_FILE_EXT = "ctzx";
