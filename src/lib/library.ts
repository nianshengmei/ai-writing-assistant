import { isTauri } from "./env";
import * as tauriFs from "./storage/tauri";
import * as idbFs from "./storage/idb";
import { indexDB, clearWorkIndex } from "./storage/index";
import type {
  ProjectDoc,
  WorkOutline,
  WorkTag,
  OutlineEntry,
  DraftDoc,
  ChapterContent,
  ProtagonistDoc,
  CharacterEntry,
  WorldviewEntry,
  RuleEntry,
  FuturePreset,
  RecapEntry,
  ForeshadowEntry,
  DiscussionsFile,
  StyleDoc,
  StoredConfig,
  GenerationRecord,
  ProviderConfig,
} from "./types";

const fs = isTauri() ? tauriFs : idbFs;

export { fs as backend };
export { tauriFs };

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// ---------- 路径约定 ----------
const P = {
  config: "config.json",
  style: (id: string) => `styles/${id}.json`,
  project: (w: string) => `${w}/project.json`,
  outline: (w: string) => `${w}/outline.json`,
  protagonist: (w: string) => `${w}/memory/protagonist.json`,
  characters: (w: string) => `${w}/memory/characters.json`,
  worldview: (w: string) => `${w}/memory/worldview.json`,
  rules: (w: string) => `${w}/memory/author-rules.json`,
  presets: (w: string) => `${w}/memory/future-presets.json`,
  recap: (w: string) => `${w}/memory/recap.json`,
  foreshadows: (w: string) => `${w}/foreshadows.json`,
  discussions: (w: string) => `${w}/discussions.json`,
  draft: (w: string, c: string) => `${w}/drafts/${c}.json`,
  chapter: (w: string, c: string) => `${w}/chapters/${c}.json`,
  generation: (w: string, g: string) => `${w}/generations/${g}.json`,
};

// ---------- 配置 ----------
export const DEFAULT_CONFIG: StoredConfig = { providers: [], activeId: "" };

export async function loadConfig(): Promise<StoredConfig> {
  const c = await fs.readJson<StoredConfig>(P.config);
  return c ?? DEFAULT_CONFIG;
}

export async function saveConfig(c: StoredConfig): Promise<void> {
  await fs.writeJson(P.config, c);
}

export async function getActiveProvider(): Promise<ProviderConfig | null> {
  const c = await loadConfig();
  return c.providers.find((p) => p.id === c.activeId) ?? c.providers[0] ?? null;
}

// ---------- 作品目录 ----------
export interface WorkBrief {
  id: string;
  title: string;
  genre: string;
  updatedAt: number;
}

export async function listWorks(): Promise<WorkBrief[]> {
  const entries = await fs.listDir(".");
  const out: WorkBrief[] = [];
  for (const e of entries) {
    if (!e.isDir || !e.name.startsWith("w-")) continue;
    const p = await fs.readJson<ProjectDoc>(P.project(e.name));
    if (p) out.push({ id: p.id, title: p.title, genre: p.genre, updatedAt: p.updatedAt });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function createWork(title: string, genre: string, description: string): Promise<string> {
  const id = `w-${Date.now().toString(36)}`;
  const now = Date.now();
  const doc: ProjectDoc = { id, title, genre, description, createdAt: now, updatedAt: now };
  await fs.writeJson(P.project(id), doc);
  await fs.writeJson(P.outline(id), { chapters: [], tags: DEFAULT_TAGS.map((t) => ({ ...t })) });
  await fs.writeJson(P.protagonist(id), { name: "", aliases: "", profile: "", arc: "", notes: "" });
  await fs.writeJson(P.characters(id), { entries: [] });
  await fs.writeJson(P.worldview(id), { entries: [] });
  await fs.writeJson(P.rules(id), { rules: [] });
  await fs.writeJson(P.presets(id), { presets: [] });
  await fs.writeJson(P.recap(id), { entries: [] });
  await fs.writeJson(P.foreshadows(id), { entries: [] });
  return id;
}

export async function deleteWork(id: string): Promise<void> {
  await fs.deletePath(id);
  await clearWorkIndex(id);
  await indexDB.idxWorks.delete(id);
}

export async function getProject(id: string): Promise<ProjectDoc | null> {
  return fs.readJson<ProjectDoc>(P.project(id));
}

export async function saveProject(doc: ProjectDoc): Promise<void> {
  doc.updatedAt = Date.now();
  await fs.writeJson(P.project(doc.id), doc);
  await indexDB.idxWorks.put({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt });
}

// ---------- 章节目录（outline.json 为章节目录的事实来源） ----------
/** 作品初始标签：正章(10) / 废弃(9)，其余标签由用户自建、优先级自定 */
export const DEFAULT_TAGS: WorkTag[] = [
  { id: "tag-main", name: "正章", priority: 10 },
  { id: "tag-discard", name: "废弃", priority: 9 },
];

/** 读取时兜底：旧数据/缺字段自动补默认标签与章节默认「正章」 */
function normalizeOutline(o: WorkOutline): WorkOutline {
  const tags = o.tags?.length ? o.tags : DEFAULT_TAGS.map((t) => ({ ...t }));
  const chapters = (o.chapters ?? []).map((c) => ({ ...c, tags: c.tags ?? ["tag-main"] }));
  return { tags, chapters };
}

export async function getOutline(workId: string): Promise<WorkOutline> {
  return normalizeOutline((await fs.readJson<WorkOutline>(P.outline(workId))) ?? { chapters: [] });
}

/** 新章节默认打哪个标签：优先「正章」，否则取优先级最高的标签 */
function defaultChapterTag(outline: WorkOutline): string[] {
  if (outline.tags?.some((t) => t.id === "tag-main")) return ["tag-main"];
  const top = [...(outline.tags ?? [])].sort((a, b) => b.priority - a.priority)[0];
  return top ? [top.id] : [];
}

export async function saveOutline(workId: string, outline: WorkOutline): Promise<void> {
  await fs.writeJson(P.outline(workId), outline);
  await syncChapterIndex(workId, outline);
}

async function nextChId(outline: WorkOutline): Promise<string> {
  const nums = outline.chapters
    .map((c) => parseInt(c.chId.replace("ch-", ""), 10))
    .filter((n) => !isNaN(n));
  return `ch-${pad((nums.length ? Math.max(...nums) : 0) + 1, 4)}`;
}

export async function addChapterEntry(workId: string, title: string, outlineText: string): Promise<OutlineEntry> {
  const outline = await getOutline(workId);
  const entry: OutlineEntry = {
    chId: await nextChId(outline),
    title: title || `第${outline.chapters.length + 1}章`,
    outline: outlineText,
    approved: false,
    tags: defaultChapterTag(outline),
    prevChId: null,
  };
  outline.chapters.push(entry);
  await saveOutline(workId, outline);
  // 新章必须是空白的：清掉同 chId 可能残留的孤儿草稿/正文文件
  await fs.deletePath(P.draft(workId, entry.chId)).catch(() => undefined);
  await fs.deletePath(P.chapter(workId, entry.chId)).catch(() => undefined);
  return entry;
}

export async function updateOutlineEntry(workId: string, chId: string, patch: Partial<OutlineEntry>): Promise<void> {
  const outline = await getOutline(workId);
  const entry = outline.chapters.find((c) => c.chId === chId);
  if (!entry) return;
  Object.assign(entry, patch);
  await saveOutline(workId, outline);
}

export async function removeChapterEntry(workId: string, chId: string): Promise<void> {
  const outline = await getOutline(workId);
  outline.chapters = outline.chapters.filter((c) => c.chId !== chId);
  // 清掉指向被删章节的「关联前一章」引用
  for (const c of outline.chapters) {
    if (c.prevChId === chId) c.prevChId = null;
  }
  await saveOutline(workId, outline);
  await fs.deletePath(P.draft(workId, chId)).catch(() => undefined);
  await fs.deletePath(P.chapter(workId, chId)).catch(() => undefined);
}

/** 保存作品级标签定义 */
export async function setWorkTags(workId: string, tags: WorkTag[]): Promise<void> {
  const outline = await getOutline(workId);
  outline.tags = tags;
  await saveOutline(workId, outline);
}

export async function moveChapter(workId: string, chId: string, dir: -1 | 1): Promise<void> {
  const outline = await getOutline(workId);
  const i = outline.chapters.findIndex((c) => c.chId === chId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= outline.chapters.length) return;
  [outline.chapters[i], outline.chapters[j]] = [outline.chapters[j], outline.chapters[i]];
  await saveOutline(workId, outline);
}

// ---------- 草稿与正式章节 ----------
export async function readDraft(workId: string, chId: string): Promise<DraftDoc | null> {
  return fs.readJson<DraftDoc>(P.draft(workId, chId));
}

export async function saveDraft(workId: string, chId: string, content: string, lastGenId?: string): Promise<void> {
  const doc: DraftDoc = { chId, content, lastGenId, updatedAt: Date.now() };
  await fs.writeJson(P.draft(workId, chId), doc);
}

export async function deleteDraft(workId: string, chId: string): Promise<void> {
  await fs.deletePath(P.draft(workId, chId));
}

export async function readChapterContent(workId: string, chId: string): Promise<ChapterContent | null> {
  return fs.readJson<ChapterContent>(P.chapter(workId, chId));
}

export async function approveChapter(workId: string, chId: string, content: string): Promise<void> {
  await fs.writeJson(P.chapter(workId, chId), { chId, content, approvedAt: Date.now() } satisfies ChapterContent);
  await updateOutlineEntry(workId, chId, { approved: true });
}

// ---------- 记忆库 ----------
export async function getProtagonist(workId: string): Promise<ProtagonistDoc> {
  return (await fs.readJson<ProtagonistDoc>(P.protagonist(workId))) ?? { name: "", aliases: "", profile: "", arc: "", notes: "" };
}

export async function saveProtagonist(workId: string, doc: ProtagonistDoc): Promise<void> {
  await fs.writeJson(P.protagonist(workId), doc);
}

export async function listCharacters(workId: string): Promise<CharacterEntry[]> {
  return (await fs.readJson<{ entries: CharacterEntry[] }>(P.characters(workId)))?.entries ?? [];
}

export async function saveCharacters(workId: string, entries: CharacterEntry[]): Promise<void> {
  await fs.writeJson(P.characters(workId), { entries });
}

export async function listWorldview(workId: string): Promise<WorldviewEntry[]> {
  return (await fs.readJson<{ entries: WorldviewEntry[] }>(P.worldview(workId)))?.entries ?? [];
}

export async function saveWorldview(workId: string, entries: WorldviewEntry[]): Promise<void> {
  await fs.writeJson(P.worldview(workId), { entries });
}

export async function listRules(workId: string): Promise<RuleEntry[]> {
  return (await fs.readJson<{ rules: RuleEntry[] }>(P.rules(workId)))?.rules ?? [];
}

export async function saveRules(workId: string, rules: RuleEntry[]): Promise<void> {
  await fs.writeJson(P.rules(workId), { rules });
}

export async function listFuturePresets(workId: string): Promise<FuturePreset[]> {
  return (await fs.readJson<{ presets: FuturePreset[] }>(P.presets(workId)))?.presets ?? [];
}

export async function saveFuturePresets(workId: string, presets: FuturePreset[]): Promise<void> {
  await fs.writeJson(P.presets(workId), { presets });
}

export async function listRecap(workId: string): Promise<RecapEntry[]> {
  return (await fs.readJson<{ entries: RecapEntry[] }>(P.recap(workId)))?.entries ?? [];
}

export async function appendRecap(workId: string, chId: string, summary: string): Promise<void> {
  const doc = (await fs.readJson<{ entries: RecapEntry[] }>(P.recap(workId))) ?? { entries: [] };
  const existing = doc.entries.find((e) => e.chId === chId);
  if (existing) existing.summary = summary;
  else doc.entries.push({ chId, summary, createdAt: Date.now() });
  await fs.writeJson(P.recap(workId), doc);
}

export async function listForeshadows(workId: string): Promise<ForeshadowEntry[]> {
  return (await fs.readJson<{ entries: ForeshadowEntry[] }>(P.foreshadows(workId)))?.entries ?? [];
}

export async function saveForeshadows(workId: string, entries: ForeshadowEntry[]): Promise<void> {
  await fs.writeJson(P.foreshadows(workId), { entries });
}

// ---------- AI 讨论会话（切 tab / 重启均持久化） ----------
export async function getDiscussions(workId: string): Promise<DiscussionsFile> {
  return (
    (await fs.readJson<DiscussionsFile>(P.discussions(workId))) ?? { activeId: "", sessions: [] }
  );
}

export async function saveDiscussions(workId: string, file: DiscussionsFile): Promise<void> {
  await fs.writeJson(P.discussions(workId), file);
}


// ---------- 全局风格库 ----------
export async function listStyles(): Promise<StyleDoc[]> {
  const entries = await fs.listDir("styles");
  const out: StyleDoc[] = [];
  for (const e of entries) {
    if (e.isDir || !e.name.endsWith(".json")) continue;
    const s = await fs.readJson<StyleDoc>(`styles/${e.name}`);
    if (s) out.push(s);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export async function nextStyleId(): Promise<string> {
  const entries = await fs.listDir("styles");
  const nums = entries
    .map((e) => parseInt(e.name.replace("style-", "").replace(".json", ""), 10))
    .filter((n) => !isNaN(n));
  return `style-${pad((nums.length ? Math.max(...nums) : 0) + 1, 4)}`;
}

export async function saveStyle(style: StyleDoc): Promise<void> {
  style.updatedAt = Date.now();
  await fs.writeJson(P.style(style.id), style);
}

export async function deleteStyle(id: string): Promise<void> {
  await fs.deletePath(P.style(id));
}

// ---------- 生成历史 ----------
async function nextGenId(workId: string): Promise<string> {
  const entries = await fs.listDir(`${workId}/generations`);
  const nums = entries
    .map((e) => parseInt(e.name.replace("gen-", "").replace(".json", ""), 10))
    .filter((n) => !isNaN(n));
  return `gen-${pad((nums.length ? Math.max(...nums) : 0) + 1, 6)}`;
}

export async function saveGeneration(
  workId: string,
  rec: Omit<GenerationRecord, "id" | "createdAt">,
): Promise<GenerationRecord> {
  const full: GenerationRecord = { ...rec, id: await nextGenId(workId), createdAt: Date.now() };
  await fs.writeJson(P.generation(workId, full.id), full);
  await indexDB.idxGenerations.put({
    workId,
    genId: full.id,
    chId: full.chId,
    status: full.status,
    createdAt: full.createdAt,
    preview: full.output.slice(0, 80),
  });
  return full;
}

export async function getGeneration(workId: string, genId: string): Promise<GenerationRecord | null> {
  return fs.readJson<GenerationRecord>(P.generation(workId, genId));
}

export async function updateGenerationStatus(workId: string, genId: string, status: GenerationRecord["status"]): Promise<void> {
  const rec = await getGeneration(workId, genId);
  if (!rec) return;
  rec.status = status;
  await fs.writeJson(P.generation(workId, genId), rec);
  await indexDB.idxGenerations.update([workId, genId], { status });
}

export async function listGenerations(workId: string): Promise<GenerationRecord[]> {
  // 直接读目录（单作品生成记录通常几十到几百条，可接受；索引供跨作品统计用）
  const entries = await fs.listDir(`${workId}/generations`);
  const out: GenerationRecord[] = [];
  for (const e of entries) {
    if (e.isDir || !e.name.endsWith(".json")) continue;
    const r = await fs.readJson<GenerationRecord>(`${workId}/generations/${e.name}`);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

// ---------- 索引重建 ----------
export async function rebuildWorkIndex(workId: string): Promise<void> {
  await clearWorkIndex(workId);
  const outline = await getOutline(workId);
  await syncChapterIndex(workId, outline);
}

async function syncChapterIndex(workId: string, outline: WorkOutline): Promise<void> {
  const rows = await Promise.all(
    outline.chapters.map(async (entry, i) => {
      let wordCount = 0;
      const ch = await readChapterContent(workId, entry.chId);
      if (ch) wordCount = ch.content.length;
      else {
        const draft = await readDraft(workId, entry.chId);
        if (draft) wordCount = draft.content.length;
      }
      return {
        workId,
        chId: entry.chId,
        order: i + 1,
        title: entry.title,
        approved: entry.approved,
        wordCount,
      };
    }),
  );
  await indexDB.idxChapters.bulkPut(rows);
}
