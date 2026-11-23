"use client";

import { useEffect, useRef, useState } from "react";
import {
  getOutline,
  addChapterEntry,
  updateOutlineEntry,
  removeChapterEntry,
  moveChapter,
  listRecap,
  getStoryArc,
  getOutlineChat,
  saveOutlineChat,
  clearOutlineChat,
  mergeOutlineChapters,
} from "@/lib/library";
import { useFeatureModel } from "@/lib/useProviderSelection";
import { streamChat, chatOnce } from "@/lib/llm";
import { buildOutlineChatMessages, buildOutlineFinalizeMessages, buildOutlineProposeMessages } from "@/lib/context";
import { appendExtra, OUTLINE_CHAT_SYSTEM, OUTLINE_FINALIZE_SYSTEM, OUTLINE_PROPOSE_SYSTEM } from "@/lib/prompts";
import { parseJsonLoose } from "@/lib/json";
import ModelPicker from "./ModelPicker";
import PromptConfirmModal, { type PromptConfirmPayload } from "./PromptConfirmModal";
import type { ProjectDoc, OutlineEntry, OutlineChatMessage, RecapEntry, StoryArcDoc } from "@/lib/types";

type Tab = "outline" | "chat";

export default function OutlinePanel({ project, onChanged }: { project: ProjectDoc; onChanged: () => void }) {
  const workId = project.id;
  const [tab, setTab] = useState<Tab>("outline");
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [recap, setRecap] = useState<RecapEntry[]>([]);
  const [storyArc, setStoryArc] = useState<StoryArcDoc | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [proposal, setProposal] = useState("");
  const [tick, setTick] = useState(0);

  const [messages, setMessages] = useState<OutlineChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatConfirmed, setChatConfirmed] = useState(false);
  const chatBoxRef = useRef<HTMLDivElement>(null);

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

  const outlineModel = useFeatureModel("outline");
  const chatModel = useFeatureModel("outline-chat");
  const finalizeModel = useFeatureModel("outline-finalize");

  useEffect(() => {
    getOutline(workId).then((o) => setEntries(o.chapters));
    listRecap(workId).then(setRecap);
    getStoryArc(workId).then(setStoryArc);
  }, [workId, tick]);

  useEffect(() => {
    getOutlineChat(workId).then((d) => setMessages(d.messages));
  }, [workId]);

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [messages, chatStreaming]);

  const reload = () => setTick((t) => t + 1);

  function ensureProvider(p: { apiKey?: string } | null) {
    if (!p || !p.apiKey) {
      setStatus({ text: "失败：请先在右上角 ⚙ 设置 → 模型 中添加模型，并在本页选择", ok: false });
      return false;
    }
    return true;
  }

  async function add() {
    await addChapterEntry(workId, newTitle.trim(), "");
    setNewTitle("");
    reload();
    onChanged();
  }

  // ---------- 单章 AI 续推（弹窗确认后流式） ----------
  function propose(index: number, entry: OutlineEntry) {
    if (!ensureProvider(outlineModel.picked)) return;
    const msgs = buildOutlineProposeMessages({ project, entries, targetIndex: index, recap, systemOverride: undefined });
    setPromptModal({
      featureKey: "outline",
      title: `AI 续推细纲 · ${entry.title}`,
      system: msgs[0].content,
      user: msgs[msgs.length - 1].content,
      defaultSystem: OUTLINE_PROPOSE_SYSTEM,
      meta: "确认后会流式生成单章细纲建议，采用前不会写入大纲",
      confirmLabel: "开始续推",
      onConfirm: async (p) => {
        setPromptModal(null);
        setProposingId(entry.chId);
        setProposal("");
        setStatus({ text: "正在续推细纲…", ok: true });
        const provider = outlineModel.picked;
        if (!provider) return;
        try {
          await streamChat({
            config: provider,
            messages: [
              { role: "system", content: p.system },
              { role: "user", content: appendExtra(p.user, p.extra) },
            ],
            onDelta: (d) => setProposal((prev) => prev + d),
          });
          setStatus(null);
        } catch (e) {
          setStatus({ text: `续推失败：${(e as Error)?.message ?? e}`, ok: false });
        }
      },
    });
  }

  async function adopt(entry: OutlineEntry) {
    const old = entries.find((x) => x.chId === entry.chId)?.outline ?? "";
    // 整合：原细纲非空时保留原文，AI 建议追加为新段落，不覆盖
    const merged = old.trim() ? `${old}\n\n【AI 补充建议】\n${proposal}` : proposal;
    await updateOutlineEntry(workId, entry.chId, { outline: merged });
    setProposingId(null);
    setProposal("");
    reload();
    onChanged();
  }

  // ---------- 大纲讨论 ----------
  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatStreaming) return;
    if (!ensureProvider(chatModel.picked)) return;

    if (!chatConfirmed) {
      const msgs = buildOutlineChatMessages({
        project,
        entries,
        recap,
        storyArc,
        history: messages,
        userInput: text,
      });
      setPromptModal({
        featureKey: "outline-chat",
        title: "大纲讨论 · 确认提示词",
        system: msgs[0].content,
        user: text,
        defaultSystem: `${OUTLINE_CHAT_SYSTEM}\n\n（上下文会随每次请求自动附加）`,
        meta: "首次确认后本次会话不再弹窗；随时可用右上角「讨论提示词」重新编辑",
        confirmLabel: "发送",
        onConfirm: async (p) => {
          setPromptModal(null);
          setChatConfirmed(true);
          setChatInput("");
          await runChat(p.system, p.user, p.extra);
        },
      });
      return;
    }

    setChatInput("");
    await runChat(undefined, text, undefined);
  }

  async function runChat(systemOverride: string | undefined, userText: string, extra?: string) {
    const provider = chatModel.picked;
    if (!provider) return;
    const userMsg: OutlineChatMessage = { role: "user", content: userText, at: Date.now() };
    const history = messages;
    const withUser = [...history, userMsg];
    setMessages([...withUser, { role: "assistant", content: "", at: Date.now() }]);
    setChatStreaming(true);

    const msgs = buildOutlineChatMessages({
      project,
      entries,
      recap,
      storyArc,
      history,
      userInput: appendExtra(userText, extra),
      systemOverride,
    });

    let acc = "";
    try {
      await streamChat({
        config: provider,
        messages: msgs,
        onDelta: (d) => {
          acc += d;
          setMessages([...withUser, { role: "assistant", content: acc, at: Date.now() }]);
        },
      });
      const final: OutlineChatMessage[] = [...withUser, { role: "assistant", content: acc, at: Date.now() }];
      setMessages(final);
      await saveOutlineChat(workId, final);
    } catch (e) {
      setStatus({ text: `讨论失败：${(e as Error)?.message ?? e}`, ok: false });
      setMessages(withUser);
      await saveOutlineChat(workId, withUser);
    } finally {
      setChatStreaming(false);
    }
  }

  function openChatPromptEditor() {
    const msgs = buildOutlineChatMessages({
      project,
      entries,
      recap,
      storyArc,
      history: messages,
      userInput: chatInput || "（在这里输入本轮问题）",
    });
    setPromptModal({
      featureKey: "outline-chat",
      title: "讨论提示词（可编辑并保存）",
      system: msgs[0].content,
      user: chatInput,
      defaultSystem: `${OUTLINE_CHAT_SYSTEM}\n\n（上下文会随每次请求自动附加）`,
      meta: "System 与补充要求会按功能保存；User 是这一轮的提问",
      confirmLabel: "保存并继续讨论",
      onConfirm: async (p) => {
        setPromptModal(null);
        setChatConfirmed(true);
        setChatInput("");
        if (p.user.trim()) await runChat(p.system, p.user, p.extra);
      },
    });
  }

  // ---------- 敲定并生成大纲 ----------
  function finalize() {
    if (!ensureProvider(finalizeModel.picked)) return;
    const discussion = messages
      .map((m) => `${m.role === "user" ? "作者" : "策划"}：${m.content}`)
      .join("\n\n");
    if (!discussion.trim()) {
      setStatus({ text: "还没有讨论内容，先在讨论区聊出结论再敲定", ok: false });
      return;
    }
    const msgs = buildOutlineFinalizeMessages({
      project,
      entries,
      recap,
      storyArc,
      discussion,
      systemOverride: undefined,
    });
    setPromptModal({
      featureKey: "outline-finalize",
      title: "敲定并生成大纲",
      system: msgs[0].content,
      user: msgs[msgs.length - 1].content,
      defaultSystem: OUTLINE_FINALIZE_SYSTEM,
      meta: "已有章节的标题与细纲会被整合保留，新章节追加在末尾",
      confirmLabel: "生成并写入大纲",
      onConfirm: async (p) => {
        setPromptModal(null);
        const provider = finalizeModel.picked;
        if (!provider) return;
        setStatus({ text: "正在整理大纲…", ok: true });
        try {
          const out = await chatOnce(provider, [
            { role: "system", content: p.system },
            { role: "user", content: appendExtra(p.user, p.extra) },
          ]);
          const parsed = parseJsonLoose<{ chapters?: { title?: string; outline?: string }[] }>(out);
          if (!parsed?.chapters?.length) {
            setStatus({ text: "解析失败：模型没有返回合法的大纲 JSON，可查看讨论记录后重试", ok: false });
            return;
          }
          const { added, updated } = await mergeOutlineChapters(
            workId,
            parsed.chapters.map((c) => ({ title: c.title ?? "", outline: c.outline ?? "" })),
          );
          setStatus({ text: `大纲已写入：新增 ${added} 章，更新 ${updated} 章（原有细纲已整合保留）`, ok: true });
          reload();
          onChanged();
          setTab("outline");
        } catch (e) {
          setStatus({ text: `生成失败：${(e as Error)?.message ?? e}`, ok: false });
        }
      },
    });
  }

  const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm";
  const btn = "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-5 py-2.5">
        <div className="flex gap-1">
          {(
            [
              ["outline", "章节细纲"],
              ["chat", "AI 讨论"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "outline" ? (
          <>
            <input
              className={`${input} ml-2 w-56`}
              placeholder="新章节标题（可留空自动编号）"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button onClick={add} className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-700">
              + 添加章节
            </button>
            <span className="ml-auto self-center text-xs text-stone-400">AI 续推使用：</span>
            <ModelPicker providers={outlineModel.providers} value={outlineModel.selectedId} onChange={outlineModel.select} />
          </>
        ) : (
          <>
            <span className="ml-2 self-center text-xs text-stone-400">讨论使用：</span>
            <ModelPicker providers={chatModel.providers} value={chatModel.selectedId} onChange={chatModel.select} />
            <button onClick={openChatPromptEditor} className={btn} disabled={chatStreaming}>
              讨论提示词
            </button>
            <button
              onClick={async () => {
                if (!confirm("清空大纲讨论记录？大纲本身不受影响。")) return;
                await clearOutlineChat(workId);
                setMessages([]);
                setStatus({ text: "讨论记录已清空", ok: true });
              }}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500"
              disabled={chatStreaming}
            >
              清空讨论
            </button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-stone-400">敲定使用：</span>
              <ModelPicker providers={finalizeModel.providers} value={finalizeModel.selectedId} onChange={finalizeModel.select} />
              <button onClick={finalize} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500" disabled={chatStreaming}>
                敲定并生成大纲
              </button>
            </div>
          </>
        )}
      </div>

      {status && (
        <p
          className={`mx-5 mt-2 whitespace-pre-wrap break-all text-xs ${
            status.ok ? "text-stone-500" : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700"
          }`}
        >
          {status.text}
        </p>
      )}

      {tab === "outline" && (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {entries.length === 0 && (
            <p className="text-sm text-stone-400">还没有章节。可以手动添加，或去「AI 讨论」聊出走向后一键敲定大纲。</p>
          )}
          {entries.map((e, i) => (
            <div key={e.chId} className="mb-3 rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-stone-400">{e.chId.replace("ch-", "")}</span>
                <input
                  className={`${input} w-56`}
                  value={e.title}
                  onChange={(ev) => setEntries(entries.map((x) => (x.chId === e.chId ? { ...x, title: ev.target.value } : x)))}
                  onBlur={async (ev) => {
                    await updateOutlineEntry(workId, e.chId, { title: ev.target.value });
                    onChanged();
                  }}
                />
                {e.approved && <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">已采纳</span>}
                <div className="ml-auto flex gap-1">
                  <button onClick={() => propose(i, e)} className={btn}>
                    AI 续推
                  </button>
                  <button
                    onClick={async () => {
                      await moveChapter(workId, e.chId, -1);
                      reload();
                    }}
                    className={btn}
                  >
                    ↑
                  </button>
                  <button
                    onClick={async () => {
                      await moveChapter(workId, e.chId, 1);
                      reload();
                    }}
                    className={btn}
                  >
                    ↓
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`删除「${e.title}」？其草稿与正式章节文件将一并删除。`)) return;
                      await removeChapterEntry(workId, e.chId);
                      reload();
                      onChanged();
                    }}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500"
                  >
                    删除
                  </button>
                </div>
              </div>
              <textarea
                className={`${input} min-h-16 w-full`}
                placeholder="本章细纲：核心冲突、推进点、章末钩子…"
                value={e.outline}
                onChange={(ev) => setEntries(entries.map((x) => (x.chId === e.chId ? { ...x, outline: ev.target.value } : x)))}
                onBlur={async (ev) => {
                  await updateOutlineEntry(workId, e.chId, { outline: ev.target.value });
                }}
              />
              {proposingId === e.chId && (
                <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50 p-3">
                  <p className="mb-1 text-xs font-medium text-purple-700">AI 续推建议（采用时会整合进原细纲，不覆盖）</p>
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed">{proposal || "生成中…"}</pre>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => adopt(e)} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white">
                      采用并整合
                    </button>
                    <button onClick={() => setProposingId(null)} className={btn}>
                      放弃
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "chat" && (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div ref={chatBoxRef} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4">
            {messages.length === 0 && (
              <p className="text-sm text-stone-400">
                跟 AI 聊这本书该怎么走：可以问「前三章怎么铺垫」「主角的动机够不够」，聊到满意再点右上角「敲定并生成大纲」。
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === "user" ? "bg-amber-100 text-stone-800" : "bg-stone-100 text-stone-700"
                  }`}
                >
                  {m.content || (chatStreaming && i === messages.length - 1 ? "思考中…" : "")}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <textarea
              className={`${input} min-h-12 flex-1 resize-none`}
              placeholder="说说你的想法，Enter 换行，Ctrl/⌘+Enter 发送"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              disabled={chatStreaming}
            />
            <button
              onClick={() => sendChat()}
              disabled={chatStreaming || !chatInput.trim()}
              className="self-end rounded-lg bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700 disabled:opacity-40"
            >
              {chatStreaming ? "回复中…" : "发送"}
            </button>
          </div>
          <p className="mt-1 text-xs text-stone-400">
            讨论记录会保存在作品目录（outline-chat.json），每次请求都带完整上下文；敲定生成前也可手动编辑细纲。
          </p>
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
