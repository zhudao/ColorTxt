import { computed, ref, toRaw, watch, type Ref } from "vue";
import {
  createVoiceReadProfile,
  MAX_VOICE_READ_PROFILES,
  resolveVoiceReadProfileLabel,
  type VoiceReadProfile,
} from "@shared/voiceReadProfiles";
import {
  defaultVoiceReadSettings,
  mergeVoiceReadSettings,
  type VoiceReadSettings,
} from "../constants/voiceRead";
import { appPrompt } from "../services/appDialog";

function cloneVoiceReadSettings(value: unknown): VoiceReadSettings {
  return mergeVoiceReadSettings(toRaw(value) as Partial<VoiceReadSettings>);
}

export function useVoiceReadProfileDraft(
  settings: Ref<VoiceReadSettings>,
  profiles: Ref<VoiceReadProfile[]>,
  activeProfileId: Ref<string>,
) {
  const editingId = ref("");

  const editingProfile = computed(() =>
    profiles.value.find((p) => p.id === editingId.value),
  );

  function syncEditingIdFromState() {
    const active = activeProfileId.value.trim();
    const hit =
      profiles.value.find((p) => p.id === active) ?? profiles.value[0];
    editingId.value = hit?.id ?? "";
  }

  watch(
    [profiles, activeProfileId],
    () => {
      if (!editingId.value.trim() || !editingProfile.value) {
        syncEditingIdFromState();
      }
    },
    { immediate: true, deep: true },
  );

  function flushCurrentToProfiles() {
    const id = editingId.value.trim();
    if (!id) return;
    const idx = profiles.value.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const prev = profiles.value[idx]!;
    profiles.value[idx] = {
      ...prev,
      settings: cloneVoiceReadSettings(settings.value),
      updatedAt: Date.now(),
    };
  }

  function loadProfileIntoForm(id: string) {
    const p = profiles.value.find((x) => x.id === id);
    if (!p) return;
    settings.value = cloneVoiceReadSettings(p.settings);
    editingId.value = id;
  }

  function selectEditingProfile(id: string) {
    if (!id || id === editingId.value) return;
    flushCurrentToProfiles();
    loadProfileIntoForm(id);
  }

  function finalizeBeforeSave() {
    flushCurrentToProfiles();
    if (editingId.value.trim()) {
      activeProfileId.value = editingId.value.trim();
    }
  }

  function initFromState() {
    syncEditingIdFromState();
  }

  function addProfile() {
    if (profiles.value.length >= MAX_VOICE_READ_PROFILES) return;
    flushCurrentToProfiles();
    const nextSettings = cloneVoiceReadSettings(defaultVoiceReadSettings);
    const p = createVoiceReadProfile({ name: "", settings: nextSettings });
    profiles.value.unshift(p);
    loadProfileIntoForm(p.id);
  }

  async function renameProfile() {
    const p = editingProfile.value;
    if (!p) return;
    const next = await appPrompt("", {
      title: "重命名方案",
      defaultValue: p.name.trim(),
      placeholder: "方案名称",
    });
    if (next === null) return;
    const name = next.trim().slice(0, 80);
    const idx = profiles.value.findIndex((x) => x.id === p.id);
    if (idx < 0) return;
    profiles.value[idx] = { ...p, name, updatedAt: Date.now() };
  }

  function deleteProfile() {
    const list = profiles.value;
    if (list.length <= 1) return;
    const id = editingId.value;
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) return;
    list.splice(idx, 1);
    const next = list[0];
    if (next) loadProfileIntoForm(next.id);
  }

  function resetCurrentProfileSettings() {
    const idx = profiles.value.findIndex((p) => p.id === editingId.value);
    if (idx < 0) return;
    const prev = profiles.value[idx]!;
    const nextSettings = cloneVoiceReadSettings(defaultVoiceReadSettings);
    profiles.value[idx] = {
      ...prev,
      settings: nextSettings,
      updatedAt: Date.now(),
    };
    settings.value = cloneVoiceReadSettings(nextSettings);
  }

  const profileSelectItems = computed(() =>
    profiles.value.map((p) => {
      const profileSettings =
        p.id === editingId.value ? settings.value : p.settings;
      const providerLabel = resolveVoiceReadProfileLabel(profileSettings);
      const displayName = p.name.trim();
      return {
        id: p.id,
        listLabel: displayName || providerLabel,
      };
    }),
  );

  const editingDisplayName = computed(
    () => editingProfile.value?.name.trim() ?? "",
  );

  const editingProviderLabel = computed(() =>
    resolveVoiceReadProfileLabel(settings.value),
  );

  return {
    editingId,
    editingProfile,
    profileSelectItems,
    editingDisplayName,
    editingProviderLabel,
    syncEditingIdFromState,
    flushCurrentToProfiles,
    selectEditingProfile,
    finalizeBeforeSave,
    initFromState,
    addProfile,
    renameProfile,
    deleteProfile,
    resetCurrentProfileSettings,
  };
}
