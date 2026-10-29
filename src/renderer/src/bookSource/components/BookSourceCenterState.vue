<script setup lang="ts">
defineProps<{
  error?: boolean;
}>();
</script>

<template>
  <div
    class="bookSourceCenterState"
    :class="{ 'bookSourceCenterState--error': error }"
  >
    <slot />
  </div>
</template>

<style scoped>
.bookSourceCenterState {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  color: var(--muted);
  font-size: 14px;
}
.bookSourceCenterState--error {
  color: var(--danger);
  padding: 24px;
  text-align: center;
}
</style>
