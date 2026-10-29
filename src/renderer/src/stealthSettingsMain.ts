import { createApp } from "vue";
import StealthSettingsApp from "./StealthSettingsApp.vue";
import "./style.css";
import "./styles/settingsPanel.css";
import { installEscapeBlurTextFieldListener } from "./utils/escapeBlurTextField";
import { bootstrapSystemFontFacePins } from "./utils/systemFontCatalog";

installEscapeBlurTextFieldListener();
void bootstrapSystemFontFacePins();
createApp(StealthSettingsApp).mount("#app");
