<script setup lang="ts">
import AppModal from "../../components/AppModal.vue";
import { APP_DISPLAY_NAME } from "../../constants/appUi";

const modelValue = defineModel<boolean>({ default: false });

const appName = APP_DISPLAY_NAME;

const paragraphs = [
  `「${appName}找书」支持接入用户自行导入的 Legado（阅读）兼容书源，用于搜索、试读网络文学作品，旨在为广大文学爱好者提供方便、快捷、舒适的阅读体验。`,
  [
    `书源由用户自行编辑、导入、启用与管理。`,
    `「${appName}」不提供、不内置、不分发任何书源，亦不对书源的可用性、合法性、安全性或内容作任何背书。`,
    `因书源规则或其 JavaScript 脚本引发的任何问题，由用户自行承担。`,
  ],
  `当您通过「找书」功能搜索一本书时，「${appName}」会基于您所设置的书源规则将关键词提交给各第三方网络文学网站。`,
  [
    `第三方网站返回的内容与「${appName}」无关，「${appName}」对其概不负责，亦不承担任何法律责任。`,
    `任何通过「${appName}」链接或跳转访问的第三方网页均系他人制作或提供，您可能从第三方网页上获得其他服务，「${appName}」对其合法性概不负责，亦不承担任何法律责任。`,
    `第三方搜索结果是根据您提交的信息自动返回并提供试读，不代表「${appName}」赞成被链接网页的内容或立场，您应自行承担使用搜索结果的风险。`,
  ],
  `「${appName}」不做任何形式的保证：`,
  [
    `不保证第三方搜索引擎的搜索结果满足您的要求。`,
    `不保证搜索服务不中断。`,
    `不保证搜索结果的安全性、正确性、及时性、合法性。`,
  ],
  `「${appName}找书」致力于减少读者在自行搜寻、整理章节过程中的无效时间消耗，并在一定程度上促进优秀网络文学的传播。`,
  [
    `我们鼓励读者通过正规渠道支持作者与正版。`,
    `任何单位或个人认为通过用户自制书源搜索或链接到的第三方网页内容可能涉嫌侵犯其信息网络传播权，应及时向我们提出书面权利通知，并提供身份证明、权属证明及详细侵权情况证明。「${appName}」在收到上述法律文件后，将依法配合处理；书源存储于用户本地，相关书源的删除或停用须由用户自行完成。`,
  ],
];

function close() {
  modelValue.value = false;
}
</script>

<template>
  <AppModal v-model="modelValue" title="免责声明" max-width="560px">
    <div class="disclaimerBody">
      <ul class="disclaimerList">
        <li v-for="(text, index) in paragraphs" :key="index">
          <template v-if="Array.isArray(text)">
            <ul class="disclaimerList">
              <li v-for="(item, index) in text" :key="index">{{ item }}</li>
            </ul>
          </template>
          <template v-else>{{ text }}</template>
        </li>
      </ul>
    </div>
    <template #footer>
      <div class="disclaimerActions">
        <button class="btn" type="button" size="large" @click="close">
          关闭
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.disclaimerBody {
  padding-top: 10px;
}
.disclaimerList {
  margin: 0;
  padding-left: 1.25em;
  font-size: 13px;
  line-height: 1.6;
  color: var(--fg);
  user-select: text;
}

.disclaimerList li + li {
  margin-top: 12px;
}

.disclaimerList li:has(ul) {
  list-style-type: none;
}

.disclaimerList ul {
  margin: 0;
  padding-left: 1.25em;
}

.disclaimerActions {
  display: flex;
  justify-content: flex-end;
}
</style>
