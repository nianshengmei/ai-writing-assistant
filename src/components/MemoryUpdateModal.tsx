"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getProtagonist,
  listCharacters,
  listWorldview,
  listWorldviewCategories,
  listFuturePresets,
  listRecap,
  listForeshadows,
  getStoryArc,
  getRecapLong,
  getFuturePrediction,
  findNextChapter,
  saveProtagonist,
  saveCharacters,
  saveWorldview,
  saveRecapEntry,
  saveForeshadows,
  saveRecapLong,
  saveStoryArc,
  saveFuturePrediction,
  saveAiCall,
  loadPromptOverrides,
  savePromptOverride,
  uid,
} from "@/lib/library";
import {
  buildSettingUpdateMessages,
  buildRecapForeshadowUpdateMessages,
  buildRecapCompressMessages,
  buildStoryArcMessages,
  buildPredictionMessages,
} from "@/lib/context";
import {
  appendExtra,
  PREDICTION_SYSTEM,
  RECAP_COMPRESS_SYSTEM,
  RECAP_FORESHADOW_UPDATE_SYSTEM,
  SETTING_UPDATE_SYSTEM,
  STORY_ARC_SYSTEM,
} from "@/lib/prompts";
import { chatOnce } from "@/lib/llm";
import { parseJsonLoose } from "@/lib/json";
import { useFeatureModel } from "@/lib/useProviderSelection";
import ModelPicker from "./ModelPicker";
import type {
  ChatMessage,
  CharacterEntry,
  ForeshadowEntry,
  FuturePreset,
  MemoryUpdateResult,
  OutlineEntry,
  ProjectDoc,
  PromptOverrides,
  ProtagonistDoc,
  RecapEntry,
  RecapSegment,
  StoryArcDoc,
  WorldviewEntry,
  FuturePrediction,
} from "@/lib/types";

type GroupKey = "setting" | "recap" | "compress" | "arc" | "prediction";

const GROUP_SYSTEM: Record<GroupKey, string> = {
  setting: SETTING_UPDATE_SYSTEM,
  recap: RECAP_FORESHADOW_UPDATE_SYSTEM,
  compress: RECAP_COMPRESS_SYSTEM,
  arc: STORY_ARC_SYSTEM,
  prediction: PREDICTION_SYSTEM,
};

const GROUP_FEATURE: Record<GroupKey, string> = {
  setting: "memory-update-setting",
  recap: "memory-update-recap",
  compress: "recap-compress",
  arc: "story-arc",
  prediction: "prediction",
};

const COMPRESS_CHUNK = 10;
const COMPRESS_WINDOW = 50;

function applyExtra(msgs: ChatMessage[], extra?: string): ChatMessage[] {
  if (!extra?.trim()) return msgs;
  return msgs.map((m, i) => (i === msgs.length - 1 && m.role === "user" ? { ...m, content: appendExtra(m.content, extra) } : m));
}

function attachCharIds(existing: CharacterEntry[], incoming: { name?: string; relation?: string; content?: string }[]): CharacterEntry[] {
  return incoming
    .filter((x) => (x.name ?? "").trim() || (x.content ?? "").trim())
    .map((x) => {
      const name = (x.name ?? "").trim();
      const old = existing.find((e) => e.name === name);
      return { id: old?.id ?? uid(), name, relation: x.relation ?? old?.relation ?? "", content: x.content ?? "" };
    });
}

function attachWorldIds(existing: WorldviewEntry[], incoming: { category?: string; name?: string; content?: string }[], categories: string[]): WorldviewEntry[] {
  return incoming
    .filter((x) => (x.name ?? "").trim() || (x.content ?? "").trim())
    .map((x) => {
      const name = (x.name ?? "").trim();
      const category = (x.category ?? "").trim() || categories[0] || "其他";
      const old = existing.find((e) => e.name === name && e.category === category) ?? existing.find((e) => e.name === name);
      return { id: old?.id ?? uid(), category, name, content: x.content ?? "" };
    });
}

export default function MemoryUpdateModal({
  project,
  entry,
  content,
  onClose,
  onApplied,
}: {
  project: ProjectDoc;
  entry: OutlineEntry;
  content: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const workId = project.id;
  const fm = useFeatureModel("memory-update");

  const [ready, setReady] = useState(false);
  const [protagonist, setProtagonist] = useState<ProtagonistDoc>({ name: "", aliases: "", profile: "", arc: "", notes: "" });
  const [characters, setCharacters] = useState<CharacterEntry[]>([]);
  const [worldview, setWorldview] = useState<WorldviewEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [presets, setPresets] = useState<FuturePreset[]>([]);
  const [recap, setRecap] = useState<RecapEntry[]>([]);
  const [foreshadows, setForeshadows] = useState<ForeshadowEntry[]>([]);
  const [storyArc, setStoryArc] = useState<StoryArcDoc>({ mainline: "", stages: "", relations: "", updatedAt: 0 });
  const [segments, setSegments] = useState<RecapSegment[]>([]);
  const [prediction, setPrediction] = useState<FuturePrediction | null>(null);
  const [nextChapter, setNextChapter] = useState<OutlineEntry | null>(null);

  const [selected, setSelected] = useState<Record<GroupKey, boolean>>({
    setting: true,
    recap: true,
    compress: true,
    arc: true,
    prediction: true,
  });
  const [overrides, setOverrides] = useState<PromptOverrides>({});
  const [expanded, setExpanded] = useState<GroupKey | null>(null);
  const [draftSystem, setDraftSystem] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [results, setResults] = useState<MemoryUpdateResult>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getProtagonist(workId),
      listCharacters(workId),
      listWorldview(workId),
      listWorldviewCategories(workId),
      listFuturePresets(workId),
      listRecap(workId),
      listForeshadows(workId),
      getStoryArc(workId),
      getRecapLong(workId),
      getFuturePrediction(workId),
      findNextChapter(workId, entry.chId),
      loadPromptOverrides(),
    ]).then(([p, c, w, cats, ps, rc, fs, arc, long, pred, next, ov]) => {
      setProtagonist(p);
      setCharacters(c);
      setWorldview(w);
      setCategories(cats);
      setPresets(ps);
      setRecap(rc);
      setForeshadows(fs);
      setStoryArc(arc);
      setSegments(long.segments);
      setPrediction(pred);
      setNextChapter(next);
      setOverrides(ov);
      setReady(true);
    });
  }, [workId, entry.chId]);

  const compressChunks = useMemo(() => {
    const n = Math.min(recap.length, COMPRESS_WINDOW);
    return Math.ceil(n / COMPRESS_CHUNK);
  }, [recap.length]);

  const groups = useMemo(
    () => [
      {
        key: "setting" as GroupKey,
        label: "设定类整合",
        desc: "主角 / 配角 / 世界观 / 自定义标签，共享本章正文，合并为一次调用；现有条目全部保留",
        calls: 1,
        disabled: false,
      },
      {
        key: "recap" as GroupKey,
        label: "前情摘要 + 伏笔表",
        desc: "已有摘要必须整合保留，只补充本章变化；伏笔只增不删",
        calls: 1,
        disabled: false,
      },
      {
        key: "compress" as GroupKey,
        label: "长篇记忆压缩",
        desc: compressChunks
          ? `最近 ${Math.min(recap.length, COMPRESS_WINDOW)} 章按每 ${COMPRESS_CHUNK} 章一段压缩为阶段摘要`
          : "还没有逐章摘要，暂不可压缩",
        calls: compressChunks,
        disabled: compressChunks === 0,
      },
      {
        key: "arc" as GroupKey,
        label: "全文脉络",
        desc: "基于阶段摘要滚动更新主线 / 阶段转折 / 人物关系演变",
        calls: 1,
        disabled: false,
      },
      {
        key: "prediction" as GroupKey,
        label: "后文预测",
        desc: nextChapter ? `预测「${nextChapter.title}」的走向，供下一章生成前确认` : "没有下一章，无法预测",
        calls: 1,
        disabled: !nextChapter,
      },
    ],
    [compressChunks, recap.length, nextChapter],
  );

  const totalCalls = groups.reduce((sum, g) => (selected[g.key] && !g.disabled ? sum + g.calls : sum), 0);

  function toggle(key: GroupKey) {
    setSelected((s) => ({ ...s, [key]: !s[key] }));
  }

  function openPrompt(key: GroupKey) {
    setExpanded(key);
    setDraftSystem(overrides[GROUP_FEATURE[key]]?.system ?? GROUP_SYSTEM[key]);
  }

  async function savePromptDraft(key: GroupKey) {
    const feature = GROUP_FEATURE[key];
    await savePromptOverride(feature, {
      system: draftSystem.trim() !== GROUP_SYSTEM[key].trim() ? draftSystem : undefined,
      extra: overrides[feature]?.extra,
    });
    setOverrides(await loadPromptOverrides());
    setStatus({ text: "该组提示词已保存，后续更新沿用", ok: true });
  }

  async function runAll() {
    const provider = fm.picked;
    if (!provider || !provider.apiKey) {
      setStatus({ text: "失败：请先在右上角 ⚙ 设置 → 模型 中添加模型，并在此选择", ok: false });
      return;
    }
    setRunning(true);
    setStatus(null);
    const next: MemoryUpdateResult = { ...results };
    const ov = (k: GroupKey) => overrides[GROUP_FEATURE[k]];
    /** 每组独立执行：某组失败（网络/JSON 解析）不影响其余组继续跑，最后统一汇报 */
    const failures: string[] = [];
    async function step(label: string, fn: () => Promise<void>) {
      try {
        await fn();
      } catch (e) {
        failures.push(`${label}（${(e as Error)?.message ?? e}）`);
      }
    }

    await step("设定类记忆", async () => {
      if (selected.setting) {
        setProgress("整合设定类记忆（主角 / 配角 / 世界观）…");
        const msgs = buildSettingUpdateMessages({
          project,
          chapterTitle: entry.title,
          content,
          protagonist,
          characters,
          worldview,
          categories,
          systemOverride: ov("setting")?.system,
        });
        const out = await chatOnce(provider, applyExtra(msgs, ov("setting")?.extra));
        const parsed = parseJsonLoose<{
          protagonist?: Partial<ProtagonistDoc>;
          characters?: { name?: string; relation?: string; content?: string }[];
          worldview?: { category?: string; name?: string; content?: string }[];
        }>(out);
        if (!parsed) throw new Error("设定类结果解析失败（模型未返回合法 JSON）");
        next.protagonist = { ...protagonist, ...(parsed.protagonist ?? {}) };
        if (Array.isArray(parsed.characters)) next.characters = attachCharIds(characters, parsed.characters);
        if (Array.isArray(parsed.worldview)) next.worldview = attachWorldIds(worldview, parsed.worldview, categories);
        setResults({ ...next });
        await saveAiCall(workId, {
          feature: "memory-update-setting",
          prompt: { system: msgs[0].content, user: msgs[msgs.length - 1].content },
          providerName: provider.name,
          model: provider.model,
          output: out,
        });
      }

    });

    await step("前情与伏笔", async () => {
      if (selected.recap) {
        setProgress("整合前情摘要与伏笔表…");
        const existing = recap.find((r) => r.chId === entry.chId)?.summary ?? "";
        const msgs = buildRecapForeshadowUpdateMessages({
          project,
          chapterTitle: entry.title,
          content,
          existingSummary: existing,
          foreshadows,
          systemOverride: ov("recap")?.system,
        });
        const out = await chatOnce(provider, applyExtra(msgs, ov("recap")?.extra));
        const parsed = parseJsonLoose<{
          summary?: string;
          foreshadows?: { title?: string; plantedIn?: string; resolveIn?: string; status?: string; notes?: string }[];
        }>(out);
        if (!parsed) throw new Error("前情/伏笔结果解析失败（模型未返回合法 JSON）");
        if (parsed.summary) next.recapSummary = parsed.summary.trim();
        if (Array.isArray(parsed.foreshadows)) {
          next.foreshadows = parsed.foreshadows
            .filter((f) => (f.title ?? "").trim())
            .map((f) => {
              const old = foreshadows.find((e) => e.title === f.title);
              return {
                id: old?.id ?? uid(),
                title: f.title ?? "",
                plantedIn: f.plantedIn ?? old?.plantedIn ?? "",
                resolveIn: f.resolveIn ?? old?.resolveIn ?? "",
                status: f.status === "resolved" ? ("resolved" as const) : ("open" as const),
                notes: f.notes ?? old?.notes ?? "",
              };
            });
        }
        setResults({ ...next });
        await saveAiCall(workId, {
          feature: "memory-update-recap",
          prompt: { system: msgs[0].content, user: msgs[msgs.length - 1].content },
          providerName: provider.name,
          model: provider.model,
          output: out,
        });
      }

    });

    await step("长篇记忆压缩", async () => {
      if (selected.compress && compressChunks > 0) {
        const recent = recap.slice(-COMPRESS_WINDOW);
        const segs: RecapSegment[] = [];
        for (let i = 0; i < recent.length; i += COMPRESS_CHUNK) {
          const part = recent.slice(i, i + COMPRESS_CHUNK);
          setProgress(`压缩长篇记忆 ${i + 1}~${Math.min(i + COMPRESS_CHUNK, recent.length)} / ${recent.length} 章…`);
          const msgs = buildRecapCompressMessages({
            fromCh: part[0].chId,
            toCh: part[part.length - 1].chId,
            summaries: part.map((p) => ({ chId: p.chId, summary: p.summary })),
            systemOverride: ov("compress")?.system,
          });
          const out = await chatOnce(provider, applyExtra(msgs, ov("compress")?.extra));
          segs.push({
            fromCh: part[0].chId,
            toCh: part[part.length - 1].chId,
            summary: out.trim(),
            createdAt: Date.now(),
          });
        }
        next.segments = segs;
        setResults({ ...next });
      }

    });

    await step("全文脉络", async () => {
      if (selected.arc) {
        setProgress("更新全文脉络…");
        const useSegments = next.segments ?? segments;
        const msgs = buildStoryArcMessages({
          project,
          segments: useSegments,
          existing: storyArc,
          systemOverride: ov("arc")?.system,
        });
        const out = await chatOnce(provider, applyExtra(msgs, ov("arc")?.extra));
        const parsed = parseJsonLoose<Partial<StoryArcDoc>>(out);
        if (!parsed) throw new Error("全文脉络结果解析失败（模型未返回合法 JSON）");
        next.storyArc = {
          mainline: parsed.mainline ?? storyArc.mainline,
          stages: parsed.stages ?? storyArc.stages,
          relations: parsed.relations ?? storyArc.relations,
          updatedAt: Date.now(),
        };
        setResults({ ...next });
        await saveAiCall(workId, {
          feature: "story-arc",
          prompt: { system: msgs[0].content, user: msgs[msgs.length - 1].content },
          providerName: provider.name,
          model: provider.model,
          output: out,
        });
      }

    });

    await step("后文预测", async () => {
      if (selected.prediction && nextChapter) {
        setProgress(`预测「${nextChapter.title}」走向…`);
        const msgs = buildPredictionMessages({
          project,
          nextTitle: nextChapter.title,
          nextOutline: nextChapter.outline,
          recentRecap: recap,
          storyArc: next.storyArc ?? storyArc,
          presets,
          previousPrediction: prediction?.content,
          systemOverride: ov("prediction")?.system,
        });
        const out = await chatOnce(provider, applyExtra(msgs, ov("prediction")?.extra));
        next.prediction = out.trim();
        setResults({ ...next });
        await saveAiCall(workId, {
          feature: "prediction",
          prompt: { system: msgs[0].content, user: msgs[msgs.length - 1].content },
          providerName: provider.name,
          model: provider.model,
          output: out,
        });
      }

    });

    setProgress("");
    if (failures.length) {
      setStatus({
        text: `有 ${failures.length} 组未完成：${failures.join("；")}\n其余结果已保留在下方预览，可取消勾选失败项或直接重试。`,
        ok: false,
      });
    } else {
      setStatus({ text: "整合建议已生成，请核对下方结果后点「应用并保存」；所有写入均为整合结果，原记忆不会丢失。", ok: true });
    }
    setRunning(false);
  }

  async function applyAll() {
    setSaving(true);
    try {
      if (results.protagonist) await saveProtagonist(workId, results.protagonist);
      if (results.characters) await saveCharacters(workId, results.characters);
      if (results.worldview) await saveWorldview(workId, results.worldview);
      if (results.recapSummary) await saveRecapEntry(workId, { chId: entry.chId, summary: results.recapSummary, createdAt: Date.now() });
      if (results.foreshadows) await saveForeshadows(workId, results.foreshadows);
      if (results.segments) await saveRecapLong(workId, results.segments);
      if (results.storyArc) await saveStoryArc(workId, results.storyArc);
      if (results.prediction && nextChapter) {
        await saveFuturePrediction(workId, {
          chId: nextChapter.chId,
          aiContent: results.prediction,
          content: results.prediction,
          generatedAt: Date.now(),
          editedAt: null,
          reviewedAt: null,
        });
      }
      setStatus({ text: "已应用并保存到记忆库", ok: true });
      onApplied();
      setTimeout(onClose, 350);
    } catch (e) {
      setStatus({ text: `保存失败：${(e as Error)?.message ?? e}`, ok: false });
    } finally {
      setSaving(false);
    }
  }

  const hasResults =
    !!results.protagonist ||
    !!results.characters ||
    !!results.worldview ||
    !!results.recapSummary ||
    !!results.foreshadows ||
    !!results.segments ||
    !!results.storyArc ||
    !!results.prediction;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={running ? undefined : onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <div>
            <h2 className="font-medium">更新本章记忆 · {entry.title}</h2>
            <p className="mt-0.5 text-xs text-stone-400">
              所有结果都是「整合保留原有记忆」的完整档案，不会覆盖或删除既有设定。
            </p>
          </div>
          <button onClick={onClose} disabled={running} className="text-sm text-stone-400 hover:text-stone-700 disabled:opacity-40">
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!ready ? (
            <p className="text-sm text-stone-400">加载记忆…</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-stone-500">本功能使用：</span>
                <ModelPicker providers={fm.providers} value={fm.selectedId} onChange={fm.select} disabled={running} />
                <span className="ml-auto text-stone-500">
                  已选 {totalCalls} 次调用
                </span>
              </div>

              <div className="space-y-2">
                {groups.map((g) => (
                  <div key={g.key} className={`rounded-xl border p-3 ${g.disabled ? "border-stone-100 bg-stone-50/50" : "border-stone-200"}`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!g.disabled && selected[g.key]}
                        disabled={g.disabled || running}
                        onChange={() => toggle(g.key)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${g.disabled ? "text-stone-400" : "text-stone-800"}`}>
                          {g.label}
                          <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-500">{g.calls} 次</span>
                        </p>
                        <p className="mt-0.5 text-xs text-stone-400">{g.desc}</p>
                      </div>
                      <button
                        onClick={() => (expanded === g.key ? setExpanded(null) : openPrompt(g.key))}
                        className="shrink-0 rounded-lg border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
                      >
                        {expanded === g.key ? "收起提示词" : "提示词"}
                      </button>
                    </div>
                    {expanded === g.key && (
                      <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50 p-3">
                        <textarea
                          className="min-h-32 w-full rounded border border-purple-200 px-2 py-1.5 font-mono text-xs leading-relaxed"
                          value={draftSystem}
                          onChange={(e) => setDraftSystem(e.target.value)}
                        />
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => savePromptDraft(g.key)} className="rounded-lg bg-purple-600 px-3 py-1 text-xs text-white">
                            保存该组提示词
                          </button>
                          <button onClick={() => setDraftSystem(GROUP_SYSTEM[g.key])} className="text-xs text-stone-500 hover:underline">
                            恢复默认
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={runAll}
                  disabled={running || totalCalls === 0}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700 disabled:opacity-40"
                >
                  {running ? "整合中…" : totalCalls === 0 ? "请至少选择一组" : `开始更新（${totalCalls} 次调用）`}
                </button>
                {hasResults && (
                  <button
                    onClick={applyAll}
                    disabled={saving || running}
                    className="rounded-lg bg-green-700 px-4 py-2 text-sm text-white hover:bg-green-600 disabled:opacity-40"
                  >
                    {saving ? "保存中…" : "应用并保存"}
                  </button>
                )}
                {progress && <span className="text-xs text-stone-500">{progress}</span>}
              </div>

              {status && (
                <p
                  className={`mt-3 whitespace-pre-wrap break-all text-xs ${
                    status.ok ? "text-stone-500" : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700"
                  }`}
                >
                  {status.text}
                </p>
              )}

              {hasResults && (
                <div className="mt-5 space-y-4 border-t border-stone-200 pt-4">
                  <h3 className="text-sm font-medium text-stone-700">整合结果（可逐项修改后再保存）</h3>

                  {results.protagonist && (
                    <section className="rounded-xl border border-stone-200 p-3">
                      <p className="mb-2 text-xs font-medium text-stone-600">主角记忆</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input className="rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="姓名" value={results.protagonist.name} onChange={(e) => setResults({ ...results, protagonist: { ...results.protagonist!, name: e.target.value } })} />
                        <input className="rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="别名" value={results.protagonist.aliases} onChange={(e) => setResults({ ...results, protagonist: { ...results.protagonist!, aliases: e.target.value } })} />
                      </div>
                      <textarea className="mt-2 min-h-16 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="人设" value={results.protagonist.profile} onChange={(e) => setResults({ ...results, protagonist: { ...results.protagonist!, profile: e.target.value } })} />
                      <textarea className="mt-2 min-h-12 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="成长线" value={results.protagonist.arc} onChange={(e) => setResults({ ...results, protagonist: { ...results.protagonist!, arc: e.target.value } })} />
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-stone-400">对比原文（不会保存原文，仅查看）</summary>
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs text-stone-500">{`姓名：${protagonist.name}\n别名：${protagonist.aliases}\n人设：${protagonist.profile}\n成长线：${protagonist.arc}\n备注：${protagonist.notes}`}</pre>
                      </details>
                    </section>
                  )}

                  {results.characters && (
                    <section className="rounded-xl border border-stone-200 p-3">
                      <p className="mb-2 text-xs font-medium text-stone-600">配角记忆（{results.characters.length} 条）</p>
                      {results.characters.map((c, i) => (
                        <div key={c.id} className="mb-2 flex gap-2">
                          <input className="w-24 rounded border border-stone-300 px-2 py-1.5 text-sm" value={c.name} onChange={(e) => setResults({ ...results, characters: results.characters!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                          <input className="w-28 rounded border border-stone-300 px-2 py-1.5 text-sm" value={c.relation} onChange={(e) => setResults({ ...results, characters: results.characters!.map((x, j) => (j === i ? { ...x, relation: e.target.value } : x)) })} />
                          <textarea className="min-h-12 flex-1 rounded border border-stone-300 px-2 py-1.5 text-sm" value={c.content} onChange={(e) => setResults({ ...results, characters: results.characters!.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)) })} />
                        </div>
                      ))}
                    </section>
                  )}

                  {results.worldview && (
                    <section className="rounded-xl border border-stone-200 p-3">
                      <p className="mb-2 text-xs font-medium text-stone-600">世界观（{results.worldview.length} 条）</p>
                      {results.worldview.map((w, i) => (
                        <div key={w.id} className="mb-2 flex gap-2">
                          <select className="w-24 rounded border border-stone-300 px-2 py-1.5 text-sm" value={w.category} onChange={(e) => setResults({ ...results, worldview: results.worldview!.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)) })}>
                            {[...new Set([...categories, w.category])].map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                          <input className="w-36 rounded border border-stone-300 px-2 py-1.5 text-sm" value={w.name} onChange={(e) => setResults({ ...results, worldview: results.worldview!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                          <textarea className="min-h-12 flex-1 rounded border border-stone-300 px-2 py-1.5 text-sm" value={w.content} onChange={(e) => setResults({ ...results, worldview: results.worldview!.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)) })} />
                        </div>
                      ))}
                    </section>
                  )}

                  {results.recapSummary && (
                    <section className="rounded-xl border border-stone-200 p-3">
                      <p className="mb-2 text-xs font-medium text-stone-600">本章前情摘要</p>
                      <textarea className="min-h-20 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" value={results.recapSummary} onChange={(e) => setResults({ ...results, recapSummary: e.target.value })} />
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-stone-400">对比原文</summary>
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs text-stone-500">{recap.find((r) => r.chId === entry.chId)?.summary || "（此前无摘要）"}</pre>
                      </details>
                    </section>
                  )}

                  {results.foreshadows && (
                    <section className="rounded-xl border border-stone-200 p-3">
                      <p className="mb-2 text-xs font-medium text-stone-600">伏笔表（{results.foreshadows.length} 条）</p>
                      {results.foreshadows.map((f, i) => (
                        <div key={f.id} className="mb-2 flex flex-wrap gap-2">
                          <input className="w-40 rounded border border-stone-300 px-2 py-1.5 text-sm" value={f.title} onChange={(e) => setResults({ ...results, foreshadows: results.foreshadows!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                          <input className="w-24 rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="埋于" value={f.plantedIn} onChange={(e) => setResults({ ...results, foreshadows: results.foreshadows!.map((x, j) => (j === i ? { ...x, plantedIn: e.target.value } : x)) })} />
                          <input className="w-24 rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="回收" value={f.resolveIn} onChange={(e) => setResults({ ...results, foreshadows: results.foreshadows!.map((x, j) => (j === i ? { ...x, resolveIn: e.target.value } : x)) })} />
                          <button className={`rounded border px-2 text-xs ${f.status === "open" ? "border-amber-300 text-amber-700" : "border-green-300 text-green-700"}`} onClick={() => setResults({ ...results, foreshadows: results.foreshadows!.map((x, j) => (j === i ? { ...x, status: x.status === "open" ? ("resolved" as const) : ("open" as const) } : x)) })}>
                            {f.status === "open" ? "未回收" : "已回收"}
                          </button>
                          <input className="min-w-32 flex-1 rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="备注" value={f.notes} onChange={(e) => setResults({ ...results, foreshadows: results.foreshadows!.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)) })} />
                        </div>
                      ))}
                    </section>
                  )}

                  {results.segments && (
                    <section className="rounded-xl border border-stone-200 p-3">
                      <p className="mb-2 text-xs font-medium text-stone-600">阶段摘要（{results.segments.length} 段，每段覆盖 10 章）</p>
                      {results.segments.map((s, i) => (
                        <div key={`${s.fromCh}-${s.toCh}`} className="mb-2">
                          <p className="text-xs text-stone-400">
                            {s.fromCh.replace("ch-", "第")}章 ~ {s.toCh.replace("ch-", "第")}章
                          </p>
                          <textarea className="min-h-16 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" value={s.summary} onChange={(e) => setResults({ ...results, segments: results.segments!.map((x, j) => (j === i ? { ...x, summary: e.target.value } : x)) })} />
                        </div>
                      ))}
                    </section>
                  )}

                  {results.storyArc && (
                    <section className="rounded-xl border border-stone-200 p-3">
                      <p className="mb-2 text-xs font-medium text-stone-600">全文脉络</p>
                      <textarea className="mb-2 min-h-16 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="主线" value={results.storyArc.mainline} onChange={(e) => setResults({ ...results, storyArc: { ...results.storyArc!, mainline: e.target.value } })} />
                      <textarea className="mb-2 min-h-16 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="阶段与转折" value={results.storyArc.stages} onChange={(e) => setResults({ ...results, storyArc: { ...results.storyArc!, stages: e.target.value } })} />
                      <textarea className="min-h-16 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" placeholder="人物关系演变" value={results.storyArc.relations} onChange={(e) => setResults({ ...results, storyArc: { ...results.storyArc!, relations: e.target.value } })} />
                    </section>
                  )}

                  {results.prediction && (
                    <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="mb-2 text-xs font-medium text-amber-800">后文预测（下一章 {nextChapter?.title}）</p>
                      <textarea className="min-h-24 w-full rounded border border-amber-300 px-2 py-1.5 text-sm" value={results.prediction} onChange={(e) => setResults({ ...results, prediction: e.target.value })} />
                      <p className="mt-1 text-xs text-amber-700">生成下一章前，若这里的内容未被你修改过，会先弹窗让你过目。</p>
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
