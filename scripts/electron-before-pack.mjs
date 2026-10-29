/**
 * electron-builder beforePack：在收集依赖前裁剪项目 node_modules。
 * 须在 onNodeModuleFile 之前执行，以便写入 packPlat/packArch。
 *
 * 仅裁剪项目根 node_modules；勿扫描 appOutDir（上次构建残留的 release/win-unpacked
 * 可能含未 electron-rebuild 的 opencc，会导致误报失败）。
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setPackTarget } from "./electron-pack-context.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} cwd
 * @param {string} plat
 * @param {string} arch
 */
function runPrune(cwd, plat, arch) {
  const args = [
    "scripts/prune-pack-deps.mjs",
    "--platform",
    plat,
    "--arch",
    arch,
  ];
  execSync(`node ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
    cwd,
    stdio: "inherit",
  });
}

/** @param {import("app-builder-lib").BeforePackContext} context */
export default async function beforePack(context) {
  const plat = context.electronPlatformName;
  const arch = context.arch === 3 ? "arm64" : "x64";
  setPackTarget(plat, arch);

  const projectDir = context.packager.info.appDir ?? root;
  runPrune(projectDir, plat, arch);
}
