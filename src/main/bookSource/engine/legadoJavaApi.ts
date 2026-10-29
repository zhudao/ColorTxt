import { createHmac, randomUUID as nodeRandomUUID } from "node:crypto";
import iconv from "iconv-lite";

import { convertTextOpenCc } from "../../textConvertOpenCc";
import { createSymmetricCrypto } from "./legadoCrypto";

export function legadoJsonValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => String(obj[k] ?? ""))
        .join("");
    }
    if (keys.length === 0) return "";
  }
  return String(value);
}

function normalizeHmacAlgorithm(algorithm: string): string {
  const u = algorithm.trim();
  // Hutool：HMAC-SHA1 / HMAC_SHA1（部分聚合书源正文解密链等）
  const hyphen = u.match(/^HMAC[-_](MD5|SHA-?1|SHA-?256|SHA-?384|SHA-?512)$/i);
  if (hyphen) {
    return hyphen[1]!.replace(/-/g, "").toLowerCase();
  }
  const compact = u.match(/^Hmac?(MD5|SHA1|SHA256|SHA384|SHA512)$/i);
  if (compact) {
    const inner = compact[1]!.toUpperCase();
    if (inner === "MD5") return "md5";
    return inner.toLowerCase();
  }
  const stripped = u.toLowerCase().replace(/^hmac[-_]?/, "");
  if (stripped === "md5") return "md5";
  if (/^sha\d+$/.test(stripped)) return stripped;
  return stripped;
}

/** Legado java.encodeURI(str) / java.encodeURI(str, charset) */
export function encodeLegadoUri(str: unknown, charset?: unknown): string {
  const text = String(str ?? "");
  const cs = charset != null ? String(charset).trim().toLowerCase() : "utf-8";
  if (!cs || cs === "utf-8" || cs === "utf8") {
    return encodeURIComponent(text);
  }
  const buf = iconv.encode(text, cs);
  return Array.from(buf)
    .map((b) => `%${b.toString(16).padStart(2, "0").toUpperCase()}`)
    .join("");
}

/** Legado java.HMacHex(data, algorithm, key) */
export function hMacHex(data: unknown, algorithm: unknown, key: unknown): string {
  const algo = normalizeHmacAlgorithm(String(algorithm ?? "HmacSHA256"));
  try {
    return createHmac(algo, String(key ?? ""))
      .update(String(data ?? ""), "utf8")
      .digest("hex");
  } catch {
    return "";
  }
}

/** Legado java.HMacBase64(data, algorithm, key) */
export function hMacBase64(data: unknown, algorithm: unknown, key: unknown): string {
  const algo = normalizeHmacAlgorithm(String(algorithm ?? "HmacSHA256"));
  try {
    return createHmac(algo, String(key ?? ""))
      .update(String(data ?? ""), "utf8")
      .digest("base64");
  } catch {
    return "";
  }
}

/** Legado java.desEncodeToBase64String */
export function desEncodeToBase64String(
  data: unknown,
  key: unknown,
  transformation: unknown,
  iv: unknown,
): string {
  return createSymmetricCrypto(
    transformation ?? "DES/ECB/PKCS5Padding",
    key,
    iv,
  ).encryptBase64(String(data ?? ""));
}

/** 明文加密：强制 UTF-8 字节，避免 toBuffer 把「像 Base64 的明文」误当密文解码 */
function encryptPlainUtf8Base64(
  transformation: string,
  key: unknown,
  iv: unknown,
  data: unknown,
): string {
  return createSymmetricCrypto(transformation, key, iv).encryptBase64(
    Buffer.from(String(data ?? ""), "utf8"),
  );
}

function desedeTransformation(mode: unknown, padding: unknown): string {
  return `DESede/${String(mode ?? "CBC")}/${String(padding ?? "PKCS5Padding")}`;
}

/**
 * Legado java.tripleDESEncodeBase64Str(data, key, mode, padding, iv)
 * → createSymmetricCrypto("DESede/${mode}/${padding}", key, iv).encryptBase64(data)
 */
export function tripleDESEncodeBase64Str(
  data: unknown,
  key: unknown,
  mode: unknown,
  padding: unknown,
  iv: unknown,
): string {
  return encryptPlainUtf8Base64(desedeTransformation(mode, padding), key, iv, data);
}

/**
 * Legado java.tripleDESEncodeArgsBase64Str — key 按 Base64 解码；
 * iv 按 UTF-8 字节（对齐官方实现：`iv.encodeToByteArray()`，非 Base64）。
 */
export function tripleDESEncodeArgsBase64Str(
  data: unknown,
  key: unknown,
  mode: unknown,
  padding: unknown,
  iv: unknown,
): string {
  return encryptPlainUtf8Base64(
    desedeTransformation(mode, padding),
    Buffer.from(String(key ?? ""), "base64"),
    Buffer.from(String(iv ?? ""), "utf8"),
    data,
  );
}

/** Legado java.tripleDESDecodeStr(data, key, mode, padding, iv) */
export function tripleDESDecodeStr(
  data: unknown,
  key: unknown,
  mode: unknown,
  padding: unknown,
  iv: unknown,
): string {
  return createSymmetricCrypto(
    desedeTransformation(mode, padding),
    key,
    iv,
  ).decryptStr(data);
}

/** Legado java.tripleDESDecodeArgsBase64Str — 同 EncodeArgs：key Base64，iv UTF-8 */
export function tripleDESDecodeArgsBase64Str(
  data: unknown,
  key: unknown,
  mode: unknown,
  padding: unknown,
  iv: unknown,
): string {
  return createSymmetricCrypto(
    desedeTransformation(mode, padding),
    Buffer.from(String(key ?? ""), "base64"),
    Buffer.from(String(iv ?? ""), "utf8"),
  ).decryptStr(data);
}

/** Legado java.t2s / java.s2t */
export function legadoT2s(text: unknown): string {
  const s = String(text ?? "");
  if (!s) return s;
  try {
    return convertTextOpenCc(s, "t2s");
  } catch {
    return s;
  }
}

export function legadoS2t(text: unknown): string {
  const s = String(text ?? "");
  if (!s) return s;
  try {
    return convertTextOpenCc(s, "s2twp");
  } catch {
    return s;
  }
}

/** Legado java.randomUUID() */
export function legadoRandomUUID(): string {
  return nodeRandomUUID();
}

/** Legado java.timeFormat(time) — AppConst.dateFormat */
export function timeFormat(time: unknown): string {
  const ts = Number(time);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Legado java.timeFormatUTC(time, format, offsetHours) */
export function timeFormatUtc(
  time: unknown,
  format: unknown,
  offsetHours: unknown,
): string {
  const ts = Number(time);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const sh = Number(offsetHours) || 0;
  const d = new Date(ts + sh * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tokens: Array<[string, string]> = [
    ["yyyy", String(d.getUTCFullYear())],
    ["MM", pad(d.getUTCMonth() + 1)],
    ["dd", pad(d.getUTCDate())],
    ["HH", pad(d.getUTCHours())],
    ["mm", pad(d.getUTCMinutes())],
    ["ss", pad(d.getUTCSeconds())],
  ];
  let out = String(format ?? "yyyy-MM-dd HH:mm:ss");
  for (const [token, value] of tokens) {
    out = out.replaceAll(token, value);
  }
  return out;
}
