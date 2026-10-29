<script setup lang="ts">
import type { AITokenPricePerMillion } from "@shared/aiTypes";
import type { AITokenUsageTotals } from "@shared/aiTokenUsage";
import AiTokenUsageBanner from "./AiTokenUsageBanner.vue";
import AppModal from "./AppModal.vue";
import LoadingDotsBounce from "./LoadingDotsBounce.vue";

const open = defineModel<boolean>({ default: false });

defineProps<{
  current: number;
  total: number;
  showTokenUsage?: boolean;
  tokenUsage?: AITokenUsageTotals;
  tokenUsageAvailable?: boolean;
  tokenPricePerMillion?: AITokenPricePerMillion | null;
}>();

const emit = defineEmits<{
  stop: [];
}>();
</script>

<template>
  <AppModal
    v-model="open"
    title="AI 智能排版"
    max-width="400px"
    :mask-closable="false"
    :esc-closable="false"
    :show-close-button="false"
  >
    <div class="body">
      <p class="status">正在处理<LoadingDotsBounce /></p>
      <p v-if="total > 1" class="progress">
        当前进度：<span class="progressValue">{{ current }}/{{ total }}</span>
      </p>
      <AiTokenUsageBanner
        v-if="
          showTokenUsage &&
          tokenUsage &&
          (tokenUsageAvailable || tokenUsage.totalTokens > 0)
        "
        class="tokenUsage"
        :usage="tokenUsage"
        :available="tokenUsageAvailable ?? false"
        :token-price-per-million="tokenPricePerMillion"
        label="累计消耗 Token"
      />
    </div>
    <template #footer>
      <div class="progressFooter">
        <button type="button" size="large" class="btn danger" @click="emit('stop')">
          停止
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 8px;
}

.status {
  margin: 0;
  font-size: 14px;
  color: var(--fg);
  display: flex;
  align-items: center;
  gap: 0.15em;
}

.progress {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.progressValue {
  color: var(--warning);
  font-weight: 700;
}

.tokenUsage {
  margin: 0;
}

.progressFooter {
  display: flex;
  justify-content: flex-end;
}
</style>
