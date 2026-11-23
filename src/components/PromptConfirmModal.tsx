"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FEATURE_LABELS } from "@/lib/prompts";
import { loadPromptOverrides, savePromptOverride } from "@/lib/library";

export interface PromptConfirmPayload {
  system: string;
  user: string;
  extra: string;
}

interface Props {
  title?: string;
  featureKey: string;
  /** 恢复默认时使用的 System 原文 */
  defaultSystem: string;
  /** 本次生成的 User 原文（动态数据） */
  defaultUser: string;
  /** 弹窗内展示的附加信息，例如分组、调用次数、素材块数 */
  meta?: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (payload: PromptConfirmPayload) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * 统一提示词确认弹窗：顶部确定按钮，下方 System / User 可编辑。
 * - System 与「补充要求」按功能 key 持久化（prompts.json），下次自动带出
 * - User 含动态数据，编辑仅本次生效；实际发送内容会完整记录到生成历史
 */
export default function PromptConfirmModal({
  title,
  featureKey,
  defaultSystem,
  defaultUser,
  meta,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const [system, setSystem] = useState(defaultSystem);
  const [user, setUser] = useState(defaultUser);
  const [extra, setExtra] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPromptOverrides()
      .then((all) => {
        if (!alive) return;
        const o = all[featureKey];
        if (o?.system?.trim()) setSystem(o.system);
        if (o?.extra?.trim()) setExtra(o.extra);
      })
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [featureKey, defaultSystem]);

  async function handleConfirm() {
    setSaving(true);
    try {
      await savePromptOverride(featureKey, {
        system: system.trim() !== defaultSystem.trim() ? system : undefined,
        extra: extra.trim() ? extra : undefined,
      });
      await onConfirm({ system, user, extra });
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving || !loaded;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-medium">{title ?? FEATURE_LABELS[featureKey] ?? "确认提示词"}</h2>
            <p className="mt-0.5 text-xs text-stone-400">
              提示词可见可编辑；System 与补充要求会按功能保存，下次自动带出。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleConfirm}
              disabled={disabled}
              className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {saving ? "准备中…" : busy ? "生成中…" : confirmLabel ?? "确定并开始"}
            </button>
            <button onClick={onCancel} className="rounded-lg border border-stone-300 px-3 py-2 text-xs hover:bg-stone-50">
              取消
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 text-xs">
          {meta && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{meta}</div>}

          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-medium text-purple-700">System（可编辑）</h3>
            <button
              onClick={() => {
                setSystem(defaultSystem);
                setExtra("");
              }}
              className="text-xs text-stone-400 hover:text-stone-700"
            >
              恢复默认
            </button>
          </div>
          <textarea
            className="mb-4 min-h-40 w-full resize-y whitespace-pre-wrap rounded-lg bg-purple-50 p-3 font-mono leading-relaxed text-stone-800 outline-none focus:ring-1 focus:ring-purple-400"
            value={system}
            onChange={(e) => setSystem(e.target.value)}
          />

          <h3 className="mb-1 font-medium text-blue-700">User（本次可编辑，含本次记忆与章节数据）</h3>
          <textarea
            className="mb-4 min-h-64 w-full resize-y whitespace-pre-wrap rounded-lg bg-blue-50 p-3 font-mono leading-relaxed text-stone-800 outline-none focus:ring-1 focus:ring-blue-400"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />

          <h3 className="mb-1 font-medium text-green-700">补充要求（会保存，此后该功能自动追加到 User 末尾）</h3>
          <textarea
            className="min-h-16 w-full resize-y whitespace-pre-wrap rounded-lg bg-green-50 p-3 leading-relaxed text-stone-800 outline-none focus:ring-1 focus:ring-green-400"
            placeholder="例如：本章多写对话少写环境；不要出现现代词汇…"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
          <p className="mt-2 text-stone-400">
            点击确定后才会调用模型；实际发送的 System / User 会完整写入历史记录。
          </p>
        </div>
      </div>
    </div>
  );
}
