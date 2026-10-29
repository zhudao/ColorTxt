<script setup lang="ts">
import { ref, watch } from "vue";
import AppModal from "../../components/AppModal.vue";
import AppCheckbox from "../../components/AppCheckbox.vue";
import NumericInput from "../../components/NumericInput.vue";
import type { BookSourceCheckConfig } from "@shared/bookSource/ipc";
import { appToast } from "../../services/appToast";

const modelValue = defineModel<boolean>({ default: false });

const timeoutSec = ref(180);
const concurrency = ref(4);
const checkSearch = ref(true);
const checkDiscovery = ref(true);
const checkInfo = ref(true);
const checkCategory = ref(true);
const checkContent = ref(true);

watch(modelValue, async (open) => {
  if (!open) return;
  try {
    const cfg = await window.colorTxt.bookSourceCheckGetConfig();
    applyConfig(cfg);
  } catch {
    /* ignore */
  }
});

function applyConfig(cfg: BookSourceCheckConfig) {
  timeoutSec.value = Math.max(1, Math.round((cfg.timeout || 180_000) / 1000));
  concurrency.value = Math.max(1, Math.min(32, Math.floor(cfg.concurrency || 4)));
  checkSearch.value = cfg.checkSearch !== false;
  checkDiscovery.value = cfg.checkDiscovery !== false;
  checkInfo.value = cfg.checkInfo !== false;
  checkCategory.value = cfg.checkCategory !== false;
  checkContent.value = cfg.checkContent !== false;
  syncDependentChecks();
}

/** 对齐 Legado CheckSourceConfig：详情关 → 目录/正文关；目录关 → 正文关 */
function syncDependentChecks() {
  if (!checkInfo.value) {
    checkCategory.value = false;
    checkContent.value = false;
  } else if (!checkCategory.value) {
    checkContent.value = false;
  }
}

function onToggleSearch(v: boolean) {
  checkSearch.value = v;
  if (!checkSearch.value && !checkDiscovery.value) {
    checkDiscovery.value = true;
  }
}

function onToggleDiscovery(v: boolean) {
  checkDiscovery.value = v;
  if (!checkSearch.value && !checkDiscovery.value) {
    checkSearch.value = true;
  }
}

function onToggleInfo(v: boolean) {
  checkInfo.value = v;
  syncDependentChecks();
}

function onToggleCategory(v: boolean) {
  if (!checkInfo.value) return;
  checkCategory.value = v;
  syncDependentChecks();
}

function onToggleContent(v: boolean) {
  if (!checkInfo.value || !checkCategory.value) return;
  checkContent.value = v;
}

async function onConfirm() {
  const sec = timeoutSec.value;
  if (!Number.isFinite(sec) || sec <= 0) {
    appToast("超时时间须大于 0 秒", { kind: "warning" });
    return;
  }
  const n = concurrency.value;
  if (!Number.isFinite(n) || n < 1) {
    appToast("并发数须至少为 1", { kind: "warning" });
    return;
  }
  await window.colorTxt.bookSourceCheckSetConfig({
    timeout: Math.floor(sec) * 1000,
    concurrency: Math.floor(n),
    checkSearch: checkSearch.value,
    checkDiscovery: checkDiscovery.value,
    checkInfo: checkInfo.value,
    checkCategory: checkCategory.value,
    checkContent: checkContent.value,
  });
  modelValue.value = false;
}

function onCancel() {
  modelValue.value = false;
}
</script>

<template>
  <AppModal
    v-model="modelValue"
    title="校验设置"
    max-width="520px"
    :mask-closable="true"
    :esc-closable="true"
    panel-class="checkSourceConfigPanel"
  >
    <div class="cscBody">
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel">单个书源校验超时（秒）</span>
          <NumericInput
            v-model="timeoutSec"
            :min="1"
            integer
            aria-label="单个书源校验超时（秒）"
          />
        </div>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel">并发数</span>
          <NumericInput
            v-model="concurrency"
            :min="1"
            :max="32"
            integer
            aria-label="并发数"
          />
        </div>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel short">校验项目</span>
          <div class="cscChecks">
            <AppCheckbox
              :model-value="checkSearch"
              label="搜索"
              @update:model-value="onToggleSearch"
            />
            <AppCheckbox
              :model-value="checkDiscovery"
              label="发现"
              @update:model-value="onToggleDiscovery"
            />
            <AppCheckbox
              :model-value="checkInfo"
              label="详情"
              @update:model-value="onToggleInfo"
            />
            <AppCheckbox
              :model-value="checkCategory"
              label="目录"
              :disabled="!checkInfo"
              @update:model-value="onToggleCategory"
            />
            <AppCheckbox
              :model-value="checkContent"
              label="正文"
              :disabled="!checkInfo || !checkCategory"
              @update:model-value="onToggleContent"
            />
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="cscFooter">
        <button type="button" class="btn" size="large" @click="onCancel">取消</button>
        <button type="button" class="btn primary" size="large" @click="onConfirm">
          确认
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.cscBody {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.settingsRow {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.settingsRowMain {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}
.settingsRowMain--baseline {
  align-items: baseline;
}
.settingsLabel {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--fg);
}
.cscChecks {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px 12px;
  min-width: 0;
}
.cscFooter {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
</style>
