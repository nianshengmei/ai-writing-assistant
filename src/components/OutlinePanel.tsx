"use client";

import { useEffect, useState } from "react";
import {
  getOutline,
  saveOutline,
  addChapterEntry,
  updateOutlineEntry,
  removeChapterEntry,
  moveChapter,
} from "@/lib/library";
import type { ProjectDoc, OutlineEntry, WorkTag } from "@/lib/types";

export default function OutlinePanel({ project, onChanged }: { project: ProjectDoc; onChanged: () => void }) {
  const workId = project.id;
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [workTags, setWorkTagsState] = useState<WorkTag[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    getOutline(workId).then((o) => {
      setEntries(o.chapters);
      setWorkTagsState(o.tags ?? []);
    });
  }, [workId, tick]);

  const reload = () => setTick((t) => t + 1);

  async function add() {
    await addChapterEntry(workId, newTitle.trim(), "");
    setNewTitle("");
    reload();
    onChanged();
  }

  const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm";
  const btn = "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex gap-2">
        <input
          className={`${input} w-64`}
          placeholder="新章节标题（可留空自动编号）"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-700">
          + 添加章节
        </button>
        <span className="self-center text-xs text-stone-400">AI 续推细纲已移至「AI讨论」页</span>
        {status && (
          <span
            className={`self-center whitespace-pre-wrap break-all text-xs ${
              status.ok ? "text-stone-500" : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700"
            }`}
          >
            {status.text}
          </span>
        )}
      </div>

      {entries.length === 0 && <p className="text-sm text-stone-400">还没有章节。先添加章节，再为每章填写细纲（生成正文时的核心依据）。AI 续推细纲请到「AI讨论」页。</p>}

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
            {(e.tags ?? [])
              .map((id) => workTags.find((t) => t.id === id))
              .filter((t): t is WorkTag => !!t)
              .sort((a, b) => b.priority - a.priority)
              .slice(0, 3)
              .map((t) => (
                <span
                  key={t.id}
                  className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${
                    t.id === "tag-discard"
                      ? "bg-red-50 text-red-500"
                      : t.id === "tag-main"
                        ? "bg-green-50 text-green-600"
                        : "bg-purple-50 text-purple-600"
                  }`}
                >
                  {t.name}
                </span>
              ))}
            <div className="ml-auto flex gap-1">
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
        </div>
      ))}
    </div>
  );
}
