"use client";

import { useEffect, useState } from "react";
import { listStyles, saveStyle, deleteStyle, nextStyleId, getActiveProvider } from "@/lib/library";
import { streamChat, chatOnce } from "@/lib/llm";
import { buildStyleObservationMessages, buildStyleMergeMessages, buildStyleSamplesMessages } from "@/lib/context";
import type { StyleDoc, StyleProfile } from "@/lib/types";

const EMPTY_PROFILE: StyleProfile = {
  pov: "",
  tone: "",
  sentenceRhythm: "",
  dialogueStyle: "",
  descriptionRatio: "",
  rhetoric: "",
  vocabularyFavor: "",
  vocabularyAvoid: "",
  pacing: "",
  hooks: "",
  taboos: "",
};

const PROFILE_FIELDS: { key: keyof StyleProfile; label: string }[] = [
  { key: "pov", label: "叙事视角" },
  { key: "tone", label: "文风基调" },
  { key: "sentenceRhythm", label: "句式节奏" },
  { key: "dialogueStyle", label: "对话风格" },
  { key: "descriptionRatio", label: "描写配比" },
  { key: "rhetoric", label: "修辞习惯" },
  { key: "vocabularyFavor", label: "高频词与口头禅" },
  { key: "vocabularyAvoid", label: "避免的用词" },
  { key: "pacing", label: "节奏把控" },
  { key: "hooks", label: "章末钩子" },
  { key: "taboos", label: "写作禁忌" },
];

function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export default function StyleLibraryModal({ onClose }: { onClose: () => void }) {
  const [styles, setStyles] = useState<StyleDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState("");
  const [material, setMaterial] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [abortCtl, setAbortCtl] = useState<AbortController | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    listStyles().then((s) => {
      setStyles(s);
      if (s.length && !selectedId) setSelectedId(s[0].id);
    });
  }, [tick, selectedId]);

  const selected = styles.find((s) => s.id === selectedId) ?? null;
  const reload = () => setTick((t) => t + 1);

  function patchSelected(patch: Partial<StyleDoc>) {
    if (!selected) return;
    setStyles(styles.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
  }

  async function createStyle() {
    const id = await nextStyleId();
    const doc: StyleDoc = {
      id,
      name: `新风格 ${id.replace("style-", "#")}`,
      profile: { ...EMPTY_PROFILE },
      languageSamples: [],
      actionSamples: [],
      sceneSamples: [],
      sourceNote: "",
      updatedAt: Date.now(),
    };
    await saveStyle(doc);
    setSelectedId(id);
    reload();
  }

  async function saveCurrent() {
    if (!selected) return;
    await saveStyle(selected);
    setStatus("风格已保存");
    reload();
  }

  async function removeCurrent() {
    if (!selected || !confirm(`删除风格「${selected.name}」？`)) return;
    await deleteStyle(selected.id);
    setSelectedId("");
    reload();
  }

  function addSample(kind: "languageSamples" | "actionSamples" | "sceneSamples") {
    if (!selected) return;
    patchSelected({ [kind]: [...selected[kind], ""] } as Partial<StyleDoc>);
  }

  function updateSample(kind: "languageSamples" | "actionSamples" | "sceneSamples", i: number, value: string) {
    if (!selected) return;
    const arr = [...selected[kind]];
    arr[i] = value;
    patchSelected({ [kind]: arr } as Partial<StyleDoc>);
  }

  function removeSample(kind: "languageSamples" | "actionSamples" | "sceneSamples", i: number) {
    if (!selected) return;
    patchSelected({ [kind]: selected[kind].filter((_, j) => j !== i) } as Partial<StyleDoc>);
  }

  async function runExtraction() {
    if (!selected) return;
    if (!material.trim()) {
      setStatus("请先粘贴用于提炼风格的小说素材");
      return;
    }
    const provider = await getActiveProvider();
    if (!provider || !provider.apiKey) {
      setStatus("请先在设置中配置模型（含 API Key）");
      return;
    }
    const ctrl = new AbortController();
    setAbortCtl(ctrl);
    setExtracting(true);
    setStatus("");
    const chunkSize = 8000;
    const chunks: string[] = [];
    for (let i = 0; i < material.length; i += chunkSize) chunks.push(material.slice(i, i + chunkSize));

    try {
      const observations: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        setStatus(`提炼风格观察 ${i + 1}/${chunks.length}…`);
        const obs = await chatOnce(provider, buildStyleObservationMessages(chunks[i]));
        observations.push(`【片段 ${i + 1}】\n${obs}`);
      }

      let mergedProfile: Partial<StyleProfile> | null = null;
      if (observations.length > 0) {
        setStatus("合并风格画像…");
        const merged = await chatOnce(provider, buildStyleMergeMessages(observations));
        mergedProfile = parseJsonLoose<StyleProfile>(merged);
        if (!mergedProfile) setStatus("画像合并结果解析失败，请手动填写画像字段");
      }

      setStatus("摘录语言/动作/场面示例…");
      const samplesRaw = await chatOnce(provider, buildStyleSamplesMessages(chunks[0]));
      const samples = parseJsonLoose<{ language?: string; action?: string; scene?: string }>(samplesRaw);

      const next: StyleDoc = {
        ...selected,
        profile: { ...selected.profile, ...(mergedProfile ?? {}) },
        languageSamples: samples?.language ? [...selected.languageSamples, samples.language] : selected.languageSamples,
        actionSamples: samples?.action ? [...selected.actionSamples, samples.action] : selected.actionSamples,
        sceneSamples: samples?.scene ? [...selected.sceneSamples, samples.scene] : selected.sceneSamples,
        sourceNote: selected.sourceNote || `AI 提炼自 ${material.length} 字素材`,
      };
      await saveStyle(next);
      setStatus("提炼完成，画像与示例已填入，可继续手动调整后保存");
      reload();
    } catch (e) {
      setStatus((e as Error)?.name === "AbortError" ? "已停止提炼" : `提炼失败：${(e as Error)?.message ?? e}`);
    } finally {
      setExtracting(false);
      setAbortCtl(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">风格库（全局，独立于作品）</h2>
          <div className="flex items-center gap-2">
            <button onClick={createStyle} className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700">
              + 新建风格
            </button>
            <button onClick={onClose} className="text-sm text-stone-400 hover:text-stone-700">
              关闭
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="w-48 shrink-0 overflow-y-auto border-r border-stone-200 p-3">
            {styles.length === 0 && <p className="text-xs text-stone-400">暂无风格</p>}
            {styles.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm ${
                  s.id === selectedId ? "bg-amber-50 text-amber-800" : "text-stone-600 hover:bg-stone-50"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>

          {selected ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mb-4 flex items-center gap-2">
                <input
                  className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  value={selected.name}
                  onChange={(e) => patchSelected({ name: e.target.value })}
                />
                <button onClick={saveCurrent} className="rounded-lg bg-amber-600 px-3 py-2 text-xs text-white hover:bg-amber-500">
                  保存
                </button>
                <button onClick={removeCurrent} className="rounded-lg border border-red-300 px-3 py-2 text-xs text-red-600">
                  删除
                </button>
              </div>

              <details className="mb-4 rounded-xl border border-stone-200 p-4" open>
                <summary className="cursor-pointer text-sm font-medium text-stone-700">从素材提炼风格（可多次叠加素材）</summary>
                <textarea
                  className="mt-3 min-h-28 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  placeholder="粘贴小说素材（自己的旧稿或目标作者的作品），支持很长文本，会自动分块提炼再合并"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  {extracting ? (
                    <button
                      onClick={() => abortCtl?.abort()}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-600"
                    >
                      停止
                    </button>
                  ) : (
                    <button onClick={runExtraction} className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700">
                      开始提炼
                    </button>
                  )}
                  {status && <span className="self-center text-xs text-stone-500">{status}</span>}
                </div>
              </details>

              <h3 className="mb-2 text-sm font-medium text-stone-700">风格画像（可手动微调）</h3>
              <div className="mb-5 grid gap-2">
                {PROFILE_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-start gap-2">
                    <label className="w-28 shrink-0 pt-2 text-xs text-stone-500">{f.label}</label>
                    <input
                      className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                      value={selected.profile[f.key]}
                      onChange={(e) => patchSelected({ profile: { ...selected.profile, [f.key]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>

              {(
                [
                  { key: "languageSamples" as const, label: "语言示例（例句）" },
                  { key: "actionSamples" as const, label: "动作描写示例" },
                  { key: "sceneSamples" as const, label: "经典场面描写示例" },
                ]
              ).map((sec) => (
                <div key={sec.key} className="mb-4">
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-stone-700">{sec.label}</h3>
                    <button onClick={() => addSample(sec.key)} className="text-xs text-amber-700 hover:underline">
                      + 手动添加
                    </button>
                  </div>
                  {selected[sec.key].length === 0 && <p className="text-xs text-stone-400">暂无（提炼或手动添加）</p>}
                  {selected[sec.key].map((sample, i) => (
                    <div key={i} className="mb-2 flex items-start gap-2">
                      <textarea
                        className="min-h-16 flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                        value={sample}
                        onChange={(e) => updateSample(sec.key, i, e.target.value)}
                      />
                      <button
                        onClick={() => removeSample(sec.key, i)}
                        className="mt-1 text-xs text-stone-400 hover:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              ))}

              <div className="flex items-center gap-2 pb-4">
                <input
                  className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                  placeholder="素材来源备注（可选）"
                  value={selected.sourceNote}
                  onChange={(e) => patchSelected({ sourceNote: e.target.value })}
                />
                <button onClick={saveCurrent} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500">
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-stone-400">
              新建或选择一个风格开始编辑
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
