import { app, safeStorage } from "electron";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SecretSlotId } from "@shared/secretSlots";

type SecretsBackend = "safeStorage" | "appBound";

type SecretsFileV1 = {
  version: 1;
  backend: SecretsBackend;
  values: Partial<Record<string, string>>;
};

const SECRETS_FILE = "secrets.v1.json";
const APP_BOUND_SALT = "colortxt-secrets-v1";
const APP_BOUND_IV_LEN = 12;
const APP_BOUND_TAG_LEN = 16;

let memoryCache: SecretsFileV1 | null = null;
let secretsWriteQueue: Promise<void> = Promise.resolve();

function runSerializedSecretsWrite<T>(fn: () => Promise<T>): Promise<T> {
  const task = secretsWriteQueue.then(fn, fn);
  secretsWriteQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export function isSystemSecretEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function secretStorageBackendLabel(): SecretsBackend | "unavailable" {
  return isSystemSecretEncryptionAvailable() ? "safeStorage" : "appBound";
}

function secretsFilePath(): string {
  return path.join(app.getPath("userData"), "ai", SECRETS_FILE);
}

function emptySecretsFile(): SecretsFileV1 {
  return {
    version: 1,
    backend: isSystemSecretEncryptionAvailable() ? "safeStorage" : "appBound",
    values: {},
  };
}

function appBoundKey(): Buffer {
  const seed = `${app.getPath("userData")}:${APP_BOUND_SALT}`;
  return scryptSync(seed, APP_BOUND_SALT, 32);
}

function encryptAppBound(plain: string): string {
  const iv = randomBytes(APP_BOUND_IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", appBoundKey(), iv);
  const enc = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptAppBound(payloadB64: string): string {
  const buf = Buffer.from(payloadB64, "base64");
  if (buf.length <= APP_BOUND_IV_LEN + APP_BOUND_TAG_LEN) return "";
  const iv = buf.subarray(0, APP_BOUND_IV_LEN);
  const tag = buf.subarray(APP_BOUND_IV_LEN, APP_BOUND_IV_LEN + APP_BOUND_TAG_LEN);
  const data = buf.subarray(APP_BOUND_IV_LEN + APP_BOUND_TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", appBoundKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function encryptSecret(plain: string, backend: SecretsBackend): string {
  if (!plain) return "";
  if (backend === "safeStorage") {
    if (!isSystemSecretEncryptionAvailable()) {
      return encryptAppBound(plain);
    }
    return safeStorage.encryptString(plain).toString("base64");
  }
  return encryptAppBound(plain);
}

function decryptSecret(payloadB64: string, backend: SecretsBackend): string {
  if (!payloadB64) return "";
  try {
    if (backend === "safeStorage") {
      if (!isSystemSecretEncryptionAvailable()) {
        return decryptAppBound(payloadB64);
      }
      return safeStorage.decryptString(Buffer.from(payloadB64, "base64"));
    }
    return decryptAppBound(payloadB64);
  } catch {
    return "";
  }
}

async function persistSecretsFile(file: SecretsFileV1): Promise<void> {
  const dir = path.dirname(secretsFilePath());
  await mkdir(dir, { recursive: true });
  const p = secretsFilePath();
  const tmp = `${p}.tmp`;
  const json = `${JSON.stringify(file, null, 2)}\n`;
  await writeFile(tmp, json, "utf-8");
  try {
    await chmod(tmp, 0o600);
  } catch {
    /* Windows 等可能不支持 */
  }
  try {
    await rename(tmp, p);
  } catch {
    await writeFile(p, json, "utf-8");
    try {
      await chmod(p, 0o600);
    } catch {
      /* ignore */
    }
    await unlink(tmp).catch(() => undefined);
  }
  memoryCache = structuredClone(file);
}

async function loadSecretsFile(): Promise<SecretsFileV1> {
  if (memoryCache) return memoryCache;
  try {
    const raw = JSON.parse(await readFile(secretsFilePath(), "utf-8")) as unknown;
    if (
      raw &&
      typeof raw === "object" &&
      (raw as SecretsFileV1).version === 1 &&
      typeof (raw as SecretsFileV1).values === "object"
    ) {
      const file = raw as SecretsFileV1;
      file.backend =
        file.backend === "safeStorage" || file.backend === "appBound"
          ? file.backend
          : isSystemSecretEncryptionAvailable()
            ? "safeStorage"
            : "appBound";
      memoryCache = file;
      return file;
    }
  } catch {
    /* 首次启动 */
  }
  const created = emptySecretsFile();
  memoryCache = created;
  return created;
}

export async function getSecret(slot: SecretSlotId): Promise<string> {
  const file = await loadSecretsFile();
  const enc = file.values[slot];
  if (!enc) return "";
  return decryptSecret(enc, file.backend);
}

export async function setSecret(
  slot: SecretSlotId,
  plain: string,
): Promise<void> {
  await runSerializedSecretsWrite(async () => {
    const file = structuredClone(await loadSecretsFile());
    const trimmed = plain.trim();
    if (!trimmed) {
      delete file.values[slot];
    } else {
      file.backend = isSystemSecretEncryptionAvailable()
        ? "safeStorage"
        : "appBound";
      file.values[slot] = encryptSecret(trimmed, file.backend);
    }
    await persistSecretsFile(file);
  });
}

export async function clearSecret(slot: SecretSlotId): Promise<void> {
  await setSecret(slot, "");
}

export async function setSecretsBatch(
  entries: Partial<Record<SecretSlotId, string>>,
  opts?: { skipEmpty?: boolean },
): Promise<void> {
  await runSerializedSecretsWrite(async () => {
    const file = structuredClone(await loadSecretsFile());
    file.backend = isSystemSecretEncryptionAvailable()
      ? "safeStorage"
      : "appBound";
    for (const [slot, value] of Object.entries(entries) as Array<
      [SecretSlotId, string | undefined]
    >) {
      const trimmed = (value ?? "").trim();
      if (!trimmed) {
        if (!opts?.skipEmpty) delete file.values[slot];
      } else {
        file.values[slot] = encryptSecret(trimmed, file.backend);
      }
    }
    await persistSecretsFile(file);
  });
}

/** 读取已废弃 slot（仅迁移用） */
export async function getDeprecatedSecret(slot: string): Promise<string> {
  const file = await loadSecretsFile();
  const enc = file.values[slot];
  if (!enc) return "";
  return decryptSecret(enc, file.backend);
}

/** 从磁盘删除已废弃 slot */
export async function purgeDeprecatedSecretSlots(
  slots: readonly string[],
): Promise<void> {
  if (slots.length === 0) return;
  await runSerializedSecretsWrite(async () => {
    const file = structuredClone(await loadSecretsFile());
    let changed = false;
    for (const slot of slots) {
      if (file.values[slot]) {
        delete file.values[slot];
        changed = true;
      }
    }
    if (changed) await persistSecretsFile(file);
  });
}
