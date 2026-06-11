/** 转换时从 NCX/nav 解析的目录项（用于 ATX 标题注入） */

import { stemFromEbookTargetId } from "./ebookSpineLineMatch";

export type EmbeddedTocEntry = {
  title: string;
  targetId: string;
  /** 0 = 顶栏，1+ = 子级（侧栏缩进） */
  level: number;
};

/** 去掉 nav/NCX 误解析产生的扁平重复项 */
export function dedupeEmbeddedTocEntries(
  entries: readonly EmbeddedTocEntry[],
): EmbeddedTocEntry[] {
  if (entries.length <= 1) return [...entries];

  const maxLevelByKey = new Map<string, number>();
  for (const e of entries) {
    const key = `${stemFromEbookTargetId(e.targetId)}\u0000${e.title.trim()}`;
    maxLevelByKey.set(key, Math.max(maxLevelByKey.get(key) ?? -1, e.level));
  }

  const keptKeys = new Set<string>();
  const out: EmbeddedTocEntry[] = [];
  for (const e of entries) {
    const key = `${stemFromEbookTargetId(e.targetId)}\u0000${e.title.trim()}`;
    if (e.level < (maxLevelByKey.get(key) ?? 0)) continue;
    if (keptKeys.has(key)) continue;
    keptKeys.add(key);
    out.push(e);
  }
  return out;
}

/** foliate 式 `{ label, href, subitems }` 树 → 扁平目录项 */
export function flattenFoliateStyleTocTree(
  items: readonly {
    label?: string;
    href?: string;
    subitems?: readonly unknown[];
  }[],
  resolveHref: (href: string) => string | null,
  level = 0,
  out: EmbeddedTocEntry[] = [],
): EmbeddedTocEntry[] {
  for (const item of items) {
    const title = item.label?.replace(/\s+/g, " ").trim();
    const href = item.href?.trim();
    if (title && href) {
      const targetId = resolveHref(href);
      if (targetId) {
        out.push({ title, targetId, level });
      }
    }
    const subs = item.subitems;
    if (Array.isArray(subs) && subs.length > 0) {
      flattenFoliateStyleTocTree(
        subs as { label?: string; href?: string; subitems?: readonly unknown[] }[],
        resolveHref,
        level + 1,
        out,
      );
    }
  }
  return out;
}
