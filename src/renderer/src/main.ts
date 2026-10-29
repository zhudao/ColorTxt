import "monaco-editor/esm/nls.messages.zh-cn.js";
import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import "./styles/settingsPanel.css";
import "./styles/characterCardHolo.css";
import "./styles/characterCardHoloEffects.css";
import { installEscapeBlurTextFieldListener } from "./utils/escapeBlurTextField";
import { bootstrapSystemFontFacePins } from "./utils/systemFontCatalog";

installEscapeBlurTextFieldListener();
void bootstrapSystemFontFacePins();
createApp(App).mount("#app");
