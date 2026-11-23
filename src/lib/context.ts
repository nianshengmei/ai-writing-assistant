import type {
  ChatMessage,
  CharacterEntry,
  ForeshadowEntry,
  FuturePrediction,
  FuturePreset,
  OutlineChatMessage,
  OutlineEntry,
  ProjectDoc,
  ProtagonistDoc,
  RecapEntry,
  RecapSegment,
  RuleEntry,
  StoryArcDoc,
  StyleDoc,
  WorldviewEntry,
} from "./types";
import {
  CHARACTER_ASSIST_SYSTEM,
  OUTLINE_CHAT_SYSTEM,
  OUTLINE_FINALIZE_SYSTEM,
  OUTLINE_PROPOSE_SYSTEM,
  PREDICTION_SYSTEM,
  RECAP_COMPRESS_SYSTEM,
  RECAP_FORESHADOW_UPDATE_SYSTEM,
  RECAP_SYSTEM,
  SETTING_UPDATE_SYSTEM,
  STORY_ARC_SYSTEM,
  STYLE_MERGE_SYSTEM,
  STYLE_OBSERVATION_SYSTEM,
  STYLE_SAMPLES_SYSTEM,
  WORLDVIEW_ASSIST_SYSTEM,
  WORLDVIEW_EXTRACT_SYSTEM,
} from "./prompts";

// 兼容旧引用：风格提示词常量原本定义在本文件
export {
  STYLE_OBSERVATION_SYSTEM,
  STYLE_MERGE_SYSTEM,
  STYLE_SAMPLES_SYSTEM,
  DEFAULT_WORLDVIEW_CATEGORIES,
} from "./prompts";

// ---------- 风格注入 ----------
function styleBlock(styleDocs: StyleDoc[]): string {
  if (!styleDocs.length) return "";
  const parts = styleDocs.map((s, i) => {
    const p = s.profile;
    const main = i === 0 ? "（主风格）" : "（辅助风格）";
    const samples: string[] = [];
    if (s.languageSamples.length) samples.push(`语言示例：\n${s.languageSamples.slice(0, 3).map((t) => `  ${t.slice(0, 200)}`).join("\n")}`);
    if (s.actionSamples.length) samples.push(`动作描写示例：\n${s.actionSamples.slice(0, 3).map((t) => `  ${t.slice(0, 200)}`).join("\n")}`);
    if (s.sceneSamples.length) samples.push(`经典场面示例：\n${s.sceneSamples.slice(0, 2).map((t) => `  ${t.slice(0, 250)}`).join("\n")}`);
    return `【风格 ${i + 1}${main}：${s.name}】
- 叙事视角：${p.pov || "未指定"}
- 文风基调：${p.tone || "未指定"}
- 句式节奏：${p.sentenceRhythm || "未指定"}
- 对话风格：${p.dialogueStyle || "未指定"}
- 描写配比：${p.descriptionRatio || "未指定"}
- 修辞习惯：${p.rhetoric || "未指定"}
- 用词偏好：${p.vocabularyFavor || "未指定"}；避免用词：${p.vocabularyAvoid || "未指定"}
- 节奏把控：${p.pacing || "未指定"}
- 章末钩子：${p.hooks || "未指定"}
- 禁忌：${p.taboos || "未指定"}
${samples.length ? "\n" + samples.join("\n") : ""}`;
  });
  return `【写作风格要求】请严格模仿以下风格写作，以第一条为主风格，辅助风格按场景参考：\n\n${parts.join("\n\n")}`;
}

function rulesBlock(rules: RuleEntry[]): string {
  if (!rules.length) return "";
  return `【作者硬性要求（必须遵守）】\n${rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n")}`;
}

// ---------- 相关记忆检索（按名称匹配） ----------
function pickRelevant(text: string, candidates: { key: string; render: () => string }[], limit: number): string[] {
  const scored = candidates
    .map((c) => ({ c, hit: text.includes(c.key) }))
    .filter((x) => x.hit)
    .slice(0, limit)
    .map((x) => x.c.render());
  return scored;
}

function chNum(chId: string): string {
  return chId.replace("ch-", "第") + "章";
}

/** 最近 N 章保留详细摘要，更早的用段摘要替代，避免提示词爆炸 */
const DETAILED_RECAP_WINDOW = 15;

export interface MemoryBundle {
  protagonist: ProtagonistDoc;
  characters: CharacterEntry[];
  worldview: WorldviewEntry[];
  rules: RuleEntry[];
  presets: FuturePreset[];
  recap: RecapEntry[];
  foreshadows: ForeshadowEntry[];
  lastChapter: { title: string; tail: string } | null;
  storyArc?: StoryArcDoc | null;
  recapSegments?: RecapSegment[];
  prediction?: FuturePrediction | null;
}

export interface AssembleArgs {
  project: ProjectDoc;
  entry: OutlineEntry;
  memory: MemoryBundle;
  styleDocs: StyleDoc[];
  feedback?: string;
  previousDraft?: string;
  targetLength?: number;
}

export interface AssembledPrompt {
  system: string;
  user: string;
}

export function assembleGeneration(args: AssembleArgs): AssembledPrompt {
  const { project, entry, memory, styleDocs, feedback, previousDraft, targetLength } = args;
  const searchText = `${entry.title} ${entry.outline}`;

  const systemParts: string[] = [
    "你是一位资深小说作家，正在为作者创作一章正文。请严格遵守下方所有要求与设定，不得与已有记忆产生冲突（人名、称谓、能力、时间线、人物关系）。",
  ];
  const style = styleBlock(styleDocs);
  if (style) systemParts.push(style);
  const rules = rulesBlock(memory.rules);
  if (rules) systemParts.push(rules);
  systemParts.push(
    "输出要求：直接输出正文内容，不要输出章节标题、序号、思考过程或任何解释说明；多用动作、对话与细节做展开式描写，避免总结性陈述。",
  );
  const system = systemParts.join("\n\n");

  const userParts: string[] = [];
  userParts.push(`【作品】《${project.title}》（${project.genre || "未分类"}）\n【作品简介】${project.description || "无"}`);

  if (memory.protagonist.name || memory.protagonist.profile) {
    userParts.push(
      `【主角记忆】\n姓名：${memory.protagonist.name || "未定"}（${memory.protagonist.aliases || "无别名"}）\n人设：${memory.protagonist.profile || "未填写"}\n成长线：${memory.protagonist.arc || "未填写"}\n备注：${memory.protagonist.notes || "无"}`,
    );
  }

  const relevantChars = pickRelevant(
    searchText,
    memory.characters.map((c) => ({ key: c.name, render: () => `【配角·${c.name}】（${c.relation || "关系未定"}）${c.content}` })),
    10,
  );
  userParts.push(`【相关配角】\n${relevantChars.length ? relevantChars.join("\n") : "（本章细纲中未涉及具名配角）"}`);

  const relevantWorld = pickRelevant(
    searchText,
    memory.worldview.map((w) => ({ key: w.name, render: () => `【${w.category}·${w.name}】${w.content}` })),
    10,
  );
  userParts.push(`【世界观摘录】\n${relevantWorld.length ? relevantWorld.join("\n") : "（暂无匹配的世界观条目）"}`);

  const arc = memory.storyArc;
  if (arc && (arc.mainline || arc.stages || arc.relations)) {
    userParts.push(
      `【全文脉络】\n- 主线：${arc.mainline || "未整理"}\n- 阶段与转折：${arc.stages || "未整理"}\n- 人物关系演变：${arc.relations || "未整理"}`,
    );
  }

  const recent = memory.recap.slice(-DETAILED_RECAP_WINDOW);
  const recentFrom = recent[0]?.chId ?? "";
  const olderSegments = (memory.recapSegments ?? []).filter((s) => !recentFrom || s.toCh < recentFrom);
  const recapLines: string[] = [];
  if (olderSegments.length) {
    recapLines.push("（更早阶段·阶段摘要）");
    olderSegments.forEach((s) => recapLines.push(`- ${chNum(s.fromCh)}~${chNum(s.toCh)}：${s.summary}`));
    if (recent.length) recapLines.push("（最近章节·逐章摘要）");
  }
  recent.forEach((r) => recapLines.push(`- ${chNum(r.chId)}：${r.summary}`));
  userParts.push(`【前情记忆】\n${recapLines.length ? recapLines.join("\n") : "（这是开篇，无前情）"}`);

  if (memory.lastChapter) {
    userParts.push(`【上一章《${memory.lastChapter.title}》结尾原文】（请自然衔接，不要重复）\n${memory.lastChapter.tail}`);
  } else {
    userParts.push("【上一章】（本章为全书第一章）");
  }

  const openForeshadows = memory.foreshadows.filter((f) => f.status === "open");
  userParts.push(
    `【未回收伏笔】\n${openForeshadows.length ? openForeshadows.map((f) => `- ${f.title}（埋于${f.plantedIn || "未标注"}，计划${f.resolveIn || "未定"}回收）${f.notes ? " " + f.notes : ""}`).join("\n") : "（暂无）"}`,
  );

  const relevantPresets = pickRelevant(
    searchText,
    memory.presets.map((p) => ({
      key: p.title,
      render: () => `- ${p.title}（预计${p.targetChapter || "后续"}推进）：${p.content}`,
    })),
    5,
  );
  userParts.push(`【后文预设（作者规划）】\n${relevantPresets.length ? relevantPresets.join("\n") : "（暂无）"}`);

  // 后文预测：仅在存在时注入；首章整段不出现
  const prediction = memory.prediction;
  if (prediction && prediction.content.trim()) {
    userParts.push(
      `【后文预测（AI 推测的下一章走向，作者已确认/修改；如与作者规划冲突，以作者规划为准）】\n${prediction.content.trim()}`,
    );
  }

  userParts.push(`【本章目录信息】${entry.title}\n【本章细纲】\n${entry.outline || "（无细纲，请依据前情自然推进）"}`);

  if (feedback) {
    userParts.push(
      `【作者对上一稿的意见】${feedback}\n${previousDraft ? `【上一稿全文】（供参考修改，不要原样重复）\n${previousDraft.slice(0, 4000)}` : ""}\n请根据意见重写本章。`,
    );
  }

  userParts.push(`请撰写本章正文，约 ${targetLength ?? 2500} 字。`);
  const user = userParts.join("\n\n");
  return { system, user };
}

// ---------- 前情摘要（整合既有，不覆盖） ----------
export function buildRecapMessages(args: {
  workTitle: string;
  chapterTitle: string;
  content: string;
  existingSummary?: string;
  systemOverride?: string;
}): ChatMessage[] {
  const existing = args.existingSummary?.trim();
  return [
    { role: "system", content: args.systemOverride ?? RECAP_SYSTEM },
    {
      role: "user",
      content: `请用第三人称将《${args.workTitle}》的「${args.chapterTitle}」压缩为 100~200 字的前情摘要，必须涵盖：关键事件、人物关系变化、新埋设的伏笔、本章结尾状态。直接输出摘要。
${existing ? `\n【已有摘要（必须整合保留，在其基础上补充本章变化，不得丢弃原有信息）】\n${existing}\n` : ""}
【正文】\n${args.content.slice(0, 6000)}`,
    },
  ];
}

// ---------- 风格提炼 ----------
export function styleObservationUser(materialChunk: string): string {
  return `【文本片段】\n${materialChunk.slice(0, 8000)}`;
}

export function buildStyleObservationMessages(materialChunk: string, systemOverride?: string): ChatMessage[] {
  return [
    { role: "system", content: systemOverride ?? STYLE_OBSERVATION_SYSTEM },
    { role: "user", content: styleObservationUser(materialChunk) },
  ];
}

export function styleMergeUser(observations: string[]): string {
  return `【风格观察列表】\n${observations.join("\n")}`;
}

export function buildStyleMergeMessages(observations: string[], systemOverride?: string): ChatMessage[] {
  return [
    { role: "system", content: systemOverride ?? STYLE_MERGE_SYSTEM },
    { role: "user", content: styleMergeUser(observations) },
  ];
}

export function styleSamplesUser(materialChunk: string): string {
  return `【文本片段】\n${materialChunk.slice(0, 8000)}`;
}

export function buildStyleSamplesMessages(materialChunk: string, systemOverride?: string): ChatMessage[] {
  return [
    { role: "system", content: systemOverride ?? STYLE_SAMPLES_SYSTEM },
    { role: "user", content: styleSamplesUser(materialChunk) },
  ];
}

// ---------- 大纲 ----------
export function buildOutlineProposeMessages(args: {
  project: ProjectDoc;
  entries: OutlineEntry[];
  targetIndex: number;
  recap: RecapEntry[];
  systemOverride?: string;
}): ChatMessage[] {
  const { project, entries, targetIndex, recap } = args;
  const prev = entries.slice(0, targetIndex);
  const prevText =
    prev
      .slice(-10)
      .map((e) => `${e.title}：${e.outline.slice(0, 120) || "（无细纲）"}${e.approved ? "（已完成）" : ""}`)
      .join("\n") || "（这是第一章）";
  const recapText = recap.slice(-8).map((r) => `- ${r.summary}`).join("\n");
  return [
    { role: "system", content: args.systemOverride ?? OUTLINE_PROPOSE_SYSTEM },
    {
      role: "user",
      content: `【作品】《${project.title}》（${project.genre || "未分类"}）\n【简介】${project.description || "无"}\n\n【已有章节细纲】\n${prevText}\n${recapText ? `\n【最近前情】\n${recapText}` : ""}\n\n请构思下一章「${entries[targetIndex]?.title || `第${targetIndex + 1}章`}」的细纲，150字以内，需包含：本章核心冲突、剧情推进点、与前后章的衔接、章末钩子。`,
    },
  ];
}

function outlineContext(args: {
  project: ProjectDoc;
  entries: OutlineEntry[];
  recap: RecapEntry[];
  storyArc: StoryArcDoc | null;
}): string {
  const { project, entries, recap, storyArc } = args;
  const outlineText =
    entries
      .map((e, i) => `${i + 1}. ${e.title}${e.approved ? "（已完稿）" : ""}\n   细纲：${e.outline.slice(0, 160) || "（空）"}`)
      .join("\n") || "（尚无章节）";
  const recapText = recap.slice(-10).map((r) => `- ${chNum(r.chId)}：${r.summary}`).join("\n");
  const arcText = storyArc
    ? `\n【全文脉络】\n- 主线：${storyArc.mainline || "未整理"}\n- 阶段与转折：${storyArc.stages || "未整理"}\n- 人物关系：${storyArc.relations || "未整理"}`
    : "";
  return `【作品】《${project.title}》（${project.genre || "未分类"}）\n【简介】${project.description || "无"}\n\n【现有章节大纲】\n${outlineText}\n${recapText ? `\n【最近前情】\n${recapText}` : ""}${arcText}`;
}

/** 大纲多轮讨论：system 携带全部上下文，历史原样作为 messages 传给模型 */
export function buildOutlineChatMessages(args: {
  project: ProjectDoc;
  entries: OutlineEntry[];
  recap: RecapEntry[];
  storyArc: StoryArcDoc | null;
  history: OutlineChatMessage[];
  userInput: string;
  systemOverride?: string;
}): ChatMessage[] {
  const ctx = outlineContext(args);
  const messages: ChatMessage[] = [
    { role: "system", content: args.systemOverride ?? `${OUTLINE_CHAT_SYSTEM}\n\n${ctx}` },
  ];
  args.history.forEach((m) => messages.push({ role: m.role, content: m.content }));
  messages.push({ role: "user", content: args.userInput });
  return messages;
}

/** 把讨论结论整理成结构化大纲（整合保留已有细纲） */
export function buildOutlineFinalizeMessages(args: {
  project: ProjectDoc;
  entries: OutlineEntry[];
  recap: RecapEntry[];
  storyArc: StoryArcDoc | null;
  discussion: string;
  systemOverride?: string;
}): ChatMessage[] {
  const ctx = outlineContext(args);
  return [
    { role: "system", content: args.systemOverride ?? OUTLINE_FINALIZE_SYSTEM },
    {
      role: "user",
      content: `${ctx}\n\n【讨论记录】\n${args.discussion.slice(-12000)}\n\n请把以上讨论整理成完整章节大纲。已有章节必须全部保留，按讨论更新其标题与细纲；新增章节追加在末尾。`,
    },
  ];
}

// ---------- 记忆辅助填写 ----------
export function buildCharacterAssistMessages(args: {
  project: ProjectDoc;
  name: string;
  relation: string;
  existing: CharacterEntry[];
  existingContent?: string;
  systemOverride?: string;
}): ChatMessage[] {
  const others = args.existing.slice(0, 8).map((c) => `${c.name}（${c.relation}）：${c.content.slice(0, 60)}`).join("\n");
  const existing = args.existingContent?.trim();
  return [
    { role: "system", content: args.systemOverride ?? CHARACTER_ASSIST_SYSTEM },
    {
      role: "user",
      content: `请为《${args.project.title}》（${args.project.description || "题材未定"}）完善配角「${args.name}」的记忆条目（150字内）：身份背景、与主角关系、性格、当前处境、隐藏信息/伏笔潜力。
已有其他配角（保持差异化）：\n${others || "（暂无）"}
与主角的关系定位：${args.relation || "未定"}
${existing ? `\n【该角色已有设定（必须完整整合保留，只做增补与修正）】\n${existing}` : ""}`,
    },
  ];
}

export function buildWorldviewAssistMessages(args: {
  project: ProjectDoc;
  category: string;
  name: string;
  existingContent?: string;
  categories?: string[];
  systemOverride?: string;
}): ChatMessage[] {
  const existing = args.existingContent?.trim();
  return [
    { role: "system", content: args.systemOverride ?? WORLDVIEW_ASSIST_SYSTEM },
    {
      role: "user",
      content: `请为《${args.project.title}》（${args.project.description || "题材未定"}）完善${args.category}「${args.name}」的设定条目（150字内），风格务实、可直接用于写作参考。
${args.categories?.length ? `本书可用的世界观类别：${args.categories.join("、")}\n` : ""}${existing ? `\n【该条目已有设定（必须完整整合保留，只做增补与修正）】\n${existing}` : ""}`,
    },
  ];
}

// ---------- 小说全量提取 ----------
export function buildWorldviewExtractMessages(args: {
  project: ProjectDoc;
  chunk: string;
  chunkIndex: number;
  totalChunks: number;
  categories: string[];
  systemOverride?: string;
}): ChatMessage[] {
  return [
    { role: "system", content: args.systemOverride ?? WORLDVIEW_EXTRACT_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》（${args.project.genre || "未分类"}）
【片段】第 ${args.chunkIndex} / ${args.totalChunks} 块
【允许的世界观类别】${args.categories.join("、")}

【正文片段】
${args.chunk.slice(0, 8000)}

请抽取本片段中的结构化设定档案，只输出 JSON。`,
    },
  ];
}

// ---------- 记忆更新：设定类（一次跑） ----------
export function buildSettingUpdateMessages(args: {
  project: ProjectDoc;
  chapterTitle: string;
  content: string;
  protagonist: ProtagonistDoc;
  characters: CharacterEntry[];
  worldview: WorldviewEntry[];
  categories: string[];
  systemOverride?: string;
}): ChatMessage[] {
  const p = args.protagonist;
  const protagonistLine = `姓名：${p.name || "（空）"}\n别名：${p.aliases || "（空）"}\n人设：${p.profile || "（空）"}\n成长线：${p.arc || "（空）"}\n备注：${p.notes || "（空）"}`;
  const charLines = args.characters.length
    ? args.characters.map((c) => `- ${c.name}（${c.relation || "关系未定"}）：${c.content}`).join("\n")
    : "（暂无）";
  const worldLines = args.worldview.length
    ? args.worldview.map((w) => `- [${w.category}] ${w.name}：${w.content}`).join("\n")
    : "（暂无）";
  return [
    { role: "system", content: args.systemOverride ?? SETTING_UPDATE_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》（${args.project.genre || "未分类"}）
【可用的世界观类别】${args.categories.join("、")}

【现有档案·主角】
${protagonistLine}

【现有档案·配角】
${charLines}

【现有档案·世界观】
${worldLines}

【本章正文】「${args.chapterTitle}」
${args.content.slice(0, 12000)}

请依据本章正文更新并整合以上档案，输出完整档案 JSON（现有条目一个都不能少）。`,
    },
  ];
}

// ---------- 记忆更新：前情 + 伏笔 ----------
export function buildRecapForeshadowUpdateMessages(args: {
  project: ProjectDoc;
  chapterTitle: string;
  content: string;
  existingSummary: string;
  foreshadows: ForeshadowEntry[];
  systemOverride?: string;
}): ChatMessage[] {
  const fsLines = args.foreshadows.length
    ? args.foreshadows
        .map((f) => `- ${f.title}｜埋于${f.plantedIn || "未标注"}｜计划${f.resolveIn || "未定"}回收｜状态：${f.status}｜${f.notes || ""}`)
        .join("\n")
    : "（暂无）";
  return [
    { role: "system", content: args.systemOverride ?? RECAP_FORESHADOW_UPDATE_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》
【本章】${args.chapterTitle}
【已有本章摘要】（可能为空）
${args.existingSummary || "（空）"}

【现有伏笔表】
${fsLines}

【本章正文】
${args.content.slice(0, 12000)}

请输出整合后的摘要与完整伏笔表 JSON。`,
    },
  ];
}

// ---------- 50 章记忆压缩 ----------
export function buildRecapCompressMessages(args: {
  fromCh: string;
  toCh: string;
  summaries: { chId: string; summary: string }[];
  systemOverride?: string;
}): ChatMessage[] {
  const body = args.summaries.map((s) => `- ${chNum(s.chId)}：${s.summary}`).join("\n");
  return [
    { role: "system", content: args.systemOverride ?? RECAP_COMPRESS_SYSTEM },
    {
      role: "user",
      content: `【覆盖范围】${chNum(args.fromCh)} ~ ${chNum(args.toCh)}（共 ${args.summaries.length} 章）
【逐章摘要】
${body}

请压缩为一段阶段摘要。`,
    },
  ];
}

// ---------- 全文脉络 ----------
export function buildStoryArcMessages(args: {
  project: ProjectDoc;
  segments: RecapSegment[];
  existing: StoryArcDoc;
  systemOverride?: string;
}): ChatMessage[] {
  const e = args.existing;
  const existingText = e.mainline || e.stages || e.relations
    ? `主线：${e.mainline || "（空）"}\n阶段与转折：${e.stages || "（空）"}\n人物关系：${e.relations || "（空）"}`
    : "（尚无脉络记录）";
  const segText = args.segments.length
    ? args.segments.map((s) => `- ${chNum(s.fromCh)}~${chNum(s.toCh)}：${s.summary}`).join("\n")
    : "（暂无阶段摘要）";
  return [
    { role: "system", content: args.systemOverride ?? STORY_ARC_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》（${args.project.genre || "未分类"}）
【简介】${args.project.description || "无"}

【现有全文脉络（必须整合保留）】
${existingText}

【阶段摘要】
${segText}

请输出更新后的全文脉络 JSON。`,
    },
  ];
}

// ---------- 后文预测（只预测下一章） ----------
export function buildPredictionMessages(args: {
  project: ProjectDoc;
  nextTitle: string;
  nextOutline: string;
  recentRecap: RecapEntry[];
  storyArc: StoryArcDoc | null;
  presets: FuturePreset[];
  previousPrediction?: string;
  systemOverride?: string;
}): ChatMessage[] {
  const recapText = args.recentRecap.slice(-10).map((r) => `- ${chNum(r.chId)}：${r.summary}`).join("\n");
  const presetText = args.presets.length
    ? args.presets.map((p) => `- ${p.title}（预计${p.targetChapter || "后续"}）：${p.content}`).join("\n")
    : "（暂无）";
  const arcText = args.storyArc?.mainline ? `- 主线：${args.storyArc.mainline}\n- 阶段：${args.storyArc.stages || "未整理"}` : "（暂无）";
  return [
    { role: "system", content: args.systemOverride ?? PREDICTION_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》（${args.project.genre || "未分类"}）
【简介】${args.project.description || "无"}

【前情记忆】
${recapText || "（尚未写正文）"}

【全文脉络】
${arcText}

【作者的后文规划】
${presetText}

【下一章大纲】${args.nextTitle}
${args.nextOutline || "（无细纲）"}
${args.previousPrediction?.trim() ? `\n【上一版预测（请整合其中尚未兑现的内容）】\n${args.previousPrediction.trim()}` : ""}

请推测下一章的走向。`,
    },
  ];
}
