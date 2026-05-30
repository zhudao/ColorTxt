<script setup lang="ts">
import {
  appToastItems,
  dismissAppToast,
  type AppToastItem,
} from "../services/appToast";
import { icons } from "../icons";

function iconHtml(kind: AppToastItem["kind"]): string {
  switch (kind) {
    case "success":
      return icons.success;
    case "warning":
      return icons.warning;
    case "danger":
      return icons.fail;
    case "primary":
      return icons.info;
    case "info":
    default:
      return icons.info;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="appToastHost" aria-live="polite">
      <TransitionGroup name="appToast" tag="div" class="appToastStack">
        <div
          v-for="t in appToastItems"
          :key="t.id"
          class="appToastItem"
          :class="[
            `appToastItem--${t.kind}`,
            { 'appToastItem--closable': t.showClose },
          ]"
          role="status"
        >
          <span
            class="appToastIcon"
            aria-hidden="true"
            v-html="iconHtml(t.kind)"
          />
          <span class="appToastMsg">{{ t.message }}</span>
          <button
            v-if="t.showClose"
            type="button"
            class="appToastClose"
            aria-label="关闭"
            @click.stop="dismissAppToast(t.id)"
          >
            <span
              class="appToastCloseIcon"
              aria-hidden="true"
              v-html="icons.close"
            />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.appToastHost {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5998;
  display: flex;
  justify-content: center;
  padding: 12px 12px 0;
  pointer-events: none;
  box-sizing: border-box;
}

.appToastStack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.appToastItem {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  width: auto;
  max-width: min(480px, 100%);
  box-sizing: border-box;
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--control-bg);
  box-shadow:
    0 4px 18px color-mix(in srgb, var(--fg) 12%, transparent),
    0 0 1px color-mix(in srgb, var(--fg) 8%, transparent);
  border: 1px solid var(--border);
}

.appToastItem--closable {
  padding-right: 4px;
}

.appToastIcon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.appToastIcon :deep(svg) {
  width: 20px;
  height: 20px;
  display: block;
}

.appToastIcon :deep(svg path) {
  fill: currentColor;
}

.appToastMsg {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  padding-top: 3px;
  padding-bottom: 2px;
}

.appToastItem--closable .appToastMsg {
  flex: 1 1 auto;
}

.appToastClose {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  align-self: flex-start;
}

.appToastClose:hover {
  color: var(--fg);
}

.appToastCloseIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
}

.appToastCloseIcon :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}

.appToastCloseIcon :deep(svg path) {
  fill: currentColor;
}

.appToastItem--success {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
  background: var(--success-bg);
}

.appToastItem--warning {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 30%, transparent);
  background: var(--warning-bg);
}

.appToastItem--danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 30%, transparent);
  background: var(--danger-bg);
}

.appToastItem--primary {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 30%, transparent);
  background: var(--primary-bg);
}

.appToastItem--info {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 30%, transparent);
  background: var(--info-bg);
}

.appToastItem--success .appToastMsg,
.appToastItem--warning .appToastMsg,
.appToastItem--danger .appToastMsg,
.appToastItem--info .appToastMsg {
  color: inherit;
}

.appToast-enter-active,
.appToast-leave-active {
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease;
}

.appToast-enter-from,
.appToast-leave-to {
  opacity: 0;
  transform: translateY(-14px);
}

.appToast-move {
  transition: transform 0.24s ease;
}
</style>
