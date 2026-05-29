<script setup lang="ts">
import { computed } from "vue";

import { vAiStickScroll } from "../directives/aiStickScroll";

import {
  toolFoldArgsRendered,
  toolFoldBodyRendered,
  type ToolFoldBodySource,
} from "../utils/aiToolFoldBody";

const props = defineProps<{ tool: ToolFoldBodySource }>();

const argsRendered = computed(() => toolFoldArgsRendered(props.tool));

const rendered = computed(() => toolFoldBodyRendered(props.tool));
</script>

<template>
  <div class="aiToolFoldBodyRoot">
    <template v-if="argsRendered.html">
      <div class="aiFoldToolSectionLabel">请求</div>

      <pre
        v-ai-stick-scroll
        class="aiFoldBody"
        :class="{ 'aiFoldBody--json': argsRendered.isJson }"
        v-html="argsRendered.html"
      />
    </template>

    <div
      class="aiFoldToolSectionLabel"
      :class="{ 'aiFoldToolSectionLabel--follow': !!argsRendered.html }"
    >
      结果
    </div>

    <pre
      v-ai-stick-scroll
      class="aiFoldBody"
      :class="{ 'aiFoldBody--json': rendered.isJson }"
      v-html="rendered.html"
    />
  </div>
</template>

<style scoped>
.aiToolFoldBodyRoot {
  display: block;
}

.aiFoldToolSectionLabel {
  margin: 0;
  padding: 10px 10px 0 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.02em;
}

.aiFoldBody {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: color-mix(in srgb, var(--fg) 88%, var(--muted));
  max-height: 240px;
  overflow-y: auto;
}

.aiFoldBody.aiFoldBody--json {
  font-family: ui-monospace, "Cascadia Code", "Consolas", monospace;
  font-size: 11.5px;
  line-height: 1.45;
  background: var(--bg);
  border-radius: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  margin: 10px;
  overflow: auto;
  max-height: 180px;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
  tab-size: 2;
  margin: 10px;
}

.aiFoldBody--json :deep(.aiJsonKey) {
  color: color-mix(in srgb, var(--accent) 72%, var(--fg));
}

.aiFoldBody--json :deep(.aiJsonStr) {
  color: color-mix(in srgb, #22c55e 52%, var(--fg));
}

.aiFoldBody--json :deep(.aiJsonNum) {
  color: color-mix(in srgb, #f59e0b 58%, var(--fg));
}

.aiFoldBody--json :deep(.aiJsonKw) {
  color: color-mix(in srgb, #a855f7 48%, var(--fg));
}

.aiFoldBody :deep(.aiDigestProgressFrac) {
  color: var(--warning);
  font-weight: 700;
}
</style>
