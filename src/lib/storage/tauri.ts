import { invoke } from "@tauri-apps/api/core";

export interface DirEntry {
  name: string;
  isDir: boolean;
}

let rootPromise: Promise<string> | null = null;

export async function getDataRoot(): Promise<string> {
  if (!rootPromise) {
    rootPromise = invoke<string>("get_data_root");
  }
  return rootPromise;
}

export async function setDataRoot(path: string): Promise<void> {
  await invoke("set_data_root", { path });
  rootPromise = Promise.resolve(path);
}

export async function pickDataRoot(): Promise<string | null> {
  const p = await invoke<string | null>("pick_data_root");
  return p;
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  const p = await invoke<string | null>("pick_save_path", { defaultName });
  return p;
}

export async function readText(rel: string): Promise<string> {
  return invoke<string>("read_text", { root: await getDataRoot(), rel });
}

export async function readJson<T>(rel: string): Promise<T | null> {
  try {
    return JSON.parse(await readText(rel)) as T;
  } catch {
    return null;
  }
}

export async function writeTextAtomic(rel: string, content: string): Promise<void> {
  await invoke("write_text_atomic", { root: await getDataRoot(), rel, content });
}

export async function writeJson(rel: string, data: unknown): Promise<void> {
  await writeTextAtomic(rel, JSON.stringify(data, null, 2));
}

export async function deletePath(rel: string): Promise<void> {
  await invoke("delete_path", { root: await getDataRoot(), rel });
}

export async function listDir(rel: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { root: await getDataRoot(), rel });
}

export async function pathExists(rel: string): Promise<boolean> {
  return invoke<boolean>("exists", { root: await getDataRoot(), rel });
}

export async function exportText(absPath: string, content: string): Promise<void> {
  await invoke("export_text", { path: absPath, content });
}
