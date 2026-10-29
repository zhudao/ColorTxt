/**
 * vite-plugin-monaco-editor 仍用 fs.rmdirSync({ recursive: true })，Node 22+ 会报 DEP0147。
 * 改为 fs.rmSync({ recursive: true, force: true })。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  root,
  "node_modules",
  "vite-plugin-monaco-editor",
  "dist",
  "workerMiddleware.js",
);
const marker = "colortxt-monaco-worker-rmSync";
const needle =
  "fs.rmdirSync(exports.cacheDir, { recursive: true, force: true });";
const replacement =
  `fs.rmSync(exports.cacheDir, { recursive: true, force: true }); /* ${marker} */`;

if (!fs.existsSync(target)) {
  console.warn(
    "[patch-vite-plugin-monaco-rmdir] workerMiddleware.js 不存在，跳过",
  );
  process.exit(0);
}

const source = fs.readFileSync(target, "utf8");
if (source.includes(marker)) {
  process.exit(0);
}
if (!source.includes(needle)) {
  console.warn(
    "[patch-vite-plugin-monaco-rmdir] workerMiddleware.js 结构已变，跳过",
  );
  process.exit(0);
}

fs.writeFileSync(target, source.replace(needle, replacement), "utf8");
console.log(
  "[patch-vite-plugin-monaco-rmdir] 已将 rmdirSync 替换为 rmSync（消除 DEP0147）",
);
