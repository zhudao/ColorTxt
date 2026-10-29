import {
  BUILTIN_DICTIONARY_IDS,
  type DictionarySettings,
  type ImportedDictionary,
} from "@shared/dictionaryTypes";
import { resolveDefaultDictionariesDirSync } from "../utils/defaultCacheDirs";

export const BUILTIN_DICTIONARY_LABELS: Record<string, string> = {
  [BUILTIN_DICTIONARY_IDS.wiktionary]: "Wiktionary",
  [BUILTIN_DICTIONARY_IDS.wikipedia]: "Wikipedia",
};

export const defaultDictionarySettings: DictionarySettings = {
  providerOrder: [
    BUILTIN_DICTIONARY_IDS.wiktionary,
    BUILTIN_DICTIONARY_IDS.wikipedia,
  ],
  providerEnabled: {
    [BUILTIN_DICTIONARY_IDS.wiktionary]: true,
    [BUILTIN_DICTIONARY_IDS.wikipedia]: true,
  },
  importedDictionaries: [],
  localCacheDir: "",
};

function isImportedDictionary(v: unknown): v is ImportedDictionary {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.kind === "string" &&
    typeof o.name === "string" &&
    typeof o.bundleDir === "string" &&
    typeof o.addedAt === "number" &&
    o.files != null &&
    typeof o.files === "object"
  );
}

export function dictionaryDisplayName(
  settings: DictionarySettings,
  providerId: string,
): string {
  if (BUILTIN_DICTIONARY_LABELS[providerId]) {
    return BUILTIN_DICTIONARY_LABELS[providerId];
  }
  const local = settings.importedDictionaries.find((d) => d.id === providerId);
  if (local) return local.name;
  return providerId;
}

export function mergeDictionarySettings(
  partial: Partial<DictionarySettings> | null | undefined,
): DictionarySettings {
  const imported = Array.isArray(partial?.importedDictionaries)
    ? partial.importedDictionaries.filter(isImportedDictionary)
    : [];

  const enabled: Record<string, boolean> = {
    ...defaultDictionarySettings.providerEnabled,
  };
  if (partial?.providerEnabled && typeof partial.providerEnabled === "object") {
    for (const [k, v] of Object.entries(partial.providerEnabled)) {
      if (typeof v === "boolean") enabled[k] = v;
    }
  }
  for (const d of imported) {
    if (enabled[d.id] === undefined) enabled[d.id] = true;
  }

  const builtinOrder = defaultDictionarySettings.providerOrder;
  const knownIds = new Set<string>([
    ...builtinOrder,
    ...imported.map((d) => d.id),
  ]);

  let order: string[];
  if (Array.isArray(partial?.providerOrder) && partial.providerOrder.length) {
    order = partial.providerOrder.filter(
      (id): id is string => typeof id === "string" && knownIds.has(id),
    );
    for (const id of knownIds) {
      if (!order.includes(id)) order.push(id);
    }
  } else {
    order = [...builtinOrder, ...imported.map((d) => d.id)];
  }

  return {
    providerOrder: order,
    providerEnabled: enabled,
    importedDictionaries: imported,
    localCacheDir: (() => {
      const raw =
        typeof partial?.localCacheDir === "string"
          ? partial.localCacheDir.trim()
          : "";
      return raw || resolveDefaultDictionariesDirSync();
    })(),
  };
}
