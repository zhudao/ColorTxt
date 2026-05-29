/** 底栏等 UI 展示的文本编码标签（与 iconv / 检测器内部名解耦） */

const KNOWN_LABELS: Readonly<Record<string, string>> = {
  utf8: "UTF-8",
  gb2312: "GB2312",
  gbk: "GBK",
  gb18030: "GB18030",
  utf16le: "UTF-16 LE",
  utf16be: "UTF-16 BE",
  ascii: "ASCII",
  latin1: "Latin-1",
  "iso-8859-1": "ISO-8859-1",
  "iso-8859-2": "ISO-8859-2",
  "iso-8859-15": "ISO-8859-15",
  "windows-1250": "Windows-1250",
  "windows-1252": "Windows-1252",
  cp1252: "CP1252",
};

function normalizeEncodingKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
}

function formatUnknownEncodingLabel(normalized: string): string {
  if (normalized.startsWith("iso-")) return normalized.toUpperCase();
  if (normalized.startsWith("windows-")) {
    return `Windows-${normalized.slice("windows-".length)}`;
  }
  if (/^cp\d+$/.test(normalized)) return normalized.toUpperCase();
  if (normalized.startsWith("utf-")) return normalized.toUpperCase();
  return normalized.toUpperCase();
}

/** 将检测/IPC 返回的编码名格式化为底栏展示用标签 */
export function formatTextEncodingLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return "-";
  const key = normalizeEncodingKey(trimmed);
  return KNOWN_LABELS[key] ?? formatUnknownEncodingLabel(key);
}
