<script setup lang="ts">
import { computed } from "vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import { icons } from "../icons";

export type AiConfigProfileSelectItem = {
  id: string;
  listLabel: string;
};

const props = defineProps<{
  profiles: AiConfigProfileSelectItem[];
  editingId: string;
  /** 用户自定义方案名；空时触发器以 placeholder 展示服务商名 */
  displayName: string;
  /** 未命名时触发器 placeholder（当前方案服务商名） */
  placeholder: string;
  maxProfiles: number;
}>();

const emit = defineEmits<{
  "update:editingId": [id: string];
  add: [];
  rename: [];
  delete: [];
}>();

const selectListsEmpty: CustomSelectItem[] = [];

const scrollItems = computed((): CustomSelectItem[] =>
  props.profiles.map((p) => ({
    kind: "item",
    id: p.id,
    label: p.listLabel,
  })),
);

const canAdd = computed(() => props.profiles.length < props.maxProfiles);
const canDelete = computed(() => props.profiles.length > 1);

function onSelect(id: string) {
  emit("update:editingId", id);
}
</script>

<template>
  <div class="aiProfileToolbar">
    <span class="aiProfileToolbarLabel">当前方案</span>
    <div class="aiProfileToolbarMain">
      <AppCustomSelect
        class="aiProfileSelect"
        :model-value="editingId"
        :display-label="displayName"
        :placeholder="placeholder"
        :fixed-top-items="selectListsEmpty"
        :scroll-items="scrollItems"
        :fixed-bottom-items="selectListsEmpty"
        :scroll-max-height="280"
        ariaLabel="当前方案"
        @update:model-value="onSelect"
      />
      <div class="aiProfileToolbarActions">
        <button
          type="button"
          class="btn iconOnly"
          title="新建方案"
          aria-label="新建方案"
          :disabled="!canAdd"
          @click="emit('add')"
        >
          <span class="iconSvg" aria-hidden="true" v-html="icons.add" />
        </button>
        <button
          type="button"
          class="btn iconOnly"
          title="重命名"
          aria-label="重命名"
          @click="emit('rename')"
        >
          <span class="iconSvg" aria-hidden="true" v-html="icons.edit" />
        </button>
        <button
          type="button"
          class="btn danger iconOnly"
          title="删除当前方案"
          aria-label="删除当前方案"
          :disabled="!canDelete"
          @click="emit('delete')"
        >
          <span class="iconSvg" aria-hidden="true" v-html="icons.remove" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aiProfileToolbar {
  display: flex;
  align-items: baseline;
  gap: 16px;
  min-width: 0;
}

.aiProfileToolbarLabel {
  font-size: 14px;
  color: var(--fg);
  white-space: nowrap;
  flex: 1 1 30%;
  min-width: 30%;
}

.aiProfileToolbarMain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 65%;
  min-width: 0;
}

.aiProfileSelect {
  flex: 1 1 auto;
  min-width: 0;
}

.aiProfileToolbarActions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
}

.iconOnly {
  padding: 6px;
  flex-shrink: 0;
}

.iconSvg :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.iconSvg :deep(svg path) {
  fill: currentColor;
}
</style>
