/**
 * @huggingface/transformers 会自带一份真实 sharp（依赖 @img/colour），
 * 与彩读打包用 sharp-pack-stub 冲突。将嵌套 sharp 替换为 stub，文本嵌入即可工作。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const nestedDir = path.join(
  root,
  "node_modules",
  "@huggingface",
  "transformers",
  "node_modules",
  "sharp",
);
const stubDir = path.join(root, "scripts", "sharp-pack-stub");

if (!fs.existsSync(nestedDir)) {
  process.exit(0);
}

let version = "";
try {
  version = JSON.parse(
    fs.readFileSync(path.join(nestedDir, "package.json"), "utf8"),
  ).version;
} catch {
  process.exit(0);
}

if (version === "0.0.0-colortxt-stub") {
  process.exit(0);
}

fs.rmSync(nestedDir, { recursive: true, force: true });
fs.cpSync(stubDir, nestedDir, { recursive: true });
console.log(
  "[patch-nested-sharp-stub] 已将 @huggingface/transformers 内嵌 sharp 替换为 stub",
);
