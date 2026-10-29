<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from "vue";
import { icons } from "../icons";
import { dictionaryDisplayName } from "../constants/dictionarySettings";
import LoadingDotsBounce from "./LoadingDotsBounce.vue";
import DictHtmlFrame from "./DictHtmlFrame.vue";
import { isPointerOnAppModalAbove, registerModal } from "../utils/modalStack";
import type { DictionarySettings } from "@shared/dictionaryTypes";
import type { DictionaryLookupResultItem } from "@shared/dictionaryTypes";

/** IPC 只能传可结构化克隆的纯对象；Vue reactive Proxy 会触发 An object could not be cloned */
function plainSettingsForIpc(settings: DictionarySettings): DictionarySettings {
  return JSON.parse(JSON.stringify(toRaw(settings))) as DictionarySettings;
}

type DictSlot = {
  providerId: string;
  title: string;
  status: "pending" | "ready";
  result?: DictionaryLookupResultItem;
  collapsed: boolean;
  /** 本词典内部 entry 跳转栈（含当前词） */
  navStack: string[];
};

const props = defineProps<{
  open: boolean;
  word: string;
  settings: DictionarySettings;
  floatCenterX: number;
  floatRootTop: number;
  openDownward: boolean;
  maxHeight: number;
}>();

const emit = defineEmits<{
  close: [];
  openDictionaryManage: [];
}>();

const panelZIndex = ref(6000);
const popupPanelRef = ref<HTMLElement | null>(null);
const popupBodyRef = ref<HTMLElement | null>(null);
const queryInputRef = ref<HTMLInputElement | null>(null);
let modalUnregister: (() => void) | null = null;
let removeOutsideListener: (() => void) | null = null;

const queryWord = ref("");
const slots = ref<DictSlot[]>([]);
const errorMessage = ref("");
const lookupDone = ref(false);
let lookupSeq = 0;
/** 单词典内部跳转序号，避免慢请求覆盖新结果 */
const slotNavSeq = new Map<string, number>();
/** 词典 mdd 发音：同时只播一条 */
let dictSoundAudio: HTMLAudioElement | null = null;

const hasVisibleSlots = computed(() => slots.value.length > 0);

function stopDictSound() {
  if (!dictSoundAudio) return;
  try {
    dictSoundAudio.pause();
  } catch {
    /* ignore */
  }
  dictSoundAudio = null;
}

function playDictSoundDataUrl(dataUrl: string) {
  stopDictSound();
  const audio = new Audio(dataUrl);
  dictSoundAudio = audio;
  audio.addEventListener(
    "ended",
    () => {
      if (dictSoundAudio === audio) dictSoundAudio = null;
    },
    { once: true },
  );
  void audio.play().catch(() => {
    if (dictSoundAudio === audio) dictSoundAudio = null;
  });
}

function onDictHtmlNavigate(providerId: string, target: string) {
  void navigateInSlot(providerId, target);
}

function onDictHtmlPlaySound(dataUrl: string) {
  playDictSoundDataUrl(dataUrl);
}

function slotCanGoBack(slot: DictSlot): boolean {
  return slot.navStack.length > 1;
}

function slotNavLabel(slot: DictSlot): string {
  return slot.navStack[slot.navStack.length - 1] || "";
}

/** 把指定词典卡片滚到浮层内容区顶部（内部跳转后），保留一点上边距 */
async function scrollSlotToTop(providerId: string) {
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  const body = popupBodyRef.value;
  if (!body) return;
  const card = body.querySelector(
    `.dictCard[data-provider-id="${CSS.escape(providerId)}"]`,
  );
  if (!(card instanceof HTMLElement)) return;
  const bodyTop = body.getBoundingClientRect().top;
  const cardTop = card.getBoundingClientRect().top;
  const topGap = 8;
  body.scrollTop += cardTop - bodyTop - topGap;
}

async function navigateInSlot(providerId: string, target: string) {
  const word = target.trim();
  if (!word) return;
  const slot = slots.value.find((s) => s.providerId === providerId);
  if (!slot) return;
  const top = slot.navStack[slot.navStack.length - 1];
  if (top === word) return;

  const prevResult = slot.result;
  const prevStack = slot.navStack;
  const seq = (slotNavSeq.get(providerId) ?? 0) + 1;
  slotNavSeq.set(providerId, seq);

  slots.value = slots.value.map((s) =>
    s.providerId === providerId
      ? { ...s, status: "pending" as const, collapsed: false }
      : s,
  );

  const plain = plainSettingsForIpc(props.settings);
  let item: DictionaryLookupResultItem | null = null;
  try {
    item = await lookupOne(word, plain, providerId);
  } catch {
    item = null;
  }
  if (slotNavSeq.get(providerId) !== seq) return;

  if (item?.content?.trim()) {
    slots.value = slots.value.map((s) =>
      s.providerId === providerId
        ? {
            ...s,
            status: "ready" as const,
            result: item!,
            navStack: [...prevStack, word],
            collapsed: false,
          }
        : s,
    );
    await scrollSlotToTop(providerId);
    return;
  }

  // 本词典无此词条：恢复原文，不拆掉整张卡
  slots.value = slots.value.map((s) =>
    s.providerId === providerId
      ? {
          ...s,
          status: "ready" as const,
          result: prevResult,
          navStack: prevStack,
        }
      : s,
  );
}

async function goBackInSlot(providerId: string) {
  const slot = slots.value.find((s) => s.providerId === providerId);
  if (!slot || slot.navStack.length <= 1) return;
  const nextStack = slot.navStack.slice(0, -1);
  const prevWord = nextStack[nextStack.length - 1];
  if (!prevWord) return;

  const seq = (slotNavSeq.get(providerId) ?? 0) + 1;
  slotNavSeq.set(providerId, seq);
  slots.value = slots.value.map((s) =>
    s.providerId === providerId
      ? { ...s, status: "pending" as const, collapsed: false }
      : s,
  );

  const plain = plainSettingsForIpc(props.settings);
  let item: DictionaryLookupResultItem | null = null;
  try {
    item = await lookupOne(prevWord, plain, providerId);
  } catch {
    item = null;
  }
  if (slotNavSeq.get(providerId) !== seq) return;

  if (item?.content?.trim()) {
    slots.value = slots.value.map((s) =>
      s.providerId === providerId
        ? {
            ...s,
            status: "ready" as const,
            result: item!,
            navStack: nextStack,
            collapsed: false,
          }
        : s,
    );
    await scrollSlotToTop(providerId);
    return;
  }

  slots.value = slots.value.map((s) =>
    s.providerId === providerId
      ? { ...s, status: "ready" as const, navStack: nextStack }
      : s,
  );
  await scrollSlotToTop(providerId);
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

/** 应用自己拼的 HTML（Wiki / Wiktionary），暗色下跟主题色，不用浅底板 */
function isAppThemedDictHtml(html: string): boolean {
  return /\b(?:dictWikiTitle|dictZhWord|dictWtPos)\b/.test(html);
}

/** 词库写死浅底配色 / 依赖自带 CSS 时才套浅底板 */
function needsLegacyLightPad(html: string): boolean {
  if (!html || isAppThemedDictHtml(html)) return false;
  return (
    /<!--colortxt-legacy-css-->/.test(html) ||
    /<font\b/i.test(html) ||
    /\bcolor\s*=/i.test(html) ||
    /style\s*=\s*["'][^"']*color\s*:/i.test(html) ||
    /<style[\s\S]*?<\/style>/i.test(html) ||
    /<link\b[^>]*\bstylesheet\b/i.test(html)
  );
}

function splitProviderIds(settings: DictionarySettings): {
  localIds: string[];
  networkIds: string[];
  order: string[];
} {
  const order = (settings.providerOrder ?? []).filter(
    (id) => settings.providerEnabled?.[id] !== false,
  );
  const localSet = new Set(
    (settings.importedDictionaries ?? []).map((d) => d.id),
  );
  const localIds = order.filter((id) => localSet.has(id));
  const networkIds = order.filter((id) => !localSet.has(id));
  return { localIds, networkIds, order };
}

function settleProvider(
  seq: number,
  providerId: string,
  item: DictionaryLookupResultItem | null,
) {
  if (seq !== lookupSeq) return;
  const valid = !!(item && item.content?.trim());
  if (!valid) {
    slots.value = slots.value.filter((s) => s.providerId !== providerId);
    return;
  }
  slots.value = slots.value.map((s) =>
    s.providerId === providerId
      ? {
          ...s,
          title: item!.title || s.title,
          status: "ready" as const,
          result: item!,
        }
      : s,
  );
}

async function lookupOne(
  word: string,
  plain: DictionarySettings,
  providerId: string,
): Promise<DictionaryLookupResultItem | null> {
  const res = await window.colorTxt.dictionaryLookup({
    word,
    settings: { ...plain, providerOrder: [providerId] },
  });
  if (!res.ok) return null;
  return res.results[0] ?? null;
}

async function runLookup(wordOverride?: string) {
  const word = (wordOverride ?? queryWord.value).trim();
  queryWord.value = word;
  slotNavSeq.clear();
  if (popupBodyRef.value) popupBodyRef.value.scrollTop = 0;
  if (!word) {
    slots.value = [];
    errorMessage.value = "请输入要查询的词";
    lookupDone.value = true;
    return;
  }

  const seq = ++lookupSeq;
  errorMessage.value = "";
  lookupDone.value = false;

  const plain = plainSettingsForIpc(props.settings);
  const { localIds, networkIds, order } = splitProviderIds(plain);

  if (!order.length) {
    slots.value = [];
    errorMessage.value = "没有启用的词典";
    lookupDone.value = true;
    return;
  }

  // 一开始就列出所有启用词典，均为「查询中」
  slots.value = order.map((id) => ({
    providerId: id,
    title: dictionaryDisplayName(plain, id),
    status: "pending" as const,
    collapsed: false,
    navStack: [word],
  }));

  try {
    const networkJobs = networkIds.map(async (id) => {
      try {
        const item = await lookupOne(word, plain, id);
        settleProvider(seq, id, item);
      } catch {
        settleProvider(seq, id, null);
      }
    });

    for (const id of localIds) {
      if (seq !== lookupSeq) return;
      try {
        const item = await lookupOne(word, plain, id);
        settleProvider(seq, id, item);
      } catch {
        settleProvider(seq, id, null);
      }
    }

    await Promise.all(networkJobs);
    if (seq !== lookupSeq) return;

    if (!slots.value.length) {
      errorMessage.value = "未找到释义";
    }
  } catch (e) {
    if (seq !== lookupSeq) return;
    if (!slots.value.some((s) => s.status === "ready")) {
      slots.value = [];
      errorMessage.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    if (seq === lookupSeq) lookupDone.value = true;
  }
}

function onQueryClick() {
  void runLookup();
}

function onQueryKeydown(ev: KeyboardEvent) {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  void runLookup();
}

function toggleCard(providerId: string) {
  slots.value = slots.value.map((s) =>
    s.providerId === providerId ? { ...s, collapsed: !s.collapsed } : s,
  );
}

function onOpenManage() {
  emit("openDictionaryManage");
}

function onDocPointerDown(ev: PointerEvent) {
  if (!props.open) return;
  const t = ev.target;
  if (!(t instanceof Node)) return;
  if (popupPanelRef.value?.contains(t)) return;
  // 仅忽略叠在查词浮层之上的 AppModal（如词典管理）；找书阅读器等下层不阻拦关闭
  if (isPointerOnAppModalAbove(t, panelZIndex.value)) return;
  emit("close");
}

function bindOutsideClose() {
  removeOutsideListener?.();
  document.addEventListener("pointerdown", onDocPointerDown, true);
  removeOutsideListener = () =>
    document.removeEventListener("pointerdown", onDocPointerDown, true);
}

function unbindOutsideClose() {
  removeOutsideListener?.();
  removeOutsideListener = null;
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      queryWord.value = props.word.trim();
      const reg = registerModal({
        close: () => emit("close"),
        getEscClosable: () => true,
        setZIndex: (z) => {
          panelZIndex.value = z;
        },
      });
      panelZIndex.value = reg.zIndex;
      modalUnregister = reg.unregister;
      bindOutsideClose();
      await nextTick();
      // 勿滚动页面：fixed 浮层里 focus 默认可能 scrollIntoView 带动整页跳动
      queryInputRef.value?.focus({ preventScroll: true });
      queryInputRef.value?.select();
      void runLookup(queryWord.value);
    } else {
      modalUnregister?.();
      modalUnregister = null;
      unbindOutsideClose();
      stopDictSound();
      slotNavSeq.clear();
      lookupSeq += 1;
      lookupDone.value = true;
    }
  },
);

watch(
  () => [props.open, props.word] as const,
  ([open, word], prev) => {
    if (!open) return;
    if (!prev || prev[0] !== true) return;
    if (prev[1] === word) return;
    queryWord.value = word.trim();
    void runLookup(queryWord.value);
  },
);

onBeforeUnmount(() => {
  stopDictSound();
  modalUnregister?.();
  unbindOutsideClose();
});
</script>

<template>
  <div
    v-show="open"
    class="dictPopupRoot"
    :class="{ dictPopupRootDown: openDownward }"
    :style="{
      top: `${floatRootTop}px`,
      left: `${floatCenterX}px`,
      zIndex: panelZIndex,
    }"
  >
    <div
      ref="popupPanelRef"
      class="dictPopup"
      role="dialog"
      aria-label="词典查词"
      :style="{ maxHeight: `${maxHeight}px` }"
    >
      <div class="dictPopupHeader">
        <div class="dictPopupQueryRow">
          <div class="dictPopupQueryField">
            <input
              ref="queryInputRef"
              v-model="queryWord"
              class="dictPopupQueryInput"
              type="search"
              aria-label="查询关键词"
              placeholder="输入词语"
              @keydown="onQueryKeydown"
            />
          </div>
          <button
            type="button"
            class="btn primary dictPopupQueryBtn"
            @click="onQueryClick"
          >
            查询
          </button>
        </div>
        <button
          type="button"
          class="dictPopupIconBtn"
          aria-label="词典管理"
          title="词典管理"
          @click="onOpenManage"
        >
          <span aria-hidden="true" v-html="icons.setting"></span>
        </button>
      </div>
      <div ref="popupBodyRef" class="dictPopupBody">
        <div
          v-if="!hasVisibleSlots && lookupDone"
          class="dictPopupStatus dictPopupStatus--muted"
        >
          {{ errorMessage || "未找到释义" }}
        </div>
        <section
          v-for="slot in slots"
          :key="slot.providerId"
          class="dictCard"
          :data-provider-id="slot.providerId"
        >
          <button
            type="button"
            class="dictCardToggle"
            :aria-expanded="!slot.collapsed"
            @click="toggleCard(slot.providerId)"
          >
            <span class="dictCardTitle">{{ slot.title }}</span>
            <span
              class="dictCardChevron"
              :class="{ dictCardChevronCollapsed: slot.collapsed }"
              aria-hidden="true"
              v-html="icons.foldChevron"
            ></span>
          </button>
          <div v-show="!slot.collapsed" class="dictCardBody">
            <div
              v-if="slotCanGoBack(slot)"
              class="dictCardNav"
            >
              <button
                type="button"
                class="dictCardNavBack"
                aria-label="返回上一词条"
                title="返回"
                @click="goBackInSlot(slot.providerId)"
              >
                <span aria-hidden="true" v-html="icons.back"></span>
                <span>返回</span>
              </button>
              <span class="dictCardNavWord" :title="slotNavLabel(slot)">{{
                slotNavLabel(slot)
              }}</span>
            </div>
            <div
              v-if="slot.status === 'pending'"
              class="dictCardPending"
            >
              查询中<LoadingDotsBounce />
            </div>
            <template v-else-if="slot.result">
              <DictHtmlFrame
                v-if="slot.result.contentFormat === 'html'"
                :html="sanitizeHtml(slot.result.content)"
                :legacy-pad="needsLegacyLightPad(slot.result.content)"
                @navigate="onDictHtmlNavigate(slot.providerId, $event)"
                @play-sound="onDictHtmlPlaySound"
              />
              <pre
                v-else
                class="dictCardContent dictCardContent--text"
              >{{ slot.result.content }}</pre>
            </template>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dictPopupRoot {
  position: fixed;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  transform: translate(-50%, -100%);
  max-width: min(400px, calc(100vw - 24px));
}

.dictPopupRootDown {
  transform: translate(-50%, 0);
}

.dictPopup {
  pointer-events: auto;
  width: 360px;
  max-width: min(400px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 8px 28px color-mix(in srgb, #000 22%, transparent);
  overflow: hidden;
}

.dictPopupHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.dictPopupQueryRow {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
}

.dictPopupQueryField {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-right: none;
  border-radius: 999px 0 0 999px;
  background: var(--input-bg);
  padding: 6px 10px;
  transition: border-color 0.12s ease;
}

.dictPopupQueryField:focus-within {
  border-color: var(--accent);
}

.dictPopupQueryInput {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  width: 0;
  height: auto;
  border: none;
  border-radius: 0;
  outline: none;
  background: transparent;
  padding: 2px 0;
  color: var(--fg);
  font: inherit;
  font-size: 14px;
  line-height: inherit;
}

.dictPopupQueryBtn {
  flex-shrink: 0;
  border-radius: 0 999px 999px 0;
  padding: 7px 16px;
  white-space: nowrap;
  font-size: 14px;
  border: none;
}

.dictPopupIconBtn {
  flex-shrink: 0;
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}

.dictPopupIconBtn:hover {
  background: var(--icon-btn-bg-hover);
}

.dictPopupIconBtn :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.dictPopupIconBtn :deep(svg path) {
  fill: currentColor;
}

.dictPopupBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 12px 12px;
  scroll-padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dictPopupStatus {
  margin: 8px 0;
  font-size: 13px;
  color: var(--fg);
}

.dictPopupStatus--muted {
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.dictCard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.dictCard:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.dictCardToggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 4px 6px;
  box-sizing: border-box;
  border: none;
  border-radius: 6px;
  background: var(--icon-btn-bg-hover);
  cursor: pointer;
  text-align: left;
  color: inherit;
  transition: background 0.12s ease;
  user-select: none;
}

.dictCardToggle:hover .dictCardTitle,
.dictCardToggle:hover .dictCardChevron {
  color: var(--fg);
}

.dictCardTitle {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 70%, transparent));
  transition: color 0.12s ease;
}

.dictCardChevron {
  flex-shrink: 0;
  display: inline-flex;
  width: 14px;
  height: 14px;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
  transform: rotate(180deg);
  transition: transform 0.15s ease, color 0.12s ease;
}

.dictCardChevronCollapsed {
  transform: rotate(0deg);
}

.dictCardChevron :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.dictCardChevron :deep(svg path) {
  fill: currentColor;
}

.dictCardBody {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dictCardNav {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 2px 0 4px;
  border-bottom: 1px solid var(--border);
}

.dictCardNavBack {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 2px 6px 2px 2px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--accent, #3b82f6);
  font-size: 12px;
  cursor: pointer;
}

.dictCardNavBack:hover {
  background: color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent);
}

.dictCardNavBack :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}

.dictCardNavBack :deep(svg path) {
  fill: currentColor;
}

.dictCardNavWord {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.dictCardPending {
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
  font-size: 13px;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}

.dictCardContent {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.dictCardContent--text {
  font-family: inherit;
}
</style>
