import { app } from "electron";
import path from "node:path";
import { createRequire } from "node:module";

/** 打包后 sqlite-vec 平台包需在 app.asar.unpacked 下才能 loadExtension */
export function resolveSqliteVecLoadPath(): string {
  const req = createRequire(import.meta.url);
  const mod = req("sqlite-vec") as { getLoadablePath: () => string };
  let p = mod.getLoadablePath();
  if (app.isPackaged) {
    const needle = `${path.sep}app.asar${path.sep}`;
    const repl = `${path.sep}app.asar.unpacked${path.sep}`;
    if (p.includes(needle)) p = p.split(needle).join(repl);
  }
  return p;
}
