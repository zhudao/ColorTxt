/**
 * DICT/dictd: .index + .dict(.dz).
 * Index line: headword\\tbase64(offset)\\tbase64(size) (dictd base64).
 */
import { readFile } from "node:fs/promises";
import { loadDictBody, type DictBody } from "./dictZip";

export type DictEntry = {
  word: string;
  offset: number;
  size: number;
};

export type DictInfo = {
  label?: string;
  description?: string;
  url?: string;
  alphabet?: string;
  utf8: boolean;
};

const decoder = new TextDecoder("utf-8");

const B64: Int8Array = (() => {
  const t = new Int8Array(256).fill(-1);
  const set = (s: string, base: number) => {
    for (let i = 0; i < s.length; i++) t[s.charCodeAt(i)] = base + i;
  };
  set("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 0);
  set("abcdefghijklmnopqrstuvwxyz", 26);
  set("0123456789", 52);
  t["+".charCodeAt(0)] = 62;
  t["/".charCodeAt(0)] = 63;
  return t;
})();

/** dictd base64: no padding, n = n*64 + v. */
export function decodeDictBase64(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64[s.charCodeAt(i)]!;
    if (v < 0) throw new Error(`Invalid DICT base64 character at ${i}: ${s[i]}`);
    n = n * 64 + v;
  }
  return n;
}

const cmpAscii = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export type ParsedDictIndex = {
  words: string[];
  entries: Int32Array;
  meta: Record<string, { offset: number; size: number }>;
};

export function parseDictIndex(text: string): ParsedDictIndex {
  const words: string[] = [];
  const offsets: number[] = [];
  const sizes: number[] = [];
  const meta: Record<string, { offset: number; size: number }> = {};

  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf("\n", pos);
    if (nl < 0) nl = text.length;
    const ln =
      text.charCodeAt(nl - 1) === 13
        ? text.slice(pos, nl - 1)
        : text.slice(pos, nl);
    pos = nl + 1;
    if (!ln) continue;

    const tab1 = ln.indexOf("\t");
    if (tab1 < 0) continue;
    const tab2 = ln.indexOf("\t", tab1 + 1);
    if (tab2 < 0) continue;
    const word = ln.slice(0, tab1);
    const offTok = ln.slice(tab1 + 1, tab2);
    const sizeTok = ln.slice(tab2 + 1).trim();
    let off: number;
    let size: number;
    try {
      off = decodeDictBase64(offTok);
      size = decodeDictBase64(sizeTok);
    } catch {
      continue;
    }

    if (word.startsWith("00database")) {
      meta[word] = { offset: off, size };
      continue;
    }
    words.push(word);
    offsets.push(off);
    sizes.push(size);
  }

  const order = words
    .map((_, i) => i)
    .sort((a, b) => cmpAscii(words[a]!, words[b]!));
  const sortedWords: string[] = new Array(words.length);
  const sortedEntries = new Int32Array(words.length * 2);
  for (let i = 0; i < order.length; i++) {
    const k = order[i]!;
    sortedWords[i] = words[k]!;
    sortedEntries[i * 2] = offsets[k]!;
    sortedEntries[i * 2 + 1] = sizes[k]!;
  }

  return { words: sortedWords, entries: sortedEntries, meta };
}

export type DictReaderPaths = {
  index: string;
  dict: string;
};

export class DictReader {
  info: DictInfo = { utf8: false };
  private words: string[] = [];
  private entries: Int32Array = new Int32Array(0);
  private body: DictBody | null = null;

  async load(paths: DictReaderPaths): Promise<void> {
    const indexText = await readFile(paths.index, "utf8");
    const parsed = parseDictIndex(indexText);
    this.words = parsed.words;
    this.entries = parsed.entries;
    this.body = await loadDictBody(paths.dict);

    const tryRead = async (key: string): Promise<string | undefined> => {
      const m = parsed.meta[key];
      if (!m || !this.body) return undefined;
      const bytes = await this.body.read(m.offset, m.size);
      return decoder.decode(bytes).trim();
    };
    const [short, longInfo, url, alphabet, utf8] = await Promise.all([
      tryRead("00databaseshort"),
      tryRead("00databaseinfo"),
      tryRead("00databaseurl"),
      tryRead("00databasealphabet"),
      tryRead("00databaseutf8"),
    ]);
    this.info = {
      label: short,
      description: longInfo,
      url,
      alphabet,
      utf8: utf8 !== undefined,
    };
  }

  get entryCount(): number {
    return this.words.length;
  }

  async read(entry: DictEntry): Promise<Buffer> {
    if (!this.body) throw new Error("dict body not loaded");
    return this.body.read(entry.offset, entry.size);
  }

  async readText(entry: DictEntry): Promise<string> {
    return decoder.decode(await this.read(entry));
  }

  /** Case-insensitive binary search exact match. */
  async lookup(word: string): Promise<DictEntry | undefined> {
    let lo = 0;
    let hi = this.words.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const cmp = cmpAscii(word, this.words[mid]!);
      if (cmp === 0) {
        return {
          word: this.words[mid]!,
          offset: this.entries[mid * 2]!,
          size: this.entries[mid * 2 + 1]!,
        };
      }
      if (cmp > 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }
}
