import type { ProviderConfig } from "./types";

export interface ProviderPreset {
  key: string;
  label: string;
  baseURL: string;
  model: string;
  models: string[];
  hint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "zhipu",
    label: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.6",
    models: ["glm-4.6", "glm-4.5", "glm-4-plus", "glm-4-flash"],
    hint: "开放平台 bigmodel.cn 获取 API Key",
  },
  {
    key: "qwen",
    label: "通义 Qwen",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"],
    hint: "阿里云百炼控制台获取 API Key（兼容模式地址）",
  },
  {
    key: "kimi",
    label: "Kimi（月之暗面）",
    baseURL: "https://api.moonshot.cn/v1",
    model: "kimi-k2-turbo-preview",
    models: ["kimi-k2-turbo-preview", "moonshot-v1-128k", "moonshot-v1-32k"],
    hint: "Moonshot 开放平台获取 API Key",
  },
  {
    key: "xiaomi",
    label: "小米 MiMo",
    baseURL: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-flash",
    models: ["mimo-v2.6-pro", "mimo-v2.6-flash"],
    hint: "小米 MiMo 开放平台（mimo.mi.com）创建 API Key，sk- 开头",
  },
  {
    key: "custom",
    label: "自定义（OpenAI 兼容）",
    baseURL: "",
    model: "",
    models: [],
    hint: "任意 OpenAI 兼容服务：DeepSeek、Ollama、one-api 网关等",
  },
];

export function presetByKey(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.key === key);
}

export function newProvider(presetKey: string): ProviderConfig {
  const preset = presetByKey(presetKey);
  return {
    id: `prov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    preset: presetKey,
    name: preset?.label ?? "自定义",
    baseURL: preset?.baseURL ?? "",
    apiKey: "",
    model: preset?.model ?? "",
    temperature: 0.7,
  };
}
