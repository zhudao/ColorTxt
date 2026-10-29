import "monaco-editor/esm/nls.messages.zh-cn.js";
import { createApp } from "vue";
import FindBookWindow from "./FindBookWindow.vue";
import "./style.css";
import "./styles/settingsPanel.css";
import { installEscapeBlurTextFieldListener } from "./utils/escapeBlurTextField";
import { bootstrapSystemFontFacePins } from "./utils/systemFontCatalog";

installEscapeBlurTextFieldListener();
void bootstrapSystemFontFacePins();
createApp(FindBookWindow).mount("#app");
