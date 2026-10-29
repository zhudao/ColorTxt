<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  toRef,
  watch,
} from "vue";
import type {
  CharacterBookStylePersisted,
  CharacterRosterEntry,
} from "@shared/characterTypes";
import {
  characterPortraitBookDirAbs,
  normalizePortraitImageExtension,
  portraitImageExtensionFromPath,
  portraitStemForCharacterName,
  sanitizeBookFolderSegment,
} from "@shared/characterPortraitPaths";
import type { Chapter } from "../chapter";
import { APP_DISPLAY_NAME } from "../constants/appUi";
import { icons, speakIconAnimFrames } from "../icons";
import {
  defaultVoiceReadSettings,
  voiceReadEngineRequiresCredentials,
  type VoiceReadSettings,
} from "../constants/voiceRead";
import { speakCharacterVoiceSample } from "../services/voiceRead/voiceReadCharacterPreview";
import { VoiceReadLinePlayer } from "../services/voiceRead/voiceReadLinePlayer";
import type { CharacterCardTextureEffectId } from "@shared/characterCardTextureEffects";
import { DEFAULT_CHARACTER_CARD_TEXTURE_EFFECT } from "@shared/characterCardTextureEffects";
import CharacterEditDrawer from "./CharacterEditDrawer.vue";
import CharacterRosterCard from "./CharacterRosterCard.vue";
import { pushEscBeforeModal } from "../utils/modalStack";
import ReaderImageLightbox from "./ReaderImageLightbox.vue";
import type ReaderMain from "./ReaderMain.vue";
import { useCharacterPortraitFs } from "../composables/useCharacterPortraitFs";
import { useCharacterRosterReorder } from "../composables/useCharacterRosterReorder";
import { appAlert } from "../services/appDialog";
import { appToast } from "../services/appToast";
import { fileNameKey } from "../stores/fileMetaStore";
import {
  arrayBufferToBase64,
  buildCharacterRosterPackDefaultName,
  buildCharacterRosterPackZip,
  joinBookDirPortraitPath,
  mergeCharacterRosterByDisplayName,
  parseCharacterRosterPackZip,
  pickAndReadCharacterRosterPackFile,
  saveCharacterRosterPackFile,
} from "../utils/characterRosterPack";

const props = withDefaults(
  defineProps<{
    sessionFilePath: string | null;
    physicalReaderPath: string | null;
    chapters: Chapter[];
    activeChapterIdx: number;
    /** 与 AI 阅读助手建索引同源：取全文分块并向量化 */
    readerMainRef: InstanceType<typeof ReaderMain> | null;
    panelVisible: boolean;
    characterPortraitCacheDir: string;
    characterCardTextureEffect?: CharacterCardTextureEffectId;
    characterRoster: readonly CharacterRosterEntry[];
    characterBookStyle?: CharacterBookStylePersisted;
    /** 设置「确定」保存后递增，用于同步文生图服务商等运行时配置 */
    aiConfigSyncNonce?: number;
    /** 全局语音朗读设置（引擎与方案，用于角色专属朗读语音） */
    voiceReadSettings?: VoiceReadSettings;
  }>(),
  {
    sessionFilePath: null,
    physicalReaderPath: null,
    chapters: () => [],
    activeChapterIdx: -1,
    readerMainRef: null,
    panelVisible: false,
    characterPortraitCacheDir: "",
    characterCardTextureEffect: DEFAULT_CHARACTER_CARD_TEXTURE_EFFECT,
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
  /** 全屏：编辑/添加角色抽屉打开时抑制侧栏移出即收起 */
  "update:fullscreenCharacterDrawerOpen": [open: boolean];
  /** 全屏：角色卡放大预览打开时抑制侧栏移出即收起 */
  "update:fullscreenCharacterCardZoomOpen": [open: boolean];
}>();

const slideOpen = ref(false);
const blocksRosterReorder = ref(false);
const portraitLightboxSrc = ref("");
/** 原位放大中的角色卡 id（同一张 DOM，非 overlay 副本） */
const popoverCardId = ref<string | null>(null);

watch(
  slideOpen,
  (v) => {
    emit("update:fullscreenCharacterDrawerOpen", v);
  },
  { immediate: true },
);

watch(
  () => Boolean(popoverCardId.value),
  (v) => {
    emit("update:fullscreenCharacterCardZoomOpen", v);
  },
  { immediate: true },
);

let removePopoverEsc: (() => void) | null = null;

watch(popoverCardId, (id, prevId) => {
  removePopoverEsc?.();
  removePopoverEsc = null;
  if (!id && prevId) {
    flipped[prevId] = false;
  }
  if (!id) return;
  removePopoverEsc = pushEscBeforeModal(() => {
    popoverCardId.value = null;
  });
});

const flipped = reactive<Record<string, boolean>>({});

const {
  portraitEditSessionKey,
  portraitUrlById,
  bookFolderSegment,
  resolveCacheRootAbs,
  portraitAbsForDisplayName,
  resolvePortraitAbsForDisplayName,
  portraitTmpAbsForDisplayName,
  resolvePortraitSessionDraftAbs,
  deletePortraitSessionDraftFileAt,
  deletePortraitSessionDraftFile,
  removeSiblingPortraitFilesByDisplayName,
  removeCharacterPortraitFilesByDisplayName,
  readablePortraitDraftThenCanonical,
  refreshPortraitUrlForEntry,
  applyPortraitFromFilePath,
} = useCharacterPortraitFs({
  characterPortraitCacheDir: toRef(props, "characterPortraitCacheDir"),
  sessionFilePath: toRef(props, "sessionFilePath"),
  physicalReaderPath: toRef(props, "physicalReaderPath"),
  characterRoster: toRef(props, "characterRoster"),
});

type CharVoicePreviewPhase = "idle" | "synthesizing" | "playing";
const rosterCardVoicePreviewPlayer = new VoiceReadLinePlayer();
const rosterCardVoicePreviewEntryId = ref<string | null>(null);
const rosterCardVoicePreviewPhase = ref<CharVoicePreviewPhase>("idle");
let rosterCardVoicePreviewRunId = 0;
const rosterCardSpeakIconFrame = ref(0);
const SPEAK_ICON_ANIM_MS = 360;
let rosterCardSpeakIconTimer: ReturnType<typeof setInterval> | null = null;

const isMultiVoiceReadScheme = computed(
  () => props.voiceReadSettings.scheme === "multi",
);

const showCharacterVoiceTab = computed(
  () =>
    isMultiVoiceReadScheme.value &&
    props.voiceReadSettings.multi.aiSpeakerRecognitionEnabled !== false,
);

function entryCanSpeakFromCard(entry: CharacterRosterEntry): boolean {
  return (
    showCharacterVoiceTab.value &&
    Boolean(entry.voiceReadSampleLine?.trim()) &&
    !voiceReadEngineRequiresCredentials(props.voiceReadSettings)
  );
}

function rosterCardSpeakIconHtml(entryId: string): string {
  if (
    rosterCardVoicePreviewEntryId.value === entryId &&
    rosterCardVoicePreviewPhase.value !== "idle"
  ) {
    return speakIconAnimFrames[rosterCardSpeakIconFrame.value] ?? icons.speak;
  }
  return icons.speak;
}

function startRosterCardSpeakIconAnimation(): void {
  stopRosterCardSpeakIconAnimation();
  rosterCardSpeakIconFrame.value = 0;
  rosterCardSpeakIconTimer = setInterval(() => {
    rosterCardSpeakIconFrame.value =
      (rosterCardSpeakIconFrame.value + 1) % speakIconAnimFrames.length;
  }, SPEAK_ICON_ANIM_MS);
}

function stopRosterCardSpeakIconAnimation(): void {
  if (rosterCardSpeakIconTimer != null) {
    clearInterval(rosterCardSpeakIconTimer);
    rosterCardSpeakIconTimer = null;
  }
  rosterCardSpeakIconFrame.value = 0;
}

function resetRosterCardVoicePreview(): void {
  rosterCardVoicePreviewRunId += 1;
  rosterCardVoicePreviewPlayer.stop();
  rosterCardVoicePreviewEntryId.value = null;
  rosterCardVoicePreviewPhase.value = "idle";
  stopRosterCardSpeakIconAnimation();
}

async function onRosterCardSpeak(entry: CharacterRosterEntry) {
  if (rosterCardVoicePreviewEntryId.value === entry.id) {
    if (rosterCardVoicePreviewPhase.value !== "idle") {
      resetRosterCardVoicePreview();
      return;
    }
  } else {
    resetRosterCardVoicePreview();
  }
  const text = entry.voiceReadSampleLine?.trim() ?? "";
  if (!text) return;
  if (voiceReadEngineRequiresCredentials(props.voiceReadSettings)) return;

  const runId = ++rosterCardVoicePreviewRunId;
  rosterCardVoicePreviewEntryId.value = entry.id;
  rosterCardVoicePreviewPhase.value = "synthesizing";
  startRosterCardSpeakIconAnimation();

  const prevOnChunkChange = rosterCardVoicePreviewPlayer.onChunkChange;
  rosterCardVoicePreviewPlayer.onChunkChange = (index, total) => {
    if (runId !== rosterCardVoicePreviewRunId) return;
    rosterCardVoicePreviewPhase.value = "playing";
    prevOnChunkChange?.(index, total);
  };

  try {
    if (runId !== rosterCardVoicePreviewRunId) return;
    await speakCharacterVoiceSample(
      rosterCardVoicePreviewPlayer,
      props.voiceReadSettings,
      {
        gender: entry.gender,
        voiceReadVoiceId: entry.voiceReadVoiceId?.trim() || undefined,
        voiceReadLanguage: entry.voiceReadLanguage,
        voiceReadDialect: entry.voiceReadDialect,
        voiceReadSampleLine: text,
      },
    );
    if (runId !== rosterCardVoicePreviewRunId) return;
  } catch {
    /* 卡片试听失败静默 */
  } finally {
    rosterCardVoicePreviewPlayer.onChunkChange = prevOnChunkChange;
    if (runId === rosterCardVoicePreviewRunId) {
      rosterCardVoicePreviewPhase.value = "idle";
      stopRosterCardSpeakIconAnimation();
      rosterCardVoicePreviewEntryId.value = null;
    }
  }
}

const hasOpenFile = computed(() => {
  const s = props.sessionFilePath?.trim();
  const p = props.physicalReaderPath?.trim();
  return Boolean(s || p);
});

const cardGridRef = ref<HTMLElement | null>(null);
const rosterNameZoom = ref(1);
let cardGridResizeObserver: ResizeObserver | null = null;

function teardownCardGridResizeObserver() {
  cardGridResizeObserver?.disconnect();
  cardGridResizeObserver = null;
}

function syncRosterNameZoomFromGrid() {
  const grid = cardGridRef.value;
  if (!grid) {
    rosterNameZoom.value = 1;
    return;
  }
  const shell = grid.querySelector(".cardShell") as HTMLElement | null;
  const w = shell?.getBoundingClientRect().width ?? 0;
  rosterNameZoom.value = w > 0 ? w / 150 : 1;
}

function ensureCardGridResizeObserver() {
  const grid = cardGridRef.value;
  if (!grid || typeof ResizeObserver === "undefined") {
    teardownCardGridResizeObserver();
    if (grid) syncRosterNameZoomFromGrid();
    else rosterNameZoom.value = 1;
    return;
  }
  syncRosterNameZoomFromGrid();
  if (cardGridResizeObserver) return;
  cardGridResizeObserver = new ResizeObserver(() => {
    syncRosterNameZoomFromGrid();
  });
  cardGridResizeObserver.observe(grid);
}

const rosterReorderCan = computed(
  () =>
    hasOpenFile.value &&
    !blocksRosterReorder.value &&
    !popoverCardId.value &&
    props.characterRoster.length > 1,
);

const rosterReorder = useCharacterRosterReorder({
  roster: computed(() => props.characterRoster),
  gridRef: cardGridRef,
  canReorder: rosterReorderCan,
  onCommit: (next) => {
    emit("characterFileMetaPatch", { characterRoster: next });
  },
});

const {
  isDragging: rosterIsDragging,
  draggingEntryId: rosterDraggingEntryId,
  tiltEnabledFor: rosterTiltEnabledFor,
  shouldSuppressFlip: rosterShouldSuppressFlip,
  cancelActive: cancelRosterReorder,
} = rosterReorder;

watch([blocksRosterReorder, popoverCardId], () => {
  cancelRosterReorder();
});

function onCardGridLayoutContextChange() {
  const ok =
    hasOpenFile.value && props.characterRoster.length > 0 && cardGridRef.value;
  if (!ok) {
    teardownCardGridResizeObserver();
    rosterNameZoom.value = 1;
    return;
  }
  ensureCardGridResizeObserver();
}

watch(
  [hasOpenFile, () => props.characterRoster.length, () => props.panelVisible],
  () => {
    onCardGridLayoutContextChange();
  },
  { flush: "post", immediate: true },
);

const editDrawerRef = ref<InstanceType<typeof CharacterEditDrawer> | null>(
  null,
);

function toggleFlip(id: string) {
  flipped[id] = !flipped[id];
}

function openAddSlide() {
  editDrawerRef.value?.openAddSlide();
}

function openEditSlide(entry: CharacterRosterEntry) {
  editDrawerRef.value?.openEditSlide(entry);
}

function toggleCharacterCardPopover(entry: CharacterRosterEntry) {
  const url = portraitUrlById[entry.id];
  if (!url) return;
  if (popoverCardId.value === entry.id) {
    popoverCardId.value = null;
    return;
  }
  popoverCardId.value = entry.id;
}

function openPortraitLightboxFromUrl(url: string | null | undefined) {
  const u = typeof url === "string" ? url.trim() : "";
  if (!u) return;
  portraitLightboxSrc.value = u;
}

function onCharacterDeleted(id: string) {
  delete flipped[id];
  delete portraitUrlById[id];
}

watch(
  () => [props.sessionFilePath, props.physicalReaderPath] as const,
  (next, prev) => {
    if (prev === undefined) return;
    const [sp, pp] = next;
    const [osp, opp] = prev;
    if (sp === osp && pp === opp) return;

    void (async () => {
      const sk = portraitEditSessionKey.value.trim();
      if (sk) {
        const oldSeg = sanitizeBookFolderSegment(osp ?? opp ?? "");
        if (oldSeg) {
          await deletePortraitSessionDraftFileAt(sk, oldSeg);
        } else {
          await deletePortraitSessionDraftFile(sk);
        }
      }
      portraitEditSessionKey.value = "";

      editDrawerRef.value?.forceCloseGenerateOnBookChange();
      if (slideOpen.value) {
        editDrawerRef.value?.resetCharacterEditDrawerOnBookChange();
      }
    })();
  },
);

async function exportCharacterRosterPack() {
  if (!hasOpenFile.value) {
    await appAlert("请先打开文件");
    return;
  }
  const portraits = new Map<string, ArrayBuffer>();
  for (const entry of props.characterRoster) {
    const name = entry.displayName.trim();
    if (!name) continue;
    const abs = await resolvePortraitAbsForDisplayName(name);
    if (!abs) continue;
    const ext = portraitImageExtensionFromPath(abs);
    const basename = `${portraitStemForCharacterName(name)}.${
      normalizePortraitImageExtension(ext || "png")
    }`;
    try {
      const buf = await window.colorTxt.readFileAsArrayBuffer(abs);
      portraits.set(basename, buf);
    } catch {
      /* 无立绘则跳过 */
    }
  }
  const zipBuffer = await buildCharacterRosterPackZip({
    characterRoster: props.characterRoster,
    characterBookStyle: props.characterBookStyle,
    portraits,
  });
  const bookLabel =
    props.sessionFilePath?.trim() ||
    props.physicalReaderPath?.trim() ||
    "角色卡";
  const defaultName = buildCharacterRosterPackDefaultName(
    fileNameKey(bookLabel),
  );
  const r = await saveCharacterRosterPackFile(defaultName, zipBuffer);
  if (!r.ok) {
    if ("error" in r) await appAlert(r.error);
    return;
  }
  appToast(
    `已导出 ${props.characterRoster.length} 张角色卡` +
      (portraits.size > 0 ? `（含 ${portraits.size} 张立绘）` : ""),
    { kind: "success" },
  );
}

async function importCharacterRosterPack() {
  if (!hasOpenFile.value) {
    await appAlert("请先打开文件");
    return;
  }
  const picked = await pickAndReadCharacterRosterPackFile();
  if (!picked.ok) {
    if ("error" in picked) await appAlert(picked.error);
    return;
  }
  const parsed = await parseCharacterRosterPackZip(picked.buffer);
  if (!parsed.ok) {
    await appAlert(parsed.error);
    return;
  }
  const { manifest, portraits } = parsed.pack;
  const merged = mergeCharacterRosterByDisplayName(
    props.characterRoster,
    manifest.characterRoster,
  );
  const root = await resolveCacheRootAbs();
  const bookDir = characterPortraitBookDirAbs(root, bookFolderSegment.value);
  await window.colorTxt.mkdir(bookDir);
  let portraitWritten = 0;
  for (const [basename, buf] of portraits) {
    const rawExt = portraitImageExtensionFromPath(basename);
    const keepExt = normalizePortraitImageExtension(rawExt || "png");
    const stem = basename.slice(0, basename.length - rawExt.length - 1);
    if (!stem) continue;
    const normalizedBase = `${stem}.${keepExt}`;
    const dest = joinBookDirPortraitPath(bookDir, normalizedBase);
    try {
      await window.colorTxt.writeBinaryFile(dest, arrayBufferToBase64(buf));
      await removeSiblingPortraitFilesByDisplayName(stem, keepExt);
      portraitWritten += 1;
    } catch {
      /* 单张失败不中断 */
    }
  }
  const patch: {
    characterRoster: CharacterRosterEntry[];
    characterBookStyle?: CharacterBookStylePersisted;
  } = { characterRoster: merged };
  if (manifest.characterBookStyle) {
    patch.characterBookStyle = manifest.characterBookStyle;
  }
  emit("characterFileMetaPatch", patch);
  await nextTick();
  for (const e of merged) {
    await refreshPortraitUrlForEntry(e, { force: true });
  }
  appToast(
    `已导入 ${manifest.characterRoster.length} 张角色卡` +
      (portraitWritten > 0 ? `（写入 ${portraitWritten} 张立绘）` : ""),
    { kind: "success" },
  );
}

async function onClearAllCharacters() {
  if (props.characterRoster.length === 0) return;
  if (!window.colorTxt) return;
  const r = await window.colorTxt.showMessageBox({
    type: "warning",
    title: APP_DISPLAY_NAME,
    buttons: ["取消", "清空"],
    defaultId: 1,
    cancelId: 0,
    message: "确定要清空当前文件的全部角色卡吗？",
    detail: "所有角色的立绘图片也将一并删除，且该操作不可逆！",
    noLink: true,
  });
  if (r.response !== 1) return;
  for (const entry of props.characterRoster) {
    void deletePortraitSessionDraftFile(entry.id);
    if (entry.displayName?.trim()) {
      await removeCharacterPortraitFilesByDisplayName(entry.displayName);
    }
  }
  for (const k of Object.keys(flipped)) {
    delete flipped[k];
  }
  for (const k of Object.keys(portraitUrlById)) {
    delete portraitUrlById[k];
  }
  editDrawerRef.value?.closeSlide();
  emit("characterFileMetaPatch", { characterRoster: [] });
}

onBeforeUnmount(() => {
  removePopoverEsc?.();
  removePopoverEsc = null;
  teardownCardGridResizeObserver();
  resetRosterCardVoicePreview();
});

defineExpose({
  exportCharacterRosterPack,
  importCharacterRosterPack,
});
</script>

<template>
  <div class="characterSidebar">
    <div class="sidebarListWrap">
      <div class="sidebarTabBody">
        <div v-if="!hasOpenFile" class="empty">未打开文件</div>
        <div v-else class="characterContentColumn">
          <div v-if="characterRoster.length === 0" class="emptySlot">
            <div class="empty">当前文件暂无角色</div>
          </div>
          <div
            v-else
            class="characterMainScroll"
            :class="{ 'characterMainScroll--reorderLock': rosterIsDragging }"
          >
            <div
              ref="cardGridRef"
              class="cardGrid"
              :class="{ 'cardGrid--reordering': rosterIsDragging }"
            >
              <div
                v-for="entry in characterRoster"
                :key="entry.id"
                class="cardGridSlot"
                :data-entry-id="entry.id"
              >
                <CharacterRosterCard
                  :entry="entry"
                  :portrait-url="portraitUrlById[entry.id] ?? null"
                  :flipped="!!flipped[entry.id]"
                  :name-zoom="rosterNameZoom"
                  :texture-effect="characterCardTextureEffect"
                  :popover-open="popoverCardId === entry.id"
                  :tilt-enabled="rosterTiltEnabledFor(entry.id)"
                  :reorder-dragging="rosterDraggingEntryId === entry.id"
                  :suppress-flip-check="() => rosterShouldSuppressFlip(entry.id)"
                  :show-speak-button="entryCanSpeakFromCard(entry)"
                  :speak-icon-html="rosterCardSpeakIconHtml(entry.id)"
                  @toggle-flip="toggleFlip(entry.id)"
                  @edit="openEditSlide(entry)"
                  @speak="onRosterCardSpeak(entry)"
                  @view-portrait="toggleCharacterCardPopover(entry)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="hasOpenFile" class="sidebarTabFooter">
        <span class="sidebarTabFooterStat"
          >共 {{ characterRoster.length }} 个</span
        >
        <div class="sidebarTabFooterEnd">
          <button
            type="button"
            class="link hoverMode sidebarTabFooterAction"
            @click="openAddSlide"
          >
            添加角色
          </button>
          <button
            type="button"
            class="link danger hoverMode sidebarTabFooterAction"
            :disabled="characterRoster.length === 0"
            @click="onClearAllCharacters"
          >
            清空
          </button>
        </div>
      </div>
    </div>

    <CharacterEditDrawer
      ref="editDrawerRef"
      v-model:open="slideOpen"
      v-model:portrait-edit-session-key="portraitEditSessionKey"
      v-model:spoiler-safe="spoilerSafe"
      :session-file-path="sessionFilePath"
      :physical-reader-path="physicalReaderPath"
      :chapters="chapters"
      :active-chapter-idx="activeChapterIdx"
      :reader-main-ref="readerMainRef"
      :panel-visible="panelVisible"
      :character-portrait-cache-dir="characterPortraitCacheDir"
      :character-roster="characterRoster"
      :character-book-style="characterBookStyle"
      :ai-config-sync-nonce="aiConfigSyncNonce"
      :voice-read-settings="voiceReadSettings"
      :portrait-tmp-abs-for-display-name="portraitTmpAbsForDisplayName"
      :portrait-abs-for-display-name="portraitAbsForDisplayName"
      :resolve-portrait-session-draft-abs="resolvePortraitSessionDraftAbs"
      :readable-portrait-draft-then-canonical="readablePortraitDraftThenCanonical"
      :apply-portrait-from-file-path="applyPortraitFromFilePath"
      :delete-portrait-session-draft-file="deletePortraitSessionDraftFile"
      :remove-sibling-portrait-files-by-display-name="
        removeSiblingPortraitFilesByDisplayName
      "
      :remove-character-portrait-files-by-display-name="
        removeCharacterPortraitFilesByDisplayName
      "
      :refresh-portrait-url-for-entry="refreshPortraitUrlForEntry"
      @character-file-meta-patch="emit('characterFileMetaPatch', $event)"
      @character-deleted="onCharacterDeleted"
      @preview-portrait="openPortraitLightboxFromUrl"
      @stop-roster-card-voice="resetRosterCardVoicePreview"
      @update:blocks-roster-reorder="blocksRosterReorder = $event"
    />

    <ReaderImageLightbox v-model="portraitLightboxSrc" />
    <Teleport to="body">
      <div
        v-if="popoverCardId"
        class="charCardPopoverBackdrop"
        aria-hidden="true"
        @click="popoverCardId = null"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.characterSidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.sidebarListWrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sidebarTabBody {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.characterContentColumn {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow-x: hidden;
}

.emptySlot {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.characterMainScroll {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cardGrid {
  display: grid;
  min-width: 0;
  max-width: 100%;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  align-items: start;
}

.cardGridSlot {
  min-width: 0;
  touch-action: pan-y;
}

.cardGrid--reordering .cardGridSlot:not(.cardGridSlot--ghost):not(.cardGridSlot--drag) {
  transition: none;
}

.cardGrid--reordering .cardGridSlot {
  touch-action: none;
}

.cardGridSlot--ghost,
.cardGridSlot--drag {
  transition: none;
}

.cardGridSlot--ghost {
  box-sizing: border-box;
  align-self: start;
  width: 100%;
  aspect-ratio: 2 / 3;
  transform: none !important;
  border-radius: 8px;
  border: 2px dashed color-mix(in srgb, var(--accent) 50%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.cardGridSlot--ghost > * {
  display: none;
}

.cardGrid--reordering .cardShellWrap:hover,
.cardGrid--reordering .cardShellWrap:focus-within {
  z-index: 0;
}

.characterMainScroll--reorderLock {
  user-select: none;
}

.cardGrid:has(.cardShell--popover) .cardShell:not(.cardShell--popover) {
  opacity: 0.42;
  transition: opacity 0.28s ease;
  pointer-events: none;
}

.empty {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px 16px;
  font-size: 12px;
  color: var(--secondary);
}

.sidebarTabBody > .empty {
  flex: 1 1 auto;
}

.sidebarTabFooter {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--muted);
  border-top: 1px solid var(--border);
  background: var(--bg);
  user-select: none;
}

.sidebarTabFooterStat {
  flex: 1;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebarTabFooterEnd {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.sidebarTabFooterAction {
  flex-shrink: 0;
}
</style>

<style>
/* 跟手拖动层由 Sortable 挂到 body，须全局样式 */
.cardGridSlot--drag,
.cardGridReleaseFlyer {
  opacity: 1 !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}

.cardGridSlot--drag *,
.cardGridReleaseFlyer * {
  user-select: none !important;
  -webkit-user-select: none !important;
}

.cardGridSlot--drag {
  z-index: 10050;
  pointer-events: none;
  transition: none;
}

.cardGridSlot--drag > .cardShellWrap {
  transform: scale(1);
  transform-origin: center center;
  filter: none;
}

.cardGridSlot--dropLanding {
  box-sizing: border-box;
  border-radius: 8px;
  border: 2px dashed color-mix(in srgb, var(--accent) 50%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.cardGridSlot--dropLanding > .cardShellWrap {
  visibility: hidden;
}

.cardGridReleaseTarget {
  border-radius: 8px;
  border: 2px dashed color-mix(in srgb, var(--accent) 50%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.charCardPopoverBackdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: color-mix(in srgb, #000 58%, transparent);
}
</style>
