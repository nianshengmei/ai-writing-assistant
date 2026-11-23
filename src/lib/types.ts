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
