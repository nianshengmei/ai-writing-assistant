"use client";

import { useEffect, useState } from "react";
import { getProject } from "@/lib/library";
import WritingDesk from "./WritingDesk";
import MemoryPanel from "./MemoryPanel";
import OutlinePanel from "./OutlinePanel";
import HistoryPanel from "./HistoryPanel";
import ModelSelector from "./ModelSelector";
import type { ProjectDoc } from "@/lib/types";

const TABS = [
  { key: "write", label: "写作台" },
  { key: "memory", label: "记忆库" },
  { key: "outline", label: "大纲" },
  { key: "history", label: "生成历史" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ProjectView({ workId, onBack }: { workId: string; onBack: () => void }) {
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [tab, setTab] = useState<TabKey>("write");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    getProject(workId).then(setProject);
  }, [workId, tick]);

  const refresh = () => setTick((t) => t + 1);

  if (!project) return <p className="p-8 text-sm text-stone-400">加载中…</p>;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
        <button onClick={onBack} className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs hover:bg-stone-50">
          ← 目录
        </button>
        <h1 className="font-medium">{project.title}</h1>
        <nav className="ml-6 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === t.key ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto">
          <ModelSelector />
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {tab === "write" && <WritingDesk project={project} onChanged={refresh} />}
        {tab === "memory" && <MemoryPanel project={project} onChanged={refresh} />}
        {tab === "outline" && <OutlinePanel project={project} onChanged={refresh} />}
        {tab === "history" && <HistoryPanel project={project} onChanged={refresh} />}
      </main>
    </div>
  );
}
