export interface ProviderConfig {
  id: string;
  preset: string; // zhipu | qwen | kimi | xiaomi | custom
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface StoredConfig {
  providers: ProviderConfig[];
  activeId: string;
}

export interface StyleProfile {
  pov: string;
  tone: string;
  sentenceRhythm: string;
  dialogueStyle: string;
  descriptionRatio: string;
  rhetoric: string;
  vocabularyFavor: string;
  vocabularyAvoid: string;
  pacing: string;
  hooks: string;
  taboos: string;
}

export interface StyleDoc {
  id: string;
  name: string;
  profile: StyleProfile;
  languageSamples: string[];
  actionSamples: string[];
  sceneSamples: string[];
  sourceNote: string;
  updatedAt: number;
}

export interface OutlineEntry {
  chId: string; // ch-0001
  title: string;
  outline: string;
  approved: boolean;
}

export interface WorkOutline {
  chapters: OutlineEntry[];
}

export interface ProjectDoc {
  id: string;
  title: string;
  genre: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChapterContent {
  chId: string;
  content: string;
  approvedAt: number;
}

export interface DraftDoc {
  chId: string;
  content: string;
  lastGenId?: string;
  updatedAt: number;
}

export interface CharacterEntry {
  id: string;
  name: string;
  relation: string;
  content: string;
}

export interface WorldviewEntry {
  id: string;
  category: string;
  name: string;
  content: string;
}

export interface RuleEntry {
  id: string;
  text: string;
}

export interface FuturePreset {
  id: string;
  title: string;
  targetChapter: string;
  content: string;
}

export interface RecapEntry {
  chId: string;
  summary: string;
  createdAt: number;
}

export interface ForeshadowEntry {
  id: string;
  title: string;
  plantedIn: string;
  resolveIn: string;
  status: "open" | "resolved";
  notes: string;
}

export interface ProtagonistDoc {
  name: string;
  aliases: string;
  profile: string;
  arc: string;
  notes: string;
}

export interface GenerationRecord {
  id: string; // gen-000001
  chId: string;
  prompt: { system: string; user: string };
  providerName: string;
  model: string;
  styleIds: string[];
  output: string;
  feedback?: string;
  status: "draft" | "approved" | "discarded";
  createdAt: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---------- 新增：标签种类 / 长篇记忆 / 全文脉络 / 后文预测 / 大纲对话 / 提示词覆盖 ----------

export interface WorldviewCategoriesDoc {
  categories: string[];
}

/** 50 章窗口内的段摘要（每 10 章压缩为一段） */
export interface RecapSegment {
  fromCh: string;
  toCh: string;
  summary: string;
  createdAt: number;
}

export interface RecapLongDoc {
  segments: RecapSegment[];
  updatedAt: number;
}

/** 全文脉络：全书宏观记忆，滚动更新 */
export interface StoryArcDoc {
  mainline: string;
  stages: string;
  relations: string;
  updatedAt: number;
}

/** 后文预测：AI 对下一章的推测，可被作者修改 */
export interface FuturePrediction {
  chId: string; // 预测的目标章节
  aiContent: string; // AI 原始生成内容，用于判定是否被作者改过
  content: string; // 当前生效内容（可能已被作者编辑）
  generatedAt: number;
  editedAt: number | null;
  reviewedAt: number | null;
}

export interface OutlineChatMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
}

export interface OutlineChatDoc {
  messages: OutlineChatMessage[];
  updatedAt: number;
}

/** 按功能持久化的提示词覆盖 */
export interface PromptOverride {
  system?: string;
  /** 追加到 User 末尾的「作者补充要求」，持久化 */
  extra?: string;
}

export type PromptOverrides = Record<string, PromptOverride>;

/** 非正文类 AI 调用记录，保持全链路可追溯 */
export interface AiCallRecord {
  id: string;
  feature: string;
  prompt: { system: string; user: string };
  providerName: string;
  model: string;
  output: string;
  createdAt: number;
}

/** 记忆更新的分组结果 */
export interface MemoryUpdateResult {
  protagonist?: ProtagonistDoc;
  characters?: CharacterEntry[];
  worldview?: WorldviewEntry[];
  recapSummary?: string;
  foreshadows?: ForeshadowEntry[];
  segments?: RecapSegment[];
  storyArc?: StoryArcDoc;
  prediction?: string;
}
