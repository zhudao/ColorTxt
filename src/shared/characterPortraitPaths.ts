/** 位于 `app.getPath("userData")` 下的默认角色立绘缓存子目录名 */
export const CHARACTER_PORTRAIT_DEFAULT_SUBDIR = "CharacterPortrait";

/** 侧栏立绘上传/拖放允许的常见图片后缀（不含点） */
export const PORTRAIT_UPLOAD_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
] as const;

export function portraitImageExtensionFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * 解析立绘后缀（不含点，小写）：非法/空则回退 `png`。
 * 也可传入路径，内部会先取扩展名。不改写 `jpeg`/`jpg` 等同源后缀。
 */
export function normalizePortraitImageExtension(extOrPath: string): string {
  let ext = extOrPath.trim().toLowerCase();
  if (ext.includes("/") || ext.includes("\\")) {
    ext = portraitImageExtensionFromPath(ext);
  } else if (ext.startsWith(".")) {
    ext = ext.slice(1);
  } else if (ext.includes(".")) {
    // 可能是文件名而非纯后缀
    const fromPath = portraitImageExtensionFromPath(ext);
    if (fromPath) ext = fromPath;
  }
  if (
    ext !== "" &&
    (PORTRAIT_UPLOAD_IMAGE_EXTENSIONS as readonly string[]).includes(ext)
  ) {
    return ext;
  }
  return "png";
}

/** 解析/清理时尝试的后缀顺序（含 `.jpg` 与 `.jpeg`） */
export const PORTRAIT_IMAGE_EXTENSION_CANDIDATES: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
];

export function isPortraitUploadImagePath(path: string): boolean {
  const ext = portraitImageExtensionFromPath(path);
  return (
    ext !== "" &&
    (PORTRAIT_UPLOAD_IMAGE_EXTENSIONS as readonly string[]).includes(ext)
  );
}

/** 「选择图片」文件对话框过滤器 */
export const PORTRAIT_UPLOAD_OPEN_DIALOG_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [
  {
    name: "图片",
    extensions: [...PORTRAIT_UPLOAD_IMAGE_EXTENSIONS],
  },
];

const WIN_BAD = /[/\\?%*:|"<>]/g;

function joinPathSegments(...segments: string[]): string {
  const cleaned = segments
    .map((s) => s.replace(/[/\\]+$/, "").replace(/^[/\\]+/, "").trim())
    .filter(Boolean);
  if (cleaned.length === 0) return "";
  const sep = cleaned[0].includes("\\") ? "\\" : "/";
  return cleaned.join(sep);
}

export function defaultCharacterPortraitCacheRoot(userDataAbs: string): string {
  return joinPathSegments(userDataAbs, CHARACTER_PORTRAIT_DEFAULT_SUBDIR);
}

/** 用作磁盘一级目录名：去掉扩展名、替换非法字符、限长 */
export function sanitizeBookFolderSegment(filePathOrTitle: string, maxLen = 80): string {
  const normalized = filePathOrTitle.replace(/\\/g, "/").trim();
  const base =
    normalized.lastIndexOf("/") >= 0
      ? normalized.slice(normalized.lastIndexOf("/") + 1)
      : normalized;
  const dot = base.lastIndexOf(".");
  const withoutExt = dot > 0 ? base.slice(0, dot) : base;
  const s = withoutExt
    .trim()
    .replace(WIN_BAD, "_")
    .replace(/\s+/g, " ")
    .trim();
  const t = s || "book";
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/** 角色名 → 立绘文件名主干（不含扩展名） */
export function portraitStemForCharacterName(displayName: string): string {
  return sanitizeBookFolderSegment(displayName.trim() || "character", 120);
}

/** 角色名 → 立绘文件名（不含路径）；`ext` 缺省为 png */
export function portraitFileNameForCharacterName(
  displayName: string,
  ext = "png",
): string {
  const base = portraitStemForCharacterName(displayName);
  return `${base}.${normalizePortraitImageExtension(ext)}`;
}

/** @deprecated 使用 {@link portraitFileNameForCharacterName}；保留兼容旧调用 */
export function portraitPngFileNameForCharacterName(displayName: string): string {
  return portraitFileNameForCharacterName(displayName, "png");
}

/** 角色名 → 临时立绘文件名（生成预览用，应用前不覆盖正式立绘） */
export function portraitTmpPngFileNameForCharacterName(displayName: string): string {
  const base = portraitStemForCharacterName(displayName);
  return `${base}_tmp.png`;
}

/**
 * 编辑抽屉内「待保存」立绘暂存文件名。
 * `sessionKey`：编辑已有角色时为角色 `id`；添加角色时为一次性 uuid。
 */
export function portraitSessionDraftFileName(
  sessionKey: string,
  ext = "png",
): string {
  const raw = sessionKey.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = raw.slice(0, 80) || "draft";
  return `_char_draft_${id}.${normalizePortraitImageExtension(ext)}`;
}

/** @deprecated 使用 {@link portraitSessionDraftFileName} */
export function portraitSessionDraftPngFileName(sessionKey: string): string {
  return portraitSessionDraftFileName(sessionKey, "png");
}

export function characterPortraitTmpImageAbs(
  cacheRootAbs: string,
  bookFolderSegment: string,
  displayName: string,
): string {
  return joinPathSegments(
    cacheRootAbs.trim(),
    bookFolderSegment.trim(),
    portraitTmpPngFileNameForCharacterName(displayName),
  );
}

/** 编辑抽屉待保存立绘（选择图片 / AI 应用）的绝对路径 */
export function characterPortraitSessionDraftImageAbs(
  cacheRootAbs: string,
  bookFolderSegment: string,
  sessionKey: string,
  ext = "png",
): string {
  return joinPathSegments(
    cacheRootAbs.trim(),
    bookFolderSegment.trim(),
    portraitSessionDraftFileName(sessionKey, ext),
  );
}

/** 同一 session 草稿在各允许后缀下的候选绝对路径 */
export function characterPortraitSessionDraftImageAbsCandidates(
  cacheRootAbs: string,
  bookFolderSegment: string,
  sessionKey: string,
): string[] {
  const raw = sessionKey.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = raw.slice(0, 80) || "draft";
  const prefix = `_char_draft_${id}`;
  return PORTRAIT_IMAGE_EXTENSION_CANDIDATES.map((ext) =>
    joinPathSegments(
      cacheRootAbs.trim(),
      bookFolderSegment.trim(),
      `${prefix}.${ext}`,
    ),
  );
}

export function characterPortraitBookDirAbs(
  cacheRootAbs: string,
  bookFolderSegment: string,
): string {
  return joinPathSegments(cacheRootAbs.trim(), bookFolderSegment.trim());
}

export function characterPortraitImageAbs(
  cacheRootAbs: string,
  bookFolderSegment: string,
  displayName: string,
  ext = "png",
): string {
  return joinPathSegments(
    cacheRootAbs.trim(),
    bookFolderSegment.trim(),
    portraitFileNameForCharacterName(displayName, ext),
  );
}

/** 同一角色正式立绘在各允许后缀下的候选绝对路径（解析用） */
export function characterPortraitImageAbsCandidates(
  cacheRootAbs: string,
  bookFolderSegment: string,
  displayName: string,
): string[] {
  const base = portraitStemForCharacterName(displayName);
  return PORTRAIT_IMAGE_EXTENSION_CANDIDATES.map((ext) =>
    joinPathSegments(
      cacheRootAbs.trim(),
      bookFolderSegment.trim(),
      `${base}.${ext}`,
    ),
  );
}

/** 包内/目录下列出的立绘 basename 是否安全且为允许的图片后缀 */
export function isAllowedPortraitImageBasename(name: string): boolean {
  const n = name.trim();
  if (!n || n !== name) return false;
  if (n.includes("/") || n.includes("\\") || n.includes("..")) return false;
  const ext = portraitImageExtensionFromPath(n);
  if (
    !ext ||
    !(PORTRAIT_UPLOAD_IMAGE_EXTENSIONS as readonly string[]).includes(ext)
  ) {
    return false;
  }
  const stem = n.slice(0, n.length - ext.length - 1);
  if (!stem) return false;
  if (/_tmp$/i.test(stem)) return false;
  if (/^_char_draft_/i.test(stem)) return false;
  return true;
}
