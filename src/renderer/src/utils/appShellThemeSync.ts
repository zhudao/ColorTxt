import { defaultReaderTheme, persistKey } from "../constants/appUi";
import { loadPersistedSettingsData } from "../stores/cacheStore";

export type AppShellTheme = "vs" | "vs-dark";

export function readPersistedAppShellTheme(): AppShellTheme {
  const loaded = loadPersistedSettingsData(
    typeof window !== "undefined" ? window.localStorage : undefined,
    persistKey,
  );
  return loaded?.data.theme === "vs-dark" ? "vs-dark" : defaultReaderTheme;
}

export function applyAppShellTheme(theme: AppShellTheme): void {
  const isDark = theme !== "vs";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  window.colorTxt.setNativeTheme(theme);
}

/** 监听其它窗口写入 `colorTxt.ui.settings`（如切换亮/暗主题） */
export function listenPersistedSettingsSync(onChange: () => void): () => void {
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== persistKey) return;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
