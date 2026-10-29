import { ipcMain } from "electron";
import {
  DEPRECATED_SECRET_SLOT_VOICE_READ_DASHSCOPE_API_KEY,
  DEPRECATED_SECRET_SLOTS,
  isDeprecatedSecretSlot,
  SECRET_SLOT_VOICE_READ_PROFILE_KEYS,
  SECRET_SLOT_WEBDAV_PASSWORD,
  SECRET_SLOT_TRANSLATION_PROVIDER_KEYS,
  type SecretSlotId,
} from "@shared/secretSlots";
import {
  getDeprecatedSecret,
  getSecret,
  isSystemSecretEncryptionAvailable,
  purgeDeprecatedSecretSlots,
  secretStorageBackendLabel,
  setSecret,
  setSecretsBatch,
} from "./secretStorage";

function isRendererReadableSecretSlot(slot: unknown): slot is SecretSlotId {
  return (
    slot === SECRET_SLOT_VOICE_READ_PROFILE_KEYS ||
    slot === SECRET_SLOT_WEBDAV_PASSWORD ||
    slot === SECRET_SLOT_TRANSLATION_PROVIDER_KEYS
  );
}

export function registerSecretsIpcHandlers(): void {
  ipcMain.handle("secrets:isEncryptionAvailable", () => ({
    ok: true as const,
    available: isSystemSecretEncryptionAvailable(),
    backend: secretStorageBackendLabel(),
  }));

  ipcMain.handle("secrets:getDeprecated", async (_evt, slotRaw: unknown) => {
    if (typeof slotRaw !== "string" || !isDeprecatedSecretSlot(slotRaw)) {
      return { ok: false as const, error: "不支持的已废弃密钥类型" };
    }
    return {
      ok: true as const,
      value: await getDeprecatedSecret(slotRaw),
    };
  });

  ipcMain.handle("secrets:get", async (_evt, slotRaw: unknown) => {
    if (!isRendererReadableSecretSlot(slotRaw)) {
      return { ok: false as const, error: "不支持的密钥类型" };
    }
    return {
      ok: true as const,
      value: await getSecret(slotRaw),
    };
  });

  ipcMain.handle("secrets:set", async (_evt, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = payload as { slot?: unknown; value?: unknown };
    if (!isRendererReadableSecretSlot(o.slot)) {
      return { ok: false as const, error: "不支持的密钥类型" };
    }
    await setSecret(o.slot, typeof o.value === "string" ? o.value : "");
    return { ok: true as const };
  });

  /** 语音朗读方案密钥一次落盘（与 AI configSet 对齐） */
  ipcMain.handle("secrets:setVoiceReadSecrets", async (_evt, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = payload as { profileKeys?: unknown };
    const profileKeys =
      typeof o.profileKeys === "string" ? o.profileKeys.trim() : "";
    await setSecretsBatch({
      [SECRET_SLOT_VOICE_READ_PROFILE_KEYS]: profileKeys,
    });
    await purgeDeprecatedSecretSlots([
      DEPRECATED_SECRET_SLOT_VOICE_READ_DASHSCOPE_API_KEY,
    ]);
    return { ok: true as const };
  });

  ipcMain.handle("secrets:setWebDavPassword", async (_evt, password: unknown) => {
    const value = typeof password === "string" ? password : "";
    await setSecret(SECRET_SLOT_WEBDAV_PASSWORD, value);
    return { ok: true as const };
  });

  ipcMain.handle(
    "secrets:setTranslationSecrets",
    async (_evt, payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return { ok: false as const, error: "无效参数" };
      }
      const o = payload as { providerKeys?: unknown };
      const providerKeys =
        typeof o.providerKeys === "string" ? o.providerKeys.trim() : "";
      await setSecretsBatch({
        [SECRET_SLOT_TRANSLATION_PROVIDER_KEYS]: providerKeys,
      });
      return { ok: true as const };
    },
  );

  ipcMain.handle("secrets:purgeDeprecated", async () => {
    await purgeDeprecatedSecretSlots(DEPRECATED_SECRET_SLOTS);
    return { ok: true as const };
  });
}
