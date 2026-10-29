/**
 * DictZip / raw .dict random-access reader.
 * Chunks end at Z_FULL_FLUSH (BFINAL=0); use streaming Inflate, not inflateSync.
 */
import { open as fsOpen, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import pako from "pako";

const GZIP_MAGIC0 = 0x1f;
const GZIP_MAGIC1 = 0x8b;

export type DictBody = {
  read(offset: number, size: number): Promise<Buffer>;
};

export type DictZipMeta = {
  chlen: number;
  chunkSizes: number[];
  compressedDataOffset: number;
};

function isGzip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 &&
    bytes[0] === GZIP_MAGIC0 &&
    bytes[1] === GZIP_MAGIC1
  );
}

/** ?? gzip FEXTRA ?? RA ????? RA ?? null? */
export function parseDictZipHeader(bytes: Uint8Array): DictZipMeta | null {
  if (
    bytes.length < 12 ||
    bytes[0] !== GZIP_MAGIC0 ||
    bytes[1] !== GZIP_MAGIC1 ||
    bytes[2] !== 0x08
  ) {
    return null;
  }
  const flg = bytes[3]!;
  if ((flg & 0b100) === 0) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const xlen = view.getUint16(10, true);
  let chlen = 0;
  let chcnt = 0;
  const chunkSizes: number[] = [];

  let p = 12;
  while (p + 4 <= 12 + xlen) {
    const si1 = bytes[p]!;
    const si2 = bytes[p + 1]!;
    const slen = view.getUint16(p + 2, true);
    if (si1 === 0x52 && si2 === 0x41) {
      const ver = view.getUint16(p + 4, true);
      if (ver !== 1) return null;
      chlen = view.getUint16(p + 6, true);
      chcnt = view.getUint16(p + 8, true);
      for (let i = 0; i < chcnt; i++) {
        chunkSizes.push(view.getUint16(p + 10 + 2 * i, true));
      }
    }
    p += 4 + slen;
  }
  if (chcnt === 0 || chunkSizes.length !== chcnt) return null;

  let offset = 12 + xlen;
  if (flg & 0b1000) {
    while (offset < bytes.length && bytes[offset] !== 0) offset++;
    offset++;
  }
  if (flg & 0b10000) {
    while (offset < bytes.length && bytes[offset] !== 0) offset++;
    offset++;
  }
  if (flg & 0b10) offset += 2;

  return { chlen, chunkSizes, compressedDataOffset: offset };
}

/** DictZip ???raw deflate + Z_FULL_FLUSH?windowBits=-15? */
export function inflateChunkStreaming(
  chunkBytes: Uint8Array,
): Uint8Array | null {
  try {
    const inf = new pako.Inflate({ windowBits: -15 });
    inf.push(chunkBytes, false);
    if (inf.err) return null;
    const result = inf.result;
    if (!result || (result as Uint8Array).length === 0) return null;
    return result instanceof Uint8Array
      ? result
      : new Uint8Array(result as unknown as ArrayBuffer);
  } catch {
    return null;
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

class BufferedDictBody implements DictBody {
  constructor(private readonly buf: Buffer) {}
  async read(offset: number, size: number): Promise<Buffer> {
    return this.buf.subarray(offset, offset + size);
  }
}

class DictZipChunkedDict implements DictBody {
  private readonly chunkOffsets: number[];
  private readonly chunkCache: LRU<number, Buffer>;

  constructor(
    private readonly fh: FileHandle,
    _fileSize: number,
    private readonly meta: DictZipMeta,
    cacheSize: number,
  ) {
    this.chunkCache = new LRU(cacheSize);
    const offsets: number[] = [];
    let acc = meta.compressedDataOffset;
    for (const cs of meta.chunkSizes) {
      offsets.push(acc);
      acc += cs;
    }
    this.chunkOffsets = offsets;
  }

  async read(offset: number, size: number): Promise<Buffer> {
    const chlen = this.meta.chlen;
    const startChunk = Math.floor(offset / chlen);
    const endChunk = Math.floor((offset + size - 1) / chlen);

    if (startChunk === endChunk) {
      const chunk = await this.getChunk(startChunk);
      const local = offset - startChunk * chlen;
      return chunk.subarray(local, local + size);
    }
    const parts: Buffer[] = [];
    for (let i = startChunk; i <= endChunk; i++) {
      parts.push(await this.getChunk(i));
    }
    const combined = Buffer.concat(parts);
    const local = offset - startChunk * chlen;
    return combined.subarray(local, local + size);
  }

  private async getChunk(i: number): Promise<Buffer> {
    const cached = this.chunkCache.get(i);
    if (cached) return cached;
    const start = this.chunkOffsets[i]!;
    const compressedSize = this.meta.chunkSizes[i]!;
    const buf = Buffer.alloc(compressedSize);
    const { bytesRead } = await this.fh.read(buf, 0, compressedSize, start);
    const compressed = buf.subarray(0, bytesRead);
    const inflated = inflateChunkStreaming(compressed);
    if (!inflated) throw new Error(`Failed to inflate DictZip chunk ${i}`);
    const out = Buffer.from(inflated);
    this.chunkCache.set(i, out);
    return out;
  }
}

async function probeChunkInflate(
  fh: FileHandle,
  meta: DictZipMeta,
): Promise<boolean> {
  if (meta.chunkSizes.length === 0) return false;
  const cs = meta.chunkSizes[0]!;
  const start = meta.compressedDataOffset;
  const buf = Buffer.alloc(cs);
  const { bytesRead } = await fh.read(buf, 0, cs, start);
  const inflated = inflateChunkStreaming(buf.subarray(0, bytesRead));
  return !!inflated && inflated.length > 0 && inflated.length <= meta.chlen;
}

function gunzipTolerant(bytes: Buffer): Buffer {
  try {
    return gunzipSync(bytes);
  } catch {
    // ???? gzip CRC ???pako ???
    return Buffer.from(pako.ungzip(bytes));
  }
}

export type LoadDictBodyOpts = {
  chunkCacheSize?: number;
};

/**
 * ?? `.dict` / `.dict.dz`??? DictZip ???????? gunzip ????
 */
export async function loadDictBody(
  filePath: string,
  opts: LoadDictBodyOpts = {},
): Promise<DictBody> {
  const cacheSize = opts.chunkCacheSize ?? 16;
  const fh = await fsOpen(filePath, "r");
  try {
    const st = await fh.stat();
    const headLen = Math.min(st.size, 64 * 1024);
    const head = Buffer.alloc(headLen);
    await fh.read(head, 0, headLen, 0);

    if (isGzip(head)) {
      const meta = parseDictZipHeader(head);
      if (meta && (await probeChunkInflate(fh, meta))) {
        // ?????? fh???????
        return new DictZipChunkedDict(fh, st.size, meta, cacheSize);
      }
      await fh.close();
      const all = await readFile(filePath);
      return new BufferedDictBody(gunzipTolerant(all));
    }

    await fh.close();
    return new BufferedDictBody(await readFile(filePath));
  } catch (e) {
    try {
      await fh.close();
    } catch {
      // ignore
    }
    throw e;
  }
}
