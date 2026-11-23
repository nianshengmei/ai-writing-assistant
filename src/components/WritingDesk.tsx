"use client";

import { useEffect, useRef, useState } from "react";
import {
  getOutline,
  listStyles,
  readDraft,
  readChapterContent,
  saveDraft,
  deleteDraft,
  approveChapter,
  saveGeneration,
  updateGenerationStatus,
  getProtagonist,
  listCharacters,
  listWorldview,
  listRules,
  listFuturePresets,
  listRecap,
  listForeshadows,
  getStoryArc,
  getRecapLong,
  getFuturePrediction,
  saveFuturePrediction,
  hasApprovedPredecessor,
  findNextChapter,
} from "@/lib/library";
import { streamChat } from "@/lib/llm";
import { useFeatureModel } from "@/lib/useProviderSelection";
import ModelPicker from "./ModelPicker";
import PromptConfirmModal, { type PromptConfirmPayload } from "./PromptConfirmModal";
import MemoryUpdateModal from "./MemoryUpdateModal";
import { assembleGeneration, type AssembledPrompt, type MemoryBundle } from "@/lib/context";
import { appendExtra, SELECTION_SYSTEM, SELECTION_TASKS, type SelectionKind } from "@/lib/prompts";
import { exportWork } from "@/lib/exporter";
import type { ProjectDoc, WorkOutline, OutlineEntry, StyleDoc, FuturePrediction } from "@/lib/types";

export default function WritingDesk({ project, onChanged }: { project: ProjectDoc; onChanged: () => void }) {
  const workId = project.id;
  const [outline, setOutline] = useState<WorkOutline | null>(null);
  const [styles, setStyles] = useState<StyleDoc[]>([]);
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([]);
  const [chId, setChId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const [lastGenId, setLastGenId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [targetLength, setTargetLength] = useState(2500);
  const [tick, setTick] = useState(0);
  const [recapMissing, setRecapMissing] = useState(false);
  const [showMemoryUpdate, setShowMemoryUpdate] = useState(false);

  const [predictionModal, setPredictionModal] = useState<{ pred: FuturePrediction; nextTitle: string } | null>(null);
  const [predictionDraft, setPredictionDraft] = useState("");
  const [pendingFeedback, setPendingFeedback] = useState<string | undefined>(undefined);

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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    Promise.all([getOutline(workId), listStyles()]).then(([o, s]) => {
      if (!alive) return;
      setOutline(o);
      setStyles(s);
      if (!chId && o.chapters.length) setChId(o.chapters[0].chId);
    });
    return () => {
      alive = false;
    };
  }, [workId, tick]);

  const entry: OutlineEntry | null = outline?.chapters.find((c) => c.chId === chId) ?? null;

  useEffect(() => {
    let alive = true;
    if (!chId) {
      setDraftText("");
      setHasDraft(false);
      setRecapMissing(false);
      return;
    }
    Promise.all([readDraft(workId, chId), readChapterContent(workId, chId), listRecap(workId)]).then(([draft, chapter, recap]) => {
      if (!alive) return;
      if (draft) {
        setDraftText(draft.content);
        setHasDraft(true);
        setLastGenId(draft.lastGenId ?? null);
      } else if (chapter) {
        setDraftText(chapter.content);
        setHasDraft(false);
        setLastGenId(null);
      } else {
        setDraftText("");
        setHasDraft(false);
        setLastGenId(null);
      }
      setRecapMissing(!!chapter && !recap.some((r) => r.chId === chId));
    });
    return () => {
      alive = false;
    };
  }, [workId, chId]);

  function scheduleSave(value: string) {
    if (!chId || streamingRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await saveDraft(workId, chId!, value, lastGenId ?? undefined);
      setHasDraft(true);
    }, 800);
  }

  function onDraftChange(value: string) {
    setDraftText(value);
    scheduleSave(value);
  }

  const fm = useFeatureModel("write");

  function ensureProvider() {
    const provider = fm.picked;
    if (!provider || !provider.apiKey) {
      setStatus("失败：请先在右上角 ⚙ 设置 → 模型 中添加模型，并在本页选择");
      return null;
    }
    return provider;
  }

  async function loadMemoryBundle(prediction?: FuturePrediction | null): Promise<MemoryBundle> {
    const o = await getOutline(workId);
    const [protagonist, characters, worldview, rules, presets, recap, foreshadows, storyArc, recapLong] = await Promise.all([
      getProtagonist(workId),
      listCharacters(workId),
      listWorldview(workId),
      listRules(workId),
      listFuturePresets(workId),
      listRecap(workId),
      listForeshadows(workId),
      getStoryArc(workId),
      getRecapLong(workId),
    ]);
    const idx = o.chapters.findIndex((c) => c.chId === chId);
    let lastChapter: { title: string; tail: string } | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      const c = await readChapterContent(workId, o.chapters[i].chId);
      if (c) {
        lastChapter = { title: o.chapters[i].title, tail: c.content.slice(-500) };
        break;
      }
    }
    return {
      protagonist,
      characters,
      worldview,
      rules,
      presets,
      recap,
      foreshadows,
      lastChapter,
      storyArc,
      recapSegments: recapLong.segments,
      prediction: prediction ?? null,
    };
  }

  async function buildPrompt(feedbackArg?: string, prediction?: FuturePrediction | null): Promise<AssembledPrompt | null> {
    if (!entry) return null;
    const styleDocs = selectedStyleIds.map((id) => styles.find((s) => s.id === id)).filter((s): s is StyleDoc => !!s);
    const memory = await loadMemoryBundle(prediction);
    return assembleGeneration({
      project,
      entry,
      memory,
      styleDocs,
      feedback: feedbackArg,
      previousDraft: feedbackArg ? draftText : undefined,
      targetLength,
    });
  }

  async function openPromptModal(feedbackArg: string | undefined, prediction?: FuturePrediction | null) {
    const provider = ensureProvider();
    if (!provider) return;
    const assembled = await buildPrompt(feedbackArg, prediction);
    if (!assembled) return;
    const hasPrediction = !!prediction?.content?.trim();
    const metaLines: string[] = [
      `目标约 ${targetLength} 字`,
      hasPrediction ? "已注入后文预测" : "本章无后文预测（首章或暂无依据）",
    ];
    if (feedbackArg) metaLines.push("含作者对上一稿的意见");
    setPromptModal({
      featureKey: feedbackArg ? "write-feedback" : "write",
      title: feedbackArg ? `按意见重新生成 · ${entry?.title ?? ""}` : `生成本章 · ${entry?.title ?? ""}`,
      system: assembled.system,
      user: assembled.user,
      defaultSystem: assembled.system,
      meta: metaLines.join(" · "),
      confirmLabel: "按此提示词生成",
      onConfirm: async (p) => {
        setPromptModal(null);
        await runGenerationFromPrompt({ system: p.system, user: appendExtra(p.user, p.extra) }, feedbackArg);
      },
    });
  }

  /** 点「生成本章」的总入口：先判定后文预测，再进提示词确认 */
  async function startGeneration(feedbackArg?: string, skipPrediction = false) {
    if (!entry) {
      setStatus("请先选择章节");
      return;
    }
    const provider = ensureProvider();
    if (!provider) return;

    setPendingFeedback(feedbackArg);

    if (skipPrediction) {
      const pred = await getFuturePrediction(workId);
      // 预测记录只对「它指向的那一章」有效，写别的章节不注入
      await openPromptModal(feedbackArg, pred && pred.chId === entry.chId ? pred : null);
      return;
    }

    const canPredict = await hasApprovedPredecessor(workId, entry.chId);
    if (!canPredict) {
      // 首章 / 跳章写 / 前序未采纳：没有可预测依据，直接进提示词确认
      await openPromptModal(feedbackArg, null);
      return;
    }

    const pred = await getFuturePrediction(workId);
    if (!pred || pred.chId !== entry.chId || !pred.content.trim()) {
      setStatus("暂无本章的后文预测（可在记忆库「后文预测」填写，或点「更新本章记忆」生成），本次直接生成。");
      await openPromptModal(feedbackArg, null);
      return;
    }

    const edited = pred.editedAt !== null && pred.content !== pred.aiContent;
    if (edited) {
      await openPromptModal(feedbackArg, pred);
      return;
    }

    const next = await findNextChapter(workId, entry.chId);
    setPredictionDraft(pred.content);
    setPredictionModal({ pred, nextTitle: next?.title ?? "下一章" });
  }

  async function confirmPrediction() {
    if (!predictionModal) return;
    const p = predictionModal.pred;
    const text = predictionDraft.trim();
    const changed = text !== p.aiContent.trim();
    const updated: FuturePrediction = {
      ...p,
      content: text,
      editedAt: changed ? Date.now() : p.editedAt,
      reviewedAt: Date.now(),
    };
    await saveFuturePrediction(workId, updated);
    setPredictionModal(null);
    await openPromptModal(pendingFeedback, updated);
  }

  async function runGenerationFromPrompt(finalPrompt: { system: string; user: string }, feedbackArg?: string) {
    if (!entry) return;
    const provider = ensureProvider();
    if (!provider) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamingRef.current = true;
    setStreaming(true);
    setShowFeedback(false);
    setStatus(feedbackArg ? "正在按意见重新生成…（可随时停止）" : "正在生成本章…（可随时停止）");
    let acc = "";
    try {
      await streamChat({
        config: provider,
        messages: [
          { role: "system", content: finalPrompt.system },
          { role: "user", content: finalPrompt.user },
        ],
        signal: ctrl.signal,
        onDelta: (d) => {
          acc += d;
          setDraftText(acc);
        },
      });
      await saveDraft(workId, entry.chId, acc);
      const rec = await saveGeneration(workId, {
        chId: entry.chId,
        prompt: finalPrompt,
        providerName: provider.name,
        model: provider.model,
        styleIds: [...selectedStyleIds],
        output: acc,
        feedback: feedbackArg,
        status: "draft",
      });
      setLastGenId(rec.id);
      setHasDraft(true);
      setStatus(`生成完成，共 ${acc.length} 字。可编辑后采纳，或点「更新本章记忆」补齐前情与设定。`);
      onChanged();
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      if (acc) {
        await saveDraft(workId, entry.chId, acc);
        await saveGeneration(workId, {
          chId: entry.chId,
          prompt: finalPrompt,
          providerName: provider.name,
          model: provider.model,
          styleIds: [...selectedStyleIds],
          output: acc,
          feedback: feedbackArg,
          status: "draft",
        });
        setHasDraft(true);
      }
      setStatus(aborted ? "已停止，已生成部分已保留为草稿" : `生成失败：${(e as Error)?.message ?? e}`);
    } finally {
      streamingRef.current = false;
      setStreaming(false);
      abortRef.current = null;
    }
  }

  /** 采纳：只写正式章节，不再自动调用任何 AI */
  async function approve() {
    if (!entry || !draftText.trim()) {
      setStatus("当前章节还没有内容");
      return;
    }
    await approveChapter(workId, entry.chId, draftText);
    if (lastGenId) await updateGenerationStatus(workId, lastGenId, "approved");
    setStatus("已采纳为正式章节，前情记忆未自动生成。点「更新本章记忆」可一次性更新前情、伏笔、设定与后文预测。");
    onChanged();
    reload();
  }

  async function discard() {
    if (!entry) return;
    if (!confirm(`放弃「${entry.title}」的当前草稿？（生成历史会保留记录）`)) return;
    if (lastGenId) await updateGenerationStatus(workId, lastGenId, "discarded");
    await deleteDraft(workId, entry.chId);
    setDraftText("");
    setHasDraft(false);
    setLastGenId(null);
    setStatus("草稿已放弃，可重新生成");
    reload();
  }

  /** 选区操作：先快照选中内容，弹窗确认提示词后才真正调用 */
  function openSelectionModal(kind: SelectionKind) {
    const ta = textareaRef.current;
    if (!ta || !entry) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) {
      setStatus("请先用鼠标选中要处理的文字");
      return;
    }
    const provider = ensureProvider();
    if (!provider) return;
    const selected = draftText.slice(start, end);
    const preface = draftText.slice(Math.max(0, start - 200), start);
    const user = `【小说】《${project.title}》 ${project.description}\n\n【任务】${SELECTION_TASKS[kind]}\n\n【前文】\n${preface || "（无）"}\n\n【待处理文字】\n${selected}`;
    setPromptModal({
      featureKey: "selection",
      title: `${kind === "polish" ? "润色" : kind === "expand" ? "扩写" : "重写"}选中内容`,
      system: SELECTION_SYSTEM,
      user,
      defaultSystem: SELECTION_SYSTEM,
      meta: `将替换正文中第 ${start + 1}~${end} 个字符（共 ${selected.length} 字）`,
      confirmLabel: "开始处理",
      onConfirm: async (p) => {
        setPromptModal(null);
        await runSelectionFromPrompt(start, end, { system: p.system, user: appendExtra(p.user, p.extra) });
      },
    });
  }

  async function runSelectionFromPrompt(start: number, end: number, finalPrompt: { system: string; user: string }) {
    if (!entry) return;
    const provider = ensureProvider();
    if (!provider) return;
    if (end > draftText.length) {
      setStatus("正文在确认前已变动，请重新选中后再试");
      return;
    }
    const base = draftText;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamingRef.current = true;
    setStreaming(true);
    setStatus("正在处理选中内容…");
    let acc = "";
    try {
      await streamChat({
        config: provider,
        messages: [
          { role: "system", content: finalPrompt.system },
          { role: "user", content: finalPrompt.user },
        ],
        signal: ctrl.signal,
        onDelta: (d) => {
          acc += d;
          setDraftText(base.slice(0, start) + acc + base.slice(end));
        },
      });
      await saveDraft(workId, entry.chId, base.slice(0, start) + acc + base.slice(end));
      setHasDraft(true);
      setStatus("处理完成");
    } catch (e) {
      if (acc) {
        await saveDraft(workId, entry.chId, base.slice(0, start) + acc + base.slice(end));
        setHasDraft(true);
      }
      setStatus((e as Error)?.name === "AbortError" ? "已停止" : `处理失败：${(e as Error)?.message ?? e}`);
    } finally {
      streamingRef.current = false;
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function handleExport() {
    if (!outline) return;
    const contents = new Map<string, string>();
    for (const e of outline.chapters) {
      const c = await readChapterContent(workId, e.chId);
      if (c) contents.set(e.chId, c.content);
      else {
        const d = await readDraft(workId, e.chId);
        if (d) contents.set(e.chId, d.content);
      }
    }
    const msg = await exportWork(project, outline.chapters, contents, "txt");
    setStatus(msg);
  }

  if (!outline) return <p className="p-6 text-sm text-stone-400">加载中…</p>;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-stone-200 bg-stone-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-stone-500">章节目录</h3>
          <span className="text-xs text-stone-400">{outline.chapters.length} 章</span>
        </div>
        {outline.chapters.length === 0 && (
          <p className="text-xs text-stone-400">还没有章节，去「大纲」页添加或与 AI 讨论生成。</p>
        )}
        {outline.chapters.map((c) => {
          const active = c.chId === chId;
          return (
            <button
              key={c.chId}
              onClick={() => setChId(c.chId)}
              className={`mb-1 block w-full rounded-lg px-2.5 py-2 text-left text-sm ${
                active ? "bg-amber-100 text-amber-900" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <span className="mr-1.5 text-xs text-stone-400">{c.chId.replace("ch-", "")}</span>
              {c.title}
              {c.approved && <span className="ml-1 text-xs text-green-600">●</span>}
            </button>
          );
        })}
      </aside>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {!entry ? (
          <p className="text-sm text-stone-400">选择或创建一个章节开始写作。</p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{entry.title}</h3>
              {entry.approved ? (
                <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">正式章节</span>
              ) : hasDraft ? (
                <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">草稿（可编辑）</span>
              ) : (
                <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500">未生成</span>
              )}
              <span className="ml-auto text-xs text-stone-400">{draftText.length} 字</span>
            </div>

            {entry.outline && (
              <p className="mb-2 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-500">
                细纲：{entry.outline}
              </p>
            )}

            {recapMissing && (
              <p className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                本章还没有前情记忆，下一章的上下文会缺失。
                <button onClick={() => setShowMemoryUpdate(true)} className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-500">
                  去更新本章记忆
                </button>
              </p>
            )}

            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-stone-500">风格：</span>
              {styles.length === 0 && <span className="text-stone-400">风格库为空（首页 → 风格库 → 新建并提炼）</span>}
              {styles.map((s) => {
                const i = selectedStyleIds.indexOf(s.id);
                const active = i >= 0;
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      setSelectedStyleIds(active ? selectedStyleIds.filter((id) => id !== s.id) : [...selectedStyleIds, s.id])
                    }
                    className={`rounded-full border px-2.5 py-1 ${
                      active
                        ? "border-purple-500 bg-purple-50 text-purple-700"
                        : "border-stone-300 bg-white text-stone-500 hover:border-stone-400"
                    }`}
                  >
                    {active && i === 0 ? "★ " : ""}
                    {s.name}
                  </button>
                );
              })}
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <ModelPicker providers={fm.providers} value={fm.selectedId} onChange={fm.select} disabled={streaming} />
              {streaming ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs text-red-600"
                >
                  停止
                </button>
              ) : (
                <>
                  <button
                    onClick={() => startGeneration()}
                    className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700"
                  >
                    生成本章
                  </button>
                  <button
                    onClick={() => setShowFeedback((v) => !v)}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
                  >
                    提意见重新生成
                  </button>
                </>
              )}
              {(
                [
                  ["polish", "润色"],
                  ["expand", "扩写"],
                  ["rewrite", "重写"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  disabled={streaming}
                  onClick={() => openSelectionModal(k)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
              <button
                disabled={streaming}
                onClick={approve}
                className="rounded-lg bg-green-700 px-3 py-1.5 text-xs text-white hover:bg-green-600 disabled:opacity-40"
              >
                ✓ 采纳为正式章节
              </button>
              <button
                disabled={streaming || !entry.approved}
                onClick={() => setShowMemoryUpdate(true)}
                title={entry.approved ? "整合更新本章相关的全部记忆" : "先采纳为正式章节"}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-40"
              >
                更新本章记忆
              </button>
              {hasDraft && !entry.approved && (
                <button
                  onClick={discard}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-50"
                >
                  放弃草稿
                </button>
              )}
              <button
                onClick={handleExport}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
              >
                导出全书
              </button>
            </div>

            {showFeedback && !streaming && (
              <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                <textarea
                  className="min-h-16 w-full rounded border border-amber-300 px-2 py-1.5 text-sm"
                  placeholder="对上一稿的意见，例如：节奏太快，把打斗写细；去掉女主的内心独白；结尾悬念不够…"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <button
                  onClick={() => startGeneration(feedback.trim() || undefined, true)}
                  className="mt-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500"
                >
                  按意见重新生成（先确认提示词）
                </button>
              </div>
            )}

            {status && (
              <p
                className={`mb-2 whitespace-pre-wrap break-all text-xs ${
                  status.startsWith("失败") || status.includes("失败") || status.includes("请先")
                    ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700"
                    : "text-stone-500"
                }`}
              >
                {status}
              </p>
            )}

            <textarea
              ref={textareaRef}
              className="min-h-0 flex-1 resize-none rounded-xl border border-stone-200 bg-white p-4 text-sm leading-relaxed"
              placeholder="点「生成本章」会先弹出提示词确认窗（可见可编辑），确认后才调用模型；也可直接在此输入。草稿自动保存。"
              value={draftText}
              onChange={(e) => onDraftChange(e.target.value)}
            />
          </>
        )}
      </div>

      {predictionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPredictionModal(null)}>
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
              <div>
                <h2 className="font-medium">后文预测 · {predictionModal.nextTitle}</h2>
                <p className="mt-0.5 text-xs text-stone-400">这份预测由 AI 生成、你还没有修改过，先过目确认再生成正文。</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={confirmPrediction} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500">
                  确认并继续
                </button>
                <button onClick={() => setPredictionModal(null)} className="text-sm text-stone-400 hover:text-stone-700">
                  取消
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <textarea
                className="min-h-56 w-full resize-y rounded-lg border border-stone-300 px-3 py-2 text-sm leading-relaxed"
                value={predictionDraft}
                onChange={(e) => setPredictionDraft(e.target.value)}
              />
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-stone-400">查看 AI 原始版本（修改后会标记为「已由作者调整」）</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-stone-50 p-3 text-xs text-stone-500">{predictionModal.pred.aiContent}</pre>
              </details>
            </div>
          </div>
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
          busy={streaming}
          onConfirm={promptModal.onConfirm}
          onCancel={() => setPromptModal(null)}
        />
      )}

      {showMemoryUpdate && entry && (
        <MemoryUpdateModal
          project={project}
          entry={entry}
          content={draftText}
          onClose={() => setShowMemoryUpdate(false)}
          onApplied={() => {
            onChanged();
            reload();
          }}
        />
      )}
    </div>
  );
}
