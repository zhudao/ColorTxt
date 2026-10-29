/**
 * 简单换行（wrappingStrategy: simple）下的中文换行优化：
 * - 将网文常用、中文字体里接近全角宽、但 Monaco 默认当半角估算的符号按全角列宽
 *   （包装 `isFullWidthCharacter` / `computeCharWidth`；`、。「」` 等本就在 CJK/全角区）
 * - 全角样字改为「汉」（见 electron.vite Monaco transform）
 * 不改 canBreak（曾用 break-all 会导致 ，。？ 等出现在行首）。
 * 高级换行开启时由 ReaderMain 关闭此开关。
 */

let cjkWrapOptimizeEnabled = true;

export function setCjkWrapOptimizeEnabled(on: boolean): void {
  cjkWrapOptimizeEnabled = on;
}

export function isCjkWrapOptimizeEnabled(): boolean {
  return cjkWrapOptimizeEnabled;
}

/**
 * Monaco 默认 `isFullWidthCharacter` 从 CJK 部首 U+2E80 起算，不含：
 * ASCII 运算/标记符、箭头、General Punctuation、拉丁文 ·×、几何/杂项符号（♡♥☆※ 等）。
 * 中文字体里这些常占约 1em，半角估算会让简单换行右侧溢出。
 */
export function isCjkWrapOptimizeFullWidthCodePoint(charCode: number): boolean {
  // # % + - / \ <=> @ | ~
  if (charCode < 0x80) {
    return (
      charCode === 0x23 ||
      charCode === 0x25 ||
      charCode === 0x2b ||
      charCode === 0x2d ||
      charCode === 0x2f ||
      charCode === 0x5c ||
      (charCode >= 0x3c && charCode <= 0x3e) ||
      charCode === 0x40 ||
      charCode === 0x7c ||
      charCode === 0x7e
    );
  }
  // · × ÷（拉丁-1，中文排版常按全角）
  if (
    charCode === 0x00b7 ||
    charCode === 0x00d7 ||
    charCode === 0x00f7
  ) {
    return true;
  }
  // ‐-‒–—―
  if (charCode >= 0x2010 && charCode <= 0x2015) return true;
  // ‘’‚‛“”„‟
  if (charCode >= 0x2018 && charCode <= 0x201f) return true;
  // †‡•‣․‥…
  if (charCode >= 0x2020 && charCode <= 0x2026) return true;
  // ‰‱′″‴‵※‼‾ 及 ‹›
  if (charCode >= 0x2030 && charCode <= 0x203e) return true;
  // ←↑→↓ 及对角、双向箭头
  if (charCode >= 0x2190 && charCode <= 0x2199) return true;
  // Ⅰ-Ⅻ ⅰ-ⅹ 等 Number Forms
  if (charCode >= 0x2160 && charCode <= 0x2188) return true;
  // ①-⑳⑴-⒇⒈-⒛ 等 Enclosed Alphanumerics
  if (charCode >= 0x2460 && charCode <= 0x24ff) return true;
  // ⋯ √
  if (charCode === 0x22ef || charCode === 0x221a) return true;
  // 盒线 / 方块 / 几何 / 杂项符号（♡♥☆★）/ Dingbats（✲❈✔✘）
  if (charCode >= 0x2500 && charCode <= 0x27bf) return true;
  // 竖排标点、CJK 兼容形式（Monaco 默认忽略 FE10–FE4F）
  if (charCode >= 0xfe10 && charCode <= 0xfe4f) return true;
  return false;
}
