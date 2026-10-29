/**
 * 侧栏文件列表树：由已筛选的扁平路径去掉公共父路径后建成。
 * 仅统计列表内文件；目录节点仅在子树含 ≥1 个列表文件时出现。
 */

import type { FileSortMode } from "../constants/fileCategories";
import { fileHistoryKey } from "../stores/recentHistoryStore";

export type FileListTreeFileSource = {
  name: string;
  path: string;
  size: number;
};

export type FileListTreeFolderNode = {
  kind: "folder";
  /** 展示名（相对树中的目录名） */
  name: string;
  /** 完整目录路径（title / 展开 key） */
  fullDirPath: string;
  /** 子树内已加入列表的文件数 */
  fileCount: number;
  /** 子树内已加入列表的文件大小之和 */
  totalSize: number;
  children: FileListTreeNode[];
};

export type FileListTreeFileNode = {
  kind: "file";
  file: FileListTreeFileSource;
};

export type FileListTreeNode = FileListTreeFolderNode | FileListTreeFileNode;

export type FileListTreeFlatRow =
  | {
      kind: "folder";
      depth: number;
      name: string;
      fullDirPath: string;
      fileCount: number;
      totalSize: number;
      expanded: boolean;
    }
  | {
      kind: "file";
      depth: number;
      file: FileListTreeFileSource;
    };

/** 规范化分隔符，去掉末尾斜杠（盘符根 `D:` / `D:/` 保留为 `D:`） */
export function normalizePathForTree(path: string): string {
  let p = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (p.length > 3 && p.endsWith("/")) p = p.slice(0, -1);
  if (/^[A-Za-z]:\/$/.test(p)) p = p.slice(0, 2);
  return p;
}

function splitPathSegments(normPath: string): string[] {
  const p = normalizePathForTree(normPath);
  if (!p) return [];
  const drive = /^([A-Za-z]:)(\/|$)/.exec(p);
  if (drive) {
    const rest = p.slice(drive[1].length).replace(/^\//, "");
    const segs = rest ? rest.split("/").filter(Boolean) : [];
    return [drive[1], ...segs];
  }
  if (p.startsWith("/")) {
    const rest = p.replace(/^\/+/, "");
    const segs = rest ? rest.split("/").filter(Boolean) : [];
    return ["/", ...segs];
  }
  return p.split("/").filter(Boolean);
}

function joinPathSegments(segs: readonly string[]): string {
  if (segs.length === 0) return "";
  if (segs[0] === "/") {
    return "/" + segs.slice(1).join("/");
  }
  if (/^[A-Za-z]:$/.test(segs[0]!)) {
    const rest = segs.slice(1).join("/");
    return rest ? `${segs[0]}/${rest}` : segs[0]!;
  }
  return segs.join("/");
}

/** 展示用路径：Windows 盘符路径改回反斜杠 */
export function formatFullDirPathForDisplay(normPath: string): string {
  const p = normalizePathForTree(normPath);
  if (/^[A-Za-z]:/.test(p)) return p.replace(/\//g, "\\");
  return p;
}

function volumeKeyFromSegments(segs: readonly string[]): string {
  if (segs.length === 0) return "";
  if (segs[0] === "/" || /^[A-Za-z]:$/.test(segs[0]!)) return segs[0]!;
  return "";
}

function longestCommonPrefixLen(lists: readonly string[][]): number {
  if (lists.length === 0) return 0;
  let n = lists[0]!.length;
  for (const list of lists) n = Math.min(n, list.length);
  let i = 0;
  for (; i < n; i++) {
    const v = lists[0]![i];
    for (let j = 1; j < lists.length; j++) {
      if (lists[j]![i] !== v) return i;
    }
  }
  return i;
}

type MutableFolder = {
  kind: "folder";
  name: string;
  fullDirPath: string;
  children: Map<string, MutableNode>;
  files: FileListTreeFileSource[];
};

type MutableNode =
  | MutableFolder
  | { kind: "file"; file: FileListTreeFileSource; order: number };

function ensureFolder(
  parent: MutableFolder,
  name: string,
  fullDirPath: string,
): MutableFolder {
  const key = `d:${name}`;
  const existing = parent.children.get(key);
  if (existing && existing.kind === "folder") return existing;
  const folder: MutableFolder = {
    kind: "folder",
    name,
    fullDirPath,
    children: new Map(),
    files: [],
  };
  parent.children.set(key, folder);
  return folder;
}

function treeNodeDisplayName(n: FileListTreeNode): string {
  return n.kind === "folder" ? n.name : n.file.name;
}

function treeNodeSortSize(n: FileListTreeNode): number {
  return n.kind === "folder" ? n.totalSize : n.file.size;
}

/**
 * 同级节点排序：
 * - sizeAsc / sizeDesc：文件夹按子树列表文件总大小、文件按自身大小，混排
 * - 其它：文件夹名优先，再文件（保持传入相对序）
 */
function sortTreeSiblingNodes(
  nodes: readonly FileListTreeNode[],
  sortMode: FileSortMode | undefined,
): FileListTreeNode[] {
  if (sortMode === "sizeAsc" || sortMode === "sizeDesc") {
    const desc = sortMode === "sizeDesc";
    return nodes.slice().sort((a, b) => {
      const d = treeNodeSortSize(a) - treeNodeSortSize(b);
      if (d !== 0) return desc ? -d : d;
      return treeNodeDisplayName(a).localeCompare(treeNodeDisplayName(b), undefined, {
        sensitivity: "base",
      });
    });
  }
  const folders: FileListTreeFolderNode[] = [];
  const files: FileListTreeFileNode[] = [];
  for (const n of nodes) {
    if (n.kind === "folder") folders.push(n);
    else files.push(n);
  }
  folders.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return [...folders, ...files];
}

function finalizeFolder(
  folder: MutableFolder,
  sortMode: FileSortMode | undefined,
): FileListTreeFolderNode {
  const folders: MutableFolder[] = [];
  const fileEntries: { file: FileListTreeFileSource; order: number }[] = [];

  for (const child of folder.children.values()) {
    if (child.kind === "folder") folders.push(child);
    else fileEntries.push({ file: child.file, order: child.order });
  }

  fileEntries.sort((a, b) => a.order - b.order);

  const childNodes: FileListTreeNode[] = [
    ...folders.map((f) => finalizeFolder(f, sortMode)),
    ...fileEntries.map(({ file }) => ({ kind: "file" as const, file })),
  ];

  let fileCount = 0;
  let totalSize = 0;
  for (const c of childNodes) {
    if (c.kind === "file") {
      fileCount += 1;
      totalSize += c.file.size;
    } else {
      fileCount += c.fileCount;
      totalSize += c.totalSize;
    }
  }

  return {
    kind: "folder",
    name: folder.name,
    fullDirPath: folder.fullDirPath,
    fileCount,
    totalSize,
    children: sortTreeSiblingNodes(childNodes, sortMode),
  };
}

/**
 * 由已排序/筛选的文件列表建树：同卷内去掉公共父路径，根为公共前缀的最后一段；
 * 多卷或多组无公共前缀时多根并列。叶子顺序保持 `files` 相对序；
 * `sortMode` 为大小排序时，同级文件夹按 `totalSize` 与文件混排。
 */
export function buildFilePathTree(
  files: readonly FileListTreeFileSource[],
  sortMode?: FileSortMode,
): FileListTreeNode[] {
  if (files.length === 0) return [];

  type Entry = {
    file: FileListTreeFileSource;
    segs: string[];
    order: number;
  };

  const entries: Entry[] = files.map((file, order) => {
    const segs = splitPathSegments(file.path);
    return { file, segs, order };
  });

  const byVolume = new Map<string, Entry[]>();
  for (const e of entries) {
    const vk = volumeKeyFromSegments(e.segs) || "__rel__";
    let list = byVolume.get(vk);
    if (!list) {
      list = [];
      byVolume.set(vk, list);
    }
    list.push(e);
  }

  const roots: FileListTreeNode[] = [];

  for (const group of byVolume.values()) {
    // 目录段 = 去掉文件名后的段
    const dirSegLists = group.map((e) => e.segs.slice(0, -1));
    let lcp = longestCommonPrefixLen(dirSegLists);

    // 公共前缀至少保留卷根（D: 或 /），根展示名为公共前缀最后一段
    if (lcp === 0 && dirSegLists[0]?.[0]) {
      // 无公共目录段：各自以文件所在目录为相对根，或文件挂在卷下
      lcp = 0;
    }

    // 若 LCP 为空但同卷，用卷根作为虚拟公共前缀长度 1（仅当所有路径都含卷根段）
    const vol = volumeKeyFromSegments(group[0]!.segs);
    if (lcp === 0 && vol) {
      const allHaveVol = group.every(
        (e) => volumeKeyFromSegments(e.segs) === vol,
      );
      if (allHaveVol) lcp = 1;
    }

    if (lcp > 0) {
      const prefixSegs = dirSegLists[0]!.slice(0, lcp);
      const rootName = prefixSegs[prefixSegs.length - 1]!;
      const rootFull = formatFullDirPathForDisplay(joinPathSegments(prefixSegs));
      const root: MutableFolder = {
        kind: "folder",
        name: rootName === "/" ? "/" : rootName.replace(/:$/, ":"),
        fullDirPath: rootFull,
        children: new Map(),
        files: [],
      };
      // 展示名：盘符保持 `D:`，POSIX 根为 `/`
      if (/^[A-Za-z]:$/.test(rootName)) root.name = rootName;
      else if (rootName === "/") root.name = "/";

      for (const e of group) {
        const relSegs = e.segs.slice(lcp);
        if (relSegs.length === 0) continue;
        let cursor = root;
        for (let i = 0; i < relSegs.length - 1; i++) {
          const name = relSegs[i]!;
          const full = formatFullDirPathForDisplay(
            joinPathSegments(e.segs.slice(0, lcp + i + 1)),
          );
          cursor = ensureFolder(cursor, name, full);
        }
        const fileName = relSegs[relSegs.length - 1]!;
        cursor.children.set(`f:${fileName}:${e.order}`, {
          kind: "file",
          file: e.file,
          order: e.order,
        });
      }

      roots.push(finalizeFolder(root, sortMode));
    } else {
      // 无卷、无公共前缀：每个文件的父目录各自成根，或文件直接为根
      const top: MutableFolder = {
        kind: "folder",
        name: "",
        fullDirPath: "",
        children: new Map(),
        files: [],
      };
      for (const e of group) {
        const segs = e.segs;
        if (segs.length === 1) {
          top.children.set(`f:${segs[0]}:${e.order}`, {
            kind: "file",
            file: e.file,
            order: e.order,
          });
          continue;
        }
        let cursor = top;
        for (let i = 0; i < segs.length - 1; i++) {
          const name = segs[i]!;
          const full = formatFullDirPathForDisplay(
            joinPathSegments(segs.slice(0, i + 1)),
          );
          cursor = ensureFolder(cursor, name, full);
        }
        const fileName = segs[segs.length - 1]!;
        cursor.children.set(`f:${fileName}:${e.order}`, {
          kind: "file",
          file: e.file,
          order: e.order,
        });
      }
      const finalized = finalizeFolder(top, sortMode);
      roots.push(...finalized.children);
    }
  }

  return sortTreeSiblingNodes(roots, sortMode);
}

export function collectFolderKeys(
  nodes: readonly FileListTreeNode[],
): Set<string> {
  const keys = new Set<string>();
  const walk = (list: readonly FileListTreeNode[]) => {
    for (const n of list) {
      if (n.kind === "folder") {
        keys.add(n.fullDirPath);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return keys;
}

export function rootFolderKeys(
  nodes: readonly FileListTreeNode[],
): string[] {
  return nodes
    .filter((n): n is FileListTreeFolderNode => n.kind === "folder")
    .map((n) => n.fullDirPath);
}

/** 若文件在树中，返回从根到其父目录的 fullDirPath 列表；否则 null */
export function collectAncestorFolderKeysForFile(
  roots: readonly FileListTreeNode[],
  filePath: string,
): string[] | null {
  const walk = (
    nodes: readonly FileListTreeNode[],
    ancestors: string[],
  ): string[] | null => {
    for (const n of nodes) {
      if (n.kind === "file") {
        if (fileHistoryKey(n.file.path) === fileHistoryKey(filePath)) {
          return ancestors;
        }
      } else {
        const hit = walk(n.children, [...ancestors, n.fullDirPath]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(roots, []);
}

export function flattenVisibleFileTreeRows(
  roots: readonly FileListTreeNode[],
  expanded: ReadonlySet<string>,
): FileListTreeFlatRow[] {
  const out: FileListTreeFlatRow[] = [];
  const walk = (nodes: readonly FileListTreeNode[], depth: number) => {
    for (const n of nodes) {
      if (n.kind === "folder") {
        const isExpanded = expanded.has(n.fullDirPath);
        out.push({
          kind: "folder",
          depth,
          name: n.name,
          fullDirPath: n.fullDirPath,
          fileCount: n.fileCount,
          totalSize: n.totalSize,
          expanded: isExpanded,
        });
        if (isExpanded) walk(n.children, depth + 1);
      } else {
        out.push({ kind: "file", depth, file: n.file });
      }
    }
  };
  walk(roots, 0);
  return out;
}

export function findFileRowIndex(
  rows: readonly FileListTreeFlatRow[],
  filePath: string,
): number {
  const want = fileHistoryKey(filePath);
  return rows.findIndex(
    (r) => r.kind === "file" && fileHistoryKey(r.file.path) === want,
  );
}

/** 文件是否位于目录之下（不含目录路径自身） */
export function isPathUnderDir(filePath: string, dirFullPath: string): boolean {
  const file = normalizePathForTree(filePath);
  const dir = normalizePathForTree(dirFullPath);
  if (!file || !dir) return false;
  const f = file.toLowerCase();
  const d = dir.toLowerCase();
  if (f === d) return false;
  const prefix = d.endsWith("/") ? d : `${d}/`;
  return f.startsWith(prefix);
}

/** 从扁平列表收集某目录及其子目录下的全部文件 */
export function collectFilesUnderDir<T extends { path: string }>(
  files: readonly T[],
  dirFullPath: string,
): T[] {
  return files.filter((f) => isPathUnderDir(f.path, dirFullPath));
}
