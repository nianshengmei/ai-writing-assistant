"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 生成过程流式渲染弹窗：实时显示模型输出（含推理模型的思考过程），
 * 让"正在生成"全程可见；生成完成后自动进入下一步（对比确认）。
 */
export default function StreamingGenModal({
  title,
  raw,
  reasoning,
  running,
  error,
  notice,
  onStop,
  onClose,
}: {
  title: string;
  /** 已生成的正文（流式累积） */
  raw: string;
  /** 推理模型的思考过程（折叠展示） */
  reasoning: string;
  /** 是否仍在生成 */
  running: boolean;
  /** 生成结束后的错误文本（内嵌展示；独立的失败弹窗由父组件控制） */
  error: string | null;
  /** 底部固定提示文案 */
  notice: string;
  onStop: () => void;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [raw, reasoning]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-stone-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">
            生成中 — {title}
            <span className="ml-2 text-xs text-stone-400">
              {running ? `已输出 ${raw.length} 字，请稍候…` : raw.length ? `共 ${raw.length} 字` : ""}
            </span>
          </h2>
          <button onClick={running ? onStop : onClose} className={`text-sm ${running ? "text-red-500 hover:text-red-600" : "text-stone-400 hover:text-stone-700"}`}>
            {running ? "停止" : "关闭"}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5" ref={scrollRef}>
          {reasoning && (
            <details className="mb-3 rounded-lg border border-stone-200 bg-stone-100/60 px-3 py-2" open={!fold && running}>
              <summary
                className="cursor-pointer select-none text-xs text-stone-400"
                onClick={(e) => {
                  e.preventDefault();
                  setFold((v) => !v);
                }}
              >
                💭 思考过程{running && !raw ? "（进行中）" : ""}
              </summary>
              <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs italic leading-relaxed text-stone-400">
                {reasoning || "…"}
              </div>
            </details>
          )}
          <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-stone-700">
            {raw || (running ? "等待模型返回…" : "")}
            {running && <span className="animate-pulse">▍</span>}
          </div>
          {error && (
            <p className="mt-3 whitespace-pre-wrap break-all rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          {!running && !error && (
            <p className="mt-3 text-xs text-stone-400">生成完成，正在解析结果并打开对比窗口…</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-stone-200 px-5 py-3">
          <p className="text-xs text-stone-400">{notice}</p>
          {running ? (
            <button onClick={onStop} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
              停止生成
            </button>
          ) : (
            <button onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
