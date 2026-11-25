"use client";

import { useEffect, useState } from "react";
import {
  listStyles,
  saveStyle,
  deleteStyle,
  nextStyleId,
} from "@/lib/library";
import { useFeatureModel } from "@/lib/useProviderSelection";
import ModelPicker from "./ModelPicker";
import { streamChat, chatOnce } from "@/lib/llm";
import {
  buildStyleObservationMessages,
  buildStyleMergeMessages,
  buildStyleGroupMergeMessages,
  buildStyleSamplesMessages,
  STYLE_OBSERVATION_SYSTEM,
  STYLE_MERGE_SYSTEM,
  STYLE_GROUP_MERGE_SYSTEM,
  STYLE_SAMPLES_SYSTEM,
} from "@/lib/context";
import { headSample, tailSample, extractDialogues, chunkText } from "@/lib/styleSample";
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
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [material, setMaterial] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [abortCtl, setAbortCtl] = useState<AbortController | null>(null);
  const [tick, setTick] = useState(0);
  const [obsSystem, setObsSystem] = useState(STYLE_OBSERVATION_SYSTEM);
  const [mergeSystem, setMergeSystem] = useState(STYLE_MERGE_SYSTEM);
  const [groupMergeSystem, setGroupMergeSystem] = useState(STYLE_GROUP_MERGE_SYSTEM);
  const [samplesSystem, setSamplesSystem] = useState(STYLE_SAMPLES_SYSTEM);
  const [showPrompts, setShowPrompts] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<"head" | "tail" | "full">("head");
  const [budget, setBudget] = useState(100000);
  const extractModel = useFeatureModel("style-extract");

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
    setStatus({ text: "风格已保存", ok: true });
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

  async function importTxtFile(file: File) {
    if (!/\.(txt|md)$/i.test(file.name)) {
      setStatus({ text: "仅支持 .txt / .md 文本文件", ok: false });
      return;
    }
    const text = await file.text();
    setMaterial(text);
    setStatus({ text: `已导入《${file.name}》，共 ${text.length} 字`, ok: true });
  }

  function progressKey() {
    return `styleExtractProgress:${selected?.id ?? "none"}`;
  }

  function loadProgress(): { materialLen: number; mode: string; budget: number; observations: string[] } | null {
    try {
      const raw = localStorage.getItem(progressKey());
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveProgress(observations: string[]) {
    try {
      localStorage.setItem(progressKey(), JSON.stringify({ materialLen: material.length, mode, budget, observations }));
    } catch {
      /* 忽略存储失败 */
    }
  }

  function clearProgress() {
    try {
      localStorage.removeItem(progressKey());
    } catch {
      /* ignore */
    }
  }

  async function runExtraction(resume = false) {
    if (!selected) return;
    if (!material.trim()) {
      setStatus({ text: "请先粘贴素材或导入小说原文 txt 文件", ok: false });
      return;
    }
    const provider = extractModel.picked;
    if (!provider || !provider.apiKey) {
      setStatus({ text: "失败：请先在右上角 ⚙ 设置 → 模型 中添加模型，并在本页选择", ok: false });
      return;
    }

    // 断点续跑：上次进度与当前素材/模式/字数上限一致时才可继续
    const saved = loadProgress();
    let startIndex = 0;
    if (resume && saved && saved.materialLen === material.length && saved.mode === mode && saved.budget === budget && saved.observations.length > 0) {
      startIndex = saved.observations.length;
    }

    const ctrl = new AbortController();
    setAbortCtl(ctrl);
    setExtracting(true);
    setStatus(null);

    // 前置截取：默认取前/后 budget 字（对齐章节边界），全文模式才喂全部
    const sampled = mode === "head" ? headSample(material, budget) : mode === "tail" ? tailSample(material, budget) : { text: material, truncated: false, detectedChapters: null };
    const chunks = chunkText(sampled.text, 8000);
    const observations: string[] =
      resume && saved && saved.materialLen === material.length && saved.mode === mode && saved.budget === budget
        ? [...saved.observations]
        : [];

    try {
      for (let i = startIndex; i < chunks.length; i++) {
        setStatus({ text: `提炼风格观察 ${i + 1}/${chunks.length}（已取 ${sampled.text.length} 字素材）…`, ok: true });
        const obs = await chatOnce(provider, buildStyleObservationMessages(chunks[i], obsSystem));
        observations.push(`【片段 ${i + 1}】\n${obs}`);
        saveProgress(observations);
      }

      // 合并画像：观察很多时先分层归并，避免合并上下文爆炸
      let mergedProfile: Partial<StyleProfile> | null = null;
      if (observations.length > 0) {
        let finalObs = observations;
        if (observations.length > 10) {
          const groups: string[][] = [];
          for (let i = 0; i < observations.length; i += 8) groups.push(observations.slice(i, i + 8));
          const condensed: string[] = [];
          for (let g = 0; g < groups.length; g++) {
            setStatus({ text: `分层归并观察 ${g + 1}/${groups.length}…`, ok: true });
            const out = await chatOnce(provider, buildStyleGroupMergeMessages(groups[g]));
            condensed.push(`【归并 ${g + 1}】\n${out}`);
          }
          finalObs = condensed;
        }
        setStatus({ text: "合并风格画像…", ok: true });
        const merged = await chatOnce(provider, buildStyleMergeMessages(finalObs, mergeSystem));
        mergedProfile = parseJsonLoose<StyleProfile>(merged);
        if (!mergedProfile) setStatus({ text: "画像合并结果解析失败，请手动填写画像字段", ok: false });
      }

      // 摘录动作/场面示例（模型），语言对话示例（本地标点抽取，不耗调用）
      setStatus({ text: "摘录动作/场面示例…", ok: true });
      const samplesRaw = await chatOnce(provider, buildStyleSamplesMessages(chunks[0], samplesSystem));
      const samples = parseJsonLoose<{ language?: string; action?: string; scene?: string }>(samplesRaw);

      const localDialogues = extractDialogues(sampled.text, 5);
      const existingLang = new Set(selected.languageSamples.map((s) => s.replace(/\s+/g, "").slice(0, 40)));
      const newDialogues = localDialogues.filter((d) => !existingLang.has(d.replace(/\s+/g, "").slice(0, 40)));

      const next: StyleDoc = {
        ...selected,
        profile: { ...selected.profile, ...(mergedProfile ?? {}) },
        languageSamples: [...selected.languageSamples, ...newDialogues, ...(samples?.language ? [samples.language] : [])],
        actionSamples: samples?.action ? [...selected.actionSamples, samples.action] : selected.actionSamples,
        sceneSamples: samples?.scene ? [...selected.sceneSamples, samples.scene] : selected.sceneSamples,
        sourceNote:
          selected.sourceNote ||
          `AI 提炼自 ${sampled.text.length} 字素材${sampled.truncated ? `（全书 ${material.length} 字，取${mode === "tail" ? "结尾" : "开头"}）` : ""}${sampled.detectedChapters ? `，检测到约 ${sampled.detectedChapters} 章` : ""}`,
      };
      await saveStyle(next);
      clearProgress();
      setStatus({
        text: `提炼完成：${sampled.truncated ? `本次取${mode === "tail" ? "后" : "前"} ${sampled.text.length} 字（共 ${chunks.length} 块）` : `全文 ${sampled.text.length} 字`}；语言示例含 ${newDialogues.length} 条本地抽取对话`,
        ok: true,
      });
      reload();
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      if (!aborted && observations.length > 0) saveProgress(observations);
      setStatus(
        aborted
          ? { text: observations.length > 0 ? `已停止（已完成 ${observations.length}/${chunks.length} 块，再点「开始提炼」可继续）` : "已停止提炼", ok: true }
          : { text: `提炼失败：${(e as Error)?.message ?? e}`, ok: false },
      );
    } finally {
      setExtracting(false);
      setAbortCtl(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-stone-50"
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
                <div
                  className={`mt-3 rounded-lg border-2 border-dashed p-1 transition-colors ${
                    dragOver ? "border-amber-500 bg-amber-50" : "border-transparent"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) importTxtFile(f);
                  }}
                >
                  <textarea
                    className="min-h-28 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    placeholder="把小说原文 txt 拖到这个框里，或点击下方按钮选择文件；也可以直接粘贴素材。支持很长文本，会自动分块提炼再合并。"
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50">
                    📄 导入 txt / md
                    <input
                      type="file"
                      accept=".txt,.md"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importTxtFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {material.length > 0 && (
                    <>
                      <span className="text-xs text-stone-400">素材 {material.length} 字（约 {Math.ceil(material.length / 8000)} 块）</span>
                      <button onClick={() => setMaterial("")} className="text-xs text-stone-400 hover:text-red-600">
                        清空素材
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50">
                  <button
                    onClick={() => setShowPrompts((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-xs text-stone-600"
                  >
                    <span>🧩 提炼提示词（点开可查看并编辑，三段分别控制「观察→合并→摘录示例」）</span>
                    <span>{showPrompts ? "▲" : "▼"}</span>
                  </button>
                  {showPrompts && (
                    <div className="space-y-3 px-3 pb-3">
                      <div>
                        <p className="mb-1 text-xs font-medium text-stone-600">① 逐块风格观察 System</p>
                        <textarea
                          className="min-h-24 w-full rounded border border-stone-300 px-2 py-1.5 font-mono text-xs leading-relaxed"
                          value={obsSystem}
                          onChange={(e) => setObsSystem(e.target.value)}
                        />
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-stone-600">② 观察分组压缩 System（观察超过 10 条时启用分层归并）</p>
                        <textarea
                          className="min-h-24 w-full rounded border border-stone-300 px-2 py-1.5 font-mono text-xs leading-relaxed"
                          value={groupMergeSystem}
                          onChange={(e) => setGroupMergeSystem(e.target.value)}
                        />
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-stone-600">③ 观察合并为画像 System（输出 JSON）</p>
                        <textarea
                          className="min-h-24 w-full rounded border border-stone-300 px-2 py-1.5 font-mono text-xs leading-relaxed"
                          value={mergeSystem}
                          onChange={(e) => setMergeSystem(e.target.value)}
                        />
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-stone-600">④ 摘录动作/场面示例 System（输出 JSON）</p>
                        <textarea
                          className="min-h-24 w-full rounded border border-stone-300 px-2 py-1.5 font-mono text-xs leading-relaxed"
                          value={samplesSystem}
                          onChange={(e) => setSamplesSystem(e.target.value)}
                        />
                      </div>
                      <button
                        onClick={() => {
                          setObsSystem(STYLE_OBSERVATION_SYSTEM);
                          setMergeSystem(STYLE_MERGE_SYSTEM);
                          setGroupMergeSystem(STYLE_GROUP_MERGE_SYSTEM);
                          setSamplesSystem(STYLE_SAMPLES_SYSTEM);
                        }}
                        className="text-xs text-stone-400 hover:text-stone-700"
                      >
                        恢复默认提示词
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs">
                  <span className="font-medium text-stone-600">提炼范围：</span>
                  <label className="flex cursor-pointer items-center gap-1 text-stone-600">
                    <input type="radio" checked={mode === "head"} onChange={() => setMode("head")} disabled={extracting} />
                    前
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-stone-600">
                    <input type="radio" checked={mode === "tail"} onChange={() => setMode("tail")} disabled={extracting} />
                    后
                  </label>
                  {mode !== "full" && (
                    <label className="flex items-center gap-1 text-stone-600">
                      <input
                        type="number"
                        min={20000}
                        step={10000}
                        value={budget}
                        disabled={extracting}
                        onChange={(e) => setBudget(Math.max(20000, Number(e.target.value) || 100000))}
                        className="w-24 rounded border border-stone-300 px-1.5 py-0.5 text-xs"
                      />
                      字（默认 10 万，程序按章节边界截断）
                    </label>
                  )}
                  <label className="flex cursor-pointer items-center gap-1 text-stone-600">
                    <input type="radio" checked={mode === "full"} onChange={() => setMode("full")} disabled={extracting} />
                    全文精析
                  </label>
                  {material.length > 0 && (
                    <span className={mode === "full" && material.length > 150000 ? "text-red-600" : "text-stone-400"}>
                      约 {Math.ceil((mode === "full" ? material.length : Math.min(material.length, budget)) / 8000)} 次模型调用
                      {mode === "full" && material.length > 150000 && "（素材超 15 万字，耗时长费用高，建议只取前/后 N 字）"}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {extracting ? (
                    <button
                      onClick={() => abortCtl?.abort()}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-600"
                    >
                      停止
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const saved = loadProgress();
                        const resumable =
                          saved &&
                          saved.materialLen === material.length &&
                          saved.mode === mode &&
                          saved.budget === budget &&
                          saved.observations.length > 0;
                        if (resumable && confirm(`检测到上次未完成的提炼进度（已完成 ${saved!.observations.length} 块观察），是否继续？\n取消则从头开始。`)) {
                          void runExtraction(true);
                        } else {
                          void runExtraction(false);
                        }
                      }}
                      className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700"
                    >
                      开始提炼
                    </button>
                  )}
                  <span className="text-xs text-stone-400">提炼使用：</span>
                  <ModelPicker providers={extractModel.providers} value={extractModel.selectedId} onChange={extractModel.select} disabled={extracting} />
                  {status && (
                  <span
                    className={`whitespace-pre-wrap break-all text-xs ${
                      status.ok ? "text-stone-500" : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700"
                    }`}
                  >
                    {status.text}
                  </span>
                )}
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
