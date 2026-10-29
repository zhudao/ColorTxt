/**
 * 书源全屏 Monaco 使用独立主题名，避免 setTheme(vs/vs-dark) 冲掉阅读器的 txtr-reader。
 * 关闭时再恢复阅读器主题。
 */

import type * as Monaco from "monaco-editor";
import { readerMonacoThemeForAppTheme } from "../../monaco/readerInlineDecorations";

export const BOOK_SOURCE_CODE_THEME_LIGHT = "colortxt-book-source";
export const BOOK_SOURCE_CODE_THEME_DARK = "colortxt-book-source-dark";

let themesDefined = false;

function ensureBookSourceCodeThemes(monaco: typeof Monaco): void {
  if (themesDefined) return;
  monaco.editor.defineTheme(BOOK_SOURCE_CODE_THEME_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {},
  });
  monaco.editor.defineTheme(BOOK_SOURCE_CODE_THEME_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {},
  });
  themesDefined = true;
}

/** 打开全屏书源编辑器时切换到独立代码主题（不碰内置 vs / 阅读器主题） */
export function applyBookSourceCodeTheme(
  monaco: typeof Monaco,
  isDark: boolean,
): void {
  ensureBookSourceCodeThemes(monaco);
  monaco.editor.setTheme(
    isDark ? BOOK_SOURCE_CODE_THEME_DARK : BOOK_SOURCE_CODE_THEME_LIGHT,
  );
}

/** 关闭全屏编辑器后恢复阅读器 Monaco 主题（壳主题 vs → txtr-reader） */
export function restoreReaderMonacoTheme(
  monaco: typeof Monaco,
  isDark: boolean,
): void {
  monaco.editor.setTheme(
    readerMonacoThemeForAppTheme(isDark ? "vs-dark" : "vs"),
  );
}
