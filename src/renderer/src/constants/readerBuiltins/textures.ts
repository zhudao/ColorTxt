/**
 * 内置阅读区背景图目录（`src/renderer/public/reader-textures/`）。
 * 叠层默认值写在项的 `light` / `dark`；解析/持久化见 `readerBackground.ts`。
 * `url` 相对页面（勿写根路径 `/...`：打包后 `file://` 会指到盘符根）。
 */
import type { ReaderBackgroundLayerSettings } from "../readerBackground";

export const READER_BACKGROUND_NONE_ID = "none";

export type ReaderBuiltinTexture = {
  id: string;
  name: string;
  /** 相对页面的路径；空串表示无图（纯色）。展示/CSS/`fetch` 须先 `resolveBuiltinReaderTextureUrl`。 */
  url: string;
  /** 未写入自定义覆盖时的叠层；未写的一侧用全局默认。内置图叠层不可改。 */
  light?: ReaderBackgroundLayerSettings;
  dark?: ReaderBackgroundLayerSettings;
};

export const BUILTIN_READER_TEXTURES: readonly ReaderBuiltinTexture[] = [
  { id: READER_BACKGROUND_NONE_ID, name: "无", url: "" },
  {
    id: "paper",
    name: "素纸",
    url: "reader-textures/paper.jpg",
    light: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "multiply",
    },
    dark: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "soft-light",
    },
  },
  {
    id: "parchment",
    name: "羊皮纸",
    url: "reader-textures/parchment.jpg",
    light: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "darken",
    },
    dark: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "multiply",
    },
  },
  {
    id: "eye-green",
    name: "护眼",
    url: "reader-textures/eye-green.jpg",
    light: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "normal",
    },
    dark: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "multiply",
    },
  },
  {
    id: "plush-rug",
    name: "毛绒地毯",
    url: "reader-textures/plush-rug.jpg",
    light: {
      opacity: 0.6,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "multiply",
    },
    dark: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "soft-light",
    },
  },
  {
    id: "night-sky",
    name: "星空",
    url: "reader-textures/night-sky.jpg",
    light: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "overlay",
    },
    dark: {
      opacity: 1,
      size: "auto",
      position: "center center",
      repeat: true,
      blend: "normal",
    },
  },
  {
    id: "bamboo-grove",
    name: "墨竹",
    url: "reader-textures/bamboo-grove.jpg",
    light: {
      opacity: 1,
      size: "cover",
      position: "center bottom",
      repeat: false,
      blend: "multiply",
    },
    dark: {
      opacity: 1,
      size: "cover",
      position: "center bottom",
      repeat: false,
      blend: "multiply",
    },
  },
  {
    id: "plum-blossom",
    name: "雪梅",
    url: "reader-textures/plum-blossom.jpg",
    light: {
      opacity: 1,
      size: "cover",
      position: "center bottom",
      repeat: false,
      blend: "overlay",
    },
    dark: {
      opacity: 1,
      size: "cover",
      position: "center bottom",
      repeat: false,
      blend: "multiply",
    },
  },
];

/** 已下架的内置图 id；读入时当作「无」 */
export const RETIRED_BUILTIN_TEXTURE_IDS = new Set([
  "sand",
  "cardboard",
  "moon",
]);

const BUILTIN_ID_SET = new Set(BUILTIN_READER_TEXTURES.map((t) => t.id));

export function isBuiltinReaderTextureId(id: string): boolean {
  return BUILTIN_ID_SET.has(id);
}

export function getBuiltinReaderTexture(
  id: string,
): ReaderBuiltinTexture | undefined {
  return BUILTIN_READER_TEXTURES.find((t) => t.id === id);
}

/**
 * 把目录里的相对路径解析成当前页可加载的 URL。
 * 开发态是 http 源，打包后是 `file://.../index.html`（与 pdfjs 同源策略一致）。
 */
export function resolveBuiltinReaderTextureUrl(url: string): string {
  const rel = url.trim().replace(/^\//, "");
  if (!rel) return "";
  if (typeof document === "undefined") return rel;
  return new URL(rel, document.baseURI).href;
}
