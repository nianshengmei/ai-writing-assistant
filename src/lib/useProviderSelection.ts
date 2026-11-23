import { useEffect, useState } from "react";
import { loadConfig } from "./library";
import type { ProviderConfig, StoredConfig } from "./types";

const STORAGE_KEY = "selectedProviderId";

export function getStoredProviderId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** 全局"当前模型"：优先用户在写作台选择的，否则用设置的默认服务商 */
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
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage 不可用时仅会话内生效
    }
  }

  return { providers, selectedId, select };
}
