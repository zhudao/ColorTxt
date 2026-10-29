<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppModal from "./AppModal.vue";
import IconButton from "./IconButton.vue";
import SwitchToggle from "./SwitchToggle.vue";
import AppCheckbox from "./AppCheckbox.vue";
import AutoResizeTextarea from "./AutoResizeTextarea.vue";
import HighlightedCodeTextarea from "./HighlightedCodeTextarea.vue";
import NumericInput from "./NumericInput.vue";
import RadioGroup from "./RadioGroup.vue";
import BookSourceFieldMonacoModal from "../bookSource/components/BookSourceFieldMonacoModal.vue";
import {
  SORTABLE_ROW_HANDLE_CLASS,
  useSortableReorder,
} from "../composables/useSortableReorder";
import { icons } from "../icons";
import { appAlert } from "../services/appDialog";
import { appToast } from "../services/appToast";
import {
  cloneVoiceReadFilterRule,
  cloneVoiceReadSpeakSettings,
  createDefaultVoiceReadFilterRules,
  displayVoiceReadFilterRuleName,
  isVoiceReadFilterRuleValid,
  MIN_VOICE_READ_AUTO_PAUSE_COUNT,
  newVoiceReadFilterRuleId,
  VOICE_READ_AUTO_PAUSE_OPTIONS,
  type VoiceReadAutoPauseMode,
  type VoiceReadFilterRule,
  type VoiceReadSpeakSettings,
} from "../constants/voiceReadSpeak";
import {
  commitVoiceReadSpeakSettings,
  getVoiceReadSpeakSettings,
} from "../services/voiceRead/voiceReadSpeakStore";

const modelValue = defineModel<boolean>({ default: false });

const draft = ref<VoiceReadSpeakSettings>(getVoiceReadSpeakSettings());
const saving = ref(false);
const showEdit = ref(false);
const editing = ref<VoiceReadFilterRule | null>(null);
const editingRuleId = ref<string | null>(null);

const ruleTableBodyRef = ref<HTMLElement | null>(null);
const items = computed({
  get: () => draft.value.filterRules,
  set: (next: VoiceReadFilterRule[]) => {
    draft.value = { ...draft.value, filterRules: next };
  },
});
const ruleCount = computed(() => items.value.length);

function cloneDraftFromStore() {
  draft.value = getVoiceReadSpeakSettings();
}

watch(modelValue, (open) => {
  if (open) {
    cloneDraftFromStore();
    return;
  }
  showEdit.value = false;
  editing.value = null;
  editingRuleId.value = null;
  monacoOpen.value = false;
});

watch(
  modelValue,
  (open) => {
    if (!open) {
      showEdit.value = false;
      monacoOpen.value = false;
    }
  },
  { flush: "sync" },
);

useSortableReorder({
  containerRef: ruleTableBodyRef,
  active: modelValue,
  itemCount: ruleCount,
  enabled: computed(() => items.value.length > 1),
  onReorder(from, to) {
    moveRule(from, to);
  },
});

function moveRule(fromIndex: number, toIndex: number) {
  const arr = [...items.value];
  const item = arr.splice(fromIndex, 1)[0];
  if (!item) return;
  arr.splice(toIndex, 0, item);
  items.value = arr;
}

function onToggle(item: VoiceReadFilterRule, enabled: boolean) {
  const idx = items.value.findIndex((r) => r.id === item.id);
  if (idx < 0) return;
  const next = [...items.value];
  next[idx] = { ...next[idx]!, isEnabled: enabled };
  items.value = next;
}

function onDeleteOne(item: VoiceReadFilterRule) {
  items.value = items.value.filter((r) => r.id !== item.id);
}

function onRestoreDefaultFilterRules() {
  showEdit.value = false;
  editing.value = null;
  editingRuleId.value = null;
  monacoOpen.value = false;
  items.value = createDefaultVoiceReadFilterRules();
}

function openCreate() {
  editingRuleId.value = null;
  editing.value = {
    id: newVoiceReadFilterRuleId(),
    name: "",
    pattern: "",
    isRegex: true,
    isEnabled: true,
    order: items.value.length,
  };
  showEdit.value = true;
}

function openEdit(item: VoiceReadFilterRule) {
  editingRuleId.value = item.id;
  editing.value = cloneVoiceReadFilterRule(item);
  showEdit.value = true;
}

const editModalTitle = computed(() =>
  editingRuleId.value == null ? "新增过滤规则" : "编辑过滤规则",
);

const monacoOpen = ref(false);
const monacoInitialText = ref("");

function openFilterRuleMonaco() {
  const draft = editing.value;
  if (!draft) return;
  monacoInitialText.value = draft.pattern;
  monacoOpen.value = true;
}

function onFilterRuleMonacoConfirm(text: string) {
  const draft = editing.value;
  if (draft) draft.pattern = text;
}

watch(showEdit, (open) => {
  if (!open) monacoOpen.value = false;
});

function onSaveEdit() {
  const next = editing.value;
  if (!next) return;
  if (!isVoiceReadFilterRuleValid(next)) {
    appToast("请填写有效的过滤规则（正则语法须正确）", { kind: "warning" });
    return;
  }
  if (editingRuleId.value == null) {
    let id = next.id;
    while (items.value.some((r) => r.id === id)) id = newVoiceReadFilterRuleId();
    items.value = [...items.value, { ...next, id }];
  } else {
    const idx = items.value.findIndex((r) => r.id === editingRuleId.value);
    if (idx < 0) {
      items.value = [...items.value, { ...next }];
    } else {
      const copy = [...items.value];
      copy[idx] = { ...next, id: editingRuleId.value };
      items.value = copy;
    }
  }
  showEdit.value = false;
}

function close() {
  modelValue.value = false;
}

async function onSave() {
  if (saving.value) return;
  const invalid = items.value.find(
    (r) => r.pattern.trim() && !isVoiceReadFilterRuleValid(r),
  );
  if (invalid) {
    await appAlert(
      `过滤规则「${displayVoiceReadFilterRuleName(invalid) || invalid.pattern}」正则无效`,
    );
    return;
  }
  saving.value = true;
  try {
    const payload: VoiceReadSpeakSettings = {
      ...cloneVoiceReadSpeakSettings(draft.value),
      filterRules: items.value
        .filter((r) => r.pattern.trim())
        .map((r, i) => ({ ...r, order: i })),
    };
    commitVoiceReadSpeakSettings(payload);
    close();
  } finally {
    saving.value = false;
  }
}

const autoPauseMode = computed({
  get: () => draft.value.autoPauseMode,
  set: (v: string) => {
    draft.value = {
      ...draft.value,
      autoPauseMode: v as VoiceReadAutoPauseMode,
    };
  },
});

</script>

<template>
  <AppModal
    v-model="modelValue"
    title="朗读设置"
    max-width="700px"
    panel-class="voiceReadSpeakSettingsPanel"
    :mask-closable="false"
    :esc-closable="true"
  >
    <div class="speakSettingsRoot">
      <div class="settingsBody">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel settingsLabel--strong">自动暂停</span>
            <RadioGroup
              v-model="autoPauseMode"
              :options="VOICE_READ_AUTO_PAUSE_OPTIONS"
              aria-label="自动暂停"
            />
          </div>
          <p class="settingsHint">
            开始朗读后，在满足条件时自动暂停；播放 / 上一行 / 下一行，都会重置条件。
          </p>
        </div>

        <div
          v-if="draft.autoPauseMode === 'chapters'"
          class="settingsRow"
        >
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel">章节数</span>
            <NumericInput
              v-model="draft.autoPauseChapterCount"
              :min="MIN_VOICE_READ_AUTO_PAUSE_COUNT"
              integer
              aria-label="自动暂停章节数"
            />
          </div>
        </div>

        <div
          v-if="draft.autoPauseMode === 'duration'"
          class="settingsRow"
        >
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel">时长（分钟）</span>
            <NumericInput
              v-model="draft.autoPauseDurationMinutes"
              :min="MIN_VOICE_READ_AUTO_PAUSE_COUNT"
              integer
              aria-label="自动暂停时长分钟"
            />
          </div>
        </div>
      </div>

      <div class="settingsBody">
        <h3 class="settingsSectionTitle">朗读过滤</h3>
        <p class="settingsHint">朗读时忽略特定内容（替换为空格；正则可跨行）。</p>

        <div class="tableWrap">
          <div class="ruleTableHeadWrap">
            <table class="ruleTable ruleTable--head">
              <colgroup>
                <col class="colCheck" />
                <col class="colName" />
                <col class="colRule" />
                <col class="colActions" />
              </colgroup>
              <thead>
                <tr>
                  <th class="colCheck" scope="col" aria-label="启用"></th>
                  <th class="colName" scope="col">名称</th>
                  <th class="colRule" scope="col">过滤规则</th>
                  <th class="colActions" scope="col">操作</th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="tableBodyScroll">
            <div v-if="!items.length" class="emptyHint">暂无过滤规则</div>
            <table v-else class="ruleTable ruleTable--body">
              <colgroup>
                <col class="colCheck" />
                <col class="colName" />
                <col class="colRule" />
                <col class="colActions" />
              </colgroup>
              <tbody ref="ruleTableBodyRef">
                <tr v-for="item in items" :key="item.id">
                  <td class="cellCheck">
                    <SwitchToggle
                      :model-value="item.isEnabled"
                      size="sm"
                      :aria-label="`启用规则 ${displayVoiceReadFilterRuleName(item) || item.pattern}`"
                      @update:model-value="onToggle(item, $event)"
                    />
                  </td>
                  <td class="cellName">
                    <div
                      class="ruleTitle"
                      :class="{ 'ruleTitle--empty': !displayVoiceReadFilterRuleName(item) }"
                      :title="displayVoiceReadFilterRuleName(item) || undefined"
                    >
                      {{ displayVoiceReadFilterRuleName(item) || "" }}
                    </div>
                  </td>
                  <td class="cellRule">
                    <div class="rulePreview">
                      <code :title="item.pattern">{{ item.pattern }}</code>
                    </div>
                  </td>
                  <td class="cellActions">
                    <div class="cellActionsInner">
                      <IconButton
                        :class="SORTABLE_ROW_HANDLE_CLASS"
                        :icon-html="icons.move"
                        aria-label="拖动排序"
                        title="拖动排序"
                        :disabled="items.length <= 1"
                      />
                      <IconButton
                        :icon-html="icons.edit"
                        aria-label="编辑"
                        title="编辑"
                        @click="openEdit(item)"
                      />
                      <IconButton
                        danger
                        :icon-html="icons.remove"
                        aria-label="移除"
                        title="移除"
                        @click="onDeleteOne(item)"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="speakSettingsFooter">
        <div class="speakSettingsFooterStart">
          <button class="btn" type="button" size="large" @click="openCreate">
            新增过滤规则
          </button>
          <button
            class="btn"
            type="button"
            size="large"
            @click="onRestoreDefaultFilterRules"
          >
            恢复默认过滤规则
          </button>
        </div>
        <div class="speakSettingsFooterEnd">
          <button class="btn" type="button" size="large" @click="close">
            取消
          </button>
          <button
            class="btn primary"
            type="button"
            size="large"
            :disabled="saving"
            @click="onSave"
          >
            保存
          </button>
        </div>
      </div>
    </template>
  </AppModal>

  <AppModal
    v-model="showEdit"
    :title="editModalTitle"
    panel-class="editVoiceReadFilterRulePanel"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="false"
  >
    <div v-if="editing" class="editShell">
      <div class="editFields">
        <label class="editField">
          <span class="editFieldLabel">
            <span class="editFieldLabelTitle">名称</span>
          </span>
          <AutoResizeTextarea class="editFieldInput" v-model="editing.name" />
        </label>
        <div class="editField">
          <div class="editFieldLabel">
            <span class="editFieldLabelTitle">过滤规则</span>
            <IconButton
              class="editFieldMonacoBtn"
              :icon-html="icons.sourceCode"
              title="编辑器"
              aria-label="编辑器"
              @click.stop="openFilterRuleMonaco"
            />
          </div>
          <HighlightedCodeTextarea
            class="editFieldInput"
            :max-height="160"
            v-model="editing.pattern"
          />
        </div>
        <div class="editCheckRow">
          <AppCheckbox
            class="editCheck"
            v-model="editing.isRegex"
            label="使用正则表达式"
          />
        </div>
      </div>
    </div>
    <template #footer>
      <div class="editFooter">
        <div class="editFooterActions">
          <button
            type="button"
            class="btn"
            size="large"
            @click="showEdit = false"
          >
            取消
          </button>
          <button
            type="button"
            class="btn primary"
            size="large"
            @click="onSaveEdit"
          >
            确定
          </button>
        </div>
      </div>
    </template>
  </AppModal>

  <BookSourceFieldMonacoModal
    v-model="monacoOpen"
    title="过滤规则"
    language="plaintext"
    :initial-text="monacoInitialText"
    @confirm="onFilterRuleMonacoConfirm"
  />
</template>

<style>
.voiceReadSpeakSettingsPanel .appModalBody {
  padding-right: 8px;
}
.editVoiceReadFilterRulePanel {
  overflow: hidden;
}
.editVoiceReadFilterRulePanel .appModalBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>

<style scoped>
.speakSettingsRoot {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settingsBody {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  background-color: var(--bg);
  border-radius: 8px;
}

.settingsSectionTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

.settingsSectionTitle + .settingsHint {
  margin-top: -12px;
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
  align-items: center;
}

.settingsLabel {
  font-size: 14px;
  color: var(--fg);
  white-space: nowrap;
  flex: 1 1 60%;
}

.settingsLabel--strong {
  font-weight: 600;
}

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.tableWrap {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}

.ruleTableHeadWrap {
  flex-shrink: 0;
}

.tableBodyScroll {
  overflow: visible;
}

.emptyHint {
  padding: 36px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}

.ruleTable {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.ruleTable col.colCheck {
  width: 44px;
}

.ruleTable col.colName {
  width: 140px;
}

.ruleTable col.colActions {
  width: 118px;
}

.ruleTable th,
.ruleTable td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.ruleTable--head th {
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  background: color-mix(in srgb, var(--bg) 92%, var(--border));
}

.ruleTable--body tbody tr:last-child td {
  border-bottom: none;
}

.cellCheck {
  text-align: center;
}

.cellName,
.cellRule {
  min-width: 0;
}

.ruleTitle {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ruleTitle--empty {
  font-weight: 400;
  color: var(--muted);
}

.rulePreview {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-family: Consolas, "Courier New", monospace;
  color: var(--muted);
  overflow: hidden;
  min-width: 0;
}

.rulePreview code {
  margin: 0;
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--panel-elevated, rgba(127, 127, 127, 0.12));
  font-size: 11px;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
}

.cellActions {
  vertical-align: middle;
  text-align: left;
}

.cellActionsInner {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
}

.speakSettingsFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
}

.speakSettingsFooterStart,
.speakSettingsFooterEnd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.speakSettingsFooterEnd {
  margin-left: auto;
}

:deep(tr.sortableRowGhost) {
  opacity: 0.45;
}

:deep(tr.sortableRowChosen) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

:deep(.sortableRowHandle) {
  cursor: grab;
}

:deep(.sortableRowHandle:active) {
  cursor: grabbing;
}

.editShell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.editFields {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 10px 0;
}

.editField {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.editFieldLabel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 12px;
  line-height: 1.4;
  width: 100%;
}

.editFieldLabelTitle {
  font-weight: 600;
  color: var(--fg);
}

.editFieldMonacoBtn {
  flex-shrink: 0;
  margin-left: auto;
}

.editFieldInput {
  width: 100%;
}

.editCheckRow {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: -15px;
}

.editCheck {
  font-size: 12px;
}

.editFooter {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.editFooterActions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
</style>
