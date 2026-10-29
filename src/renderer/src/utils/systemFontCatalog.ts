import {
  buildCollapsedSystemFonts,
  buildListedSystemFonts,
  buildSystemFontFaceCss,
  familyNamesToRawFaces,
  listedFontNeedsFacePin,
  type ListedSystemFont,
  type RawSystemFontFace,
} from "@shared/systemFontFace";
import { systemFontFacePinsKey } from "../constants/appUi";

const STYLE_ID = "colortxt-system-font-faces";

export type SystemFontCatalog = {
  /** 不拆同族多字重；单字重族文案可带细体/中等等后缀 */
  families: ListedSystemFont[];
  /** 按字重拆开 */
  byWeight: ListedSystemFont[];
};

type CachedFontPin = {
  locals: string[];
  filePath?: string;
};

let rawFacesPromise: Promise<RawSystemFontFace[]> | null = null;
/** raw 已成功构建出的目录；raw 不变时直接复用，避免重复 build / 重装 CSS */
let cachedCatalog: SystemFontCatalog | null = null;
let markReady: (() => void) | null = null;
const readyPromise = new Promise<void>((resolve) => {
  markReady = resolve;
});
const installedPinFamilies = new Set<string>();

function resolveReady(): void {
  markReady?.();
  markReady = null;
}

function ensureStyleEl(): HTMLStyleElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
}

function installFaceCss(css: string): void {
  const el = ensureStyleEl();
  if (!el || !css) return;
  el.textContent = css;
}

function appendFaceCss(css: string): void {
  const el = ensureStyleEl();
  if (!el || !css) return;
  el.textContent = `${el.textContent ?? ""}\n${css}`;
}

function readPinCache(): Record<string, CachedFontPin> {
  try {
    const raw = localStorage.getItem(systemFontFacePinsKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, CachedFontPin> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!key.trim() || !value || typeof value !== "object") continue;
      const locals = (value as CachedFontPin).locals;
      if (!Array.isArray(locals)) continue;
      const filePath = (value as CachedFontPin).filePath;
      out[key] = {
        locals: locals.filter((n): n is string => typeof n === "string"),
        ...(typeof filePath === "string" && filePath.trim()
          ? { filePath: filePath.trim() }
          : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writePinCache(cache: Record<string, CachedFontPin>): void {
  try {
    localStorage.setItem(systemFontFacePinsKey, JSON.stringify(cache));
  } catch {
    /* ignore quota / private mode */
  }
}

function rememberPin(font: ListedSystemFont): void {
  if (!listedFontNeedsFacePin(font)) return;
  const cache = readPinCache();
  cache[font.cssFamily] = {
    locals: [...font.locals],
    ...(font.filePath?.trim() ? { filePath: font.filePath.trim() } : {}),
  };
  writePinCache(cache);
}

function rememberPins(fonts: readonly ListedSystemFont[]): void {
  const cache = readPinCache();
  let changed = false;
  for (const font of fonts) {
    if (!listedFontNeedsFacePin(font)) continue;
    cache[font.cssFamily] = {
      locals: [...font.locals],
      ...(font.filePath?.trim() ? { filePath: font.filePath.trim() } : {}),
    };
    changed = true;
  }
  if (changed) writePinCache(cache);
}

function listedFromCachedPin(
  cssFamily: string,
  pin: CachedFontPin,
  fileUrl?: string,
): ListedSystemFont {
  return {
    label: cssFamily,
    family: cssFamily,
    previewFamily: cssFamily,
    previewWeight: 400,
    previewItalic: false,
    cssFamily,
    locals: pin.locals,
    ...(fileUrl ? { fileUrl } : {}),
    ...(pin.filePath ? { filePath: pin.filePath } : {}),
  };
}

async function restorePinsFromCache(): Promise<void> {
  const cache = readPinCache();
  const entries = Object.entries(cache);
  if (entries.length === 0) return;

  const paths = [
    ...new Set(
      entries
        .map(([, pin]) => pin.filePath?.trim())
        .filter((p): p is string => Boolean(p)),
    ),
  ];
  let pathToUrl: Record<string, string> = {};
  const registerFn = window.colorTxt?.registerFontFilePaths;
  if (paths.length > 0 && typeof registerFn === "function") {
    try {
      pathToUrl = (await registerFn(paths)) ?? {};
    } catch (err) {
      console.warn("[fonts] re-register pin file paths failed", err);
    }
  }

  const fonts: ListedSystemFont[] = [];
  for (const [cssFamily, pin] of entries) {
    const fileUrl = pin.filePath ? pathToUrl[pin.filePath] : undefined;
    fonts.push(listedFromCachedPin(cssFamily, pin, fileUrl));
  }
  const css = buildSystemFontFaceCss(fonts);
  if (css) {
    installFaceCss(css);
    for (const font of fonts) {
      if (listedFontNeedsFacePin(font)) {
        installedPinFamilies.add(font.cssFamily);
      }
    }
  }
}

function asRawFaces(raw: unknown): RawSystemFontFace[] {
  if (!Array.isArray(raw)) return [];
  const faces: RawSystemFontFace[] = [];
  const legacyNames: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      legacyNames.push(item);
      continue;
    }
    if (
      item &&
      typeof item === "object" &&
      typeof (item as RawSystemFontFace).family === "string"
    ) {
      faces.push(item as RawSystemFontFace);
    }
  }
  if (faces.length > 0) return faces;
  return familyNamesToRawFaces(legacyNames);
}

async function loadRawFaces(force = false): Promise<RawSystemFontFace[]> {
  const listFn = window.colorTxt?.listSystemFonts;
  if (typeof listFn !== "function") return [];
  return asRawFaces(await listFn(force ? { force: true } : undefined));
}

function ensureRawFaces(): Promise<RawSystemFontFace[]> {
  if (!rawFacesPromise) {
    rawFacesPromise = loadRawFaces(false)
      .catch((err) => {
        console.warn("[fonts] system font catalog failed", err);
        return [] as RawSystemFontFace[];
      })
      .finally(() => {
        resolveReady();
      });
  }
  return rawFacesPromise;
}

function buildCatalogFromRaw(raw: RawSystemFontFace[]): SystemFontCatalog {
  if (raw.length === 0) {
    cachedCatalog = { families: [], byWeight: [] };
    return cachedCatalog;
  }
  const collapsed = buildCollapsedSystemFonts(raw);
  const byWeightListed = buildListedSystemFonts(raw);
  const pinFonts = [...collapsed, ...byWeightListed].filter(
    listedFontNeedsFacePin,
  );
  installedPinFamilies.clear();
  for (const font of pinFonts) installedPinFamilies.add(font.cssFamily);
  installFaceCss(buildSystemFontFaceCss(pinFonts));
  rememberPins(pinFonts);
  cachedCatalog = {
    families: collapsed,
    byWeight: byWeightListed,
  };
  return cachedCatalog;
}

/**
 * 启动用：只从 pin 缓存恢复 @font-face（必要时重注册本地路径），
 * 不枚举全系统字体。打开字体列表时再走 {@link ensureSystemFontCatalog}。
 */
export async function bootstrapSystemFontFacePins(): Promise<void> {
  try {
    await restorePinsFromCache();
  } catch (err) {
    console.warn("[fonts] bootstrap font face pins failed", err);
  } finally {
    resolveReady();
  }
}

/** 已构建的目录快照（未加载则为 null）。 */
export function peekSystemFontCatalog(): SystemFontCatalog | null {
  return cachedCatalog;
}

/** 枚举系统字体；仅为需要锁字重的别名注入 @font-face。 */
export async function ensureSystemFontCatalog(): Promise<SystemFontCatalog> {
  if (cachedCatalog) return cachedCatalog;
  const raw = await ensureRawFaces();
  return buildCatalogFromRaw(raw);
}

/** 强制重新枚举系统字体（清主进程与渲染进程缓存）。 */
export async function refreshSystemFontCatalog(): Promise<SystemFontCatalog> {
  cachedCatalog = null;
  rawFacesPromise = loadRawFaces(true)
    .catch((err) => {
      console.warn("[fonts] system font catalog refresh failed", err);
      return [] as RawSystemFontFace[];
    })
    .finally(() => {
      resolveReady();
    });
  const raw = await rawFacesPromise;
  return buildCatalogFromRaw(raw);
}

/** 选中某项时确保其别名 @font-face 已注入（幂等），并写入 pin 缓存。 */
export function ensureListedFontFacePinned(font: ListedSystemFont): void {
  if (!listedFontNeedsFacePin(font)) return;
  rememberPin(font);
  if (installedPinFamilies.has(font.cssFamily)) return;
  const css = buildSystemFontFaceCss([font]);
  if (!css) return;
  appendFaceCss(css);
  installedPinFamilies.add(font.cssFamily);
}

/**
 * 字重 @font-face 已尝试就绪（启动 bootstrap 或首次全量枚举结束都会 resolve）。
 * 不再在调用时触发全量枚举。
 */
export function whenSystemFontFacesReady(): Promise<void> {
  return readyPromise;
}
