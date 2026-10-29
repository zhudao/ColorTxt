import type { BookSourceListItem } from "@shared/bookSource/types";
import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import { icons } from "../icons";

export type BookSourceSortMode =
  | "manual"
  | "smartAsc"
  | "smartDesc"
  | "nameAsc"
  | "nameDesc"
  | "urlAsc"
  | "urlDesc"
  | "updateTimeAsc"
  | "updateTimeDesc"
  | "respondTimeAsc"
  | "respondTimeDesc";

export type BookSourceFilterMode =
  | "all"
  | "enabled"
  | "disabled"
  | "loginRequired"
  | "loginNotRequired"
  | "exploreEnabled"
  | "exploreDisabled";

export const DEFAULT_BOOK_SOURCE_SORT: BookSourceSortMode = "manual";
export const DEFAULT_BOOK_SOURCE_FILTER: BookSourceFilterMode = "all";

const SORT_LABELS: Record<BookSourceSortMode, string> = {
  manual: "手动",
  smartAsc: "智能",
  smartDesc: "智能",
  nameAsc: "名称",
  nameDesc: "名称",
  urlAsc: "地址",
  urlDesc: "地址",
  updateTimeAsc: "更新时间",
  updateTimeDesc: "更新时间",
  respondTimeAsc: "响应时间",
  respondTimeDesc: "响应时间",
};

const FILTER_LABELS: Record<BookSourceFilterMode, string> = {
  all: "全部",
  enabled: "已启用",
  disabled: "已禁用",
  loginRequired: "需要登录",
  loginNotRequired: "不需要登录",
  exploreEnabled: "已启用发现",
  exploreDisabled: "已禁用发现",
};

const SORT_MODES: BookSourceSortMode[] = [
  "manual",
  "smartAsc",
  "smartDesc",
  "nameAsc",
  "nameDesc",
  "urlAsc",
  "urlDesc",
  "updateTimeAsc",
  "updateTimeDesc",
  "respondTimeAsc",
  "respondTimeDesc",
];

const FILTER_MODES: BookSourceFilterMode[] = [
  "all",
  "enabled",
  "disabled",
  "loginRequired",
  "loginNotRequired",
  "exploreEnabled",
  "exploreDisabled",
];

export function isBookSourceSortAsc(mode: BookSourceSortMode): boolean {
  return /Asc$/.test(mode);
}

export function isBookSourceManualSort(mode: BookSourceSortMode): boolean {
  return mode === "manual";
}

/**
 * 手动排序拖拽：槽位上的 customOrder 不变，书源在槽位间移动。
 * 返回需要写入存储的 url → customOrder。
 */
export function reorderBookSourceManualOrders(
  view: readonly BookSourceListItem[],
  from: number,
  to: number,
): Array<{ url: string; customOrder: number }> {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= view.length ||
    to >= view.length
  ) {
    return [];
  }
  const slotOrders = view.map((i) => i.customOrder);
  const next = [...view];
  const [moved] = next.splice(from, 1);
  if (!moved) return [];
  next.splice(to, 0, moved);
  return next.map((item, i) => ({
    url: item.bookSourceUrl,
    customOrder: slotOrders[i]!,
  }));
}

export function bookSourceSortLabel(mode: BookSourceSortMode): string {
  return SORT_LABELS[mode];
}

export function bookSourceSortTriggerPrefixHtml(mode: BookSourceSortMode): string {
  if (mode === "manual") return icons.move;
  return isBookSourceSortAsc(mode) ? icons.asc : icons.desc;
}

export function bookSourceFilterLabel(mode: BookSourceFilterMode): string {
  return FILTER_LABELS[mode];
}

export function createBookSourceSortItems(): CustomSelectItem[] {
  return SORT_MODES.map((m) => ({
    kind: "item" as const,
    id: m,
    label: SORT_LABELS[m],
    prefixHtml: bookSourceSortTriggerPrefixHtml(m),
  }));
}

export function createBookSourceFilterItems(): CustomSelectItem[] {
  return FILTER_MODES.map((m) => ({
    kind: "item" as const,
    id: m,
    label: FILTER_LABELS[m],
  }));
}

export function matchesBookSourceFilter(
  item: BookSourceListItem,
  mode: BookSourceFilterMode,
): boolean {
  switch (mode) {
    case "all":
      return true;
    case "enabled":
      return item.enabled;
    case "disabled":
      return !item.enabled;
    case "loginRequired":
      return item.hasLoginUrl;
    case "loginNotRequired":
      return !item.hasLoginUrl;
    case "exploreEnabled":
      return item.hasExploreUrl && item.enabledExplore;
    case "exploreDisabled":
      return item.hasExploreUrl && !item.enabledExplore;
    default:
      return true;
  }
}

function smartCompare(a: BookSourceListItem, b: BookSourceListItem): number {
  const enabledCmp = Number(b.enabled) - Number(a.enabled);
  if (enabledCmp !== 0) return enabledCmp;

  const weightCmp = (b.weight ?? 0) - (a.weight ?? 0);
  if (weightCmp !== 0) return weightCmp;

  const ra = a.respondTime ?? Number.MAX_SAFE_INTEGER;
  const rb = b.respondTime ?? Number.MAX_SAFE_INTEGER;
  const respondCmp = ra - rb;
  if (respondCmp !== 0) return respondCmp;

  return a.bookSourceName.localeCompare(b.bookSourceName, "zh-CN");
}

function respondTimeCompare(
  a: BookSourceListItem,
  b: BookSourceListItem,
  desc: boolean,
): number {
  const ra = a.respondTime ?? Number.MAX_SAFE_INTEGER;
  const rb = b.respondTime ?? Number.MAX_SAFE_INTEGER;
  const cmp = desc ? rb - ra : ra - rb;
  if (cmp !== 0) return cmp;
  return desc
    ? b.bookSourceName.localeCompare(a.bookSourceName, "zh-CN")
    : a.bookSourceName.localeCompare(b.bookSourceName, "zh-CN");
}

export function compareBookSources(
  a: BookSourceListItem,
  b: BookSourceListItem,
  mode: BookSourceSortMode,
): number {
  switch (mode) {
    case "manual": {
      const order = a.customOrder - b.customOrder;
      if (order !== 0) return order;
      return a.bookSourceName.localeCompare(b.bookSourceName, "zh-CN");
    }
    case "smartAsc":
      return smartCompare(a, b);
    case "smartDesc":
      return smartCompare(b, a);
    case "nameAsc":
      return a.bookSourceName.localeCompare(b.bookSourceName, "zh-CN");
    case "nameDesc":
      return b.bookSourceName.localeCompare(a.bookSourceName, "zh-CN");
    case "urlAsc":
      return a.bookSourceUrl.localeCompare(b.bookSourceUrl);
    case "urlDesc":
      return b.bookSourceUrl.localeCompare(a.bookSourceUrl);
    case "updateTimeAsc":
      return a.lastUpdateTime - b.lastUpdateTime;
    case "updateTimeDesc":
      return b.lastUpdateTime - a.lastUpdateTime;
    case "respondTimeAsc":
      return respondTimeCompare(a, b, false);
    case "respondTimeDesc":
      return respondTimeCompare(a, b, true);
    default:
      return 0;
  }
}

export function filterAndSortBookSources(
  items: readonly BookSourceListItem[],
  textQuery: string,
  filterMode: BookSourceFilterMode,
  sortMode: BookSourceSortMode,
): BookSourceListItem[] {
  const q = textQuery.trim().toLowerCase();
  let result = items.filter((i) => matchesBookSourceFilter(i, filterMode));
  if (q) {
    result = result.filter((i) =>
      i.bookSourceName.toLowerCase().includes(q),
    );
  }
  return [...result].sort((a, b) => compareBookSources(a, b, sortMode));
}
