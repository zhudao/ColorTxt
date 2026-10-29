/** 智能排版前：规范化换行、删除明显乱码与控制符，不改标点与空行结构 */
export function prepareTextForAiFormat(text: string): string {
  let out = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  out = out.replace(/\uFFFD/g, "");
  out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return out;
}
