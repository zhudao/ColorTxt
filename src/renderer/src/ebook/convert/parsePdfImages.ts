/**
 * 从 PDF 对象流抽取 XObject 插图，不走 getOperatorList。
 * 同一对象只解码一次；JPEG 原样写出，JPX/JBIG2 用 pdfjs image_decoders + wasm。
 */
import { Jbig2Image, JpxImage } from "pdfjs-dist/image_decoders/pdf.image_decoders.mjs";

export type PdfXObjectImage = {
  objNum: number;
  width: number;
  height: number;
  bpc: number;
  filter: string;
  imageMask: boolean;
  stream: Uint8Array;
  decodeParms: string;
  colorSpaceDict: string;
  channels: 1 | 3 | 4;
  jbig2Globals: Uint8Array | null;
  indexedHival: number;
  indexedPalette: Uint8Array | null;
};

export type PdfImageCatalog = {
  imagesByObj: Map<number, PdfXObjectImage>;
  imagesForPageObj: (pageObjNum: number) => PdfXObjectImage[];
};

type PdfObj = { dict: string; stream: Uint8Array | null };

export type DecodedPdfImage = {
  data: ArrayBuffer;
  ext: "jpg" | "png";
};

function extractBalanced(str: string, openAt: number): string | null {
  if (str.slice(openAt, openAt + 2) !== "<<") return null;
  let i = openAt + 2;
  let depth = 1;
  while (i < str.length) {
    if (str[i] === "<" && str[i + 1] === "<") {
      depth++;
      i += 2;
      continue;
    }
    if (str[i] === ">" && str[i + 1] === ">") {
      depth--;
      i += 2;
      if (depth === 0) return str.slice(openAt, i);
      continue;
    }
    i++;
  }
  return null;
}

function dictField(dict: string, name: string): string | { ref: number } | number | null {
  const re = new RegExp(`\\/${name}(?![A-Za-z])`);
  const m = re.exec(dict);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < dict.length && /\s/.test(dict[i]!)) i++;
  if (dict.startsWith("<<", i)) return extractBalanced(dict, i);
  const rest = dict.slice(i);
  const ref = rest.match(/^(\d+)\s+0\s+R/);
  if (ref) return { ref: Number(ref[1]) };
  const nameTok = rest.match(/^\/([^\s\/<>\[\]]+)/);
  if (nameTok) return `/${nameTok[1]}`;
  const num = rest.match(/^(\d+)/);
  if (num) return Number(num[1]);
  const arr = rest.match(/^\[/);
  if (arr) {
    let d = 0;
    let j = i;
    while (j < dict.length) {
      if (dict[j] === "[") d++;
      if (dict[j] === "]") {
        d--;
        if (d === 0) return dict.slice(i, j + 1);
      }
      j++;
    }
  }
  return rest.slice(0, 80);
}

function resolveDict(val: string | { ref: number } | number | null, objs: Map<number, PdfObj>): string {
  if (val && typeof val === "object" && "ref" in val) {
    return objs.get(val.ref)?.dict || "";
  }
  return typeof val === "string" ? val : "";
}

function nameRefMap(dictStr: string): Array<{ name: string; obj: number }> {
  const out: Array<{ name: string; obj: number }> = [];
  if (!dictStr) return out;
  const inner = dictStr.startsWith("<<") ? dictStr.slice(2, -2) : dictStr;
  const re = /\/([^\s\/<>\[\]]+)\s+(\d+)\s+0\s+R/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(inner))) {
    out.push({ name: mm[1]!, obj: Number(mm[2]) });
  }
  return out;
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const tryFmt = async (fmt: CompressionFormat) => {
    const ds = new DecompressionStream(fmt);
    const copy = data.slice();
    const out = await new Response(
      new Blob([
        copy.buffer.slice(
          copy.byteOffset,
          copy.byteOffset + copy.byteLength,
        ) as ArrayBuffer,
      ])
        .stream()
        .pipeThrough(ds),
    ).arrayBuffer();
    return new Uint8Array(out);
  };
  try {
    return await tryFmt("deflate");
  } catch {
    return tryFmt("deflate-raw");
  }
}

function filterName(dict: string): string {
  if (/JPXDecode/.test(dict)) return "JPX";
  if (/JBIG2Decode/.test(dict)) return "JBIG2";
  if (/DCTDecode/.test(dict)) return "JPEG";
  if (/CCITTFaxDecode/.test(dict)) return "CCITT";
  if (/FlateDecode/.test(dict)) return "Flate";
  return "";
}

function isImageDict(d: string): boolean {
  return /\/Subtype\s*\/Image/.test(d) || /\/Subtype\/Image/.test(d);
}

function isFormDict(d: string): boolean {
  return /\/Subtype\s*\/Form/.test(d) || /\/Subtype\/Form/.test(d);
}

export async function buildPdfImageCatalog(pdfBytes: Uint8Array): Promise<PdfImageCatalog> {
  const src = new TextDecoder("latin1").decode(pdfBytes);
  const objs = new Map<number, PdfObj>();
  const reObj = /(\d+)\s+(\d+)\s+obj\b/g;
  const starts: Array<{ num: number; at: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = reObj.exec(src))) {
    starts.push({ num: Number(m[1]), at: m.index + m[0].length });
  }
  starts.sort((a, b) => a.at - b.at);

  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i]!;
    const endHint = i + 1 < starts.length ? starts[i + 1]!.at : src.length;
    const chunk = src.slice(cur.at, Math.min(endHint, cur.at + 8_000_000));
    const endObj = chunk.search(/\bendobj\b/);
    const body = endObj >= 0 ? chunk.slice(0, endObj) : chunk.slice(0, 200_000);
    const streamAt = body.search(/\bstream\r?\n/);
    let dict = body;
    let stream: Uint8Array | null = null;
    if (streamAt >= 0) {
      dict = body.slice(0, streamAt);
      const after = body.slice(streamAt).match(/^stream\r?\n/);
      const streamStart =
        cur.at + streamAt + (after ? after[0].length : "stream\n".length);
      const lenM = dict.match(/\/Length\s+(\d+)/);
      const length = lenM ? Number(lenM[1]) : 0;
      if (length > 0) {
        stream = pdfBytes.subarray(streamStart, streamStart + length);
      }
    }
    objs.set(cur.num, { dict: dict.replace(/\s+/g, " ").trim(), stream });
  }

  for (const [, o] of objs) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) && !/\/Type\/ObjStm/.test(o.dict)) continue;
    if (!o.stream) continue;
    const nM = o.dict.match(/\/N\s+(\d+)/);
    const firstM = o.dict.match(/\/First\s+(\d+)/);
    if (!nM || !firstM) continue;
    const n = Number(nM[1]);
    const first = Number(firstM[1]);
    let inflated: Uint8Array;
    try {
      inflated = await inflateZlib(o.stream);
    } catch {
      continue;
    }
    const text = new TextDecoder("latin1").decode(inflated);
    const header = text.slice(0, first).trim().split(/\s+/);
    for (let i = 0; i < n; i++) {
      const objNum = Number(header[i * 2]);
      const offset = Number(header[i * 2 + 1]);
      if (!Number.isFinite(objNum) || !Number.isFinite(offset)) continue;
      const start = first + offset;
      const end =
        i + 1 < n ? first + Number(header[(i + 1) * 2 + 1]) : text.length;
      const body = text.slice(start, end).replace(/\s+/g, " ").trim();
      const prev = objs.get(objNum);
      if (!prev || !prev.dict || prev.dict.length < 8) {
        objs.set(objNum, { dict: body, stream: prev?.stream ?? null });
      } else if (prev.stream && !/\/Subtype/.test(prev.dict)) {
        prev.dict = body;
      }
    }
  }

  const imagesByObj = new Map<number, PdfXObjectImage>();
  for (const [num, o] of objs) {
    if (!isImageDict(o.dict) || !o.stream) continue;
    const w = o.dict.match(/\/Width\s+(\d+)/);
    const h = o.dict.match(/\/Height\s+(\d+)/);
    if (!w || !h) continue;
    const bpcM = o.dict.match(/\/BitsPerComponent\s+(\d+)/);
    const gRef = o.dict.match(/\/JBIG2Globals\s+(\d+)\s+0\s+R/);
    const cs = resolveDict(dictField(o.dict, "ColorSpace"), objs);
    const indexed = parseIndexedLookup(cs);
    imagesByObj.set(num, {
      objNum: num,
      width: Number(w[1]),
      height: Number(h[1]),
      bpc: bpcM ? Number(bpcM[1]) : 8,
      filter: filterName(o.dict),
      imageMask: /\/ImageMask\s*true/.test(o.dict) || /\/ImageMask true/.test(o.dict),
      stream: o.stream,
      decodeParms: resolveDict(dictField(o.dict, "DecodeParms"), objs),
      colorSpaceDict: cs,
      channels: channelsFromColorSpace(cs, objs),
      jbig2Globals: gRef ? objs.get(Number(gRef[1]))?.stream ?? null : null,
      indexedHival: indexed?.hival ?? -1,
      indexedPalette: indexed?.lookupHex ? hexToBytes(indexed.lookupHex) : null,
    });
    if (indexed?.lookupRef != null) {
      const pal = await streamBytes(objs.get(indexed.lookupRef));
      const rec = imagesByObj.get(num);
      if (rec && pal) rec.indexedPalette = pal;
    }
  }

  function collectFromResources(
    resDict: string,
    into: PdfXObjectImage[],
    seen: Set<number>,
  ): void {
    const xoField = dictField(resDict, "XObject");
    const xoDict = resolveDict(xoField, objs);
    for (const { obj } of nameRefMap(
      xoDict || (typeof xoField === "string" ? xoField : ""),
    )) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      const img = imagesByObj.get(obj);
      if (img) {
        into.push(img);
        continue;
      }
      const o = objs.get(obj);
      if (!o) continue;
      if (isFormDict(o.dict)) {
        const nested = dictField(o.dict, "Resources");
        collectFromResources(resolveDict(nested, objs) || o.dict, into, seen);
      }
    }
  }

  function imagesForPageObj(pageObjNum: number): PdfXObjectImage[] {
    const o = objs.get(pageObjNum);
    if (!o) return [];
    const r = dictField(o.dict, "Resources");
    const res = resolveDict(r, objs) || o.dict;
    const into: PdfXObjectImage[] = [];
    collectFromResources(res, into, new Set());
    return into;
  }

  return { imagesByObj, imagesForPageObj };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function undoPredictor(
  data: Uint8Array,
  columns: number,
  colors: number,
  bpc: number,
  predictor: number,
): Uint8Array {
  if (predictor <= 1) return data;
  const rowSize = Math.ceil((columns * colors * bpc) / 8);
  const bpp = Math.ceil((colors * bpc) / 8);
  if (predictor === 2) {
    const out = new Uint8Array(data.length);
    for (let y = 0; y < data.length / rowSize; y++) {
      const row = y * rowSize;
      for (let i = 0; i < rowSize; i++) {
        const left = i >= bpp ? out[row + i - bpp]! : 0;
        out[row + i] = (data[row + i]! + left) & 255;
      }
    }
    return out;
  }
  if (predictor < 10 || predictor > 15) return data;
  const rows = Math.floor(data.length / (rowSize + 1));
  const out = new Uint8Array(rows * rowSize);
  let src = 0;
  for (let y = 0; y < rows; y++) {
    const ft = data[src++]!;
    const dest = y * rowSize;
    const prev = y > 0 ? dest - rowSize : -1;
    for (let i = 0; i < rowSize; i++) {
      const x = data[src++]!;
      const a = i >= bpp ? out[dest + i - bpp]! : 0;
      const b = prev >= 0 ? out[prev + i]! : 0;
      const c = prev >= 0 && i >= bpp ? out[prev + i - bpp]! : 0;
      let v = x;
      if (ft === 1) v = (x + a) & 255;
      else if (ft === 2) v = (x + b) & 255;
      else if (ft === 3) v = (x + ((a + b) >> 1)) & 255;
      else if (ft === 4) v = (x + paeth(a, b, c)) & 255;
      out[dest + i] = v;
    }
  }
  return out;
}

function grayToRgba(src: Uint8Array, w: number, h: number): ImageData {
  const out = new Uint8ClampedArray(w * h * 4);
  const n = Math.min(src.length, w * h);
  for (let i = 0; i < n; i++) {
    const v = src[i]!;
    const j = i * 4;
    out[j] = out[j + 1] = out[j + 2] = v;
    out[j + 3] = 255;
  }
  return new ImageData(out, w, h);
}

function rgbToRgba(src: Uint8Array, w: number, h: number): ImageData {
  const out = new Uint8ClampedArray(w * h * 4);
  const px = w * h;
  let s = 0;
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    out[j] = src[s++] ?? 0;
    out[j + 1] = src[s++] ?? 0;
    out[j + 2] = src[s++] ?? 0;
    out[j + 3] = 255;
  }
  return new ImageData(out, w, h);
}

function cmykToRgba(src: Uint8Array, w: number, h: number): ImageData {
  const out = new Uint8ClampedArray(w * h * 4);
  const px = w * h;
  let s = 0;
  for (let i = 0; i < px; i++) {
    const c = src[s++]! / 255;
    const m = src[s++]! / 255;
    const y = src[s++]! / 255;
    const k = src[s++]! / 255;
    const j = i * 4;
    out[j] = Math.round(255 * (1 - c) * (1 - k));
    out[j + 1] = Math.round(255 * (1 - m) * (1 - k));
    out[j + 2] = Math.round(255 * (1 - y) * (1 - k));
    out[j + 3] = 255;
  }
  return new ImageData(out, w, h);
}

function packed1bppToRgba(src: Uint8Array, w: number, h: number): ImageData {
  const out = new Uint8ClampedArray(w * h * 4);
  const rowBytes = (w + 7) >> 3;
  let srcPos = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = src[srcPos + (x >> 3)] ?? 0;
      const v = (b >> (7 - (x & 7))) & 1 ? 255 : 0;
      const j = (y * w + x) * 4;
      out[j] = out[j + 1] = out[j + 2] = v;
      out[j + 3] = 255;
    }
    srcPos += rowBytes;
  }
  return new ImageData(out, w, h);
}

function unpackPackedSamples(
  src: Uint8Array,
  width: number,
  height: number,
  bpc: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  if (bpc === 8) {
    out.set(src.subarray(0, Math.min(src.length, out.length)));
    return out;
  }
  const rowBytes = Math.ceil((width * bpc) / 8);
  let o = 0;
  for (let y = 0; y < height; y++) {
    let bitPos = y * rowBytes * 8;
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let b = 0; b < bpc; b++) {
        const byteIndex = bitPos >> 3;
        const bit = 7 - (bitPos & 7);
        v = (v << 1) | (((src[byteIndex] ?? 0) >> bit) & 1);
        bitPos += 1;
      }
      out[o++] = v;
    }
  }
  return out;
}

function expandIndexedToRgba(
  indices: Uint8Array,
  w: number,
  h: number,
  palette: Uint8Array,
  hival: number,
): ImageData {
  const n = hival + 1;
  const ch = Math.max(1, Math.floor(palette.length / Math.max(1, n)));
  const out = new Uint8ClampedArray(w * h * 4);
  const px = w * h;
  for (let i = 0; i < px; i++) {
    const idx = Math.min(indices[i] ?? 0, hival);
    const o = i * 4;
    const p = idx * ch;
    if (ch >= 3) {
      out[o] = palette[p] ?? 0;
      out[o + 1] = palette[p + 1] ?? 0;
      out[o + 2] = palette[p + 2] ?? 0;
    } else {
      const v = palette[p] ?? 0;
      out[o] = out[o + 1] = out[o + 2] = v;
    }
    out[o + 3] = 255;
  }
  return new ImageData(out, w, h);
}

function skipPdfLiteralString(s: string, i: number): number {
  if (s[i] !== "(") return i;
  let depth = 1;
  i += 1;
  while (i < s.length && depth > 0) {
    const c = s[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    i += 1;
  }
  return i;
}

function skipPdfValue(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i += 1;
  if (i >= s.length) return i;
  const c = s[i]!;
  if (c === "[") {
    i += 1;
    let depth = 1;
    while (i < s.length && depth > 0) {
      const ch = s[i]!;
      if (ch === "(") {
        i = skipPdfLiteralString(s, i);
        continue;
      }
      if (ch === "<" && s[i + 1] === "<") {
        i = skipPdfValue(s, i);
        continue;
      }
      if (ch === "[") depth += 1;
      else if (ch === "]") depth -= 1;
      i += 1;
    }
    return i;
  }
  if (c === "<") {
    if (s[i + 1] === "<") {
      i += 2;
      let depth = 1;
      while (i < s.length && depth > 0) {
        if (s[i] === "<" && s[i + 1] === "<") {
          depth += 1;
          i += 2;
          continue;
        }
        if (s[i] === ">" && s[i + 1] === ">") {
          depth -= 1;
          i += 2;
          continue;
        }
        i += 1;
      }
      return i;
    }
    i += 1;
    while (i < s.length && s[i] !== ">") i += 1;
    return i < s.length ? i + 1 : i;
  }
  if (c === "(") return skipPdfLiteralString(s, i);
  if (c === "/") {
    i += 1;
    while (i < s.length && !/[\s\/<>\[\]()]/.test(s[i]!)) i += 1;
    return i;
  }
  const ref = s.slice(i).match(/^(\d+)\s+(\d+)\s+R/);
  if (ref) return i + ref[0].length;
  const num = s.slice(i).match(/^[+-]?(?:\d+\.?\d*|\.\d+)/);
  if (num) return i + num[0].length;
  if (s.startsWith("true", i) || s.startsWith("null", i)) return i + 4;
  if (s.startsWith("false", i)) return i + 5;
  return i + 1;
}

function parseIndexedLookup(
  cs: string,
): { hival: number; lookupRef: number | null; lookupHex: string | null } | null {
  const at = cs.search(/\/Indexed(?![A-Za-z])/);
  if (at < 0) return null;
  let i = skipPdfValue(cs, at + "/Indexed".length);
  while (i < cs.length && /\s/.test(cs[i]!)) i += 1;
  const hivalM = cs.slice(i).match(/^(\d+)/);
  if (!hivalM) return null;
  i += hivalM[0].length;
  while (i < cs.length && /\s/.test(cs[i]!)) i += 1;
  const refM = cs.slice(i).match(/^(\d+)\s+(\d+)\s+R/);
  if (refM) {
    return { hival: Number(hivalM[1]), lookupRef: Number(refM[1]), lookupHex: null };
  }
  if (cs[i] === "<" && cs[i + 1] !== "<") {
    const end = cs.indexOf(">", i + 1);
    if (end < 0) return null;
    return {
      hival: Number(hivalM[1]),
      lookupRef: null,
      lookupHex: cs.slice(i + 1, end).replace(/\s+/g, ""),
    };
  }
  return null;
}

function hexToBytes(hex: string): Uint8Array {
  const n = hex.length >> 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function streamBytes(o: PdfObj | undefined): Promise<Uint8Array | null> {
  if (!o?.stream) return null;
  if (/FlateDecode/.test(o.dict)) {
    try {
      return await inflateZlib(o.stream);
    } catch {
      return null;
    }
  }
  return o.stream;
}

function channelsFromColorSpace(cs: string, objs: Map<number, PdfObj>): 1 | 3 | 4 {
  if (/\/Indexed(?![A-Za-z])/.test(cs)) return 1;
  if (/DeviceGray|\/Gray/.test(cs)) return 1;
  if (/DeviceCMYK|\/CMYK/.test(cs)) return 4;
  if (/DeviceRGB|\/RGB/.test(cs)) return 3;
  const iccRef = cs.match(/ICCBased\s+(\d+)\s+0\s+R/);
  if (iccRef) {
    const icc = objs.get(Number(iccRef[1]))?.dict || "";
    const nM = icc.match(/\/N\s+(\d+)/);
    if (nM) {
      const n = Number(nM[1]);
      if (n === 1 || n === 3 || n === 4) return n;
    }
  }
  const nM = cs.match(/\/N\s+(\d+)/);
  if (nM) {
    const n = Number(nM[1]);
    if (n === 1 || n === 3 || n === 4) return n;
  }
  return 3;
}

function imageDataToPngBuffer(im: ImageData): Promise<ArrayBuffer | null> {
  const canvas = document.createElement("canvas");
  canvas.width = im.width;
  canvas.height = im.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.putImageData(im, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      void blob.arrayBuffer().then(resolve);
    }, "image/png");
  });
}

let wasmConfigured = false;

export function configurePdfImageDecoders(wasmUrl: string): void {
  if (wasmConfigured) return;
  JpxImage.setOptions({
    useWasm: true,
    useWorkerFetch: true,
    wasmUrl,
  });
  wasmConfigured = true;
}

export async function decodePdfXObjectImage(
  img: PdfXObjectImage,
): Promise<DecodedPdfImage | null> {
  if (img.width < 2 && img.height < 2) return null;
  /** 蒙版不是独立插图；单色 Indexed（hival=0）是铺底色块。 */
  if (img.imageMask) return null;
  if (img.indexedHival === 0) return null;
  try {
    if (img.filter === "JPEG") {
      const copy = img.stream.slice();
      return {
        data: copy.buffer.slice(
          copy.byteOffset,
          copy.byteOffset + copy.byteLength,
        ),
        ext: "jpg",
      };
    }
    if (img.filter === "JPX") {
      const rgba = await JpxImage.decode(img.stream, { numComponents: 0 });
      if (!rgba || rgba.length < 4) return null;
      const px = Math.floor(rgba.length / 4);
      const w = img.width;
      const h = w > 0 ? Math.max(1, Math.floor(px / w)) : img.height;
      const n = w * h * 4;
      const pixels = new Uint8ClampedArray(n);
      pixels.set(rgba.subarray(0, n));
      const im = new ImageData(pixels, w, h);
      const png = await imageDataToPngBuffer(im);
      return png ? { data: png, ext: "png" } : null;
    }
    if (img.filter === "JBIG2") {
      const decoder = new Jbig2Image();
      const packed = decoder.parseChunks(
        img.jbig2Globals
          ? [
              {
                data: img.jbig2Globals,
                start: 0,
                end: img.jbig2Globals.length,
              },
              { data: img.stream, start: 0, end: img.stream.length },
            ]
          : [{ data: img.stream, start: 0, end: img.stream.length }],
      ) as Uint8Array;
      if (!packed) return null;
      for (let i = 0; i < packed.length; i++) packed[i] ^= 0xff;
      const im = packed1bppToRgba(packed, img.width, img.height);
      const png = await imageDataToPngBuffer(im);
      return png ? { data: png, ext: "png" } : null;
    }

    let raw = img.stream;
    if (img.filter === "Flate") {
      raw = await inflateZlib(img.stream);
    }
    const predM = img.decodeParms.match(/\/Predictor\s+(\d+)/);
    const colorsM = img.decodeParms.match(/\/Colors\s+(\d+)/);
    const colsM = img.decodeParms.match(/\/Columns\s+(\d+)/);
    const predictor = predM ? Number(predM[1]) : 1;
    const isIndexed = Boolean(img.indexedPalette && img.indexedHival >= 0);
    const colors = isIndexed
      ? 1
      : colorsM
        ? Number(colorsM[1])
        : img.channels;
    const columns = colsM ? Number(colsM[1]) : img.width;
    if (predictor > 1) {
      raw = undoPredictor(raw, columns, colors, img.bpc, predictor);
    }

    let im: ImageData;
    if (isIndexed && img.indexedPalette) {
      const indices = unpackPackedSamples(raw, img.width, img.height, img.bpc);
      im = expandIndexedToRgba(
        indices,
        img.width,
        img.height,
        img.indexedPalette,
        img.indexedHival,
      );
    } else if (img.bpc === 1) {
      im = packed1bppToRgba(raw, img.width, img.height);
    } else if (colors === 4) {
      im = cmykToRgba(raw, img.width, img.height);
    } else if (colors === 3) {
      im = rgbToRgba(raw, img.width, img.height);
    } else {
      im = grayToRgba(raw, img.width, img.height);
    }
    const png = await imageDataToPngBuffer(im);
    return png ? { data: png, ext: "png" } : null;
  } catch {
    return null;
  }
}

export function allocPdfImageRelPath(
  imagesFolderRel: string,
  pageIndex: number,
  seq: number,
  ext: string,
  usedRelKeys: Set<string>,
): string {
  const stem = `p${pageIndex}_${seq}`;
  for (let n = 0; ; n += 1) {
    const fname = n === 0 ? `${stem}.${ext}` : `${stem}_${n}.${ext}`;
    const rel = `${imagesFolderRel}/${fname}`;
    if (!usedRelKeys.has(rel.toLowerCase())) {
      usedRelKeys.add(rel.toLowerCase());
      return rel;
    }
  }
}
