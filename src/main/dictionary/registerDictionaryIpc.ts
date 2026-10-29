/**
 * Dictionary IPC: lookup / import / remove.
 */
import { ipcMain } from "electron";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  DICTIONARY_IPC,
  type DictionaryImportRequest,
  type DictionaryImportResponse,
  type DictionaryLookupRequest,
  type DictionaryLookupResponse,
  type DictionaryRemoveRequest,
  type DictionaryRemoveResponse,
} from "@shared/dictionaryTypes";
import { importDictionaryBundles } from "./importBundles";
import {
  dropDictionaryCaches,
  lookup,
  syncDictionariesRoot,
} from "./dictionaryService";
import { clearMdictCache } from "./mdictReader";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function registerDictionaryIpcHandlers(): void {
  ipcMain.removeHandler(DICTIONARY_IPC.lookup);
  ipcMain.handle(
    DICTIONARY_IPC.lookup,
    async (_evt, raw: unknown): Promise<DictionaryLookupResponse> => {
      if (!raw || typeof raw !== "object") {
        return { ok: false, message: "Invalid request" };
      }
      try {
        const result = await lookup(raw as DictionaryLookupRequest);
        // Ensure IPC-safe plain JSON (no Buffer / class instances).
        return JSON.parse(JSON.stringify(result)) as DictionaryLookupResponse;
      } catch (e) {
        return { ok: false, message: errMsg(e) };
      }
    },
  );

  ipcMain.removeHandler(DICTIONARY_IPC.import);
  ipcMain.handle(
    DICTIONARY_IPC.import,
    async (_evt, raw: unknown): Promise<DictionaryImportResponse> => {
      if (!raw || typeof raw !== "object") {
        return { ok: false, message: "Invalid request" };
      }
      const req = raw as DictionaryImportRequest;
      const paths = Array.isArray(req.filePaths)
        ? req.filePaths.filter(
            (p): p is string => typeof p === "string" && !!p.trim(),
          )
        : [];
      if (!paths.length) {
        return { ok: false, message: "No files selected" };
      }
      try {
        const root = syncDictionariesRoot(req.localCacheDir);
        const { imported, orphanNames } = await importDictionaryBundles(
          root,
          paths,
        );
        if (!imported.length) {
          return {
            ok: false,
            message: orphanNames.length
              ? `Incomplete dictionary bundle (orphans: ${orphanNames.join(", ")})`
              : "No dictionary bundle recognized",
          };
        }
        return {
          ok: true,
          imported,
          orphanNames,
          message: orphanNames.length
            ? `Imported ${imported.length} dictionary(ies); unused files: ${orphanNames.join(", ")}`
            : undefined,
        };
      } catch (e) {
        return { ok: false, message: errMsg(e) };
      }
    },
  );

  ipcMain.removeHandler(DICTIONARY_IPC.remove);
  ipcMain.handle(
    DICTIONARY_IPC.remove,
    async (_evt, raw: unknown): Promise<DictionaryRemoveResponse> => {
      if (!raw || typeof raw !== "object") {
        return { ok: false, message: "Invalid request" };
      }
      const req = raw as DictionaryRemoveRequest;
      const id = typeof req.id === "string" ? req.id.trim() : "";
      const bundleDir =
        typeof req.bundleDir === "string" ? req.bundleDir.trim() : "";
      if (!id || !bundleDir) {
        return { ok: false, message: "Missing id or bundleDir" };
      }
      if (
        bundleDir.includes("..") ||
        path.isAbsolute(bundleDir) ||
        /[/\\]/.test(bundleDir)
      ) {
        return { ok: false, message: "Invalid bundleDir" };
      }
      try {
        const root = syncDictionariesRoot(req.localCacheDir);
        const dir = path.join(root, bundleDir);
        await rm(dir, { recursive: true, force: true });
        dropDictionaryCaches(id);
        clearMdictCache();
        return { ok: true };
      } catch (e) {
        return { ok: false, message: errMsg(e) };
      }
    },
  );
}
