/**
 * 任意 `.md`：解析 `<span id>`、内部 `[…](#fragment)`、外链 `[…](https://…)` 与行内 `![…](…)`，产出侧车供 ReaderMain 装饰。
 */

import { yieldToUi } from "../ebook/yieldToUi";
import {
  type MdInternalLinkOccurrence,
  isExclusiveBlockMarkdownImageLine,
  lineContainsMdStripMarkup,
  parseMdLinkTitleAttr,
  scanMdInternalLinkAt,
  scanNextMdStripTokenAt,
  visibleTextForMdLinkLabel,
  MD_LINK_EMPTY_PLACEHOLDER,
  MD_LINK_ICON_PLACEHOLDER,
} from "./markdownLinkShared";

const RE_SPAN_ID =
  /<span\s+id=["']([^"']+)["']\s*>\s*<\/span>/gi;

/** 物理行是否仅含 `<span id>` 跳转锚点（剥离后为空，不应占展示行） */
export function isMdAnchorMetadataOnlyPhysicalLine(rawLine: string): boolean {
  const first = rawLine.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  if (!/<span\s+id=/i.test(first)) return false;
  const withoutSpans = first.replace(
    new RegExp(RE_SPAN_ID.source, "gi"),
    "",
  );
  return withoutSpans.trim().length === 0;
}

function isInternalFragmentTarget(target: string): boolean {
  const t = target.trim();
  return t.startsWith("#") && !/^#https?:/i.test(t);
}

function stripSpanAnchorsFromLine(
  line: string,
  physicalLine: number,
  idToPhysicalLine: Map<string, number>,
): string {
  return line.replace(RE_SPAN_ID, (_full, id: string) => {
    const frag = id?.trim();
    if (frag && !idToPhysicalLine.has(frag)) {
      idToPhysicalLine.set(frag, physicalLine);
      idToPhysicalLine.set(`#${frag}`, physicalLine);
    }
    return "";
  });
}

function collectLeadingMdLinkLabelsFromLine(rawLine: string): string[] {
  const s = rawLine.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  let pos = 0;
  while (pos < s.length && /\s/.test(s.charAt(pos))) pos++;

  const labels: string[] = [];
  let linkPart = s.slice(pos).replace(RE_SPAN_ID, "").trimStart();

  while (linkPart.length > 0) {
    const parsed = scanMdInternalLinkAt(linkPart, 0);
    if (!parsed || !isInternalFragmentTarget(`#${parsed.fragment}`)) break;
    if (parsed.iconRel) {
      labels.push(parsed.iconAlt || "注");
    } else {
      labels.push(parsed.textLabel || "注");
    }
    linkPart = linkPart.slice(parsed.full.length);
    const next = linkPart.match(/^\s*/);
    linkPart = linkPart.slice(next?.[0]?.length ?? 0);
  }
  return labels;
}

function pushMdLinkOccurrence(
  out: MdInternalLinkOccurrence[],
  physicalLine: number,
  colStart: number,
  visible: string,
  fields: {
    targetId: string;
    label: string;
    iconRel?: string;
    hoverTip?: string;
    builtinLinkIcon?: boolean;
    externalUrl?: string;
    inlineImage?: boolean;
  },
): void {
  out.push({
    physicalLine,
    startColumn: colStart,
    endColumnExclusive: colStart + visible.length,
    targetId: fields.targetId,
    label: fields.label,
    iconRel: fields.iconRel,
    hoverTip: fields.hoverTip,
    builtinLinkIcon: fields.builtinLinkIcon,
    externalUrl: fields.externalUrl,
    inlineImage: fields.inlineImage,
  });
}

function replaceMdLinksOnLine(
  line: string,
  physicalLine: number,
  out: MdInternalLinkOccurrence[],
): string {
  /** 独占行插图留给 View Zone，语法原样留下；同行若还有内链仍剥离 */
  const skipExclusiveImage = isExclusiveBlockMarkdownImageLine(line);

  let result = "";
  let last = 0;
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const hit = scanNextMdStripTokenAt(line, searchFrom);
    if (!hit) break;

    if (hit.kind === "image") {
      const parsed = hit.image;
      const index = parsed.index;
      if (skipExclusiveImage) {
        result += line.slice(last, index + parsed.full.length);
        last = index + parsed.full.length;
        searchFrom = last;
        continue;
      }
      result += line.slice(last, index);
      const visible = MD_LINK_ICON_PLACEHOLDER;
      const colStart = result.length + 1;
      const hoverTip = parsed.title?.trim() || parsed.alt.trim() || undefined;
      pushMdLinkOccurrence(out, physicalLine, colStart, visible, {
        targetId: "",
        label: parsed.alt.trim(),
        iconRel: parsed.url,
        hoverTip,
        inlineImage: true,
      });
      result += visible;
      last = index + parsed.full.length;
      searchFrom = last;
      continue;
    }

    if (hit.kind === "internal") {
      const parsed = hit.link;
      const index = parsed.index;
      if (!isInternalFragmentTarget(`#${parsed.fragment}`)) {
        searchFrom = index + Math.max(1, parsed.full.length);
        continue;
      }
      result += line.slice(last, index);
      const iconRel = parsed.iconRel;
      const label = iconRel ? parsed.iconAlt || "注" : parsed.textLabel;
      const builtinLinkIcon = !iconRel && label.length === 0;
      const visible = visibleTextForMdLinkLabel(
        label,
        iconRel,
        builtinLinkIcon,
      );
      const colStart = result.length + 1;
      const titleAttr = parseMdLinkTitleAttr(
        parsed.titleAttr?.replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
      );
      const hoverTip = titleAttr.title;
      pushMdLinkOccurrence(out, physicalLine, colStart, visible, {
        targetId: `#${parsed.fragment}`,
        label: label || "注",
        iconRel,
        hoverTip: hoverTip || undefined,
        builtinLinkIcon,
      });
      result += visible;
      last = index + parsed.full.length;
      searchFrom = last;
      continue;
    }

    const parsed = hit.link;
    const index = parsed.index;
    result += line.slice(last, index);
    const iconRel = parsed.iconRel;
    const label = iconRel ? parsed.iconAlt || "链" : parsed.textLabel;
    const builtinLinkIcon = !iconRel && label.length === 0;
    const visible = visibleTextForMdLinkLabel(label, iconRel, builtinLinkIcon);
    const colStart = result.length + 1;
    const titleAttr = parseMdLinkTitleAttr(
      parsed.titleAttr?.replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
    );
    const hoverTip = titleAttr.title;
    pushMdLinkOccurrence(out, physicalLine, colStart, visible, {
      targetId: parsed.url,
      label: label || parsed.url,
      iconRel,
      hoverTip: hoverTip || undefined,
      builtinLinkIcon,
      externalUrl: parsed.url,
    });
    result += visible;
    last = index + parsed.full.length;
    searchFrom = last;
  }
  result += line.slice(last);
  return result;
}

export type StripMdInternalLinksResult = {
  strippedLines: string[];
  idToPhysicalLine: Map<string, number>;
  pendingLinksByPhysicalLine: Map<number, MdInternalLinkOccurrence[]>;
  leadingByPhysicalLine: Map<number, string[]>;
};

export function stripMdInternalLinksFromPhysicalLines(
  physicalLines: readonly string[],
): StripMdInternalLinksResult {
  const idToPhysicalLine = new Map<string, number>();
  const pendingLinksByPhysicalLine = new Map<
    number,
    MdInternalLinkOccurrence[]
  >();
  const leadingByPhysicalLine = new Map<number, string[]>();
  const strippedLines: string[] = [];

  for (let i = 0; i < physicalLines.length; i++) {
    const physicalLine = i + 1;
    const raw = physicalLines[i] ?? "";
    const hasSpan = RE_SPAN_ID.test(raw);
    RE_SPAN_ID.lastIndex = 0;
    const hasMarkup = lineContainsMdStripMarkup(raw);
    if (!hasSpan && !hasMarkup) {
      strippedLines.push(raw);
      continue;
    }

    const leading = collectLeadingMdLinkLabelsFromLine(raw);
    if (leading.length > 0) {
      leadingByPhysicalLine.set(physicalLine, leading);
    }

    let line = stripSpanAnchorsFromLine(raw, physicalLine, idToPhysicalLine);
    const lineLinks: MdInternalLinkOccurrence[] = [];
    line = replaceMdLinksOnLine(line, physicalLine, lineLinks);
    if (lineLinks.length > 0) {
      pendingLinksByPhysicalLine.set(physicalLine, lineLinks);
    }
    strippedLines.push(line);
  }

  return {
    strippedLines,
    idToPhysicalLine,
    pendingLinksByPhysicalLine,
    leadingByPhysicalLine,
  };
}

export async function stripMdInternalLinksFromPhysicalLinesAsync(
  physicalLines: readonly string[],
  yieldEvery = 2_000,
): Promise<StripMdInternalLinksResult> {
  const idToPhysicalLine = new Map<string, number>();
  const pendingLinksByPhysicalLine = new Map<
    number,
    MdInternalLinkOccurrence[]
  >();
  const leadingByPhysicalLine = new Map<number, string[]>();
  const strippedLines: string[] = [];

  for (let i = 0; i < physicalLines.length; i++) {
    if (i > 0 && i % yieldEvery === 0) await yieldToUi();
    const physicalLine = i + 1;
    const raw = physicalLines[i] ?? "";
    const hasSpan = RE_SPAN_ID.test(raw);
    RE_SPAN_ID.lastIndex = 0;
    const hasMarkup = lineContainsMdStripMarkup(raw);
    if (!hasSpan && !hasMarkup) {
      strippedLines.push(raw);
      continue;
    }
    const leading = collectLeadingMdLinkLabelsFromLine(raw);
    if (leading.length > 0) {
      leadingByPhysicalLine.set(physicalLine, leading);
    }
    let line = stripSpanAnchorsFromLine(raw, physicalLine, idToPhysicalLine);
    const lineLinks: MdInternalLinkOccurrence[] = [];
    line = replaceMdLinksOnLine(line, physicalLine, lineLinks);
    if (lineLinks.length > 0) {
      pendingLinksByPhysicalLine.set(physicalLine, lineLinks);
    }
    strippedLines.push(line);
  }

  return {
    strippedLines,
    idToPhysicalLine,
    pendingLinksByPhysicalLine,
    leadingByPhysicalLine,
  };
}

export function stripMdInternalLinksFromText(text: string): {
  text: string;
  outLines: string[];
  idToPhysicalLine: Map<string, number>;
  linkOccurrences: MdInternalLinkOccurrence[];
  leadingMdLinkLabelsByLine: Map<number, string[]>;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  const {
    strippedLines,
    idToPhysicalLine,
    pendingLinksByPhysicalLine,
    leadingByPhysicalLine,
  } = stripMdInternalLinksFromPhysicalLines(lines);

  const linkOccurrences: MdInternalLinkOccurrence[] = [];
  for (const occs of pendingLinksByPhysicalLine.values()) {
    linkOccurrences.push(...occs);
  }

  return {
    text: strippedLines.join("\n"),
    outLines: strippedLines,
    idToPhysicalLine,
    linkOccurrences,
    leadingMdLinkLabelsByLine: leadingByPhysicalLine,
  };
}

export { MD_LINK_EMPTY_PLACEHOLDER };
