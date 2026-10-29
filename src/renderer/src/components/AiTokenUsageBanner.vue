<script setup lang="ts">
import type { AITokenPricePerMillion } from "@shared/aiTypes";
import type { AITokenUsageTotals } from "@shared/aiTokenUsage";
import { formatTokenUsageSummaryLine } from "@shared/aiTokenUsage";

const props = withDefaults(
  defineProps<{
    usage: AITokenUsageTotals;
    available: boolean;
    tokenPricePerMillion?: AITokenPricePerMillion | null;
    label?: string;
  }>(),
  { label: "本次对话消耗 Token" },
);
</script>

<template>
  <p class="aiTokenUsageBanner" role="status" aria-live="polite">
    {{
      formatTokenUsageSummaryLine(
        props.usage,
        props.available,
        props.tokenPricePerMillion ?? null,
        props.label,
      )
    }}
  </p>
</template>
<style scoped>
.aiTokenUsageBanner {
  margin: 0;
  font-size: 12px;
  padding: 8px;
  border-radius: 6px;
  line-height: 1.45;
  white-space: pre-wrap;
  background: var(--info-bg);
  border: 1px solid var(--info-border);
  color: var(--info);
}
</style>
