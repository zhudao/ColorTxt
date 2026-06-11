/** 与内链 `href` / `<span id>` 逻辑键对齐：`文件名#片段`；兼容完整 ZIP 路径键 */
export function normalizeEbookLinkKey(s: string): string {
  const t = s.trim();
  const hash = t.lastIndexOf("#");
  const frag = hash >= 0 ? t.slice(hash + 1) : "";
  const pathPart = hash >= 0 ? t.slice(0, hash) : t;
  const base =
    pathPart.replace(/\\/g, "/").split("/").pop() ?? pathPart;
  return hash >= 0 ? `${base}#${frag}` : base;
}

/**
 * 大书（数十万锚点）时避免每条目录项全表扫描。
 * 构建一次 O(n)，查询 O(1)。
 */
export type EbookAnchorLookupCache = {
  exact: ReadonlyMap<string, number>;
  lowercase: ReadonlyMap<string, number>;
  normalized: ReadonlyMap<string, number>;
  /** `epub-0005` → 该 spine 文档首个 `epub-0005#…` 锚点物理行 */
  stemFirstLine: ReadonlyMap<string, number>;
};

export function buildEbookAnchorLookupCache(
  idToPhysicalLine: ReadonlyMap<string, number>,
): EbookAnchorLookupCache {
  const lowercase = new Map<string, number>();
  const normalized = new Map<string, number>();
  const stemFirstLine = new Map<string, number>();

  for (const [k, v] of idToPhysicalLine) {
    const lowK = k.toLowerCase();
    if (!lowercase.has(lowK)) lowercase.set(lowK, v);

    const normK = normalizeEbookLinkKey(k).toLowerCase();
    if (!normalized.has(normK)) normalized.set(normK, v);

    const hash = lowK.indexOf("#");
    if (hash > 0) {
      const stem = lowK.slice(0, hash);
      const prev = stemFirstLine.get(stem);
      if (prev == null || v < prev) stemFirstLine.set(stem, v);
    }
  }

  return {
    exact: idToPhysicalLine,
    lowercase,
    normalized,
    stemFirstLine,
  };
}

export function lookupEbookAnchorPhysicalLineCached(
  cache: EbookAnchorLookupCache,
  targetId: string,
): number | undefined {
  if (cache.exact.has(targetId)) return cache.exact.get(targetId);
  const low = targetId.toLowerCase();
  const hitLow = cache.lowercase.get(low);
  if (hitLow != null) return hitLow;
  const norm = normalizeEbookLinkKey(targetId).toLowerCase();
  const hitNorm = cache.normalized.get(norm);
  if (hitNorm != null) return hitNorm;
  if (!targetId.includes("#")) {
    return cache.stemFirstLine.get(low);
  }
  const hash = norm.indexOf("#");
  if (hash > 0) {
    return cache.stemFirstLine.get(norm.slice(0, hash));
  }
  return undefined;
}

/** 与 `<span id>` 逻辑键一致；大小写、路径形式（仅文件名 vs 含目录）均尝试 */
export function lookupEbookAnchorPhysicalLine(
  idToPhysicalLine: ReadonlyMap<string, number>,
  targetId: string,
): number | undefined {
  if (idToPhysicalLine.has(targetId)) return idToPhysicalLine.get(targetId);
  const low = targetId.toLowerCase();
  for (const [k, v] of idToPhysicalLine) {
    if (k.toLowerCase() === low) return v;
  }
  const norm = normalizeEbookLinkKey(targetId).toLowerCase();
  for (const [k, v] of idToPhysicalLine) {
    if (normalizeEbookLinkKey(k).toLowerCase() === norm) return v;
  }
  return undefined;
}
