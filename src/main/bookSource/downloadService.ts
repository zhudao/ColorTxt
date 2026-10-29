import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import iconv from "iconv-lite";
import type {
  BookSourceDownloadEvent,
  BookSourceDownloadRequest,
} from "@shared/bookSource/types";
import { contentChaptersInReadingOrder } from "@shared/bookSource/chapterReadingOrder";
import { getBookSource } from "./store/bookSourceStore";
import { getBookInfo, getChapterList } from "./engine/webBook";
import { getChapterContentWithCache } from "./engine/getChapterContentWithCache";
import { readChapterCache } from "./engine/chapterCache";

type DownloadSession = {
  id: string;
  cancelled: boolean;
  emit: (ev: BookSourceDownloadEvent) => void;
};

const sessions = new Map<string, DownloadSession>();

export function cancelDownload(downloadId: string): void {
  const s = sessions.get(downloadId);
  if (s) s.cancelled = true;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "book";
}

function buildDownloadFileBaseName(name: string, author: string): string {
  const n = (name || "未命名").trim() || "未命名";
  const a = (author || "未知").trim() || "未知";
  return sanitizeFileName(`《${n}》作者：${a}`);
}

/** 对齐 Legado ReadBookConfig.paragraphIndent 默认值 */
const EXPORT_PARAGRAPH_INDENT = "　　";

/**
 * 对齐 Legado：非空段先去掉行首尾空白（含全角空格），再统一加「　　」。
 * 简介 / 正文共用（标题行不走此函数）。
 */
function formatExportParagraphs(text: string): string {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const out: string[] = [];
  for (const line of lines) {
    // 对齐 ContentProcessor：trim { it.code <= 0x20 || it == '　' }
    const paragraph = line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
    if (paragraph) out.push(`${EXPORT_PARAGRAPH_INDENT}${paragraph}`);
  }
  return out.join("\n");
}

/** 正文前的书籍信息头（简介段首缩进对齐 Legado HtmlFormatter / 导出观感） */
function buildDownloadFileHeader(
  name: string,
  author: string,
  intro: string,
): string {
  const n = (name || "").trim() || "未命名";
  const a = (author || "").trim() || "未知";
  const formattedIntro = formatExportParagraphs(intro);
  return formattedIntro
    ? `${n}\n作者：${a}\n简介：\n${formattedIntro}\n\n`
    : `${n}\n作者：${a}\n简介：\n\n`;
}

async function writeDownloadFile(
  outputDir: string,
  baseName: string,
  fullText: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  // 同名直接覆盖：重复下载通常是为了更新内容，加后缀会在「文件」列表留下多余副本
  const filePath = path.join(outputDir, `${baseName}.txt`);
  await writeFile(filePath, iconv.encode(fullText, "utf8"));
  return filePath;
}

export function startDownload(
  req: BookSourceDownloadRequest,
  emit: (ev: BookSourceDownloadEvent) => void,
): string {
  const downloadId = randomUUID();
  const session: DownloadSession = { id: downloadId, cancelled: false, emit };
  sessions.set(downloadId, session);

  void runDownload(session, req);
  return downloadId;
}

/**
 * 对齐 Legado：先离线缓存全部章节，再从缓存自动导出 .txt。
 * 已缓存章节直接命中本地，不重复联网。
 */
async function runDownload(
  session: DownloadSession,
  req: BookSourceDownloadRequest,
): Promise<void> {
  const downloadId = session.id;
  const emit = session.emit;
  try {
    const source = getBookSource(req.bookSourceUrl);
    if (!source) throw new Error("书源不存在");

    const logs: string[] = [];
    const detail = await getBookInfo(
      source,
      req.bookUrl,
      req.name,
      req.author,
      logs,
    );
    const chapters = await getChapterList(source, detail, logs);
    const contentChapters = contentChaptersInReadingOrder(chapters);
    const total = contentChapters.length;
    const book = detail;

    emit({
      downloadId,
      type: "progress",
      current: 0,
      total,
    });

    // 1) 离线缓存：缺章联网拉取并写入 book_cache
    for (let i = 0; i < contentChapters.length; i++) {
      if (session.cancelled) break;
      const ch = contentChapters[i]!;
      const chapter = { title: ch.title, url: ch.url, index: i };
      emit({
        downloadId,
        type: "progress",
        current: i,
        total,
        chapterName: ch.title,
        chapterUrl: ch.url,
      });
      try {
        const nextChapterUrl =
          i + 1 < contentChapters.length
            ? contentChapters[i + 1]!.url
            : undefined;
        await getChapterContentWithCache(
          source,
          ch.url,
          book,
          chapter,
          logs,
          nextChapterUrl,
          {
            cacheDir: req.cacheDir,
            chapterUrls: contentChapters.map((c) => c.url),
          },
        );
      } catch (e) {
        // 单章失败不中断；导出处写占位
        const msg = e instanceof Error ? e.message : String(e);
        logs.push(`缓存章节失败 [${ch.title}]: ${msg}`);
      }
      emit({
        downloadId,
        type: "progress",
        current: i + 1,
        total,
        chapterName: ch.title,
        chapterUrl: ch.url,
      });
    }

    if (session.cancelled) {
      emit({
        downloadId,
        type: "error",
        message: req.cacheOnly ? "已停止离线缓存" : "已停止下载",
      });
      return;
    }

    // 仅离线缓存：跳过整书导出
    if (req.cacheOnly) {
      emit({
        downloadId,
        type: "done",
        filePath: "",
        bookName: detail.name,
      });
      return;
    }

    // 2) 自动导出：只读缓存拼 .txt（原文；不套文本替换 / 简繁·全半角转换）
    const parts: string[] = [];
    for (let i = 0; i < contentChapters.length; i++) {
      const ch = contentChapters[i]!;
      const heading =
        typeof ch.title === "string" && ch.title.trim()
          ? ch.title.trim()
          : `第${i + 1}章`;
      const cached = await readChapterCache(
        detail.name,
        req.bookUrl,
        ch.url,
        req.cacheDir,
      );
      const body =
        cached != null && cached.length
          ? formatExportParagraphs(cached)
          : `${EXPORT_PARAGRAPH_INDENT}[下载失败: 章节未缓存]`;
      parts.push(`\n\n${heading}\n\n${body}`);
    }

    const body = parts.join("").trim();
    if (!body) {
      emit({ downloadId, type: "error", message: "没有可保存的内容" });
      return;
    }

    const fullText =
      buildDownloadFileHeader(detail.name, detail.author, detail.intro) + body;
    const baseName = buildDownloadFileBaseName(detail.name, detail.author);
    const filePath = await writeDownloadFile(
      req.outputDir,
      baseName,
      fullText,
    );

    emit({
      downloadId,
      type: "done",
      filePath,
      bookName: detail.name,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit({ downloadId, type: "error", message: msg });
  } finally {
    sessions.delete(downloadId);
  }
}
