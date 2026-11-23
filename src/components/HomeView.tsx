"use client";

import { useEffect, useState } from "react";
import { listWorks, createWork, deleteWork, type WorkBrief } from "@/lib/library";
import SettingsModal from "./SettingsModal";
import StyleLibraryModal from "./StyleLibraryModal";

export default function HomeView({ onOpen }: { onOpen: (id: string) => void }) {
  const [works, setWorks] = useState<WorkBrief[]>([]);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", genre: "", description: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listWorks()
      .then((w) => alive && setWorks(w))
      .catch((e) => alert(`加载作品失败：${e?.message ?? e}\n若是桌面端首次使用，请先在设置中选择数据目录。`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);

  async function handleCreate() {
    if (!form.title.trim()) return;
    await createWork(form.title.trim(), form.genre.trim(), form.description.trim());
    setForm({ title: "", genre: "", description: "" });
    setAdding(false);
    refresh();
  }

  async function handleDelete(w: WorkBrief) {
    if (!confirm(`确定删除《${w.title}》？\n其全部章节、记忆库、生成历史将被永久删除，且无法恢复。`)) return;
    await deleteWork(w.id);
    refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">AI 写作助手</h1>
          <p className="mt-1 text-sm text-stone-500">记忆库 · 风格库 · 草稿工作流 · 生成历史全程落盘可追溯</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setStylesOpen(true)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
          >
            风格库
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
          >
            设置
          </button>
        </div>
      </header>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium">作品目录</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
        >
          {adding ? "取消" : "+ 新建作品"}
        </button>
      </div>

      {adding && (
        <div className="mb-6 rounded-xl border border-stone-200 bg-white p-4">
          <div className="grid gap-3">
            <input
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
              placeholder="书名（必填）"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <input
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
              placeholder="题材（如：玄幻 / 都市 / 科幻，可留空）"
              value={form.genre}
              onChange={(e) => setForm({ ...form, genre: e.target.value })}
            />
            <textarea
              className="min-h-20 rounded-lg border border-stone-300 px-3 py-2 text-sm"
              placeholder="作品简介：故事背景、核心设定、大致走向……（生成时作为上下文）"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div>
              <button
                onClick={handleCreate}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-500"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">加载中…</p>
      ) : works.length === 0 ? (
        <p className="text-sm text-stone-400">还没有作品，点右上角「新建作品」开始。</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {works.map((w) => (
            <div
              key={w.id}
              className="group cursor-pointer rounded-xl border border-stone-200 bg-white p-4 transition hover:border-amber-400"
              onClick={() => onOpen(w.id)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{w.title}</h3>
                  {w.genre && <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">{w.genre}</span>}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(w);
                  }}
                  className="text-xs text-stone-400 opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                >
                  删除
                </button>
              </div>
              <p className="mt-2 text-xs text-stone-400">更新于 {new Date(w.updatedAt).toLocaleString("zh-CN")}</p>
            </div>
          ))}
        </div>
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onChanged={refresh} />}
      {stylesOpen && <StyleLibraryModal onClose={() => setStylesOpen(false)} />}
    </div>
  );
}
