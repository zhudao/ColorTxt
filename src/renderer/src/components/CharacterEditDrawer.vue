<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from "vue";
import type {
  CharacterBookStylePersisted,
  CharacterGender,
  CharacterRosterEntry,
} from "@shared/characterTypes";
import {
  formatCharacterAliasesList,
  mergeCharacterAliases,
} from "@shared/characterAliases";
import {
  isPortraitUploadImagePath,
  normalizePortraitImageExtension,
  portraitImageExtensionFromPath,
  PORTRAIT_UPLOAD_OPEN_DIALOG_FILTERS,
} from "@shared/characterPortraitPaths";
import { vAiStickScroll } from "../directives/aiStickScroll";
import { icons } from "../icons";
import AiAssistantDetailsFold from "./AiAssistantDetailsFold.vue";
import AiIndexProgressBanner from "./AiIndexProgressBanner.vue";
import AiTokenUsageBanner from "./AiTokenUsageBanner.vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import CharacterPortraitGenerateModal from "./CharacterPortraitGenerateModal.vue";
import SettingsVolcengineVoiceSpeechMode from "./SettingsVolcengineVoiceSpeechMode.vue";
import IconButton from "./IconButton.vue";
import {
  defaultVoiceReadSettings,
  voiceReadEngineRequiresCredentials,
  type VoiceReadSettings,
} from "../constants/voiceRead";
import { speakCharacterVoiceSample } from "../services/voiceRead/voiceReadCharacterPreview";
import { normalizeVolcengineSpeechModePair } from "@shared/voiceReadVolcengineAudio";
import { fetchMinimaxVoiceCatalog } from "../services/voiceRead/minimaxVoiceCatalog";
import { fetchWinSapiVoiceCatalog } from "../services/voiceRead/winSapiVoiceCatalog";
import { VoiceReadLinePlayer } from "../services/voiceRead/voiceReadLinePlayer";
import {
  getVoiceGroupsForEngine,
  resolveVoiceReadDisplayLabel,
  voiceSelectItemsForEngine,
} from "../utils/voiceReadVoiceGroups";
import type { Chapter } from "../chapter";
import type ReaderMain from "./ReaderMain.vue";
import { useCharacterPortraitRetrieve } from "../composables/useCharacterPortraitRetrieve";
import {
  collectFsPathsFromDataTransfer,
  dataTransferLikelyHasExternalFiles,
  DROP_ZONE_CHARACTER_PORTRAIT,
} from "../utils/dragDropFsPaths";
import { appConfirm } from "../services/appDialog";

const open = defineModel<boolean>("open", { default: false });
const portraitEditSessionKey = defineModel<string>("portraitEditSessionKey", {
  default: "",
});

const props = withDefaults(
  defineProps<{
    sessionFilePath: string | null;
    physicalReaderPath: string | null;
    chapters: Chapter[];
    activeChapterIdx: number;
    readerMainRef: InstanceType<typeof ReaderMain> | null;
    panelVisible: boolean;
    characterPortraitCacheDir: string;
    characterRoster: readonly CharacterRosterEntry[];
    characterBookStyle?: CharacterBookStylePersisted;
    aiConfigSyncNonce?: number;
    voiceReadSettings?: VoiceReadSettings;
    portraitTmpAbsForDisplayName: (displayName: string) => Promise<string>;
    portraitAbsForDisplayName: (
      displayName: string,
      ext?: string,
    ) => Promise<string>;
    resolvePortraitSessionDraftAbs: (
      sessionKey: string,
    ) => Promise<string | null>;
    readablePortraitDraftThenCanonical: (opts: {
      displayName: string;
      sessionKey: string;
    }) => Promise<string | null>;
    applyPortraitFromFilePath: (
      fromPath: string,
      options?: { quiet?: boolean },
    ) => Promise<boolean>;
    deletePortraitSessionDraftFile: (sessionKey: string) => Promise<void>;
    removeSiblingPortraitFilesByDisplayName: (
      displayName: string,
      keepExt?: string,
    ) => Promise<void>;
    removeCharacterPortraitFilesByDisplayName: (
      displayName: string,
    ) => Promise<void>;
    refreshPortraitUrlForEntry: (
      entry: CharacterRosterEntry,
      options?: { force?: boolean },
    ) => Promise<void>;
  }>(),
  {
    sessionFilePath: null,
    physicalReaderPath: null,
    chapters: () => [],
    activeChapterIdx: -1,
    readerMainRef: null,
    panelVisible: false,
    characterPortraitCacheDir: "",
    characterRoster: () => [],
    characterBookStyle: undefined,
    aiConfigSyncNonce: 0,
    voiceReadSettings: () => ({ ...defaultVoiceReadSettings }),
  },
);

const spoilerSafe = defineModel<boolean>("spoilerSafe", { default: false });

const emit = defineEmits<{
  characterFileMetaPatch: [
    payload: {
      characterBookStyle?: CharacterBookStylePersisted;
      characterRoster?: CharacterRosterEntry[];
    },
  ];
  characterDeleted: [id: string];
  previewPortrait: [url: string];
  stopRosterCardVoice: [];
  /** 抽屉 / 生成弹窗 / 检索进行中时锁定名册拖拽 */
  "update:blocksRosterReorder": [blocked: boolean];
}>();

const editingId = ref<string | null>(null);
const isAddMode = computed(() => editingId.value === null && open.value);

const draftDisplayName = ref("");
const draftAliases = ref("");
const draftGender = ref<CharacterGender>("unknown");
const draftAgeText = ref("");
const draftIdentity = ref("");
const draftBio = ref("");
const draftRelations = ref("");
const draftPromptZh = ref("");
const draftNegativeZh = ref("");
const draftRetrieveThinking = ref("");
const draftStylePrefix = ref("");
const draftStyleNote = ref("");
const draftVoiceReadVoiceId = ref("");
const draftVoiceReadLanguage = ref("");
const draftVoiceReadDialect = ref("");
const draftVoiceSampleLine = ref("");
const draftVoiceSampleQuotes = ref<string[]>([]);
const draftVoiceSampleQuoteIndex = ref(0);
type DrawerMediaTab = "portrait" | "voice";
const drawerMediaTab = ref<DrawerMediaTab>("portrait");

type CharVoicePreviewPhase = "idle" | "synthesizing" | "playing";
const charVoicePreviewPhase = ref<CharVoicePreviewPhase>("idle");
const charVoicePreviewError = ref("");
const charVoicePreviewPlayer = new VoiceReadLinePlayer();
let charVoicePreviewRunId = 0;

const slideError = ref("");
const nameError = ref("");
const drawerPortraitPreviewUrl = ref<string | null>(null);
const drawerPortraitDragOverlayVisible = ref(false);
const txt2imgEnabled = ref(false);
const generateOpen = ref(false);

const genModalRef = ref<{
  openWithSeeds: (seeds: {
    styleZh: string;
    promptZh: string;
    negativeZh: string;
  }) => Promise<void>;
  forceCloseOnBookChange: () => void;
} | null>(null);

const sessionBookTitle = computed(() => {
  const p = props.sessionFilePath ?? props.physicalReaderPath;
  if (!p) return "";
  const sep = p.includes("\\") ? "\\" : "/";
  const base = p.slice(p.lastIndexOf(sep) + 1);
  const dot = base.lastIndexOf(".");
  const withoutExt = dot > 0 ? base.slice(0, dot) : base;
  return withoutExt.trim() || base;
});

const isMultiVoiceReadScheme = computed(
  () => props.voiceReadSettings.scheme === "multi",
);

const showCharacterVoiceTab = computed(
  () =>
    isMultiVoiceReadScheme.value &&
    props.voiceReadSettings.multi.aiSpeakerRecognitionEnabled !== false,
);

watch(showCharacterVoiceTab, (show) => {
  if (!show && drawerMediaTab.value === "voice") {
    drawerMediaTab.value = "portrait";
  }
});

const voiceReadEngine = computed(() => props.voiceReadSettings.engine);
const systemVoices = ref<SpeechSynthesisVoice[]>([]);

function refreshSystemVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  systemVoices.value = window.speechSynthesis.getVoices();
}

onMounted(() => {
  refreshSystemVoices();
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => refreshSystemVoices();
  }
});

watch(
  () =>
    [
      props.voiceReadSettings.engine,
      props.voiceReadSettings.engineConfig.minimaxApiKey?.trim() ?? "",
    ] as const,
  ([engine, apiKey]) => {
    if (engine === "minimax" && apiKey) {
      void fetchMinimaxVoiceCatalog(props.voiceReadSettings.engineConfig);
    }
    if (engine === "winSapi") {
      void fetchWinSapiVoiceCatalog(props.voiceReadSettings.engineConfig);
    }
  },
  { immediate: true },
);

const charVoiceReadDefaultItem: CustomSelectItem = {
  kind: "item",
  id: "",
  label: "使用全局对白音色",
  description: "",
};

const charVoiceReadScrollItems = computed((): CustomSelectItem[] => {
  const engineItems = voiceSelectItemsForEngine(
    voiceReadEngine.value,
    systemVoices.value,
    props.voiceReadSettings.engineConfig,
  );
  return [charVoiceReadDefaultItem, ...engineItems];
});

const charVoiceReadScrollHasOptions = computed(() =>
  charVoiceReadScrollItems.value.some((i) => i.kind === "item"),
);

const charVoiceReadScrollMaxHeight = computed(() =>
  getVoiceGroupsForEngine(voiceReadEngine.value, systemVoices.value) === "flat"
    ? 280
    : 360,
);

const charVoiceReadDisplayLabel = computed(() => {
  const id = draftVoiceReadVoiceId.value.trim();
  if (!id) return charVoiceReadDefaultItem.label;
  return resolveVoiceReadDisplayLabel(
    voiceReadEngine.value,
    id,
    systemVoices.value,
  );
});

const charVoicePreviewButtonLabel = computed(() => {
  if (charVoicePreviewPhase.value === "synthesizing") return "合成中…";
  if (charVoicePreviewPhase.value === "playing") return "停止";
  return "试听";
});

const charVoicePreviewDisabled = computed(
  () =>
    !draftVoiceSampleLine.value.trim() ||
    voiceReadEngineRequiresCredentials(props.voiceReadSettings) ||
    charVoicePreviewPhase.value === "synthesizing",
);

const canCycleVoiceSampleQuote = computed(
  () => draftVoiceSampleQuotes.value.length > 1,
);

function resetVoiceSampleDraft(): void {
  draftVoiceSampleLine.value = "";
  draftVoiceSampleQuotes.value = [];
  draftVoiceSampleQuoteIndex.value = 0;
}

function resetVoiceReadSpeechModeDraft(): void {
  draftVoiceReadLanguage.value = "";
  draftVoiceReadDialect.value = "";
}

function onCharVoiceReadVoiceIdChange(id: string): void {
  if (id === draftVoiceReadVoiceId.value) return;
  draftVoiceReadVoiceId.value = id;
  resetVoiceReadSpeechModeDraft();
}

function voiceReadSpeechFieldsForSave(): Pick<
  CharacterRosterEntry,
  "voiceReadVoiceId" | "voiceReadLanguage" | "voiceReadDialect"
> {
  const voiceId = draftVoiceReadVoiceId.value.trim();
  if (!voiceId) {
    return { voiceReadVoiceId: undefined };
  }
  const mode = normalizeVolcengineSpeechModePair({
    language: draftVoiceReadLanguage.value,
    dialect: draftVoiceReadDialect.value,
  });
  return {
    voiceReadVoiceId: voiceId,
    voiceReadLanguage: mode.language || undefined,
    voiceReadDialect: mode.dialect || undefined,
  };
}

function loadVoiceSampleFromEntry(entry?: CharacterRosterEntry): void {
  const quotes = (entry?.voiceReadSampleQuotes ?? [])
    .map((q) => q.trim())
    .filter(Boolean);
  draftVoiceSampleQuotes.value = quotes;
  let idx =
    typeof entry?.voiceReadSampleQuoteIndex === "number"
      ? Math.floor(entry.voiceReadSampleQuoteIndex)
      : 0;
  if (quotes.length > 0) {
    idx = Math.max(0, Math.min(idx, quotes.length - 1));
  } else {
    idx = 0;
  }
  draftVoiceSampleQuoteIndex.value = idx;
  const savedLine = entry?.voiceReadSampleLine?.trim() ?? "";
  if (savedLine) {
    draftVoiceSampleLine.value = savedLine;
  } else if (quotes.length > 0) {
    draftVoiceSampleLine.value = quotes[idx] ?? quotes[0] ?? "";
  } else {
    draftVoiceSampleLine.value = "";
  }
}

function voiceSampleFieldsForSave(): Pick<
  CharacterRosterEntry,
  "voiceReadSampleLine" | "voiceReadSampleQuotes" | "voiceReadSampleQuoteIndex"
> {
  const line = draftVoiceSampleLine.value.trim();
  const quotes = draftVoiceSampleQuotes.value
    .map((q) => q.trim())
    .filter(Boolean);
  const idx =
    quotes.length > 0
      ? Math.max(
          0,
          Math.min(draftVoiceSampleQuoteIndex.value, quotes.length - 1),
        )
      : 0;
  return {
    voiceReadSampleLine: line || undefined,
    voiceReadSampleQuotes: quotes.length > 0 ? quotes : undefined,
    voiceReadSampleQuoteIndex: quotes.length > 1 ? idx : undefined,
  };
}

function onCycleVoiceSampleQuote(): void {
  const quotes = draftVoiceSampleQuotes.value;
  if (quotes.length <= 1) return;
  const next = (draftVoiceSampleQuoteIndex.value + 1) % quotes.length;
  draftVoiceSampleQuoteIndex.value = next;
  draftVoiceSampleLine.value = quotes[next] ?? "";
}

function resetDrawerVoicePreview(): void {
  charVoicePreviewRunId += 1;
  charVoicePreviewPlayer.stop();
  charVoicePreviewPhase.value = "idle";
  charVoicePreviewError.value = "";
}

async function onCharVoicePreviewClick() {
  if (charVoicePreviewPhase.value === "playing") {
    resetDrawerVoicePreview();
    return;
  }
  if (charVoicePreviewPhase.value === "synthesizing") return;
  const text = draftVoiceSampleLine.value.trim();
  if (!text) return;
  if (voiceReadEngineRequiresCredentials(props.voiceReadSettings)) return;

  emit("stopRosterCardVoice");

  const runId = ++charVoicePreviewRunId;
  charVoicePreviewError.value = "";
  charVoicePreviewPhase.value = "synthesizing";

  const prevOnChunkChange = charVoicePreviewPlayer.onChunkChange;
  charVoicePreviewPlayer.onChunkChange = (index, total) => {
    if (runId !== charVoicePreviewRunId) return;
    charVoicePreviewPhase.value = "playing";
    prevOnChunkChange?.(index, total);
  };

  try {
    if (runId !== charVoicePreviewRunId) return;
    await speakCharacterVoiceSample(
      charVoicePreviewPlayer,
      props.voiceReadSettings,
      {
        gender: draftGender.value,
        voiceReadVoiceId: draftVoiceReadVoiceId.value.trim() || undefined,
        voiceReadLanguage: draftVoiceReadLanguage.value,
        voiceReadDialect: draftVoiceReadDialect.value,
        voiceReadSampleLine: text,
      },
    );
    if (runId !== charVoicePreviewRunId) return;
  } catch (e) {
    if (runId !== charVoicePreviewRunId) return;
    charVoicePreviewError.value = e instanceof Error ? e.message : String(e);
  } finally {
    charVoicePreviewPlayer.onChunkChange = prevOnChunkChange;
    if (runId === charVoicePreviewRunId) {
      charVoicePreviewPhase.value = "idle";
    }
  }
}

const retrieve = useCharacterPortraitRetrieve({
  draftDisplayName,
  draftAliases,
  draftGender,
  draftAgeText,
  draftIdentity,
  draftBio,
  draftRelations,
  draftPromptZh,
  draftNegativeZh,
  draftRetrieveThinking,
  draftStylePrefix,
  draftStyleNote,
  draftVoiceSampleQuotes,
  draftVoiceSampleQuoteIndex,
  draftVoiceSampleLine,
  spoilerSafe,
  slideOpen: open,
  sessionFilePath: toRef(props, "sessionFilePath"),
  physicalReaderPath: toRef(props, "physicalReaderPath"),
  chapters: toRef(props, "chapters"),
  activeChapterIdx: toRef(props, "activeChapterIdx"),
  readerMainRef: toRef(props, "readerMainRef"),
  characterBookStyle: toRef(props, "characterBookStyle"),
  sessionBookTitle,
  panelVisible: toRef(props, "panelVisible"),
  aiConfigSyncNonce: computed(() => props.aiConfigSyncNonce ?? 0),
  emitCharacterBookStyle: (style) => {
    emit("characterFileMetaPatch", { characterBookStyle: style });
  },
});

const {
  extracting,
  retrieveThinkingFoldOpen,
  retrieveNoticeBanner,
  retrieveTokenUsage,
  retrieveTokenUsageAvailable,
  retrieveTokenUsageShown,
  retrieveIndexPhase,
  retrieveIndexEmbedCurrent,
  retrieveIndexEmbedTotal,
  retrieveIndexError,
  canRetrieve,
  showThinkingSection,
  chatTokenPricePerMillion,
  showTokenUsage,
  onRetrieveThinkingFoldContentPointerDown,
  clearRetrieveTokenUsage,
  onRetrieve,
  onStopPortraitRetrieve,
  resetRetrieveUiOnCloseSlide,
  abortRetrieveOnBookChange,
  markRetrieveFreshForDrawer,
} = retrieve;

async function refreshTxt2ImgEnabled() {
  try {
    const c = await window.colorTxt.ai.configGet();
    txt2imgEnabled.value = c.txt2img.enabled;
  } catch {
    txt2imgEnabled.value = false;
  }
}

watch(
  () => props.panelVisible,
  (vis) => {
    if (vis) void refreshTxt2ImgEnabled();
  },
  { immediate: true },
);

watch(
  () => props.aiConfigSyncNonce ?? 0,
  (n, prev) => {
    if (n <= 0 || n === prev) return;
    void refreshTxt2ImgEnabled();
  },
);

watch(
  [open, generateOpen, extracting],
  () => {
    emit(
      "update:blocksRosterReorder",
      open.value || generateOpen.value || extracting.value,
    );
  },
  { immediate: true },
);

async function refreshDrawerPortraitPreview() {
  const name = draftDisplayName.value.trim();
  if (!name || !open.value) {
    drawerPortraitPreviewUrl.value = null;
    return;
  }
  drawerPortraitPreviewUrl.value = await props.readablePortraitDraftThenCanonical(
    {
      displayName: name,
      sessionKey: portraitEditSessionKey.value,
    },
  );
}

watch(
  () =>
    [
      draftDisplayName.value,
      open.value,
      props.characterPortraitCacheDir,
      portraitEditSessionKey.value,
    ] as const,
  () => {
    void refreshDrawerPortraitPreview();
  },
);

function rosterIndexById(id: string): number {
  return props.characterRoster.findIndex((r) => r.id === id);
}

function isDisplayNameTaken(name: string): boolean {
  const key = name.trim();
  if (!key) return false;
  return props.characterRoster.some(
    (r) =>
      r.displayName.trim() === key &&
      (editingId.value == null || r.id !== editingId.value),
  );
}

/** 角色名重名校验（输入 / blur 即时；空名不提示，由保存按钮禁用处理） */
function refreshNameError() {
  const name = draftDisplayName.value.trim();
  if (!name) {
    nameError.value = "";
    return;
  }
  nameError.value = isDisplayNameTaken(name) ? "已存在同名角色" : "";
}

const canSaveCharacter = computed(
  () =>
    !extracting.value &&
    Boolean(draftDisplayName.value.trim()) &&
    !nameError.value,
);

watch(
  [
    open,
    draftDisplayName,
    editingId,
    () =>
      props.characterRoster
        .map((e) => `${e.id}\0${e.displayName.trim()}`)
        .join("\n"),
  ],
  () => {
    if (!open.value) return;
    refreshNameError();
  },
);

function openAddSlide() {
  slideError.value = "";
  nameError.value = "";
  if (editingId.value) {
    void props.deletePortraitSessionDraftFile(editingId.value);
  } else if (portraitEditSessionKey.value.trim()) {
    void props.deletePortraitSessionDraftFile(portraitEditSessionKey.value);
  }
  portraitEditSessionKey.value = crypto.randomUUID();
  editingId.value = null;
  draftDisplayName.value = "";
  draftAliases.value = "";
  draftGender.value = "unknown";
  draftAgeText.value = "";
  draftIdentity.value = "";
  draftBio.value = "";
  draftRelations.value = "";
  draftPromptZh.value = "";
  draftNegativeZh.value = "";
  draftRetrieveThinking.value = "";
  markRetrieveFreshForDrawer();
  draftStylePrefix.value = props.characterBookStyle?.stylePrefixZh ?? "";
  draftStyleNote.value = props.characterBookStyle?.styleNoteZh ?? "";
  draftVoiceReadVoiceId.value = "";
  resetVoiceReadSpeechModeDraft();
  resetVoiceSampleDraft();
  drawerMediaTab.value = "portrait";
  resetDrawerVoicePreview();
  open.value = true;
}

function openEditSlide(entry: CharacterRosterEntry) {
  slideError.value = "";
  nameError.value = "";
  if (editingId.value == null && portraitEditSessionKey.value.trim()) {
    void props.deletePortraitSessionDraftFile(portraitEditSessionKey.value);
  }
  const prevId = editingId.value;
  if (prevId && prevId !== entry.id) {
    void props.deletePortraitSessionDraftFile(prevId);
  }
  editingId.value = entry.id;
  draftDisplayName.value = entry.displayName;
  draftAliases.value = entry.aliases ?? "";
  draftGender.value = entry.gender;
  draftAgeText.value = entry.ageText;
  draftIdentity.value = entry.identity;
  draftBio.value = entry.bio;
  draftRelations.value = entry.relations;
  draftPromptZh.value = entry.promptZh;
  draftNegativeZh.value = entry.negativeZh;
  draftRetrieveThinking.value = entry.retrieveThinkingText;
  markRetrieveFreshForDrawer();
  draftStylePrefix.value = props.characterBookStyle?.stylePrefixZh ?? "";
  draftStyleNote.value = props.characterBookStyle?.styleNoteZh ?? "";
  draftVoiceReadVoiceId.value = entry.voiceReadVoiceId?.trim() ?? "";
  draftVoiceReadLanguage.value = entry.voiceReadLanguage?.trim() ?? "";
  draftVoiceReadDialect.value = entry.voiceReadDialect?.trim() ?? "";
  loadVoiceSampleFromEntry(entry);
  drawerMediaTab.value = "portrait";
  resetDrawerVoicePreview();
  portraitEditSessionKey.value = entry.id;
  open.value = true;
}

function closeSlide() {
  if (extracting.value) return;
  resetDrawerVoicePreview();
  emit("stopRosterCardVoice");
  const sk = portraitEditSessionKey.value.trim();
  void props.deletePortraitSessionDraftFile(sk);
  portraitEditSessionKey.value = "";
  resetRetrieveUiOnCloseSlide();
  open.value = false;
  editingId.value = null;
  slideError.value = "";
  nameError.value = "";
  hideDrawerPortraitDragOverlay();
}

/** 切换或关闭当前书时：中止建索、清空编辑抽屉表单并关闭 */
function resetCharacterEditDrawerOnBookChange() {
  portraitEditSessionKey.value = "";
  abortRetrieveOnBookChange();
  genModalRef.value?.forceCloseOnBookChange();
  generateOpen.value = false;
  editingId.value = null;
  draftDisplayName.value = "";
  draftAliases.value = "";
  draftGender.value = "unknown";
  draftAgeText.value = "";
  draftIdentity.value = "";
  draftBio.value = "";
  draftRelations.value = "";
  draftPromptZh.value = "";
  draftNegativeZh.value = "";
  draftRetrieveThinking.value = "";
  clearRetrieveTokenUsage();
  draftStylePrefix.value = "";
  draftStyleNote.value = "";
  draftVoiceReadVoiceId.value = "";
  resetVoiceReadSpeechModeDraft();
  resetVoiceSampleDraft();
  drawerMediaTab.value = "portrait";
  slideError.value = "";
  nameError.value = "";
  open.value = false;
}

function buildEntryFromDraft(id: string): CharacterRosterEntry {
  const displayName = draftDisplayName.value.trim();
  return {
    id,
    displayName,
    aliases: formatCharacterAliasesList(
      mergeCharacterAliases({
        displayName,
        userInput: draftAliases.value,
      }),
    ),
    gender: draftGender.value,
    ageText: draftAgeText.value.trim(),
    identity: draftIdentity.value.trim(),
    bio: draftBio.value.trim(),
    relations: draftRelations.value.trim(),
    promptZh: draftPromptZh.value.trim(),
    negativeZh: draftNegativeZh.value.trim(),
    retrieveThinkingText: draftRetrieveThinking.value.trim(),
    ...voiceReadSpeechFieldsForSave(),
    ...voiceSampleFieldsForSave(),
  };
}

async function onSaveSlide() {
  if (extracting.value) return;
  slideError.value = "";
  retrieveNoticeBanner.value = "";
  refreshNameError();
  const name = draftDisplayName.value.trim();
  if (!name) {
    nameError.value = "请填写角色名。";
    return;
  }
  if (nameError.value) return;

  const stylePatch: CharacterBookStylePersisted = {
    stylePrefixZh: draftStylePrefix.value.trim(),
    styleNoteZh: draftStyleNote.value.trim(),
    updatedAt: Date.now(),
  };

  let nextRoster: CharacterRosterEntry[];
  if (editingId.value == null) {
    if (props.characterRoster.length >= 200) {
      slideError.value = "角色数量已达上限（200）。";
      return;
    }
    const id = crypto.randomUUID();
    nextRoster = [...props.characterRoster, buildEntryFromDraft(id)];
  } else {
    const idx = rosterIndexById(editingId.value);
    if (idx < 0) {
      slideError.value = "找不到该角色记录。";
      return;
    }
    nextRoster = props.characterRoster.map((r, i) =>
      i === idx ? buildEntryFromDraft(editingId.value!) : r,
    );
  }

  let portraitCommitted = false;
  const sk = portraitEditSessionKey.value.trim();
  if (sk) {
    try {
      const draftPath = await props.resolvePortraitSessionDraftAbs(sk);
      if (draftPath) {
        const ext = normalizePortraitImageExtension(
          portraitImageExtensionFromPath(draftPath) || "png",
        );
        const dest = await props.portraitAbsForDisplayName(name, ext);
        const cp = await window.colorTxt.characterPortrait.copyFileTo({
          from: draftPath,
          to: dest,
        });
        if (!cp.ok) {
          slideError.value = cp.error ?? "立绘保存失败";
          return;
        }
        await props.removeSiblingPortraitFilesByDisplayName(name, ext);
        portraitCommitted = true;
        try {
          await window.colorTxt.removePath(draftPath);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* 无待写入草稿 */
    }
  }

  emit("characterFileMetaPatch", {
    characterBookStyle: stylePatch,
    characterRoster: nextRoster,
  });

  if (portraitCommitted) {
    const savedId =
      editingId.value ?? nextRoster[nextRoster.length - 1]?.id ?? "";
    const savedEntry = savedId
      ? nextRoster.find((r) => r.id === savedId)
      : undefined;
    if (savedEntry) {
      await props.refreshPortraitUrlForEntry(savedEntry, { force: true });
    }
  }

  closeSlide();
}

async function onDeleteSlide() {
  if (extracting.value) return;
  const id = editingId.value;
  if (!id) return;
  const ok = await appConfirm(
    "确定要删除该角色卡吗？立绘图片也将一并删除。",
    "删除角色卡",
  );
  if (!ok) return;
  const entry = props.characterRoster.find((r) => r.id === id);
  void props.deletePortraitSessionDraftFile(id);
  if (entry?.displayName?.trim()) {
    await props.removeCharacterPortraitFilesByDisplayName(entry.displayName);
  }
  const nextRoster = props.characterRoster.filter((r) => r.id !== id);
  emit("characterFileMetaPatch", { characterRoster: nextRoster });
  emit("characterDeleted", id);
  closeSlide();
}

async function openGenerateFromDrawer() {
  await refreshTxt2ImgEnabled();
  await genModalRef.value?.openWithSeeds({
    styleZh:
      props.characterBookStyle?.stylePrefixZh?.trim() ??
      draftStylePrefix.value.trim(),
    promptZh: draftPromptZh.value.trim(),
    negativeZh: draftNegativeZh.value.trim(),
  });
}

function onSyncDraftPrompts(payload: {
  styleZh: string;
  promptZh: string;
  negativeZh: string;
}) {
  draftStylePrefix.value = payload.styleZh;
  draftPromptZh.value = payload.promptZh;
  draftNegativeZh.value = payload.negativeZh;
}

async function onDrawerUploadPortrait() {
  const r = await window.colorTxt.showOpenDialog({
    properties: ["openFile"],
    filters: PORTRAIT_UPLOAD_OPEN_DIALOG_FILTERS,
  });
  const picked =
    r.canceled || r.filePaths.length === 0 ? "" : (r.filePaths[0] ?? "");
  if (!picked.trim()) return;
  if (await props.applyPortraitFromFilePath(picked)) {
    await refreshDrawerPortraitPreview();
  }
}

function canAcceptPortraitDrop(): boolean {
  return !extracting.value && Boolean(draftDisplayName.value.trim());
}

function showDrawerPortraitDragOverlay() {
  drawerPortraitDragOverlayVisible.value = canAcceptPortraitDrop();
}

function hideDrawerPortraitDragOverlay() {
  drawerPortraitDragOverlayVisible.value = false;
}

function onDrawerPortraitDragEnter(ev: DragEvent) {
  if (!canAcceptPortraitDrop()) return;
  if (!dataTransferLikelyHasExternalFiles(ev.dataTransfer)) return;
  ev.preventDefault();
  ev.stopPropagation();
  showDrawerPortraitDragOverlay();
}

function onDrawerPortraitDragOver(ev: DragEvent) {
  if (!canAcceptPortraitDrop()) {
    hideDrawerPortraitDragOverlay();
    return;
  }
  if (!dataTransferLikelyHasExternalFiles(ev.dataTransfer)) return;
  ev.preventDefault();
  ev.stopPropagation();
  showDrawerPortraitDragOverlay();
  try {
    ev.dataTransfer!.dropEffect = "copy";
  } catch {
    /* ignore */
  }
}

function onDrawerPortraitDragLeave(ev: DragEvent) {
  const root = ev.currentTarget;
  if (!(root instanceof HTMLElement)) return;
  const related = ev.relatedTarget;
  if (related instanceof Node && root.contains(related)) return;
  hideDrawerPortraitDragOverlay();
}

async function onDrawerPortraitDrop(ev: DragEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  hideDrawerPortraitDragOverlay();
  if (extracting.value || !draftDisplayName.value.trim()) return;
  const paths = collectFsPathsFromDataTransfer(ev.dataTransfer);
  const picked = paths.find((p) => isPortraitUploadImagePath(p));
  if (!picked) return;
  if (await props.applyPortraitFromFilePath(picked)) {
    await refreshDrawerPortraitPreview();
  }
}

defineExpose({
  openAddSlide,
  openEditSlide,
  closeSlide,
  resetCharacterEditDrawerOnBookChange,
  forceCloseGenerateOnBookChange: () => {
    genModalRef.value?.forceCloseOnBookChange();
    generateOpen.value = false;
  },
  open,
  generateOpen,
  extracting,
});
</script>

<template>
  <Transition name="charDrawerFade">
    <div
      v-if="open"
      class="drawerBackdrop"
      aria-hidden="true"
      @click="closeSlide"
    />
  </Transition>
  <Transition name="charDrawerSlide">
    <aside
      v-if="open"
      class="drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="isAddMode ? '添加角色' : '编辑角色'"
      @click.stop
    >
      <div class="drawerBody">
        <div class="field">
          <span class="label">角色名</span>
          <div class="drawerNameRow">
            <div class="drawerNameInputWrap" :inert="extracting">
              <input
                v-model="draftDisplayName"
                type="text"
                class="drawerNameInput"
                spellcheck="false"
                :disabled="extracting"
                :aria-invalid="Boolean(nameError)"
                @input="refreshNameError"
                @change="refreshNameError"
                @blur="refreshNameError"
                @keydown.enter.prevent="canRetrieve && onRetrieve()"
              />
              <p v-if="nameError" class="error fieldError">{{ nameError }}</p>
            </div>
            <div class="drawerRetrieveRow">
              <button
                v-if="!extracting"
                type="button"
                class="aiPillToggle"
                :class="{ 'aiPillToggle--on': spoilerSafe }"
                title="避免透露当前阅读进度之后的内容"
                @click="spoilerSafe = !spoilerSafe"
              >
                <span
                  class="svg aiPillToggle__icon"
                  v-html="spoilerSafe ? icons.viewOff : icons.view"
                />
                防剧透
              </button>
              <div class="drawerRetrieveRowEnd">
                <button
                  v-if="extracting"
                  type="button"
                  class="btn danger drawerRetrieveStopBtn"
                  @click="onStopPortraitRetrieve"
                >
                  停止
                </button>
                <button
                  type="button"
                  class="btn primary drawerRetrieveBtn"
                  :disabled="!canRetrieve"
                  @click="onRetrieve"
                >
                  {{ extracting ? "检索中…" : "AI 检索" }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <AiAssistantDetailsFold
          v-if="showThinkingSection"
          v-model:open="retrieveThinkingFoldOpen"
          variant="think"
          :live="extracting"
          :show-content="Boolean(draftRetrieveThinking.trim()) || extracting"
          @content-pointerdown="onRetrieveThinkingFoldContentPointerDown"
        >
          <template #icon>
            <span
              v-if="extracting"
              class="svg charRetrieveThinkIconPulse"
              v-html="icons.thinkingPulse"
            />
            <span
              v-else
              class="svg charRetrieveThinkIconBrain"
              v-html="icons.find"
            />
          </template>
          <template #title>
            <template v-if="extracting">正在检索…</template>
            <template v-else>检索结果</template>
          </template>
          <pre v-ai-stick-scroll class="aiFoldBody aiFoldBody--thinking">{{
            draftRetrieveThinking
          }}</pre>
        </AiAssistantDetailsFold>

        <AiIndexProgressBanner
          v-if="retrieveIndexPhase !== 'idle'"
          class="charRetrieveIndexProgress"
          :phase="retrieveIndexPhase"
          :embed-current="retrieveIndexEmbedCurrent"
          :embed-total="retrieveIndexEmbedTotal"
          :error-text="retrieveIndexError"
        />

        <AiTokenUsageBanner
          v-if="showTokenUsage && retrieveTokenUsageShown"
          class="charRetrieveTokenUsage"
          :usage="retrieveTokenUsage"
          :available="retrieveTokenUsageAvailable"
          :token-price-per-million="chatTokenPricePerMillion"
        />

        <div
          v-if="retrieveNoticeBanner.trim()"
          class="aiNoticeBanner"
          role="status"
          aria-live="polite"
        >
          <span
            class="aiNoticeBanner__icon"
            aria-hidden="true"
            v-html="icons.warning"
          />
          <span>{{ retrieveNoticeBanner }}</span>
        </div>

        <div class="field">
          <span class="label">别名</span>
          <div :inert="extracting">
            <input
              v-model="draftAliases"
              type="text"
              class="drawerNameInput"
              placeholder="逗号分隔"
              spellcheck="false"
              :disabled="extracting"
            />
          </div>
        </div>

        <div class="drawerMainFields" :inert="extracting">
          <div class="field drawerMediaField">
            <div
              v-if="showCharacterVoiceTab"
              class="drawerMediaTabBar"
              role="tablist"
              aria-label="立绘与音色"
            >
              <button
                type="button"
                role="tab"
                class="drawerMediaTabBtn"
                :class="{ active: drawerMediaTab === 'portrait' }"
                :aria-selected="drawerMediaTab === 'portrait'"
                @click="drawerMediaTab = 'portrait'"
              >
                立绘
              </button>
              <span class="drawerMediaTabSep" aria-hidden="true"></span>
              <button
                type="button"
                role="tab"
                class="drawerMediaTabBtn"
                :class="{ active: drawerMediaTab === 'voice' }"
                :aria-selected="drawerMediaTab === 'voice'"
                @click="drawerMediaTab = 'voice'"
              >
                音色
              </button>
            </div>
            <span v-else class="label">立绘</span>

            <div
              v-show="!showCharacterVoiceTab || drawerMediaTab === 'portrait'"
              class="drawerPortraitBlock"
            >
              <div
                class="drawerPortraitFrame"
                :data-drop-zone="DROP_ZONE_CHARACTER_PORTRAIT"
                :class="{
                  portraitPreviewClickable: Boolean(drawerPortraitPreviewUrl),
                }"
                :title="
                  drawerPortraitPreviewUrl ? '点击查看立绘大图' : undefined
                "
                role="presentation"
                @click="
                  drawerPortraitPreviewUrl &&
                    emit('previewPortrait', drawerPortraitPreviewUrl)
                "
                @dragenter="onDrawerPortraitDragEnter"
                @dragover="onDrawerPortraitDragOver"
                @dragleave="onDrawerPortraitDragLeave"
                @drop="onDrawerPortraitDrop"
              >
                <img
                  v-if="drawerPortraitPreviewUrl"
                  :src="drawerPortraitPreviewUrl"
                  alt=""
                  class="drawerPortraitImg"
                />
                <span v-else class="drawerPortraitPlaceholder">暂无立绘</span>
                <Transition name="drawerPortraitDropOverlay">
                  <div
                    v-if="drawerPortraitDragOverlayVisible"
                    class="drawerPortraitDropOverlay"
                    aria-hidden="true"
                  >
                    <p class="drawerPortraitDropOverlayText">拖放图片</p>
                  </div>
                </Transition>
              </div>
              <div class="drawerPortraitBtns">
                <button
                  type="button"
                  class="btn"
                  :disabled="extracting || !draftDisplayName.trim()"
                  @click="onDrawerUploadPortrait"
                >
                  选择图片
                </button>
                <button
                  type="button"
                  class="btn primary"
                  :disabled="
                    extracting || !txt2imgEnabled || !draftDisplayName.trim()
                  "
                  @click="openGenerateFromDrawer"
                >
                  AI 生成
                </button>
              </div>
            </div>

            <div
              v-if="showCharacterVoiceTab && drawerMediaTab === 'voice'"
              class="drawerVoiceTab"
            >
              <div class="drawerVoiceRow">
                <span class="drawerVoiceRowLabel">语音</span>
                <AppCustomSelect
                  class="charVoiceReadSelect"
                  :model-value="draftVoiceReadVoiceId"
                  :display-label="charVoiceReadDisplayLabel"
                  :placeholder="
                    charVoiceReadScrollHasOptions ? '' : '暂无可用语音'
                  "
                  :fixed-top-items="[]"
                  :scroll-items="charVoiceReadScrollItems"
                  :fixed-bottom-items="[]"
                  :scroll-max-height="charVoiceReadScrollMaxHeight"
                  :searchable="voiceReadEngine === 'volcengine'"
                  search-placeholder="搜索音色名称或 ID"
                  ariaLabel="朗读语音"
                  @update:model-value="onCharVoiceReadVoiceIdChange"
                />
              </div>
              <SettingsVolcengineVoiceSpeechMode
                v-if="
                  voiceReadEngine === 'volcengine' &&
                  draftVoiceReadVoiceId.trim()
                "
                layout="drawer"
                slot-label="角色"
                :voice-id="draftVoiceReadVoiceId"
                :language="draftVoiceReadLanguage"
                :dialect="draftVoiceReadDialect"
                @update:language="draftVoiceReadLanguage = $event"
                @update:dialect="draftVoiceReadDialect = $event"
              />
              <label class="drawerVoiceRow drawerVoiceRow--stack">
                <span class="drawerVoiceRowLabel">台词</span>
                <textarea
                  v-model="draftVoiceSampleLine"
                  class="drawerVoiceSampleInput"
                  rows="5"
                  spellcheck="false"
                  :disabled="extracting"
                />
              </label>
              <div class="drawerVoicePreviewRow">
                <button
                  v-if="canCycleVoiceSampleQuote"
                  type="button"
                  class="btn drawerVoiceCycleBtn"
                  :disabled="extracting || charVoicePreviewPhase !== 'idle'"
                  @click="onCycleVoiceSampleQuote"
                >
                  换一句
                </button>
                <div class="drawerVoicePreviewRowEnd">
                  <p
                    v-if="charVoicePreviewError"
                    class="drawerVoicePreviewError"
                    role="alert"
                  >
                    {{ charVoicePreviewError }}
                  </p>
                  <button
                    type="button"
                    class="btn"
                    :class="{
                      primary: charVoicePreviewPhase === 'idle',
                      warning: charVoicePreviewPhase === 'synthesizing',
                      danger: charVoicePreviewPhase === 'playing',
                    }"
                    :disabled="charVoicePreviewDisabled"
                    @click="onCharVoicePreviewClick"
                  >
                    {{ charVoicePreviewButtonLabel }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="field">
            <span class="label">性别</span>
            <div class="genderToolbarRow">
              <IconButton
                :icon-html="icons.genderMale"
                title="男"
                aria-label="男"
                :active="draftGender === 'male'"
                :pressed="draftGender === 'male'"
                :disabled="extracting"
                class="genderMale"
                @click="draftGender = 'male'"
              />
              <IconButton
                :icon-html="icons.genderFemale"
                title="女"
                aria-label="女"
                :active="draftGender === 'female'"
                :pressed="draftGender === 'female'"
                :disabled="extracting"
                class="genderFemale"
                @click="draftGender = 'female'"
              />
              <IconButton
                :icon-html="icons.genderUnknown"
                title="未知"
                aria-label="未知"
                :active="draftGender === 'unknown'"
                :pressed="draftGender === 'unknown'"
                :disabled="extracting"
                class="genderUnknown"
                @click="draftGender = 'unknown'"
              />
            </div>
          </div>

          <label class="field">
            <span class="label">年龄</span>
            <input v-model="draftAgeText" type="text" :disabled="extracting" />
          </label>
          <label class="field">
            <span class="label">身份</span>
            <input
              v-model="draftIdentity"
              type="text"
              :disabled="extracting"
            />
          </label>
          <label class="field">
            <span class="label">简介</span>
            <textarea v-model="draftBio" rows="4" :disabled="extracting" />
          </label>
          <label class="field">
            <span class="label">关系</span>
            <textarea
              v-model="draftRelations"
              rows="4"
              :disabled="extracting"
            />
          </label>
        </div>

        <p v-if="slideError" class="error">{{ slideError }}</p>
      </div>
      <footer class="drawerFoot drawerFoot--links">
        <div class="drawerFootStart">
          <button
            v-if="!isAddMode"
            type="button"
            class="link danger hoverMode drawerFootAction"
            :disabled="extracting"
            @click="onDeleteSlide"
          >
            删除角色
          </button>
        </div>
        <div class="drawerFootEnd">
          <button
            type="button"
            class="link hoverMode drawerFootAction"
            :disabled="extracting"
            @click="closeSlide"
          >
            取消
          </button>
          <button
            type="button"
            class="link success drawerFootAction"
            :disabled="!canSaveCharacter"
            @click="onSaveSlide"
          >
            {{ isAddMode ? "添加角色" : "保存修改" }}
          </button>
        </div>
      </footer>
    </aside>
  </Transition>

  <CharacterPortraitGenerateModal
    ref="genModalRef"
    v-model="generateOpen"
    :display-name="draftDisplayName"
    :portrait-edit-session-key="portraitEditSessionKey"
    :character-book-style="characterBookStyle"
    :draft-style-note="draftStyleNote"
    :editing-id="editingId"
    :character-roster="characterRoster"
    :portrait-tmp-abs-for-display-name="portraitTmpAbsForDisplayName"
    :apply-portrait-from-file-path="applyPortraitFromFilePath"
    :readable-portrait-draft-then-canonical="readablePortraitDraftThenCanonical"
    @character-file-meta-patch="emit('characterFileMetaPatch', $event)"
    @sync-draft-prompts="onSyncDraftPrompts"
    @applied="refreshDrawerPortraitPreview"
    @preview-portrait="emit('previewPortrait', $event)"
  />
</template>

<style scoped>
.drawerBackdrop {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.38);
}

.drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 50;
  width: min(380px, 100%);
  max-width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-right: 1px solid var(--border);
  box-shadow: 6px 0 22px rgba(0, 0, 0, 0.18);
}

.drawerBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drawerFoot {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: var(--bg);
  font-size: 12px;
  color: var(--muted);
  user-select: none;
}

.drawerFoot--links {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  box-sizing: border-box;
}

.drawerFootStart {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
}

.drawerFootEnd {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: auto;
}

.drawerFootAction {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  line-height: 1.25;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  background: var(--panel);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.drawerNameRow {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.drawerMainFields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.charVoiceReadSelect {
  width: 100%;
  min-width: 0;
}

.drawerMediaField {
  gap: 10px;
}

.drawerMediaTabBar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.drawerMediaTabSep {
  width: 1px;
  height: 14px;
  flex-shrink: 0;
  background: var(--border);
}

.drawerMediaTabBtn {
  box-sizing: border-box;
  border: none;
  background: transparent;
  color: var(--tab-fg);
  font-size: 13px;
  padding: 0;
  cursor: pointer;
  line-height: 1.2;
}

.drawerMediaTabBtn:hover {
  color: var(--tab-fg-hover);
}

.drawerMediaTabBtn.active {
  color: var(--tab-fg-active);
  font-weight: 600;
}

.drawerVoiceTab {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drawerVoiceRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.drawerVoiceRow--stack {
  margin: 0;
}

.drawerVoiceRowLabel {
  font-size: 12px;
  color: var(--fg);
}

.drawerVoiceSampleInput {
  width: 100%;
  box-sizing: border-box;
  min-height: 72px;
  resize: none;
}

.drawerVoicePreviewRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.drawerVoiceCycleBtn {
  flex-shrink: 0;
}

.drawerVoicePreviewRowEnd {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  margin-left: auto;
}

.drawerVoicePreviewError {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--danger);
  text-align: right;
}

.drawerRetrieveRow {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.drawerRetrieveRowEnd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
}

.drawerRetrieveStopBtn {
  flex-shrink: 0;
}

.drawerNameInput {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.drawerRetrieveBtn {
  flex-shrink: 0;
  white-space: nowrap;
}

.charRetrieveThinkIconPulse {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, #3b82f6 75%, var(--accent) 25%);
  animation: charRetrieveThinkPulseBreathe 1.25s ease-in-out infinite;
}

@keyframes charRetrieveThinkPulseBreathe {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.charRetrieveThinkIconBrain :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.charRetrieveThinkIconBrain :deep(svg path) {
  fill: currentColor;
}

.drawerPortraitBlock {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drawerPortraitFrame {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  max-height: 200px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-sizing: border-box;
}

.drawerPortraitDropOverlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.drawerPortraitDropOverlayText {
  margin: 0;
  max-width: 100%;
  padding: 6px 10px;
  border-radius: 4px;
  background-color: var(--bg);
  color: var(--fg);
  font-size: 12px;
  text-align: center;
}

.drawerPortraitDropOverlay-enter-active,
.drawerPortraitDropOverlay-leave-active {
  transition: opacity 0.15s ease;
}

.drawerPortraitDropOverlay-enter-from,
.drawerPortraitDropOverlay-leave-to {
  opacity: 0;
}

.portraitPreviewClickable {
  cursor: zoom-in;
}

.portraitPreviewClickable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.drawerPortraitImg {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.drawerPortraitPlaceholder {
  font-size: 12px;
  color: var(--muted);
}

.drawerPortraitBtns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.label {
  font-size: 12px;
}

.genderToolbarRow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.error {
  margin: 0;
  color: var(--error-fg, #c62828);
  line-height: 1.4;
}

.drawerNameInputWrap {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
}

.fieldError {
  margin-top: 6px;
  font-size: 12px;
}

.charDrawerFade-enter-active,
.charDrawerFade-leave-active {
  transition: opacity 0.2s ease;
}
.charDrawerFade-enter-from,
.charDrawerFade-leave-to {
  opacity: 0;
}

.charDrawerSlide-enter-active,
.charDrawerSlide-leave-active {
  transition: transform 0.22s ease;
}
.charDrawerSlide-enter-from,
.charDrawerSlide-leave-to {
  transform: translateX(-104%);
}

.genderMale {
  background: var(--male) !important;
}
.genderFemale {
  background: var(--female) !important;
}
.genderUnknown {
  background: var(--unknown) !important;
}
:deep(.genderMale .icon),
:deep(.genderFemale .icon),
:deep(.genderUnknown .icon) {
  color: #fff;
}
.genderMale,
.genderFemale,
.genderUnknown {
  opacity: 0.3;

  &:hover,
  &.active {
    opacity: 1;
  }
}

.drawerBody .aiFold,
.drawerBody .aiNoticeBanner,
.drawerBody .charRetrieveTokenUsage,
.drawerBody .charRetrieveIndexProgress {
  margin: 0;
}
</style>
