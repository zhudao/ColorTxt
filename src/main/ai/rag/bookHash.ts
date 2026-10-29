import crypto from "node:crypto";

export function hashBook(
  sessionFilePath: string,
  size: number,
  mtimeMs: number,
): string {
  const raw = `${sessionFilePath}::${size}::${Math.floor(mtimeMs)}`;
  return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}
