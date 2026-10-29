import { ipcMain } from "electron";
import {
  TRANSLATION_IPC,
  type TranslationRequest,
  type TranslationResponse,
} from "@shared/translationTypes";
import { translateText } from "./translateService";

export function registerTranslationIpcHandlers(): void {
  ipcMain.removeHandler(TRANSLATION_IPC.translate);
  ipcMain.handle(
    TRANSLATION_IPC.translate,
    async (_evt, raw: unknown): Promise<TranslationResponse> => {
      if (!raw || typeof raw !== "object") {
        return { ok: false, message: "Invalid request" };
      }
      try {
        const result = await translateText(raw as TranslationRequest);
        return JSON.parse(JSON.stringify(result)) as TranslationResponse;
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
}
