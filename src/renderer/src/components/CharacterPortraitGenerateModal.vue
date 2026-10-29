<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AITxt2ImgBackend } from "@shared/aiTypes";
import { getTxt2ImgPromptFamily } from "@shared/txt2ImgBackend";
import type {
  CharacterBookStylePersisted,
  CharacterRosterEntry,
} from "@shared/characterTypes";
import AppModal from "./AppModal.vue";
import { withUrlCacheBust } from "../composables/useCharacterPortraitFs";

const open = defineModel<boolean>({ default: false });

const props = withDefaults(
  defineProps<{
    /** 生成目标角色名（抽屉入口用草稿名） */
    displayName: string;
    /** 编辑抽屉 session key；应用立绘写入 session-draft */
    portraitEditSessionKey: string;
    characterBookStyle?: CharacterBookStylePersisted;
    /** 持久化画风 note 时的草稿回落 */
    draftStyleNote: string;
    editingId: string | null;
    characterRoster: readonly CharacterRosterEntry[];
    portraitTmpAbsForDisplayName: (displayName: string) => Promise<string>;
    applyPortraitFromFilePath: (
      fromPath: string,
      options?: { quiet?: boolean },
    ) => Promise<boolean>;
    readablePortraitDraftThenCanonical: (opts: {
      displayName: string;
      sessionKey: string;
    }) => Promise<string | null>;
  }>(),
  {
    characterBookStyle: undefined,
    draftStyleNote: "",
    editingId: null,
    characterRoster: () => [],
  },
);

const emit = defineEmits<{
  characterFileMetaPatch: [
    payload: {
      characterBookStyle?: CharacterBookStylePersisted;
      characterRoster?: CharacterRosterEntry[];
    },
  ];
  /** 同步画风/形象/负面到抽屉草稿 */
  syncDraftPrompts: [
    payload: { styleZh: string; promptZh: string; negativeZh: string },
  ];
  /** 应用成功后通知父级刷新抽屉立绘预览 */
  applied: [];
  previewPortrait: [url: string];
}>();

const txt2imgEnabled = ref(false);
const txt2imgBackend = ref<AITxt2ImgBackend>("a1111");

const genStyleZh = ref("");
const genPromptZh = ref("");
const genNegativeZh = ref("");
const generating = ref(false);
const genError = ref("");
const genPreviewUrl = ref<string | null>(null);
const genTempReadableUrl = ref<string | null>(null);
const genTmpAbsPath = ref<string | null>(null);
const genApplying = ref(false);

/** 切换书籍等场景关闭立绘弹窗时不写入 meta（避免错书） */
const genSuppressPersistOnClose = ref(false);

const genModalDisplayName = computed(() => props.displayName.trim());

const genModalActivePreviewUrl = computed(
  () => genTempReadableUrl.value ?? genPreviewUrl.value,
);

const canApplyGenTemp = computed(
  () =>
    Boolean(genTempReadableUrl.value) &&
    !generating.value &&
    !genApplying.value &&
    Boolean(genModalDisplayName.value),
);

const genShowsNegativeAdvanced = computed(
  () => getTxt2ImgPromptFamily(txt2imgBackend.value) === "sd",
);

const canGenerateImage = computed(
  () =>
    txt2imgEnabled.value &&
    Boolean(genStyleZh.value.trim() || genPromptZh.value.trim()) &&
    !generating.value &&
    !genApplying.value &&
    Boolean(genModalDisplayName.value),
);

async function refreshRuntimeFlags() {
  try {
    const c = await window.colorTxt.ai.configGet();
    txt2imgEnabled.value = c.txt2img.enabled;
    txt2imgBackend.value = c.txt2img.backend;
  } catch {
    txt2imgEnabled.value = false;
  }
}

async function refreshGenModalPreview() {
  const name = genModalDisplayName.value;
  if (!name) {
    genPreviewUrl.value = null;
    return;
  }
  const draftKey = props.portraitEditSessionKey.trim();
  genPreviewUrl.value = await props.readablePortraitDraftThenCanonical({
    displayName: name,
    sessionKey: draftKey,
  });
}

function rosterIndexById(id: string): number {
  return props.characterRoster.findIndex((r) => r.id === id);
}

/** 将立绘生成面板中的画风 / 形象 / 负面同步到抽屉草稿并写入 file.meta */
function persistGenPanelTextFields(): void {
  const styleZh = genStyleZh.value.trim();
  const promptZh = genPromptZh.value.trim();
  const negativeZh = genNegativeZh.value.trim();

  emit("syncDraftPrompts", { styleZh, promptZh, negativeZh });

  const patch: {
    characterBookStyle: CharacterBookStylePersisted;
    characterRoster?: CharacterRosterEntry[];
  } = {
    characterBookStyle: {
      stylePrefixZh: styleZh,
      styleNoteZh:
        props.characterBookStyle?.styleNoteZh?.trim() ??
        props.draftStyleNote.trim(),
      updatedAt: Date.now(),
    },
  };

  const editId = props.editingId;
  if (editId != null) {
    const idx = rosterIndexById(editId);
    if (idx >= 0) {
      patch.characterRoster = props.characterRoster.map((r, i) =>
        i === idx ? { ...r, promptZh, negativeZh } : r,
      );
    }
  }

  emit("characterFileMetaPatch", patch);
}

watch(open, async (isOpen, wasOpen) => {
  if (isOpen) {
    await refreshRuntimeFlags();
    genTempReadableUrl.value = null;
    genTmpAbsPath.value = null;
    genError.value = "";
    const name = genModalDisplayName.value;
    if (name) {
      try {
        const tmp = await props.portraitTmpAbsForDisplayName(name);
        const st = await window.colorTxt.stat(tmp);
        if (st.isFile) await window.colorTxt.removePath(tmp);
      } catch {
        /* 无临时文件或删除失败均忽略 */
      }
    }
    await refreshGenModalPreview();
    return;
  }
  if (wasOpen && !genSuppressPersistOnClose.value) {
    persistGenPanelTextFields();
  }
  genSuppressPersistOnClose.value = false;

  genTempReadableUrl.value = null;
  genTmpAbsPath.value = null;
  const name = genModalDisplayName.value;
  if (!name) return;
  try {
    const tmp = await props.portraitTmpAbsForDisplayName(name);
    const st = await window.colorTxt.stat(tmp);
    if (st.isFile) await window.colorTxt.removePath(tmp);
  } catch {
    /* ignore */
  }
});

async function openWithSeeds(seeds: {
  styleZh: string;
  promptZh: string;
  negativeZh: string;
}): Promise<void> {
  await refreshRuntimeFlags();
  genStyleZh.value = seeds.styleZh;
  genPromptZh.value = seeds.promptZh;
  genNegativeZh.value = seeds.negativeZh;
  genError.value = "";
  open.value = true;
}

function forceCloseOnBookChange(): void {
  generating.value = false;
  genApplying.value = false;
  genSuppressPersistOnClose.value = true;
  open.value = false;
  genError.value = "";
  genPreviewUrl.value = null;
  genTempReadableUrl.value = null;
  genTmpAbsPath.value = null;
}

async function onPortraitTxt2ImgAbort() {
  if (!generating.value) return;
  try {
    await window.colorTxt.ai.portraitTxt2ImgToPathAbort();
  } catch {
    /* ignore */
  }
}

async function onGenerateCommit() {
  genError.value = "";
  const displayName = genModalDisplayName.value;
  if (!displayName) {
    genError.value = "缺少角色名";
    return;
  }
  generating.value = true;
  try {
    await refreshRuntimeFlags();
    if (!txt2imgEnabled.value) {
      genError.value = "请先在设置中启用文生图。";
      return;
    }
    const tmpOut = await props.portraitTmpAbsForDisplayName(displayName);
    const res = await window.colorTxt.ai.portraitTxt2ImgToPath({
      outputPath: tmpOut,
      styleZh: genStyleZh.value.trim(),
      appearanceZh: genPromptZh.value.trim(),
      negativeZh: genNegativeZh.value.trim(),
    });
    if (!res.ok) {
      if (res.error !== "已停止") {
        genError.value = res.error || "生成失败";
      }
      return;
    }
    genTmpAbsPath.value = tmpOut;
    const raw = await window.colorTxt.pathToReadableLocalUrl(tmpOut);
    genTempReadableUrl.value = raw ? withUrlCacheBust(raw) : null;
    persistGenPanelTextFields();
    await refreshGenModalPreview();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== "已停止") {
      genError.value = msg;
    }
  } finally {
    generating.value = false;
  }
}

async function onGenApply() {
  const displayName = genModalDisplayName.value;
  if (!displayName) {
    genError.value = "缺少角色名";
    return;
  }
  if (!genTempReadableUrl.value) {
    genError.value = "请先生成立绘预览";
    return;
  }
  genError.value = "";
  genApplying.value = true;
  try {
    const tmpAbs =
      genTmpAbsPath.value ??
      (await props.portraitTmpAbsForDisplayName(displayName));
    let st;
    try {
      st = await window.colorTxt.stat(tmpAbs);
    } catch {
      genError.value = "请先生成立绘预览";
      return;
    }
    if (!st.isFile) {
      genError.value = "请先生成立绘预览";
      return;
    }
    const sk = props.portraitEditSessionKey.trim();
    if (!sk) {
      genError.value = "请关闭并重新打开编辑面板后再试。";
      return;
    }
    const ok = await props.applyPortraitFromFilePath(tmpAbs, { quiet: true });
    if (!ok) {
      genError.value = "应用失败";
      return;
    }
    try {
      await window.colorTxt.removePath(tmpAbs);
    } catch {
      /* ignore */
    }
    genTmpAbsPath.value = null;
    genTempReadableUrl.value = null;
    await refreshGenModalPreview();
    emit("applied");
    open.value = false;
  } catch (e) {
    genError.value = e instanceof Error ? e.message : String(e);
  } finally {
    genApplying.value = false;
  }
}

function onPreviewClick() {
  const url = genModalActivePreviewUrl.value;
  if (url) emit("previewPortrait", url);
}

defineExpose({
  openWithSeeds,
  forceCloseOnBookChange,
  generating,
  /** 供侧栏编排判断是否锁定拖拽排序 */
  isBusy: computed(() => generating.value || genApplying.value || open.value),
});
</script>

<template>
  <AppModal
    v-model="open"
    title="角色立绘生成"
    max-width="720px"
    :mask-closable="false"
    :esc-closable="!generating"
    :body-scroll="false"
  >
    <div v-if="open" class="genSplit">
      <div class="genPreviewCol">
        <div
          class="genPreviewFrame"
          :class="{
            portraitPreviewClickable: Boolean(genModalActivePreviewUrl),
          }"
          :title="genModalActivePreviewUrl ? '点击查看立绘大图' : undefined"
          role="presentation"
          @click="onPreviewClick"
        >
          <img
            v-if="genModalActivePreviewUrl"
            :src="genModalActivePreviewUrl"
            alt=""
            class="genPreviewImg"
          />
          <span v-else class="genPreviewPlaceholder">暂无预览</span>
        </div>
      </div>
      <div class="genSettingsCol">
        <div class="genSettingsScroll">
          <label class="genFormRow">
            <span class="genFormLabel">画风（本书通用）</span>
            <textarea
              v-model="genStyleZh"
              rows="3"
              class="genFormTextarea"
              placeholder="描述整体的画风、色调、风格等"
            />
          </label>
          <label class="genFormRow">
            <span class="genFormLabel">角色形象</span>
            <textarea
              v-model="genPromptZh"
              rows="4"
              class="genFormTextarea"
              placeholder="描述角色的外貌、服饰、姿态等"
            />
          </label>
          <label v-if="genShowsNegativeAdvanced" class="genFormRow">
            <span class="genFormLabel">负面描述</span>
            <textarea
              v-model="genNegativeZh"
              rows="2"
              class="genFormTextarea"
              placeholder="描述你不希望出现的特征"
            />
          </label>
        </div>
        <div class="genSettingsFoot">
          <div class="genSettingsFootStart">
            <button
              type="button"
              size="large"
              class="btn primary"
              :disabled="!canGenerateImage"
              @click="onGenerateCommit"
            >
              {{ generating ? "生成中…" : "生成" }}
            </button>
            <span
              v-if="genError"
              class="genGenerateError"
              :title="genError"
              >{{ genError }}</span
            >
            <button
              v-if="generating"
              type="button"
              size="large"
              class="btn danger"
              @click="onPortraitTxt2ImgAbort"
            >
              停止
            </button>
          </div>
          <div class="genSettingsFootEnd">
            <button
              type="button"
              size="large"
              class="btn"
              :disabled="generating || genApplying"
              @click="open = false"
            >
              取消
            </button>
            <button
              type="button"
              size="large"
              class="btn primary"
              :disabled="!canApplyGenTemp"
              @click="onGenApply"
            >
              {{ genApplying ? "应用中…" : "应用" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.genSplit {
  display: flex;
  gap: 16px;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
  max-height: min(78vh, 560px);
  padding: 4px 2px 8px;
  box-sizing: border-box;
}

/* 预览比例与 CharacterRosterCard 一致（宽:高 = 2:3） */
.genPreviewCol {
  flex: 0 0 230px;
  width: 230px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  min-width: 0;
}

.genPreviewFrame {
  width: 100%;
  aspect-ratio: 2 / 3;
  flex: 0 0 auto;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.genPreviewImg {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.genPreviewPlaceholder {
  font-size: 12px;
  color: var(--muted);
  padding: 12px;
  text-align: center;
}

.genSettingsCol {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.genSettingsScroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.genFormRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.genFormLabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
}

.genFormTextarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 0;
}

.genSettingsFoot {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
}

.genSettingsFootStart {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.genGenerateError {
  flex: 1 1 0;
  min-width: 0;
  font-size: 12px;
  line-height: 1.35;
  color: var(--danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.genSettingsFootEnd {
  display: flex;
  align-items: center;
  gap: 10px;
}

.portraitPreviewClickable {
  cursor: zoom-in;
}

.portraitPreviewClickable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
