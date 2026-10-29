import type { WebDavAuthPayload } from "@shared/webDavIpc";
import {
  stripVoiceReadProfileApiKeysForDisk,
  stripVoiceReadSettingsApiKeysForDisk,
} from "@shared/voiceReadProfiles";
import { persistKey, persistedSettingsChangedEvent } from "../constants/appUi";
import { parseReaderBackgroundState } from "../constants/readerBackground";
import {
  deleteUnreferencedLocalBackgroundFiles,
  downloadReaderBackgroundFiles,
  pruneRemoteOrphanBackgroundFiles,
  readerBackgroundFromLocalStorage,
  uniqueCustomBackgroundFileNames,
  uploadReaderBackgroundFiles,
} from "./webDavReaderBackgroundSync";

const REPLACE_APP = "colortxt:replaceRules:app";

/** 从当前 localStorage 读取 ui settings 并剥离语音 API 密钥 */
export function buildMainSettingsJsonForSync(): string {
  let raw: Record<string, unknown> = {};
  try {
    const s = localStorage.getItem(persistKey);
    if (s) raw = JSON.parse(s) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const next = { ...raw };
  if (next.voiceRead && typeof next.voiceRead === "object") {
    const vr = next.voiceRead as Record<string, unknown>;
    const stripped = stripVoiceReadSettingsApiKeysForDisk(vr as never) as Record<
      string,
      unknown
    >;
    if (Array.isArray(vr.profiles)) {
      stripped.profiles = stripVoiceReadProfileApiKeysForDisk(vr.profiles as never);
    }
    next.voiceRead = stripped;
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

export async function uploadMainConfig(
  auth: WebDavAuthPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const ensure = await api.ensureLayout(auth);
  if (!ensure.ok) return ensure;
  const files = await uploadReaderBackgroundFiles(auth);
  if (!files.ok) return files;
  const settingsBody = buildMainSettingsJsonForSync();
  let rulesBody = "[]";
  try {
    rulesBody = localStorage.getItem(REPLACE_APP) ?? "[]";
  } catch {
    rulesBody = "[]";
  }
  const r1 = await api.putText(auth, "Main/settings.json", settingsBody);
  if (!r1.ok) return r1;
  const r2 = await api.putText(
    auth,
    "Main/replaceRules.json",
    rulesBody.endsWith("\n") ? rulesBody : `${rulesBody}\n`,
  );
  if (!r2.ok) return r2;
  return pruneRemoteOrphanBackgroundFiles(auth);
}

export async function downloadMainConfig(
  auth: WebDavAuthPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const s = await api.getText(auth, "Main/settings.json");
  if (!s.ok) return s;
  const prevNames = uniqueCustomBackgroundFileNames(
    readerBackgroundFromLocalStorage(),
  );
  try {
    const parsed = JSON.parse(s.text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "远端 settings.json 格式无效" };
    }
    const nextBg = parseReaderBackgroundState(
      (parsed as Record<string, unknown>).readerBackground,
    );
    const files = await downloadReaderBackgroundFiles(auth, nextBg);
    if (!files.ok) return files;
    localStorage.setItem(persistKey, JSON.stringify(parsed));
    await deleteUnreferencedLocalBackgroundFiles(
      prevNames,
      uniqueCustomBackgroundFileNames(nextBg),
    );
    window.dispatchEvent(new Event(persistedSettingsChangedEvent));
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "解析 settings.json 失败",
    };
  }
  const r = await api.getText(auth, "Main/replaceRules.json");
  if (r.ok) {
    try {
      JSON.parse(r.text);
      localStorage.setItem(REPLACE_APP, r.text.trim() ? r.text : "[]");
    } catch {
      return { ok: false, error: "远端 replaceRules.json 格式无效" };
    }
  }
  return { ok: true };
}
