import type { AIMindmapToolResult } from "@shared/aiTypes";

export type UiMindmapAttachment = {
  title: string;
  markdown: string;
  stats?: { nodeCount: number; maxDepth: number };
};

export function parseMindmapToolResult(
  full: string,
): UiMindmapAttachment | null {
  const raw = full.trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (r.type !== "mindmap") return null;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const markdown = typeof r.markdown === "string" ? r.markdown : "";
    if (!title || !markdown.trim()) return null;
    let stats: UiMindmapAttachment["stats"];
    if (r.stats && typeof r.stats === "object") {
      const s = r.stats as Record<string, unknown>;
      if (
        typeof s.nodeCount === "number" &&
        typeof s.maxDepth === "number"
      ) {
        stats = { nodeCount: s.nodeCount, maxDepth: s.maxDepth };
      }
    }
    return { title, markdown, stats };
  } catch {
    return null;
  }
}

export function isMindmapToolResult(
  o: unknown,
): o is AIMindmapToolResult {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  return (
    r.type === "mindmap" &&
    typeof r.title === "string" &&
    typeof r.markdown === "string"
  );
}
