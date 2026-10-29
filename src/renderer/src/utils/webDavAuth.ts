import type { WebDavAuthPayload } from "@shared/webDavIpc";

export type WebDavSettingsSlice = {
  webDavEnabled: boolean;
  webDavUrl: string;
  webDavUsername: string;
  webDavRemoteDir: string;
};

export function buildWebDavAuth(
  settings: WebDavSettingsSlice,
  passwordOverride?: string,
): WebDavAuthPayload | null {
  const url = settings.webDavUrl.trim();
  const username = settings.webDavUsername.trim();
  if (!url || !username) return null;
  const remoteDir = settings.webDavRemoteDir.trim() || "ColorTxt";
  return {
    url,
    username,
    remoteDir,
    ...(passwordOverride !== undefined
      ? { passwordOverride }
      : {}),
  };
}

export function isWebDavConfigured(settings: WebDavSettingsSlice): boolean {
  return Boolean(settings.webDavUrl.trim() && settings.webDavUsername.trim());
}
