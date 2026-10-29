<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from "vue";
import type { AiCustomSkill, AiSkillUserOverride } from "@shared/aiSkills";
import { BUILTIN_AI_SKILLS, effectiveBuiltinSkill, isPipelineOnlyBuiltinSkill } from "@shared/aiSkills";
import SettingsSkillEditModal, {
  type SkillEditModalMode,
} from "./SettingsSkillEditModal.vue";
import SwitchToggle from "./SwitchToggle.vue";
import { icons } from "../icons";
import { appConfirm } from "../services/appDialog";

const enabled = defineModel<Record<string, boolean>>("enabled", {
  required: true,
});
const overrides = defineModel<Record<string, AiSkillUserOverride>>(
  "overrides",
  { required: true },
);
const customSkills = defineModel<AiCustomSkill[]>("customSkills", {
  required: true,
});

const editOpen = ref(false);
const editMode = ref<SkillEditModalMode>("builtin");
const editInitialTitle = ref("");
const editInitialDescription = ref("");
const editInitialPrompt = ref("");
const editingBuiltinId = ref<string | null>(null);
const editingCustomId = ref<string | null>(null);

const skillsScrollAnchorEl = useTemplateRef<HTMLElement>(
  "skillsScrollAnchorEl",
);

function skillOn(id: string): boolean {
  return enabled.value[id] !== false;
}

function setSkill(id: string, on: boolean) {
  if (isPipelineOnlyBuiltinSkill(id)) return;
  enabled.value = { ...enabled.value, [id]: on };
}

const builtinCards = computed(() =>
  BUILTIN_AI_SKILLS.map((def) => {
    const ov = overrides.value[def.id];
    const eff = effectiveBuiltinSkill(def, ov);
    return {
      kind: "builtin" as const,
      id: def.id,
      title: def.title,
      description: eff.description,
      pipelineOnly: isPipelineOnlyBuiltinSkill(def.id),
    };
  }),
);

function openEditBuiltin(id: string) {
  const def = BUILTIN_AI_SKILLS.find((s) => s.id === id);
  if (!def) return;
  const eff = effectiveBuiltinSkill(def, overrides.value[id]);
  editingBuiltinId.value = id;
  editingCustomId.value = null;
  editMode.value = "builtin";
  editInitialTitle.value = def.title;
  editInitialDescription.value = eff.description;
  editInitialPrompt.value = eff.prompt;
  editOpen.value = true;
}

function openEditCustom(skill: AiCustomSkill) {
  editingBuiltinId.value = null;
  editingCustomId.value = skill.id;
  editMode.value = "custom";
  editInitialTitle.value = skill.title;
  editInitialDescription.value = skill.description;
  editInitialPrompt.value = skill.prompt;
  editOpen.value = true;
}

function openCreateSkill() {
  editingBuiltinId.value = null;
  editingCustomId.value = null;
  editMode.value = "create";
  editInitialTitle.value = "";
  editInitialDescription.value = "";
  editInitialPrompt.value = "";
  editOpen.value = true;
}

function onSkillModalSave(payload: {
  title: string;
  description: string;
  prompt: string;
}) {
  if (editMode.value === "builtin" && editingBuiltinId.value) {
    const id = editingBuiltinId.value;
    overrides.value = {
      ...overrides.value,
      [id]: { description: payload.description, prompt: payload.prompt },
    };
    return;
  }
  if (editMode.value === "custom" && editingCustomId.value) {
    const id = editingCustomId.value;
    customSkills.value = customSkills.value.map((s) =>
      s.id === id
        ? {
            ...s,
            title: payload.title,
            description: payload.description,
            prompt: payload.prompt,
          }
        : s,
    );
    return;
  }
  if (editMode.value === "create") {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    customSkills.value = [
      ...customSkills.value,
      {
        id,
        title: payload.title,
        description: payload.description,
        prompt: payload.prompt,
        createdAt,
      },
    ];
    enabled.value = { ...enabled.value, [id]: true };
    void nextTick(() => {
      requestAnimationFrame(() => {
        skillsScrollAnchorEl.value?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      });
    });
  }
}

async function deleteCustomSkill(skill: AiCustomSkill) {
  const ok = await appConfirm(
    `确定删除技能「${skill.title}」吗？此操作不可逆！`,
    "删除技能",
  );
  if (!ok) return;
  customSkills.value = customSkills.value.filter((s) => s.id !== skill.id);
  const nextEnabled = { ...enabled.value };
  delete nextEnabled[skill.id];
  enabled.value = nextEnabled;
  if (editingCustomId.value === skill.id) {
    editOpen.value = false;
    editingCustomId.value = null;
  }
}

defineExpose({
  openCreateSkill,
});
</script>

<template>
  <div class="settingsBody settingsBody--skills">
    <header class="skillsHeader">
      <p class="skillsTips">
        管理提示词技能（启用的技能会在「AI
        阅读助手」和「角色卡」中注册为工具，由模型按需调用）
      </p>
    </header>

    <div class="skillsGrid" role="list">
      <article
        v-for="card in builtinCards"
        :key="card.id"
        class="skillCard"
        role="listitem"
      >
        <div class="skillCardTop">
          <div class="skillCardTitleRow">
            <h3 class="skillCardTitle" :title="card.title">{{ card.title }}</h3>
            <span class="skillTag skillTag--builtin">内置</span>
          </div>
          <div class="skillCardActions">
            <button
              type="button"
              class="skillCardIconBtn"
              title="编辑"
              aria-label="编辑"
              @click="openEditBuiltin(card.id)"
            >
              <span class="svg" v-html="icons.edit" />
            </button>
            <SwitchToggle
              size="sm"
              :model-value="card.pipelineOnly ? false : skillOn(card.id)"
              :disabled="card.pipelineOnly"
              :ariaLabel="
                card.pipelineOnly
                  ? `${card.title}，仅编辑模式排版使用，不可在 AI 阅读助手中启用`
                  : `${card.title}，是否启用`
              "
              @update:model-value="setSkill(card.id, $event)"
            />
          </div>
        </div>
        <p class="skillCardDesc">{{ card.description }}</p>
      </article>

      <article
        v-for="skill in customSkills"
        :key="skill.id"
        class="skillCard"
        role="listitem"
      >
        <div class="skillCardTop">
          <div class="skillCardTitleRow">
            <h3 class="skillCardTitle" :title="skill.title">
              {{ skill.title }}
            </h3>
          </div>
          <div class="skillCardActions">
            <button
              type="button"
              class="skillCardIconBtn skillCardIconBtn--danger"
              title="删除"
              aria-label="删除"
              @click="deleteCustomSkill(skill)"
            >
              <span class="svg" v-html="icons.remove" />
            </button>
            <button
              type="button"
              class="skillCardIconBtn"
              title="编辑"
              aria-label="编辑"
              @click="openEditCustom(skill)"
            >
              <span class="svg" v-html="icons.edit" />
            </button>
            <SwitchToggle
              size="sm"
              :model-value="skillOn(skill.id)"
              :ariaLabel="`${skill.title}，是否启用`"
              @update:model-value="setSkill(skill.id, $event)"
            />
          </div>
        </div>
        <p class="skillCardDesc">{{ skill.description }}</p>
      </article>

      <div
        ref="skillsScrollAnchorEl"
        class="skillsScrollAnchor"
        aria-hidden="true"
      />
    </div>

    <SettingsSkillEditModal
      v-model="editOpen"
      :mode="editMode"
      :initial-title="editInitialTitle"
      :initial-description="editInitialDescription"
      :initial-prompt="editInitialPrompt"
      @save="onSkillModalSave"
    />
  </div>
</template>

<style scoped>
.settingsBody--skills {
  padding-left: 10px;
  padding-right: 10px;
  gap: 12px;
}

.skillsHeader {
  margin-bottom: 4px;
}

.skillsTips {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}

.skillsScrollAnchor {
  grid-column: 1 / -1;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.skillsGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 520px) {
  .skillsGrid {
    grid-template-columns: 1fr;
  }
}

.skillCard {
  box-sizing: border-box;
  padding: 12px 12px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.skillCardTop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.skillCardTitleRow {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px 8px;
  min-width: 0;
  flex: 1;
}

.skillCardTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
  line-height: 1.3;
  min-width: 0;
  /* 不占满整行，「内置」才能紧跟在省略后的技能名右侧 */
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skillCardActions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.skillCardIconBtn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.skillCardIconBtn:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}

.skillCardIconBtn--danger:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.skillCardIconBtn .svg :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
}

.skillCardIconBtn .svg :deep(svg path) {
  fill: currentColor;
}

.skillCardDesc {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
  min-height: 2em;
}

.skillTag {
  font-size: 11px;
  line-height: 1.2;
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
}

.skillTag--builtin {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--secondary);
}
</style>
