/** Legado StringUtils.wordCountFormat：纯数字字数格式化为「xx万字」/「xx字」 */
export function wordCountFormat(wc: string | undefined | null): string {
  const raw = wc?.trim();
  if (!raw) return "";
  if (/^-?\d+$/.test(raw)) {
    const words = Number.parseInt(raw, 10);
    if (words <= 0) return "";
    if (words > 10000) {
      const wan = words / 10000;
      const text = Number.isInteger(wan) ? String(wan) : wan.toFixed(1).replace(/\.0$/, "");
      return `${text}万字`;
    }
    return `${words}字`;
  }
  return raw;
}
