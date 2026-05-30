import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import type { AIChunkRecord, AIIndexSearchHit } from "@shared/aiTypes";
import { resolveSqliteVecLoadPath } from "./resolveSqliteVecPath";
import {
  bootstrapFilePath,
  defaultAiDataCacheRoot,
  legacyVectorDbPath,
} from "./aiPaths";
import { app } from "electron";

let db: Database.Database | null = null;
let openedDim = 0;
let openedDbPath: string | null = null;

function readDataCacheRootBootstrapSync(): string | null {
  try {
    const buf = readFileSync(bootstrapFilePath(), "utf-8");
    const o = JSON.parse(buf) as { dataCacheDir?: string };
    const p = typeof o.dataCacheDir === "string" ? o.dataCacheDir.trim() : "";
    return p || null;
  } catch {
    return null;
  }
}

export function resolveVectorDbPathSync(): string {
  const boot = readDataCacheRootBootstrapSync();
  if (boot) return path.join(path.resolve(boot), "vector.sqlite");
  const userData = app.getPath("userData");
  const legacy = legacyVectorDbPath(userData);
  if (existsSync(legacy)) return legacy;
  return path.join(defaultAiDataCacheRoot(userData), "vector.sqlite");
}

function dbPath(): string {
  return openedDbPath ?? resolveVectorDbPathSync();
}

export function closeAiVectorDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
    openedDim = 0;
    openedDbPath = null;
  }
}

export function reopenAiVectorDb(embeddingDim: number): Database.Database {
  closeAiVectorDb();
  return openOrRecreateAiVectorDb(embeddingDim);
}

function migrateMessagesForAgent(database: Database.Database) {
  const rows = database
    .prepare(`PRAGMA table_info(messages)`)
    .all() as Array<{ name: string }>;
  const set = new Set(rows.map((r) => r.name));
  const addCol = (col: string, ddl: string) => {
    if (!set.has(col)) {
      database.exec(ddl);
      set.add(col);
    }
  };
  addCol("tool_call_id", `ALTER TABLE messages ADD COLUMN tool_call_id TEXT`);
  addCol("tool_name", `ALTER TABLE messages ADD COLUMN tool_name TEXT`);
  addCol(
    "tool_calls_json",
    `ALTER TABLE messages ADD COLUMN tool_calls_json TEXT`,
  );
  addCol("payload", `ALTER TABLE messages ADD COLUMN payload TEXT`);
}

function migrateThreadsTitleLocked(database: Database.Database) {
  const rows = database
    .prepare(`PRAGMA table_info(threads)`)
    .all() as Array<{ name: string }>;
  const set = new Set(rows.map((r) => r.name));
  if (!set.has("title_locked")) {
    database.exec(
      `ALTER TABLE threads ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

function createBaseTables(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      book_hash TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL,
      content TEXT NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_hash);

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      book_hash TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      aborted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
  `);
}

function dropVecTables(database: Database.Database) {
  database.exec(`
    DROP TABLE IF EXISTS vec_embeddings;
    DROP TABLE IF EXISTS id_mapping;
    DELETE FROM chunks;
  `);
}

function createVecTables(database: Database.Database, dim: number) {
  database.exec(`
    CREATE TABLE id_mapping (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE NOT NULL,
      book_hash TEXT NOT NULL
    );
  `);
  database.exec(
    `CREATE VIRTUAL TABLE vec_embeddings USING vec0(embedding float[${dim}]);`,
  );
  database
    .prepare(
      `INSERT INTO ai_meta(key, value) VALUES ('embedding_dim', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(dim));
}

function ensureVecLayer(database: Database.Database, embeddingDim: number) {
  const row = database
    .prepare(`SELECT value FROM ai_meta WHERE key = 'embedding_dim'`)
    .get() as { value: string } | undefined;
  const stored = row ? Number.parseInt(row.value, 10) : NaN;
  const vecTbl = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='vec_embeddings'`,
    )
    .get();

  const needRebuild =
    !vecTbl || !Number.isFinite(stored) || stored !== embeddingDim;

  if (needRebuild) {
    dropVecTables(database);
    createVecTables(database, embeddingDim);
  }
}

export function openOrRecreateAiVectorDb(embeddingDim: number): Database.Database {
  if (db && openedDim === embeddingDim) return db;
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
    openedDim = 0;
    openedDbPath = null;
  }

  const file = dbPath();
  mkdirSync(path.dirname(file), { recursive: true });

  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  createBaseTables(database);
  migrateMessagesForAgent(database);
  migrateThreadsTitleLocked(database);
  database.loadExtension(resolveSqliteVecLoadPath());
  ensureVecLayer(database, embeddingDim);

  db = database;
  openedDim = embeddingDim;
  openedDbPath = file;
  return database;
}

export function getAiVectorDb(): Database.Database {
  if (!db) throw new Error("AI vector DB not opened");
  return db;
}

/** 维度变更：清空向量索引与 chunks，保留会话表 */
export function resetEmbeddingDimension(newDim: number): void {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
    openedDim = 0;
    openedDbPath = null;
  }

  const file = dbPath();
  mkdirSync(path.dirname(file), { recursive: true });

  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  createBaseTables(database);
  migrateMessagesForAgent(database);
  migrateThreadsTitleLocked(database);
  database.loadExtension(resolveSqliteVecLoadPath());
  dropVecTables(database);
  createVecTables(database, newDim);

  db = database;
  openedDim = newDim;
  openedDbPath = file;
}

export function indexHasBook(bookHash: string): boolean {
  const database = getAiVectorDb();
  const row = database
    .prepare(`SELECT 1 FROM chunks WHERE book_hash = ? LIMIT 1`)
    .get(bookHash);
  return Boolean(row);
}

export function deleteBookIndex(bookHash: string): void {
  const database = getAiVectorDb();
  const ids = database
    .prepare(`SELECT id FROM chunks WHERE book_hash = ?`)
    .all(bookHash) as { id: string }[];

  const tx = database.transaction(() => {
    for (const { id } of ids) {
      const r = database
        .prepare(`SELECT rowid FROM id_mapping WHERE chunk_id = ?`)
        .get(id) as { rowid: number } | undefined;
      if (r) {
        database.prepare(`DELETE FROM vec_embeddings WHERE rowid = ?`).run(r.rowid);
      }
      database.prepare(`DELETE FROM id_mapping WHERE chunk_id = ?`).run(id);
    }
    database.prepare(`DELETE FROM chunks WHERE book_hash = ?`).run(bookHash);
  });
  tx();
}

export function insertChunksBatch(records: AIChunkRecord[]): void {
  if (records.length === 0) return;
  const database = getAiVectorDb();
  const now = Date.now();
  const insChunk = database.prepare(`
    INSERT INTO chunks (id, book_hash, chapter_index, chapter_title, content, char_start, char_end, token_count, updated_at)
    VALUES (@id, @book_hash, @chapter_index, @chapter_title, @content, @char_start, @char_end, @token_count, @updated_at)
  `);
  const insMap = database.prepare(
    `INSERT INTO id_mapping (chunk_id, book_hash) VALUES (?, ?)`,
  );
  const insVec = database.prepare(
    `INSERT INTO vec_embeddings (rowid, embedding) VALUES (?, ?)`,
  );

  const tx = database.transaction(() => {
    for (const r of records) {
      insChunk.run({
        id: r.id,
        book_hash: r.bookHash,
        chapter_index: r.chapterIndex,
        chapter_title: r.chapterTitle,
        content: r.content,
        char_start: r.charStart,
        char_end: r.charEnd,
        token_count: r.tokenCount,
        updated_at: now,
      });
      const info = insMap.run(r.id, r.bookHash);
      const rowid = Number(info.lastInsertRowid);
      insVec.run(BigInt(rowid), new Float32Array(r.embedding));
    }
  });
  tx();
}

export function searchChunks(
  bookHash: string,
  queryEmbedding: number[],
  topK: number,
): AIIndexSearchHit[] {
  const database = getAiVectorDb();
  const q = new Float32Array(queryEmbedding);
  /** vec0 KNN 必须在 MATCH 上使用 `k = ?`；与 id_mapping JOIN 时外层 LIMIT 无法下推，会报错（见 sqlite-vec #96）。先全局取足够多的近邻，再按书过滤。 */
  const knnCap = Math.min(2048, Math.max(64, topK * 40));
  const rows = database
    .prepare(
      `
      WITH knn_matches AS (
        SELECT v.rowid AS rowid, v.distance AS distance
        FROM vec_embeddings v
        WHERE v.embedding MATCH ?
          AND k = ?
      )
      SELECT m.chunk_id AS chunkId, knn_matches.distance AS distance
      FROM knn_matches
      INNER JOIN id_mapping m
        ON knn_matches.rowid = m.rowid AND m.book_hash = ?
      ORDER BY knn_matches.distance
      LIMIT ?
    `,
    )
    .all(q, knnCap, bookHash, topK) as { chunkId: string; distance: number }[];

  if (rows.length === 0) return [];

  const chunkStmt = database.prepare(
    `SELECT id, chapter_index, chapter_title, content, char_start, char_end FROM chunks WHERE id = ?`,
  );

  const hits: AIIndexSearchHit[] = [];
  for (const row of rows) {
    const c = chunkStmt.get(row.chunkId) as
      | {
          id: string;
          chapter_index: number;
          chapter_title: string;
          content: string;
          char_start: number;
          char_end: number;
        }
      | undefined;
    if (!c) continue;
    hits.push({
      chunkId: c.id,
      chapterIndex: c.chapter_index,
      chapterTitle: c.chapter_title,
      content: c.content,
      charStart: c.char_start,
      charEnd: c.char_end,
      distance: row.distance,
    });
  }
  return hits;
}

export type ChapterChunkRow = {
  chunkId: string;
  chapterIndex: number;
  chapterTitle: string;
  content: string;
  charStart: number;
  charEnd: number;
};

/** 按阅读顺序列出某章全部分块（不含向量） */
export function listChunksForChapter(
  bookHash: string,
  chapterIndex: number,
): ChapterChunkRow[] {
  const database = getAiVectorDb();
  const rows = database
    .prepare(
      `SELECT id AS chunkId, chapter_index AS chapterIndex, chapter_title AS chapterTitle,
              content, char_start AS charStart, char_end AS charEnd
       FROM chunks
       WHERE book_hash = ? AND chapter_index = ?
       ORDER BY char_start ASC`,
    )
    .all(bookHash, chapterIndex) as ChapterChunkRow[];
  return rows;
}

export function listThreads(bookHash: string) {
  const database = getAiVectorDb();
  return database
    .prepare(
      `SELECT t.id, t.book_hash AS bookHash, t.title,
              t.created_at AS createdAt, t.updated_at AS updatedAt,
              t.title_locked AS titleLocked
       FROM threads t
       WHERE t.book_hash = ?
         AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id)
       ORDER BY t.updated_at DESC`,
    )
    .all(bookHash) as Array<{
      id: string;
      bookHash: string;
      title: string;
      createdAt: number;
      updatedAt: number;
      titleLocked: number;
    }>;
}

export function createThread(bookHash: string, title: string): string {
  const database = getAiVectorDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO threads (id, book_hash, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, bookHash, title, now, now);
  return id;
}

/** userChosen：用户手动改名时置 title_locked，不再按首条消息自动起名 */
export function renameThread(
  threadId: string,
  title: string,
  userChosen = false,
): void {
  const database = getAiVectorDb();
  const now = Date.now();
  if (userChosen) {
    database
      .prepare(
        `UPDATE threads SET title = ?, updated_at = ?, title_locked = 1 WHERE id = ?`,
      )
      .run(title, now, threadId);
  } else {
    database
      .prepare(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, now, threadId);
  }
}

export function touchThread(threadId: string): void {
  const database = getAiVectorDb();
  database
    .prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`)
    .run(Date.now(), threadId);
}

export function deleteThread(threadId: string): void {
  const database = getAiVectorDb();
  database.prepare(`DELETE FROM threads WHERE id = ?`).run(threadId);
}

/**
 * 删除该书下无任何消息的会话。
 * @param exceptThreadId 保留该 id（例如当前「新对话」草稿）；不传则删除该书全部空会话。
 */
export function deleteEmptyThreadsForBook(
  bookHash: string,
  exceptThreadId?: string | null,
): void {
  const database = getAiVectorDb();
  if (exceptThreadId) {
    database
      .prepare(
        `DELETE FROM threads
         WHERE book_hash = ?
           AND NOT EXISTS (SELECT 1 FROM messages WHERE thread_id = threads.id)
           AND id != ?`,
      )
      .run(bookHash, exceptThreadId);
  } else {
    database
      .prepare(
        `DELETE FROM threads
         WHERE book_hash = ?
           AND NOT EXISTS (SELECT 1 FROM messages WHERE thread_id = threads.id)`,
      )
      .run(bookHash);
  }
}

export function listMessages(threadId: string) {
  const database = getAiVectorDb();
  return database
    .prepare(
      `SELECT id, thread_id AS threadId, role, content, created_at AS createdAt, aborted AS abortedNum,
              tool_call_id AS toolCallId, tool_name AS toolName, tool_calls_json AS toolCallsJson, payload AS payload
       FROM messages WHERE thread_id = ? ORDER BY created_at ASC`,
    )
    .all(threadId) as Array<{
      id: string;
      threadId: string;
      role: string;
      content: string;
      createdAt: number;
      abortedNum: number;
      toolCallId: string | null;
      toolName: string | null;
      toolCallsJson: string | null;
      payload: string | null;
    }>;
}

export function appendMessage(
  threadId: string,
  role: "user" | "assistant" | "system",
  content: string,
  aborted = false,
): string {
  return appendAgentMessageRow({
    threadId,
    role,
    content,
    aborted,
  });
}

/** 更新已落库 tool 消息的 content（如词云 layoutSeed） */
export function updateToolMessageContent(
  threadId: string,
  toolCallId: string,
  content: string,
): boolean {
  const database = getAiVectorDb();
  const info = database
    .prepare(
      `UPDATE messages SET content = ?
       WHERE thread_id = ? AND tool_call_id = ? AND role = 'tool'`,
    )
    .run(content, threadId, toolCallId);
  if (info.changes > 0) {
    touchThread(threadId);
    return true;
  }
  return false;
}

export function appendAgentMessageRow(opts: {
  threadId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  aborted?: boolean;
  toolCallId?: string | null;
  toolName?: string | null;
  toolCallsJson?: string | null;
  payload?: string | null;
}): string {
  const database = getAiVectorDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO messages (id, thread_id, role, content, created_at, aborted, tool_call_id, tool_name, tool_calls_json, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.threadId,
      opts.role,
      opts.content,
      now,
      opts.aborted ? 1 : 0,
      opts.toolCallId ?? null,
      opts.toolName ?? null,
      opts.toolCallsJson ?? null,
      opts.payload ?? null,
    );
  touchThread(opts.threadId);
  return id;
}
