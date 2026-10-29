<script setup lang="ts">
/**
 * 词库 HTML 挂在 Shadow DOM 内，避免释义里的 <style> 污染整页（打开/跳转会像整页重渲）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  html: string;
  /** 暗色下对硬编码浅底词库套浅底板 */
  legacyPad?: boolean;
}>();

const emit = defineEmits<{
  navigate: [target: string];
  playSound: [dataUrl: string];
}>();

const hostRef = ref<HTMLElement | null>(null);
let shadow: ShadowRoot | null = null;

const FRAME_BASE_CSS = `
:host {
  display: block;
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--fg);
  word-break: break-word;
  white-space: normal;
}
:host([data-legacy-pad]) {
  color: #1c1917;
  background: #f5f5f4;
  border-radius: 8px;
  padding: 8px 10px;
}
a {
  color: var(--accent, #3b82f6);
}
:host([data-legacy-pad]) a,
:host([data-legacy-pad]) a.dictEntry,
:host([data-legacy-pad]) a[data-dict-entry] {
  color: #2563eb;
}
a.dictSound,
a[data-dict-sound] {
  cursor: pointer;
  text-decoration: none;
}
a.dictSound:hover,
a[data-dict-sound]:hover {
  text-decoration: underline;
}
a.dictEntry,
a[data-dict-entry] {
  cursor: pointer;
  color: var(--accent, #3b82f6);
  text-decoration: underline;
}
img {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}
.dictZhWord {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.dictZhPinyin {
  margin: 2px 0 0;
  font-size: 13px;
  font-style: italic;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 70%, transparent));
}
.dictZhLang {
  margin: 2px 0 8px;
  font-size: 12px;
  font-style: italic;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}
.dictWtPos {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
}
.dictZhDefs {
  margin: 0 0 10px;
  padding-left: 1.25em;
}
.dictZhDefs:last-child {
  margin-bottom: 0;
}
.dictZhDefs li {
  margin: 0.2em 0;
}
.dictWikiTitle {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 6px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  background: color-mix(in srgb, #000 45%, var(--fg) 12%);
  min-height: 48px;
}
.dictWikiDesc {
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 400;
  opacity: 0.9;
}
.dictWikiExtract {
  font-size: 13px;
  line-height: 1.45;
}
.dictWikiExtract p {
  margin: 0;
}
.dictWikiExtract b,
.dictWikiExtract strong {
  font-weight: 700;
}
`;

function syncLegacyPadAttr() {
  const host = hostRef.value;
  if (!host) return;
  const dark = document.documentElement.classList.contains("dark");
  host.toggleAttribute("data-legacy-pad", !!(props.legacyPad && dark));
}

function paint() {
  if (!shadow) return;
  shadow.innerHTML = `<style>${FRAME_BASE_CSS}</style>${props.html}`;
  syncLegacyPadAttr();
}

function onShadowClick(ev: Event) {
  const t = ev.target;
  if (!(t instanceof Element)) return;

  const soundLink = t.closest("a.dictSound, a[data-dict-sound]");
  if (soundLink instanceof HTMLAnchorElement) {
    const href = soundLink.getAttribute("href") || "";
    if (/^data:audio\//i.test(href)) {
      ev.preventDefault();
      ev.stopPropagation();
      emit("playSound", href);
      return;
    }
  }

  const entryLink = t.closest("a.dictEntry, a[data-dict-entry]");
  if (entryLink instanceof HTMLAnchorElement) {
    const target = (entryLink.getAttribute("data-dict-entry") || "").trim();
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    emit("navigate", target);
  }
}

let themeObserver: MutationObserver | null = null;

onMounted(() => {
  const host = hostRef.value;
  if (!host) return;
  shadow = host.attachShadow({ mode: "open" });
  shadow.addEventListener("click", onShadowClick);
  paint();
  themeObserver = new MutationObserver(() => syncLegacyPadAttr());
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
});

watch(
  () => props.html,
  () => paint(),
);

watch(
  () => props.legacyPad,
  () => syncLegacyPadAttr(),
);

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  themeObserver = null;
  shadow?.removeEventListener("click", onShadowClick);
  shadow = null;
});
</script>

<template>
  <div
    ref="hostRef"
    class="dictHtmlFrame"
  ></div>
</template>

<style scoped>
.dictHtmlFrame {
  display: block;
  min-width: 0;
}
</style>
