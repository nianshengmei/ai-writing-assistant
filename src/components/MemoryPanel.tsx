"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getProtagonist,
  saveProtagonist,
  listCharacters,
  saveCharacters,
  listWorldview,
  saveWorldview,
  listWorldviewCategories,
  saveWorldviewCategories,
  listRules,
  saveRules,
  listFuturePresets,
  saveFuturePresets,
  listRecap,
  saveRecapEntry,
  deleteRecapEntry,
  listForeshadows,
  saveForeshadows,
  getFuturePrediction,
  saveFuturePrediction,
  clearFuturePrediction,
  getOutline,
  readChapterContent,
  uid,
} from "@/lib/library";
import { useFeatureModel } from "@/lib/useProviderSelection";
import { chatOnce } from "@/lib/llm";
import {
  buildCharacterAssistMessages,
  buildWorldviewAssistMessages,
  buildWorldviewExtractMessages,
  buildRecapMessages,
} from "@/lib/context";
import {
  appendExtra,
  CHARACTER_ASSIST_SYSTEM,
  DEFAULT_WORLDVIEW_CATEGORIES,
  RECAP_SYSTEM,
  WORLDVIEW_ASSIST_SYSTEM,
  WORLDVIEW_EXTRACT_SYSTEM,
} from "@/lib/prompts";
import { parseJsonLoose } from "@/lib/json";
import ModelPicker from "./ModelPicker";
import PromptConfirmModal, { type PromptConfirmPayload } from "./PromptConfirmModal";
import type {
  ProjectDoc,
  ProtagonistDoc,
  CharacterEntry,
  WorldviewEntry,
  RuleEntry,
  FuturePreset,
  RecapEntry,
  ForeshadowEntry,
  OutlineEntry,
  FuturePrediction,
} from "@/lib/types";

type Tab = "protagonist" | "characters" | "worldview" | "rules" | "presets" | "prediction" | "foreshadows" | "recap";

const TABS: { key: Tab; label: string }[] = [
  { key: "protagonist", label: "主角记忆" },
  { key: "characters", label: "配角记忆" },
  { key: "worldview", label: "世界观" },
  { key: "rules", label: "作者要求" },
  { key: "presets", label: "后文预设" },
  { key: "prediction", label: "后文预测" },
  { key: "foreshadows", label: "伏笔表" },
  { key: "recap", label: "前情记忆" },
];

const CHUNK_SIZE = 8000;
const MAX_CHUNKS = 16;

interface ExtractRaw {
  protagonist?: Partial<ProtagonistDoc>;
  characters?: { name?: string; relation?: string; content?: string }[];
  worldview?: { category?: string; name?: string; content?: string }[];
  rules?: string[];
  foreshadows?: { title?: string; plantedIn?: string; resolveIn?: string; notes?: string }[];
  presets?: { title?: string; targetChapter?: string; content?: string }[];
}

export default function MemoryPanel({ project, onChanged }: { project: ProjectDoc; onChanged: () => void }) {
  const workId = project.id;
  const [tab, setTab] = useState<Tab>("protagonist");
  const [protagonist, setProtagonist] = useState<ProtagonistDoc | null>(null);
  const [characters, setCharacters] = useState<CharacterEntry[]>([]);
  const [worldview, setWorldview] = useState<WorldviewEntry[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_WORLDVIEW_CATEGORIES);
  const [newCategory, setNewCategory] = useState("");
  const [rules, setRules] = useState<RuleEntry[]>([]);
  const [presets, setPresets] = useState<FuturePreset[]>([]);
  const [recap, setRecap] = useState<RecapEntry[]>([]);
  const [foreshadows, setForeshadows] = useState<ForeshadowEntry[]>([]);
  const [prediction, setPrediction] = useState<FuturePrediction | null>(null);
  const [predictionDraft, setPredictionDraft] = useState("");
  const [chapters, setChapters] = useState<OutlineEntry[]>([]);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [tick, setTick] = useState(0);

  const [importMaterial, setImportMaterial] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState("");
  const [extracted, setExtracted] = useState<ExtractRaw | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [promptModal, setPromptModal] = useState<{
    featureKey: string;
    title: string;
    system: string;
    user: string;
    defaultSystem: string;
    meta?: string;
    confirmLabel: string;
    onConfirm: (p: PromptConfirmPayload) => Promise<void> | void;
  } | null>(null);

  const charModel = useFeatureModel("memory-character");
  const worldModel = useFeatureModel("memory-worldview");
  const extractModel = useFeatureModel("worldview-extract");
  const recapModel = useFeatureModel("recap");

  useEffect(() => {
    Promise.all([
      getProtagonist(workId),
      listCharacters(workId),
      listWorldview(workId),
      listWorldviewCategories(workId),
      listRules(workId),
      listFuturePresets(workId),
      listRecap(workId),
      listForeshadows(workId),
      getFuturePrediction(workId),
      getOutline(workId),
    ]).then(([p, c, w, cats, r, fp, rc, fo, pred, o]) => {
      setProtagonist(p);
      setCharacters(c);
      setWorldview(w);
      setCategories(cats);
      setRules(r);
      setPresets(fp);
      setRecap(rc);
      setForeshadows(fo);
      setPrediction(pred);
      setPredictionDraft(pred?.content ?? "");
      setChapters(o.chapters);
    });
  }, [workId, tick]);

  const reload = () => setTick((t) => t + 1);

  const chunkCount = useMemo(() => Math.min(Math.ceil(importMaterial.length / CHUNK_SIZE), MAX_CHUNKS), [importMaterial.length]);

  function ensureProvider(p: { apiKey?: string } | null) {
    if (!p || !p.apiKey) {
      setStatus({ text: "失败：请先在右上角 ⚙ 设置 → 模型 中添加模型，并在本页选择", ok: false });
      return false;
    }
    return true;
  }

  // ---------- AI 填写：配角 ----------
  function aiFillCharacter(c: CharacterEntry) {
    if (!ensureProvider(charModel.picked)) return;
    const msgs = buildCharacterAssistMessages({
      project,
      name: c.name,
      relation: c.relation,
      existing: characters,
      existingContent: c.content,
    });
    setPromptModal({
      featureKey: "memory-character",
      title: `AI 填写配角 · ${c.name || "新配角"}`,
      system: msgs[0].content,
      user: msgs[msgs.length - 1].content,
      defaultSystem: CHARACTER_ASSIST_SYSTEM,
      meta: c.content.trim() ? "该配角已有内容：结果会追加为「AI 补充」，不会覆盖原文" : "该配角还没有内容",
      confirmLabel: "生成设定",
      onConfirm: async (p) => {
        setPromptModal(null);
        const provider = charModel.picked;
        if (!provider) return;
        setStatus({ text: `正在为「${c.name || "新配角"}」生成设定…`, ok: true });
        try {
          const text = (await chatOnce(provider, [
            { role: "system", content: p.system },
            { role: "user", content: appendExtra(p.user, p.extra) },
          ])).trim();
          const merged = c.content.trim() ? `${c.content.trim()}\n\n【AI 补充】\n${text}` : text;
          const next = characters.map((x) => (x.id === c.id ? { ...x, content: merged } : x));
          setCharacters(next);
          await saveCharacters(workId, next);
          setStatus({ text: "已生成并整合到该配角（原文保留）", ok: true });
          onChanged();
        } catch (e) {
          setStatus({ text: `生成失败：${(e as Error)?.message ?? e}`, ok: false });
        }
      },
    });
  }

  // ---------- AI 填写：世界观 ----------
  function aiFillWorldview(w: WorldviewEntry) {
    if (!ensureProvider(worldModel.picked)) return;
    const msgs = buildWorldviewAssistMessages({
      project,
      category: w.category,
      name: w.name,
      existingContent: w.content,
      categories,
    });
    setPromptModal({
      featureKey: "memory-worldview",
      title: `AI 填写世界观 · ${w.name || w.category}`,
      system: msgs[0].content,
      user: msgs[msgs.length - 1].content,
      defaultSystem: WORLDVIEW_ASSIST_SYSTEM,
      meta: w.content.trim() ? "该条目已有内容：结果会追加为「AI 补充」，不会覆盖原文" : "该条目还没有内容",
      confirmLabel: "生成设定",
      onConfirm: async (p) => {
        setPromptModal(null);
        const provider = worldModel.picked;
        if (!provider) return;
        try {
          const text = (await chatOnce(provider, [
            { role: "system", content: p.system },
            { role: "user", content: appendExtra(p.user, p.extra) },
          ])).trim();
          const merged = w.content.trim() ? `${w.content.trim()}\n\n【AI 补充】\n${text}` : text;
          const next = worldview.map((x) => (x.id === w.id ? { ...x, content: merged } : x));
          setWorldview(next);
          await saveWorldview(workId, next);
          setStatus({ text: "已生成并整合到该条目（原文保留）", ok: true });
          onChanged();
        } catch (e) {
          setStatus({ text: `生成失败：${(e as Error)?.message ?? e}`, ok: false });
        }
      },
    });
  }

  // ---------- 小说全量提取 ----------
  async function importFile(file: File) {
    if (!/\.(txt|md)$/i.test(file.name)) {
      setStatus({ text: "仅支持 .txt / .md 文本文件", ok: false });
      return;
    }
    const text = await file.text();
    setImportMaterial(text);
    setExtracted(null);
    setStatus({ text: `已导入《${file.name}》，共 ${text.length} 字`, ok: true });
  }

  function startExtract() {
    if (!importMaterial.trim()) {
      setStatus({ text: "请先导入或粘贴小说正文", ok: false });
      return;
    }
    if (!ensureProvider(extractModel.picked)) return;
    const total = chunkCount;
    setPromptModal({
      featureKey: "worldview-extract",
      title: "从小说中提取全部标签记忆",
      system: WORLDVIEW_EXTRACT_SYSTEM,
      user: `【作品】《${project.title}》\n【待提取】${importMaterial.length} 字，将分 ${total} 块处理\n【可用世界观类别】${categories.join("、")}\n\n（每块会自动附带对应正文片段）`,
      defaultSystem: WORLDVIEW_EXTRACT_SYSTEM,
      meta: `将产生 ${total} 次调用；提取主角、配角、世界观（含自定义类别）、作者要求、伏笔、后文预设；结果先预览，确认后才写入`,
      confirmLabel: "开始提取",
      onConfirm: async (p) => {
        setPromptModal(null);
        await runExtract(p.system, p.extra);
      },
    });
  }

  async function runExtract(systemOverride: string, extra?: string) {
    const provider = extractModel.picked;
    if (!provider) return;
    const chunks: string[] = [];
    for (let i = 0; i < importMaterial.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
      chunks.push(importMaterial.slice(i, i + CHUNK_SIZE));
    }
    setExtracting(true);
    setExtracted(null);
    setStatus({ text: "开始提取…", ok: true });
    const merged: ExtractRaw = { characters: [], worldview: [], rules: [], foreshadows: [], presets: [] };
    try {
      for (let i = 0; i < chunks.length; i++) {
        setExtractProgress(`提取第 ${i + 1}/${chunks.length} 块…`);
        const msgs = buildWorldviewExtractMessages({
          project,
          chunk: chunks[i],
          chunkIndex: i + 1,
          totalChunks: chunks.length,
          categories,
          systemOverride,
        });
        const out = await chatOnce(provider, [
          { role: "system", content: msgs[0].content },
          { role: "user", content: appendExtra(msgs[1].content, extra) },
        ]);
        const parsed = parseJsonLoose<ExtractRaw>(out);
        if (!parsed) continue;
        if (parsed.protagonist) {
          merged.protagonist = {
            name: merged.protagonist?.name || parsed.protagonist.name || "",
            aliases: merged.protagonist?.aliases || parsed.protagonist.aliases || "",
            profile: [merged.protagonist?.profile, parsed.protagonist.profile].filter(Boolean).join("\n").trim(),
            arc: [merged.protagonist?.arc, parsed.protagonist.arc].filter(Boolean).join("\n").trim(),
            notes: [merged.protagonist?.notes, parsed.protagonist.notes].filter(Boolean).join("\n").trim(),
          };
        }
        (parsed.characters ?? []).forEach((c) => {
          if (!c.name?.trim()) return;
          const exist = merged.characters!.find((x) => x.name === c.name);
          if (exist) exist.content = [exist.content, c.content].filter(Boolean).join("\n");
          else merged.characters!.push(c);
        });
        (parsed.worldview ?? []).forEach((w) => {
          if (!w.name?.trim()) return;
          const exist = merged.worldview!.find((x) => x.name === w.name && x.category === w.category);
          if (exist) exist.content = [exist.content, w.content].filter(Boolean).join("\n");
          else merged.worldview!.push({ ...w, category: categories.includes(w.category ?? "") ? w.category : "其他" });
        });
        (parsed.rules ?? []).forEach((r) => {
          if (r?.trim() && !merged.rules!.includes(r.trim())) merged.rules!.push(r.trim());
        });
        (parsed.foreshadows ?? []).forEach((f) => {
          if (!f.title?.trim()) return;
          if (!merged.foreshadows!.some((x) => x.title === f.title)) merged.foreshadows!.push(f);
        });
        (parsed.presets ?? []).forEach((p2) => {
          if (!p2.title?.trim()) return;
          if (!merged.presets!.some((x) => x.title === p2.title)) merged.presets!.push(p2);
        });
      }
      setExtracted(merged);
      setStatus({
        text: `提取完成：主角 ${merged.protagonist ? 1 : 0} 项、配角 ${merged.characters?.length ?? 0} 条、世界观 ${merged.worldview?.length ?? 0} 条、要求 ${merged.rules?.length ?? 0} 条、伏笔 ${merged.foreshadows?.length ?? 0} 条、预设 ${merged.presets?.length ?? 0} 条。请核对后应用。`,
        ok: true,
      });
    } catch (e) {
      setStatus({ text: `提取失败：${(e as Error)?.message ?? e}`, ok: false });
    } finally {
      setExtracting(false);
      setExtractProgress("");
    }
  }

  async function applyExtract() {
    if (!extracted || !protagonist) return;
    let addedC = 0;
    let addedW = 0;
    let addedF = 0;
    let addedP = 0;
    let addedR = 0;

    const nextProtagonist: ProtagonistDoc = {
      name: protagonist.name || extracted.protagonist?.name || "",
      aliases: protagonist.aliases || extracted.protagonist?.aliases || "",
      profile: [protagonist.profile, extracted.protagonist?.profile].filter(Boolean).join("\n").trim(),
      arc: [protagonist.arc, extracted.protagonist?.arc].filter(Boolean).join("\n").trim(),
      notes: [protagonist.notes, extracted.protagonist?.notes].filter(Boolean).join("\n").trim(),
    };

    const nextChars = [...characters];
    (extracted.characters ?? []).forEach((c) => {
      const name = (c.name ?? "").trim();
      if (!name) return;
      const old = nextChars.find((x) => x.name === name);
      if (old) {
        if (c.content && !old.content.includes(c.content.trim())) old.content = `${old.content}\n\n【导入补充】\n${c.content}`;
      } else {
        nextChars.push({ id: uid(), name, relation: c.relation ?? "", content: c.content ?? "" });
        addedC++;
      }
    });

    const nextWorld = [...worldview];
    (extracted.worldview ?? []).forEach((w) => {
      const name = (w.name ?? "").trim();
      if (!name) return;
      const category = (w.category ?? "").trim() || "其他";
      const old = nextWorld.find((x) => x.name === name && x.category === category);
      if (old) {
        if (w.content && !old.content.includes(w.content.trim())) old.content = `${old.content}\n\n【导入补充】\n${w.content}`;
      } else {
        nextWorld.push({ id: uid(), category, name, content: w.content ?? "" });
        addedW++;
      }
    });

    const nextRules = [...rules];
    (extracted.rules ?? []).forEach((t) => {
      if (t.trim() && !nextRules.some((x) => x.text === t.trim())) {
        nextRules.push({ id: uid(), text: t.trim() });
        addedR++;
      }
    });

    const nextForeshadows = [...foreshadows];
    (extracted.foreshadows ?? []).forEach((f) => {
      const title = (f.title ?? "").trim();
      if (title && !nextForeshadows.some((x) => x.title === title)) {
        nextForeshadows.push({
          id: uid(),
          title,
          plantedIn: f.plantedIn ?? "",
          resolveIn: f.resolveIn ?? "",
          status: "open",
          notes: f.notes ?? "",
        });
        addedF++;
      }
    });

    const nextPresets = [...presets];
    (extracted.presets ?? []).forEach((p2) => {
      const title = (p2.title ?? "").trim();
      if (title && !nextPresets.some((x) => x.title === title)) {
        nextPresets.push({ id: uid(), title, targetChapter: p2.targetChapter ?? "", content: p2.content ?? "" });
        addedP++;
      }
    });

    await saveProtagonist(workId, nextProtagonist);
    await saveCharacters(workId, nextChars);
    await saveWorldview(workId, nextWorld);
    await saveRules(workId, nextRules);
    await saveForeshadows(workId, nextForeshadows);
    await saveFuturePresets(workId, nextPresets);

    setProtagonist(nextProtagonist);
    setCharacters(nextChars);
    setWorldview(nextWorld);
    setRules(nextRules);
    setForeshadows(nextForeshadows);
    setPresets(nextPresets);
    setExtracted(null);
    setImportMaterial("");
    setStatus({
      text: `已应用：新增配角 ${addedC}、世界观 ${addedW}、要求 ${addedR}、伏笔 ${addedF}、预设 ${addedP}；已有条目内容以追加方式合并，未覆盖。`,
      ok: true,
    });
    onChanged();
  }

  // ---------- 类别管理 ----------
  async function addCategory() {
    const c = newCategory.trim();
    if (!c) return;
    if (categories.includes(c)) {
      setStatus({ text: "该类别已存在", ok: false });
      return;
    }
    const next = [...categories, c];
    setCategories(next);
    setNewCategory("");
    await saveWorldviewCategories(workId, next);
  }

  async function removeCategory(cat: string) {
    if (categories.length <= 1) return;
    if (!confirm(`删除类别「${cat}」？该类别下的条目会移到「其他」。`)) return;
    const nextCats = categories.filter((c) => c !== cat);
    const fallback = nextCats.includes("其他") ? "其他" : nextCats[0];
    const nextWorld = worldview.map((w) => (w.category === cat ? { ...w, category: fallback } : w));
    setCategories(nextCats);
    setWorldview(nextWorld);
    await saveWorldviewCategories(workId, nextCats);
    await saveWorldview(workId, nextWorld);
    onChanged();
  }

  // ---------- 前情摘要：手动生成 ----------
  const chaptersWithContent = chapters.filter((c) => c.approved);

  function generateRecap(ch: OutlineEntry) {
    if (!ensureProvider(recapModel.picked)) return;
    readChapterContent(workId, ch.chId).then((content) => {
      if (!content) {
        setStatus({ text: "该章还没有正式正文", ok: false });
        return;
      }
      const existing = recap.find((r) => r.chId === ch.chId)?.summary ?? "";
      const msgs = buildRecapMessages({
        workTitle: project.title,
        chapterTitle: ch.title,
        content: content.content,
        existingSummary: existing,
      });
      setPromptModal({
        featureKey: "recap",
        title: `生成前情摘要 · ${ch.title}`,
        system: msgs[0].content,
        user: msgs[msgs.length - 1].content,
        defaultSystem: RECAP_SYSTEM,
        meta: existing ? "已有摘要会被整合保留，只补充本章变化" : "该章尚无摘要",
        confirmLabel: "生成摘要",
        onConfirm: async (p) => {
          setPromptModal(null);
          const provider = recapModel.picked;
          if (!provider) return;
          try {
            const text = (await chatOnce(provider, [
              { role: "system", content: p.system },
              { role: "user", content: appendExtra(p.user, p.extra) },
            ])).trim();
            await saveRecapEntry(workId, { chId: ch.chId, summary: text, createdAt: Date.now() });
            setStatus({ text: `「${ch.title}」的前情摘要已生成`, ok: true });
            reload();
            onChanged();
          } catch (e) {
            setStatus({ text: `生成失败：${(e as Error)?.message ?? e}`, ok: false });
          }
        },
      });
    });
  }

  // ---------- 后文预测：保存 ----------
  async function savePredictionEdit() {
    if (!prediction) {
      setStatus({ text: "还没有预测记录", ok: false });
      return;
    }
    const text = predictionDraft.trim();
    const changed = text !== prediction.aiContent.trim();
    await saveFuturePrediction(workId, {
      ...prediction,
      content: text,
      editedAt: changed ? Date.now() : prediction.editedAt,
      reviewedAt: Date.now(),
    });
    setPrediction({ ...prediction, content: text, editedAt: changed ? Date.now() : prediction.editedAt, reviewedAt: Date.now() });
    setStatus({ text: changed ? "已保存（标记为已由作者调整）" : "已保存（内容与 AI 原版一致）", ok: true });
    onChanged();
  }

  async function removePrediction() {
    if (!confirm("删除后文预测？下一章生成前将不再提示过目。")) return;
    await clearFuturePrediction(workId);
    setPrediction(null);
    setPredictionDraft("");
    setStatus({ text: "后文预测已删除", ok: true });
    onChanged();
  }

  const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm";
  const btn = "rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs hover:bg-stone-50";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === t.key ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {status && (
        <p
          className={`mb-3 max-w-3xl whitespace-pre-wrap break-all text-xs ${
            status.ok ? "text-stone-500" : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700"
          }`}
        >
          {status.text}
        </p>
      )}

      {tab === "protagonist" && protagonist && (
        <div className="max-w-2xl space-y-3">
          <p className="text-xs text-stone-400">手动填写随时可改；AI 生成的补充会以「AI 补充」段落追加，不会覆盖你写的内容。</p>
          <div className="grid grid-cols-2 gap-3">
            <input className={input} placeholder="姓名" value={protagonist.name} onChange={(e) => setProtagonist({ ...protagonist, name: e.target.value })} />
            <input className={input} placeholder="别名 / 称呼" value={protagonist.aliases} onChange={(e) => setProtagonist({ ...protagonist, aliases: e.target.value })} />
          </div>
          <textarea className={`${input} min-h-24 w-full`} placeholder="人设：外貌、性格、能力、来历…" value={protagonist.profile} onChange={(e) => setProtagonist({ ...protagonist, profile: e.target.value })} />
          <textarea className={`${input} min-h-20 w-full`} placeholder="成长线：主角的成长轨迹与关键节点" value={protagonist.arc} onChange={(e) => setProtagonist({ ...protagonist, arc: e.target.value })} />
          <textarea className={`${input} min-h-16 w-full`} placeholder="备注：口头禅、禁忌、软肋等" value={protagonist.notes} onChange={(e) => setProtagonist({ ...protagonist, notes: e.target.value })} />
          <button
            onClick={async () => {
              await saveProtagonist(workId, protagonist);
              setStatus({ text: "主角记忆已保存", ok: true });
              onChanged();
            }}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-500"
          >
            保存主角记忆
          </button>
        </div>
      )}

      {tab === "characters" && (
        <div className="max-w-3xl space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const next = [...characters, { id: uid(), name: "", relation: "", content: "" }];
                setCharacters(next);
                saveCharacters(workId, next);
              }}
              className={btn}
            >
              + 添加配角
            </button>
            <span className="text-xs text-stone-400">AI 填写使用：</span>
            <ModelPicker providers={charModel.providers} value={charModel.selectedId} onChange={charModel.select} />
          </div>
          {characters.map((c) => (
            <div key={c.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex gap-2">
                <input className={`${input} w-40`} placeholder="姓名" value={c.name} onChange={(e) => setCharacters(characters.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))} />
                <input className={`${input} flex-1`} placeholder="与主角关系（如：师尊 / 宿敌 / 挚友）" value={c.relation} onChange={(e) => setCharacters(characters.map((x) => (x.id === c.id ? { ...x, relation: e.target.value } : x)))} />
                <button onClick={() => aiFillCharacter(c)} className={btn}>
                  AI 填写
                </button>
                <button
                  onClick={() => {
                    const next = characters.filter((x) => x.id !== c.id);
                    setCharacters(next);
                    saveCharacters(workId, next);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
              <textarea
                className={`${input} min-h-24 w-full`}
                placeholder="设定内容：背景、性格、当前处境、伏笔潜力…"
                value={c.content}
                onChange={(e) => setCharacters(characters.map((x) => (x.id === c.id ? { ...x, content: e.target.value } : x)))}
                onBlur={() => saveCharacters(workId, characters)}
              />
            </div>
          ))}
        </div>
      )}

      {tab === "worldview" && (
        <div className="max-w-3xl space-y-3">
          <details className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-amber-900">
              从小说文件导入并提取全部标签记忆（txt / md）
            </summary>
            <div
              className={`mt-3 rounded-lg border-2 border-dashed p-1 ${dragOver ? "border-amber-500 bg-amber-50" : "border-transparent"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) importFile(f);
              }}
            >
              <textarea
                className={`${input} min-h-28 w-full`}
                placeholder="把小说原文 txt 拖到这里，或点下方按钮选择文件；也可直接粘贴正文。会分块提取主角、配角、世界观（含自定义标签）、作者要求、伏笔与后文预设。"
                value={importMaterial}
                onChange={(e) => {
                  setImportMaterial(e.target.value);
                  setExtracted(null);
                }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50">
                导入 txt / md
                <input
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {importMaterial.length > 0 && (
                <span className="text-xs text-stone-500">
                  {importMaterial.length} 字 · 约 {chunkCount} 块{importMaterial.length > CHUNK_SIZE * MAX_CHUNKS ? "（超出部分不会提取）" : ""}
                </span>
              )}
              <button onClick={startExtract} disabled={extracting} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500 disabled:opacity-40">
                {extracting ? "提取中…" : "开始提取（先确认提示词）"}
              </button>
              <span className="text-xs text-stone-400">提取使用：</span>
              <ModelPicker providers={extractModel.providers} value={extractModel.selectedId} onChange={extractModel.select} disabled={extracting} />
              {extractProgress && <span className="text-xs text-stone-500">{extractProgress}</span>}
            </div>

            {extracted && (
              <div className="mt-3 space-y-2 rounded-lg border border-green-200 bg-white p-3 text-xs">
                <p className="font-medium text-green-800">提取结果预览（应用时会与现有记忆合并，不覆盖）</p>
                {extracted.protagonist?.name && <p>主角：{extracted.protagonist.name}（{extracted.protagonist.aliases || "无别名"}）</p>}
                {!!extracted.characters?.length && (
                  <p>配角 {extracted.characters.length}：{extracted.characters.map((c) => c.name).join("、")}</p>
                )}
                {!!extracted.worldview?.length && (
                  <p>
                    世界观 {extracted.worldview.length}：
                    {extracted.worldview.slice(0, 8).map((w) => `${w.category}/${w.name}`).join("、")}
                    {extracted.worldview.length > 8 ? " …" : ""}
                  </p>
                )}
                {!!extracted.rules?.length && <p>作者要求 {extracted.rules.length} 条</p>}
                {!!extracted.foreshadows?.length && (
                  <p>伏笔 {extracted.foreshadows.length}：{extracted.foreshadows.map((f) => f.title).join("、")}</p>
                )}
                {!!extracted.presets?.length && <p>后文预设 {extracted.presets.length} 条</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={applyExtract} className="rounded-lg bg-green-700 px-3 py-1.5 text-xs text-white hover:bg-green-600">
                    应用到记忆库
                  </button>
                  <button onClick={() => setExtracted(null)} className={btn}>
                    丢弃结果
                  </button>
                </div>
              </div>
            )}
          </details>

          <div className="rounded-xl border border-stone-200 bg-white p-3">
            <p className="mb-2 text-xs font-medium text-stone-600">标签种类（按作品保存，可自定义）</p>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {categories.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-xs text-stone-700">
                  {c}
                  <button onClick={() => removeCategory(c)} className="text-stone-400 hover:text-red-600" title="删除该类别">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className={`${input} w-40 py-1.5`}
                placeholder="新类别名称"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCategory()}
              />
              <button onClick={addCategory} className={btn}>
                + 添加种类
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                const next = [...worldview, { id: uid(), category: categories[0] ?? "其他", name: "", content: "" }];
                setWorldview(next);
                saveWorldview(workId, next);
              }}
              className={btn}
            >
              + 添加条目
            </button>
            <select
              className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const next = [...worldview, { id: uid(), category: e.target.value, name: "", content: "" }];
                setWorldview(next);
                saveWorldview(workId, next);
              }}
            >
              <option value="">按类别添加…</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <span className="text-xs text-stone-400">AI 填写使用：</span>
            <ModelPicker providers={worldModel.providers} value={worldModel.selectedId} onChange={worldModel.select} />
          </div>
          {worldview.map((w) => (
            <div key={w.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex gap-2">
                <select className={`${input} w-28`} value={w.category} onChange={(e) => setWorldview(worldview.map((x) => (x.id === w.id ? { ...x, category: e.target.value } : x)))}>
                  {[...new Set([...categories, w.category])].map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <input className={`${input} w-56`} placeholder="名称" value={w.name} onChange={(e) => setWorldview(worldview.map((x) => (x.id === w.id ? { ...x, name: e.target.value } : x)))} />
                <button onClick={() => aiFillWorldview(w)} className={btn}>
                  AI 填写
                </button>
                <button
                  onClick={() => {
                    const next = worldview.filter((x) => x.id !== w.id);
                    setWorldview(next);
                    saveWorldview(workId, next);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
              <textarea
                className={`${input} min-h-16 w-full`}
                placeholder="设定内容"
                value={w.content}
                onChange={(e) => setWorldview(worldview.map((x) => (x.id === w.id ? { ...x, content: e.target.value } : x)))}
                onBlur={() => saveWorldview(workId, worldview)}
              />
            </div>
          ))}
        </div>
      )}

      {tab === "rules" && (
        <div className="max-w-2xl space-y-2">
          <p className="text-xs text-stone-400">作者硬性要求会注入每次生成的 System 提示词，例如：禁写吻戏、每章不少于 3000 字、禁止第一人称内心独白。</p>
          <button
            onClick={() => {
              const next = [...rules, { id: uid(), text: "" }];
              setRules(next);
              saveRules(workId, next);
            }}
            className={btn}
          >
            + 添加要求
          </button>
          {rules.map((r) => (
            <div key={r.id} className="flex gap-2">
              <input
                className={`${input} flex-1`}
                value={r.text}
                placeholder="一条硬性要求"
                onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))}
                onBlur={() => saveRules(workId, rules)}
              />
              <button
                onClick={() => {
                  const next = rules.filter((x) => x.id !== r.id);
                  setRules(next);
                  saveRules(workId, next);
                }}
                className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "presets" && (
        <div className="max-w-3xl space-y-3">
          <p className="text-xs text-stone-400">
            后文预设：你对后续剧情的规划（作者意图）。与「后文预测」（AI 推测）分开存放；生成时会按章节内容匹配相关预设。
          </p>
          <button
            onClick={() => {
              const next = [...presets, { id: uid(), title: "", targetChapter: "", content: "" }];
              setPresets(next);
              saveFuturePresets(workId, next);
            }}
            className={btn}
          >
            + 添加预设
          </button>
          {presets.map((p) => (
            <div key={p.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex gap-2">
                <input className={`${input} w-56`} placeholder="预设标题" value={p.title} onChange={(e) => setPresets(presets.map((x) => (x.id === p.id ? { ...x, title: e.target.value } : x)))} />
                <input className={`${input} w-40`} placeholder="预计推进章节（如：第30章前后）" value={p.targetChapter} onChange={(e) => setPresets(presets.map((x) => (x.id === p.id ? { ...x, targetChapter: e.target.value } : x)))} />
                <button
                  onClick={() => {
                    const next = presets.filter((x) => x.id !== p.id);
                    setPresets(next);
                    saveFuturePresets(workId, next);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
              <textarea
                className={`${input} min-h-20 w-full`}
                placeholder="预设内容：计划发生什么、需要提前铺垫什么"
                value={p.content}
                onChange={(e) => setPresets(presets.map((x) => (x.id === p.id ? { ...x, content: e.target.value } : x)))}
                onBlur={() => saveFuturePresets(workId, presets)}
              />
            </div>
          ))}
        </div>
      )}

      {tab === "prediction" && (
        <div className="max-w-2xl space-y-3">
          <p className="text-xs text-stone-400">
            后文预测：AI 对下一章的推测，只覆盖一章。生成下一章前若这里的内容没有被你修改过，会先弹窗让你过目。首章不存在预测。
          </p>
          {!prediction ? (
            <div className="rounded-xl border border-dashed border-stone-300 p-6 text-xs text-stone-400">
              还没有预测。采纳首章后，在写作台点「更新本章记忆」并勾选「后文预测」即可生成。
            </div>
          ) : (
            <>
              <p className="text-xs text-stone-500">
                目标章节：{chapters.find((c) => c.chId === prediction.chId)?.title ?? prediction.chId}
                {prediction.editedAt ? " · 已由作者调整" : " · 仍为 AI 原版"}
                {prediction.reviewedAt ? ` · 最近过目 ${new Date(prediction.reviewedAt).toLocaleString("zh-CN")}` : ""}
              </p>
              <textarea
                className={`${input} min-h-40 w-full leading-relaxed`}
                value={predictionDraft}
                onChange={(e) => setPredictionDraft(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={savePredictionEdit} className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-500">
                  保存修改
                </button>
                <button onClick={removePrediction} className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500">
                  删除预测
                </button>
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-stone-400">查看 AI 原始版本</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-stone-50 p-3 text-xs text-stone-500">{prediction.aiContent}</pre>
              </details>
            </>
          )}
        </div>
      )}

      {tab === "foreshadows" && (
        <div className="max-w-3xl space-y-2">
          <button
            onClick={() => {
              const next = [...foreshadows, { id: uid(), title: "", plantedIn: "", resolveIn: "", status: "open" as const, notes: "" }];
              setForeshadows(next);
              saveForeshadows(workId, next);
            }}
            className={btn}
          >
            + 添加伏笔
          </button>
          {foreshadows.map((f) => (
            <div key={f.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex gap-2">
                <input className={`${input} flex-1`} placeholder="伏笔标题" value={f.title} onChange={(e) => setForeshadows(foreshadows.map((x) => (x.id === f.id ? { ...x, title: e.target.value } : x)))} />
                <input className={`${input} w-32`} placeholder="埋于（章节）" value={f.plantedIn} onChange={(e) => setForeshadows(foreshadows.map((x) => (x.id === f.id ? { ...x, plantedIn: e.target.value } : x)))} />
                <input className={`${input} w-32`} placeholder="计划回收" value={f.resolveIn} onChange={(e) => setForeshadows(foreshadows.map((x) => (x.id === f.id ? { ...x, resolveIn: e.target.value } : x)))} />
                <button
                  onClick={() => {
                    const next = foreshadows.map((x) => (x.id === f.id ? { ...x, status: x.status === "open" ? ("resolved" as const) : ("open" as const) } : x));
                    setForeshadows(next);
                    saveForeshadows(workId, next);
                  }}
                  className={`${btn} ${f.status === "open" ? "text-amber-700" : "text-green-700"}`}
                >
                  {f.status === "open" ? "未回收" : "已回收"}
                </button>
                <button
                  onClick={() => {
                    const next = foreshadows.filter((x) => x.id !== f.id);
                    setForeshadows(next);
                    saveForeshadows(workId, next);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
              <input className={`${input} w-full`} placeholder="备注" value={f.notes} onChange={(e) => setForeshadows(foreshadows.map((x) => (x.id === f.id ? { ...x, notes: e.target.value } : x)))} onBlur={() => saveForeshadows(workId, foreshadows)} />
            </div>
          ))}
        </div>
      )}

      {tab === "recap" && (
        <div className="max-w-3xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-xs text-stone-400">
              前情记忆不再自动生成：采纳章节后在此手动点「生成摘要」，或去写作台「更新本章记忆」批量更新。内容可手动编辑。
            </p>
            <span className="ml-auto text-xs text-stone-400">生成使用：</span>
            <ModelPicker providers={recapModel.providers} value={recapModel.selectedId} onChange={recapModel.select} />
          </div>

          {chaptersWithContent.length === 0 && <p className="text-sm text-stone-400">还没有已采纳的章节。</p>}

          {chaptersWithContent.map((ch) => {
            const entry = recap.find((r) => r.chId === ch.chId);
            return (
              <div key={ch.chId} className="mb-2 rounded-lg border border-stone-200 bg-white p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-xs font-medium text-stone-500">{ch.chId.replace("ch-", "第") + "章"}</span>
                  <span className="text-sm">{ch.title}</span>
                  <button onClick={() => generateRecap(ch)} className={`ml-auto ${btn}`}>
                    {entry ? "重新生成（整合原文）" : "生成摘要"}
                  </button>
                  {entry && (
                    <button
                      onClick={async () => {
                        if (!confirm(`删除「${ch.title}」的前情摘要？`)) return;
                        await deleteRecapEntry(workId, ch.chId);
                        reload();
                        onChanged();
                      }}
                      className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                    >
                      删除
                    </button>
                  )}
                </div>
                {entry ? (
                  <textarea
                    className={`${input} min-h-16 w-full text-sm`}
                    value={entry.summary}
                    onChange={(e) => setRecap(recap.map((r) => (r.chId === entry.chId ? { ...r, summary: e.target.value } : r)))}
                    onBlur={async () => {
                      await saveRecapEntry(workId, entry);
                      onChanged();
                    }}
                  />
                ) : (
                  <p className="text-xs text-stone-400">暂无摘要</p>
                )}
              </div>
            );
          })}

          {chaptersWithContent.length > 0 && recap.length > 0 && (
            <p className="mt-3 text-xs text-stone-400">
              已有 {recap.length} 章摘要。长篇记忆（每 10 章一段的阶段摘要 + 全文脉络）在写作台「更新本章记忆」里批量生成。
            </p>
          )}
        </div>
      )}

      {promptModal && (
        <PromptConfirmModal
          featureKey={promptModal.featureKey}
          title={promptModal.title}
          defaultSystem={promptModal.defaultSystem}
          defaultUser={promptModal.user}
          meta={promptModal.meta}
          confirmLabel={promptModal.confirmLabel}
          onConfirm={promptModal.onConfirm}
          onCancel={() => setPromptModal(null)}
        />
      )}
    </div>
  );
}
