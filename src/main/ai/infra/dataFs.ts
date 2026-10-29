import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import {
  AI_DATA_CACHE_MIGRATE_FILES,
  bootstrapFilePath,
  defaultAiDataCacheRoot,
  legacyAiConfigPath,
  legacyVectorDbPath,
} from "./paths";
import { closeAiVectorDb } from "../rag/vectorDb";

export type AiFsResult = { ok: true } | { ok: false; error: string };

async function pathIsDirectory(abs: string): Promise<boolean> {
  try {
    const st = await stat(abs);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** 与角色立绘缓存迁移相同语义：子目录合并，文件 copy 后删源 */
export async function migrateDirectoryMerge(
  fromAbs: string,
  toAbs: string,
): Promise<AiFsResult> {
  const from = path.resolve(fromAbs.trim());
  const to = path.resolve(toAbs.trim());
  if (!from || !to) return { ok: false, error: "路径无效" };
  if (from === to) return { ok: true };

  if (!(await pathIsDirectory(from))) {
    await mkdir(to, { recursive: true });
    return { ok: true };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}

async function moveFileIfExists(from: string, to: string): Promise<void> {
  try {
    await stat(from);
  } catch {
    return;
  }
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

export async function readDataCacheRootBootstrap(): Promise<string | null> {
  try {
    const buf = await readFile(bootstrapFilePath(), "utf-8");
    const o = JSON.parse(buf) as { dataCacheDir?: string };
    const p = typeof o.dataCacheDir === "string" ? o.dataCacheDir.trim() : "";
    return p || null;
  } catch {
    return null;
  }
}

export async function writeDataCacheRootBootstrap(
  absDir: string,
): Promise<void> {
  const dir = path.resolve(absDir.trim());
  await mkdir(path.dirname(bootstrapFilePath()), { recursive: true });
  await writeFile(
    bootstrapFilePath(),
    `${JSON.stringify({ dataCacheDir: dir }, null, 2)}\n`,
    "utf-8",
  );
}

/** 旧版 userData/ai/config.json + vector.sqlite* → ai/data */
export async function upgradeLegacyAiDataLayoutIfNeeded(): Promise<void> {
  const boot = await readDataCacheRootBootstrap();
  if (boot) return;

  const userData = app.getPath("userData");
  const legacyCfg = legacyAiConfigPath(userData);
  const legacyDb = legacyVectorDbPath(userData);
  let hasLegacy = false;
  try {
    await stat(legacyCfg);
    hasLegacy = true;
  } catch {
    /* */
  }
  if (!hasLegacy) {
    try {
      await stat(legacyDb);
      hasLegacy = true;
    } catch {
      /* */
    }
  }
  if (!hasLegacy) {
    const target = defaultAiDataCacheRoot(userData);
    await mkdir(target, { recursive: true });
    await writeDataCacheRootBootstrap(target);
    return;
  }

  closeAiVectorDb();
  const target = defaultAiDataCacheRoot(userData);
  await mkdir(target, { recursive: true });
  for (const name of AI_DATA_CACHE_MIGRATE_FILES) {
    await moveFileIfExists(
      path.join(userData, "ai", name),
      path.join(target, name),
    );
  }
  await writeDataCacheRootBootstrap(target);
}

export async function migrateBuiltinModelCacheRoot(
  fromAbs: string,
  toAbs: string,
): Promise<AiFsResult> {
  return migrateDirectoryMerge(fromAbs, toAbs);
}

export async function migrateAiDataCacheRoot(
  fromAbs: string,
  toAbs: string,
): Promise<AiFsResult> {
  const from = path.resolve(fromAbs.trim());
  const to = path.resolve(toAbs.trim());
  if (!from || !to) return { ok: false, error: "路径无效" };
  if (from === to) return { ok: true };

  closeAiVectorDb();
  await mkdir(to, { recursive: true });

  for (const name of AI_DATA_CACHE_MIGRATE_FILES) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    try {
      await stat(src);
    } catch {
      continue;
    }
    try {
      await stat(dst);
      return {
        ok: false,
        error: `目标目录已存在 ${name}，请先备份或选择空目录。`,
      };
    } catch {
      /* ok */
    }
    try {
      await rename(src, dst);
    } catch {
      try {
        await copyFile(src, dst);
        await rm(src, { force: true });
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }

  try {
    await writeDataCacheRootBootstrap(to);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}

export async function openPathInShell(abs: string): Promise<void> {
  const { shell } = await import("electron");
  await shell.openPath(path.resolve(abs.trim()));
}
