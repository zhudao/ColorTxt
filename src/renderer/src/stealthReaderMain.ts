import { createApp } from "vue";
import StealthReaderApp from "./StealthReaderApp.vue";
import { bootstrapSystemFontFacePins } from "./utils/systemFontCatalog";

void bootstrapSystemFontFacePins();
createApp(StealthReaderApp).mount("#app");
