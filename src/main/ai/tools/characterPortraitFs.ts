import { copyFile, cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * 将旧角色立绘缓存根下的子项合并迁入新根（同名子目录则递归合并）。
 */
export async function migrateCharacterPortraitCacheRoot(
  fromAbs: string,
  toAbs: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const from = path.resolve(fromAbs.trim());
  const to = path.resolve(toAbs.trim());
  if (!from || !to) {
    return { ok: false, error: "路径无效" };
  }
  if (from === to) {
    return { ok: true };
  }

  let fromStat: Awaited<ReturnType<typeof stat>>;
  try {
    fromStat = await stat(from);
  } catch {
    await mkdir(to, { recursive: true });
    return { ok: true };
  }
  if (!fromStat.isDirectory()) {
    return { ok: false, error: "源路径不是目录" };
  }

  try {
    await mkdir(to, { recursive: true });
    const names = await readdir(from);
    for (const name of names) {
      const sFrom = path.join(from, name);
      const sTo = path.join(to, name);
      const st = await stat(sFrom);
      if (st.isDirectory()) {
        let destIsDir = false;
        try {
          const t = await stat(sTo);
          destIsDir = t.isDirectory();
        } catch {
          destIsDir = false;
        }
        if (destIsDir) {
          await cp(sFrom, sTo, { recursive: true });
          await rm(sFrom, { recursive: true, force: true });
        } else {
          await rename(sFrom, sTo);
        }
      } else {
        try {
          await copyFile(sFrom, sTo);
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        await rm(sFrom, { force: true });
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  return { ok: true };
}

/** 复制图片到目标绝对路径（覆盖）；确保父目录存在 */
export async function copyImageToAbsolutePath(
  sourceAbs: string,
  destAbs: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const src = path.resolve(sourceAbs.trim());
  const dst = path.resolve(destAbs.trim());
  if (!src || !dst) return { ok: false, error: "路径无效" };
  try {
    await mkdir(path.dirname(dst), { recursive: true });
    await copyFile(src, dst);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
