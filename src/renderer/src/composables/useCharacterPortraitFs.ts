import { computed, reactive, ref, watch, type Ref } from "vue";
import type { CharacterRosterEntry } from "@shared/characterTypes";
import {
  characterPortraitImageAbs,
  characterPortraitImageAbsCandidates,
  characterPortraitSessionDraftImageAbs,
  characterPortraitSessionDraftImageAbsCandidates,
  characterPortraitTmpImageAbs,
  normalizePortraitImageExtension,
  sanitizeBookFolderSegment,
} from "@shared/characterPortraitPaths";

/**
 * 立绘路径不变量（P0）— 所有读写须遵守，避免 draft / `_tmp` / 正式文件分叉：
 *
 * 1. **edit session key**（`portraitEditSessionKey`）
 *    - 编辑已有角色：等于角色 `id`
 *    - 添加角色：打开抽屉时生成一次性 uuid
 *    - 仅用于定位「待保存」会话草稿文件；关闭抽屉 / 换书时清空，并删除对应草稿
 *
 * 2. **canonical portrait path**（正式立绘）
 *    - `{cacheRoot}/{bookFolderSegment}/{sanitize(displayName)}.{ext}`
 *    - `ext` 与源图一致（文生图固定 `png`）；只改主干文件名，不改写后缀
 *    - 由 `characterPortraitImageAbs` 生成；roster 卡片 URL、保存入库、导入导出读写此路径
 *    - 仅在「保存角色」或包导入时写入；生成预览与抽屉上传不得直接覆盖
 *    - 换后缀保存时须删除同主干的其它扩展名文件，避免残留
 *
 * 3. **`_tmp` portrait path**（文生图临时预览）
 *    - `{cacheRoot}/{bookFolderSegment}/{sanitize(displayName)}_tmp.png`
 *    - 由 `characterPortraitTmpImageAbs` 生成；txt2img 输出落此路径
 *    - 「应用」时复制到 session-draft，再删除 `_tmp`；打开/关闭生成弹窗时清理残留
 *
 * 4. **session-draft portrait path**（编辑抽屉待保存）
 *    - `{cacheRoot}/{bookFolderSegment}/_char_draft_{sessionKey}.{ext}`
 *    - 由 `characterPortraitSessionDraftImageAbs` 生成；上传/拖放/生成「应用」写入此路径
 *    - 预览优先读草稿，再回落 canonical；「保存角色」时复制到 canonical 并删除草稿
 */

/** 在可读 URL 上追加 `?t=` / `&t=`，避免同路径文件被替换后浏览器仍用旧缓存 */
export function withUrlCacheBust(url: string, t: number = Date.now()): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${t}`;
}

function rosterPortraitFingerprint(
  roster: readonly CharacterRosterEntry[],
): string {
  return roster
    .map((e) => `${e.id}\0${e.displayName.trim()}`)
    .sort()
    .join("\n");
}

async function firstExistingFileAbs(
  candidates: readonly string[],
): Promise<string | null> {
  for (const p of candidates) {
    try {
      const st = await window.colorTxt.stat(p);
      if (st.isFile) return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function removeFilesIfExist(paths: readonly string[]): Promise<void> {
  for (const p of paths) {
    try {
      const st = await window.colorTxt.stat(p);
      if (st.isFile) await window.colorTxt.removePath(p);
    } catch {
      /* ignore */
    }
  }
}

export function useCharacterPortraitFs(opts: {
  characterPortraitCacheDir: Ref<string>;
  sessionFilePath: Ref<string | null>;
  physicalReaderPath: Ref<string | null>;
  characterRoster: Ref<readonly CharacterRosterEntry[]>;
}) {
  /** 编辑抽屉内待保存立绘会话键：编辑时为角色 id，添加时为 uuid */
  const portraitEditSessionKey = ref("");

  const portraitUrlById = reactive<Record<string, string>>({});

  const bookFolderSegment = computed(() =>
    sanitizeBookFolderSegment(
      opts.sessionFilePath.value ?? opts.physicalReaderPath.value ?? "",
    ),
  );

  async function resolveCacheRootAbs(): Promise<string> {
    const d = opts.characterPortraitCacheDir.value.trim();
    if (d) return d;
    return window.colorTxt.getDefaultCharacterPortraitCacheDir();
  }

  /** 写入用正式立绘路径（指定后缀） */
  async function portraitAbsForDisplayName(
    displayName: string,
    ext = "png",
  ): Promise<string> {
    const root = await resolveCacheRootAbs();
    return characterPortraitImageAbs(
      root,
      bookFolderSegment.value,
      displayName,
      ext,
    );
  }

  /** 解析已存在的正式立绘（任一允许后缀）；无则 null */
  async function resolvePortraitAbsForDisplayName(
    displayName: string,
  ): Promise<string | null> {
    const name = displayName.trim();
    if (!name) return null;
    const root = await resolveCacheRootAbs();
    return firstExistingFileAbs(
      characterPortraitImageAbsCandidates(root, bookFolderSegment.value, name),
    );
  }

  async function portraitTmpAbsForDisplayName(
    displayName: string,
  ): Promise<string> {
    const root = await resolveCacheRootAbs();
    return characterPortraitTmpImageAbs(
      root,
      bookFolderSegment.value,
      displayName,
    );
  }

  /** 写入用 session-draft 路径（指定后缀） */
  async function portraitSessionDraftAbs(
    sessionKey: string,
    ext = "png",
  ): Promise<string> {
    const root = await resolveCacheRootAbs();
    return characterPortraitSessionDraftImageAbs(
      root,
      bookFolderSegment.value,
      sessionKey,
      ext,
    );
  }

  /** 解析已存在的 session-draft（任一允许后缀） */
  async function resolvePortraitSessionDraftAbs(
    sessionKey: string,
    bookSegment?: string,
  ): Promise<string | null> {
    const sk = sessionKey.trim();
    const seg = (bookSegment ?? bookFolderSegment.value).trim();
    if (!sk || !seg) return null;
    const root = await resolveCacheRootAbs();
    return firstExistingFileAbs(
      characterPortraitSessionDraftImageAbsCandidates(root, seg, sk),
    );
  }

  async function deletePortraitSessionDraftFileAt(
    sessionKey: string,
    bookSegment: string,
  ): Promise<void> {
    const sk = sessionKey.trim();
    if (!sk || !bookSegment.trim()) return;
    try {
      const root = await resolveCacheRootAbs();
      await removeFilesIfExist(
        characterPortraitSessionDraftImageAbsCandidates(
          root,
          bookSegment,
          sk,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  async function deletePortraitSessionDraftFile(
    sessionKey: string,
  ): Promise<void> {
    await deletePortraitSessionDraftFileAt(sessionKey, bookFolderSegment.value);
  }

  /**
   * 删除同角色主干下除保留路径以外的正式立绘（换后缀保存时清理旧文件）。
   * `keepExt` 为空则删除全部允许后缀。
   */
  async function removeSiblingPortraitFilesByDisplayName(
    displayName: string,
    keepExt?: string,
  ): Promise<void> {
    const name = displayName.trim();
    if (!name) return;
    const root = await resolveCacheRootAbs();
    const candidates = characterPortraitImageAbsCandidates(
      root,
      bookFolderSegment.value,
      name,
    );
    if (!keepExt) {
      await removeFilesIfExist(candidates);
      return;
    }
    const keepPath = characterPortraitImageAbs(
      root,
      bookFolderSegment.value,
      name,
      keepExt,
    );
    await removeFilesIfExist(candidates.filter((p) => p !== keepPath));
  }

  /** 按角色显示名删除正式立绘（全部后缀）与文生图临时 `_tmp` 文件 */
  async function removeCharacterPortraitFilesByDisplayName(
    displayName: string,
  ): Promise<void> {
    const name = displayName.trim();
    if (!name) return;
    await removeSiblingPortraitFilesByDisplayName(name);
    try {
      const tmpAbs = await portraitTmpAbsForDisplayName(name);
      const st = await window.colorTxt.stat(tmpAbs);
      if (st.isFile) await window.colorTxt.removePath(tmpAbs);
    } catch {
      /* ignore */
    }
  }

  async function portraitPreviewReadableUrl(
    displayName: string,
  ): Promise<string | null> {
    const trimmed = displayName.trim();
    if (!trimmed) return null;
    try {
      const p = await resolvePortraitAbsForDisplayName(trimmed);
      if (!p) return null;
      const raw = await window.colorTxt.pathToReadableLocalUrl(p);
      if (!raw) return null;
      return withUrlCacheBust(raw);
    } catch {
      return null;
    }
  }

  /** 立绘可读 URL：会话草稿（上传/应用中未入库）优先，再走正式路径。 */
  async function readablePortraitDraftThenCanonical(optsReadable: {
    displayName: string;
    sessionKey: string;
  }): Promise<string | null> {
    const name = optsReadable.displayName.trim();
    const sk = optsReadable.sessionKey.trim();
    if (sk) {
      try {
        const draftP = await resolvePortraitSessionDraftAbs(sk);
        if (draftP) {
          const raw = await window.colorTxt.pathToReadableLocalUrl(draftP);
          if (raw) return withUrlCacheBust(raw);
        }
      } catch {
        /* 无草稿或不可读 */
      }
    }
    if (!name) return null;
    return portraitPreviewReadableUrl(name);
  }

  async function refreshPortraitUrlForEntry(
    e: CharacterRosterEntry,
    options?: { force?: boolean },
  ) {
    const name = e.displayName.trim();
    if (!name) {
      delete portraitUrlById[e.id];
      return;
    }
    const p = await resolvePortraitAbsForDisplayName(name);
    try {
      if (p) {
        const url = await window.colorTxt.pathToReadableLocalUrl(p);
        if (url) {
          const existing = portraitUrlById[e.id];
          if (
            !options?.force &&
            existing &&
            existing.split(/[?#]/)[0] === url.split(/[?#]/)[0]
          ) {
            return;
          }
          portraitUrlById[e.id] = withUrlCacheBust(url);
        } else delete portraitUrlById[e.id];
      } else {
        delete portraitUrlById[e.id];
      }
    } catch {
      delete portraitUrlById[e.id];
    }
  }

  async function refreshAllPortraitUrls() {
    for (const e of opts.characterRoster.value) {
      await refreshPortraitUrlForEntry(e);
    }
  }

  /**
   * 将本地图片复制到当前 edit session 的 session-draft（保留源后缀）。
   * @returns 是否写入成功（失败时默认弹窗提示；`quiet` 时由调用方自行提示）
   */
  async function applyPortraitFromFilePath(
    fromPath: string,
    options?: { quiet?: boolean },
  ): Promise<boolean> {
    const sk = portraitEditSessionKey.value.trim();
    if (!sk) {
      if (!options?.quiet) {
        await window.colorTxt.alert("请关闭并重新打开编辑面板后再试。");
      }
      return false;
    }
    const src = fromPath.trim();
    const ext = normalizePortraitImageExtension(src);
    const dest = await portraitSessionDraftAbs(sk, ext);
    const root = await resolveCacheRootAbs();
    const allDrafts = characterPortraitSessionDraftImageAbsCandidates(
      root,
      bookFolderSegment.value,
      sk,
    );
    await removeFilesIfExist(allDrafts.filter((p) => p !== dest));
    const cp = await window.colorTxt.characterPortrait.copyFileTo({
      from: src,
      to: dest,
    });
    if (!cp.ok) {
      if (!options?.quiet) {
        await window.colorTxt.alert(cp.error ?? "上传失败");
      }
      return false;
    }
    return true;
  }

  watch(
    () =>
      [
        opts.sessionFilePath.value,
        opts.physicalReaderPath.value,
        opts.characterPortraitCacheDir.value,
        rosterPortraitFingerprint(opts.characterRoster.value),
      ] as const,
    () => {
      void refreshAllPortraitUrls();
    },
  );

  return {
    portraitEditSessionKey,
    portraitUrlById,
    bookFolderSegment,
    resolveCacheRootAbs,
    portraitAbsForDisplayName,
    resolvePortraitAbsForDisplayName,
    portraitTmpAbsForDisplayName,
    portraitSessionDraftAbs,
    resolvePortraitSessionDraftAbs,
    deletePortraitSessionDraftFileAt,
    deletePortraitSessionDraftFile,
    removeSiblingPortraitFilesByDisplayName,
    removeCharacterPortraitFilesByDisplayName,
    portraitPreviewReadableUrl,
    readablePortraitDraftThenCanonical,
    refreshPortraitUrlForEntry,
    refreshAllPortraitUrls,
    applyPortraitFromFilePath,
  };
}
