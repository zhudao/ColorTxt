import {
  ensureVoiceReadProfilesBundle,
  LEGACY_DEFAULT_VOICE_READ_PROFILE_ID,
  MAX_VOICE_READ_PROFILES,
  normalizeVoiceReadProfile,
  normalizeVoiceReadProfiles,
  type VoiceReadProfile,
  type VoiceReadProfilesBundle,
} from "@shared/voiceReadProfiles";
import type { AITokenUsageTotals } from "@shared/aiTokenUsage";
import { toRaw } from "vue";
import {
  mergeVoiceReadSettings,
  type VoiceReadSettings,
} from "../../constants/voiceRead";

export type PersistedVoiceReadRaw = Partial<VoiceReadSettings> & {
  profiles?: unknown;
  activeProfileId?: unknown;
  aiSpeakerTokenUsage?: Partial<AITokenUsageTotals> | null;
  aiSpeakerTokenUsageAvailable?: unknown;
};

function normalizeProfileSettings(partial: unknown): VoiceReadSettings {
  return mergeVoiceReadSettings(
    partial && typeof partial === "object"
      ? (partial as Partial<VoiceReadSettings>)
      : undefined,
  );
}

function extractLegacySettings(
  raw: PersistedVoiceReadRaw | undefined,
): VoiceReadSettings {
  if (!raw || typeof raw !== "object") {
    return mergeVoiceReadSettings(undefined);
  }
  const { profiles: _profiles, activeProfileId: _active, aiSpeakerTokenUsage: _usage, aiSpeakerTokenUsageAvailable: _usageAvail, ...legacy } = raw;
  return mergeVoiceReadSettings(legacy);
}

export function migrateVoiceReadFromPersisted(
  raw: PersistedVoiceReadRaw | undefined,
): VoiceReadProfilesBundle & { activeSettings: VoiceReadSettings } {
  const fallbackSettings = extractLegacySettings(raw);
  const hadProfiles = Array.isArray(raw?.profiles) && raw!.profiles!.length > 0;
  const bundle = ensureVoiceReadProfilesBundle(
    hadProfiles ? raw?.profiles : undefined,
    hadProfiles ? raw?.activeProfileId : LEGACY_DEFAULT_VOICE_READ_PROFILE_ID,
    fallbackSettings,
    normalizeProfileSettings,
  );

  if (!hadProfiles) {
    bundle.profiles = normalizeVoiceReadProfiles(
      undefined,
      fallbackSettings,
      normalizeProfileSettings,
    );
    const defaultProfile = bundle.profiles[0];
    if (defaultProfile) {
      defaultProfile.settings = fallbackSettings;
    }
    bundle.activeProfileId = bundle.profiles[0]?.id ?? bundle.activeProfileId;
  }

  const active =
    bundle.profiles.find((p) => p.id === bundle.activeProfileId) ??
    bundle.profiles[0]!;
  return {
    ...bundle,
    activeSettings: mergeVoiceReadSettings(active.settings),
  };
}

export function normalizeVoiceReadProfilesForSave(
  profiles: VoiceReadProfile[],
): VoiceReadProfile[] {
  return profiles.map((p) => ({
    ...p,
    settings: normalizeProfileSettings(p.settings),
  }));
}

/**
 * 多窗口保存时按 `id` 合并朗读方案：
 * - 本窗 `local` 中的方案（新建/修改）优先
 * - 磁盘有、本窗没有、且不在 `baselineKnownIds` → 视为其它窗新增，保留
 * - 在 `baselineKnownIds` 中、本窗没有 → 视为本窗删除，丢弃
 * 合并后总数不超过 `maxProfiles`（先保本窗顺序，再追加保留的磁盘方案）。
 */
export function mergeVoiceReadProfilesForPersist(opts: {
  localProfiles: readonly VoiceReadProfile[];
  diskProfiles: readonly VoiceReadProfile[];
  baselineKnownIds: ReadonlySet<string>;
  localActiveProfileId: string;
  diskActiveProfileId?: string;
  maxProfiles?: number;
}): { profiles: VoiceReadProfile[]; activeProfileId: string } {
  const max = opts.maxProfiles ?? MAX_VOICE_READ_PROFILES;
  const local = normalizeVoiceReadProfilesForSave(
    Array.isArray(opts.localProfiles) ? [...opts.localProfiles] : [],
  );
  const disk = normalizeVoiceReadProfilesForSave(
    Array.isArray(opts.diskProfiles) ? [...opts.diskProfiles] : [],
  );
  const localById = new Map(local.map((p) => [p.id, p]));
  const diskById = new Map(disk.map((p) => [p.id, p]));
  const out: VoiceReadProfile[] = [];
  const seen = new Set<string>();

  for (const p of local) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= max) break;
  }

  if (out.length < max) {
    for (const p of disk) {
      if (seen.has(p.id)) continue;
      if (localById.has(p.id)) continue;
      if (opts.baselineKnownIds.has(p.id)) continue; // 本窗删除
      seen.add(p.id);
      out.push(diskById.get(p.id) ?? p);
      if (out.length >= max) break;
    }
  }

  const localActive = opts.localActiveProfileId.trim();
  const diskActive = (opts.diskActiveProfileId ?? "").trim();
  let activeProfileId = localActive;
  if (!out.some((p) => p.id === activeProfileId)) {
    activeProfileId = diskActive;
  }
  if (!out.some((p) => p.id === activeProfileId)) {
    activeProfileId = out[0]?.id ?? "";
  }

  return { profiles: out, activeProfileId };
}

/** Vue 响应式对象无法 structuredClone，先 toRaw 再归一化为纯数据 */
export function cloneVoiceReadProfiles(
  source: readonly VoiceReadProfile[],
): VoiceReadProfile[] {
  const list = toRaw(source) as VoiceReadProfile[];
  return normalizeVoiceReadProfilesForSave(Array.isArray(list) ? list : []);
}

export { normalizeVoiceReadProfile, normalizeVoiceReadProfiles };
