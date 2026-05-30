import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AIConfig } from "@shared/aiTypes";
import { segmentDbFilePath } from "./aiPaths";
import { AI_SEGMENT_VERSION, countTokens, tokenizeForWordcloud } from "./aiJieba";

let db: Database.Database | null = null;
let openedPath: string | null = null;

function openSegmentDb(cfg?: AIConfig): Database.Database {
  const file = segmentDbFilePath(cfg);
  if (db && openedPath === file) return db;
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
    openedPath = null;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS seg_chapter_freq (
      book_hash TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      seg_version INTEGER NOT NULL,
      char_count INTEGER NOT NULL,
      freq_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (book_hash, chapter_index)
    );
    CREATE INDEX IF NOT EXISTS idx_seg_chapter_book ON seg_chapter_freq(book_hash);
  `);
  db = database;
  openedPath = file;
  return database;
}

export function hashChapterPlainText(plainText: string): string {
  return crypto
    .createHash("sha256")
    .update(plainText)
    .digest("hex")
    .slice(0, 16);
}

export type ChapterFreqBuildResult = {
  freq: Map<string, number>;
  cacheHit: boolean;
  charCount: number;
};

export function getOrBuildChapterFreq(
  bookHash: string,
  chapterIndex: number,
  plainText: string,
  segVersion = AI_SEGMENT_VERSION,
  cfg?: AIConfig,
): ChapterFreqBuildResult {
  const database = openSegmentDb(cfg);
  const contentHash = hashChapterPlainText(plainText);
  const charCount = plainText.length;
  const row = database
    .prepare(
      `SELECT content_hash, seg_version, freq_json FROM seg_chapter_freq
       WHERE book_hash = ? AND chapter_index = ?`,
    )
    .get(bookHash, chapterIndex) as
    | { content_hash: string; seg_version: number; freq_json: string }
    | undefined;

  if (
    row &&
    row.content_hash === contentHash &&
    row.seg_version === segVersion
  ) {
    try {
      const parsed = JSON.parse(row.freq_json) as Record<string, number>;
      const freq = new Map<string, number>();
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && v > 0) freq.set(k, v);
      }
      return { freq, cacheHit: true, charCount };
    } catch {
      /* rebuild */
    }
  }

  const tokens = tokenizeForWordcloud(plainText);
  const freq = countTokens(tokens);
  const freqObj: Record<string, number> = {};
  for (const [k, v] of freq) freqObj[k] = v;
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO seg_chapter_freq
       (book_hash, chapter_index, content_hash, seg_version, char_count, freq_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_hash, chapter_index) DO UPDATE SET
         content_hash = excluded.content_hash,
         seg_version = excluded.seg_version,
         char_count = excluded.char_count,
         freq_json = excluded.freq_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      bookHash,
      chapterIndex,
      contentHash,
      segVersion,
      charCount,
      JSON.stringify(freqObj),
      now,
    );

  return { freq, cacheHit: false, charCount };
}

export function deleteBookSegmentCache(bookHash: string, cfg?: AIConfig): void {
  const database = openSegmentDb(cfg);
  database
    .prepare(`DELETE FROM seg_chapter_freq WHERE book_hash = ?`)
    .run(bookHash);
}

export function closeSegmentDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
    openedPath = null;
  }
}
