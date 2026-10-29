/**
 * Classify/group dictionary bundles and copy into userData/dictionaries/<uuid>/.
 */
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ImportedDictionary,
  ImportedDictionaryFiles,
  ImportedDictionaryKind,
} from "@shared/dictionaryTypes";
import {
  buildOffsetsSidecarFromFile,
  parseIfo,
} from "./stardictReader";
import { readMdxHeaderEncrypted } from "./mdictReader";
import { probeSlobCompression } from "./slobReader";
import { readFile } from "node:fs/promises";

/** Decode common XML/HTML entities in MDX Title. */
function decodeMdxEntities(s: string): string {
  return s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h: string) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/gi, "&");
}

export type ClassifiedSourceFile = {
  /** 绝对路径 */
  absPath: string;
  /** Basename including extension. */
  name: string;
  /** Lowercase stem (.dict.dz drops .dict.dz). */
  stem: string;
  ext: string;
  isDictZip: boolean;
};

export type StarDictGroup = {
  kind: "stardict";
  stem: string;
  ifo: ClassifiedSourceFile;
  idx: ClassifiedSourceFile;
  dict: ClassifiedSourceFile;
  syn?: ClassifiedSourceFile;
};

export type DictGroup = {
  kind: "dict";
  stem: string;
  index: ClassifiedSourceFile;
  dict: ClassifiedSourceFile;
};

export type MDictGroup = {
  kind: "mdict";
  stem: string;
  mdx: ClassifiedSourceFile;
  mdd: ClassifiedSourceFile[];
  css: ClassifiedSourceFile[];
};

export type SlobGroup = {
  kind: "slob";
  stem: string;
  slob: ClassifiedSourceFile;
};

export type BglGroup = {
  kind: "bgl";
  stem: string;
  bgl: ClassifiedSourceFile;
};

export type DictionaryBundle =
  | StarDictGroup
  | DictGroup
  | MDictGroup
  | SlobGroup
  | BglGroup;

export function classifyFile(absPath: string): ClassifiedSourceFile {
  const name = path.basename(absPath);
  const lower = name.toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  const ext = lastDot >= 0 ? lower.slice(lastDot + 1) : "";
  const beforeLast = lastDot >= 0 ? lower.slice(0, lastDot) : lower;
  const isDictZip = ext === "dz" && beforeLast.endsWith(".dict");
  let stem: string;
  if (isDictZip) {
    stem = beforeLast.slice(0, -".dict".length);
  } else if (lastDot >= 0) {
    stem = beforeLast;
  } else {
    stem = lower;
  }
  return { absPath, name, stem, ext, isDictZip };
}

function isCompanionMddStem(bundleStem: string, mddStem: string): boolean {
  if (mddStem === bundleStem) return false;
  if (!mddStem.startsWith(bundleStem)) return false;
  const boundary = mddStem.charAt(bundleStem.length);
  return boundary !== "" && !/[a-z0-9]/i.test(boundary);
}

export function groupBundlesByStem(filePaths: string[]): {
  bundles: DictionaryBundle[];
  orphans: ClassifiedSourceFile[];
} {
  const classified = filePaths.map(classifyFile);
  const cssFiles = classified.filter((f) => f.ext === "css");
  const byStem = new Map<string, ClassifiedSourceFile[]>();
  for (const f of classified) {
    if (f.ext === "css") continue;
    if (!byStem.has(f.stem)) byStem.set(f.stem, []);
    byStem.get(f.stem)!.push(f);
  }

  const bundles: DictionaryBundle[] = [];
  const orphans: ClassifiedSourceFile[] = [];

  for (const [stem, group] of byStem) {
    const ifo = group.find((f) => f.ext === "ifo");
    const idx = group.find((f) => f.ext === "idx");
    const indexFile = group.find((f) => f.ext === "index");
    const dict = group.find((f) => f.ext === "dict" || f.isDictZip);
    const syn = group.find((f) => f.ext === "syn");
    const mdx = group.find((f) => f.ext === "mdx");
    const mdd = group.filter((f) => f.ext === "mdd");
    const slob = group.find((f) => f.ext === "slob");
    const bgl = group.find((f) => f.ext === "bgl");

    if (ifo && idx && dict) {
      bundles.push({ kind: "stardict", stem, ifo, idx, dict, syn });
    } else if (indexFile && dict) {
      bundles.push({ kind: "dict", stem, index: indexFile, dict });
    } else if (mdx) {
      bundles.push({ kind: "mdict", stem, mdx, mdd, css: [] });
    } else if (slob) {
      bundles.push({ kind: "slob", stem, slob });
    } else if (bgl) {
      bundles.push({ kind: "bgl", stem, bgl });
    } else {
      orphans.push(...group);
    }
  }

  const mdictForMdd = bundles
    .filter((b): b is MDictGroup => b.kind === "mdict")
    .sort((a, b) => b.stem.length - a.stem.length);
  if (mdictForMdd.length > 0) {
    const still: ClassifiedSourceFile[] = [];
    for (const f of orphans) {
      const target =
        f.ext === "mdd"
          ? mdictForMdd.find((b) => isCompanionMddStem(b.stem, f.stem))
          : undefined;
      if (target) target.mdd.push(f);
      else still.push(f);
    }
    orphans.length = 0;
    orphans.push(...still);
  }

  const mdictBundles = bundles.filter(
    (b): b is MDictGroup => b.kind === "mdict",
  );
  if (mdictBundles.length > 0) {
    for (const b of mdictBundles) b.css = cssFiles;
  } else {
    orphans.push(...cssFiles);
  }

  return { bundles, orphans };
}

async function copyInto(
  destDir: string,
  src: ClassifiedSourceFile,
): Promise<string> {
  const dest = path.join(destDir, src.name);
  await copyFile(src.absPath, dest);
  return src.name;
}

async function importOne(
  dictionariesRoot: string,
  bundle: DictionaryBundle,
): Promise<ImportedDictionary> {
  const id = randomUUID();
  const bundleDir = id;
  const destDir = path.join(dictionariesRoot, bundleDir);
  await mkdir(destDir, { recursive: true });
  const addedAt = Date.now();

  if (bundle.kind === "stardict") {
    const files: ImportedDictionaryFiles = {
      ifo: await copyInto(destDir, bundle.ifo),
      idx: await copyInto(destDir, bundle.idx),
      dict: await copyInto(destDir, bundle.dict),
    };
    if (bundle.syn) {
      files.syn = await copyInto(destDir, bundle.syn);
    }

    const idxOffsetsFile = `${bundle.idx.stem}.idx.offsets`;
    const idxSidecar = await buildOffsetsSidecarFromFile(
      path.join(destDir, files.idx!),
      8,
    );
    await writeFile(path.join(destDir, idxOffsetsFile), idxSidecar);
    files.idxOffsets = idxOffsetsFile;

    if (files.syn) {
      const synOffsetsFile = `${bundle.syn!.stem}.syn.offsets`;
      const synSidecar = await buildOffsetsSidecarFromFile(
        path.join(destDir, files.syn),
        4,
      );
      await writeFile(path.join(destDir, synOffsetsFile), synSidecar);
      files.synOffsets = synOffsetsFile;
    }

    const ifoText = await readFile(path.join(destDir, files.ifo!), "utf8");
    const ifo = parseIfo(ifoText);
    const name = ifo["bookname"] || bundle.stem;
    let unsupported = false;
    let unsupportedReason: string | undefined;
    const seq = ifo["sametypesequence"];
    if (!seq || seq.length !== 1) {
      unsupported = true;
      unsupportedReason = seq
        ? `Multi-type sametypesequence "${seq}" is not supported.`
        : "StarDict bundles without sametypesequence are not supported.";
    } else if (!"mhxt".includes(seq)) {
      unsupported = true;
      unsupportedReason = `StarDict entry type "${seq}" is not supported.`;
    }

    return {
      id,
      kind: "stardict" as ImportedDictionaryKind,
      name,
      bundleDir,
      files,
      addedAt,
      unsupported: unsupported || undefined,
      unsupportedReason,
    };
  }

  if (bundle.kind === "dict") {
    const files: ImportedDictionaryFiles = {
      index: await copyInto(destDir, bundle.index),
      dict: await copyInto(destDir, bundle.dict),
    };
    return {
      id,
      kind: "dict",
      name: bundle.stem,
      bundleDir,
      files,
      addedAt,
    };
  }

  if (bundle.kind === "mdict") {
    const files: ImportedDictionaryFiles = {
      mdx: await copyInto(destDir, bundle.mdx),
      mdd: [],
      css: [],
    };
    for (const m of bundle.mdd) {
      files.mdd!.push(await copyInto(destDir, m));
    }
    for (const c of bundle.css) {
      files.css!.push(await copyInto(destDir, c));
    }

    let name = bundle.stem;
    let unsupported = false;
    let unsupportedReason: string | undefined;
    try {
      const header = await readMdxHeaderEncrypted(
        path.join(destDir, files.mdx!),
      );
      // MDict 制作工具未填书名时会留下英文占位；回退到文件名 stem
      const title = decodeMdxEntities(header.title?.trim() ?? "");
      if (
        title &&
        !/^Title\s*\(No HTML code allowed\)$/i.test(title) &&
        title.toLowerCase() !== "title"
      ) {
        name = title;
      }
      if ((header.encrypt & 1) !== 0) {
        unsupported = true;
        unsupportedReason =
          "This MDX uses record-block encryption; passcode-protected dictionaries are not supported.";
      }
    } catch (e) {
      unsupported = true;
      unsupportedReason = `Failed to parse MDX header: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }

    return {
      id,
      kind: "mdict",
      name,
      bundleDir,
      files,
      addedAt,
      unsupported: unsupported || undefined,
      unsupportedReason,
    };
  }

  if (bundle.kind === "slob") {
    const files: ImportedDictionaryFiles = {
      slob: await copyInto(destDir, bundle.slob),
    };
    let name = bundle.stem;
    let unsupported = false;
    let unsupportedReason: string | undefined;
    try {
      const probe = await probeSlobCompression(
        path.join(destDir, files.slob!),
      );
      if (probe.label) name = probe.label;
      if (probe.compression !== "zlib") {
        unsupported = true;
        unsupportedReason = `Slob compression "${probe.compression}" is not supported (zlib only).`;
      }
    } catch (e) {
      unsupported = true;
      unsupportedReason = e instanceof Error ? e.message : String(e);
    }
    return {
      id,
      kind: "slob",
      name,
      bundleDir,
      files,
      addedAt,
      unsupported: unsupported || undefined,
      unsupportedReason,
    };
  }

  // bgl
  const files: ImportedDictionaryFiles = {
    bgl: await copyInto(destDir, bundle.bgl),
  };
  return {
    id,
    kind: "bgl",
    name: bundle.stem,
    bundleDir,
    files,
    addedAt,
  };
}

export async function importDictionaryBundles(
  dictionariesRoot: string,
  filePaths: string[],
): Promise<{
  imported: ImportedDictionary[];
  orphanNames: string[];
}> {
  const { bundles, orphans } = groupBundlesByStem(filePaths);
  await mkdir(dictionariesRoot, { recursive: true });
  const imported: ImportedDictionary[] = [];
  for (const b of bundles) {
    imported.push(await importOne(dictionariesRoot, b));
  }
  return {
    imported,
    orphanNames: orphans.map((o) => o.name),
  };
}
