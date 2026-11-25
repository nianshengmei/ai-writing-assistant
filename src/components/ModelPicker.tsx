"use client";

import type { ProviderConfig } from "@/lib/types";

/**
 * 功能级模型选择器：每个 AI 功能点旁边各放一个，各自独立选择模型。
 * 受控组件，状态由父组件的 useFeatureModel(featureKey) 管理。
 */
export default function ModelPicker({
  providers,
  value,
  onChange,
  disabled,
  className = "",
}: {
  providers: ProviderConfig[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (providers.length === 0) {
    return (
      <span className={`rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-600 ${className}`}>
        未配置模型（右上角 ⚙ 设置）
      </span>
    );
  }
  return (
    <select
      disabled={disabled}
      title="本功能使用的模型（各功能独立记忆）"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-stone-300 bg-stone-50 px-2 py-1.5 text-xs text-stone-700 ${className}`}
    >
      {providers.map((p) => (
        <option key={p.id} value={p.id}>
          🧠 {p.name} · {p.model || "未设模型"}
        </option>
      ))}
    </select>
  );
}
