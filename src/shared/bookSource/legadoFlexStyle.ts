import type { ExploreKindStyle } from "./types";

/** Legado item_fillet_text：layout_margin 3dp */
export const LEGADO_FLEX_CHILD_MARGIN_PX = 3;

function legadoTruthy(v: unknown): boolean {
  return v === true || v === "true";
}

function toFlexNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** 对齐 Legado FlexChildStyle + FlexboxLayout（basis 为父宽百分比，margin 额外占用） */
export function legadoFlexChildStyle(
  style?: ExploreKindStyle | null,
): Record<string, string> {
  if (legadoTruthy(style?.layout_wrapBefore) || legadoTruthy(style?.layoutWrapBefore)) {
    return { flex: "0 1 100%", width: "100%" };
  }

  const grow = toFlexNum(style?.layout_flexGrow ?? style?.layoutGrow, 0);
  const shrink = toFlexNum(style?.layout_flexShrink, 1);
  const basis = toFlexNum(style?.layout_flexBasisPercent, -1);

  if (basis >= 1) {
    const inset = LEGADO_FLEX_CHILD_MARGIN_PX * 2;
    return {
      flex: `${grow} ${shrink} calc(100% - ${inset}px)`,
      width: `calc(100% - ${inset}px)`,
    };
  }

  if (basis > 0) {
    const pct = basis * 100;
    // shrink=0：basis 不含 margin，4×25% 会换行而非压扁（对齐 Legado FlexboxLayout）
    if (grow > 0) {
      return {
        flex: `${grow} 0 ${pct}%`,
        minWidth: "0",
      };
    }
    return {
      flex: `${grow} 0 ${pct}%`,
      maxWidth: `${pct}%`,
      minWidth: "0",
    };
  }

  if (grow > 0) {
    return { flex: `${grow} ${shrink} auto` };
  }

  return { flex: "0 1 auto" };
}
