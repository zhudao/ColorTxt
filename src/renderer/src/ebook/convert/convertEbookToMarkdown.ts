import type { EbookMarkdownArtifacts } from "./ebookTypes";
import {
  isEbookFilePath,
  ebookSourceFileBaseForOutput,
} from "../ebookFormat";
import { convertEpubToArtifacts, tryConvertZipAsEpub } from "./parseEpub";
import { convertFb2ToArtifacts } from "./parseFb2";
import { convertPdfToArtifacts } from "./parsePdf";
import { convertMobiToArtifacts } from "./parseMobi";
import { convertChmToArtifacts } from "./parseChm";
import { dirnameFs, joinFs } from "../pathUtils";
import { yieldToUi } from "../yieldToUi";

/** 计算 `{basename}.md` 绝对路径（basename 为源文件名含扩展名，如 `abc.epub.md`）。 */
export function resolveConvertedMdOutputPaths(params: {
  sourceBookPath: string;
  /** 空字符串：与源书同目录 */
  ebookConvertOutputDir: string;
}): { convertedMdPath: string; outputBase: string } {
  const outputBase = ebookSourceFileBaseForOutput(params.sourceBookPath);
  const sourceNorm = params.sourceBookPath.replace(/\\/g, "/");
  const outDir =
    params.ebookConvertOutputDir.trim().length > 0
      ? params.ebookConvertOutputDir.trim()
      : dirnameFs(sourceNorm);
  const convertedMdPath = joinFs(outDir, `${outputBase}.md`);
  return { convertedMdPath, outputBase };
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/").trim().toLowerCase();
}

function defaultEbookConvertCacheDirForLookup(): string {
  try {
    return window.colorTxt.getDefaultEbookConvertOutputDir().trim();
  } catch {
    return "";
  }
}

async function findReconciledConvertedMd(params: {
  existingConvertedPath?: string | undefined;
  sourceBookPath: string;
  ebookConvertOutputDir: string;
  outputBase: string;
  mtimeStable: boolean;
}): Promise<string | null> {
  const sourceNorm = params.sourceBookPath.replace(/\\/g, "/").trim();
  const besideSource = joinFs(
    dirnameFs(sourceNorm),
    `${params.outputBase}.md`,
  );

  const seen = new Set<string>();
  const candidates: string[] = [];
  function push(p: string) {
    const t = p.trim();
    if (!t) return;
    const k = normPath(t);
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(t);
  }

  if (params.mtimeStable) {
    const recorded = params.existingConvertedPath?.trim();
    if (recorded) push(recorded);
  }
  const outDir = params.ebookConvertOutputDir.trim();
  if (outDir.length > 0) {
    push(joinFs(outDir, `${params.outputBase}.md`));
  }
  push(besideSource);
  const defDir = defaultEbookConvertCacheDirForLookup();
  if (defDir) {
    push(joinFs(defDir, `${params.outputBase}.md`));
  }

  for (const p of candidates) {
    try {
      const st = await window.colorTxt.stat(p);
      if (st.isFile) return p;
    } catch {
      continue;
    }
  }
  return null;
}

async function readBookAsArrayBuffer(absSource: string): Promise<ArrayBuffer> {
  const buf = await window.colorTxt.readFileAsArrayBuffer(absSource);
  await yieldToUi();
  return buf;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export async function convertBookBufferToArtifacts(
  absSource: string,
  buffer: ArrayBuffer,
): Promise<EbookMarkdownArtifacts> {
  const lower = absSource.toLowerCase();
  const outputBase = ebookSourceFileBaseForOutput(absSource);

  if (lower.endsWith(".epub")) {
    return convertEpubToArtifacts(buffer, outputBase);
  }

  if (lower.endsWith(".azw3")) {
    const zipEpub = await tryConvertZipAsEpub(buffer, outputBase);
    if (zipEpub) return zipEpub;
    return convertMobiToArtifacts(buffer, outputBase);
  }

  if (lower.endsWith(".mobi")) {
    const zipEpub = await tryConvertZipAsEpub(buffer, outputBase);
    if (zipEpub) return zipEpub;
    return convertMobiToArtifacts(buffer, outputBase);
  }

  if (lower.endsWith(".fb2")) {
    return convertFb2ToArtifacts(buffer, false, outputBase);
  }
  if (lower.endsWith(".fbz")) {
    return convertFb2ToArtifacts(buffer, true, outputBase);
  }
  if (lower.endsWith(".pdf")) {
    return convertPdfToArtifacts(buffer, outputBase);
  }
  if (lower.endsWith(".chm")) {
    return convertChmToArtifacts(buffer, outputBase);
  }

  throw new Error("不支持的电子书格式。");
}

function joinUnderDir(dirAbs: string, relativePosix: string): string {
  let out = dirAbs;
  for (const seg of relativePosix.replace(/\\/g, "/").split("/").filter(Boolean)) {
    out = joinFs(out, seg);
  }
  return out;
}

/** `{basename}.md` 旁为 `{basename}.Images/` */
function imagesDirAbsBesideConvertedMd(convertedMdPath: string): string {
  const mdNorm = convertedMdPath.replace(/\\/g, "/").trim();
  const dir = dirnameFs(mdNorm);
  const file =
    mdNorm.includes("/") ? mdNorm.slice(mdNorm.lastIndexOf("/") + 1) : mdNorm;
  if (!/\.md$/i.test(file)) {
    throw new Error(`unexpected converted md path: ${convertedMdPath}`);
  }
  const outputBase = file.slice(0, -".md".length);
  return joinFs(dir, `${outputBase}.Images`);
}

export async function writeEbookConversionArtifacts(params: {
  convertedMdPath: string;
  artifacts: EbookMarkdownArtifacts;
}): Promise<void> {
  const utf8Out = params.artifacts.utf8;
  await window.colorTxt.writeUtf8File(params.convertedMdPath, utf8Out);
  const imgs = params.artifacts.imageWrites;
  const imagesAbs = imagesDirAbsBesideConvertedMd(params.convertedMdPath);
  if (!imgs?.length) {
    await window.colorTxt.removePath(imagesAbs);
    return;
  }
  const mdNorm = params.convertedMdPath.replace(/\\/g, "/");
  const dir = dirnameFs(mdNorm);
  await window.colorTxt.removePath(imagesAbs);
  for (const w of imgs) {
    const abs = joinUnderDir(dir, w.relativePath);
    await window.colorTxt.writeBinaryFile(abs, arrayBufferToBase64(w.data));
  }
}

/**
 * 若需转换则写入 `{basename}.md`；仅当解析到插图时写入图片文件。
 */
export async function ensureEbookMarkdown(params: {
  sourceBookPath: string;
  ebookConvertOutputDir: string;
  sourceMtimeMs: number;
  existingConvertedPath?: string | undefined;
  existingSourceMtimeMs?: number | undefined;
  /** 跳过缓存命中，强制重新解析并覆盖转换结果 */
  forceConvert?: boolean;
  onActualConversionStart?: () => void | Promise<void>;
}): Promise<{ convertedMdPath: string; didConvert: boolean }> {
  const absSource = params.sourceBookPath.trim();
  if (!isEbookFilePath(absSource)) {
    return { convertedMdPath: absSource, didConvert: false };
  }

  const { convertedMdPath, outputBase } = resolveConvertedMdOutputPaths({
    sourceBookPath: absSource,
    ebookConvertOutputDir: params.ebookConvertOutputDir,
  });

  const recordedMdPath = params.existingConvertedPath?.trim();
  const noRecordedPath = !recordedMdPath;
  const mtimeStable =
    typeof params.existingSourceMtimeMs === "number" &&
    params.existingSourceMtimeMs === params.sourceMtimeMs;

  if (!params.forceConvert) {
    const strictCacheHit =
      !noRecordedPath &&
      normPath(recordedMdPath!) === normPath(convertedMdPath) &&
      mtimeStable;

    if (strictCacheHit) {
      try {
        const st = await window.colorTxt.stat(recordedMdPath!);
        if (st.isFile) {
          return { convertedMdPath: recordedMdPath!, didConvert: false };
        }
      } catch {
        // 路径失效
      }
    }

    if (noRecordedPath || mtimeStable) {
      const found = await findReconciledConvertedMd({
        existingConvertedPath: recordedMdPath,
        sourceBookPath: absSource,
        ebookConvertOutputDir: params.ebookConvertOutputDir,
        outputBase,
        mtimeStable,
      });
      if (found) {
        return { convertedMdPath: found, didConvert: false };
      }
    }
  }

  if (params.onActualConversionStart) {
    await Promise.resolve(params.onActualConversionStart());
  }
  await yieldToUi();
  const buf = await readBookAsArrayBuffer(absSource);
  const artifacts = await convertBookBufferToArtifacts(absSource, buf);
  await writeEbookConversionArtifacts({ convertedMdPath, artifacts });
  return { convertedMdPath, didConvert: true };
}
