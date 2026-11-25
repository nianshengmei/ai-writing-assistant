"use client";

import { useEffect, useRef } from "react";

/** 原记忆 vs 新记忆 对比确认弹窗：作者点「合并」才落盘 */
export default function MemoryCompareModal({
  title,
  original,
  proposed,
  mergeLabel = "合并确认",
  onCancel,
  onMerge,
}: {
  title: string;
  original: string;
  proposed: string;
  mergeLabel?: string;
  onCancel: () => void;
  onMerge: () => void;
}) {
  const originalRef = useRef<HTMLPreElement>(null);
  const proposedRef = useRef<HTMLPreElement>(null);

  // 两栏滚动同步
  useEffect(() => {
    const a = originalRef.current;
    const b = proposedRef.current;
    if (!a || !b) return;
    let lock = false;
    const sync = (from: HTMLElement, to: HTMLElement) => () => {
      if (lock) return;
      lock = true;
      to.scrollTop = from.scrollTop;
      lock = false;
    };
    const h1 = () => sync(a, b)();
    const h2 = () => sync(b, a)();
    a.addEventListener("scroll", h1);
    b.addEventListener("scroll", h2);
    return () => {
      a.removeEventListener("scroll", h1);
      b.removeEventListener("scroll", h2);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-stone-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">{title}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onMerge}
              className="rounded-lg bg-green-700 px-4 py-1.5 text-xs text-white hover:bg-green-600"
            >
              ✓ {mergeLabel}
            </button>
            <button onClick={onCancel} className="text-sm text-stone-400 hover:text-stone-700">
              放弃
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-0 overflow-hidden">
          <div className="flex min-h-0 flex-col border-r border-stone-200">
            <div className="bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500">原记忆（保留现状）</div>
            <pre
              ref={originalRef}
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed text-stone-600"
            >
              {original}
            </pre>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="bg-green-50 px-4 py-2 text-xs font-medium text-green-700">AI 整合结果（含原记忆+讨论变更）</div>
            <pre
              ref={proposedRef}
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed text-stone-800"
            >
              {proposed}
            </pre>
          </div>
        </div>
        <p className="border-t border-stone-200 px-5 py-2 text-xs text-stone-400">
          提示词默认携带原记忆，讨论未涉及的内容会原样保留。确认合并后才会写入；如不满意可点「放弃」重新生成。
        </p>
      </div>
    </div>
  );
}
