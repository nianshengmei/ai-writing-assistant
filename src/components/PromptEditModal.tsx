"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/types";

/**
 * 通用提示词编辑弹窗：任何 AI 任务执行前都先经此弹窗，
 * 提示词可见、可编辑，按「执行」后用编辑后的提示词调用模型。
 */
export default function PromptEditModal({
  title,
  messages,
  onCancel,
  onRun,
}: {
  title: string;
  messages: ChatMessage[];
  onCancel: () => void;
  onRun: (finalMessages: ChatMessage[]) => void;
}) {
  const [draft, setDraft] = useState<ChatMessage[]>(messages);

  function update(i: number, content: string) {
    setDraft(draft.map((m, idx) => (idx === i ? { ...m, content } : m)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-stone-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">提示词（可编辑）— {title}</h2>
          <button onClick={onCancel} className="text-sm text-stone-400 hover:text-stone-700">
            取消
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {draft.map((m, i) => (
            <div key={i} className="mb-4">
              <p className={`mb-1 text-xs font-medium ${m.role === "system" ? "text-purple-700" : "text-blue-700"}`}>
                {m.role === "system" ? "System" : "User"}
              </p>
              <textarea
                className="min-h-32 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs leading-relaxed"
                value={m.content}
                onChange={(e) => update(i, e.target.value)}
              />
            </div>
          ))}
          <p className="text-xs text-stone-400">修改后直接执行，本次任务将使用下方编辑后的提示词。</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3">
          <button onClick={onCancel} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">
            取消
          </button>
          <button
            onClick={() => onRun(draft)}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700"
          >
            执行
          </button>
        </div>
      </div>
    </div>
  );
}
