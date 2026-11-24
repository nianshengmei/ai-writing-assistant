"use client";

import { useEffect, useState } from "react";
import { loadConfig, saveConfig, backend } from "@/lib/library";
import { isTauri } from "@/lib/env";
import { PROVIDER_PRESETS, newProvider, presetByKey } from "@/lib/presets";
import { testConnection } from "@/lib/llm";
import type { StoredConfig, ProviderConfig } from "@/lib/types";

type Page = "about" | "models" | "data";

const MENU: { key: Page; label: string }[] = [
  { key: "about", label: "关于" },
  { key: "models", label: "模型" },
  { key: "data", label: "数据目录" },
];

export default function SettingsModal({
  onClose,
  onChanged,
  initialPage = "about",
}: {
  onClose: () => void;
  onChanged?: () => void;
  initialPage?: Page;
}) {
  const [page, setPage] = useState<Page>(initialPage);
  const [config, setConfig] = useState<StoredConfig | null>(null);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [dataRoot, setDataRoot] = useState("");
  // 模型页内部视图：list=模型列表，edit=编辑/添加表单
  const [view, setView] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string>(""); // 被编辑的配置 id；"" 表示新添加
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadConfig().then(setConfig);
    if (isTauri()) backend.getDataRoot().then(setDataRoot);
  }, []);

  if (!config) return null;

  const editing = config.providers.find((p) => p.id === editingId) ?? null;
  const preset = editing ? presetByKey(editing.preset) : undefined;

  function updateEditing(patch: Partial<ProviderConfig>) {
    if (!config || !editing) return;
    setConfig({
      ...config,
      providers: config.providers.map((p) => (p.id === editing.id ? { ...p, ...patch } : p)),
    });
  }

  async function persist(next?: StoredConfig): Promise<boolean> {
    const toSave = next ?? config;
    if (!toSave) return false;
    try {
      await saveConfig(toSave);
      onChanged?.();
      return true;
    } catch (e) {
      setStatus({ text: `保存失败：${(e as Error)?.message ?? e}`, ok: false });
      return false;
    }
  }

  function startAdd() {
    setStatus(null);
    const p = newProvider(PROVIDER_PRESETS[0]?.key ?? "custom");
    draftIds.add(p.id);
    setConfig({ ...config!, providers: [...config!.providers, p] });
    setEditingId(p.id);
    setView("edit");
  }

  function startEdit(id: string) {
    setStatus(null);
    setEditingId(id);
    setView("edit");
  }

  async function saveEditing() {
    if (!config || !editing) return;
    if (!editing.name.trim()) {
      setStatus({ text: "保存失败：请填写名称", ok: false });
      return;
    }
    if (!editing.baseURL.trim() || !editing.apiKey.trim() || !editing.model.trim()) {
      setStatus({ text: "保存失败：Base URL / API Key / 模型名 均不能为空", ok: false });
      return;
    }
    const ok = await persist(config);
    if (!ok) return;
    draftIds.delete(editing.id);
    setStatus({ text: `已保存「${editing.name}」`, ok: true });
    setView("list");
    setEditingId("");
  }

  /** 放弃编辑：新增的草稿直接丢弃 */
  function cancelEditing() {
    if (!config || !editing) return;
    if (draftIds.has(editing.id)) {
      setConfig({ ...config, providers: config.providers.filter((p) => p.id !== editing.id) });
      draftIds.delete(editing.id);
    }
    setView("list");
    setEditingId("");
    setStatus(null);
  }

  async function removeProvider(id: string) {
    const target = config?.providers.find((p) => p.id === id);
    if (!config || !target) return;
    if (!confirm(`删除模型「${target.name}」？`)) return;
    const providers = config.providers.filter((p) => p.id !== id);
    draftIds.delete(id);
    const next = { ...config, providers, activeId: config.activeId === id ? providers[0]?.id ?? "" : config.activeId };
    setConfig(next);
    await persist(next);
    setStatus({ text: `已删除「${target.name}」`, ok: true });
  }

  async function makeDefault(id: string) {
    if (!config) return;
    const next = { ...config, activeId: id };
    setConfig(next);
    await persist(next);
    setStatus({ text: "已设为默认", ok: true });
  }

  async function runTest() {
    if (!editing) return;
    await persist();
    setTesting(true);
    setStatus({ text: "测试中…", ok: true });
    try {
      const reply = await testConnection(editing);
      setStatus({ text: `连接成功，模型返回：${reply.slice(0, 80)}`, ok: true });
    } catch (e) {
      setStatus({ text: `连接失败：${(e as Error)?.message ?? e}`, ok: false });
    } finally {
      setTesting(false);
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

        <div className="flex min-h-0 flex-1">
          {/* 左侧菜单 */}
          <nav className="w-36 shrink-0 border-r border-stone-100 bg-stone-50/60 p-3">
            {MENU.map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setPage(m.key);
                  setView("list");
                  setStatus(null);
                }}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${
                  page === m.key ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                {m.label}
              </button>
            ))}
          </nav>

          {/* 右侧内容 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {page === "about" && <AboutPage />}

            {page === "models" && view === "list" && (
              <ModelsListPage
                config={config}
                onAdd={startAdd}
                onEdit={startEdit}
                onRemove={removeProvider}
                onMakeDefault={makeDefault}
              />
            )}

            {page === "models" && view === "edit" && editing && (
              <ModelsEditPage
                editing={editing}
                preset={preset}
                isNew={draftIds.has(editing.id)}
                testing={testing}
                onUpdate={updateEditing}
                onSave={saveEditing}
                onCancel={cancelEditing}
                onTest={runTest}
              />
            )}

            {page === "data" && (
              <div>
                {isTauri() ? (
                  <>
                    <h3 className="mb-2 text-sm font-medium text-stone-700">数据目录</h3>
                    <p className="mb-2 break-all font-mono text-xs text-stone-500">{dataRoot || "读取中…"}</p>
                    <p className="mb-3 text-xs text-stone-400">
                      全部作品、风格库、生成历史都以 JSON 文件保存在此目录下，可整体备份或放入网盘同步。
                    </p>
                    <button
                      onClick={changeDataRoot}
                      className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50"
                    >
                      更改目录
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-stone-400">浏览器开发模式下数据存于 IndexedDB，无独立数据目录。</p>
                )}
              </div>
            )}

            {status && (
              <p
                className={`mt-4 whitespace-pre-wrap break-all text-xs ${
                  status.ok ? "text-stone-500" : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700"
                }`}
              >
                {status.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 新增草稿 id 集合（会话内记忆哪些 id 是尚未保存的新配置） ----------
const draftIds = new Set<string>();

function AboutPage() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-stone-600">
      <h3 className="text-base font-medium text-stone-800">AI 写作助手</h3>
      <p>一款面向长篇小说创作的本地 AI 写作工具。所有数据以 JSON 文件保存在你选择的数据目录中，可备份、可网盘同步；AI 能力通过 OpenAI 兼容接口接入任意模型服务商。</p>
      <ul className="list-disc space-y-1.5 pl-5 text-xs">
        <li><b>记忆库</b>：主角、配角、世界观、作者要求、后文预设、伏笔表，外加自动维护的前情记忆——生成时按需注入提示词。</li>
        <li><b>大纲</b>：章节树 + 每章细纲，AI 可参考上文续推细纲。</li>
        <li><b>写作台</b>：按章生成草稿（生成 → 编辑 → 提意见重生成 → 采纳为正式章节），生成前可预览并直接修改完整提示词。</li>
        <li><b>风格库</b>：全局风格独立于作品，支持丢入小说原文让 AI 沉淀风格画像与语言/动作/场面示例，生成时可多风格叠加。</li>
        <li><b>生成历史</b>：每次模型调用完整落盘，可追溯、可恢复为草稿。</li>
      </ul>
      <p className="text-xs text-stone-400">版本 0.1.2 · 数据 100% 本地 · 模型接入完全自定义</p>
    </div>
  );
}

function ModelsListPage({
  config,
  onAdd,
  onEdit,
  onRemove,
  onMakeDefault,
}: {
  config: StoredConfig;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMakeDefault: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-stone-700">已添加的模型（{config.providers.length}）</h3>
        <button
          onClick={onAdd}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700"
        >
          ＋ 添加模型
        </button>
      </div>

      {config.providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-xs text-stone-400">
          还没有添加任何模型。
          <br />
          点击「＋ 添加模型」，支持智谱 GLM / 通义 Qwen / Kimi / DeepSeek / 小米 MiMo 预设，或完全自定义任意 OpenAI 兼容接口。
        </div>
      ) : (
        <div className="space-y-2">
          {config.providers.map((p) => (
            <div key={p.id} className="rounded-xl border border-stone-200 p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-800">
                    {p.name}
                    {config.activeId === p.id && (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">默认</span>
                    )}
                  </p>
                  <p className="truncate font-mono text-xs text-stone-400">
                    {p.model || "未设模型"} · {p.baseURL}
                  </p>
                </div>
                {config.activeId !== p.id && (
                  <button onClick={() => onMakeDefault(p.id)} className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50">
                    设为默认
                  </button>
                )}
                <button onClick={() => onEdit(p.id)} className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                  编辑
                </button>
                <button onClick={() => onRemove(p.id)} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-stone-400">各功能（写作台生成、配角/世界观填写、大纲续推、风格提炼）都可独立选择使用哪个模型。</p>
    </div>
  );
}

function ModelsEditPage({
  editing,
  preset,
  isNew,
  testing,
  onUpdate,
  onSave,
  onCancel,
  onTest,
}: {
  editing: ProviderConfig;
  preset: ReturnType<typeof presetByKey>;
  isNew: boolean;
  testing: boolean;
  onUpdate: (patch: Partial<ProviderConfig>) => void;
  onSave: () => void;
  onCancel: () => void;
  onTest: () => void;
}) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-stone-700">{isNew ? "添加模型" : "编辑模型"}</h3>
      <div className="mb-3">
        <label className="mb-1 block text-xs text-stone-500">服务商预设</label>
        <select
          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
          value={editing.preset}
          onChange={(e) => {
            const key = e.target.value;
            const np = presetByKey(key);
            onUpdate({ preset: key, name: np?.label ?? editing.name, baseURL: np?.baseURL ?? editing.baseURL });
          }}
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {preset?.hint && <p className="mt-1 text-xs text-stone-400">{preset.hint}</p>}
      </div>

      <div className="grid gap-3 text-sm">
        <input
          className="rounded-lg border border-stone-300 px-3 py-2"
          placeholder="名称（如：DeepSeek 官方）"
          value={editing.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
        <input
          className="rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs"
          placeholder="Base URL（以 /v1 结尾）"
          value={editing.baseURL}
          onChange={(e) => onUpdate({ baseURL: e.target.value })}
        />
        <input
          className="rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs"
          placeholder="API Key"
          type="password"
          value={editing.apiKey}
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
        />
        <input
          className="rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs"
          placeholder="模型名（纯自定义，任意值均可）"
          value={editing.model}
          onChange={(e) => onUpdate({ model: e.target.value })}
        />
        <label className="flex items-center gap-3 text-xs text-stone-600">
          温度 {editing.temperature.toFixed(1)}
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.1}
            value={editing.temperature}
            onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
          />
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={onSave} className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700">
          保存
        </button>
        <button
          onClick={onTest}
          disabled={testing}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-50"
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">
          取消
        </button>
      </div>
    </div>
  );
}
