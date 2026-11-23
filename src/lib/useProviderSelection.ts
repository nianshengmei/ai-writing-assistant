import { useEffect, useState } from "react";
import { loadConfig } from "./library";
import type { ProviderConfig, StoredConfig } from "./types";

const STORAGE_KEY = "selectedProviderId";
const FEATURE_PREFIX = "modelSel:";

function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage 不可用时仅会话内生效
  }
}

export function getStoredProviderId(): string {
  return lsGet(STORAGE_KEY);
}

/** 全局默认模型（设置里的默认服务商），作为各功能的兜底初始值 */
export async function getSelectedProvider(): Promise<ProviderConfig | null> {
  const c: StoredConfig = await loadConfig();
  if (c.providers.length === 0) return null;
  const id = getStoredProviderId();
  const picked = id ? c.providers.find((p) => p.id === id) : null;
  return picked ?? c.providers.find((p) => p.id === c.activeId) ?? c.providers[0];
}

export function useProviderSelection() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    loadConfig().then((c) => {
      setProviders(c.providers);
      const stored = getStoredProviderId();
      const initial = c.providers.find((p) => p.id === stored)?.id ?? c.activeId ?? c.providers[0]?.id ?? "";
      setSelectedId(initial);
    });
  }, []);

  function select(id: string) {
    setSelectedId(id);
    lsSet(STORAGE_KEY, id);
  }

  return { providers, selectedId, select };
}

/**
 * 按功能独立的模型选择：每个 AI 功能点（写作台生成 / 配角填写 / 世界观填写 /
 * 大纲续推 / 风格提炼）各自持有选择，互不影响，选择持久化在 localStorage。
 * 初始值：该功能上次的选择 → 全局默认 → 设置默认 → 第一个。
 */
export function useFeatureModel(featureKey: string) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    loadConfig().then((c) => {
      setProviders(c.providers);
      const stored = lsGet(FEATURE_PREFIX + featureKey);
      const globalId = getStoredProviderId();
      const initial =
        c.providers.find((p) => p.id === stored)?.id ??
        c.providers.find((p) => p.id === globalId)?.id ??
        c.providers.find((p) => p.id === c.activeId)?.id ??
        c.providers[0]?.id ??
        "";
      setSelectedId(initial);
    });
  }, [featureKey, tick]);

  function select(id: string) {
    setSelectedId(id);
    lsSet(FEATURE_PREFIX + featureKey, id);
  }

  const picked = providers.find((p) => p.id === selectedId) ?? null;

  return { providers, selectedId, select, picked, reload: () => setTick((t) => t + 1) };
}
