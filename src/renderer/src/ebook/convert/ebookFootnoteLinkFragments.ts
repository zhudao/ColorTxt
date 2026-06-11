/**
 * 脚注 fragment 压缩与 noteref ↔ footnote 成对 id 推导。
 * `footnote_1_2` → `f_1_2`，`footnote_ref_1_2` → `fr_1_2`
 */

export function compactFootnoteLinkFragment(frag: string): string {
  const t = frag.trim();
  if (!t) return t;
  let m = /^footnote_ref_(.+)$/i.exec(t);
  if (m) return `fr_${m[1]!}`;
  m = /^endnote_ref_(.+)$/i.exec(t);
  if (m) return `er_${m[1]!}`;
  m = /^footnote_(.+)$/i.exec(t);
  if (m) return `f_${m[1]!}`;
  m = /^endnote_(.+)$/i.exec(t);
  if (m) return `en_${m[1]!}`;
  return t;
}

export function isFootnoteBodyLogicalTarget(targetId: string): boolean {
  const hash = targetId.lastIndexOf("#");
  if (hash < 0) return false;
  const frag = targetId.slice(hash + 1).trim();
  if (/^fr_/i.test(frag) || /^er_/i.test(frag)) return false;
  if (/^footnote_ref_/i.test(frag) || /^endnote_ref_/i.test(frag)) return false;
  if (/^f_/i.test(frag) || /^en_/i.test(frag)) return true;
  if (/^footnote_/i.test(frag) || /^endnote_/i.test(frag)) return true;
  return false;
}

export function footnoteRefRawIdFromBodyLogicalTarget(
  bodyTargetId: string,
): string | null {
  const hash = bodyTargetId.lastIndexOf("#");
  if (hash < 0) return null;
  const frag = bodyTargetId.slice(hash + 1).trim();
  if (frag.startsWith("f_")) return `footnote_ref_${frag.slice(2)}`;
  if (frag.startsWith("en_")) return `endnote_ref_${frag.slice(3)}`;
  const m = /^footnote_(.+)$/i.exec(frag);
  if (m) return `footnote_ref_${m[1]!}`;
  const m2 = /^endnote_(.+)$/i.exec(frag);
  if (m2) return `endnote_ref_${m2[1]!}`;
  return null;
}

export function isFootnoteRefRawElementId(id: string): boolean {
  const t = id.trim();
  return /^footnote_ref_/i.test(t) || /^endnote_ref_/i.test(t);
}

export function footnoteRefLogicalTargetFromBody(
  bodyTargetId: string,
): string | null {
  const rawRefId = footnoteRefRawIdFromBodyLogicalTarget(bodyTargetId);
  if (!rawRefId) return null;
  const hash = bodyTargetId.lastIndexOf("#");
  return `${bodyTargetId.slice(0, hash)}#${rawRefId}`;
}
