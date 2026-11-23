import Dexie, { type Table } from "dexie";
import type { DirEntry } from "./tauri";

// 浏览器开发模式兜底：用一张 files 表模拟磁盘目录结构
class FilesDB extends Dexie {
  files!: Table<{ path: string; content: string }, string>;

  constructor() {
    super("ai-writing-files");
    this.version(1).stores({ files: "path" });
  }
}

const db = new FilesDB();

function normalize(rel: string): string {
  const s = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  // "." 表示根目录，映射为空串，否则 listDir(".") 永远拿不到内容
  return s === "." || s === "./" ? "" : s;
}

export async function getDataRoot(): Promise<string> {
  return "(浏览器内存模式)";
}

export async function setDataRoot(_path: string): Promise<void> {
  /* 浏览器模式无数据目录概念 */
}

export async function pickDataRoot(): Promise<string | null> {
  return null;
}

export async function pickSavePath(): Promise<string | null> {
  return null;
}

export async function readText(rel: string): Promise<string> {
  const row = await db.files.get(normalize(rel));
  if (!row) throw new Error(`文件不存在: ${rel}`);
  return row.content;
}

export async function readJson<T>(rel: string): Promise<T | null> {
  try {
    return JSON.parse(await readText(rel)) as T;
  } catch {
    return null;
  }
}

export async function writeTextAtomic(rel: string, content: string): Promise<void> {
  await db.files.put({ path: normalize(rel), content });
}

export async function writeJson(rel: string, data: unknown): Promise<void> {
  await writeTextAtomic(rel, JSON.stringify(data, null, 2));
}

export async function deletePath(rel: string): Promise<void> {
  const prefix = normalize(rel);
  await db.files.where("path").startsWith(prefix + "/").delete();
  await db.files.delete(prefix);
}

export async function listDir(rel: string): Promise<DirEntry[]> {
  const prefix = normalize(rel) ? normalize(rel) + "/" : "";
  const all = await db.files.toArray();
  const seen = new Map<string, boolean>();
  for (const f of all) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const seg = rest.split("/")[0];
    if (!seg) continue;
    const isDir = rest.includes("/");
    seen.set(seg, (seen.get(seg) ?? false) || isDir);
  }
  return [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, isDir]) => ({ name, isDir }));
}

export async function pathExists(rel: string): Promise<boolean> {
  const row = await db.files.get(normalize(rel));
  return !!row;
}

export async function exportText(absPath: string, content: string): Promise<void> {
  throw new Error("浏览器模式不支持直接落盘导出");
}
