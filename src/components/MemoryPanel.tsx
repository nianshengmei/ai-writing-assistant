"use client";

import { useEffect, useState } from "react";
import {
  getProtagonist,
  saveProtagonist,
  listCharacters,
  saveCharacters,
  listWorldview,
  saveWorldview,
  listRules,
  saveRules,
  listFuturePresets,
  saveFuturePresets,
  listRecap,
  listForeshadows,
  saveForeshadows,
  uid,
} from "@/lib/library";
import { getSelectedProvider } from "@/lib/useProviderSelection";
import { chatOnce } from "@/lib/llm";
import { buildCharacterAssistMessages, buildWorldviewAssistMessages } from "@/lib/context";
import type { ProjectDoc, ProtagonistDoc, CharacterEntry, WorldviewEntry, RuleEntry, FuturePreset, RecapEntry, ForeshadowEntry } from "@/lib/types";

type Tab = "protagonist" | "characters" | "worldview" | "rules" | "presets" | "foreshadows" | "recap";

const TABS: { key: Tab; label: string }[] = [
  { key: "protagonist", label: "主角记忆" },
  { key: "characters", label: "配角记忆" },
  { key: "worldview", label: "世界观" },
  { key: "rules", label: "作者要求" },
  { key: "presets", label: "后文预设" },
  { key: "foreshadows", label: "伏笔表" },
  { key: "recap", label: "前情记忆" },
];

export default function MemoryPanel({ project, onChanged }: { project: ProjectDoc; onChanged: () => void }) {
  const workId = project.id;
  const [tab, setTab] = useState<Tab>("protagonist");
  const [protagonist, setProtagonist] = useState<ProtagonistDoc | null>(null);
  const [characters, setCharacters] = useState<CharacterEntry[]>([]);
  const [worldview, setWorldview] = useState<WorldviewEntry[]>([]);
  const [rules, setRules] = useState<RuleEntry[]>([]);
  const [presets, setPresets] = useState<FuturePreset[]>([]);
  const [recap, setRecap] = useState<RecapEntry[]>([]);
  const [foreshadows, setForeshadows] = useState<ForeshadowEntry[]>([]);
  const [status, setStatus] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    Promise.all([
      getProtagonist(workId),
      listCharacters(workId),
      listWorldview(workId),
      listRules(workId),
      listFuturePresets(workId),
      listRecap(workId),
      listForeshadows(workId),
    ]).then(([p, c, w, r, fp, rc, fo]) => {
      setProtagonist(p);
      setCharacters(c);
      setWorldview(w);
      setRules(r);
      setPresets(fp);
      setRecap(rc);
      setForeshadows(fo);
    });
  }, [workId, tick]);

  async function aiFillCharacter(c: CharacterEntry) {
    const provider = await getSelectedProvider();
    if (!provider || !provider.apiKey) {
      setStatus("请先在设置中配置模型");
      return;
    }
    setStatus(`正在为「${c.name || "新配角"}」生成设定…`);
    try {
      const text = await chatOnce(
        provider,
        buildCharacterAssistMessages({ project, name: c.name, relation: c.relation, existing: characters }),
      );
      setCharacters(characters.map((x) => (x.id === c.id ? { ...x, content: text } : x)));
      await saveCharacters(workId, characters.map((x) => (x.id === c.id ? { ...x, content: text } : x)));
      setStatus("已生成并保存");
    } catch (e) {
      setStatus(`生成失败：${(e as Error)?.message ?? e}`);
    }
  }

  async function aiFillWorldview(w: WorldviewEntry) {
    const provider = await getSelectedProvider();
    if (!provider || !provider.apiKey) {
      setStatus("请先在设置中配置模型");
      return;
    }
    try {
      const text = await chatOnce(provider, buildWorldviewAssistMessages({ project, category: w.category, name: w.name }));
      const next = worldview.map((x) => (x.id === w.id ? { ...x, content: text } : x));
      setWorldview(next);
      await saveWorldview(workId, next);
      setStatus("已生成并保存");
    } catch (e) {
      setStatus(`生成失败：${(e as Error)?.message ?? e}`);
    }
  }

  const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm";
  const btn = "rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs hover:bg-stone-50";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === t.key ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {status && <p className="mb-3 text-xs text-stone-500">{status}</p>}

      {tab === "protagonist" && protagonist && (
        <div className="max-w-2xl space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input className={input} placeholder="姓名" value={protagonist.name} onChange={(e) => setProtagonist({ ...protagonist, name: e.target.value })} />
            <input className={input} placeholder="别名 / 称呼" value={protagonist.aliases} onChange={(e) => setProtagonist({ ...protagonist, aliases: e.target.value })} />
          </div>
          <textarea className={`${input} min-h-24 w-full`} placeholder="人设：外貌、性格、能力、来历…" value={protagonist.profile} onChange={(e) => setProtagonist({ ...protagonist, profile: e.target.value })} />
          <textarea className={`${input} min-h-20 w-full`} placeholder="成长线：主角的成长轨迹与关键节点" value={protagonist.arc} onChange={(e) => setProtagonist({ ...protagonist, arc: e.target.value })} />
          <textarea className={`${input} min-h-16 w-full`} placeholder="备注：口头禅、禁忌、软肋等" value={protagonist.notes} onChange={(e) => setProtagonist({ ...protagonist, notes: e.target.value })} />
          <button
            onClick={async () => {
              await saveProtagonist(workId, protagonist);
              setStatus("主角记忆已保存");
              onChanged();
            }}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-500"
          >
            保存主角记忆
          </button>
        </div>
      )}

      {tab === "characters" && (
        <div className="max-w-3xl space-y-3">
          <button
            onClick={() => {
              const next = [...characters, { id: uid(), name: "", relation: "", content: "" }];
              setCharacters(next);
              saveCharacters(workId, next);
            }}
            className={btn}
          >
            + 添加配角
          </button>
          {characters.map((c) => (
            <div key={c.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex gap-2">
                <input className={`${input} w-40`} placeholder="姓名" value={c.name} onChange={(e) => setCharacters(characters.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))} />
                <input className={`${input} flex-1`} placeholder="与主角关系（如：师尊 / 宿敌 / 挚友）" value={c.relation} onChange={(e) => setCharacters(characters.map((x) => (x.id === c.id ? { ...x, relation: e.target.value } : x)))} />
                <button onClick={() => aiFillCharacter(c)} className={btn}>
                  AI 填写
                </button>
                <button
                  onClick={() => {
                    const next = characters.filter((x) => x.id !== c.id);
                    setCharacters(next);
                    saveCharacters(workId, next);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
              <textarea
                className={`${input} min-h-20 w-full`}
                placeholder="设定内容：背景、性格、当前处境、伏笔潜力…"
                value={c.content}
                onChange={(e) => setCharacters(characters.map((x) => (x.id === c.id ? { ...x, content: e.target.value } : x)))}
                onBlur={() => saveCharacters(workId, characters)}
              />
            </div>
          ))}
        </div>
      )}

      {tab === "worldview" && (
        <div className="max-w-3xl space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => {
                const next = [...worldview, { id: uid(), category: "地点", name: "", content: "" }];
                setWorldview(next);
                saveWorldview(workId, next);
              }}
              className={btn}
            >
              + 添加条目
            </button>
            <select
              className="rounded-lg border border-stone-300 px-2 text-xs"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const next = [...worldview, { id: uid(), category: e.target.value, name: "", content: "" }];
                setWorldview(next);
                saveWorldview(workId, next);
              }}
            >
              <option value="">按类别添加…</option>
              {["地点", "势力", "规则", "物品", "体系"].map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          {worldview.map((w) => (
            <div key={w.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex gap-2">
                <select className={`${input} w-28`} value={w.category} onChange={(e) => setWorldview(worldview.map((x) => (x.id === w.id ? { ...x, category: e.target.value } : x)))}>
                  {["地点", "势力", "规则", "物品", "体系", "其他"].map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <input className={`${input} w-56`} placeholder="名称" value={w.name} onChange={(e) => setWorldview(worldview.map((x) => (x.id === w.id ? { ...x, name: e.target.value } : x)))} />
                <button onClick={() => aiFillWorldview(w)} className={btn}>
                  AI 填写
                </button>
                <button
                  onClick={() => {
                    const next = worldview.filter((x) => x.id !== w.id);
                    setWorldview(next);
                    saveWorldview(workId, next);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
              <textarea
                className={`${input} min-h-16 w-full`}
                placeholder="设定内容"
                value={w.content}
                onChange={(e) => setWorldview(worldview.map((x) => (x.id === w.id ? { ...x, content: e.target.value } : x)))}
                onBlur={() => saveWorldview(workId, worldview)}
              />
            </div>
          ))}
        </div>
      )}

      {tab === "rules" && (
        <div className="max-w-2xl space-y-2">
          <p className="text-xs text-stone-400">作者硬性要求会注入每次生成的 System 提示词，例如：禁写吻戏、每章不少于 3000 字、禁止第一人称内心独白。</p>
          <button
            onClick={() => {
              const next = [...rules, { id: uid(), text: "" }];
              setRules(next);
              saveRules(workId, next);
            }}
            className={btn}
          >
            + 添加要求
          </button>
          {rules.map((r) => (
            <div key={r.id} className="flex gap-2">
              <input
                className={`${input} flex-1`}
                value={r.text}
                placeholder="一条硬性要求"
                onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))}
                onBlur={() => saveRules(workId, rules)}
              />
              <button
                onClick={() => {
                  const next = rules.filter((x) => x.id !== r.id);
                  setRules(next);
                  saveRules(workId, next);
                }}
                className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "presets" && (
        <div className="max-w-3xl space-y-3">
          <p className="text-xs text-stone-400">后文预设：你对后续剧情的规划。生成时会按章节内容匹配相关预设，用于提前铺垫。</p>
          <button
            onClick={() => {
              const next = [...presets, { id: uid(), title: "", targetChapter: "", content: "" }];
              setPresets(next);
              saveFuturePresets(workId, next);
            }}
            className={btn}
          >
            + 添加预设
          </button>
          {presets.map((p) => (
            <div key={p.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex gap-2">
                <input className={`${input} w-56`} placeholder="预设标题" value={p.title} onChange={(e) => setPresets(presets.map((x) => (x.id === p.id ? { ...x, title: e.target.value } : x)))} />
                <input className={`${input} w-40`} placeholder="预计推进章节（如：第30章前后）" value={p.targetChapter} onChange={(e) => setPresets(presets.map((x) => (x.id === p.id ? { ...x, targetChapter: e.target.value } : x)))} />
                <button
                  onClick={() => {
                    const next = presets.filter((x) => x.id !== p.id);
                    setPresets(next);
                    saveFuturePresets(workId, next);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
              <textarea
                className={`${input} min-h-20 w-full`}
                placeholder="预设内容：计划发生什么、需要提前铺垫什么"
                value={p.content}
                onChange={(e) => setPresets(presets.map((x) => (x.id === p.id ? { ...x, content: e.target.value } : x)))}
                onBlur={() => saveFuturePresets(workId, presets)}
              />
            </div>
          ))}
        </div>
      )}

      {tab === "foreshadows" && (
        <div className="max-w-3xl space-y-2">
          <button
            onClick={() => {
              const next = [...foreshadows, { id: uid(), title: "", plantedIn: "", resolveIn: "", status: "open" as const, notes: "" }];
              setForeshadows(next);
              saveForeshadows(workId, next);
            }}
            className={btn}
          >
            + 添加伏笔
          </button>
          {foreshadows.map((f) => (
            <div key={f.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="mb-2 flex gap-2">
                <input className={`${input} flex-1`} placeholder="伏笔标题" value={f.title} onChange={(e) => setForeshadows(foreshadows.map((x) => (x.id === f.id ? { ...x, title: e.target.value } : x)))} />
                <input className={`${input} w-32`} placeholder="埋于（章节）" value={f.plantedIn} onChange={(e) => setForeshadows(foreshadows.map((x) => (x.id === f.id ? { ...x, plantedIn: e.target.value } : x)))} />
                <input className={`${input} w-32`} placeholder="计划回收" value={f.resolveIn} onChange={(e) => setForeshadows(foreshadows.map((x) => (x.id === f.id ? { ...x, resolveIn: e.target.value } : x)))} />
                <button
                  onClick={() => {
                    const next = foreshadows.map((x) => (x.id === f.id ? { ...x, status: x.status === "open" ? ("resolved" as const) : ("open" as const) } : x));
                    setForeshadows(next);
                    saveForeshadows(workId, next);
                  }}
                  className={`${btn} ${f.status === "open" ? "text-amber-700" : "text-green-700"}`}
                >
                  {f.status === "open" ? "未回收" : "已回收"}
                </button>
                <button
                  onClick={() => {
                    const next = foreshadows.filter((x) => x.id !== f.id);
                    setForeshadows(next);
                    saveForeshadows(workId, next);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-500"
                >
                  删除
                </button>
              </div>
              <input className={`${input} w-full`} placeholder="备注" value={f.notes} onChange={(e) => setForeshadows(foreshadows.map((x) => (x.id === f.id ? { ...x, notes: e.target.value } : x)))} onBlur={() => saveForeshadows(workId, foreshadows)} />
            </div>
          ))}
        </div>
      )}

      {tab === "recap" && (
        <div className="max-w-2xl">
          <p className="mb-3 text-xs text-stone-400">
            前情记忆由系统自动维护：每采纳一章，AI 自动生成本章摘要追加于此。生成正文时会作为上下文注入。
          </p>
          {recap.length === 0 && <p className="text-sm text-stone-400">暂无前情（采纳第一章后自动生成）。</p>}
          {recap.map((r) => (
            <div key={r.chId} className="mb-2 rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <span className="mr-2 text-xs font-medium text-stone-500">{r.chId.replace("ch-", "第") + "章"}</span>
              {r.summary}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
