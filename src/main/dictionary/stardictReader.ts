/**
 * StarDict: .ifo + .idx + .dict(.dz), optional .syn; offsets sidecar SDOF.
 */
import { open as fsOpen, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { loadDictBody, type DictBody } from "./dictZip";

export type StarDictEntry = {
  word: string;
  offset: number;
  size: number;
};

const decoder = new TextDecoder("utf-8");

export function parseIfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Scan .idx/.syn for entry start offsets. payloadBytes: idx=8, syn=4. */
export function scanEntryOffsets(
  bytes: Uint8Array,
  payloadBytes: number,
): Int32Array {
  const offsets: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    offsets.push(i);
    while (i < bytes.length && bytes[i] !== 0) i++;
    if (i >= bytes.length) break;
    i += 1 + payloadBytes;
  }
  return new Int32Array(offsets);
}

const SIDECAR_MAGIC = [0x53, 0x44, 0x4f, 0x46]; // SDOF
const SIDECAR_VERSION = 1;
const SIDECAR_HEADER_SIZE = 8;

export function serializeOffsetsSidecar(offsets: Int32Array): Buffer {
  const out = Buffer.alloc(SIDECAR_HEADER_SIZE + offsets.byteLength);
  out[0] = SIDECAR_MAGIC[0]!;
  out[1] = SIDECAR_MAGIC[1]!;
  out[2] = SIDECAR_MAGIC[2]!;
  out[3] = SIDECAR_MAGIC[3]!;
  out.writeUInt32LE(SIDECAR_VERSION, 4);
  Buffer.from(
    offsets.buffer,
    offsets.byteOffset,
    offsets.byteLength,
  ).copy(out, SIDECAR_HEADER_SIZE);
  return out;
}

export function parseOffsetsSidecar(bytes: Uint8Array): Int32Array | null {
  if (bytes.length < SIDECAR_HEADER_SIZE) return null;
  for (let i = 0; i < SIDECAR_MAGIC.length; i++) {
    if (bytes[i] !== SIDECAR_MAGIC[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== SIDECAR_VERSION) return null;
  const payloadLen = bytes.byteLength - SIDECAR_HEADER_SIZE;
  if (payloadLen % 4 !== 0) return null;
  const out = new Int32Array(payloadLen / 4);
  const src = new Int32Array(
    bytes.buffer,
    bytes.byteOffset + SIDECAR_HEADER_SIZE,
    payloadLen / 4,
  );
  out.set(src);
  return out;
}

const cmpAscii = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

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

export type StarDictPaths = {
  ifo: string;
  idx: string;
  dict: string;
  syn?: string;
  idxOffsets?: string;
  synOffsets?: string;
};

export class StarDictReader {
  ifo: Record<string, string> = {};
  private body: DictBody | null = null;
  private idxFh: FileHandle | null = null;
  private idxSize = 0;
  private idxOffsets: Int32Array = new Int32Array(0);
  private idxCount = 0;
  private synFh: FileHandle | null = null;
  private synSize = 0;
  private synOffsets: Int32Array = new Int32Array(0);
  private synCount = 0;
  private synBuilt = false;
  private synPath: string | null = null;
  private synOffsetsPath: string | null = null;
  private idxCache: LRU<number, StarDictEntry>;
  private synCache: LRU<number, { syn: string; idxIndex: number }>;

  constructor(cacheSize = 256) {
    this.idxCache = new LRU(cacheSize);
    this.synCache = new LRU(cacheSize);
  }

  async load(paths: StarDictPaths): Promise<void> {
    const ifoText = await readFile(paths.ifo, "utf8");
    this.ifo = parseIfo(ifoText);

    const offsetBits = this.ifo["idxoffsetbits"]
      ? parseInt(this.ifo["idxoffsetbits"], 10)
      : 32;
    if (offsetBits !== 32) {
      throw new Error(
        `StarDict idxoffsetbits=${offsetBits} not supported (only 32)`,
      );
    }

    let idxOffsets: Int32Array | null = null;
    if (paths.idxOffsets) {
      try {
        idxOffsets = parseOffsetsSidecar(await readFile(paths.idxOffsets));
      } catch {
        idxOffsets = null;
      }
    }
    if (!idxOffsets) {
      const idxBytes = await readFile(paths.idx);
      idxOffsets = scanEntryOffsets(idxBytes, 8);
    }
    this.idxOffsets = idxOffsets;
    this.idxCount = idxOffsets.length;
    this.idxFh = await fsOpen(paths.idx, "r");
    this.idxSize = (await this.idxFh.stat()).size;

    this.body = await loadDictBody(paths.dict);

    this.synPath = paths.syn ?? null;
    this.synOffsetsPath = paths.synOffsets ?? null;
    if (paths.syn && paths.synOffsets) {
      try {
        const parsed = parseOffsetsSidecar(await readFile(paths.synOffsets));
        if (parsed) {
          this.synOffsets = parsed;
          this.synCount = parsed.length;
          this.synFh = await fsOpen(paths.syn, "r");
          this.synSize = (await this.synFh.stat()).size;
          this.synBuilt = true;
        }
      } catch {
        // lazy later
      }
    }
  }

  get entryCount(): number {
    return this.idxCount;
  }

  /** Whether sametypesequence is a supported single type. */
  isSupportedSametype(): boolean {
    const seq = this.ifo["sametypesequence"];
    return !!seq && seq.length === 1 && "mhxt".includes(seq);
  }

  async read(entry: StarDictEntry): Promise<Buffer> {
    if (!this.body) throw new Error("dict body not loaded");
    return this.body.read(entry.offset, entry.size);
  }

  async readDefinitionText(entry: StarDictEntry): Promise<string> {
    const bytes = await this.read(entry);
    return decoder.decode(bytes);
  }

  private async decodeIdxEntry(i: number): Promise<StarDictEntry> {
    const cached = this.idxCache.get(i);
    if (cached) return cached;
    if (!this.idxFh) throw new Error("idx not loaded");
    const start = this.idxOffsets[i]!;
    const end =
      i + 1 < this.idxCount ? this.idxOffsets[i + 1]! : this.idxSize;
    const len = end - start;
    const buf = Buffer.alloc(len);
    await this.idxFh.read(buf, 0, len, start);
    let nullPos = 0;
    while (nullPos < buf.length && buf[nullPos] !== 0) nullPos++;
    const word = decoder.decode(buf.subarray(0, nullPos));
    const offset = buf.readUInt32BE(nullPos + 1);
    const size = buf.readUInt32BE(nullPos + 5);
    const entry: StarDictEntry = { word, offset, size };
    this.idxCache.set(i, entry);
    return entry;
  }

  async lookup(word: string): Promise<StarDictEntry | undefined> {
    let lo = 0;
    let hi = this.idxCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const entry = await this.decodeIdxEntry(mid);
      const cmp = cmpAscii(word, entry.word);
      if (cmp === 0) return entry;
      if (cmp > 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  private async ensureSynBuilt(): Promise<void> {
    if (this.synBuilt) return;
    if (!this.synPath) {
      this.synBuilt = true;
      return;
    }
    if (this.synOffsetsPath) {
      try {
        const parsed = parseOffsetsSidecar(await readFile(this.synOffsetsPath));
        if (parsed) {
          this.synOffsets = parsed;
          this.synCount = parsed.length;
        }
      } catch {
        // scan
      }
    }
    if (!this.synCount) {
      const synBytes = await readFile(this.synPath);
      this.synOffsets = scanEntryOffsets(synBytes, 4);
      this.synCount = this.synOffsets.length;
    }
    this.synFh = await fsOpen(this.synPath, "r");
    this.synSize = (await this.synFh.stat()).size;
    this.synBuilt = true;
  }

  private async decodeSynEntry(
    i: number,
  ): Promise<{ syn: string; idxIndex: number }> {
    const cached = this.synCache.get(i);
    if (cached) return cached;
    if (!this.synFh) throw new Error("syn not loaded");
    const start = this.synOffsets[i]!;
    const end =
      i + 1 < this.synCount ? this.synOffsets[i + 1]! : this.synSize;
    const len = end - start;
    const buf = Buffer.alloc(len);
    await this.synFh.read(buf, 0, len, start);
    let nullPos = 0;
    while (nullPos < buf.length && buf[nullPos] !== 0) nullPos++;
    const syn = decoder.decode(buf.subarray(0, nullPos));
    const idxIndex = buf.readUInt32BE(nullPos + 1);
    const entry = { syn, idxIndex };
    this.synCache.set(i, entry);
    return entry;
  }

  async resolveSynonym(word: string): Promise<StarDictEntry | undefined> {
    await this.ensureSynBuilt();
    if (!this.synCount) return undefined;
    let lo = 0;
    let hi = this.synCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const entry = await this.decodeSynEntry(mid);
      const cmp = cmpAscii(word, entry.syn);
      if (cmp === 0) return this.decodeIdxEntry(entry.idxIndex);
      if (cmp > 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  /** Prefer .idx, then .syn. */
  async lookupWithSynonym(
    word: string,
  ): Promise<StarDictEntry | undefined> {
    return (await this.lookup(word)) ?? (await this.resolveSynonym(word));
  }
}

    // idx.stem.idx.offsets sidecar naming
export async function buildOffsetsSidecarFromFile(
  filePath: string,
  payloadBytes: number,
): Promise<Buffer> {
  const bytes = await readFile(filePath);
  return serializeOffsetsSidecar(scanEntryOffsets(bytes, payloadBytes));
}
