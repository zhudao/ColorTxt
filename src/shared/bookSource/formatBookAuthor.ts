/** Legado AppPattern.nameRegex + BookHelp.formatBookName */
const LEGADO_NAME_REGEX = /\s+作\s*者.*|\s+\S+\s+著/g;

/** Legado AppPattern.authorRegex + BookHelp.formatBookAuthor */
const LEGADO_AUTHOR_REGEX = /^\s*作\s*者[:：\s]+|\s+著/g;

/**
 * 净化书名：去掉「作者…」「xxx 著」等尾缀。
 * 对齐 Legado `BookHelp.formatBookName` / `AppPattern.nameRegex`。
 */
export function formatLegadoBookName(name: string | undefined | null): string {
  const raw = name?.trim() ?? "";
  if (!raw) return "";
  return raw.replace(LEGADO_NAME_REGEX, "").trim();
}

/**
 * 净化作者名：去掉「作　者：」「作者：」等标签及尾部「 著」。
 * 对齐 Legado `BookHelp.formatBookAuthor` / `AppPattern.authorRegex`。
 */
export function formatLegadoBookAuthor(author: string | undefined | null): string {
  const raw = author?.trim() ?? "";
  if (!raw) return "";
  return raw.replace(LEGADO_AUTHOR_REGEX, "").trim();
}
