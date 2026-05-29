import type { AIMindmapToolResult } from "@shared/aiTypes";

/** Convert mermaid mindmap syntax to markmap Markdown heading format */
export function convertMermaidMindmapToMarkdown(
  mermaidText: string,
  fallbackTitle: string,
): string {
  const text = mermaidText
    .replace(/```mermaid\s*/g, "")
    .replace(/```\s*/g, "")
    .replace(/^mindmap\s*/m, "")
    .trim();

  const lines = text.split("\n");
  const result: string[] = [];

  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    if (indent >= 0 && indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.search(/\S/);
    const depth = Math.floor((indent - minIndent) / 2);

    const cleanText = trimmed
      .replace(/^\((.+)\)$/, "$1")
      .replace(/^\[(.+)\]$/, "$1")
      .replace(/^\{(.+)\}$/, "$1")
      .replace(/^["'](.+)["']$/, "$1");

    if (depth === 0) {
      result.push(`# ${cleanText}`);
    } else if (depth === 1) {
      result.push(`## ${cleanText}`);
    } else if (depth === 2) {
      result.push(`### ${cleanText}`);
    } else if (depth === 3) {
      result.push(`#### ${cleanText}`);
    } else {
      const listIndent = "  ".repeat(Math.max(0, depth - 4));
      result.push(`${listIndent}- ${cleanText}`);
    }
  }

  if (result.length === 0) {
    return `# ${fallbackTitle}`;
  }

  return result.join("\n");
}

function countMindmapStats(markdown: string): {
  nodeCount: number;
  maxDepth: number;
} {
  const lines = markdown.split("\n").filter((l) => l.trim());
  const nodeCount = lines.length;
  const maxDepth = lines.reduce((max, line) => {
    const headingMatch = line.match(/^(#{1,6})\s/);
    const listMatch = line.match(/^(\s*)-\s/);
    if (headingMatch) return Math.max(max, headingMatch[1].length);
    if (listMatch) return Math.max(max, 7 + Math.floor(listMatch[1].length / 2));
    return max;
  }, 0);
  return { nodeCount, maxDepth };
}

export function runMindmapTool(args: Record<string, unknown>): AIMindmapToolResult {
  const title = String(args.title ?? "").trim();
  let markdown = String(args.markdown ?? "").trim();
  if (!title) throw new Error("缺少有效的 title");
  if (!markdown) throw new Error("缺少有效的 markdown");

  if (
    markdown.startsWith("mindmap") ||
    markdown.startsWith("```mermaid")
  ) {
    markdown = convertMermaidMindmapToMarkdown(markdown, title);
  }

  const stats = countMindmapStats(markdown);
  return {
    type: "mindmap",
    title,
    markdown,
    stats,
  };
}
