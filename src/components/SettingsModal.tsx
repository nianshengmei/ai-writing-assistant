"use client";

import { useEffect, useState } from "react";
import { loadConfig, saveConfig, backend } from "@/lib/library";
import { isTauri } from "@/lib/env";
import { PROVIDER_PRESETS, newProvider, presetByKey } from "@/lib/presets";
import { testConnection } from "@/lib/llm";
import type { StoredConfig, ProviderConfig } from "@/lib/types";

export default function SettingsModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [config, setConfig] = useState<StoredConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [dataRoot, setDataRoot] = useState("");

  useEffect(() => {
    loadConfig().then((c) => {
      setConfig(c);
      setSelectedId(c.activeId || c.providers[0]?.id || "");
    });
    if (isTauri()) backend.getDataRoot().then(setDataRoot);
  }, []);

  if (!config) return null;

  const selected = config.providers.find((p) => p.id === selectedId) ?? null;
  const preset = selected ? presetByKey(selected.preset) : undefined;

  function updateSelected(patch: Partial<ProviderConfig>) {
    if (!config || !selected) return;
    setConfig({
      ...config,
      providers: config.providers.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)),
    });
  }

  async function persist(next?: StoredConfig) {
    if (!config) return;
    const toSave = next ?? config;
    await saveConfig(toSave);
    setStatus({ text: "已保存", ok: true });
    onChanged?.();
  }

  async function addProvider(presetKey: string) {
    if (!config) return;
    const p = newProvider(presetKey);
    const next = { ...config, providers: [...config.providers, p], activeId: config.activeId || p.id };
    setConfig(next);
    setSelectedId(p.id);
    await persist(next);
  }

  async function removeProvider() {
    if (!config || !selected) return;
    if (!confirm(`删除配置「${selected.name}」？`)) return;
    const providers = config.providers.filter((p) => p.id !== selected.id);
    const next = { ...config, providers, activeId: config.activeId === selected.id ? providers[0]?.id ?? "" : config.activeId };
    setConfig(next);
    setSelectedId(next.activeId);
    await persist(next);
  }

  async function runTest() {
    if (!selected) return;
    await persist();
    setStatus({ text: "测试中…", ok: true });
    try {
      const reply = await testConnection(selected);
      setStatus({ text: `连接成功，模型返回：${reply.slice(0, 50)}`, ok: true });
    } catch (e) {
      setStatus({ text: `连接失败：${(e as Error)?.message ?? e}`, ok: false });
    }
  }

  async function changeDataRoot() {
    const picked = await backend.pickDataRoot();
    if (!picked) return;
    await backend.setDataRoot(picked);
    setDataRoot(picked);
    setStatus({ text: "数据目录已更新，作品列表已刷新", ok: true });
    onChanged?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">设置</h2>
          <button onClick={onClose} className="text-sm text-stone-400 hover:text-stone-700">
            关闭
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-stone-700">模型配置（OpenAI 兼容）</h3>
            <select
              className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
              value=""
              onChange={(e) => e.target.value && addProvider(e.target.value)}
            >
              <option value="">+ 添加服务商…</option>
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {config.providers.length === 0 ? (
            <p className="mb-4 text-xs text-stone-400">还没有模型配置，从上方选择智谱 GLM / 通义 Qwen / Kimi / 小米 MiMo 添加。</p>
          ) : (
            <div className="mb-4 flex flex-wrap gap-2">
              {config.providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${
                    p.id === selectedId
                      ? "border-amber-500 bg-amber-50 text-amber-800"
                      : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
                  }`}
                >
                  {p.name} · {p.model || "未设模型"}
                  {config.activeId === p.id && " ★"}
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="rounded-xl border border-stone-200 p-4">
              <div className="grid gap-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">
                    {preset?.hint ?? "自定义 OpenAI 兼容服务"}
                  </span>
                  <div className="flex gap-2">
                    {config.activeId !== selected.id && (
                      <button
                        onClick={() => {
                          const next = { ...config, activeId: selected.id };
                          setConfig(next);
                          persist(next);
                        }}
                        className="rounded border border-amber-500 px-2 py-1 text-xs text-amber-700"
                      >
                        设为默认
                      </button>
                    )}
                    <button onClick={removeProvider} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600">
                      删除
                    </button>
                  </div>
                </div>
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2"
                  placeholder="名称"
                  value={selected.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                />
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs"
                  placeholder="Base URL（以 /v1 结尾）"
                  value={selected.baseURL}
                  onChange={(e) => updateSelected({ baseURL: e.target.value })}
                />
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs"
                  placeholder="API Key"
                  type="password"
                  value={selected.apiKey}
                  onChange={(e) => updateSelected({ apiKey: e.target.value })}
                />
                <input
                  className="rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs"
                  placeholder="模型名（纯自定义，任意值均可）"
                  value={selected.model}
                  onChange={(e) => updateSelected({ model: e.target.value })}
                />
                <label className="flex items-center gap-3 text-xs text-stone-600">
                  温度 {selected.temperature.toFixed(1)}
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.1}
                    value={selected.temperature}
                    onChange={(e) => updateSelected({ temperature: parseFloat(e.target.value) })}
                  />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={runTest} className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700">
                  测试连接
                </button>
                <button onClick={() => persist()} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">
                  保存
                </button>
              </div>
            </div>
          )}

          {isTauri() && (
            <div className="mt-5 rounded-xl border border-stone-200 p-4">
              <h3 className="mb-2 text-sm font-medium text-stone-700">数据目录</h3>
              <p className="mb-2 break-all font-mono text-xs text-stone-500">{dataRoot || "读取中…"}</p>
              <p className="mb-3 text-xs text-stone-400">
                全部作品、风格库、生成历史都以 JSON 文件保存在此目录下，可整体备份或放入网盘同步。
              </p>
              <button onClick={changeDataRoot} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">
                更改目录
              </button>
            </div>
          )}

          {status && (
            <p className={`mt-4 text-xs ${status.ok ? "text-stone-500" : "rounded-lg bg-red-50 px-3 py-2 text-red-700"}`}>
              {status.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
