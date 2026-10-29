import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type RawSystemFontFace,
} from "@shared/systemFontFace";

const LIST_TIMEOUT_MS = 20_000;

function runCommand(
  command: string,
  args: string[],
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, LIST_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const message = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(message || `${command} exit ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(input ?? "");
  });
}

function parseFaceTsv(stdout: string): RawSystemFontFace[] {
  const faces: RawSystemFontFace[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 6) continue;
    const family = parts[0]?.trim() ?? "";
    if (!family) continue;
    const localJoined = parts[3] ?? "";
    const fileUrl = (parts[6] ?? "").trim();
    faces.push({
      family,
      style: (parts[1] ?? "").trim(),
      postscriptName: (parts[2] ?? "").trim(),
      localNames: localJoined
        .split("|")
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
      weight: Number(parts[4]) || 0,
      italic: (parts[5] ?? "").trim() === "1",
      ...(fileUrl ? { fileUrl } : {}),
    });
  }
  return faces;
}

/**
 * availableMembersOfFontFamily 的每一项是
 * [PostScript 名, 样式名, 字重 0–15, traits]。
 * 样式名留给渲染侧翻译成「常规 / 细体 / 粗体」。
 */
const DARWIN_JXA = `
ObjC.import("AppKit");
const fm = $.NSFontManager.sharedFontManager;
const families = fm.availableFontFamilies;
const n = Number(families.count);
const out = [];
for (let i = 0; i < n; i++) {
  const family = String(ObjC.unwrap(families.objectAtIndex(i)) || "");
  if (!family || family.charAt(0) === ".") continue;
  const members = fm.availableMembersOfFontFamily(family);
  const m = members ? Number(members.count) : 0;
  if (m <= 0) {
    out.push({
      family: family,
      style: "",
      postscriptName: "",
      localNames: [],
      weight: 0,
      italic: false,
    });
    continue;
  }
  for (let j = 0; j < m; j++) {
    const info = members.objectAtIndex(j);
    const ps = String(ObjC.unwrap(info.objectAtIndex(0)) || "");
    let style = String(ObjC.unwrap(info.objectAtIndex(1)) || "");
    const weight = Number(ObjC.unwrap(info.objectAtIndex(2))) || 0;
    const traits = Number(ObjC.unwrap(info.objectAtIndex(3))) || 0;
    const italic = (traits & 1) !== 0;
    if ((traits & 0x40) || (traits & 0x10)) {
      if (!/condensed|narrow|窄/i.test(style)) {
        style = style ? style + " Condensed" : "Condensed";
      }
    } else if (traits & 0x20) {
      if (!/expanded|extended|宽/i.test(style)) {
        style = style ? style + " Expanded" : "Expanded";
      }
    }
    const locals = [];
    if (ps) locals.push(ps);
    if (style) locals.push(family + " " + style);
    out.push({
      family: family,
      style: style,
      postscriptName: ps,
      localNames: locals,
      weight: weight,
      italic: italic,
    });
  }
}
JSON.stringify(out);
`;

async function listDarwinFaces(): Promise<RawSystemFontFace[]> {
  const stdout = await runCommand(
    "osascript",
    ["-l", "JavaScript", "-"],
    DARWIN_JXA,
  );
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) return [];
  const faces: RawSystemFontFace[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<RawSystemFontFace>;
    if (typeof row.family !== "string" || !row.family.trim()) continue;
    faces.push({
      family: row.family,
      style: typeof row.style === "string" ? row.style : "",
      postscriptName:
        typeof row.postscriptName === "string" ? row.postscriptName : "",
      localNames: Array.isArray(row.localNames)
        ? row.localNames.filter((name): name is string => typeof name === "string")
        : [],
      weight: typeof row.weight === "number" ? row.weight : 0,
      italic: Boolean(row.italic),
    });
  }
  return faces;
}

const WINDOWS_PS = [
  '$ErrorActionPreference = "Stop"',
  "$utf8 = New-Object System.Text.UTF8Encoding $false",
  "$OutputEncoding = $utf8",
  "[Console]::OutputEncoding = $utf8",
  "Add-Type -AssemblyName PresentationCore",
  "function Esc([string]$s) {",
  '  if ([string]::IsNullOrEmpty($s)) { return "" }',
  '  return (($s -replace "[\\t\\r\\n|]", " ").Trim())',
  "}",
  "function First-Name($dict) {",
  '  if ($null -eq $dict) { return "" }',
  "  $pref = @()",
  "  try { $pref += [System.Globalization.CultureInfo]::CurrentUICulture } catch {}",
  '  try { $pref += [System.Globalization.CultureInfo]::GetCultureInfo("zh-CN") } catch {}',
  '  try { $pref += [System.Globalization.CultureInfo]::GetCultureInfo("en-US") } catch {}',
  "  try { $pref += [System.Globalization.CultureInfo]::InvariantCulture } catch {}",
  "  foreach ($c in $pref) {",
  "    if ($null -eq $c) { continue }",
  "    if ($dict.ContainsKey($c)) {",
  "      $v = [string]$dict[$c]",
  '      if (-not [string]::IsNullOrWhiteSpace($v)) { return $v.Trim() }',
  "    }",
  "  }",
  "  foreach ($v in $dict.Values) {",
  "    $s = [string]$v",
  '    if (-not [string]::IsNullOrWhiteSpace($s)) { return $s.Trim() }',
  "  }",
  '  return ""',
  "}",
  "$families = [System.Windows.Media.Fonts]::SystemFontFamilies",
  "foreach ($fam in $families) {",
  '  $family = ""',
  "  try { $family = Esc ([string]$fam.Source) } catch { continue }",
  '  if ([string]::IsNullOrWhiteSpace($family)) { continue }',
  '  if ($family.StartsWith(".") -or $family.Contains("\\") -or $family.Contains("/")) { continue }',
  "  $typefaces = @()",
  "  try { $typefaces = @($fam.GetTypefaces()) } catch { continue }",
  "  foreach ($tf in $typefaces) {",
  "    if ($null -eq $tf) { continue }",
  "    $gt = $null",
  "    $ok = $false",
  "    try { $ok = $tf.TryGetGlyphTypeface([ref]$gt) } catch { continue }",
  "    if (-not $ok -or $null -eq $gt) { continue }",
  '    $face = ""',
  "    try { $face = Esc (First-Name $gt.Win32FaceNames) } catch { $face = \"\" }",
  '    $localFamily = ""',
  "    try { $localFamily = Esc (First-Name $gt.Win32FamilyNames) } catch { $localFamily = \"\" }",
  "    $italic = $false",
  "    try {",
  "      $st = [string]$tf.Style",
  '      if ($st -eq "Italic" -or $st -eq "Oblique") { $italic = $true }',
  "    } catch {}",
  '    $stretch = ""',
  '    try { $stretch = [string]$tf.Stretch } catch { $stretch = "" }',
  '    if ($stretch -and $stretch -ne "Normal") {',
  "      if ($face -notmatch [regex]::Escape($stretch)) {",
  '        if ($face) { $face = Esc "$face $stretch" } else { $face = Esc $stretch }',
  "      }",
  "    }",
  "    $weight = 400",
  "    try { $weight = [int]$tf.Weight.ToOpenTypeWeight() } catch { $weight = 400 }",
  '    $fileUrl = ""',
  "    try { $fileUrl = Esc ([string]$gt.FontUri) } catch { $fileUrl = \"\" }",
  "    $locals = @()",
  "    if ($localFamily) { $locals += $localFamily }",
  "    if ($localFamily -and $face) {",
  '      $joined = Esc "$localFamily $face"',
  "      if ($joined -and ($locals -notcontains $joined)) { $locals += $joined }",
  "    }",
  "    if ($family -and $face) {",
  '      $joined = Esc "$family $face"',
  "      if ($joined -and ($locals -notcontains $joined)) { $locals += $joined }",
  "    }",
  '    $localJoined = ($locals -join "|")',
  '    $ital = $(if ($italic) { "1" } else { "0" })',
  '    [Console]::Out.WriteLine("$family`t$face`t`t$localJoined`t$weight`t$ital`t$fileUrl")',
  "  }",
  "}",
].join("\n");

/**
 * 经 stdin + `-Command -` 时，本机 PowerShell 常返回空 stdout（exit 0），
 * 主进程会退回 font-list 族名从而丢失字重元数据。改为临时脚本 + `-File`。
 */
async function listWindowsFaces(): Promise<RawSystemFontFace[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "colortxt-fonts-"));
  const scriptPath = path.join(dir, "list-faces.ps1");
  try {
    await writeFile(scriptPath, WINDOWS_PS, "utf8");
    const stdout = await runCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ]);
    return parseFaceTsv(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function listLinuxFaces(): Promise<RawSystemFontFace[]> {
  const stdout = await runCommand("fc-list", [
    "-f",
    "%{family[0]}\\t%{style[0]}\\t%{postscriptname}\\t%{fullname[0]}\\t%{weight}\\t%{slant}\\n",
  ]);
  const faces: RawSystemFontFace[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 6) continue;
    const family = parts[0]?.trim() ?? "";
    if (!family || family.startsWith(".")) continue;
    const slant = (parts[5] ?? "").trim();
    const fullName = (parts[3] ?? "").trim();
    faces.push({
      family,
      style: (parts[1] ?? "").trim(),
      postscriptName: (parts[2] ?? "").trim(),
      localNames: fullName ? [fullName] : [],
      weight: Number(parts[4]) || 0,
      italic: slant !== "" && slant !== "0" && slant.toLowerCase() !== "roman",
    });
  }
  return faces;
}

export async function listRawSystemFontFaces(): Promise<RawSystemFontFace[]> {
  try {
    if (process.platform === "darwin") return await listDarwinFaces();
    if (process.platform === "win32") return await listWindowsFaces();
    if (process.platform === "linux") return await listLinuxFaces();
  } catch (err) {
    console.warn("[fonts] list font faces failed", err);
  }
  return [];
}
