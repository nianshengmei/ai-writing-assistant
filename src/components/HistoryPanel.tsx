"use client";

import { useEffect, useState } from "react";
import { listGenerations, saveDraft, updateGenerationStatus } from "@/lib/library";
import type { ProjectDoc, GenerationRecord } from "@/lib/types";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: "草稿", cls: "bg-amber-50 text-amber-700" },
  approved: { text: "已采纳", cls: "bg-green-50 text-green-700" },
  discarded: { text: "已放弃", cls: "bg-stone-100 text-stone-500" },
};

export default function HistoryPanel({ project, onChanged }: { project: ProjectDoc; onChanged: () => void }) {
  const workId = project.id;
  const [records, setRecords] = useState<GenerationRecord[]>([]);
  const [filterCh, setFilterCh] = useState("");
  const [selected, setSelected] = useState<GenerationRecord | null>(null);
  const [status, setStatus] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    listGenerations(workId).then(setRecords);
  }, [workId, tick]);

  const filtered = filterCh ? records.filter((r) => r.chId === filterCh) : records;
  const chIds = [...new Set(records.map((r) => r.chId))];

  async function restoreToDraft(rec: GenerationRecord) {
    await saveDraft(workId, rec.chId, rec.output, rec.id);
    setStatus(`已将 ${rec.id} 的输出恢复为 ${rec.chId} 的当前草稿`);
    onChanged();
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-96 shrink-0 overflow-y-auto border-r border-stone-200 p-4">
        <div className="mb-3 flex items-center gap-2">
          <select className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs" value={filterCh} onChange={(e) => setFilterCh(e.target.value)}>
            <option value="">全部章节</option>
            {chIds.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button onClick={() => setTick((t) => t + 1)} className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs hover:bg-stone-50">
            刷新
          </button>
        </div>
        {filtered.length === 0 && <p className="text-xs text-stone-400">暂无生成记录（每次生成会自动落盘）。</p>}
        {filtered.map((r) => {
          const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.draft;
          return (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              className={`mb-2 block w-full rounded-xl border p-3 text-left ${
                selected?.id === r.id ? "border-amber-400 bg-amber-50" : "border-stone-200 bg-stone-50 hover:border-stone-400"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-stone-400">
                <span className="font-mono">{r.id}</span>
                <span className={`rounded px-1.5 py-0.5 ${s.cls}`}>{s.text}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-stone-600">{r.output.slice(0, 120) || "（空输出）"}</p>
              <p className="mt-1 text-xs text-stone-400">
                {r.chId} · {r.providerName}/{r.model} · {new Date(r.createdAt).toLocaleString("zh-CN")}
                {r.styleIds.length > 0 && ` · ${r.styleIds.length} 条风格`}
              </p>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!selected ? (
          <p className="text-sm text-stone-400">选择左侧记录查看当时的完整提示词与输出。</p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="font-medium">{selected.id}</h3>
              <span className={`rounded px-2 py-0.5 text-xs ${(STATUS_LABEL[selected.status] ?? STATUS_LABEL.draft).cls}`}>
                {(STATUS_LABEL[selected.status] ?? STATUS_LABEL.draft).text}
              </span>
              <button
                onClick={async () => {
                  await updateGenerationStatus(workId, selected.id, "discarded");
                  setTick((t) => t + 1);
                }}
                className="ml-auto rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50"
              >
                标记为已放弃
              </button>
              <button
                onClick={() => restoreToDraft(selected)}
                className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700"
              >
                恢复为当前草稿
              </button>
            </div>
            <p className="mb-3 text-xs text-stone-400">
              {selected.chId} · {selected.providerName}/{selected.model}
              {selected.feedback ? ` · 作者意见：${selected.feedback}` : ""}
            </p>
            {status && <p className="mb-3 text-xs text-green-700">{status}</p>}
            <h4 className="mb-1 text-xs font-medium text-purple-700">当时的 System 提示词</h4>
            <pre className="mb-4 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-purple-50 p-3 text-xs leading-relaxed">{selected.prompt.system}</pre>
            <h4 className="mb-1 text-xs font-medium text-blue-700">当时的 User 提示词</h4>
            <pre className="mb-4 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-xs leading-relaxed">{selected.prompt.user}</pre>
            <h4 className="mb-1 text-xs font-medium text-green-700">模型输出</h4>
            <pre className="whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm leading-relaxed">{selected.output}</pre>
          </>
        )}
      </div>
    </div>
  );
}
