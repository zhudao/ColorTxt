import { readFileSync } from "node:fs";
import { parseBookSourceJson } from "@shared/bookSource/types";

/**
 * 轻量集成自检：解析精选书源 JSON 并统计文本源数量。
 * 运行：npx tsx src/main/bookSource/integrationSmoke.ts <path-to-json>
 */
function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("用法: npx tsx src/main/bookSource/integrationSmoke.ts <书源.json>");
    process.exit(1);
  }
  const text = readFileSync(path, "utf8");
  const sources = parseBookSourceJson(text);
  console.log(`解析文本书源: ${sources.length} 条`);
  const sample = sources.slice(0, 5);
  for (const s of sample) {
    console.log(`- ${s.bookSourceName} | search: ${Boolean(s.searchUrl?.trim())}`);
  }
}

main();
