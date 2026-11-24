"use client";

import { useEffect, useRef, useState } from "react";
import {
  getOutline,
  getProtagonist,
  listCharacters,
  listWorldview,
  saveProtagonist,
  saveCharacters,
  saveWorldview,
  addChapterEntry,
  updateOutlineEntry,
} from "@/lib/library";
import { streamChat, chatOnce } from "@/lib/llm";
import { useFeatureModel } from "@/lib/useProviderSelection";
import {
  buildDiscussMessages,
  buildProtagonistMergeMessages,
  buildCharactersMergeMessages,
  buildWorldviewMergeMessages,
  buildOutlineMergeMessages,
  lastRounds,
  extractJson,
} from "@/lib/context";
import ModelPicker from "./ModelPicker";
import PromptEditModal from "./PromptEditModal";
import MemoryCompareModal from "./MemoryCompareModal";
import type { ProjectDoc, ProtagonistDoc, CharacterEntry, WorldviewEntry, OutlineEntry, ChatMessage } from "@/lib/types";

const MAX_ROUNDS = 20;

type GenKind = "protagonist" | "characters" | "worldview" | "outline";

interface CompareState {
  kind: GenKind;
  title: string;
  original: string;
  proposed: string;
  payload: unknown;
}

export default function DiscussionPanel({ project, onChanged }: { project: ProjectDoc; onChanged: () => void }) {
  const workId = project.id;
  const dm = useFeatureModel("discuss");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** 用户多选的对话消息（索引），生成记忆/大纲时只基于勾选内容 */
  const [selected, setSelected] = useState<number[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [genCtx, setGenCtx] = useState<{ kind: GenKind; messages: ChatMessage[] } | null>(null);
  const [compare, setCompare] = useState<CompareState | null>(null);
  /** 用户手动展开/折叠的思考块（下标 → 是否展开），优先于自动行为 */
  const [manualFold, setManualFold] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function ensureProvider() {
    const provider = dm.picked;
    if (!provider || !provider.apiKey) {
      setStatus({ text: "失败：请先在右上角 ⚙ 设置 → 模型 中添加模型，并在本页选择", ok: false });
      return null;
    }
    return provider;
  }

  // ---------- 自由讨论 ----------
  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    const provider = ensureProvider();
    if (!provider) return;
    const history = lastRounds(messages, MAX_ROUNDS);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    setStatus(null);
    setManualFold({});
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      let acc = "";
      let reasoning = "";
      await streamChat({
        config: provider,
        messages: buildDiscussMessages({ project, history, userText: text }),
        signal: ctrl.signal,
        onDelta: (d) => {
          acc += d;
          setMessages([...next, { role: "assistant", content: acc, reasoning }]);
        },
        onReasoning: (d) => {
          reasoning += d;
          setMessages([...next, { role: "assistant", content: acc, reasoning }]);
        },
      });
      setMessages([...next, { role: "assistant", content: acc, reasoning }]);
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      setStatus({ text: aborted ? "已停止" : `发送失败：${(e as Error)?.message ?? e}`, ok: aborted });
      setMessages(next); // 移除空回复
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  // ---------- 生成记忆（第一步：弹出可编辑提示词） ----------
  async function openGenPrompt(kind: GenKind) {
    if (!ensureProvider()) return;
    if (generating) return;
    // 只基于用户勾选的对话消息整合；未勾选则提示
    const history = messages.filter((_, i) => selected.includes(i));
    if (!history.length) {
      setStatus({ text: "请先在对话中勾选要依据的消息（点气泡左侧方框，可多选），再点生成按钮", ok: false });
      return;
    }
    let messages2: ChatMessage[];
    if (kind === "protagonist") {
      const current = await getProtagonist(workId);
      messages2 = buildProtagonistMergeMessages({ project, current, history });
    } else if (kind === "characters") {
      const current = await listCharacters(workId);
      messages2 = buildCharactersMergeMessages({ project, current, history });
    } else if (kind === "worldview") {
      const current = await listWorldview(workId);
      messages2 = buildWorldviewMergeMessages({ project, current, history });
    } else {
      const o = await getOutline(workId);
      messages2 = buildOutlineMergeMessages({ project, entries: o.chapters, history });
    }
    setGenCtx({ kind, messages: messages2 });
  }

  // ---------- 生成记忆（第二步：按编辑稿生成 → 解析 → 对比弹窗） ----------
  const GEN_TITLES: Record<GenKind, string> = {
    protagonist: "主角记忆",
    characters: "配角记忆",
    worldview: "世界观",
    outline: "章节大纲",
  };

  function fmtProtagonist(c: ProtagonistDoc): string {
    return `姓名：${c.name || "（空）"}\n别名：${c.aliases || "（空）"}\n人设：${c.profile || "（空）"}\n成长线：${c.arc || "（空）"}\n备注：${c.notes || "（空）"}`;
  }

  function fmtCharacters(list: CharacterEntry[]): string {
    return list.length
      ? list.map((c, i) => `${i + 1}. ${c.name || "（未命名）"}（${c.relation || "关系未定"}）\n   ${c.content}`).join("\n")
      : "（暂无配角记忆）";
  }

  function fmtWorldview(list: WorldviewEntry[]): string {
    return list.length
      ? list.map((w, i) => `${i + 1}. [${w.category}] ${w.name}\n   ${w.content}`).join("\n")
      : "（暂无世界观条目）";
  }

  function fmtOutline(entries: OutlineEntry[]): string {
    return entries.length
      ? entries.map((e, i) => `${i + 1}. ${e.title}${e.approved ? "（已采纳）" : ""}\n   ${e.outline || "（无细纲）"}`).join("\n")
      : "（暂无章节）";
  }

  async function runGen(messages2: ChatMessage[]) {
    const kind = genCtx?.kind;
    if (!kind) return;
    const provider = ensureProvider();
    if (!provider) return;
    setGenCtx(null);
    setGenerating(true);
    setStatus({ text: `正在整合生成${GEN_TITLES[kind]}…`, ok: true });
    try {
      const raw = await chatOnce(provider, messages2);
      const data = extractJson(raw);
      let compareState: CompareState;
      if (kind === "protagonist") {
        const old = await getProtagonist(workId);
        const next = data as ProtagonistDoc;
        compareState = {
          kind,
          title: "主角记忆：原记忆 vs 整合结果",
          original: fmtProtagonist(old),
          proposed: fmtProtagonist(next),
          payload: next,
        };
      } else if (kind === "characters") {
        const old = await listCharacters(workId);
        const next = (Array.isArray(data) ? data : []).map((c: Partial<CharacterEntry>) => ({
          id: "",
          name: String(c.name ?? ""),
          relation: String(c.relation ?? ""),
          content: String(c.content ?? ""),
        }));
        compareState = {
          kind,
          title: "配角记忆：原记忆 vs 整合结果",
          original: fmtCharacters(old),
          proposed: fmtCharacters(next),
          payload: next,
        };
      } else if (kind === "worldview") {
        const old = await listWorldview(workId);
        const next = (Array.isArray(data) ? data : []).map((w: Partial<WorldviewEntry>) => ({
          id: "",
          category: String(w.category ?? "其他"),
          name: String(w.name ?? ""),
          content: String(w.content ?? ""),
        }));
        compareState = {
          kind,
          title: "世界观：原记忆 vs 整合结果",
          original: fmtWorldview(old),
          proposed: fmtWorldview(next),
          payload: next,
        };
      } else {
        const o = await getOutline(workId);
        const next = (Array.isArray(data) ? data : []).map((e: { chId?: string | null; title?: string; outline?: string }) => ({
          chId: e.chId && o.chapters.some((c) => c.chId === e.chId) ? e.chId : null,
          title: String(e.title ?? ""),
          outline: String(e.outline ?? ""),
        }));
        compareState = {
          kind,
          title: "章节大纲：原大纲 vs 整合结果（新增章节将自动创建）",
          original: fmtOutline(o.chapters),
          proposed: fmtOutline(
            next.map((e, i) => ({
              chId: e.chId ?? `new-${i + 1}`,
              title: e.title,
              outline: e.outline,
              approved: false,
            })),
          ),
          payload: next,
        };
      }
      setStatus(null);
      setCompare(compareState);
    } catch (e) {
      setStatus({ text: `整合失败：${(e as Error)?.message ?? e}（可点「放弃」修改提示词重试）`, ok: false });
    } finally {
      setGenerating(false);
    }
  }

  // ---------- 合并确认（作者点头才落盘） ----------
  async function merge() {
    if (!compare) return;
    const { kind, payload } = compare;
    try {
      if (kind === "protagonist") {
        await saveProtagonist(workId, payload as ProtagonistDoc);
      } else if (kind === "characters") {
        const list = payload as CharacterEntry[];
        await saveCharacters(workId, list.map((c) => ({ ...c, id: c.id || uidLike() })));
      } else if (kind === "worldview") {
        const list = payload as WorldviewEntry[];
        await saveWorldview(workId, list.map((w) => ({ ...w, id: w.id || uidLike() })));
      } else {
        const list = payload as { chId: string | null; title: string; outline: string }[];
        for (const item of list) {
          if (item.chId) {
            await updateOutlineEntry(workId, item.chId, { title: item.title, outline: item.outline });
          } else {
            await addChapterEntry(workId, item.title, item.outline);
          }
        }
      }
      setStatus({ text: `${GEN_TITLES[kind]}已合并写入`, ok: true });
      setCompare(null);
      onChanged();
    } catch (e) {
      setStatus({ text: `合并写入失败：${(e as Error)?.message ?? e}`, ok: false });
    }
  }

  function uidLike(): string {
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const GEN_BUTTONS: { kind: GenKind; label: string }[] = [
    { kind: "outline", label: "生成大纲" },
    { kind: "worldview", label: "生成世界观" },
    { kind: "characters", label: "生成配角记忆" },
    { kind: "protagonist", label: "生成主角记忆" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-4 py-2">
        <span className="text-xs text-stone-400">讨论使用：</span>
        <ModelPicker providers={dm.providers} value={dm.selectedId} onChange={dm.select} disabled={streaming || generating} />
        <span className="mx-2 h-4 w-px bg-stone-200" />
        <span className="text-xs text-stone-400">已勾选 {selected.length} 条</span>
        {selected.length > 0 && (
          <button
            onClick={() => setSelected([])}
            className="rounded-lg border border-stone-200 px-2 py-1 text-xs text-stone-400 hover:bg-stone-50"
          >
            取消勾选
          </button>
        )}
        <span className="mx-2 h-4 w-px bg-stone-200" />
        {GEN_BUTTONS.map((b) => (
          <button
            key={b.kind}
            disabled={streaming || generating}
            onClick={() => void openGenPrompt(b.kind)}
            className="rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs text-purple-700 hover:bg-purple-100 disabled:opacity-40"
          >
            {b.label}
          </button>
        ))}
        <button
          onClick={() => {
            if (messages.length && !confirm("清空当前讨论记录？（不影响已保存的记忆）")) return;
            setMessages([]);
            setSelected([]);
          }}
          className="ml-auto rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-50"
        >
          清空讨论
        </button>
      </div>

      {status && (
        <p
          className={`mx-4 mt-2 whitespace-pre-wrap break-all rounded-lg px-3 py-2 text-xs ${
            status.ok ? "text-stone-500" : "border border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {status.text}
        </p>
      )}

      {/* 对话区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="mt-8 text-center text-sm text-stone-400">
            <p>在这里和 AI 讨论剧情、大纲、世界观与人物设定（对话携带最近 {MAX_ROUNDS} 轮历史）。</p>
            <p className="mt-2 text-xs">
              讨论出结论后，勾选对话中相关的消息（可多选），再点上方「生成大纲 / 世界观 / 配角记忆 / 主角记忆」，
              AI 会基于勾选内容 + 原记忆整合，弹窗对比确认后才写入。
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <label
              className="mr-2 flex cursor-pointer items-start pt-1.5"
              title="勾选后可作为生成记忆/大纲的依据"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-amber-600"
                checked={selected.includes(i)}
                onChange={(e) =>
                  setSelected((prev) => (e.target.checked ? [...prev, i] : prev.filter((x) => x !== i)))
                }
              />
            </label>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-amber-600 text-white"
                  : selected.includes(i)
                    ? "rounded-tl-sm border border-amber-300 bg-amber-50 text-stone-800"
                    : "rounded-tl-sm bg-stone-100 text-stone-800"
              }`}
            >
              {m.role === "assistant" && m.reasoning && (
                <details
                  open={manualFold[i] ?? (streaming && i === messages.length - 1 && !m.content)}
                  onToggle={(e) => {
                    const open = (e.target as HTMLDetailsElement).open;
                    if (open !== (streaming && i === messages.length - 1 && !m.content)) {
                      setManualFold((prev) => ({ ...prev, [i]: open }));
                    }
                  }}
                  className="mb-1.5 border-b border-stone-200 pb-1.5"
                >
                  <summary className="cursor-pointer select-none text-xs text-stone-400">
                    💭 思考过程{streaming && i === messages.length - 1 && !m.content ? "（进行中）" : ""}
                  </summary>
                  <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs italic leading-relaxed text-stone-400">
                    {m.reasoning}
                  </div>
                </details>
              )}
              {m.content || (streaming && i === messages.length - 1 ? "思考中…" : "")}
            </div>
          </div>
        ))}
      </div>

      {/* 输入区 */}
      <div className="border-t border-stone-200 bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-16 flex-1 resize-none rounded-xl border border-stone-300 px-3 py-2 text-sm"
            placeholder="和 AI 讨论剧情走向、人物设定、世界观细节…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {streaming ? (
            <button
              onClick={() => abortRef.current?.abort()}
              className="rounded-xl border border-red-300 bg-white px-4 py-2 text-sm text-red-600"
            >
              停止
            </button>
          ) : (
            <button
              disabled={!input.trim() || generating}
              onClick={() => void send()}
              className="rounded-xl bg-stone-900 px-5 py-2 text-sm text-white hover:bg-stone-700 disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>

      {/* 生成记忆：可编辑提示词弹窗 */}
      {genCtx && (
        <PromptEditModal
          title={`整合生成${GEN_TITLES[genCtx.kind]}（携带原记忆与你勾选的 ${selected.length} 条讨论记录，可直接修改）`}
          messages={genCtx.messages}
          onCancel={() => setGenCtx(null)}
          onRun={runGen}
        />
      )}

      {/* 生成完成：原记忆 vs 新记忆 对比确认 */}
      {compare && (
        <MemoryCompareModal
          title={compare.title}
          original={compare.original}
          proposed={compare.proposed}
          mergeLabel={`合并${GEN_TITLES[compare.kind]}`}
          onCancel={() => {
            setCompare(null);
            setStatus({ text: "已放弃本次整合，原记忆未改动", ok: true });
          }}
          onMerge={() => void merge()}
        />
      )}
    </div>
  );
}
