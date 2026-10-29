import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";
import type {
  BookSourceImportPreviewItem,
  BookSourceListItem,
  BookSourceRecord,
} from "@shared/bookSource/types";
import { isTextBookSource } from "@shared/bookSource/types";

let db: Database.Database | null = null;

function dbPath(): string {
  return path.join(app.getPath("userData"), "book-sources.db");
}

function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath());
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS book_sources (
        book_source_url TEXT PRIMARY KEY,
        book_source_name TEXT NOT NULL,
        book_source_group TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        book_source_type INTEGER NOT NULL DEFAULT 0,
        last_update_time INTEGER NOT NULL DEFAULT 0,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_book_sources_enabled ON book_sources(enabled);
      CREATE TABLE IF NOT EXISTS book_source_login (
        book_source_url TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS book_source_cache (
        book_source_url TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        cache_value TEXT NOT NULL,
        PRIMARY KEY (book_source_url, cache_key)
      );
      CREATE TABLE IF NOT EXISTS book_source_cookies (
        domain TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
    `);
  }
  return db;
}

export function closeBookSourceStore(): void {
  db?.close();
  db = null;
}

function rowToRecord(row: { json: string }): BookSourceRecord {
  return JSON.parse(row.json) as BookSourceRecord;
}

export function listBookSources(): BookSourceListItem[] {
  const rows = getDb()
    .prepare(`SELECT json, enabled, last_update_time FROM book_sources`)
    .all() as Array<{ json: string; enabled: number; last_update_time: number }>;

  const items = rows.map((row) => {
    const rec = rowToRecord(row);
    return {
      bookSourceUrl: rec.bookSourceUrl,
      bookSourceName: rec.bookSourceName,
      bookSourceGroup: rec.bookSourceGroup,
      enabled: Boolean(row.enabled),
      bookSourceType: rec.bookSourceType,
      lastUpdateTime: row.last_update_time,
      customOrder: rec.customOrder ?? 0,
      hasLoginUrl: Boolean(rec.loginUrl?.trim()),
      hasSearchUrl: Boolean(rec.searchUrl?.trim()),
      hasExploreUrl: Boolean(rec.exploreUrl?.trim()),
      enabledExplore: rec.enabledExplore !== false,
      respondTime: rec.respondTime,
      weight: rec.weight,
    };
  });

  items.sort((a, b) => {
    const order = a.customOrder - b.customOrder;
    if (order !== 0) return order;
    return a.bookSourceName.localeCompare(b.bookSourceName, "zh-CN");
  });
  return items;
}

function listCustomOrders(): number[] {
  const rows = getDb()
    .prepare(`SELECT json FROM book_sources`)
    .all() as { json: string }[];
  return rows.map((r) => rowToRecord(r).customOrder ?? 0);
}

export function moveBookSourceToTop(url: string): void {
  const source = getBookSource(url);
  if (!source) return;
  const orders = listCustomOrders();
  const min = orders.length ? Math.min(...orders) : 0;
  saveBookSource({ ...source, customOrder: min - 1 });
}

export function moveBookSourceToBottom(url: string): void {
  const source = getBookSource(url);
  if (!source) return;
  const orders = listCustomOrders();
  const max = orders.length ? Math.max(...orders) : 0;
  saveBookSource({ ...source, customOrder: max + 1 });
}

/** 批量写入 customOrder（拖拽手动排序） */
export function applyBookSourceCustomOrders(
  updates: Array<{ url: string; customOrder: number }>,
): void {
  if (!updates.length) return;
  const run = getDb().transaction(() => {
    for (const u of updates) {
      const source = getBookSource(u.url);
      if (!source) continue;
      saveBookSource({ ...source, customOrder: u.customOrder });
    }
  });
  run();
}

export function listEnabledTextSources(): BookSourceRecord[] {
  const rows = getDb()
    .prepare(`SELECT json FROM book_sources WHERE enabled = 1`)
    .all() as { json: string }[];
  return rows
    .map(rowToRecord)
    .filter(isTextBookSource);
}

export function getBookSource(url: string): BookSourceRecord | null {
  const row = getDb()
    .prepare(`SELECT json FROM book_sources WHERE book_source_url = ?`)
    .get(url) as { json: string } | undefined;
  return row ? rowToRecord(row) : null;
}

export function saveBookSource(source: BookSourceRecord): void {
  if (!isTextBookSource(source)) {
    throw new Error("仅支持文本类型书源");
  }
  const now = Date.now();
  const existing = getBookSource(source.bookSourceUrl);
  let customOrder = source.customOrder;
  if (!existing) {
    // 新建：无有效 customOrder 时插入列表顶部（越小越靠前，对齐「置顶」）
    if (customOrder == null || !Number.isFinite(customOrder)) {
      const orders = listCustomOrders();
      const min = orders.length ? Math.min(...orders) : 0;
      customOrder = min - 1;
    }
  } else if (customOrder == null || !Number.isFinite(customOrder)) {
    customOrder = existing.customOrder ?? 0;
  }
  const record: BookSourceRecord = {
    ...source,
    customOrder,
    lastUpdateTime: source.lastUpdateTime ?? now,
    enabled: source.enabled !== false,
    bookSourceType: 0,
  };
  getDb()
    .prepare(
      `INSERT INTO book_sources (book_source_url, book_source_name, book_source_group, enabled, book_source_type, last_update_time, json)
       VALUES (@bookSourceUrl, @bookSourceName, @bookSourceGroup, @enabled, @bookSourceType, @lastUpdateTime, @json)
       ON CONFLICT(book_source_url) DO UPDATE SET
         book_source_name = excluded.book_source_name,
         book_source_group = excluded.book_source_group,
         enabled = excluded.enabled,
         book_source_type = excluded.book_source_type,
         last_update_time = excluded.last_update_time,
         json = excluded.json`,
    )
    .run({
      bookSourceUrl: record.bookSourceUrl,
      bookSourceName: record.bookSourceName,
      bookSourceGroup: record.bookSourceGroup ?? null,
      enabled: record.enabled ? 1 : 0,
      bookSourceType: record.bookSourceType,
      lastUpdateTime: record.lastUpdateTime ?? now,
      json: JSON.stringify(record),
    });
}

export function deleteBookSources(urls: string[]): number {
  if (urls.length === 0) return 0;
  const placeholders = urls.map(() => "?").join(",");
  const info = getDb()
    .prepare(`DELETE FROM book_sources WHERE book_source_url IN (${placeholders})`)
    .run(...urls);
  return info.changes;
}

export function toggleBookSource(url: string, enabled: boolean): void {
  getDb()
    .prepare(`UPDATE book_sources SET enabled = ? WHERE book_source_url = ?`)
    .run(enabled ? 1 : 0, url);
  const existing = getBookSource(url);
  if (existing) {
    saveBookSource({ ...existing, enabled });
  }
}

export function importPreview(
  sources: BookSourceRecord[],
): BookSourceImportPreviewItem[] {
  return sources.filter(isTextBookSource).map((source) => {
    const local = getBookSource(source.bookSourceUrl);
    let status: BookSourceImportPreviewItem["status"] = "new";
    if (local) {
      const remoteTime = source.lastUpdateTime ?? 0;
      const localTime = local.lastUpdateTime ?? 0;
      status = remoteTime > localTime ? "update" : "exists";
    }
    return { source, status };
  });
}

export function importCommit(payload: {
  addUrls: string[];
  updateUrls: string[];
  sources: BookSourceRecord[];
}): { added: number; updated: number } {
  const addSet = new Set(payload.addUrls);
  const updateSet = new Set(payload.updateUrls);
  let added = 0;
  let updated = 0;
  for (const source of payload.sources) {
    if (!isTextBookSource(source)) continue;
    if (addSet.has(source.bookSourceUrl)) {
      saveBookSource(source);
      added += 1;
    } else if (updateSet.has(source.bookSourceUrl)) {
      saveBookSource(source);
      updated += 1;
    }
  }
  return { added, updated };
}

export function getLoginInfo(url: string): Record<string, string> {
  const row = getDb()
    .prepare(`SELECT json FROM book_source_login WHERE book_source_url = ?`)
    .get(url) as { json: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.json) as Record<string, string>;
  } catch {
    return {};
  }
}

export function setLoginInfo(url: string, info: Record<string, string>): void {
  getDb()
    .prepare(
      `INSERT INTO book_source_login (book_source_url, json) VALUES (?, ?)
       ON CONFLICT(book_source_url) DO UPDATE SET json = excluded.json`,
    )
    .run(url, JSON.stringify(info));
}

export function getCacheValue(sourceUrl: string, key: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT cache_value FROM book_source_cache WHERE book_source_url = ? AND cache_key = ?`,
    )
    .get(sourceUrl, key) as { cache_value: string } | undefined;
  return row?.cache_value ?? null;
}

export function putCacheValue(
  sourceUrl: string,
  key: string,
  value: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO book_source_cache (book_source_url, cache_key, cache_value) VALUES (?, ?, ?)
       ON CONFLICT(book_source_url, cache_key) DO UPDATE SET cache_value = excluded.cache_value`,
    )
    .run(sourceUrl, key, value);
}

export function removeCacheValue(sourceUrl: string, key: string): void {
  getDb()
    .prepare(
      `DELETE FROM book_source_cache WHERE book_source_url = ? AND cache_key = ?`,
    )
    .run(sourceUrl, key);
}

const LOGIN_HEADER_KEY = "loginHeader";

export function getLoginHeader(sourceUrl: string): string | null {
  return getCacheValue(sourceUrl, LOGIN_HEADER_KEY);
}

export function putLoginHeader(sourceUrl: string, headerJson: string): void {
  putCacheValue(sourceUrl, LOGIN_HEADER_KEY, headerJson);
}

export function removeLoginHeader(sourceUrl: string): void {
  getDb()
    .prepare(
      `DELETE FROM book_source_cache WHERE book_source_url = ? AND cache_key = ?`,
    )
    .run(sourceUrl, LOGIN_HEADER_KEY);
}

/**
 * 书源级「已完成登录确认」标记（非域名 Cookie）。
 * 搜索启发式弹窗依赖此标记，避免匿名 Set-Cookie 被误判为已登录。
 */
const LOGIN_SESSION_ACK_KEY = "loginSessionAck";

export function getLoginSessionAck(sourceUrl: string): boolean {
  return getCacheValue(sourceUrl, LOGIN_SESSION_ACK_KEY) === "1";
}

export function setLoginSessionAck(sourceUrl: string): void {
  putCacheValue(sourceUrl, LOGIN_SESSION_ACK_KEY, "1");
}

export function clearLoginSessionAck(sourceUrl: string): void {
  removeCacheValue(sourceUrl, LOGIN_SESSION_ACK_KEY);
}

/** Legado BaseSource：sourceVariable_${getKey()} */
const SOURCE_VARIABLE_CACHE_KEY = "sourceVariable";

export function getSourceVariable(sourceUrl: string): string {
  return getCacheValue(sourceUrl, SOURCE_VARIABLE_CACHE_KEY) ?? "";
}

export function setSourceVariable(
  sourceUrl: string,
  variable: string | null | undefined,
): void {
  if (variable == null || variable === "") {
    removeCacheValue(sourceUrl, SOURCE_VARIABLE_CACHE_KEY);
    return;
  }
  putCacheValue(sourceUrl, SOURCE_VARIABLE_CACHE_KEY, variable);
}

/** Legado Book.variable JSON 中的 custom 字段，或整段自由文本（按 bookUrl 缓存） */
const BOOK_VARIABLE_CACHE_KEY = "variable";

export function getBookCustomVariable(bookUrl: string): string {
  const raw = getCacheValue(bookUrl, BOOK_VARIABLE_CACHE_KEY);
  if (!raw) return "";
  // 旧版仅存 { custom }；部分书源等书源把整段正文累加在 variable 字符串里
  if (!raw.trim().startsWith("{")) return raw;
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    if (typeof obj.custom === "string") return obj.custom;
    // 误写入的 { url: bookUrl } 等导航残留，不当正文
    const keys = Object.keys(obj).filter((k) => k !== "get");
    if (keys.length === 1 && keys[0] === "url") return "";
    return raw;
  } catch {
    return raw;
  }
}

export function setBookCustomVariable(
  bookUrl: string,
  custom: string | null | undefined,
): void {
  if (custom == null || custom === "") {
    removeCacheValue(bookUrl, BOOK_VARIABLE_CACHE_KEY);
    return;
  }
  putCacheValue(bookUrl, BOOK_VARIABLE_CACHE_KEY, custom);
}

export function getCookieJar(domain: string): Record<string, string> {
  const row = getDb()
    .prepare(`SELECT json FROM book_source_cookies WHERE domain = ?`)
    .get(domain) as { json: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.json) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveCookieJar(domain: string, cookies: Record<string, string>): void {
  getDb()
    .prepare(
      `INSERT INTO book_source_cookies (domain, json) VALUES (?, ?)
       ON CONFLICT(domain) DO UPDATE SET json = excluded.json`,
    )
    .run(domain, JSON.stringify(cookies));
}
