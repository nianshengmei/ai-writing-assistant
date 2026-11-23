import { isTauri } from "./env";
import * as tauriFs from "./storage/tauri";
import * as idbFs from "./storage/idb";
import { indexDB, clearWorkIndex } from "./storage/index";
import type {
  ProjectDoc,
  WorkOutline,
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
  StyleDoc,
  StoredConfig,
  GenerationRecord,
  ProviderConfig,
  WorldviewCategoriesDoc,
  StoryArcDoc,
  RecapLongDoc,
  RecapSegment,
  FuturePrediction,
  OutlineChatDoc,
  OutlineChatMessage,
  PromptOverrides,
  AiCallRecord,
} from "./types";
import { DEFAULT_WORLDVIEW_CATEGORIES } from "./prompts";

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
  recapLong: (w: string) => `${w}/memory/recap-long.json`,
  storyArc: (w: string) => `${w}/memory/story-arc.json`,
  prediction: (w: string) => `${w}/memory/future-prediction.json`,
  categories: (w: string) => `${w}/memory/worldview-categories.json`,
  outlineChat: (w: string) => `${w}/outline-chat.json`,
  foreshadows: (w: string) => `${w}/foreshadows.json`,
  draft: (w: string, c: string) => `${w}/drafts/${c}.json`,
  chapter: (w: string, c: string) => `${w}/chapters/${c}.json`,
  generation: (w: string, g: string) => `${w}/generations/${g}.json`,
  aiCall: (w: string, id: string) => `${w}/ai-calls/${id}.json`,
  promptOverrides: "prompts.json",
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
  await fs.writeJson(P.outline(id), { chapters: [] });
  await fs.writeJson(P.protagonist(id), { name: "", aliases: "", profile: "", arc: "", notes: "" });
  await fs.writeJson(P.characters(id), { entries: [] });
  await fs.writeJson(P.worldview(id), { entries: [] });
  await fs.writeJson(P.rules(id), { rules: [] });
  await fs.writeJson(P.presets(id), { presets: [] });
  await fs.writeJson(P.recap(id), { entries: [] });
  await fs.writeJson(P.foreshadows(id), { entries: [] });
  await fs.writeJson(P.recapLong(id), { segments: [], updatedAt: Date.now() });
  await fs.writeJson(P.storyArc(id), { mainline: "", stages: "", relations: "", updatedAt: Date.now() });
  await fs.writeJson(P.categories(id), { categories: [...DEFAULT_WORLDVIEW_CATEGORIES] });
  await fs.writeJson(P.outlineChat(id), { messages: [], updatedAt: Date.now() });
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
export async function getOutline(workId: string): Promise<WorkOutline> {
  return (await fs.readJson<WorkOutline>(P.outline(workId))) ?? { chapters: [] };
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
  };
  outline.chapters.push(entry);
  await saveOutline(workId, outline);
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
  await saveOutline(workId, outline);
  await fs.deletePath(P.draft(workId, chId)).catch(() => undefined);
  await fs.deletePath(P.chapter(workId, chId)).catch(() => undefined);
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

// ---------- 世界观标签种类（按作品） ----------
export async function listWorldviewCategories(workId: string): Promise<string[]> {
  const doc = await fs.readJson<WorldviewCategoriesDoc>(P.categories(workId));
  const cats = doc?.categories?.filter((c) => c.trim());
  return cats?.length ? cats : [...DEFAULT_WORLDVIEW_CATEGORIES];
}

export async function saveWorldviewCategories(workId: string, categories: string[]): Promise<void> {
  const clean = [...new Set(categories.map((c) => c.trim()).filter(Boolean))];
  await fs.writeJson(P.categories(workId), { categories: clean } satisfies WorldviewCategoriesDoc);
}

// ---------- 长篇记忆：段摘要 / 全文脉络 ----------
export async function getRecapLong(workId: string): Promise<RecapLongDoc> {
  return (await fs.readJson<RecapLongDoc>(P.recapLong(workId))) ?? { segments: [], updatedAt: 0 };
}

export async function saveRecapLong(workId: string, segments: RecapSegment[]): Promise<void> {
  await fs.writeJson(P.recapLong(workId), { segments, updatedAt: Date.now() } satisfies RecapLongDoc);
}

export async function getStoryArc(workId: string): Promise<StoryArcDoc> {
  return (await fs.readJson<StoryArcDoc>(P.storyArc(workId))) ?? { mainline: "", stages: "", relations: "", updatedAt: 0 };
}

export async function saveStoryArc(workId: string, doc: StoryArcDoc): Promise<void> {
  await fs.writeJson(P.storyArc(workId), { ...doc, updatedAt: Date.now() } satisfies StoryArcDoc);
}

// ---------- 后文预测（只存下一章） ----------
export async function getFuturePrediction(workId: string): Promise<FuturePrediction | null> {
  return fs.readJson<FuturePrediction>(P.prediction(workId));
}

export async function saveFuturePrediction(workId: string, pred: FuturePrediction): Promise<void> {
  await fs.writeJson(P.prediction(workId), pred);
}

export async function clearFuturePrediction(workId: string): Promise<void> {
  await fs.deletePath(P.prediction(workId)).catch(() => undefined);
}

// ---------- 大纲对话（按作品一份历史） ----------
export async function getOutlineChat(workId: string): Promise<OutlineChatDoc> {
  return (await fs.readJson<OutlineChatDoc>(P.outlineChat(workId))) ?? { messages: [], updatedAt: 0 };
}

export async function saveOutlineChat(workId: string, messages: OutlineChatMessage[]): Promise<void> {
  await fs.writeJson(P.outlineChat(workId), { messages, updatedAt: Date.now() } satisfies OutlineChatDoc);
}

export async function clearOutlineChat(workId: string): Promise<void> {
  await fs.writeJson(P.outlineChat(workId), { messages: [], updatedAt: Date.now() } satisfies OutlineChatDoc);
}

// ---------- 提示词覆盖（全局，按功能 key） ----------
export async function loadPromptOverrides(): Promise<PromptOverrides> {
  return (await fs.readJson<PromptOverrides>(P.promptOverrides)) ?? {};
}

export async function savePromptOverrides(overrides: PromptOverrides): Promise<void> {
  await fs.writeJson(P.promptOverrides, overrides);
}

export async function savePromptOverride(featureKey: string, override: { system?: string; extra?: string }): Promise<void> {
  const all = await loadPromptOverrides();
  if (!override.system?.trim() && !override.extra?.trim()) delete all[featureKey];
  else all[featureKey] = override;
  await savePromptOverrides(all);
}

// ---------- 前情记忆：可编辑 / 删除 ----------
export async function saveRecapEntry(workId: string, entry: RecapEntry): Promise<void> {
  const doc = (await fs.readJson<{ entries: RecapEntry[] }>(P.recap(workId))) ?? { entries: [] };
  const existing = doc.entries.find((e) => e.chId === entry.chId);
  if (existing) {
    existing.summary = entry.summary;
    existing.createdAt = entry.createdAt || Date.now();
  } else {
    doc.entries.push({ ...entry, createdAt: entry.createdAt || Date.now() });
  }
  doc.entries.sort((a, b) => a.chId.localeCompare(b.chId));
  await fs.writeJson(P.recap(workId), doc);
}

export async function deleteRecapEntry(workId: string, chId: string): Promise<void> {
  const doc = (await fs.readJson<{ entries: RecapEntry[] }>(P.recap(workId))) ?? { entries: [] };
  doc.entries = doc.entries.filter((e) => e.chId !== chId);
  await fs.writeJson(P.recap(workId), doc);
}

// ---------- 章节位置辅助 ----------
/** 该章之前是否存在已采纳的章节（决定能不能做后文预测） */
export async function hasApprovedPredecessor(workId: string, chId: string): Promise<boolean> {
  const outline = await getOutline(workId);
  const i = outline.chapters.findIndex((c) => c.chId === chId);
  if (i <= 0) return false;
  return outline.chapters.slice(0, i).some((c) => c.approved);
}

/** 取下一章（用于后文预测的目标） */
export async function findNextChapter(workId: string, chId: string): Promise<OutlineEntry | null> {
  const outline = await getOutline(workId);
  const i = outline.chapters.findIndex((c) => c.chId === chId);
  if (i < 0) return null;
  return outline.chapters[i + 1] ?? null;
}

/** 把讨论生成的大纲合并进 outline.json：已有章节整合保留，新章节追加 */
export async function mergeOutlineChapters(
  workId: string,
  items: { title: string; outline: string }[],
): Promise<{ added: number; updated: number }> {
  const outline = await getOutline(workId);
  const next = [...outline.chapters];
  let added = 0;
  let updated = 0;
  for (let i = 0; i < items.length; i++) {
    const title = items[i].title?.trim();
    const text = items[i].outline?.trim();
    if (i < next.length) {
      const old = next[i];
      const newTitle = title || old.title;
      const newOutline = text || old.outline;
      if (newTitle !== old.title || newOutline !== old.outline) {
        next[i] = { ...old, title: newTitle, outline: newOutline };
        updated++;
      }
    } else {
      next.push({
        chId: await nextChId({ chapters: next }),
        title: title || `第${next.length + 1}章`,
        outline: text ?? "",
        approved: false,
      });
      added++;
    }
  }
  await saveOutline(workId, { ...outline, chapters: next });
  return { added, updated };
}

// ---------- 非正文 AI 调用记录 ----------
export async function saveAiCall(workId: string, rec: Omit<AiCallRecord, "id" | "createdAt">): Promise<AiCallRecord> {
  const full: AiCallRecord = { ...rec, id: `call-${uid()}`, createdAt: Date.now() };
  await fs.writeJson(P.aiCall(workId, full.id), full);
  return full;
}

export async function listAiCalls(workId: string): Promise<AiCallRecord[]> {
  const entries = await fs.listDir(`${workId}/ai-calls`);
  const out: AiCallRecord[] = [];
  for (const e of entries) {
    if (e.isDir || !e.name.endsWith(".json")) continue;
    const r = await fs.readJson<AiCallRecord>(`${workId}/ai-calls/${e.name}`);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}
