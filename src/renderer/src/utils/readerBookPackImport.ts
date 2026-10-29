import type { FileMetaRecord } from "../stores/fileMetaStore";
import {
  fileNameKey,
  findFileMetaRecord,
  upsertFileMetaRecord,
} from "../stores/fileMetaStore";
import type { TxtFileItem } from "../services/fileListService";
import { basenameFromPath, mergeTxtFileLists } from "../services/fileListService";
import { isEbookFilePath } from "../ebook/ebookFormat";
import { joinFs } from "../ebook/pathUtils";
import { resolveBookPackUnpackDir } from "./defaultCacheDirs";
import {
  arrayBuffersEqual,
  findTxtFileByBasename,
  imagesDirNameBesideContentFileName,
  looksLikeZipBookPackCandidate,
  mergeBookPackMetaIntoRecord,
  parseReaderBookPackZip,
  resolveConvertedMdPathForEbook,
  writeContentAndImages,
  writePortraitsForBook,
  type ParsedReaderBookPack,
} from "./readerBookPack";

export type ImportReaderBookPackResult =
  | {
      ok: true;
      openPath: string;
      restorePhysicalLine?: number;
      txtFiles: TxtFileItem[];
      fileMetaRecords: FileMetaRecord[];
      message: string;
      /** 解密成功时使用的密码（明文包为空） */
      usedPassword?: string;
    }
  | { ok: false; cancelled: true }
  | { ok: false; skipped: true }
  | { ok: false; error: string };

/** 询问密码：`string` 再试；`null` 取消（打开入口）；`{ skip: true }` 跳过本包（批量） */
export type AskBookPackPasswordResult = string | null | { skip: true };

type ImportHit =
  | {
      kind: "ebook";
      /** meta / 打开用的会话路径（电子书本体） */
      metaPath: string;
      comparePath: string;
    }
  | {
      kind: "content";
      metaPath: string;
      comparePath: string;
    };

function applyMergedMeta(params: {
  records: FileMetaRecord[];
  metaPath: string;
  pack: ParsedReaderBookPack;
  includeProgress: boolean;
  convertedMdPath?: string;
}): FileMetaRecord[] {
  const existing = findFileMetaRecord(params.records, params.metaPath);
  const merged = mergeBookPackMetaIntoRecord({
    existing,
    pack: params.pack,
    includeProgress: params.includeProgress,
  });
  return upsertFileMetaRecord(params.records, params.metaPath, () => {
    const patch: Partial<FileMetaRecord> = {
      bookmarks: merged.bookmarks,
      highlightWordsByIndex: merged.highlightWordsByIndex,
      readerAnnotations: merged.readerAnnotations,
      characterRoster: merged.characterRoster,
      characterBookStyle: merged.characterBookStyle,
    };
    if (merged.clearEditorViewState) {
      patch.editorViewState = undefined;
    }
    if (merged.viewportTopPhysicalLine != null) {
      patch.viewportTopPhysicalLine = merged.viewportTopPhysicalLine;
    }
    if (params.convertedMdPath) {
      patch.convertedMdPath = params.convertedMdPath;
    }
    return patch;
  });
}

function asMatchItem(path: string, size = 0): TxtFileItem {
  return {
    name: basenameFromPath(path),
    path,
    size,
    addedAt: Date.now(),
  };
}

/** 路径已在列表则原样返回；否则 merge 进列表（补 size） */
async function ensurePathInTxtFiles(
  txtFiles: TxtFileItem[],
  absPath: string,
): Promise<TxtFileItem[]> {
  const path = absPath.trim();
  if (!path || txtFiles.some((f) => f.path === path)) return txtFiles;
  let size = 0;
  try {
    const st = await window.colorTxt.stat(path);
    if (typeof st.size === "number") size = st.size;
  } catch {
    /* keep 0 */
  }
  return mergeTxtFileLists(txtFiles, [asMatchItem(path, size)]);
}

/**
 * 优先匹配当前打开文件（含未进「文件」列表的情况），再「最近的文件」，再「文件」列表。
 * 电子书：会话路径对 sourceEbook；正文 basename 也可对 physicalReaderPath（转换 md）。
 */
async function resolveImportHit(params: {
  pack: ParsedReaderBookPack;
  txtFiles: TxtFileItem[];
  fileMetaRecords: FileMetaRecord[];
  ebookConvertOutputDir: string;
  currentFilePath?: string | null;
  physicalReaderPath?: string | null;
  /** 最近文件（靠前 = 更近）；仅路径，匹配时校验仍存在 */
  recentFiles?: readonly { path: string }[];
}): Promise<ImportHit | null> {
  const sourceEbook = params.pack.manifest.sourceEbookFileName?.trim() || "";
  const contentName = params.pack.manifest.contentFileName;
  const cur = params.currentFilePath?.trim() || "";
  const physical = params.physicalReaderPath?.trim() || "";

  if (cur) {
    if (sourceEbook && fileNameKey(cur) === fileNameKey(sourceEbook)) {
      const comparePath = await resolveConvertedMdPathForEbook({
        ebookAbsPath: cur,
        meta: findFileMetaRecord(params.fileMetaRecords, cur),
        ebookConvertOutputDir: params.ebookConvertOutputDir,
      });
      return { kind: "ebook", metaPath: cur, comparePath };
    }
    if (fileNameKey(cur) === fileNameKey(contentName)) {
      return { kind: "content", metaPath: cur, comparePath: cur };
    }
    // 当前打开电子书：列表/会话名是 epub，可读正文是转换 md
    if (
      physical &&
      isEbookFilePath(cur) &&
      fileNameKey(physical) === fileNameKey(contentName)
    ) {
      return { kind: "ebook", metaPath: cur, comparePath: physical };
    }
  }

  if (sourceEbook) {
    const recentEb = await findExistingRecentPathByBasename(
      params.recentFiles,
      sourceEbook,
    );
    if (recentEb) {
      const comparePath = await resolveConvertedMdPathForEbook({
        ebookAbsPath: recentEb,
        meta: findFileMetaRecord(params.fileMetaRecords, recentEb),
        ebookConvertOutputDir: params.ebookConvertOutputDir,
      });
      return { kind: "ebook", metaPath: recentEb, comparePath };
    }
  }
  const recentContent = await findExistingRecentPathByBasename(
    params.recentFiles,
    contentName,
  );
  if (recentContent) {
    return {
      kind: "content",
      metaPath: recentContent,
      comparePath: recentContent,
    };
  }

  if (sourceEbook) {
    const eb = findTxtFileByBasename(params.txtFiles, sourceEbook);
    if (eb) {
      const comparePath = await resolveConvertedMdPathForEbook({
        ebookAbsPath: eb.path,
        meta: findFileMetaRecord(params.fileMetaRecords, eb.path),
        ebookConvertOutputDir: params.ebookConvertOutputDir,
      });
      return { kind: "ebook", metaPath: eb.path, comparePath };
    }
  }

  const ct = findTxtFileByBasename(params.txtFiles, contentName);
  if (ct) {
    return { kind: "content", metaPath: ct.path, comparePath: ct.path };
  }

  return null;
}

/** 最近列表靠前为更新；返回第一个 basename 匹配且磁盘仍存在的路径 */
async function findExistingRecentPathByBasename(
  recent: readonly { path: string }[] | undefined,
  fileName: string,
): Promise<string | null> {
  const key = fileNameKey(fileName);
  if (!key || !recent?.length) return null;
  for (const item of recent) {
    const p = item.path?.trim();
    if (!p || fileNameKey(p) !== key) continue;
    try {
      const st = await window.colorTxt.stat(p);
      if (st.isFile) return p;
    } catch {
      /* 已失效，试下一条 */
    }
  }
  return null;
}

async function applyHitAndMeta(params: {
  hit: ImportHit;
  pack: ParsedReaderBookPack;
  includeProgress: boolean;
  fileMetaRecords: FileMetaRecord[];
  portraitCacheDir: string;
  confirmOverwrite: (message: string, detail?: string) => Promise<boolean>;
}): Promise<
  | {
      ok: true;
      openPath: string;
      fileMetaRecords: FileMetaRecord[];
      message: string;
      same: boolean;
    }
  | { ok: false; cancelled: true }
> {
  const { hit, pack } = params;
  let same = false;
  try {
    const diskBuf = await window.colorTxt.readFileAsArrayBuffer(hit.comparePath);
    same = arrayBuffersEqual(diskBuf, pack.content);
  } catch {
    same = false;
  }

  if (!same) {
    const ok = await params.confirmOverwrite(
      "书包内正文与本地文件内容不同，是否覆盖本地文件？",
      hit.kind === "ebook"
        ? `将覆盖转换后的 Markdown（及插图目录），不修改电子书本体：\n${hit.comparePath}`
        : hit.comparePath,
    );
    if (!ok) return { ok: false, cancelled: true };
    const imagesDirName =
      pack.manifest.imagesDirName ||
      imagesDirNameBesideContentFileName(pack.manifest.contentFileName) ||
      undefined;
    await writeContentAndImages({
      contentAbsPath: hit.comparePath,
      content: pack.content,
      imagesDirName,
      images: pack.images,
    });
  }

  const records = applyMergedMeta({
    records: params.fileMetaRecords,
    metaPath: hit.metaPath,
    pack,
    includeProgress: params.includeProgress,
    convertedMdPath: hit.kind === "ebook" ? hit.comparePath : undefined,
  });
  await writePortraitsForBook({
    sessionPathForFolder: hit.metaPath,
    portraitCacheDir: params.portraitCacheDir,
    portraits: pack.portraits,
  });

  return {
    ok: true,
    openPath: hit.metaPath,
    fileMetaRecords: records,
    same,
    message: same
      ? "已更新书签、高亮词、笔记与角色卡"
      : "已覆盖正文并更新阅读数据",
  };
}

/**
 * 导入彩读书包：
 * 1. 当前打开文件（即使未在「文件」列表）
 * 2. 「最近的文件」同名（仍存在）
 * 3. 「文件」列表同名
 * 4. 都没有 → 解压到 UnpackedBooks（同名文件同样：相同只更新 meta，不同确认覆盖）
 *
 * 命中 1～3 时若目标路径不在「文件」列表，会补进列表（侧栏加书包可见）。
 */
export async function importReaderBookPack(options: {
  packFilePath: string;
  txtFiles: TxtFileItem[];
  fileMetaRecords: FileMetaRecord[];
  ebookConvertOutputDir: string;
  portraitCacheDir: string;
  /** 设置中的解压目录；空串回退 userData/UnpackedBooks */
  bookPackUnpackDir?: string;
  /** 首次尝试密码；也可并入 tryPasswords */
  password?: string;
  /** 按序尝试的密码（空串忽略）；均失败后再 askPassword */
  tryPasswords?: readonly string[];
  /**
   * 加密包密码缺失/错误时询问用户。
   * - `string`：用该密码再解
   * - `null`：取消（打开入口）
   * - `{ skip: true }`：跳过本包（侧栏批量）
   */
  askPassword?: (
    reason: "needPassword" | "wrongPassword",
  ) => Promise<AskBookPackPasswordResult>;
  currentFilePath?: string | null;
  physicalReaderPath?: string | null;
  recentFiles?: readonly { path: string }[];
  confirmOverwrite: (message: string, detail?: string) => Promise<boolean>;
}): Promise<ImportReaderBookPackResult> {
  if (!looksLikeZipBookPackCandidate(options.packFilePath)) {
    return { ok: false, error: "不是彩读书包文件" };
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await window.colorTxt.readFileAsArrayBuffer(options.packFilePath);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const tried = new Set<string>();
  const candidates: string[] = [];
  const pushCandidate = (raw: string | undefined) => {
    const pw = (raw ?? "").trim();
    if (!pw || tried.has(pw)) return;
    tried.add(pw);
    candidates.push(pw);
  };
  pushCandidate(options.password);
  for (const p of options.tryPasswords ?? []) pushCandidate(p);

  let password = "";
  let parsed = await parseReaderBookPackZip(buffer, "");
  if (!parsed.ok && parsed.code) {
    for (const pw of candidates) {
      parsed = await parseReaderBookPackZip(buffer, pw);
      if (parsed.ok) {
        password = pw;
        break;
      }
    }
  }

  while (!parsed.ok) {
    if (
      (parsed.code === "needPassword" || parsed.code === "wrongPassword") &&
      options.askPassword
    ) {
      const next = await options.askPassword(parsed.code);
      if (next === null) return { ok: false, cancelled: true };
      if (typeof next !== "string") {
        return { ok: false, skipped: true };
      }
      password = next;
      parsed = await parseReaderBookPackZip(buffer, password);
      continue;
    }
    return { ok: false, error: parsed.error };
  }
  const pack = parsed.pack;
  const includeProgress =
    typeof pack.manifest.viewportTopPhysicalLine === "number";
  const restorePhysicalLine = includeProgress
    ? pack.manifest.viewportTopPhysicalLine
    : undefined;
  const usedPassword = password.trim() || undefined;

  const hit = await resolveImportHit({
    pack,
    txtFiles: options.txtFiles,
    fileMetaRecords: options.fileMetaRecords,
    ebookConvertOutputDir: options.ebookConvertOutputDir,
    currentFilePath: options.currentFilePath,
    physicalReaderPath: options.physicalReaderPath,
    recentFiles: options.recentFiles,
  });

  if (hit) {
    const applied = await applyHitAndMeta({
      hit,
      pack,
      includeProgress,
      fileMetaRecords: options.fileMetaRecords,
      portraitCacheDir: options.portraitCacheDir,
      confirmOverwrite: options.confirmOverwrite,
    });
    if (!applied.ok) return applied;
    // 命中「最近打开」/当前文件但尚未在「文件」列表时，补进列表（侧栏加书包依赖此行为）
    const txtFiles = await ensurePathInTxtFiles(
      options.txtFiles,
      applied.openPath,
    );
    return {
      ok: true,
      openPath: applied.openPath,
      restorePhysicalLine,
      txtFiles,
      fileMetaRecords: applied.fileMetaRecords,
      message: applied.message,
      usedPassword,
    };
  }

  // 无同名命中：解压到设置的书包解压目录（空则 UnpackedBooks）；目标路径固定为 contentFileName
  const unpackedDir = resolveBookPackUnpackDir(options.bookPackUnpackDir);
  if (!unpackedDir) {
    return { ok: false, error: "无法解析书包解压目录" };
  }
  await window.colorTxt.mkdir(unpackedDir);
  const contentAbs = joinFs(unpackedDir, pack.manifest.contentFileName);

  const unpackHit: ImportHit = {
    kind: "content",
    metaPath: contentAbs,
    comparePath: contentAbs,
  };

  // 若磁盘尚无此文件，先写入再走同一套 meta；若已有则 applyHitAndMeta 内比较/确认
  let existed = false;
  try {
    const st = await window.colorTxt.stat(contentAbs);
    if (st.isDirectory) {
      return {
        ok: false,
        error: `无法解压：目标路径已是目录\n${contentAbs}`,
      };
    }
    existed = st.isFile;
  } catch {
    existed = false;
  }

  if (!existed) {
    const imagesDirName =
      pack.manifest.imagesDirName ||
      imagesDirNameBesideContentFileName(pack.manifest.contentFileName) ||
      undefined;
    await writeContentAndImages({
      contentAbsPath: contentAbs,
      content: pack.content,
      imagesDirName,
      images: pack.images,
    });
  }

  const applied = await applyHitAndMeta({
    hit: unpackHit,
    pack,
    includeProgress,
    fileMetaRecords: options.fileMetaRecords,
    portraitCacheDir: options.portraitCacheDir,
    confirmOverwrite: options.confirmOverwrite,
  });
  if (!applied.ok) return applied;

  let size = pack.content.byteLength;
  try {
    const st = await window.colorTxt.stat(contentAbs);
    if (typeof st.size === "number") size = st.size;
  } catch {
    /* keep */
  }
  const txtFiles = mergeTxtFileLists(options.txtFiles, [
    asMatchItem(contentAbs),
  ]);
  // merge 会丢掉我们刚算的 size，补一次
  const withSize = txtFiles.map((f) =>
    f.path === contentAbs ? { ...f, size, name: basenameFromPath(contentAbs) } : f,
  );

  return {
    ok: true,
    openPath: contentAbs,
    restorePhysicalLine,
    txtFiles: withSize,
    fileMetaRecords: applied.fileMetaRecords,
    message: existed
      ? applied.message
      : "已解压书包并加入文件列表",
    usedPassword,
  };
}
