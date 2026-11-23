"use client";

import { useProviderSelection } from "@/lib/useProviderSelection";

/** 全局模型选择器：放在作品页顶栏，写作台 / 记忆库 / 大纲 / 生成历史全部跟随 */
export default function ModelSelector() {
  const { providers, selectedId, select } = useProviderSelection();

  if (providers.length === 0) {
    return <span className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">未配置模型（首页 → 设置）</span>;
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-stone-500">
      <span>模型</span>
      <select
        title="全局生效：写作台、记忆库、大纲、风格提炼均使用此模型"
        value={selectedId}
        onChange={(e) => select(e.target.value)}
        className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-700"
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            🧠 {p.name} · {p.model || "未设模型"}
          </option>
        ))}
      </select>
    </label>
  );
}
