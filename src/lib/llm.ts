import { isTauri } from "./env";
import type { ChatMessage, ProviderConfig } from "./types";

export interface StreamOptions {
  config: ProviderConfig;
  messages: ChatMessage[];
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  // 桌面/移动端经 Tauri HTTP 插件发请求，绕过 WebView 的 CORS 限制
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

export async function streamChat({ config, messages, onDelta, signal }: StreamOptions): Promise<string> {
  const url = config.baseURL.replace(/\/+$/, "") + "/chat/completions";
  const res = await doFetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature ?? 0.7,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`请求失败（HTTP ${res.status}）：${text.slice(0, 300)}`);
  }
  if (!res.body) throw new Error("响应没有内容流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta: string | undefined = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      } catch {
        // 跨 chunk 截断的 JSON 行，忽略等待下一段
      }
    }
  }
  return full;
}

export async function chatOnce(config: ProviderConfig, messages: ChatMessage[]): Promise<string> {
  return streamChat({ config, messages });
}

export async function testConnection(config: ProviderConfig): Promise<string> {
  return streamChat({
    config,
    messages: [{ role: "user", content: '请只回复四个字：连接成功' }],
  });
}
