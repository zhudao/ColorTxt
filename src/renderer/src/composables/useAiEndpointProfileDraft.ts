import { computed, ref, toRaw, type Ref } from "vue";
import {
  createChatProfile,
  createTxt2ImgProfile,
  defaultChatProfileResetEndpoint,
  defaultTxt2ImgProfileResetConfig,
  MAX_AI_ENDPOINT_PROFILES,
  normalizeChatEndpoint,
  resolveChatProfileProviderLabel,
  resolveTxt2ImgProfileProviderLabel,
} from "@shared/aiEndpointProfiles";
import type { AIChatEndpoint, AIConfig, AITxt2ImgConfig } from "@shared/aiTypes";
import { normalizeTxt2ImgConfig } from "@shared/aiTypes";
import { appPrompt } from "../services/appDialog";

/** Vue 响应式对象不能直接 structuredClone，先 toRaw 再归一化为纯数据 */
function cloneChatEndpoint(value: unknown): AIChatEndpoint {
  return normalizeChatEndpoint(toRaw(value));
}

function cloneTxt2ImgConfig(value: unknown): AITxt2ImgConfig {
  return normalizeTxt2ImgConfig(toRaw(value));
}

export function useChatProfileDraft(modelValue: Ref<AIConfig>) {
  const editingId = ref("");

  const editingProfile = computed(() =>
    modelValue.value.chatProfiles.find((p) => p.id === editingId.value),
  );

  function syncEditingIdFromConfig() {
    const active = modelValue.value.activeChatProfileId.trim();
    const hit =
      modelValue.value.chatProfiles.find((p) => p.id === active) ??
      modelValue.value.chatProfiles[0];
    editingId.value = hit?.id ?? "";
  }

  function flushCurrentToProfiles() {
    const id = editingId.value.trim();
    if (!id) return;
    const idx = modelValue.value.chatProfiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const prev = modelValue.value.chatProfiles[idx]!;
    modelValue.value.chatProfiles[idx] = {
      ...prev,
      chat: cloneChatEndpoint(modelValue.value.chat),
      updatedAt: Date.now(),
    };
  }

  function loadProfileIntoForm(id: string) {
    const p = modelValue.value.chatProfiles.find((x) => x.id === id);
    if (!p) return;
    modelValue.value.chat = cloneChatEndpoint(p.chat);
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
      modelValue.value.activeChatProfileId = editingId.value.trim();
    }
  }

  function initFromConfig() {
    syncEditingIdFromConfig();
    if (editingId.value) loadProfileIntoForm(editingId.value);
  }

  function addProfile() {
    if (modelValue.value.chatProfiles.length >= MAX_AI_ENDPOINT_PROFILES) return;
    flushCurrentToProfiles();
    const chat = defaultChatProfileResetEndpoint();
    const p = createChatProfile({ name: "", chat });
    modelValue.value.chatProfiles.unshift(p);
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
    const idx = modelValue.value.chatProfiles.findIndex((x) => x.id === p.id);
    if (idx < 0) return;
    modelValue.value.chatProfiles[idx] = { ...p, name, updatedAt: Date.now() };
  }

  function deleteProfile() {
    const list = modelValue.value.chatProfiles;
    if (list.length <= 1) return;
    const id = editingId.value;
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) return;
    list.splice(idx, 1);
    const next = list[0];
    if (next) loadProfileIntoForm(next.id);
  }

  function resetCurrentProfileChat() {
    const idx = modelValue.value.chatProfiles.findIndex(
      (p) => p.id === editingId.value,
    );
    if (idx < 0) return;
    const prev = modelValue.value.chatProfiles[idx]!;
    const chat = defaultChatProfileResetEndpoint();
    modelValue.value.chatProfiles[idx] = {
      ...prev,
      chat,
      updatedAt: Date.now(),
    };
    modelValue.value.chat = cloneChatEndpoint(chat);
  }

  const profileSelectItems = computed(() =>
    modelValue.value.chatProfiles.map((p) => {
      const chat =
        p.id === editingId.value ? modelValue.value.chat : p.chat;
      const providerLabel = resolveChatProfileProviderLabel(chat);
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
    resolveChatProfileProviderLabel(modelValue.value.chat),
  );

  return {
    editingId,
    editingProfile,
    profileSelectItems,
    editingDisplayName,
    editingProviderLabel,
    syncEditingIdFromConfig,
    flushCurrentToProfiles,
    selectEditingProfile,
    finalizeBeforeSave,
    initFromConfig,
    addProfile,
    renameProfile,
    deleteProfile,
    resetCurrentProfileChat,
  };
}

export function useTxt2ImgProfileDraft(modelValue: Ref<AIConfig>) {
  const editingId = ref("");

  const editingProfile = computed(() =>
    modelValue.value.txt2imgProfiles.find((p) => p.id === editingId.value),
  );

  function syncEditingIdFromConfig() {
    const active = modelValue.value.activeTxt2ImgProfileId.trim();
    const hit =
      modelValue.value.txt2imgProfiles.find((p) => p.id === active) ??
      modelValue.value.txt2imgProfiles[0];
    editingId.value = hit?.id ?? "";
  }

  function flushCurrentToProfiles() {
    const id = editingId.value.trim();
    if (!id) return;
    const idx = modelValue.value.txt2imgProfiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const prev = modelValue.value.txt2imgProfiles[idx]!;
    modelValue.value.txt2imgProfiles[idx] = {
      ...prev,
      txt2img: cloneTxt2ImgConfig(modelValue.value.txt2img),
      updatedAt: Date.now(),
    };
  }

  function loadProfileIntoForm(id: string) {
    const p = modelValue.value.txt2imgProfiles.find((x) => x.id === id);
    if (!p) return;
    modelValue.value.txt2img = cloneTxt2ImgConfig(p.txt2img);
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
      modelValue.value.activeTxt2ImgProfileId = editingId.value.trim();
    }
  }

  function initFromConfig() {
    syncEditingIdFromConfig();
    if (editingId.value) loadProfileIntoForm(editingId.value);
  }

  function addProfile() {
    if (modelValue.value.txt2imgProfiles.length >= MAX_AI_ENDPOINT_PROFILES) {
      return;
    }
    flushCurrentToProfiles();
    const txt2img = defaultTxt2ImgProfileResetConfig();
    const p = createTxt2ImgProfile({ name: "", txt2img });
    modelValue.value.txt2imgProfiles.unshift(p);
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
    const idx = modelValue.value.txt2imgProfiles.findIndex((x) => x.id === p.id);
    if (idx < 0) return;
    modelValue.value.txt2imgProfiles[idx] = { ...p, name, updatedAt: Date.now() };
  }

  function deleteProfile() {
    const list = modelValue.value.txt2imgProfiles;
    if (list.length <= 1) return;
    const id = editingId.value;
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) return;
    list.splice(idx, 1);
    const next = list[0];
    if (next) loadProfileIntoForm(next.id);
  }

  function resetCurrentProfileTxt2img() {
    const idx = modelValue.value.txt2imgProfiles.findIndex(
      (p) => p.id === editingId.value,
    );
    if (idx < 0) return;
    const prev = modelValue.value.txt2imgProfiles[idx]!;
    const prevEnabled = modelValue.value.txt2img.enabled;
    const txt2img = defaultTxt2ImgProfileResetConfig();
    txt2img.enabled = prevEnabled;
    modelValue.value.txt2imgProfiles[idx] = {
      ...prev,
      txt2img,
      updatedAt: Date.now(),
    };
    modelValue.value.txt2img = cloneTxt2ImgConfig(txt2img);
  }

  const profileSelectItems = computed(() =>
    modelValue.value.txt2imgProfiles.map((p) => {
      const txt2img =
        p.id === editingId.value ? modelValue.value.txt2img : p.txt2img;
      const providerLabel = resolveTxt2ImgProfileProviderLabel(txt2img);
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
    resolveTxt2ImgProfileProviderLabel(modelValue.value.txt2img),
  );

  return {
    editingId,
    editingProfile,
    profileSelectItems,
    editingDisplayName,
    editingProviderLabel,
    syncEditingIdFromConfig,
    flushCurrentToProfiles,
    selectEditingProfile,
    finalizeBeforeSave,
    initFromConfig,
    addProfile,
    renameProfile,
    deleteProfile,
    resetCurrentProfileTxt2img,
  };
}
