import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  cpSync,
} from "node:fs";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import monacoEditorPluginPkg from "vite-plugin-monaco-editor";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const __electronViteConfigDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__electronViteConfigDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
  name?: string;
  homepage?: string;
  build?: { productName?: string };
};

const DEFAULT_GITHUB_REPO_URL = "https://github.com/ssnangua/ColorTxt";

function readPackageGithubRepoUrl(): string {
  const hp =
    typeof packageJson.homepage === "string" ? packageJson.homepage.trim() : "";
  const base = hp || DEFAULT_GITHUB_REPO_URL;
  return base.replace(/\/+$/, "");
}

function readPackageDisplayName(): string {
  const fromBuild =
    typeof packageJson.build?.productName === "string"
      ? packageJson.build.productName.trim()
      : "";
  if (fromBuild) return fromBuild;
  const fromName =
    typeof packageJson.name === "string" ? packageJson.name.trim() : "";
  return fromName || "ColorTxt";
}

const APP_DISPLAY_NAME_LITERAL = readPackageDisplayName();
const APP_DISPLAY_NAME_JSON = JSON.stringify(APP_DISPLAY_NAME_LITERAL);

const GITHUB_REPO_URL_LITERAL = readPackageGithubRepoUrl();
const GITHUB_REPO_URL_JSON = JSON.stringify(GITHUB_REPO_URL_LITERAL);

const sharedResolveAlias = {
  "@shared": resolve(__electronViteConfigDir, "src/shared"),
  "node:sqlite": resolve(
    __electronViteConfigDir,
    "scripts/stubs/node-sqlite-stub.ts",
  ),
};

const monacoEditorPlugin =
  // Some environments expose CJS-like namespace object: { default: fn }
  (monacoEditorPluginPkg as unknown as { default?: any }).default ??
  (monacoEditorPluginPkg as any);

/** 与 vite-plugin-monaco-editor 默认 publicPath 一致 */
const MONACO_EDITOR_WORKERS_PUBLIC_PATH = "monacoeditorwork";

const monacoStringsJsPath = resolve(
  __electronViteConfigDir,
  "node_modules/monaco-editor/esm/vs/base/common/strings.js",
);
const cjkWrapStringsPath = resolve(
  __electronViteConfigDir,
  "src/renderer/src/monaco/cjkWrapStrings.ts",
);

const cjkWrapOptimizePath = resolve(
  __electronViteConfigDir,
  "src/renderer/src/monaco/cjkWrapOptimize.ts",
).replace(/\\/g, "/");

const lineSpacingPath = resolve(
  __electronViteConfigDir,
  "src/renderer/src/monaco/lineSpacing.ts",
).replace(/\\/g, "/");

/**
 * 段间距（物理行后常数 px，键 lineSpacingPx）：注入 LinesLayout 垂直累加 + ViewModel 桥接（仅 renderer）
 */
function monacoLineSpacingPlugin() {
  const linesLayoutPath =
    "/monaco-editor/esm/vs/editor/common/viewLayout/linesLayout.js";
  const viewModelImplPath =
    "/monaco-editor/esm/vs/editor/common/viewModel/viewModelImpl.js";
  const lineSpacingImport = `import { lineSpacingGapsBeforeViewLine, lineSpacingTotalGaps, lineSpacingGapAfterViewLine, setLineSpacingBridgeForLayout, subscribeLineSpacingHeightInvalidation } from ${JSON.stringify(lineSpacingPath)};\n`;
  return {
    name: "monaco-line-spacing",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const norm = (id.split("?")[0] ?? "").replace(/\\/g, "/");
      if (norm.includes(linesLayoutPath)) {
        let patched = code;
        const totalNeedle =
          "return linesHeight + whitespacesHeight + this._paddingTop + this._paddingBottom;";
        const totalNext =
          "return linesHeight + whitespacesHeight + this._paddingTop + this._paddingBottom + lineSpacingTotalGaps(this);";
        if (!patched.includes(totalNeedle)) return null;
        patched = patched.replace(totalNeedle, totalNext);

        const offsetNeedle =
          "return previousLinesHeight + previousWhitespacesHeight + this._paddingTop;\n    }\n    getLineHeightForLineNumber(lineNumber) {";
        const offsetNext =
          "return previousLinesHeight + previousWhitespacesHeight + this._paddingTop + lineSpacingGapsBeforeViewLine(this, lineNumber);\n    }\n    getLineHeightForLineNumber(lineNumber) {";
        if (!patched.includes(offsetNeedle)) return null;
        patched = patched.replace(offsetNeedle, offsetNext);

        const afterNeedle =
          "getVerticalOffsetAfterLineNumber(lineNumber, includeViewZones = false) {\n        lineNumber = lineNumber | 0;\n        const previousLinesHeight = this._lineHeightsManager.getAccumulatedLineHeightsIncludingLineNumber(lineNumber);\n        const previousWhitespacesHeight = this.getWhitespaceAccumulatedHeightBeforeLineNumber(lineNumber + (includeViewZones ? 1 : 0));\n        return previousLinesHeight + previousWhitespacesHeight + this._paddingTop;\n    }";
        const afterNext =
          "getVerticalOffsetAfterLineNumber(lineNumber, includeViewZones = false) {\n        lineNumber = lineNumber | 0;\n        const previousLinesHeight = this._lineHeightsManager.getAccumulatedLineHeightsIncludingLineNumber(lineNumber);\n        const previousWhitespacesHeight = this.getWhitespaceAccumulatedHeightBeforeLineNumber(lineNumber + (includeViewZones ? 1 : 0));\n        return previousLinesHeight + previousWhitespacesHeight + this._paddingTop + lineSpacingGapsBeforeViewLine(this, lineNumber) + lineSpacingGapAfterViewLine(this, lineNumber, this._lineCount);\n    }";
        if (!patched.includes(afterNeedle)) return null;
        patched = patched.replace(afterNeedle, afterNext);

        // ViewZone / whitespace 绝对 top：须与 getLinesViewportData 一致（行后先段间距再 zone），
        // 否则插图会叠在上方正文上，下方却留出 zone 高度空隙。
        const wsOffsetNeedle =
          "return previousLinesHeight + previousWhitespacesHeight + this._paddingTop;\n    }\n    getWhitespaceIndexAtOrAfterVerticallOffset(verticalOffset) {";
        const wsOffsetNext =
          "return previousLinesHeight + previousWhitespacesHeight + this._paddingTop + lineSpacingGapsBeforeViewLine(this, afterLineNumber) + lineSpacingGapAfterViewLine(this, afterLineNumber, this._lineCount);\n    }\n    getWhitespaceIndexAtOrAfterVerticallOffset(verticalOffset) {";
        if (!patched.includes(wsOffsetNeedle)) return null;
        patched = patched.replace(wsOffsetNeedle, wsOffsetNext);

        const viewportNeedle =
          "            // Count current line height in the vertical offsets\n            currentVerticalOffset += lineHeight;\n            linesOffsets[lineNumber - startLineNumber] = currentLineRelativeOffset;\n            // Next line starts immediately after this one\n            currentLineRelativeOffset += lineHeight;\n            while (currentWhitespaceAfterLineNumber === lineNumber) {";
        const viewportNext =
          "            // Count current line height in the vertical offsets\n            currentVerticalOffset += lineHeight;\n            linesOffsets[lineNumber - startLineNumber] = currentLineRelativeOffset;\n            // Next line starts immediately after this one\n            currentLineRelativeOffset += lineHeight;\n            {\n                const __lineSpacingGap = lineSpacingGapAfterViewLine(this, lineNumber, this._lineCount);\n                if (__lineSpacingGap) {\n                    currentVerticalOffset += __lineSpacingGap;\n                    currentLineRelativeOffset += __lineSpacingGap;\n                }\n            }\n            while (currentWhitespaceAfterLineNumber === lineNumber) {";
        if (!patched.includes(viewportNeedle)) return null;
        patched = patched.replace(viewportNeedle, viewportNext);

        if (!patched.includes(lineSpacingPath)) {
          patched = lineSpacingImport + patched;
        }
        return { code: patched, map: null };
      }
      if (norm.includes(viewModelImplPath)) {
        const needle =
          "        this.viewLayout = this._register(new ViewLayout(this._configuration, this.getLineCount(), this._getCustomLineHeights(), scheduleAtNextAnimationFrame));\n        this._register(this.viewLayout.onDidScroll((e) => {";
        if (!code.includes(needle)) return null;
        const injection = `        this.viewLayout = this._register(new ViewLayout(this._configuration, this.getLineCount(), this._getCustomLineHeights(), scheduleAtNextAnimationFrame));
        {
            const __linesLayout = this.viewLayout._linesLayout;
            setLineSpacingBridgeForLayout(__linesLayout, (viewLineNumber) => {
                if (typeof this._lines.getViewLineInfo === "function") {
                    return this._lines.getViewLineInfo(viewLineNumber).modelLineNumber;
                }
                return viewLineNumber;
            }, () => this.model.getLineCount());
            const __unsubLineSpacing = subscribeLineSpacingHeightInvalidation(() => {
                this.viewLayout.onHeightMaybeChanged();
            });
            this._register({ dispose: () => {
                    __unsubLineSpacing();
                    setLineSpacingBridgeForLayout(__linesLayout, null, null);
                } });
        }
        this._register(this.viewLayout.onDidScroll((e) => {`;
        let patched = code.replace(needle, injection);
        if (!patched.includes(lineSpacingPath)) {
          patched = lineSpacingImport + patched;
        }
        return { code: patched, map: null };
      }
      return null;
    },
  };
}

/** 拦截 Monaco strings.js，注入可开关的中文全角标点判断（仅 renderer） */
function monacoCjkWrapStringsPlugin() {
  const normalizedStringsPath = monacoStringsJsPath.replace(/\\/g, "/");
  const normalizedWrapPath = cjkWrapStringsPath.replace(/\\/g, "/");
  return {
    name: "monaco-cjk-wrap-strings",
    enforce: "pre" as const,
    resolveId(id: string, importer: string | undefined) {
      const bareId = id.split("?")[0] ?? "";
      let candidate = bareId.replace(/\\/g, "/");
      if (
        (bareId.startsWith(".") || bareId.startsWith("/")) &&
        importer
      ) {
        candidate = resolve(dirname(importer), bareId).replace(/\\/g, "/");
      }
      const isMonacoStrings =
        candidate === normalizedStringsPath ||
        candidate.endsWith("/monaco-editor/esm/vs/base/common/strings.js");
      if (!isMonacoStrings) return null;
      const importerNorm = (importer ?? "").replace(/\\/g, "/");
      if (
        importerNorm.includes("/monaco/cjkWrapStrings") ||
        importerNorm === normalizedWrapPath
      ) {
        return null;
      }
      return cjkWrapStringsPath;
    },
  };
}

/**
 * 简单换行优化（仅 renderer）：
 * - computeCharWidth：省略号/破折号/♡※ 等强制全角列宽
 * - fontMeasurements：用「汉」测全角宽（避免 \uff4d ｍ 缺字回退估窄）
 * （不再改 canBreak：break-all 会把 ，。？ 等送到行首）
 */
function monacoCjkWrapOptimizePlugin() {
  const lineBreaksPath =
    "/monaco-editor/esm/vs/editor/common/viewModel/monospaceLineBreaksComputer.js";
  const fontMeasurePath =
    "/monaco-editor/esm/vs/editor/browser/config/fontMeasurements.js";
  const optimizeImport = `import { isCjkWrapOptimizeEnabled, isCjkWrapOptimizeFullWidthCodePoint } from ${JSON.stringify(cjkWrapOptimizePath)};\n`;
  return {
    name: "monaco-cjk-wrap-optimize",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const norm = (id.split("?")[0] ?? "").replace(/\\/g, "/");
      if (norm.includes(fontMeasurePath)) {
        // 全角样字：汉（与正文 CJK 同字体），避免 \uff4d 回退导致 typicalFullwidth 偏小
        const next = code.replace(
          "this._createRequest('\\uff4d', 0 /* CharWidthRequestType.Regular */, all, null)",
          "this._createRequest('\u6C49', 0 /* CharWidthRequestType.Regular */, all, null)",
        );
        if (next === code) {
          const next2 = code.replace(
            'this._createRequest("\\uff4d", 0 /* CharWidthRequestType.Regular */, all, null)',
            'this._createRequest("\u6C49", 0 /* CharWidthRequestType.Regular */, all, null)',
          );
          return next2 === code ? null : { code: next2, map: null };
        }
        return { code: next, map: null };
      }
      if (!norm.includes(lineBreaksPath)) return null;
      let patched = code;
      let changed = false;
      // 直接在算宽时强制省略号/破折号为全角（不单依赖 isFullWidthCharacter 包装）
      const computeWidthNeedle =
        "function computeCharWidth(charCode, visibleColumn, tabSize, columnsForFullWidthChar) {\n    if (charCode === 9 /* CharCode.Tab */) {\n        return (tabSize - (visibleColumn % tabSize));\n    }\n    if (isFullWidthCharacter(charCode)) {\n        return columnsForFullWidthChar;\n    }";
      const computeWidthReplacement = `function computeCharWidth(charCode, visibleColumn, tabSize, columnsForFullWidthChar) {
    if (charCode === 9 /* CharCode.Tab */) {
        return (tabSize - (visibleColumn % tabSize));
    }
    if (isCjkWrapOptimizeEnabled() && isCjkWrapOptimizeFullWidthCodePoint(charCode)) {
        return columnsForFullWidthChar;
    }
    if (isFullWidthCharacter(charCode)) {
        return columnsForFullWidthChar;
    }`;
      if (patched.includes(computeWidthNeedle)) {
        patched = patched.replace(computeWidthNeedle, computeWidthReplacement);
        changed = true;
      }
      if (!changed) return null;
      if (!patched.includes(cjkWrapOptimizePath.replace(/\\/g, "/")) && !patched.includes(cjkWrapOptimizePath)) {
        patched = optimizeImport + patched;
      }
      return { code: patched, map: null };
    },
  };
}

/** pdfjs-dist 需随页面同源提供的静态资源（CMap / wasm / 标准字体 / ICC） */
const PDFJS_ASSET_DIRS = [
  "cmaps",
  "wasm",
  "standard_fonts",
  "iccs",
] as const;

const PDFJS_DIST_ROOT = resolve(
  __electronViteConfigDir,
  "node_modules/pdfjs-dist",
);

function mimeForPdfjsAsset(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".wasm":
      return "application/wasm";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function copyPdfjsAssetsTo(destRoot: string): void {
  for (const dir of PDFJS_ASSET_DIRS) {
    const from = join(PDFJS_DIST_ROOT, dir);
    if (!existsSync(from)) continue;
    cpSync(from, join(destRoot, dir), { recursive: true });
  }
}

function tryServePdfjsAsset(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const raw = (req.url ?? "").split("?")[0] ?? "";
  if (!raw.startsWith("/pdfjs/")) {
    next();
    return;
  }
  let rel = decodeURIComponent(raw.slice("/pdfjs/".length));
  rel = rel.replace(/\\/g, "/");
  const top = rel.split("/")[0] ?? "";
  if (
    !rel ||
    rel.includes("..") ||
    !(PDFJS_ASSET_DIRS as readonly string[]).includes(top)
  ) {
    res.statusCode = 400;
    res.end();
    return;
  }
  const file = resolve(PDFJS_DIST_ROOT, rel);
  if (
    !isPathInside(PDFJS_DIST_ROOT, file) ||
    !existsSync(file) ||
    !statSync(file).isFile()
  ) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader("Content-Type", mimeForPdfjsAsset(file));
  createReadStream(file).pipe(res);
}

/**
 * 开发态把 `/pdfjs/*` 映射到 `node_modules/pdfjs-dist`；
 * 生产构建拷到 `dist/renderer/pdfjs/`（与 `document.baseURI` 相对路径一致）。
 */
function pdfjsAssetsPlugin(): Plugin {
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use(tryServePdfjsAsset);
    },
    configurePreviewServer(server) {
      server.middlewares.use(tryServePdfjsAsset);
    },
    writeBundle(options) {
      if (!options.dir) return;
      copyPdfjsAssetsTo(join(options.dir, "pdfjs"));
    },
  };
}

export default defineConfig({
  main: {
    resolve: {
      alias: sharedResolveAlias,
    },
    define: {
      __APP_DISPLAY_NAME__: APP_DISPLAY_NAME_JSON,
      __GITHUB_REPO_URL__: GITHUB_REPO_URL_JSON,
    },
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: resolve(__electronViteConfigDir, "src/main/index.ts"),
          "ai/rag/embedding/worker": resolve(
            __electronViteConfigDir,
            "src/main/ai/rag/embedding/worker.ts",
          ),
        },
        /**
         * 勿打入 main/worker bundle
         *  - `font-list` 依赖包内 `./libs/core` 等相对路径，需保留在 node_modules。
         *  - `iconv-lite` 常含动态编码加载，保持 external。
         *  - `jschardet` 由 Rollup 打入主包；`jszip`/`pako` 仅 renderer 使用，主进程勿 external。
         *  - Legado 书源解析（`cheerio`、`jsonpath-plus`、`@xmldom/xmldom`、`xpath`、`tough-cookie`）同样打入主包，见 devDependencies，勿加入 external。
         *  - `heic-convert`（HEIC 封面懒加载 chunk）、`socks-proxy-agent`（SOCKS 代理）intentionally bundled，见 devDependencies，勿加入 external。
         *  - `cheerio` 依赖的 undici 会引用 `node:sqlite`（SqliteCacheStore）；经 alias 指向 stub，避免 ExperimentalWarning。
         *  - `electron-updater` 保持 CJS 动态 require 与依赖树习惯用法。
         *  - `ws` 内含对可选原生模块 `bufferutil`/`utf-8-validate` 的动态加载；打入 bundle 时会被解析成硬导入导致启动失败，故保持 external。
         *  - `koffi` 含平台 `.node`，仅 macOS 摸鱼窗设系统缩放光标时按需 require。
         */
        external: [
          "font-list",
          "iconv-lite",
          "electron-updater",
          "better-sqlite3",
          "mdict-js",
          "@caitun/speex",
          "@caitun/speex/wasm/speex-wasm.js",
          "@caitun/speex/wasm/speex-wasm.wasm",
          "sqlite-vec",
          "ws",
          "@node-rs/jieba",
          "@node-rs/jieba/dict",
          "@huggingface/transformers",
          "@huggingface/jinja",
          "onnxruntime-node",
          "onnxruntime-common",
          "opencc",
          "koffi",
        ],
        output: {
          format: "es",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: sharedResolveAlias,
    },
    define: {
      __APP_DISPLAY_NAME__: APP_DISPLAY_NAME_JSON,
      __GITHUB_REPO_URL__: GITHUB_REPO_URL_JSON,
    },
    build: {
      outDir: "dist/preload",
      lib: {
        entry: resolve(__electronViteConfigDir, "src/preload/index.ts"),
      },
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    root: resolve(__electronViteConfigDir, "src/renderer"),
    resolve: {
      alias: sharedResolveAlias,
    },
    define: {
      __APP_DISPLAY_NAME__: APP_DISPLAY_NAME_JSON,
      __GITHUB_REPO_URL__: GITHUB_REPO_URL_JSON,
    },
    plugins: [
      monacoCjkWrapStringsPlugin(),
      monacoCjkWrapOptimizePlugin(),
      monacoLineSpacingPlugin(),
      pdfjsAssetsPlugin(),
      {
        name: "inject-app-display-name-in-html",
        transformIndexHtml(html: string) {
          return html.replaceAll(
            "%APP_DISPLAY_NAME%",
            APP_DISPLAY_NAME_LITERAL,
          );
        },
      },
      vue(),
      monacoEditorPlugin({
        languageWorkers: ["editorWorkerService", "typescript", "json"],
        customWorkers: [],
        publicPath: MONACO_EDITOR_WORKERS_PUBLIC_PATH,
        // 插件默认 path.join(root, outDir, base, publicPath)；在 Windows 上 root 与 outDir 若均为绝对路径，
        // path.join 会拼成 `.../src/renderer/F:/.../dist/...` 非法路径。这里只基于已解析的 outDir 拼接。
        customDistPath(_root: string, outDir: string, base: string) {
          const normalizedBase =
            base === "/" || base === "" ? "" : String(base).replace(/^\//, "");
          return join(
            resolve(outDir),
            normalizedBase,
            MONACO_EDITOR_WORKERS_PUBLIC_PATH,
          );
        },
      }),
    ],
    optimizeDeps: {
      include: ["markmap-lib", "markmap-view", "d3-cloud", "d3-scale"],
      /**
       * 必须排除：否则 esbuild 预构建会绕过本文件的 Monaco CJK 换行 / 段间距 transform/resolve，
       * 开发模式下去掉补丁（生产 Rollup 构建不受影响）。
       */
      exclude: ["monaco-editor"],
    },
    build: {
      outDir: resolve(__electronViteConfigDir, "dist/renderer"),
      rollupOptions: {
        input: {
          index: resolve(__electronViteConfigDir, "src/renderer/index.html"),
          "find-book": resolve(__electronViteConfigDir, "src/renderer/find-book.html"),
          eyedropper: resolve(__electronViteConfigDir, "src/renderer/eyedropper.html"),
          "stealth-reader": resolve(
            __electronViteConfigDir,
            "src/renderer/stealth-reader.html",
          ),
          "stealth-settings": resolve(
            __electronViteConfigDir,
            "src/renderer/stealth-settings.html",
          ),
        },
      },
    },
  },
});
