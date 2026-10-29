import type { FileFilter, OpenDialogOptions, SaveDialogOptions } from "electron";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const OPEN_DIALOG_PROPERTIES = new Set<string>([
  "openFile",
  "openDirectory",
  "multiSelections",
  "showHiddenFiles",
  "createDirectory",
  "promptToCreate",
  "noResolveAliases",
  "treatPackageAsDirectory",
  "dontAddToRecent",
]);

const SAVE_DIALOG_PROPERTIES = new Set<string>([
  "showHiddenFiles",
  "createDirectory",
  "treatPackageAsDirectory",
  "showOverwriteConfirmation",
  "dontAddToRecent",
]);

const MAX_FILTERS = 40;
const MAX_FILTER_NAME_LEN = 200;
const MAX_EXTENSIONS_PER_FILTER = 200;
const MAX_EXT_TOKEN_LEN = 32;

function sanitizeFilters(raw: unknown): FileFilter[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: FileFilter[] = [];
  for (let i = 0; i < Math.min(raw.length, MAX_FILTERS); i++) {
    const item = raw[i];
    if (!isPlainObject(item)) continue;
    const name =
      typeof item.name === "string"
        ? item.name.slice(0, MAX_FILTER_NAME_LEN)
        : "";
    if (!name.trim()) continue;
    if (!Array.isArray(item.extensions)) continue;
    const extensions: string[] = [];
    for (const ext of item.extensions) {
      if (typeof ext !== "string") continue;
      const raw = ext.trim().replace(/^\./, "").toLowerCase();
      if (raw === "*") {
        extensions.push("*");
        if (extensions.length >= MAX_EXTENSIONS_PER_FILTER) break;
        continue;
      }
      const t = raw.replace(/[^a-z0-9_-]/g, "");
      if (!t || t.length > MAX_EXT_TOKEN_LEN) continue;
      extensions.push(t);
      if (extensions.length >= MAX_EXTENSIONS_PER_FILTER) break;
    }
    if (extensions.length === 0) continue;
    out.push({ name: name.trim(), extensions });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeStringProp(
  o: Record<string, unknown>,
  key: string,
  maxLen: number,
): string | undefined {
  const v = o[key];
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizeOpenProperties(
  raw: unknown,
): OpenDialogOptions["properties"] {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== "string" || !OPEN_DIALOG_PROPERTIES.has(p)) continue;
    if (!out.includes(p)) out.push(p);
    if (out.length >= 16) break;
  }
  return out.length > 0
    ? (out as OpenDialogOptions["properties"])
    : undefined;
}

function sanitizeSaveProperties(
  raw: unknown,
): SaveDialogOptions["properties"] {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== "string" || !SAVE_DIALOG_PROPERTIES.has(p)) continue;
    if (!out.includes(p)) out.push(p);
    if (out.length >= 16) break;
  }
  return out.length > 0
    ? (out as SaveDialogOptions["properties"])
    : undefined;
}

export function parseShowOpenDialogOptions(raw: unknown): OpenDialogOptions {
  if (!isPlainObject(raw)) {
    throw new TypeError("showOpenDialog: options must be a plain object");
  }
  const out: OpenDialogOptions = {};
  const t = sanitizeStringProp(raw, "title", 500);
  if (t) out.title = t;
  const dp = sanitizeStringProp(raw, "defaultPath", 4096);
  if (dp) out.defaultPath = dp;
  const bl = sanitizeStringProp(raw, "buttonLabel", 200);
  if (bl) out.buttonLabel = bl;
  const msg = sanitizeStringProp(raw, "message", 2000);
  if (msg) out.message = msg;
  const filters = sanitizeFilters(raw.filters);
  if (filters) out.filters = filters;
  const props = sanitizeOpenProperties(raw.properties);
  if (props) out.properties = props;
  if (raw.securityScopedBookmarks === true) out.securityScopedBookmarks = true;
  return out;
}

export function parseShowSaveDialogOptions(raw: unknown): SaveDialogOptions {
  if (!isPlainObject(raw)) {
    throw new TypeError("showSaveDialog: options must be a plain object");
  }
  const out: SaveDialogOptions = {};
  const t = sanitizeStringProp(raw, "title", 500);
  if (t) out.title = t;
  const dp = sanitizeStringProp(raw, "defaultPath", 4096);
  if (dp) out.defaultPath = dp;
  const bl = sanitizeStringProp(raw, "buttonLabel", 200);
  if (bl) out.buttonLabel = bl;
  const msg = sanitizeStringProp(raw, "message", 2000);
  if (msg) out.message = msg;
  const nfl = sanitizeStringProp(raw, "nameFieldLabel", 200);
  if (nfl) out.nameFieldLabel = nfl;
  if (typeof raw.showsTagField === "boolean") out.showsTagField = raw.showsTagField;
  const filters = sanitizeFilters(raw.filters);
  if (filters) out.filters = filters;
  const props = sanitizeSaveProperties(raw.properties);
  if (props) out.properties = props;
  if (raw.securityScopedBookmarks === true) out.securityScopedBookmarks = true;
  return out;
}
