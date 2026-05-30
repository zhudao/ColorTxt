/**
 * 在 electron-builder 打包前裁剪项目 node_modules，减小安装包体积。
 * electron-builder 会复用已有 node_modules（见 installOrRebuild），故须在 build 脚本中、
 * electron-vite build 之后、electron-builder 之前执行。
 *
 * 裁剪同时作用于将打入 app.asar 与 app.asar.unpacked 的依赖树。
 * 打包后若需恢复完整依赖：npm ci
 *
 * 用法：node scripts/prune-pack-deps.mjs [--platform win32|darwin|linux] [--arch x64|arm64]
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nm = path.join(root, "node_modules");

/** @param {string} abs */
function rm(abs) {
  if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
}

/**
 * @param {string} dir
 * @param {(name: string, abs: string) => boolean} shouldRemove
 */
function rmFilesRecursive(dir, shouldRemove) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) rmFilesRecursive(abs, shouldRemove);
    else if (shouldRemove(ent.name, abs)) rm(abs);
  }
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let platform = process.env.npm_config_platform || process.platform;
  let arch = process.env.npm_config_arch || process.arch;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--platform" && argv[i + 1]) platform = argv[++i];
    if (argv[i] === "--arch" && argv[i + 1]) arch = argv[++i];
  }
  return resolveOnnxPlatformArch(platform, arch);
}

/**
 * @param {string} platformName
 * @param {string} archName
 */
function resolveOnnxPlatformArch(platformName, archName) {
  const name = String(platformName ?? "").toLowerCase();
  const plat =
    name === "darwin" || name === "mac" || name === "mas"
      ? "darwin"
      : name === "linux"
        ? "linux"
        : "win32";
  const a = String(archName ?? "").toLowerCase();
  const arch =
    a === "arm64" || a === "arm" || a === "aarch64" ? "arm64" : "x64";
  return { plat, arch };
}

/** @param {string} plat @param {string} arch */
function sqliteVecPlatformPackageName(plat, arch) {
  const os = plat === "win32" ? "windows" : plat;
  return `sqlite-vec-${os}-${arch}`;
}

/** @param {string} nodeModulesRoot */
function pruneOnnxRuntimeNode(nodeModulesRoot, plat, archName) {
  const ortRoot = path.join(nodeModulesRoot, "onnxruntime-node");
  const napiRoot = path.join(ortRoot, "bin", "napi-v3");
  if (!fs.existsSync(napiRoot)) return;

  for (const platformDir of fs.readdirSync(napiRoot, { withFileTypes: true })) {
    if (!platformDir.isDirectory()) continue;
    const platformPath = path.join(napiRoot, platformDir.name);
    if (platformDir.name !== plat) {
      rm(platformPath);
      continue;
    }
    for (const archDir of fs.readdirSync(platformPath, { withFileTypes: true })) {
      if (!archDir.isDirectory()) continue;
      if (archDir.name !== archName) {
        rm(path.join(platformPath, archDir.name));
      }
    }
  }
}

/** Windows 内置向量仅用 CPU；DirectML.dll 仅在使用 dml EP 时需要（约 18MB） */
function pruneOnnxDirectMl(nodeModulesRoot, plat, arch) {
  if (plat !== "win32") return;
  const dml = path.join(
    nodeModulesRoot,
    "onnxruntime-node",
    "bin",
    "napi-v3",
    "win32",
    arch,
    "DirectML.dll",
  );
  rm(dml);
}

/** @param {string} nodeModulesRoot */
function pruneOnnxRuntimeNodePackage(nodeModulesRoot) {
  const ortRoot = path.join(nodeModulesRoot, "onnxruntime-node");
  if (!fs.existsSync(ortRoot)) return;

  for (const extra of ["lib", "script", "README.md"]) {
    rm(path.join(ortRoot, extra));
  }

  const distDir = path.join(ortRoot, "dist");
  if (!fs.existsSync(distDir)) return;
  for (const name of fs.readdirSync(distDir)) {
    if (name.endsWith(".map")) rm(path.join(distDir, name));
  }
}

/** @param {string} nodeModulesRoot */
function pruneOnnxRuntimeCommon(nodeModulesRoot) {
  const pkgRoot = path.join(nodeModulesRoot, "onnxruntime-common");
  if (!fs.existsSync(pkgRoot)) return;

  rm(path.join(pkgRoot, "lib"));
  rm(path.join(pkgRoot, "README.md"));
  const distDir = path.join(pkgRoot, "dist");
  rmFilesRecursive(
    distDir,
    (name) => name.endsWith(".map") || name.endsWith(".d.ts"),
  );
}

/** 与 package.json exports.node 一致，仅保留 node 入口（勿用未导出的 dist 子路径） */
function pruneTransformersPackage(nodeModulesRoot) {
  const pkgRoot = path.join(nodeModulesRoot, "@huggingface", "transformers");
  const distDir = path.join(pkgRoot, "dist");
  if (!fs.existsSync(distDir)) return;

  const keepDist = new Set(["transformers.node.mjs"]);

  for (const name of fs.readdirSync(distDir)) {
    if (!keepDist.has(name)) rm(path.join(distDir, name));
  }
  rm(path.join(pkgRoot, "src"));
  rm(path.join(pkgRoot, "types"));
  rm(path.join(pkgRoot, "README.md"));
  rm(path.join(pkgRoot, "node_modules", "sharp"));
}

/** @param {string} nodeModulesRoot */
function pruneHuggingfaceJinja(nodeModulesRoot) {
  const pkgRoot = path.join(nodeModulesRoot, "@huggingface", "jinja");
  if (!fs.existsSync(pkgRoot)) return;

  rm(path.join(pkgRoot, "src"));
  rm(path.join(pkgRoot, "tsconfig.json"));
  rm(path.join(pkgRoot, "README.md"));
  const distDir = path.join(pkgRoot, "dist");
  rmFilesRecursive(distDir, (name) => name.endsWith(".d.ts.map"));
}

/** 运行时只需 build/Release/*.node 与 lib/；deps/sqlite3.c 等为编译期产物 */
function pruneBetterSqlite3(nodeModulesRoot) {
  const pkgRoot = path.join(nodeModulesRoot, "better-sqlite3");
  if (!fs.existsSync(pkgRoot)) return;

  for (const name of ["deps", "src", "binding.gyp", "README.md"]) {
    rm(path.join(pkgRoot, name));
  }
}

/**
 * font-list 按平台动态 require；打包目标平台外的不需要。
 * @param {string} nodeModulesRoot
 * @param {string} plat
 */
function pruneFontList(nodeModulesRoot, plat) {
  const pkgRoot = path.join(nodeModulesRoot, "font-list");
  if (!fs.existsSync(pkgRoot)) return;

  const libs = path.join(pkgRoot, "libs");
  const platformDirs = {
    darwin: "darwin",
    linux: "linux",
    win32: "win32",
  };
  for (const [p, dir] of Object.entries(platformDirs)) {
    if (p !== plat) rm(path.join(libs, dir));
  }

  // 主进程 ESM 的 `import "font-list"` 走 package exports → index.mjs，不可删
  for (const name of [
    "demo.js",
    "test-commonjs.js",
    "test-esm.mjs",
    "README.md",
    "index.d.ts",
    "index.d.cts",
    "index.d.mts",
  ]) {
    rm(path.join(pkgRoot, name));
  }
}

/**
 * 仅保留当前平台的 sqlite-vec 原生扩展包；精简元数据文件。
 * @param {string} nodeModulesRoot
 * @param {string} plat
 * @param {string} arch
 */
function pruneSqliteVec(nodeModulesRoot, plat, arch) {
  const pkgRoot = path.join(nodeModulesRoot, "sqlite-vec");
  if (fs.existsSync(pkgRoot)) {
    rm(path.join(pkgRoot, "README.md"));
    rm(path.join(pkgRoot, "index.d.ts"));
  }

  const keep = sqliteVecPlatformPackageName(plat, arch);
  for (const ent of fs.readdirSync(nodeModulesRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith("sqlite-vec-") && ent.name !== keep) {
      rm(path.join(nodeModulesRoot, ent.name));
    }
  }

  const platRoot = path.join(nodeModulesRoot, keep);
  if (fs.existsSync(platRoot)) rm(path.join(platRoot, "README.md"));
}

/** onnxruntime-web 删除后常留在顶层的孤儿包（仅 web 推理链使用） */
function pruneOnnxWebOrphans(nodeModulesRoot) {
  rm(path.join(nodeModulesRoot, "@protobufjs"));
  for (const name of [
    "protobufjs",
    "flatbuffers",
    "guid-typescript",
    "long",
    "platform",
  ]) {
    rm(path.join(nodeModulesRoot, name));
  }
}

/** 仅 install / node-gyp 阶段需要，打包后运行时不加载 */
function pruneInstallOnlyPackages(nodeModulesRoot) {
  for (const name of [
    "prebuild-install",
    "napi-build-utils",
    "node-abi",
    "expand-template",
    "mkdirp-classic",
    "deep-extend",
    "fs-constants",
    "github-from-package",
    "ini",
    "rc",
    "simple-concat",
    "simple-get",
    "tunnel-agent",
    "strip-json-comments",
    "tar-fs",
    "tar-stream",
  ]) {
    rm(path.join(nodeModulesRoot, name));
  }
}

/** 全树去掉 source map 与常见文档（不影响 require） */
function pruneGlobalPackArtifacts(nodeModulesRoot) {
  rmFilesRecursive(nodeModulesRoot, (name) => name.endsWith(".map"));
  rmFilesRecursive(
    nodeModulesRoot,
    (name) => name === "README.md" || name === "CHANGELOG.md",
  );
}

/**
 * 从 transformers 的 package.json 去掉已裁剪的 web/sharp 依赖，避免 electron-builder
 * 收集依赖时 npm ls 报 ELSPROBLEMS（missing / extraneous）。
 * @param {string} nodeModulesRoot
 */
/**
 * @param {string} pkgPath
 * @param {string[]} drop
 */
function patchPackageManifestDeps(pkgPath, drop) {
  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const block = pkg[field];
    if (!block || typeof block !== "object") continue;
    for (const name of drop) delete block[name];
    if (Object.keys(block).length === 0) delete pkg[field];
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg)}\n`);
}

/** 避免 electron-builder 收集依赖时 npm ls 报 missing prebuild-install */
function patchBetterSqlite3Manifest(nodeModulesRoot) {
  patchPackageManifestDeps(
    path.join(nodeModulesRoot, "better-sqlite3", "package.json"),
    ["prebuild-install"],
  );
}

function patchTransformersManifest(nodeModulesRoot) {
  patchPackageManifestDeps(
    path.join(nodeModulesRoot, "@huggingface", "transformers", "package.json"),
    ["onnxruntime-web", "sharp"],
  );
}

const SHARP_STUB_SRC = path.join(root, "scripts", "sharp-pack-stub");

/** @param {string} pkgRoot */
function isSharpPackStub(pkgRoot) {
  const pkgPath = path.join(pkgRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version === "0.0.0-colortxt-stub";
  } catch {
    return false;
  }
}

/** transformers 顶层 import "sharp"；用轻量 stub 替代完整 native 包（约数百 KB vs 数十 MB） */
function ensureSharpPackStub(nodeModulesRoot) {
  const dest = path.join(nodeModulesRoot, "sharp");
  if (isSharpPackStub(dest)) return;
  rm(dest);
  if (!fs.existsSync(SHARP_STUB_SRC)) {
    console.warn("[prune-pack-deps] skip sharp stub: scripts/sharp-pack-stub missing");
    return;
  }
  fs.cpSync(SHARP_STUB_SRC, dest, { recursive: true });
}

/** 仅保留当前平台的 @node-rs/jieba-* 原生扩展包 */
function pruneJiebaPlatformPackages(nodeModulesRoot, plat, arch) {
  const jiebaRoot = path.join(nodeModulesRoot, "@node-rs", "jieba");
  if (fs.existsSync(jiebaRoot)) {
    rm(path.join(jiebaRoot, "README.md"));
  }
  const scope = path.join(nodeModulesRoot, "@node-rs");
  if (!fs.existsSync(scope)) return;
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
  const keep = `jieba-${platToken}`;
  for (const ent of fs.readdirSync(scope, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith("jieba-") && ent.name !== keep) {
      rm(path.join(scope, ent.name));
    }
  }
}

function main() {
  if (!fs.existsSync(nm)) {
    console.warn("[prune-pack-deps] skip: node_modules not found");
    return;
  }

  const { plat, arch } = parseArgs();
  const beforeMb = dirSizeMb(nm);

  rm(path.join(nm, "onnxruntime-web"));
  rm(path.join(nm, "@img"));
  ensureSharpPackStub(nm);
  pruneOnnxWebOrphans(nm);

  pruneBetterSqlite3(nm);
  pruneFontList(nm, plat);
  pruneSqliteVec(nm, plat, arch);
  pruneJiebaPlatformPackages(nm, plat, arch);
  pruneInstallOnlyPackages(nm);
  patchBetterSqlite3Manifest(nm);

  pruneOnnxRuntimeNode(nm, plat, arch);
  pruneOnnxRuntimeNodePackage(nm);
  pruneOnnxDirectMl(nm, plat, arch);
  pruneOnnxRuntimeCommon(nm);

  pruneTransformersPackage(nm);
  pruneHuggingfaceJinja(nm);
  patchTransformersManifest(nm);

  pruneGlobalPackArtifacts(nm);

  const afterMb = dirSizeMb(nm);
  const saved = Math.max(0, Number.parseFloat(beforeMb) - Number.parseFloat(afterMb));

  const ortMb = dirSizeMb(path.join(nm, "onnxruntime-node"));
  const hfMb = dirSizeMb(path.join(nm, "@huggingface"));
  const sqliteMb = dirSizeMb(path.join(nm, "better-sqlite3"));
  console.log(
    `[prune-pack-deps] ${plat}/${arch} done; node_modules ${beforeMb}MB → ${afterMb}MB (−${saved.toFixed(1)}MB); better-sqlite3≈${sqliteMb}MB onnxruntime-node≈${ortMb}MB @huggingface≈${hfMb}MB`,
  );
}

/** @param {string} abs */
function dirSizeMb(abs) {
  if (!fs.existsSync(abs)) return "0";
  let sum = 0;
  for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, f.name);
    if (f.isDirectory()) sum += Number.parseFloat(dirSizeMb(p)) * 1024 * 1024;
    else if (f.isFile()) sum += fs.statSync(p).size;
  }
  return (sum / (1024 * 1024)).toFixed(1);
}

main();
