/**
 * 替换 Monaco `base/common/strings.js`：在开关开启时把部分中文标点视为全角。
 * 对本文件内指向原版 strings.js 的导入，Vite 插件按 importer 放行，避免循环。
 */
// Monaco 深层 ESM 无配套 .d.ts
// @ts-expect-error — deep ESM path
export * from "../../../../node_modules/monaco-editor/esm/vs/base/common/strings.js";
// @ts-expect-error — deep ESM path
import { isFullWidthCharacter as originalIsFullWidthCharacter } from "../../../../node_modules/monaco-editor/esm/vs/base/common/strings.js";
import {
  isCjkWrapOptimizeEnabled,
  isCjkWrapOptimizeFullWidthCodePoint,
} from "./cjkWrapOptimize";

export function isFullWidthCharacter(charCode: number): boolean {
  if (
    isCjkWrapOptimizeEnabled() &&
    isCjkWrapOptimizeFullWidthCodePoint(charCode)
  ) {
    return true;
  }
  return originalIsFullWidthCharacter(charCode);
}
