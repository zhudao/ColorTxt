import { createCipheriv, createDecipheriv } from "node:crypto";

export type LegadoSymmetricCipher = {
  decrypt: (data: unknown) => Buffer;
  decryptStr: (data: unknown) => string;
  encrypt: (data: unknown) => Buffer;
  encryptBase64: (data: unknown) => string;
  encryptHex: (data: unknown) => string;
};

function toKeyBuffer(raw: unknown): Buffer {
  if (raw == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (Array.isArray(raw)) return Buffer.from(raw);
  return Buffer.from(String(raw), "utf8");
}

function looksLikeBase64(text: string): boolean {
  if (!text || text.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}

function toBuffer(data: unknown): Buffer {
  if (data == null) {
    throw new Error("CryptoException: IllegalArgumentException: Null input buffer");
  }
  if (Buffer.isBuffer(data)) {
    if (data.length === 0) {
      throw new Error("CryptoException: IllegalArgumentException: Null input buffer");
    }
    return data;
  }
  if (data instanceof Uint8Array) {
    if (data.length === 0) {
      throw new Error("CryptoException: IllegalArgumentException: Null input buffer");
    }
    return Buffer.from(data);
  }
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new Error("CryptoException: IllegalArgumentException: Null input buffer");
    }
    return Buffer.from(data);
  }
  const text = String(data).trim();
  if (!text) {
    throw new Error("CryptoException: IllegalArgumentException: Null input buffer");
  }
  if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) {
    return Buffer.from(text, "hex");
  }
  if (looksLikeBase64(text)) {
    return Buffer.from(text, "base64");
  }
  return Buffer.from(text, "utf8");
}

function resolveNodeAlgorithm(transformation: string, key: Buffer): {
  algorithm: string;
  iv: Buffer | null;
} {
  const parts = transformation.split("/").map((p) => p.trim());
  const raw = (parts[0] ?? "AES").toUpperCase();
  const mode = (parts[1] ?? "CBC").toUpperCase();
  const ivRequired = mode !== "ECB";

  let prefix = "aes-128";
  if (raw === "AES") {
    if (key.length >= 32) prefix = "aes-256";
    else if (key.length >= 24) prefix = "aes-192";
    else prefix = "aes-128";
  } else if (raw === "DES") {
    prefix = "des";
  } else if (raw === "DESEDE" || raw === "TRIPLEDES") {
    prefix = "des-ede3";
  } else {
    prefix = raw.toLowerCase();
  }

  const algorithm =
    mode === "ECB" ? `${prefix}-ecb` : `${prefix}-${mode.toLowerCase()}`;
  return { algorithm, iv: ivRequired ? null : null };
}

function normalizeKey(raw: unknown, algorithm: string): Buffer {
  let key = toKeyBuffer(raw);
  if (!key.length) key = Buffer.alloc(16);
  if (algorithm.startsWith("aes-128") && key.length !== 16) {
    key = key.length > 16 ? key.subarray(0, 16) : Buffer.concat([key, Buffer.alloc(16 - key.length)]);
  } else if (algorithm.startsWith("aes-192") && key.length !== 24) {
    key = key.length > 24 ? key.subarray(0, 24) : Buffer.concat([key, Buffer.alloc(24 - key.length)]);
  } else if (algorithm.startsWith("aes-256") && key.length !== 32) {
    key = key.length > 32 ? key.subarray(0, 32) : Buffer.concat([key, Buffer.alloc(32 - key.length)]);
  } else if (algorithm.startsWith("des-ede3")) {
    // 须先于 `des-` 判断：des-ede3-cbc 也 startsWith("des-")，原先在已是 24 字节时仍被截成 8 → Invalid key length
    if (key.length === 16) {
      // Java/Hutool 两密钥 3DES：K1|K2|K1
      key = Buffer.concat([key, key.subarray(0, 8)]);
    } else if (key.length !== 24) {
      key =
        key.length > 24
          ? key.subarray(0, 24)
          : Buffer.concat([key, Buffer.alloc(24 - key.length)]);
    }
  } else if (algorithm.startsWith("des-ede") && key.length !== 16) {
    key =
      key.length > 16
        ? key.subarray(0, 16)
        : Buffer.concat([key, Buffer.alloc(16 - key.length)]);
  } else if (algorithm.startsWith("des-") && key.length !== 8) {
    key = key.length > 8 ? key.subarray(0, 8) : Buffer.concat([key, Buffer.alloc(8 - key.length)]);
  }
  return key;
}

function normalizeIv(raw: unknown, algorithm: string): Buffer | null {
  if (algorithm.endsWith("-ecb")) return null;
  let iv = toKeyBuffer(raw);
  if (!iv.length) {
    const block = algorithm.startsWith("des") ? 8 : 16;
    return Buffer.alloc(block);
  }
  const block = algorithm.startsWith("des") ? 8 : 16;
  if (iv.length !== block) {
    iv = iv.length > block ? iv.subarray(0, block) : Buffer.concat([iv, Buffer.alloc(block - iv.length)]);
  }
  return iv;
}

/** Legado java.createSymmetricCrypto(transformation, key, iv) */
export function createSymmetricCrypto(
  transformation: unknown,
  key: unknown,
  iv?: unknown,
): LegadoSymmetricCipher {
  const trans = String(transformation ?? "AES/CBC/PKCS5Padding");
  const keyBuf = toKeyBuffer(key);
  const { algorithm } = resolveNodeAlgorithm(trans, keyBuf);
  const normalizedKey = normalizeKey(keyBuf, algorithm);
  const normalizedIv = normalizeIv(iv, algorithm);

  const runCipher = (data: unknown, encrypt: boolean) => {
    const input = toBuffer(data);
    const block = algorithm.startsWith("des") ? 8 : 16;
    if (!encrypt && !algorithm.endsWith("-ecb") && input.length % block !== 0) {
      throw new Error(
        `CryptoException: Input length (${input.length}) not multiple of block size (${block})`,
      );
    }
    if (algorithm.endsWith("-ecb")) {
      const fn = encrypt ? createCipheriv : createDecipheriv;
      const c = fn(algorithm, normalizedKey, null);
      return Buffer.concat([c.update(input), c.final()]);
    }
    const ivBuf = normalizedIv ?? Buffer.alloc(algorithm.startsWith("des") ? 8 : 16);
    const fn = encrypt ? createCipheriv : createDecipheriv;
    const c = fn(algorithm, normalizedKey, ivBuf);
    return Buffer.concat([c.update(input), c.final()]);
  };

  return {
    decrypt: (data) => runCipher(data, false),
    decryptStr: (data) => runCipher(data, false).toString("utf8"),
    encrypt: (data) => runCipher(data, true),
    encryptBase64: (data) => runCipher(data, true).toString("base64"),
    encryptHex: (data) => runCipher(data, true).toString("hex"),
  };
}

/** Legado 旧 API：java.aesDecodeToString */
export function aesDecodeToString(
  data: unknown,
  key: unknown,
  transformation: unknown,
  iv: unknown,
): string {
  return createSymmetricCrypto(
    transformation ?? "AES/CBC/PKCS5Padding",
    key,
    iv,
  ).decryptStr(data);
}

/** Legado：java.aesBase64DecodeToString — 密文强制按 Base64 解码后再 AES 解密 */
export function aesBase64DecodeToString(
  data: unknown,
  key: unknown,
  transformation: unknown,
  iv: unknown,
): string {
  // 对齐 Hutool：空密文抛 IllegalArgumentException: Null input buffer（勿静默返回空串）
  if (data == null) {
    throw new Error("CryptoException: IllegalArgumentException: Null input buffer");
  }
  const text = String(data).trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!text) {
    throw new Error("CryptoException: IllegalArgumentException: Null input buffer");
  }
  const buf = Buffer.from(text, "base64");
  if (!buf.length) {
    throw new Error("CryptoException: IllegalArgumentException: Null input buffer");
  }
  return createSymmetricCrypto(
    transformation ?? "AES/CBC/PKCS5Padding",
    key,
    iv,
  ).decryptStr(buf);
}
