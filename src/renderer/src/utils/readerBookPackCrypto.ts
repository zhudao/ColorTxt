/** 彩读书包整包加密：AES-256-GCM + PBKDF2（空密码时不加密，仍为普通 ZIP） */

const MAGIC = new TextEncoder().encode("CTZE");
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 256;
const PBKDF2_ITERATIONS = 210_000;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN;

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function asArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
}

export function isEncryptedBookPackBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEADER_LEN + 16) return false;
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    if (u8[i] !== MAGIC[i]) return false;
  }
  return u8[MAGIC.length] === VERSION;
}

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_LEN },
    false,
    ["encrypt", "decrypt"],
  );
}

/** 有密码时加密 ZIP；空密码原样返回 */
export async function sealBookPackZipIfNeeded(
  zipBuffer: ArrayBuffer,
  password: string,
): Promise<ArrayBuffer> {
  const pw = password.trim();
  if (!pw) return zipBuffer;

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveAesKey(pw, salt);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    zipBuffer,
  );
  const header = concatBytes(MAGIC, new Uint8Array([VERSION]), salt, iv);
  return asArrayBuffer(concatBytes(header, new Uint8Array(cipherBuf)));
}

/**
 * 若为 CTZE 加密包则解密；否则原样返回。
 * 加密包且密码为空 / 错误时返回对应 `code`，便于弹出输入框重试。
 */
export async function openBookPackZipPayload(
  buffer: ArrayBuffer,
  password: string,
): Promise<
  | { ok: true; zipBuffer: ArrayBuffer }
  | {
      ok: false;
      code: "needPassword" | "wrongPassword";
      error: string;
    }
> {
  if (!isEncryptedBookPackBuffer(buffer)) {
    return { ok: true, zipBuffer: buffer };
  }

  const pw = password.trim();
  if (!pw) {
    return {
      ok: false,
      code: "needPassword",
      error: "书包已加密，请输入密码",
    };
  }

  const u8 = new Uint8Array(buffer);
  const salt = u8.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT_LEN);
  const iv = u8.subarray(
    MAGIC.length + 1 + SALT_LEN,
    MAGIC.length + 1 + SALT_LEN + IV_LEN,
  );
  const cipher = u8.subarray(HEADER_LEN);

  try {
    const key = await deriveAesKey(pw, salt);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv) },
      key,
      asArrayBuffer(cipher),
    );
    return { ok: true, zipBuffer: plain };
  } catch {
    return {
      ok: false,
      code: "wrongPassword",
      error: "书包密码不正确，或文件已损坏",
    };
  }
}
