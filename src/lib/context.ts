import type {
  ChatMessage,
  CharacterEntry,
  ForeshadowEntry,
  FuturePreset,
  OutlineEntry,
  ProjectDoc,
  ProtagonistDoc,
  RecapEntry,
  RuleEntry,
  StyleDoc,
  WorldviewEntry,
} from "./types";

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

export interface MemoryBundle {
  protagonist: ProtagonistDoc;
  characters: CharacterEntry[];
  worldview: WorldviewEntry[];
  rules: RuleEntry[];
  presets: FuturePreset[];
  recap: RecapEntry[];
  foreshadows: ForeshadowEntry[];
  /** 上一章结尾；draft=true 表示上一章尚未定稿，仅作衔接参考 */
  lastChapter: { title: string; tail: string; draft?: boolean } | null;
  /** 当前是否全书第一章 */
  isFirst: boolean;
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

  const recapText = memory.recap
    .slice(-15)
    .map((r) => `- ${r.chId.replace("ch-", "第") + "章"}：${r.summary}`)
    .join("\n");
  userParts.push(`【前情记忆】\n${recapText || "（这是开篇，无前情）"}`);

  if (memory.lastChapter) {
    const note = memory.lastChapter.draft
      ? "（上一章尚未定稿，以下为其草稿结尾，仅供衔接参考，不必严格承接其中的细节）"
      : "（请自然衔接，不要重复）";
    userParts.push(`【上一章《${memory.lastChapter.title}》结尾原文】${note}\n${memory.lastChapter.tail}`);
  } else if (memory.isFirst) {
    userParts.push("【上一章】（本章为全书第一章）");
  } else {
    userParts.push("【上一章】尚无成文内容，请依据前情记忆、后文预设与本章细纲自然开篇，不要等待上一章定稿，也不要重复开篇。");
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
  userParts.push(`【后文预设（本章可能需要铺垫的后续剧情）】\n${relevantPresets.length ? relevantPresets.join("\n") : "（暂无）"}`);

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

// ---------- 前情摘要 ----------
export function buildRecapMessages(args: { workTitle: string; chapterTitle: string; content: string }): ChatMessage[] {
  return [
    { role: "system", content: "你是小说编辑助手。只输出摘要内容本身，不要任何前缀或解释。" },
    {
      role: "user",
      content: `请用第三人称将《${args.workTitle}》的「${args.chapterTitle}」压缩为 100 字左右的前情摘要（80~120字），必须涵盖：关键事件、人物关系变化、新埋设的伏笔、本章结尾状态。直接输出摘要。\n\n【正文】\n${args.content.slice(0, 6000)}`,
    },
  ];
}

// ---------- 风格提炼（提示词常量导出，供 UI 预览/编辑） ----------
export const STYLE_OBSERVATION_SYSTEM =
  "你是文体分析专家。从给定小说文本片段中提炼写作风格观察，输出中文，逐条罗列，每条一行，聚焦：叙事视角、句式节奏（含平均句长）、对话风格（对话占比、对话标签用法）、描写配比（对话/动作/心理/环境大致比例）、修辞习惯、高频词汇与口头禅、明显避免的写法。只输出观察条目，不要客套话。";

export const STYLE_GROUP_MERGE_SYSTEM =
  "你是文体分析专家。给定一组风格观察条目，请把它们压缩合并成一份更精炼的观察列表：去掉重复项，保留出现频率高、代表性强的特征，输出中文，逐条罗列，每条一行，总条数不超过原条数的一半且不超过 8 条。只输出观察条目，不要客套话。";

export const STYLE_MERGE_SYSTEM =
  '你是文体分析专家。请把多条风格观察合并为一份统一的风格画像，严格输出 JSON（不要 markdown 代码块包裹），字段如下：\n{"pov":"叙事视角","tone":"文风基调","sentenceRhythm":"句式节奏","dialogueStyle":"对话风格","descriptionRatio":"描写配比","rhetoric":"修辞习惯","vocabularyFavor":"高频词与口头禅","vocabularyAvoid":"避免的用词","pacing":"节奏把控","hooks":"章末钩子习惯","taboos":"写作禁忌"}';

export const STYLE_SAMPLES_SYSTEM =
  "你是小说编辑。从给定文本中分别摘录三类最具代表性的原文片段（必须是原文，不要改写）：1) 最能代表语言风格的连贯段落（约200字）；2) 最精彩的动作描写（约150字）；3) 最经典的场面描写（约250字）。输出 JSON：{\"language\":\"...\",\"action\":\"...\",\"scene\":\"...\"}，不要代码块包裹。";

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

export function buildStyleGroupMergeMessages(observations: string[], systemOverride?: string): ChatMessage[] {
  return [
    { role: "system", content: systemOverride ?? STYLE_GROUP_MERGE_SYSTEM },
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

// ---------- AI 讨论室 ----------
/** 截取最近 rounds 轮（一轮 = 作者一条 + 顾问一条）对话 */
export function lastRounds(messages: ChatMessage[], rounds: number): ChatMessage[] {
  let users = 0;
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      users++;
      if (users > rounds) {
        start = i + 1;
        break;
      }
    }
  }
  return messages.slice(start);
}

export function buildDiscussMessages(args: {
  project: ProjectDoc;
  history: ChatMessage[];
  userText: string;
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是资深小说创作顾问，正在与作者讨论《${args.project.title}》（${args.project.genre || "未分类"}）：${args.project.description || "无简介"}。围绕剧情、大纲、世界观、人物设定展开讨论，给出具体、可执行的建议；观点冲突时给出取舍理由。不要输出 JSON。`,
    },
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: args.userText },
  ];
}

function discussBlock(history: ChatMessage[], rounds = 20): string {
  const msgs = lastRounds(history, rounds);
  if (!msgs.length) return "（尚无讨论记录，请仅依据原记忆与作品信息整合）";
  return msgs
    .map((m) => `${m.role === "user" ? "作者" : "顾问"}：${m.content}`)
    .join("\n");
}

const MERGE_SYSTEM = "你是小说设定整理助手。只输出一个合法的 JSON，不要输出解释、注释或 Markdown 代码块标记。";
const KEEP_RULE = "【铁律】原记忆必须完整保留：讨论中未涉及的内容一律原样保留，不得丢失、删减或简化；只整合讨论中明确涉及的变更。";

export function buildProtagonistMergeMessages(args: {
  project: ProjectDoc;
  current: ProtagonistDoc;
  history: ChatMessage[];
}): ChatMessage[] {
  const c = args.current;
  return [
    { role: "system", content: MERGE_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》（${args.project.genre || "未分类"}）${args.project.description || ""}

【当前主角记忆（原记忆）】
姓名：${c.name || "（空）"}
别名：${c.aliases || "（空）"}
人设：${c.profile || "（空）"}
成长线：${c.arc || "（空）"}
备注：${c.notes || "（空）"}

【近期讨论记录】
${discussBlock(args.history)}

${KEEP_RULE}

【任务】整合讨论结论与原记忆，输出更新后的完整主角记忆 JSON 对象：
{"name":"姓名","aliases":"别名/称呼","profile":"人设：外貌、性格、能力、来历","arc":"成长线","notes":"备注"}`,
    },
  ];
}

export function buildCharactersMergeMessages(args: {
  project: ProjectDoc;
  current: CharacterEntry[];
  history: ChatMessage[];
}): ChatMessage[] {
  const cur = args.current.length
    ? args.current.map((c) => `- ${c.name || "（未命名）"}（${c.relation || "关系未定"}）：${c.content}`).join("\n")
    : "（暂无配角记忆）";
  return [
    { role: "system", content: MERGE_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》（${args.project.genre || "未分类"}）${args.project.description || ""}

【当前配角记忆（原记忆）】
${cur}

【近期讨论记录】
${discussBlock(args.history)}

${KEEP_RULE}

【任务】整合讨论结论与原记忆，输出更新后的完整配角列表 JSON 数组（包含所有原配角和讨论新增的配角）：
[{"name":"姓名","relation":"与主角关系","content":"设定内容：背景、性格、当前处境、伏笔潜力"}]`,
    },
  ];
}

export function buildWorldviewMergeMessages(args: {
  project: ProjectDoc;
  current: WorldviewEntry[];
  history: ChatMessage[];
}): ChatMessage[] {
  const cur = args.current.length
    ? args.current.map((w) => `- [${w.category}] ${w.name}：${w.content}`).join("\n")
    : "（暂无世界观条目）";
  return [
    { role: "system", content: MERGE_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》（${args.project.genre || "未分类"}）${args.project.description || ""}

【当前世界观记忆（原记忆）】
${cur}

【近期讨论记录】
${discussBlock(args.history)}

${KEEP_RULE}

【任务】整合讨论结论与原记忆，输出更新后的完整世界观条目 JSON 数组（包含所有原条目和讨论新增的条目）：
[{"category":"地点|势力|规则|物品|体系|其他","name":"名称","content":"设定内容"}]`,
    },
  ];
}

export function buildOutlineMergeMessages(args: {
  project: ProjectDoc;
  entries: OutlineEntry[];
  history: ChatMessage[];
}): ChatMessage[] {
  const cur = args.entries.length
    ? args.entries.map((e) => `- [${e.chId}] ${e.title}：${e.outline || "（无细纲）"}`).join("\n")
    : "（暂无章节）";
  return [
    { role: "system", content: MERGE_SYSTEM },
    {
      role: "user",
      content: `【作品】《${args.project.title}》（${args.project.genre || "未分类"}）${args.project.description || ""}

【当前章节大纲（原大纲）】
${cur}

【近期讨论记录】
${discussBlock(args.history)}

${KEEP_RULE}

【任务】整合讨论结论与现有大纲，输出完整大纲 JSON 数组：已有章节沿用原 chId（可更新其标题/细纲），讨论中新增的章节 chId 填 null：
[{"chId":"ch-0001 或 null","title":"章节标题","outline":"本章细纲：核心冲突、推进点、章末钩子"}]`,
    },
  ];
}

/** 从模型输出中提取 JSON（容忍代码块标记与前后杂质） */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```[a-zA-Z]*\s*/g, "").trim();
  const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) throw new Error("输出中未找到 JSON");
  const start = Math.min(...starts);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (end <= start) throw new Error("输出中未找到完整的 JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ---------- 大纲续推 ----------
export function buildOutlineProposeMessages(args: {
  project: ProjectDoc;
  entries: OutlineEntry[];
  targetIndex: number;
  recap: RecapEntry[];
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
    { role: "system", content: "你是资深小说大纲策划。只输出细纲内容本身，不要标题、序号或解释。" },
    {
      role: "user",
      content: `【作品】《${project.title}》（${project.genre || "未分类"}）\n【简介】${project.description || "无"}\n\n【已有章节细纲】\n${prevText}\n${recapText ? `\n【最近前情】\n${recapText}` : ""}\n\n请构思下一章「${entries[targetIndex]?.title || `第${targetIndex + 1}章`}」的细纲，150字以内，需包含：本章核心冲突、剧情推进点、与前后章的衔接、章末钩子。`,
    },
  ];
}

// ---------- 记忆辅助填写 ----------
export function buildCharacterAssistMessages(args: {
  project: ProjectDoc;
  name: string;
  relation: string;
  existing: CharacterEntry[];
}): ChatMessage[] {
  const others = args.existing.slice(0, 8).map((c) => `${c.name}（${c.relation}）：${c.content.slice(0, 60)}`).join("\n");
  return [
    { role: "system", content: "你是小说设定师。只输出角色设定内容本身，不要前缀解释。" },
    {
      role: "user",
      content: `请为《${args.project.title}》（${args.project.description || "题材未定"}）设计配角「${args.name}」的完整记忆条目（150字内）：身份背景、与主角关系、性格、当前处境、隐藏信息/伏笔潜力。已有其他配角（保持差异化）：\n${others || "（暂无）"}\n与主角的关系定位：${args.relation || "未定"}`,
    },
  ];
}

export function buildWorldviewAssistMessages(args: {
  project: ProjectDoc;
  category: string;
  name: string;
}): ChatMessage[] {
  return [
    { role: "system", content: "你是小说设定师。只输出设定内容本身，不要前缀解释。" },
    {
      role: "user",
      content: `请为《${args.project.title}》（${args.project.description || "题材未定"}）设计${args.category}「${args.name}」的设定条目（150字内），风格务实、可直接用于写作参考。`,
    },
  ];
}
