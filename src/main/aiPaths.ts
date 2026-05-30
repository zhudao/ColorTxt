import { app } from "electron";
import path from "node:path";
import type { AIConfig } from "@shared/aiTypes";

export const AI_DATA_SUBDIR = "ai";
export const AI_DATA_CACHE_DEFAULT_SUBDIR = "data";
export const AI_MODEL_CACHE_DEFAULT_SUBDIR = "model-cache";
export const AI_DATA_CACHE_BOOTSTRAP_FILE = "data-cache-root.json";

export function defaultAiDataCacheRoot(userDataAbs: string): string {
  return path.join(userDataAbs, AI_DATA_SUBDIR, AI_DATA_CACHE_DEFAULT_SUBDIR);
}

export function defaultBuiltinModelCacheRoot(userDataAbs: string): string {
  return path.join(userDataAbs, AI_DATA_SUBDIR, AI_MODEL_CACHE_DEFAULT_SUBDIR);
}

export function bootstrapFilePath(): string {
  return path.join(
    app.getPath("userData"),
    AI_DATA_SUBDIR,
    AI_DATA_CACHE_BOOTSTRAP_FILE,
  );
}

export function legacyAiConfigPath(userDataAbs: string): string {
  return path.join(userDataAbs, AI_DATA_SUBDIR, "config.json");
}

export function legacyVectorDbPath(userDataAbs: string): string {
  return path.join(userDataAbs, AI_DATA_SUBDIR, "vector.sqlite");
}

export function resolveAiDataCacheRoot(cfg?: AIConfig): string {
  const trimmed = cfg?.aiDataCacheDir?.trim();
  if (trimmed) return path.resolve(trimmed);
  return defaultAiDataCacheRoot(app.getPath("userData"));
}

export function aiConfigFilePath(cfg?: AIConfig): string {
  return path.join(resolveAiDataCacheRoot(cfg), "config.json");
}

export function vectorDbFilePath(cfg?: AIConfig): string {
  return path.join(resolveAiDataCacheRoot(cfg), "vector.sqlite");
}

export function resolveBuiltinModelCacheRoot(cfg: AIConfig): string {
  const trimmed = cfg.embedding.builtinModelCacheDir?.trim();
  if (trimmed) return path.resolve(trimmed);
  return defaultBuiltinModelCacheRoot(app.getPath("userData"));
}

export function transformersCacheDirForModelRoot(modelCacheRoot: string): string {
  return path.join(modelCacheRoot, "transformers-cache");
}

export const VECTOR_SQLITE_BUNDLE_FILES = [
  "vector.sqlite",
  "vector.sqlite-wal",
  "vector.sqlite-shm",
] as const;

export const SEGMENT_SQLITE_BUNDLE_FILES = [
  "segment.sqlite",
  "segment.sqlite-wal",
  "segment.sqlite-shm",
] as const;

export function segmentDbFilePath(cfg?: AIConfig): string {
  return path.join(resolveAiDataCacheRoot(cfg), "segment.sqlite");
}

export const AI_DATA_CACHE_MIGRATE_FILES = [
  "config.json",
  ...VECTOR_SQLITE_BUNDLE_FILES,
] as const;
