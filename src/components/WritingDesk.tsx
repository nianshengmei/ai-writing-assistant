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
  updateOutlineEntry,
  saveGeneration,
  updateGenerationStatus,
  getProtagonist,
  listCharacters,
  listWorldview,
  listRules,
  listFuturePresets,
  listRecap,
  listForeshadows,
  appendRecap,
} from "@/lib/library";
import { streamChat, chatOnce } from "@/lib/llm";
import { getSelectedProvider } from "@/lib/useProviderSelection";
import { assembleGeneration, buildRecapMessages, type AssembledPrompt, type MemoryBundle } from "@/lib/context";
import { exportWork } from "@/lib/exporter";
import type { ProjectDoc, WorkOutline, OutlineEntry, StyleDoc } from "@/lib/types";

const SELECTION_PROMPTS: Record<string, string> = {
  polish: "润色这段文字：提升文笔与节奏，保持原意、情节与人称不变。",
  expand: "扩写这段文字：增加动作、对话、环境与心理细节，篇幅约为原文的 1.5~2 倍。",
  rewrite: "重写这段文字：保持剧情功能与信息量不变，换一种写法。",
};

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
  const [preview, setPreview] = useState<AssembledPrompt | null>(null);
  const [editSystem, setEditSystem] = useState("");
  const [editUser, setEditUser] = useState("");
  const [targetLength, setTargetLength] = useState(2500);
  const [tick, setTick] = useState(0);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

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
      return;
    }
    Promise.all([readDraft(workId, chId), readChapterContent(workId, chId)]).then(([draft, chapter]) => {
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
    });
    return () => {
      alive = false;
    };
  }, [workId, chId]);

  function scheduleSave(value: string) {
    if (!chId || streamingRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await saveDraft(workId, chId!, value);
      setHasDraft(true);
    }, 800);
  }

  function onDraftChange(value: string) {
    setDraftText(value);
    scheduleSave(value);
  }

  async function ensureProvider() {
    const provider = await getSelectedProvider();
    if (!provider || !provider.apiKey) {
      setStatus("请先在设置中配置模型（含 API Key）");
      return null;
    }
    return provider;
  }

  async function loadMemoryBundle(): Promise<MemoryBundle> {
    const o = await getOutline(workId);
    const [protagonist, characters, worldview, rules, presets, recap, foreshadows] = await Promise.all([
      getProtagonist(workId),
      listCharacters(workId),
      listWorldview(workId),
      listRules(workId),
      listFuturePresets(workId),
      listRecap(workId),
      listForeshadows(workId),
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
    return { protagonist, characters, worldview, rules, presets, recap, foreshadows, lastChapter };
  }

  async function buildPrompt(feedbackArg?: string): Promise<AssembledPrompt | null> {
    if (!entry) return null;
    const styleDocs = selectedStyleIds
      .map((id) => styles.find((s) => s.id === id))
      .filter((s): s is StyleDoc => !!s);
    const memory = await loadMemoryBundle();
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

  async function runGeneration(feedbackArg?: string, override?: { system: string; user: string }) {
    if (!entry) return;
    const provider = await ensureProvider();
    if (!provider) return;
    const assembled = await buildPrompt(feedbackArg);
    if (!assembled) return;
    // override：来自提示词预览编辑后的最终提示词，按编辑稿生成
    const finalPrompt: AssembledPrompt = override
      ? { ...assembled, system: override.system, user: override.user }
      : assembled;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamingRef.current = true;
    setStreaming(true);
    setShowFeedback(false);
    setStatus(feedbackArg ? "正在按意见重新生成…" : "正在生成本章…（可随时停止）");
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
      setStatus(`生成完成，共 ${acc.length} 字。可编辑后采纳，或提意见重新生成。`);
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
          status: aborted ? "draft" : "draft",
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

  async function runPreview() {
    const provider = await ensureProvider();
    if (!provider) return;
    const assembled = await buildPrompt();
    if (!assembled) return;
    setPreview(assembled);
    setEditSystem(assembled.system);
    setEditUser(assembled.user);
    setShowPreviewModal(true);
  }

  async function approve() {
    if (!entry || !draftText.trim()) {
      setStatus("当前章节还没有内容");
      return;
    }
    await approveChapter(workId, entry.chId, draftText);
    if (lastGenId) await updateGenerationStatus(workId, lastGenId, "approved");
    setStatus("已采纳为正式章节，正在更新前情记忆…");
    onChanged();
    try {
      const provider = await ensureProvider();
      if (provider) {
        const summary = await chatOnce(
          provider,
          buildRecapMessages({ workTitle: project.title, chapterTitle: entry.title, content: draftText }),
        );
        await appendRecap(workId, entry.chId, summary);
        setStatus("已采纳为正式章节，前情记忆已更新");
      }
    } catch {
      setStatus("已采纳为正式章节，但前情记忆生成失败，可稍后在记忆库重试");
    }
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

  async function runSelectionOp(kind: string) {
    const ta = textareaRef.current;
    if (!ta || !entry) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) {
      setStatus("请先用鼠标选中要处理的文字");
      return;
    }
    const provider = await ensureProvider();
    if (!provider) return;
    const base = draftText;
    const selected = base.slice(start, end);
    const messages = [
      { role: "system" as const, content: "你是资深小说编辑。只输出处理后的文字本身，不要输出任何解释、引号或前缀。" },
      {
        role: "user" as const,
        content: `【小说】《${project.title}》 ${project.description}\n\n【任务】${SELECTION_PROMPTS[kind]}\n\n【前文】\n${base.slice(Math.max(0, start - 200), start) || "（无）"}\n\n【待处理文字】\n${selected}`,
      },
    ];
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamingRef.current = true;
    setStreaming(true);
    setStatus("正在处理选中内容…");
    let acc = "";
    try {
      await streamChat({
        config: provider,
        messages,
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
      {/* 章节目录 */}
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-stone-200 bg-stone-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-stone-500">章节目录</h3>
          <span className="text-xs text-stone-400">{outline.chapters.length} 章</span>
        </div>
        {outline.chapters.length === 0 && (
          <p className="text-xs text-stone-400">还没有章节，去「大纲」页添加章节并写细纲。</p>
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

      {/* 编辑区 */}
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

            {/* 风格选择 */}
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
                      setSelectedStyleIds(
                        active ? selectedStyleIds.filter((id) => id !== s.id) : [...selectedStyleIds, s.id],
                      )
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

            {/* 工具栏 */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
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
                    onClick={() => runGeneration()}
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
                  <button
                    onClick={runPreview}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
                  >
                    预览提示词
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
                  onClick={() => runSelectionOp(k)}
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
                  onClick={() => runGeneration(feedback.trim() || undefined)}
                  className="mt-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500"
                >
                  按意见重新生成
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
              placeholder="点「生成本章」让 AI 按记忆库与风格写作；或直接在此输入。草稿会自动保存。"
              value={draftText}
              onChange={(e) => onDraftChange(e.target.value)}
            />
          </>
        )}
      </div>

      {/* 提示词预览 */}
      {showPreviewModal && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPreviewModal(false)}>
          <div
            className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
              <h2 className="font-medium">提示词预览与编辑（下方内容可直接修改，改完可直接生成）</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowPreviewModal(false);
                    runGeneration(undefined, { system: editSystem, user: editUser });
                  }}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500"
                >
                  按此提示词生成本章
                </button>
                <button onClick={() => setShowPreviewModal(false)} className="text-sm text-stone-400 hover:text-stone-700">
                  关闭
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 text-xs">
              <h3 className="mb-1 font-medium text-purple-700">System（可编辑）</h3>
              <textarea
                className="mb-4 min-h-64 w-full resize-y whitespace-pre-wrap rounded-lg bg-purple-50 p-3 font-mono leading-relaxed text-stone-800 outline-none focus:ring-1 focus:ring-purple-400"
                value={editSystem}
                onChange={(e) => setEditSystem(e.target.value)}
              />
              <h3 className="mb-1 font-medium text-blue-700">User（可编辑）</h3>
              <textarea
                className="min-h-96 w-full resize-y whitespace-pre-wrap rounded-lg bg-blue-50 p-3 font-mono leading-relaxed text-stone-800 outline-none focus:ring-1 focus:ring-blue-400"
                value={editUser}
                onChange={(e) => setEditUser(e.target.value)}
              />
              <p className="mt-3 text-stone-400">编辑后的提示词仅本次生成生效；生成历史会完整记录实际发送的内容。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
