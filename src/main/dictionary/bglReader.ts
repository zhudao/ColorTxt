/**
 * Babylon BGL：从 gzip 偏移解压后解析块流，按 lowercased headword/alt Map 查找。
 */
import { readFile } from "node:fs/promises";
import pako from "pako";

export type BglMetadata = {
  title?: string;
  sourceEncoding: string;
  targetEncoding: string;
};

export type BglEntry = {
  headword: string;
  alternates: string[];
  definition: string;
};

const MAGIC = [0x12, 0x34, 0x00];

const CHARSET_BY_CODE = new Map<number, string>([
  [0x41, "windows-1252"],
  [0x42, "windows-1252"],
  [0x43, "windows-1250"],
  [0x44, "windows-1251"],
  [0x45, "shift_jis"],
  [0x46, "big5"],
  [0x47, "gbk"],
  [0x48, "windows-1257"],
  [0x49, "windows-1253"],
  [0x4a, "euc-kr"],
  [0x4b, "windows-1254"],
  [0x4c, "windows-1255"],
  [0x4d, "windows-1256"],
  [0x4e, "windows-874"],
]);

const LANGUAGES: [string, string][] = [
  ["English", "windows-1252"],
  ["French", "windows-1252"],
  ["Italian", "windows-1252"],
  ["Spanish", "windows-1252"],
  ["Dutch", "windows-1252"],
  ["Portuguese", "windows-1252"],
  ["German", "windows-1252"],
  ["Russian", "windows-1251"],
  ["Japanese", "shift_jis"],
  ["Chinese", "big5"],
  ["Chinese", "gbk"],
  ["Greek", "windows-1253"],
  ["Korean", "euc-kr"],
  ["Turkish", "windows-1254"],
  ["Hebrew", "windows-1255"],
  ["Arabic", "windows-1256"],
  ["Thai", "windows-874"],
];

const decoders = new Map<string, TextDecoder>();
function getDecoder(encoding: string): TextDecoder {
  let d = decoders.get(encoding);
  if (!d) {
    try {
      d = new TextDecoder(encoding);
    } catch {
      d = new TextDecoder("windows-1252");
    }
    decoders.set(encoding, d);
  }
  return d;
}

function uint(b: Uint8Array, start: number, end: number): number {
  let v = 0;
  for (let i = start; i < end; i++) v = v * 256 + b[i]!;
  return v;
}

function stripDollarIndexes(b: Uint8Array): Uint8Array {
  const dollar = b.indexOf(0x24);
  if (dollar < 0) return b;
  return b.subarray(0, dollar);
}

function stripControlAndTags(s: string): string {
  return s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip trailing 0x14 field region from definition bytes. */
function bodyBeforeTrailingFields(b: Uint8Array): Uint8Array {
  const idx = b.indexOf(0x14);
  if (idx < 0) return b;
  return b.subarray(0, idx);
}

type EntrySpan = {
  headword: string;
  alternates: string[];
  defiStart: number;
  defiEnd: number;
};

type RawEntryBlock = { type: number; start: number; end: number };

export class BglReader {
  metadata: BglMetadata = {
    sourceEncoding: "windows-1252",
    targetEncoding: "windows-1252",
  };
  entryCount = 0;

  private data: Uint8Array = new Uint8Array(0);
  private entries: EntrySpan[] = [];
  private index = new Map<string, number[]>();

  async load(filePath: string): Promise<void> {
    const bytes = await readFile(filePath);
    if (
      bytes.length < 6 ||
      bytes[0] !== MAGIC[0] ||
      bytes[1] !== MAGIC[1] ||
      bytes[2] !== MAGIC[2] ||
      (bytes[3] !== 0x01 && bytes[3] !== 0x02)
    ) {
      throw new Error("Not a Babylon glossary (bad magic)");
    }
    const gzipOffset = (bytes[4]! << 8) | bytes[5]!;
    if (gzipOffset < 6 || gzipOffset >= bytes.length) {
      throw new Error(`Not a Babylon glossary (bad gzip offset ${gzipOffset})`);
    }
    // pako tolerates bad gzip CRC better than zlib
    this.data = pako.ungzip(bytes.subarray(gzipOffset));

    const rawInfo = new Map<number, Uint8Array>();
    const entryBlocks: RawEntryBlock[] = [];
    let defaultCharset = "";
    const data = this.data;
    let pos = 0;
    while (pos < data.length) {
      let length = data[pos]!;
      pos += 1;
      const type = length & 0xf;
      length >>= 4;
      if (length < 4) {
        const numBytes = length + 1;
        if (pos + numBytes > data.length) break;
        length = uint(data, pos, pos + numBytes);
        pos += numBytes;
      } else {
        length -= 4;
      }
      if (pos + length > data.length) break;
      if (length > 0) {
        if (
          type === 1 ||
          type === 7 ||
          type === 10 ||
          type === 11 ||
          type === 13
        ) {
          entryBlocks.push({ type, start: pos, end: pos + length });
        } else if (type === 3 && length >= 2) {
          rawInfo.set(
            uint(data, pos, pos + 2),
            data.subarray(pos + 2, pos + length),
          );
        } else if (type === 0 && data[pos] === 8 && length >= 2) {
          defaultCharset = CHARSET_BY_CODE.get(data[pos + 1]!) ?? "";
        }
      }
      pos += length;
    }

    this.resolveMetadata(rawInfo, defaultCharset);

    for (const block of entryBlocks) {
      const span =
        block.type === 11 ? this.parseEntryWide(block) : this.parseEntry(block);
      if (!span || !span.headword) continue;
      const idx = this.entries.length;
      this.entries.push(span);
      for (const key of [span.headword, ...span.alternates]) {
        const norm = key.toLowerCase();
        const list = this.index.get(norm);
        if (list) list.push(idx);
        else this.index.set(norm, [idx]);
      }
    }
    this.entryCount = this.entries.length;
  }

  findEntries(word: string): BglEntry[] {
    const indices = this.index.get(word.trim().toLowerCase()) ?? [];
    return indices.map((i) => {
      const span = this.entries[i]!;
      return {
        headword: span.headword,
        alternates: span.alternates,
        definition: this.processDefi(
          this.data.subarray(span.defiStart, span.defiEnd),
        ),
      };
    });
  }

  private resolveMetadata(
    rawInfo: Map<number, Uint8Array>,
    defaultCharset: string,
  ): void {
    const langOf = (code: number | undefined) =>
      code === undefined ? undefined : LANGUAGES[code];
    const charsetOf = (v: Uint8Array | undefined) =>
      v && v.length > 0 ? CHARSET_BY_CODE.get(v[0]!) : undefined;

    const sourceLangValue = rawInfo.get(0x07);
    const targetLangValue = rawInfo.get(0x08);
    const sourceLang = langOf(
      sourceLangValue
        ? uint(sourceLangValue, 0, sourceLangValue.length)
        : undefined,
    );
    const targetLang = langOf(
      targetLangValue
        ? uint(targetLangValue, 0, targetLangValue.length)
        : undefined,
    );

    const flagsValue = rawInfo.get(0x11);
    const utf8Everywhere =
      flagsValue !== undefined &&
      (uint(flagsValue, 0, flagsValue.length) & 0x8000) !== 0;

    const defaultEncoding = defaultCharset || "windows-1252";
    const sourceEncoding = utf8Everywhere
      ? "utf-8"
      : (charsetOf(rawInfo.get(0x1a)) ?? sourceLang?.[1] ?? defaultEncoding);
    const targetEncoding = utf8Everywhere
      ? "utf-8"
      : (charsetOf(rawInfo.get(0x1b)) ?? targetLang?.[1] ?? defaultEncoding);

    const titleBytes = rawInfo.get(0x01);
    const title = titleBytes
      ? getDecoder(targetEncoding)
          .decode(titleBytes)
          .replace(/\0+/g, "")
          .trim() || undefined
      : undefined;

    this.metadata = { title, sourceEncoding, targetEncoding };
  }

  private processKey(b: Uint8Array): string {
    const s = getDecoder(this.metadata.sourceEncoding).decode(
      stripDollarIndexes(b),
    );
    return stripControlAndTags(s);
  }

  private parseEntry(block: RawEntryBlock): EntrySpan | null {
    const d = this.data;
    let pos = block.start;
    if (pos + 1 > block.end) return null;
    const wordLen = d[pos]!;
    pos += 1;
    if (pos + wordLen > block.end) return null;
    const headword = this.processKey(d.subarray(pos, pos + wordLen));
    pos += wordLen;
    if (pos + 2 > block.end) return null;
    const defiLen = uint(d, pos, pos + 2);
    pos += 2;
    if (pos + defiLen > block.end) return null;
    const defiStart = pos;
    pos += defiLen;
    const alternates = new Set<string>();
    while (pos < block.end) {
      const altLen = d[pos]!;
      pos += 1;
      if (pos + altLen > block.end) return null;
      const alt = this.processKey(d.subarray(pos, pos + altLen));
      if (alt) alternates.add(alt);
      pos += altLen;
    }
    alternates.delete(headword);
    return {
      headword,
      alternates: [...alternates],
      defiStart,
      defiEnd: defiStart + defiLen,
    };
  }

  private parseEntryWide(block: RawEntryBlock): EntrySpan | null {
    const d = this.data;
    let pos = block.start;
    if (pos + 5 > block.end) return null;
    const wordLen = uint(d, pos, pos + 5);
    pos += 5;
    if (pos + wordLen > block.end) return null;
    const headword = this.processKey(d.subarray(pos, pos + wordLen));
    pos += wordLen;
    if (pos + 4 > block.end) return null;
    const altCount = uint(d, pos, pos + 4);
    pos += 4;
    const alternates = new Set<string>();
    for (let n = 0; n < altCount; n++) {
      if (pos + 4 > block.end) return null;
      const altLen = uint(d, pos, pos + 4);
      pos += 4;
      if (altLen === 0) break;
      if (pos + altLen > block.end) return null;
      const alt = this.processKey(d.subarray(pos, pos + altLen));
      if (alt) alternates.add(alt);
      pos += altLen;
    }
    alternates.delete(headword);
    if (pos + 4 > block.end) return null;
    const defiLen = uint(d, pos, pos + 4);
    pos += 4;
    if (pos + defiLen > block.end) return null;
    return {
      headword,
      alternates: [...alternates],
      defiStart: pos,
      defiEnd: pos + defiLen,
    };
  }

  private processDefi(b: Uint8Array): string {
    const body = bodyBeforeTrailingFields(b);
    let text = getDecoder(this.metadata.targetEncoding).decode(body);
    text = text
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
      .replace(/\r\n?/g, "\n")
      .trim();
    return text;
  }
}
