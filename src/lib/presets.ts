import type { ProviderConfig } from "./types";

export interface ProviderPreset {
  key: string;
  label: string;
  baseURL: string;
  model: string;
  hint: string;
}

// 预设只是"快速填表"：baseURL 和默认模型名可以后续随便改。
// 模型名不做任何下拉限制，一律自由输入（纯自定义）。
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "zhipu",
    label: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5-turbo",
    hint: "开放平台 bigmodel.cn 获取 API Key",
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    hint: "DeepSeek 开放平台获取 API Key（sk- 开头）",
  },
  {
    key: "qwen",
    label: "通义 Qwen",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.6-plus",
    hint: "阿里云百炼控制台获取 API Key（兼容模式地址）",
  },
  {
    key: "kimi",
    label: "Kimi（月之暗面）",
    baseURL: "https://api.moonshot.cn/v1",
    model: "kimi-k2-turbo-preview",
    hint: "Moonshot 开放平台获取 API Key",
  },
  {
    key: "xiaomi",
    label: "小米 MiMo",
    baseURL: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-flash",
    hint: "小米 MiMo 开放平台（mimo.mi.com）创建 API Key，sk- 开头",
  },
  {
    key: "custom",
    label: "自定义（OpenAI 兼容）",
    baseURL: "",
    model: "",
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
