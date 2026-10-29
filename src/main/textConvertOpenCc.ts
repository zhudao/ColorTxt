import { app } from "electron";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** 打包后原生模块与词典文件须在 app.asar.unpacked 下才能被 C++ 层读取 */
function resolveUnpackedPath(filePath: string): string {
  if (!app.isPackaged) return filePath;
  const needle = `${path.sep}app.asar${path.sep}`;
  const repl = `${path.sep}app.asar.unpacked${path.sep}`;
  return filePath.includes(needle) ? filePath.split(needle).join(repl) : filePath;
}

const openccAssetsDir = resolveUnpackedPath(
  path.join(path.dirname(require.resolve("opencc/package.json")), "prebuilds", "assets"),
);

type OpenCCInstance = {
  convertSync(input: string): string;
};

type OpenCCConstructor = new (config?: string) => OpenCCInstance;

const { OpenCC } = require("opencc") as { OpenCC: OpenCCConstructor };

const converterCache = new Map<string, OpenCCInstance>();

function getConverter(config: string): OpenCCInstance {
  let converter = converterCache.get(config);
  if (!converter) {
    // electron-rebuild 后 binding 在 build/Release，opencc.js 会误把 assets 解析到同目录
    converter = new OpenCC(path.join(openccAssetsDir, `${config}.json`));
    converterCache.set(config, converter);
  }
  return converter;
}

export function convertTextOpenCc(text: string, config: string): string {
  if (!text) return text;
  return getConverter(config).convertSync(text);
}
