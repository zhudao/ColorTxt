<script setup lang="ts">
import { computed } from "vue";
import "katex/dist/katex.min.css";
import { marked } from "../utils/aiMarkdownMarkedSetup";
import { ensureSpacesAroundMarkdownStrongPairs } from "../utils/aiMarkdownMarkedPrep";
import type { Chapter } from "../chapter";
import {
  chapterNumStrFromMarkerMatch,
  chapterRefButtonLabel,
  createAiChapterMarkerRegex,
  formatAiAssistantAnswerForDisplay,
} from "../utils/aiMarkdownChapterRef";

const props = withDefaults(
  defineProps<{
    source: string;
    chapters?: readonly Chapter[];
  }>(),
  { chapters: () => [] },
);

/**
 * 在 marked 输出 HTML 之后，于 `pre` / `code` 外的文本节点中把
 * `（ch=N）` 中 N = chapterIndex（从 0 起）；按钮展示为书中章节名。先归一化 `（ch=a-b）`、`（ch=N后缀）` 等变体，并兼容半角括号、`[ch=N]` 等旧输出。
 */
function injectChapterRefButtons(
  html: string,
  chapters: readonly Chapter[],
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<div class="ai-md-wrap">${html}</div>`,
    "text/html",
  );
  const wrap = doc.body.firstElementChild;
  if (!wrap) return html;

  function injectIntoTextNode(tn: Text): void {
    const raw = tn.textContent ?? "";
    const re = createAiChapterMarkerRegex();
    if (!re.test(raw)) return;
    re.lastIndex = 0;

    const frag = doc.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      frag.appendChild(doc.createTextNode(raw.slice(last, m.index)));
      const num = chapterNumStrFromMarkerMatch(m);
      const idx = Number.parseInt(num, 10);
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "aiChRef";
      btn.setAttribute("data-ch", num);
      if (Number.isFinite(idx) && idx >= 0) {
        btn.textContent = chapterRefButtonLabel(idx, chapters);
      } else {
        btn.textContent = `章 ${num}`;
      }
      frag.appendChild(btn);
      last = m.index + m[0].length;
    }
    frag.appendChild(doc.createTextNode(raw.slice(last)));
    tn.parentNode?.replaceChild(frag, tn);
  }

  function walk(el: Element): void {
    for (const child of [...el.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const tn = child as Text;
        if (tn.parentElement?.closest("pre, code")) continue;
        injectIntoTextNode(tn);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child as Element);
      }
    }
  }

  walk(wrap);
  return wrap.innerHTML;
}

const html = computed(() => {
  let md = formatAiAssistantAnswerForDisplay(props.source);
  md = ensureSpacesAroundMarkdownStrongPairs(md);
  const parsed = marked.parse(md, { breaks: true, async: false }) as string;
  return injectChapterRefButtons(parsed, props.chapters);
});

const emit = defineEmits<{
  /** 与书籍章节数组下标一致（从 0 起），由父组件用于 jumpToChapter */
  chapterClick: [chapterIndexZeroBased: number];
}>();

function onClick(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest(
    "button.aiChRef[data-ch]",
  ) as HTMLElement | null;
  if (!t) return;
  e.preventDefault();
  const idx = Number.parseInt(t.getAttribute("data-ch") ?? "", 10);
  if (Number.isFinite(idx) && idx >= 0) emit("chapterClick", idx);
}
</script>

<template>
  <div class="aiMarkdown" @click="onClick" v-html="html" />
</template>

<style scoped>
.aiMarkdown {
  font-size: 13px;
  line-height: 1.55;
  color: var(--fg);
  word-break: break-word;
}

.aiMarkdown :deep(ul),
.aiMarkdown :deep(ol) {
  padding-left: 20px;
}

.aiMarkdown :deep(p) {
  margin: 0 0 0.6em;
}

.aiMarkdown :deep(p:last-child) {
  margin-bottom: 0;
}

.aiMarkdown :deep(pre) {
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: var(--reader-bg, var(--bg));
  border: 1px solid var(--border);
}

.aiMarkdown :deep(code) {
  font-family: var(--mono-font, ui-monospace, monospace);
  font-size: 12px;
}

.aiMarkdown :deep(.aiChRef) {
  display: inline;
  margin: 0 2px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  vertical-align: baseline;
}

.aiMarkdown :deep(.aiChRef:hover) {
  filter: brightness(1.08);
}

.aiMarkdown :deep(.katex-display) {
  display: block;
  margin: 0.55em 0;
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 100%;
}

.aiMarkdown :deep(span.katex) {
  max-width: 100%;
}
</style>
