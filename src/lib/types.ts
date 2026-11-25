export interface ProviderConfig {
  id: string;
  preset: string; // zhipu | qwen | kimi | xiaomi | claude | custom
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** 接口协议：openai（默认，/chat/completions）| claude（Anthropic /v1/messages） */
  kind?: "openai" | "claude";
}

export interface SkinConfig {
  /** 自定义背景图（data URL，上传时 canvas 压缩至最长边 1920px） */
  background?: string;
  /** 背景暗化程度 0~0.85，防止背景图干扰文字 */
  dim?: number;
}

export interface StoredConfig {
  providers: ProviderConfig[];
  activeId: string;
  /** 外观：背景图与暗化程度（主题由 next-themes 存 localStorage） */
  skin?: SkinConfig;
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

export interface WorkTag {
  id: string; // tag-main / tag-discard / 自定义
  name: string;
  priority: number; // 越大越靠前，展示按此排序
}

export interface OutlineEntry {
  chId: string; // ch-0001
  title: string;
  outline: string;
  approved: boolean;
  /** 本章打的标签（WorkTag.id），可多个 */
  tags?: string[];
  /** 显式关联的前一章（缺省 = 紧邻上一章） */
  prevChId?: string | null;
}

export interface WorkOutline {
  chapters: OutlineEntry[];
  tags?: WorkTag[];
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
  /** 推理模型的思考过程（reasoning_content），仅 UI 展示用，不参与后续请求 */
  reasoning?: string;
}

/** AI 讨论的单个会话（持久化，切 tab / 重启应用均可恢复） */
export interface DiscussionSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** 用户勾选的消息下标（作为生成记忆/大纲的依据） */
  selected: number[];
}

/** 作品的讨论会话集合，存于 works/<id>/discussions.json */
export interface DiscussionsFile {
  activeId: string;
  sessions: DiscussionSession[];
}

