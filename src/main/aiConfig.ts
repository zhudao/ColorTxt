import { app } from "electron";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import {
  collectChatProfileApiKeys,
  collectTxt2ImgProfileApiKeys,
  ensureAiConfigProfiles,
  hydrateChatProfilesApiKeys,
  hydrateTxt2ImgProfilesApiKeys,
  LEGACY_DEFAULT_PROFILE_ID,
  parseProfileKeysBlob,
  serializeProfileKeysBlob,
  stripProfileApiKeysForDisk,
} from "@shared/aiEndpointProfiles";
import {
  type AIConfig,
  defaultAIConfig,
  normalizeAiQuickQuestions,
  normalizeEmbeddingEndpoint,
  normalizeTokenPricePerMillion,
  normalizeTxt2ImgConfig,
  normalizeWordcloudMaxWords,
} from "@shared/aiTypes";
import {
  SECRET_SLOT_AI_CHAT_API_KEY,
  SECRET_SLOT_AI_CHAT_PROFILE_KEYS,
  SECRET_SLOT_AI_EMBEDDING_API_KEY,
  SECRET_SLOT_AI_TXT2IMG_API_KEY,
  SECRET_SLOT_AI_TXT2IMG_PROFILE_KEYS,
} from "@shared/secretSlots";
import {
  aiConfigFilePath,
  defaultBuiltinModelCacheRoot,
  resolveAiDataCacheRoot,
} from "./aiPaths";
import {
  readDataCacheRootBootstrap,
  upgradeLegacyAiDataLayoutIfNeeded,
  writeDataCacheRootBootstrap,
} from "./aiDataFs";
import { getSecret, setSecretsBatch } from "./secretStorage";

/** IPC / 磁盘读取后的不完整对象也可合并为完整 AIConfig */
export function mergeAiConfigWithDefaults(raw: unknown): AIConfig {
  const base = structuredClone(defaultAIConfig);
  if (!raw || typeof raw !== "object") return ensureAiConfigProfiles(base);
  const o = raw as Record<string, unknown>;
  if (typeof o.aiDataCacheDir === "string") {
    base.aiDataCacheDir = o.aiDataCacheDir;
  }
  if (o.chat && typeof o.chat === "object") {
    Object.assign(base.chat, o.chat as object);
    base.chat.tokenPricePerMillion = normalizeTokenPricePerMillion(
      (o.chat as Record<string, unknown>).tokenPricePerMillion,
    );
  }
  base.embedding = normalizeEmbeddingEndpoint(o.embedding);
  if (typeof o.aiEnabled === "boolean") {
    base.aiEnabled = o.aiEnabled;
  }
  if (typeof o.embeddingEnabled === "boolean") {
    base.embeddingEnabled = o.embeddingEnabled;
  }
  for (const k of [
    "chunkTargetTokens",
    "chunkMinTokens",
    "chunkOverlapRatio",
    "ragTopK",
  ] as const) {
    if (typeof o[k] === "number" && Number.isFinite(o[k])) {
      (base as unknown as Record<string, number>)[k] = o[k] as number;
    }
  }
  base.quickQuestions = normalizeAiQuickQuestions(o.quickQuestions);
  if (typeof o.showTokenUsage === "boolean") {
    base.showTokenUsage = o.showTokenUsage;
  }
  if (typeof o.autoMindmapOnSummaryAndCharacters === "boolean") {
    base.autoMindmapOnSummaryAndCharacters =
      o.autoMindmapOnSummaryAndCharacters;
  }
  base.wordcloudMaxWords = normalizeWordcloudMaxWords(o.wordcloudMaxWords);
  base.txt2img = normalizeTxt2ImgConfig(o.txt2img);
  if (Array.isArray(o.chatProfiles)) {
    base.chatProfiles = o.chatProfiles as AIConfig["chatProfiles"];
  }
  if (typeof o.activeChatProfileId === "string") {
    base.activeChatProfileId = o.activeChatProfileId;
  }
  if (Array.isArray(o.txt2imgProfiles)) {
    base.txt2imgProfiles = o.txt2imgProfiles as AIConfig["txt2imgProfiles"];
  }
  if (typeof o.activeTxt2ImgProfileId === "string") {
    base.activeTxt2ImgProfileId = o.activeTxt2ImgProfileId;
  }
  return ensureAiConfigProfiles(base);
}

function stripApiKeysForDisk(cfg: AIConfig): AIConfig {
  const disk = structuredClone(cfg);
  disk.chat.apiKey = "";
  disk.embedding.apiKey = "";
  disk.txt2img.apiKey = "";
  stripProfileApiKeysForDisk(disk);
  return disk;
}

async function loadProfileKeyMaps(): Promise<{
  chat: Record<string, string>;
  txt2img: Record<string, string>;
}> {
  const [chatRaw, txt2imgRaw] = await Promise.all([
    getSecret(SECRET_SLOT_AI_CHAT_PROFILE_KEYS),
    getSecret(SECRET_SLOT_AI_TXT2IMG_PROFILE_KEYS),
  ]);
  return {
    chat: parseProfileKeysBlob(chatRaw),
    txt2img: parseProfileKeysBlob(txt2imgRaw),
  };
}

async function hydrateApiKeysFromVault(cfg: AIConfig): Promise<{
  cfg: AIConfig;
  migratedPlaintext: boolean;
  profileKeysMigrated: boolean;
}> {
  const next = ensureAiConfigProfiles(structuredClone(cfg));
  let migratedPlaintext = false;
  let profileKeysMigrated = false;

  const chatVault = await getSecret(SECRET_SLOT_AI_CHAT_API_KEY);
  const embedVault = await getSecret(SECRET_SLOT_AI_EMBEDDING_API_KEY);
  const txt2imgVault = await getSecret(SECRET_SLOT_AI_TXT2IMG_API_KEY);
  const profileMaps = await loadProfileKeyMaps();
  const chatProfileKeys = { ...profileMaps.chat };
  const txt2imgProfileKeys = { ...profileMaps.txt2img };

  const activeChatId = next.activeChatProfileId.trim();
  if (
    activeChatId &&
    !chatProfileKeys[activeChatId]?.trim() &&
    chatVault?.trim()
  ) {
    chatProfileKeys[activeChatId] = chatVault.trim();
    profileKeysMigrated = true;
  }
  const activeTxt2ImgId = next.activeTxt2ImgProfileId.trim();
  if (
    activeTxt2ImgId &&
    !txt2imgProfileKeys[activeTxt2ImgId]?.trim() &&
    txt2imgVault?.trim()
  ) {
    txt2imgProfileKeys[activeTxt2ImgId] = txt2imgVault.trim();
    profileKeysMigrated = true;
  }

  hydrateChatProfilesApiKeys(next.chatProfiles, chatProfileKeys);
  hydrateTxt2ImgProfilesApiKeys(next.txt2imgProfiles, txt2imgProfileKeys);

  const defaultChatProfile = next.chatProfiles.find(
    (p) => p.id === LEGACY_DEFAULT_PROFILE_ID,
  );
  const defaultTxt2ImgProfile = next.txt2imgProfiles.find(
    (p) => p.id === LEGACY_DEFAULT_PROFILE_ID,
  );

  if (Object.keys(chatProfileKeys).length === 0) {
    if (chatVault) {
      if (defaultChatProfile) chatProfileKeys[defaultChatProfile.id] = chatVault;
      profileKeysMigrated = true;
    } else if (next.chat.apiKey.trim()) {
      if (defaultChatProfile) {
        chatProfileKeys[defaultChatProfile.id] = next.chat.apiKey.trim();
      }
      migratedPlaintext = true;
      profileKeysMigrated = true;
    }
  }

  if (Object.keys(txt2imgProfileKeys).length === 0) {
    if (txt2imgVault) {
      if (defaultTxt2ImgProfile) {
        txt2imgProfileKeys[defaultTxt2ImgProfile.id] = txt2imgVault;
      }
      profileKeysMigrated = true;
    } else if (next.txt2img.apiKey.trim()) {
      if (defaultTxt2ImgProfile) {
        txt2imgProfileKeys[defaultTxt2ImgProfile.id] = next.txt2img.apiKey.trim();
      }
      migratedPlaintext = true;
      profileKeysMigrated = true;
    }
  }

  hydrateChatProfilesApiKeys(next.chatProfiles, chatProfileKeys);
  hydrateTxt2ImgProfilesApiKeys(next.txt2imgProfiles, txt2imgProfileKeys);
  ensureAiConfigProfiles(next);

  if (embedVault) {
    next.embedding.apiKey = embedVault;
  } else if (next.embedding.apiKey.trim()) {
    migratedPlaintext = true;
  }

  const activeChatKey =
    chatProfileKeys[next.activeChatProfileId] ?? next.chat.apiKey;
  const activeTxt2ImgKey =
    txt2imgProfileKeys[next.activeTxt2ImgProfileId] ?? next.txt2img.apiKey;

  if (chatVault && activeChatKey && chatVault !== activeChatKey) {
    profileKeysMigrated = true;
  }
  if (txt2imgVault && activeTxt2ImgKey && txt2imgVault !== activeTxt2ImgKey) {
    profileKeysMigrated = true;
  }

  if (migratedPlaintext || profileKeysMigrated) {
    await setSecretsBatch({
      [SECRET_SLOT_AI_CHAT_API_KEY]: activeChatKey,
      [SECRET_SLOT_AI_EMBEDDING_API_KEY]: next.embedding.apiKey,
      [SECRET_SLOT_AI_TXT2IMG_API_KEY]: activeTxt2ImgKey,
      [SECRET_SLOT_AI_CHAT_PROFILE_KEYS]:
        serializeProfileKeysBlob(chatProfileKeys),
      [SECRET_SLOT_AI_TXT2IMG_PROFILE_KEYS]:
        serializeProfileKeysBlob(txt2imgProfileKeys),
    });
  }

  return { cfg: next, migratedPlaintext, profileKeysMigrated };
}

async function resolveConfigPathForLoad(): Promise<string> {
  await upgradeLegacyAiDataLayoutIfNeeded();
  const boot = await readDataCacheRootBootstrap();
  if (boot) return path.join(path.resolve(boot), "config.json");
  return aiConfigFilePath();
}

async function writeConfigJson(cfg: AIConfig): Promise<void> {
  const dir = resolveAiDataCacheRoot(cfg);
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, "config.json");
  const diskCfg = stripApiKeysForDisk(cfg);
  const json = `${JSON.stringify(diskCfg, null, 2)}\n`;
  await writeFile(p, json, "utf-8");
  try {
    await chmod(p, 0o600);
  } catch {
    // Windows 等可能不支持
  }
  await writeDataCacheRootBootstrap(dir);
}

export async function loadAiConfig(): Promise<AIConfig> {
  try {
    const p = await resolveConfigPathForLoad();
    const buf = await readFile(p, "utf-8");
    const merged = mergeAiConfigWithDefaults(JSON.parse(buf));
    const { cfg, migratedPlaintext, profileKeysMigrated } =
      await hydrateApiKeysFromVault(merged);
    if (migratedPlaintext || profileKeysMigrated) {
      await writeConfigJson(cfg);
    }
    return cfg;
  } catch {
    const merged = structuredClone(defaultAIConfig);
    const { cfg } = await hydrateApiKeysFromVault(merged);
    return cfg;
  }
}

export async function saveAiConfig(cfg: AIConfig): Promise<void> {
  const next = ensureAiConfigProfiles(structuredClone(cfg));
  const chatProfileKeys = collectChatProfileApiKeys(next.chatProfiles);
  const txt2imgProfileKeys = collectTxt2ImgProfileApiKeys(next.txt2imgProfiles);

  await setSecretsBatch({
    [SECRET_SLOT_AI_CHAT_API_KEY]: next.chat.apiKey,
    [SECRET_SLOT_AI_EMBEDDING_API_KEY]: next.embedding.apiKey,
    [SECRET_SLOT_AI_TXT2IMG_API_KEY]: next.txt2img.apiKey,
    [SECRET_SLOT_AI_CHAT_PROFILE_KEYS]:
      serializeProfileKeysBlob(chatProfileKeys),
    [SECRET_SLOT_AI_TXT2IMG_PROFILE_KEYS]:
      serializeProfileKeysBlob(txt2imgProfileKeys),
  });
  await writeConfigJson(next);
}

export function getDefaultAiDataCacheDirSync(): string {
  return resolveAiDataCacheRoot();
}

export function getDefaultBuiltinModelCacheDirSync(): string {
  return defaultBuiltinModelCacheRoot(app.getPath("userData"));
}
