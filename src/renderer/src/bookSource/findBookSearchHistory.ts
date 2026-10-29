const STORAGE_KEY = "colortxt:findBookSearchHistory";
const MAX_ITEMS = 30;

export function loadFindBookSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  } catch {
    return [];
  }
}

export function saveFindBookSearchHistory(items: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    /* ignore quota */
  }
}

export function addFindBookSearchHistory(keyword: string): string[] {
  const k = keyword.trim();
  if (!k) return loadFindBookSearchHistory();
  const prev = loadFindBookSearchHistory().filter((s) => s !== k);
  const next = [k, ...prev].slice(0, MAX_ITEMS);
  saveFindBookSearchHistory(next);
  return next;
}

export function removeFindBookSearchHistory(keyword: string): string[] {
  const k = keyword.trim();
  const next = loadFindBookSearchHistory().filter((s) => s !== k);
  saveFindBookSearchHistory(next);
  return next;
}

export function clearFindBookSearchHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
