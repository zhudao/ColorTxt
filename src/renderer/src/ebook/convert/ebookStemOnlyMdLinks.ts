/**
 * 转换后处理：stem-only 内链 `[…](#epub-NNNN)` → 精确 fragment，并在目标节注入 `<span id>`.
 */

import { chapterTitleForDisplay } from "../../chapter";
import {
  EbookMarkdownFragmentRegistry,
  formatMdInternalLink,
  formatSpanAnchor,
  globalFragmentForLogicalTarget,
  mdInternalLinkForLogicalTarget,
} from "./ebookMarkdownEmit";
import {
  type ParsedMdInternalLink,
  parseMdLinkTitleAttr,
  scanMdInternalLinksOnLine,
} from "../../markdown/markdownLinkShared";
import {
  applyLineMutations,
  findEmbeddedTocSpanLineForTitle,
  findTitleLineInSpineSection,
  sectionRangeByStem,
  type EpubSpineSectionRange,
  type LineMutation,
} from "./ebookSpineLineMatch";

const STEM_ONLY_FRAG_RE = /^(?:epub|mobi)-\d{4}$/i;

type ParsedMdLink = {
  start: number;
  end: number;
  label: string;
  fragment: string;
  titleAttr?: string;
};

function parsedStemMdLink(link: ParsedMdInternalLink): ParsedMdLink {
  const label = link.iconRel
    ? link.iconAlt || link.textLabel
    : link.textLabel;
  return {
    start: link.index,
    end: link.index + link.full.length,
    label,
    fragment: link.fragment,
    titleAttr: link.titleAttr,
  };
}

function parseMdLinksOnLine(line: string): ParsedMdLink[] {
  return scanMdInternalLinksOnLine(line).map(parsedStemMdLink);
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
  const titleAttr = link.titleAttr
    ? unescapeMdTitleAttr(link.titleAttr)
    : undefined;
  const { title } = parseMdLinkTitleAttr(titleAttr);
  const preferredFrag = logicalTargetId.slice(
    logicalTargetId.lastIndexOf("#") + 1,
  );
  const replacement = mdInternalLinkForLogicalTarget(
    registry,
    logicalTargetId,
    {
      label: link.label,
      title,
      preferredFrag,
    },
  );
  return line.slice(0, link.start) + replacement + line.slice(link.end);
}

function replaceMdLinkWithKnownFragment(
  line: string,
  link: ParsedMdLink,
  fragment: string,
): string {
  const titleAttr = link.titleAttr
    ? unescapeMdTitleAttr(link.titleAttr)
    : undefined;
  const { title } = parseMdLinkTitleAttr(titleAttr);
  const replacement = formatMdInternalLink({
    label: link.label,
    fragment,
    title,
  });
  return line.slice(0, link.start) + replacement + line.slice(link.end);
}

/** 目录页 `*第一章…*` 等链 label → 与 spine 节内 h* 标题对齐后再精确匹配 */
function normalizeStemLinkLabelForTitleMatch(label: string): string {
  let t = label.trim();
  if (t.length >= 2 && t.startsWith("*") && t.endsWith("*")) {
    t = t.slice(1, -1).trim();
  } else {
    t = t.replace(/^\*+/, "").trim();
  }
  return chapterTitleForDisplay(t);
}

function fragmentIdFromSpanOnlyLine(line: string): string | null {
  const m = /^\s*<span\s+id="([^"]+)"\s*><\/span>\s*$/.exec(line.trim());
  return m?.[1]?.trim() || null;
}

function resolveStemLinkAnchorLine(
  lines: readonly string[],
  range: EpubSpineSectionRange,
  searchStart: number,
  titleForMatch: string,
): number | null {
  const slack = 12;
  const from = Math.max(0, Math.min(searchStart, range.startLine) - slack);
  const to = Math.min(lines.length - 1, range.endLine + slack);
  const tocLine = findEmbeddedTocSpanLineForTitle(
    lines,
    from,
    to,
    titleForMatch,
    range.startLine,
  );
  if (tocLine != null) return tocLine;
  const titleLine = findTitleLineInSpineSection(
    lines,
    from,
    to,
    titleForMatch,
  );
  if (titleLine == null) return null;
  if (titleLine < range.startLine - slack || titleLine > range.endLine + slack) {
    return null;
  }
  return titleLine;
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

      const searchStart = Math.max(
        range.startLine,
        searchStartByStem.get(stem) ?? range.startLine,
      );
      const titleForMatch = normalizeStemLinkLabelForTitleMatch(
        link.label || stem,
      );
      const slack = 12;
      const searchFrom = Math.max(
        0,
        Math.min(
          searchStart,
          range.startLine,
        ) - slack,
      );
      const searchTo = Math.min(lines.length - 1, range.endLine + slack);

      const tocLine = findEmbeddedTocSpanLineForTitle(
        lines,
        searchFrom,
        searchTo,
        titleForMatch,
        range.startLine,
      );
      const tocFrag =
        tocLine != null ? fragmentIdFromSpanOnlyLine(lines[tocLine] ?? "") : null;

      if (tocFrag) {
        const currentLine = lineRewrites.get(lineIdx) ?? rawLine;
        lineRewrites.set(
          lineIdx,
          replaceMdLinkWithKnownFragment(currentLine, link, tocFrag),
        );
        searchStartByStem.set(stem, tocLine! + 1);
        continue;
      }

      const n = (linkCounterByStem.get(stem) ?? 0) + 1;
      linkCounterByStem.set(stem, n);
      const logicalAnchor = `${stem}#link_${n}`;
      const globalFrag = globalFragmentForLogicalTarget(
        registry,
        logicalAnchor,
        `link_${n}`,
      );

      const anchorLine = resolveStemLinkAnchorLine(
        lines,
        range,
        searchStart,
        titleForMatch,
      );

      const spanLine = formatSpanAnchor(globalFrag);
      if (anchorLine != null) {
        anchorMutations.push({
          kind: "insert",
          at: anchorLine,
          text: spanLine,
        });
        searchStartByStem.set(stem, anchorLine + 1);
      } else {
        anchorMutations.push({
          kind: "insert",
          at: range.startLine,
          text: spanLine,
        });
        searchStartByStem.set(stem, range.startLine + 1);
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
