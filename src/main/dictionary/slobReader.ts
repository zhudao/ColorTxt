/**
 * Slob v1 (Aard 2): zlib only. Magic !-1SLOB\\x1F.
 */
import { open as fsOpen } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import pako from "pako";

const utf8 = new TextDecoder("utf-8");
const MAGIC = Buffer.from([0x21, 0x2d, 0x31, 0x53, 0x4c, 0x4f, 0x42, 0x1f]);

export type SlobHeader = {
  encoding: string;
  compression: string;
  tags: Record<string, string>;
  contentTypes: string[];
  blobCount: number;
  storeOffset: number;
  fileSize: number;
  refsOffset: number;
};

export type SlobRef = {
  key: string;
  binIndex: number;
  itemIndex: number;
  fragment: string;
};

export type SlobBlob = {
  contentType: string;
  data: Buffer;
};

function readU32BE(b: Uint8Array, o: number): number {
  return (
    (((b[o]! << 24) >>> 0) |
      ((b[o + 1]! << 16) >>> 0) |
      ((b[o + 2]! << 8) >>> 0) |
      b[o + 3]!) >>>
    0
  );
}

function decodePascalText(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return utf8.decode(bytes.subarray(0, end));
}

const cmpAsciiCI = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

class ByteCursor {
  pos = 0;
  constructor(public readonly buf: Uint8Array) {}
  read(n: number): Uint8Array {
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  byte(): number {
    return this.buf[this.pos++]!;
  }
  u16(): number {
    const v = (this.buf[this.pos]! << 8) | this.buf[this.pos + 1]!;
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = readU32BE(this.buf, this.pos);
    this.pos += 4;
    return v;
  }
  u64(): number {
    const hi = readU32BE(this.buf, this.pos);
    const lo = readU32BE(this.buf, this.pos + 4);
    this.pos += 8;
    return hi * 0x1_0000_0000 + lo;
  }
  text(lenBytes: 1 | 2): string {
    const len = lenBytes === 1 ? this.byte() : this.u16();
    return decodePascalText(this.read(len));
  }
}

class LRU<K, V> {
  private readonly max: number;
  private readonly map = new Map<K, V>();
  constructor(max: number) {
    this.max = max;
  }
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value as K | undefined;
      if (first !== undefined) this.map.delete(first);
    }
  }
}

function unzlib(bytes: Uint8Array): Buffer {
  try {
    return inflateSync(Buffer.from(bytes));
  } catch {
    return Buffer.from(pako.inflate(bytes));
  }
}

async function readAt(
  fh: FileHandle,
  start: number,
  size: number,
): Promise<Buffer> {
  const buf = Buffer.alloc(size);
  const { bytesRead } = await fh.read(buf, 0, size, start);
  return buf.subarray(0, bytesRead);
}

export class SlobReader {
  header: SlobHeader = {
    encoding: "utf-8",
    compression: "",
    tags: {},
    contentTypes: [],
    blobCount: 0,
    storeOffset: 0,
    fileSize: 0,
    refsOffset: 0,
  };
  refCount = 0;

  private fh: FileHandle | null = null;
  private fileSize = 0;
  private refsDataOffset = 0;
  private refPositions: Float64Array = new Float64Array(0);
  private binCount = 0;
  private binDataOffset = 0;
  private binPositions: Float64Array = new Float64Array(0);
  private refCache = new LRU<number, SlobRef>(1024);
  private binCache = new LRU<
    number,
    { contentTypeIds: Uint8Array; raw: Buffer }
  >(16);

  async load(filePath: string): Promise<void> {
    this.fh = await fsOpen(filePath, "r");
    this.fileSize = (await this.fh.stat()).size;

    const head = await readAt(this.fh, 0, Math.min(this.fileSize, 64 * 1024));
    const c = new ByteCursor(head);
    const magic = c.read(MAGIC.length);
    for (let i = 0; i < MAGIC.length; i++) {
      if (magic[i] !== MAGIC[i]) throw new Error("Not a Slob file (bad magic)");
    }
    c.read(16); // uuid
    const encoding = c.text(1);
    if (encoding.toLowerCase() !== "utf-8") {
      throw new Error(`Unsupported Slob encoding: ${encoding}`);
    }
    const compression = c.text(1);
    const tagCount = c.byte();
    const tags: Record<string, string> = {};
    for (let i = 0; i < tagCount; i++) {
      const k = c.text(1);
      const v = c.text(1);
      tags[k] = v;
    }
    const ctCount = c.byte();
    const contentTypes: string[] = [];
    for (let i = 0; i < ctCount; i++) contentTypes.push(c.text(2));
    const blobCount = c.u32();
    const storeOffset = c.u64();
    const fileSize = c.u64();
    const refsOffset = c.pos;

    if (compression !== "zlib") {
      throw new Error(
        `Unsupported Slob compression "${compression}". v1 supports zlib only.`,
      );
    }
    if (fileSize !== this.fileSize) {
      throw new Error(
        `Slob file size mismatch: header says ${fileSize}, file is ${this.fileSize}`,
      );
    }

    this.header = {
      encoding,
      compression,
      tags,
      contentTypes,
      blobCount,
      storeOffset,
      fileSize,
      refsOffset,
    };

    const refsHeader = await readAt(this.fh, refsOffset, 4);
    this.refCount = readU32BE(refsHeader, 0);
    const refPosStart = refsOffset + 4;
    const refPosBytes = await readAt(this.fh, refPosStart, this.refCount * 8);
    this.refPositions = new Float64Array(this.refCount);
    for (let i = 0; i < this.refCount; i++) {
      const o = i * 8;
      const hi = readU32BE(refPosBytes, o);
      const lo = readU32BE(refPosBytes, o + 4);
      this.refPositions[i] = hi * 0x1_0000_0000 + lo;
    }
    this.refsDataOffset = refPosStart + this.refCount * 8;

    const storeHeader = await readAt(this.fh, storeOffset, 4);
    this.binCount = readU32BE(storeHeader, 0);
    const binPosStart = storeOffset + 4;
    const binPosBytes = await readAt(this.fh, binPosStart, this.binCount * 8);
    this.binPositions = new Float64Array(this.binCount);
    for (let i = 0; i < this.binCount; i++) {
      const o = i * 8;
      const hi = readU32BE(binPosBytes, o);
      const lo = readU32BE(binPosBytes, o + 4);
      this.binPositions[i] = hi * 0x1_0000_0000 + lo;
    }
    this.binDataOffset = binPosStart + this.binCount * 8;
  }

  private async decodeRef(i: number): Promise<SlobRef> {
    const cached = this.refCache.get(i);
    if (cached) return cached;
    if (!this.fh) throw new Error("slob not loaded");
    const start = this.refsDataOffset + this.refPositions[i]!;
    let slice = await readAt(
      this.fh,
      start,
      Math.min(4 * 1024, this.fileSize - start),
    );
    let pos = 0;
    const keyLen = (slice[pos]! << 8) | slice[pos + 1]!;
    pos += 2;
    if (pos + keyLen + 7 > slice.length) {
      const need = 2 + keyLen + 4 + 2 + 1 + 255;
      slice = await readAt(this.fh, start, Math.min(need, this.fileSize - start));
      pos = 2;
    }
    const keyBytes = slice.subarray(pos, pos + keyLen);
    pos += keyLen;
    const binIndex = readU32BE(slice, pos);
    pos += 4;
    const itemIndex = (slice[pos]! << 8) | slice[pos + 1]!;
    pos += 2;
    const fragLen = slice[pos]!;
    pos += 1;
    const fragment = decodePascalText(slice.subarray(pos, pos + fragLen));
    const ref: SlobRef = {
      key: decodePascalText(keyBytes),
      binIndex,
      itemIndex,
      fragment,
    };
    this.refCache.set(i, ref);
    return ref;
  }

  async findRef(word: string): Promise<SlobRef | undefined> {
    if (!this.refCount) return undefined;
    let lo = 0;
    let hi = this.refCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const r = await this.decodeRef(mid);
      const cmp = cmpAsciiCI(word, r.key);
      if (cmp === 0) return r;
      if (cmp > 0) lo = mid + 1;
      else hi = mid - 1;
    }
    const NEAR = 8;
    const wlo = Math.max(0, lo - NEAR);
    const whi = Math.min(this.refCount - 1, lo + NEAR);
    for (let i = wlo; i <= whi; i++) {
      const r = await this.decodeRef(i);
      if (cmpAsciiCI(word, r.key) === 0) return r;
    }
    return undefined;
  }

  private async getBin(
    binIndex: number,
  ): Promise<{ contentTypeIds: Uint8Array; raw: Buffer }> {
    const cached = this.binCache.get(binIndex);
    if (cached) return cached;
    if (!this.fh) throw new Error("slob not loaded");

    const start = this.binDataOffset + this.binPositions[binIndex]!;
    let headSlice = await readAt(
      this.fh,
      start,
      Math.min(4 * 1024, this.fileSize - start),
    );
    const binItemCount = readU32BE(headSlice, 0);
    if (4 + binItemCount + 4 > headSlice.length) {
      headSlice = await readAt(this.fh, start, 4 + binItemCount + 4);
    }
    const ctIds = headSlice.subarray(4, 4 + binItemCount);
    const compLen = readU32BE(headSlice, 4 + binItemCount);
    const compStart = start + 4 + binItemCount + 4;
    const comp = await readAt(this.fh, compStart, compLen);
    const raw = unzlib(comp);
    const out = { contentTypeIds: Buffer.from(ctIds), raw };
    this.binCache.set(binIndex, out);
    return out;
  }

  async readBlob(ref: SlobRef): Promise<SlobBlob> {
    const bin = await this.getBin(ref.binIndex);
    const itemCount = bin.contentTypeIds.length;
    if (ref.itemIndex >= itemCount) {
      throw new Error(
        `Slob item_index ${ref.itemIndex} out of range (bin has ${itemCount})`,
      );
    }
    const pos = readU32BE(bin.raw, ref.itemIndex * 4);
    const dataOffset = itemCount * 4;
    const itemStart = dataOffset + pos;
    const itemLen = readU32BE(bin.raw, itemStart);
    const data = bin.raw.subarray(itemStart + 4, itemStart + 4 + itemLen);
    const ctId = bin.contentTypeIds[ref.itemIndex]!;
    const contentType = this.header.contentTypes[ctId] ?? "";
    return { contentType, data: Buffer.from(data) };
  }

  async lookupText(word: string): Promise<string | undefined> {
    const ref = await this.findRef(word);
    if (!ref) return undefined;
    const blob = await this.readBlob(ref);
    return utf8.decode(blob.data);
  }
}

/** Probe compression before import; non-zlib => unsupported. */
export async function probeSlobCompression(
  filePath: string,
): Promise<{ compression: string; label?: string }> {
  const fh = await fsOpen(filePath, "r");
  try {
    const st = await fh.stat();
    const head = Buffer.alloc(Math.min(st.size, 64 * 1024));
    await fh.read(head, 0, head.length, 0);
    const c = new ByteCursor(head);
    const magic = c.read(MAGIC.length);
    for (let i = 0; i < MAGIC.length; i++) {
      if (magic[i] !== MAGIC[i]) throw new Error("Not a Slob file");
    }
    c.read(16);
    c.text(1);
    const compression = c.text(1);
    const tagCount = c.byte();
    const tags: Record<string, string> = {};
    for (let i = 0; i < tagCount; i++) {
      tags[c.text(1)] = c.text(1);
    }
    return { compression, label: tags["label"] || tags["title"] };
  } finally {
    await fh.close();
  }
}
