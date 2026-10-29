import { shouldIncludeNodeModuleFile } from "./electron-pack-context.mjs";

/** @param {string} file */
export default async function onNodeModuleFile(file) {
  return shouldIncludeNodeModuleFile(file);
}
