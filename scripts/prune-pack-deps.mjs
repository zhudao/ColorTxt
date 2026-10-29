/**
 * 在 electron-builder 打包前裁剪项目 node_modules，减小安装包体积。
 * electron-builder 会复用已有 node_modules（见 installOrRebuild），故须在 build 脚本中、
 * electron-vite build 之后、electron-builder 之前执行。
 *
 * 裁剪同时作用于将打入 app.asar 与 app.asar.unpacked 的依赖树。
 * 打包后若需恢复完整依赖：npm ci
 *
 * 用法：node scripts/prune-pack-deps.mjs [--platform win32|darwin|linux] [--arch x64|arm64] [--node-modules <path>]
 *
 * 交叉编译（如 macos-latest arm64 打 darwin-x64）：npm ci 不会安装目标架构的 optional
 * 原生包；本脚本会在裁剪前补装并校验 @node-rs/jieba-* / sqlite-vec-*。opencc /
 * better-sqlite3 依赖 electron-rebuild，须在目标架构上重建（CI macOS-x64 用
 * macos-15-intel）；darwin 打包前用 lipo 校验 Mach-O，避免打入错误架构的 .node。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  jiebaKeepName,
  shouldKeepKoffiFile,
  sqliteKeepName,
} from "./electron-pack-context.mjs";

const root = process.cwd();

/** @param {string} abs */
function rm(abs) {
  if (!fs.existsSync(abs)) return;
  fs.rmSync(abs, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
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
  let nodeModulesRoot = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--platform" && argv[i + 1]) platform = argv[++i];
    if (argv[i] === "--arch" && argv[i + 1]) arch = argv[++i];
    if (argv[i] === "--node-modules" && argv[i + 1]) {
      nodeModulesRoot = path.resolve(argv[++i]);
    }
  }
  const { plat, arch: archName } = resolveOnnxPlatformArch(platform, arch);
  return {
    plat,
    arch: archName,
    nm: nodeModulesRoot ?? path.join(root, "node_modules"),
  };
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
  return sqliteKeepName(plat, arch);
}

/** @param {string} dir */
function dirHasNativeBinary(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const name of fs.readdirSync(dir)) {
    if (/\.(node|dylib|dll|so)$/i.test(name)) return true;
  }
  return false;
}

/**
 * 在 darwin 宿主上校验 .node 的 Mach-O 架构与打包目标一致。
 * @param {string} filePath
 * @param {string} arch x64 | arm64
 * @param {string} label
 */
function assertDarwinMachOArch(filePath, arch, label) {
  if (process.platform !== "darwin") return;
  if (!fs.existsSync(filePath)) return;
  const want = arch === "arm64" ? "arm64" : "x86_64";
  let archs = "";
  try {
    archs = execSync(`lipo -archs ${JSON.stringify(filePath)}`, {
      encoding: "utf8",
      shell: true,
    }).trim();
  } catch {
    try {
      archs = execSync(`file ${JSON.stringify(filePath)}`, {
        encoding: "utf8",
        shell: true,
      }).trim();
    } catch (err) {
      console.error(
        `[prune-pack-deps] ${label}: cannot inspect Mach-O arch of ${filePath}`,
        err,
      );
      process.exit(1);
    }
  }
  if (!archs.includes(want)) {
    console.error(
      `[prune-pack-deps] ${label}: expected Mach-O ${want} for darwin/${arch}, got "${archs}" (${filePath}). Rebuild with electron-rebuild --arch ${arch} on a matching host (CI: macos-15-intel for x64).`,
    );
    process.exit(1);
  }
}

/**
 * 读取父包 optionalDependencies 中的版本；缺省则用父包 version。
 * @param {string} parentPkgJson
 * @param {string} depName
 */
function readOptionalDepVersion(parentPkgJson, depName) {
  if (!fs.existsSync(parentPkgJson)) return null;
  const pkg = JSON.parse(fs.readFileSync(parentPkgJson, "utf8"));
  const fromOpt = pkg.optionalDependencies?.[depName];
  if (typeof fromOpt === "string" && fromOpt.trim()) {
    return fromOpt.replace(/^[\^~>=<\s]+/, "");
  }
  if (typeof pkg.version === "string" && pkg.version.trim()) return pkg.version;
  return null;
}

/**
 * 交叉编译时显式安装目标平台 optional 原生包（npm ci 只装宿主架构）。
 * 用 `npm pack` + 解压拷贝，避开 `npm install` 的 os/cpu 拒绝与对项目依赖树的改动。
 * @param {{
 *   packageName: string,
 *   destDir: string,
 *   version: string | null,
 *   label: string,
 * }} opts
 */
function ensurePlatformNativePackage(opts) {
  const { packageName, destDir, version, label } = opts;
  if (dirHasNativeBinary(destDir)) return;

  if (!version) {
    console.error(
      `[prune-pack-deps] ${label}: missing ${packageName} and could not resolve version`,
    );
    process.exit(1);
  }

  const spec = `${packageName}@${version}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "colortxt-native-"));
  console.log(
    `[prune-pack-deps] ${label}: packing ${spec} (cross-arch optional native)`,
  );
  try {
    const packOut = execSync(`npm pack ${JSON.stringify(spec)}`, {
      cwd: tmp,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
      shell: true,
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (!packOut) {
      console.error(`[prune-pack-deps] ${label}: npm pack produced no tarball for ${spec}`);
      process.exit(1);
    }
    const tgz = path.join(tmp, packOut);
    execSync(`tar -xzf ${JSON.stringify(tgz)}`, {
      cwd: tmp,
      stdio: "inherit",
      shell: true,
    });
    const extracted = path.join(tmp, "package");
    if (!dirHasNativeBinary(extracted)) {
      console.error(
        `[prune-pack-deps] ${label}: ${packageName} tarball has no native binary`,
      );
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    rm(destDir);
    fs.cpSync(extracted, destDir, { recursive: true });
  } finally {
    rm(tmp);
  }

  if (!dirHasNativeBinary(destDir)) {
    console.error(
      `[prune-pack-deps] ${label}: ${packageName} still missing native binary under ${destDir}`,
    );
    process.exit(1);
  }
}

/** Linux AppImage / electron-builder 常用 x86_64 目录名，与 prune 入参 x64 对齐 */
function onnxRuntimeArchDirsToKeep(plat, archName) {
  const keep = new Set([archName]);
  if (plat === "linux" && archName === "x64") keep.add("x86_64");
  return keep;
}

/** @param {string} nodeModulesRoot */
function pruneOnnxRuntimeNode(nodeModulesRoot, plat, archName) {
  const ortRoot = path.join(nodeModulesRoot, "onnxruntime-node");
  const napiRoot = path.join(ortRoot, "bin", "napi-v3");
  if (!fs.existsSync(napiRoot)) return;

  const keepArchs = onnxRuntimeArchDirsToKeep(plat, archName);

  for (const platformDir of fs.readdirSync(napiRoot, { withFileTypes: true })) {
    if (!platformDir.isDirectory()) continue;
    const platformPath = path.join(napiRoot, platformDir.name);
    if (platformDir.name !== plat) {
      rm(platformPath);
      continue;
    }
    for (const archDir of fs.readdirSync(platformPath, { withFileTypes: true })) {
      if (!archDir.isDirectory()) continue;
      if (!keepArchs.has(archDir.name)) {
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

/** Linux x64 postinstall 可能已拉取 CUDA/TensorRT EP（约 300MB+）；内置向量仅用 CPU */
function pruneOnnxLinuxGpuProviders(nodeModulesRoot, plat, arch) {
  if (plat !== "linux" || arch !== "x64") return;
  const dir = path.join(
    nodeModulesRoot,
    "onnxruntime-node",
    "bin",
    "napi-v3",
    "linux",
    "x64",
  );
  if (!fs.existsSync(dir)) return;
  for (const name of [
    "libonnxruntime_providers_cuda.so",
    "libonnxruntime_providers_tensorrt.so",
  ]) {
    rm(path.join(dir, name));
  }
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
function pruneBetterSqlite3(nodeModulesRoot, plat, arch) {
  const pkgRoot = path.join(nodeModulesRoot, "better-sqlite3");
  if (!fs.existsSync(pkgRoot)) return;

  const releaseNode = path.join(
    pkgRoot,
    "build",
    "Release",
    "better_sqlite3.node",
  );
  if (plat === "darwin") {
    assertDarwinMachOArch(releaseNode, arch, "better-sqlite3");
  }

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
  if (!fs.existsSync(pkgRoot)) return;

  const keep = sqliteVecPlatformPackageName(plat, arch);
  const platRoot = path.join(nodeModulesRoot, keep);
  ensurePlatformNativePackage({
    packageName: keep,
    destDir: platRoot,
    version: readOptionalDepVersion(
      path.join(pkgRoot, "package.json"),
      keep,
    ),
    label: "sqlite-vec",
  });

  rm(path.join(pkgRoot, "README.md"));
  rm(path.join(pkgRoot, "index.d.ts"));

  for (const ent of fs.readdirSync(nodeModulesRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith("sqlite-vec-") && ent.name !== keep) {
      rm(path.join(nodeModulesRoot, ent.name));
    }
  }

  if (!dirHasNativeBinary(platRoot)) {
    console.error(
      `[prune-pack-deps] sqlite-vec: expected native package ${keep} after prune`,
    );
    process.exit(1);
  }
  rm(path.join(platRoot, "README.md"));
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
  if (!fs.existsSync(jiebaRoot)) return;

  const keep = jiebaKeepName(plat, arch);
  const packageName = `@node-rs/${keep}`;
  const keepDir = path.join(nodeModulesRoot, "@node-rs", keep);
  ensurePlatformNativePackage({
    packageName,
    destDir: keepDir,
    version: readOptionalDepVersion(
      path.join(jiebaRoot, "package.json"),
      packageName,
    ),
    label: "jieba",
  });

  rm(path.join(jiebaRoot, "README.md"));

  const scope = path.join(nodeModulesRoot, "@node-rs");
  for (const ent of fs.readdirSync(scope, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith("jieba-") && ent.name !== keep) {
      rm(path.join(scope, ent.name));
    }
  }

  if (!dirHasNativeBinary(keepDir)) {
    console.error(
      `[prune-pack-deps] jieba: expected native package ${packageName} after prune (required for ${plat}/${arch})`,
    );
    process.exit(1);
  }
}

/**
 * OpenCC：运行时需 node/opencc.js、prebuilds/assets 词典，以及 **electron-rebuild** 的
 * build/Release/opencc.node。npm 自带 prebuilds/*.node 面向 Node ABI，在 Electron 下会报
 *「not a valid Win32 application」，故 postinstall 重建后优先保留 build/Release。
 * @param {string} nodeModulesRoot
 * @param {string} plat
 * @param {string} arch
 */
function pruneOpencc(nodeModulesRoot, plat, arch) {
  const pkgRoot = path.join(nodeModulesRoot, "opencc");
  if (!fs.existsSync(pkgRoot)) return;

  for (const name of ["deps", "src", "data", "scripts", "binding.gyp", "bin"]) {
    rm(path.join(pkgRoot, name));
  }

  const nodeDir = path.join(pkgRoot, "node");
  if (fs.existsSync(nodeDir)) {
    rm(path.join(nodeDir, "cli.js"));
  }

  const prebuildsRoot = path.join(pkgRoot, "prebuilds");
  const dropPrebuildPlatformDirs = () => {
    if (!fs.existsSync(prebuildsRoot)) return;
    for (const ent of fs.readdirSync(prebuildsRoot, { withFileTypes: true })) {
      if (ent.isDirectory() && ent.name !== "assets") {
        rm(path.join(prebuildsRoot, ent.name));
      }
    }
  };

  const buildRoot = path.join(pkgRoot, "build");
  const releaseNode = path.join(buildRoot, "Release", "opencc.node");

  if (fs.existsSync(releaseNode)) {
    if (plat === "darwin") {
      assertDarwinMachOArch(releaseNode, arch, "opencc");
    }
    const nodeBytes = fs.readFileSync(releaseNode);
    try {
      rm(buildRoot);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : "";
      if (code === "EPERM" || code === "EBUSY") {
        console.warn(
          "[prune-pack-deps] opencc: build/ locked (stop dev server); keeping electron-rebuilt .node in place",
        );
        dropPrebuildPlatformDirs();
        return;
      }
      throw err;
    }
    const releaseDir = path.join(buildRoot, "Release");
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, "opencc.node"), nodeBytes);
    dropPrebuildPlatformDirs();
    return;
  }

  console.error(
    "[prune-pack-deps] opencc: missing build/Release/opencc.node — run `npm run postinstall` or `electron-rebuild -f -w opencc` before packaging. npm prebuilds/*.node target Node ABI and crash in Electron (not a valid Win32 application).",
  );
  process.exit(1);
}

/**
 * mdict-js：运行时只 `require("mdict-js")` → `lib/mdict.js`；源码/测试/示例不进包。
 * @param {string} nodeModulesRoot
 */
function pruneMdictJs(nodeModulesRoot) {
  const pkgRoot = path.join(nodeModulesRoot, "mdict-js");
  if (!fs.existsSync(pkgRoot)) return;

  for (const name of [
    "src",
    "test",
    "example",
    "mdx",
    "typings",
    "tsconfig.json",
    ".babelrc",
    ".eslintrc",
    ".eslintignore",
    ".prettierrc",
    "js-mdict-README.md",
  ]) {
    rm(path.join(pkgRoot, name));
  }
}

/**
 * 删掉裁剪后留下的空目录（不删除 root 本身）。
 * @param {string} root
 */
function removeEmptyChildDirs(root) {
  if (!fs.existsSync(root)) return;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const abs = path.join(root, ent.name);
    removeEmptyChildDirs(abs);
    if (fs.existsSync(abs) && fs.readdirSync(abs).length === 0) rm(abs);
  }
}

/**
 * @param {string} root
 * @param {string} plat
 * @param {string} arch
 */
function stripKoffiTree(root, plat, arch) {
  if (!fs.existsSync(root)) return;
  rmFilesRecursive(
    root,
    (_name, abs) => shouldKeepKoffiFile(abs, plat, arch) === false,
  );
  removeEmptyChildDirs(root);
}

/**
 * koffi 只给 macOS 摸鱼窗设系统缩放光标。
 * 非 darwin 整包移除；darwin 只留 CJS 加载器和当前架构的 `.node`，源码与文档不进包。
 * @param {string} nodeModulesRoot
 * @param {string} plat
 * @param {string} arch
 */
function pruneKoffi(nodeModulesRoot, plat, arch) {
  if (plat !== "darwin") {
    rm(path.join(nodeModulesRoot, "koffi"));
    const koromix = path.join(nodeModulesRoot, "@koromix");
    if (!fs.existsSync(koromix)) return;
    for (const name of fs.readdirSync(koromix)) {
      if (name.startsWith("koffi-")) rm(path.join(koromix, name));
    }
    if (fs.existsSync(koromix) && fs.readdirSync(koromix).length === 0) {
      rm(koromix);
    }
    return;
  }
  const keep = arch === "arm64" ? "koffi-darwin-arm64" : "koffi-darwin-x64";
  const koromix = path.join(nodeModulesRoot, "@koromix");
  if (fs.existsSync(koromix)) {
    for (const name of fs.readdirSync(koromix)) {
      if (name.startsWith("koffi-") && name !== keep) rm(path.join(koromix, name));
    }
  }
  stripKoffiTree(path.join(nodeModulesRoot, "koffi"), plat, arch);
  stripKoffiTree(path.join(koromix, keep), plat, arch);
}

function main() {
  const { plat, arch, nm } = parseArgs();
  if (!fs.existsSync(nm)) {
    console.warn(`[prune-pack-deps] skip: node_modules not found (${nm})`);
    return;
  }

  const beforeMb = dirSizeMb(nm);

  rm(path.join(nm, "onnxruntime-web"));
  rm(path.join(nm, "@img"));
  ensureSharpPackStub(nm);
  pruneOnnxWebOrphans(nm);

  pruneKoffi(nm, plat, arch);
  pruneBetterSqlite3(nm, plat, arch);
  pruneFontList(nm, plat);
  pruneSqliteVec(nm, plat, arch);
  pruneJiebaPlatformPackages(nm, plat, arch);
  pruneOpencc(nm, plat, arch);
  pruneMdictJs(nm);
  pruneInstallOnlyPackages(nm);
  patchBetterSqlite3Manifest(nm);

  pruneOnnxRuntimeNode(nm, plat, arch);
  pruneOnnxRuntimeNodePackage(nm);
  pruneOnnxDirectMl(nm, plat, arch);
  pruneOnnxLinuxGpuProviders(nm, plat, arch);
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
  const openccMb = dirSizeMb(path.join(nm, "opencc"));
  const mdictMb = dirSizeMb(path.join(nm, "mdict-js"));
  console.log(
    `[prune-pack-deps] ${plat}/${arch} done; node_modules ${beforeMb}MB → ${afterMb}MB (−${saved.toFixed(1)}MB); better-sqlite3≈${sqliteMb}MB opencc≈${openccMb}MB mdict-js≈${mdictMb}MB onnxruntime-node≈${ortMb}MB @huggingface≈${hfMb}MB`,
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
