import { ipcMain } from "electron";
import { convertTextOpenCc } from "./textConvertOpenCc";

const OPENCC_CONFIG_PATTERN = /^[a-z0-9_]+$/i;

export function registerTextConvertIpcHandlers() {
  ipcMain.handle("text-convert:opencc", (_evt, payload: unknown) => {
    const text =
      payload &&
      typeof payload === "object" &&
      "text" in payload &&
      typeof (payload as { text: unknown }).text === "string"
        ? (payload as { text: string }).text
        : "";
    const config =
      payload &&
      typeof payload === "object" &&
      "config" in payload &&
      typeof (payload as { config: unknown }).config === "string"
        ? (payload as { config: string }).config.trim()
        : "";
    if (!config || !OPENCC_CONFIG_PATTERN.test(config)) {
      throw new Error("无效的 OpenCC 配置");
    }
    return convertTextOpenCc(text, config);
  });
}
