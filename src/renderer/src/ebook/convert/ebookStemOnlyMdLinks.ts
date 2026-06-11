/**
 * 转换后处理：stem-only 内链 `[…](#epub-NNNN)` → 精确 fragment，并在目标节注入 `<span id>`.
 */

import {
  EbookMarkdownFragmentRegistry,
  formatSpanAnchor,
  globalFragmentForLogicalTarget,
  mdInternalLinkForLogicalTarget,
} from "./ebookMarkdownEmit";
import {
  applyLineMutations,
  findTitleLineInSpineSection,
  sectionRangeByStem,
  type EpubSpineSectionRange,
  type LineMutation,
} from "./ebookSpineLineMatch";

const STEM_ONLY_FRAG_RE = /^(?:epub|mobi)-\d{4}$/i;
const RE_MD_INTERNAL_LINK =
  /\[([^\]]*)\]\((#[^)\s"]+)(?:\s+"((?:\\.|[^"\\])*)")?\)/g;

type ParsedMdLink = {
  start: number;
  end: number;
  label: string;
  fragment: string;
  titleAttr?: string;
};

function parseMdLinksOnLine(line: string): ParsedMdLink[] {
  const out: ParsedMdLink[] = [];
  let m: RegExpExecArray | null;
  RE_MD_INTERNAL_LINK.lastIndex = 0;
  while ((m = RE_MD_INTERNAL_LINK.exec(line)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0]!.length,
      label: m[1] ?? "",
      fragment: (m[2] ?? "").replace(/^#/, ""),
      titleAttr: m[3],
    });
  }
  return out;
}

function unescapeMdTitleAttr(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function replaceMdLinkFragment(
  line: string,
  link: ParsedMdLink,
  logicalTargetId: string,
  registry: EbookMarkdownFragmentRegistry,
): string {
  const titleAlt = link.titleAttr
    ? unescapeMdTitleAttr(link.titleAttr)
    : undefined;
  const slash = titleAlt?.indexOf("/") ?? -1;
  const title = slash >= 0 ? titleAlt!.slice(0, slash) : titleAlt;
  const alt = slash >= 0 ? titleAlt!.slice(slash + 1) : undefined;
  const preferredFrag = logicalTargetId.slice(
    logicalTargetId.lastIndexOf("#") + 1,
  );
  const replacement = mdInternalLinkForLogicalTarget(
    registry,
    logicalTargetId,
    {
      label: link.label,
      title,
      alt,
      preferredFrag,
    },
  );
  return line.slice(0, link.start) + replacement + line.slice(link.end);
}

export function injectStemOnlyMdLinkAnchors(
  lines: string[],
  sectionRanges: readonly EpubSpineSectionRange[],
  registry: EbookMarkdownFragmentRegistry,
): void {
  if (sectionRanges.length === 0) return;

  const sectionByStem = sectionRangeByStem(sectionRanges);
  const linkCounterByStem = new Map<string, number>();
  const searchStartByStem = new Map<string, number>();
  const anchorMutations: LineMutation[] = [];
  const lineRewrites = new Map<number, string>();

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] ?? "";
    if (!rawLine.includes("](#")) continue;

    for (const link of parseMdLinksOnLine(rawLine)) {
      if (!STEM_ONLY_FRAG_RE.test(link.fragment)) continue;

      const stem = link.fragment;
      const range = sectionByStem.get(stem);
      if (!range) continue;

      const n = (linkCounterByStem.get(stem) ?? 0) + 1;
      linkCounterByStem.set(stem, n);
      const logicalAnchor = `${stem}#link_${n}`;
      const globalFrag = globalFragmentForLogicalTarget(
        registry,
        logicalAnchor,
        `link_${n}`,
      );

      const searchStart = Math.max(
        range.startLine,
        searchStartByStem.get(stem) ?? range.startLine,
      );
      const titleLine = findTitleLineInSpineSection(
        lines,
        searchStart,
        range.endLine,
        link.label || stem,
      );

      const spanLine = formatSpanAnchor(globalFrag);
      if (titleLine != null) {
        /** 锚点独占一行，勿 `<span>…</span># 标题` 导致 ATX 章节匹配失败 */
        anchorMutations.push({
          kind: "insert",
          at: titleLine,
          text: spanLine,
        });
        searchStartByStem.set(stem, titleLine + 1);
      } else {
        anchorMutations.push({
          kind: "insert",
          at: range.startLine,
          text: spanLine,
        });
        if (link.label || stem) {
          anchorMutations.push({
            kind: "insert",
            at: range.startLine + 1,
            text: link.label || stem,
          });
          searchStartByStem.set(stem, range.startLine + 1);
        } else {
          searchStartByStem.set(stem, range.startLine + 1);
        }
      }

      const currentLine = lineRewrites.get(lineIdx) ?? rawLine;
      lineRewrites.set(
        lineIdx,
        replaceMdLinkFragment(currentLine, link, logicalAnchor, registry),
      );
    }
  }

  for (const [idx, text] of lineRewrites) {
    lines[idx] = text;
  }
  if (anchorMutations.length > 0) {
    applyLineMutations(lines, anchorMutations);
  }
}
