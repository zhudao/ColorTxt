/**
 * Monaco 0.55+ 移除了 HoverStyle.Pointer 默认 BELOW（VS Code #272244）。
 * 查找栏按钮 tooltip 会改在上方弹出，易被顶栏/overflow 裁切。
 * 查找输入框 placeholder tooltip 原走 setupDelayedHoverAtMouse + compact，默认 ABOVE，
 * 且靠近视口底时会 flip 回上方；改为与按钮相同的 setupDelayedHover + Pointer。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function patchHoverWidget() {
  const target = path.join(
    root,
    "node_modules",
    "monaco-editor",
    "esm",
    "vs",
    "platform",
    "hover",
    "browser",
    "hoverWidget.js",
  );
  const marker = "colortxt-pointer-hover-below";
  const markerDone = "options.position.forcePosition ??= true; /* colortxt-pointer-hover-below */";
  const needle = `                case 1 /* HoverStyle.Pointer */: {
                    options.appearance ??= {};
                    options.appearance.compact ??= true;
                    options.appearance.showPointer ??= true;
                    break;
                }`;
  const replacement = `                case 1 /* HoverStyle.Pointer */: {
                    options.appearance ??= {};
                    options.appearance.compact ??= true;
                    options.appearance.showPointer ??= true;
                    options.position ??= {};
                    options.position.hoverPosition ??= 2 /* HoverPosition.BELOW */;
                    options.position.forcePosition ??= true; /* ${marker} */
                    break;
                }`;

  if (!fs.existsSync(target)) return;
  let source = fs.readFileSync(target, "utf8");
  if (source.includes(markerDone)) return;
  if (!source.includes(needle)) {
    // 已打过 v1（无 forcePosition）时补 forcePosition
    const v1Needle =
      "options.position.hoverPosition ??= 2 /* HoverPosition.BELOW */; /* colortxt-pointer-hover-below */";
    const v1Replacement =
      "options.position.hoverPosition ??= 2 /* HoverPosition.BELOW */;\n                    options.position.forcePosition ??= true; /* colortxt-pointer-hover-below */";
    if (source.includes(v1Needle)) {
      fs.writeFileSync(target, source.replace(v1Needle, v1Replacement), "utf8");
      console.log(
        "[patch-monaco-hover-pointer-below] 已为 Pointer 悬停补上 forcePosition",
      );
      return;
    }
    console.warn(
      "[patch-monaco-hover-pointer-below] hoverWidget.js 结构已变，跳过 Pointer 补丁",
    );
    return;
  }
  fs.writeFileSync(target, source.replace(needle, replacement), "utf8");
  console.log(
    "[patch-monaco-hover-pointer-below] 已恢复 Pointer 悬停默认向下（查找栏按钮 tooltip）",
  );
}

function patchInputBoxTooltip() {
  const target = path.join(
    root,
    "node_modules",
    "monaco-editor",
    "esm",
    "vs",
    "base",
    "browser",
    "ui",
    "inputbox",
    "inputBox.js",
  );
  const marker = "colortxt-inputbox-hover-pointer-below";
  const replacementBlock = `            this.hover.value = this._register(getBaseLayerHoverDelegate().setupDelayedHover(this.input, () => ({
                content: this.tooltip,
                style: 1 /* HoverStyle.Pointer */,
            }))); /* ${marker} */`;

  const needles = [
    `            this.hover.value = this._register(getBaseLayerHoverDelegate().setupDelayedHoverAtMouse(this.input, () => ({
                content: this.tooltip,
                appearance: {
                    compact: true,
                },
                position: {
                    hoverPosition: 2 /* HoverPosition.BELOW */,
                },
            }))); /* colortxt-inputbox-hover-below */`,
    `            this.hover.value = this._register(getBaseLayerHoverDelegate().setupDelayedHoverAtMouse(this.input, () => ({
                content: this.tooltip,
                appearance: {
                    compact: true,
                }
            })));`,
  ];

  if (!fs.existsSync(target)) return;
  const source = fs.readFileSync(target, "utf8");
  if (source.includes(marker)) return;

  for (const needle of needles) {
    if (!source.includes(needle)) continue;
    fs.writeFileSync(target, source.replace(needle, replacementBlock), "utf8");
    console.log(
      "[patch-monaco-hover-pointer-below] 查找输入框 tooltip 已改为 Pointer + setupDelayedHover（与按钮一致，向下弹出）",
    );
    return;
  }

  console.warn(
    "[patch-monaco-hover-pointer-below] inputBox.js 结构已变，跳过 InputBox 补丁",
  );
}

patchHoverWidget();
patchInputBoxTooltip();
