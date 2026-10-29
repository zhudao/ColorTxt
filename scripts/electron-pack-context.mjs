/** electron-builder 打包阶段共享的平台/架构上下文（beforePack → onNodeModuleFile） */
export let packPlat = null;
export let packArch = null;

/** @param {string} plat @param {string} arch */
export function setPackTarget(plat, arch) {
  packPlat = plat;
  packArch = arch;
}

/** @returns {{ plat: string, arch: string } | null} */
export function resolvePackTarget() {
  if (packPlat && packArch) return { plat: packPlat, arch: packArch };
  const plat = process.env.COLORTXT_PRUNE_PLATFORM;
  const arch = process.env.COLORTXT_PRUNE_ARCH;
  if (plat && arch) return { plat, arch };
  return null;
}

/** @param {string} plat @param {string} arch */
export function jiebaKeepName(plat, arch) {
  const platToken =
    plat === "darwin"
      ? arch === "arm64"
        ? "darwin-arm64"
        : "darwin-x64"
      : plat === "linux"
        ? arch === "arm64"
          ? "linux-arm64-gnu"
          : "linux-x64-gnu"
        : arch === "arm64"
          ? "win32-arm64-msvc"
          : "win32-x64-msvc";
  return `jieba-${platToken}`;
}

/** @param {string} plat @param {string} arch */
export function sqliteKeepName(plat, arch) {
  const os = plat === "win32" ? "windows" : plat;
  return `sqlite-vec-${os}-${arch}`;
}

/** @param {string} plat @param {string} arch */
export function onnxArchDirsToKeep(plat, arch) {
  if (plat === "linux" && arch === "x64") return ["x64", "x86_64"];
  return [arch];
}

/**
 * opencc 预编译目录名（`prebuilds/{name}/opencc.node`）。
 * macOS x64 无预编译包，打包保留 `build/Release/opencc.node`（electron-rebuild 产物）。
 * @param {string} plat
 * @param {string} arch
 * @returns {string | null}
 */
export function openccPrebuildDir(plat, arch) {
  if (plat === "darwin") {
    return arch === "arm64" ? "darwin-arm64" : null;
  }
  if (plat === "linux") {
    return arch === "arm64" ? "linux-arm64" : "linux-x64";
  }
  if (plat === "win32") {
    return "win32-x64";
  }
  return null;
}

/** @param {string} file */
export function normalizePackPath(file) {
  return file.replace(/\\/g, "/");
}

/** `require("koffi")` 的 CJS 链；其余是源码、文档和类型。 */
const KOFFI_RUNTIME_FILES = new Set([
  "package.json",
  "LICENSE.txt",
  "index.cjs",
  "src/koffi/index.cjs",
  "src/koffi/src/static.cjs",
]);

/**
 * @param {string} rel
 * @param {Set<string>} keepFiles
 */
function isKeptRel(rel, keepFiles) {
  if (keepFiles.has(rel)) return true;
  for (const keep of keepFiles) {
    if (keep.startsWith(`${rel}/`)) return true;
  }
  return false;
}

/**
 * koffi 仅 macOS 摸鱼窗用。非 darwin 整包排除；darwin 只留当前架构的加载器和 `.node`。
 * @param {string} file
 * @param {string} plat
 * @param {string} arch
 * @returns {boolean | null} null 表示不是 koffi 路径
 */
export function shouldKeepKoffiFile(file, plat, arch) {
  const f = normalizePackPath(file);
  const jsPkg = f.match(/\/node_modules\/koffi(?:\/(.*))?$/);
  if (jsPkg) {
    if (plat !== "darwin") return false;
    const rel = jsPkg[1];
    if (rel == null || rel === "") return true;
    return isKeptRel(rel, KOFFI_RUNTIME_FILES);
  }
  const nativePkg = f.match(/\/node_modules\/@koromix\/(koffi-[^/]+)(?:\/(.*))?$/);
  if (!nativePkg) return null;
  if (plat !== "darwin") return false;
  const keepName = arch === "arm64" ? "koffi-darwin-arm64" : "koffi-darwin-x64";
  if (nativePkg[1] !== keepName) return false;
  const rel = nativePkg[2];
  if (rel == null || rel === "") return true;
  const nodeDir = arch === "arm64" ? "darwin_arm64" : "darwin_x64";
  return isKeptRel(
    rel,
    new Set(["package.json", "index.js", `${nodeDir}/koffi.node`]),
  );
}

/**
 * 在 electron-builder 收集 node_modules 时排除非当前平台的文件。
 * @param {string} file
 * @returns {boolean | void} false = 排除
 */
export function shouldIncludeNodeModuleFile(file) {
  const target = resolvePackTarget();
  if (!target) return;

  const { plat: activePlat, arch: activeArch } = target;
  const f = normalizePackPath(file);

  if (
    f.includes("/node_modules/onnxruntime-web/") ||
    f.endsWith("/node_modules/onnxruntime-web") ||
    f.includes("/node_modules/@img/")
  ) {
    return false;
  }

  const sqliteKeep = sqliteKeepName(activePlat, activeArch);
  for (const m of f.matchAll(/node_modules\/(sqlite-vec-[^/]+)/g)) {
    if (m[1].startsWith("sqlite-vec-") && m[1] !== sqliteKeep) return false;
  }

  const jiebaKeep = jiebaKeepName(activePlat, activeArch);
  for (const m of f.matchAll(/node_modules\/@node-rs\/(jieba-[^/]+)/g)) {
    if (m[1].startsWith("jieba-") && m[1] !== jiebaKeep) return false;
  }

  if (f.includes("/onnxruntime-node/bin/napi-v3/")) {
    const match = f.match(/onnxruntime-node\/bin\/napi-v3\/([^/]+)(?:\/([^/]+))?/);
    if (match) {
      const [, platform, archDir] = match;
      if (platform !== activePlat) return false;
      if (archDir && !onnxArchDirsToKeep(activePlat, activeArch).includes(archDir)) {
        return false;
      }
    }
  }

  if (f.includes("/@huggingface/transformers/dist/")) {
    if (!f.endsWith("/transformers.node.mjs")) return false;
  }

  // koffi 仅 macOS 摸鱼窗设置系统缩放光标；非 darwin 整包丢掉，darwin 只留加载器和 .node。
  if (shouldKeepKoffiFile(f, activePlat, activeArch) === false) return false;

  if (f.includes("/node_modules/opencc/")) {
    for (const drop of [
      "/node_modules/opencc/deps/",
      "/node_modules/opencc/src/",
      "/node_modules/opencc/data/",
      "/node_modules/opencc/scripts/",
      "/node_modules/opencc/bin/",
      "/node_modules/opencc/binding.gyp",
    ]) {
      if (f.includes(drop) || f.endsWith(drop.replace(/\/$/, ""))) return false;
    }
    for (const m of f.matchAll(/node_modules\/opencc\/prebuilds\/([^/]+)/g)) {
      if (m[1] !== "assets") return false;
    }
    if (f.includes("/node_modules/opencc/build/")) {
      if (!f.includes("/node_modules/opencc/build/Release/opencc.node")) {
        return false;
      }
    }
  }

  return undefined;
}
