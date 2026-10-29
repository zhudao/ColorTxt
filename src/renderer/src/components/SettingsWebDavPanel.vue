<script setup lang="ts">
import { computed, ref } from "vue";
import SwitchToggle from "./SwitchToggle.vue";
import AppConnectionTestButton from "./AppConnectionTestButton.vue";
import type { ConnectionTestResult } from "../composables/useConnectionTest";
import { buildWebDavAuth } from "../utils/webDavAuth";
import { appToast } from "../services/appToast";
import { icons } from "../icons";

const props = withDefaults(
  defineProps<{
    /** 主界面 / 找书窗口：启用说明文案不同 */
    context?: "main" | "findBook";
    draftWebDavEnabled: boolean;
    draftWebDavUrl: string;
    draftWebDavUsername: string;
    draftWebDavPassword: string;
    draftWebDavRemoteDir: string;
  }>(),
  { context: "main" },
);

const enableHint = computed(() =>
  props.context === "findBook"
    ? "在顶栏显示「WebDAV」入口，可分别上传/同步「书架」「书源」「设置」。"
    : "在侧栏显示「WebDAV」入口，可上传/同步「设置」和下载已上传的「书包」；<br />底栏「文件路径」菜单可上传/同步「书包」。",
);

defineEmits<{
  "update:draftWebDavEnabled": [v: boolean];
  "update:draftWebDavUrl": [v: string];
  "update:draftWebDavUsername": [v: string];
  "update:draftWebDavPassword": [v: string];
  "update:draftWebDavRemoteDir": [v: string];
}>();

const showPassword = ref(false);

const testFingerprint = computed(
  () =>
    [
      props.draftWebDavEnabled ? "1" : "0",
      props.draftWebDavUrl.trim(),
      props.draftWebDavUsername.trim(),
      props.draftWebDavPassword,
      props.draftWebDavRemoteDir.trim(),
    ].join("\0"),
);

async function runWebDavTest(): Promise<ConnectionTestResult | null> {
  const auth = buildWebDavAuth(
    {
      webDavEnabled: props.draftWebDavEnabled,
      webDavUrl: props.draftWebDavUrl,
      webDavUsername: props.draftWebDavUsername,
      webDavRemoteDir: props.draftWebDavRemoteDir,
    },
    props.draftWebDavPassword,
  );
  if (!auth) {
    appToast("请填写 WebDAV 地址与用户名", { kind: "warning" });
    return null;
  }
  try {
    const r = await window.colorTxt.webdav.test(auth);
    if (r.ok) {
      appToast("连接成功", { kind: "success" });
      return { ok: true };
    }
    appToast(r.error?.trim() || "连接失败", { kind: "danger" });
    return { ok: false, error: r.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appToast(msg, { kind: "danger" });
    return { ok: false, error: msg };
  }
}
</script>

<template>
  <div class="settingsWebDavRoot">
    <div class="settingsBody">
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">启用 WebDAV</span>
          <SwitchToggle
            :model-value="draftWebDavEnabled"
            aria-label="启用 WebDAV"
            @update:model-value="$emit('update:draftWebDavEnabled', $event)"
          />
        </div>
        <p class="settingsHint" v-html="enableHint"></p>
      </div>

      <template v-if="draftWebDavEnabled">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">服务器地址</span>
            <input
              class="settingsTextInput"
              type="text"
              :value="draftWebDavUrl"
              aria-label="WebDAV 服务器地址"
              placeholder="https://dav.jianguoyun.com/dav/"
              autocomplete="off"
              spellcheck="false"
              @input="
                $emit(
                  'update:draftWebDavUrl',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">用户名</span>
            <input
              class="settingsTextInput"
              type="text"
              :value="draftWebDavUsername"
              aria-label="WebDAV 用户名"
              autocomplete="off"
              spellcheck="false"
              @input="
                $emit(
                  'update:draftWebDavUsername',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">密码</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :value="draftWebDavPassword"
                  :type="showPassword ? 'text' : 'password'"
                  aria-label="WebDAV 密码"
                  autocomplete="new-password"
                  spellcheck="false"
                  @input="
                    $emit(
                      'update:draftWebDavPassword',
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :title="showPassword ? '隐藏' : '显示'"
                  @click="showPassword = !showPassword"
                >
                  <span
                    class="iconSvg"
                    v-html="showPassword ? icons.view : icons.viewOff"
                  />
                </button>
              </div>
            </div>
          </div>
          <p class="settingsHint">
            密码由系统钥匙串/凭据管理器加密保存，不会以明文写入配置文件。
          </p>
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">远端目录</span>
            <input
              class="settingsTextInput"
              type="text"
              :value="draftWebDavRemoteDir"
              aria-label="WebDAV 远端目录"
              placeholder="ColorTxt"
              autocomplete="off"
              spellcheck="false"
              @input="
                $emit(
                  'update:draftWebDavRemoteDir',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
          <p class="settingsHint">
            应用数据根目录名，默认 <code>ColorTxt</code>。
          </p>
        </div>
        
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">测试连接</span>
            <div class="aiRowField aiRowField--end">
              <AppConnectionTestButton
                label="测试连接"
                :fingerprint="testFingerprint"
                :on-test="runWebDavTest"
                :alert-on-error="false"
              />
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.settingsWebDavRoot {
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
  font-size: 14px;
  color: var(--fg);
  white-space: nowrap;
  flex: 1 1 60%;
}

.settingsLabel.short {
  flex: 1 1 30%;
  min-width: 30%;
}

.settingsTextInput {
  box-sizing: border-box;
  flex: 1 1 0;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  height: 32px;
  font-size: 13px;
}

.aiRowField {
  flex: 1 1 0;
  min-width: 0;
  max-width: 100%;
}

.aiRowField--end {
  display: flex;
  justify-content: flex-end;
}

.aiPasswordRow {
  width: 100%;
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

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.settingsHint code {
  font-size: 11px;
}
</style>
