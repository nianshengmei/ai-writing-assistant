import { isTauri } from "./env";
import type { ChatMessage, ProviderConfig } from "./types";

export interface StreamOptions {
  config: ProviderConfig;
  messages: ChatMessage[];
  onDelta?: (text: string) => void;
  /** 推理模型的思考过程（reasoning_content）增量 */
  onReasoning?: (text: string) => void;
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

export { doFetch };

/** Anthropic /v1/messages 端点：baseURL 可带可不带 /v1 */
function claudeUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
}

/** Claude 要求 user/assistant 交替，把连续同角色的合并为一条 */
function mergeConsecutive(messages: { role: string; content: string }[]): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (!m.content) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${m.content}`;
    else out.push({ role, content: m.content });
  }
  return out;
}

async function streamClaude({ config, messages, onDelta, onReasoning, signal }: StreamOptions): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = mergeConsecutive(messages.filter((m) => m.role !== "system"));
  const res = await doFetch(claudeUrl(config.baseURL), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 8192,
      temperature: config.temperature ?? 0.7,
      stream: true,
      ...(system ? { system } : {}),
      messages: rest,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`请求失败（HTTP ${res.status}）：${text.slice(0, 300)}`);
  }

  const reader = res.body!.getReader();
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
        if (json.type === "error") throw new Error(json.error?.message ?? "Claude 流式错误");
        if (json.type !== "content_block_delta") continue;
        const d = json.delta ?? {};
        if (d.type === "thinking_delta" && d.thinking) onReasoning?.(d.thinking);
        if (d.type === "text_delta" && d.text) {
          full += d.text;
          onDelta?.(d.text);
        }
      } catch (e) {
        // 流式错误要往外抛；跨 chunk 截断的 JSON 行等待下一段
        if ((e as Error)?.message?.includes("Claude")) throw e;
      }
    }
  }
  return full;
}

export async function streamChat(options: StreamOptions): Promise<string> {
  if (options.config.kind === "claude") return streamClaude(options);
  const { config, messages, onDelta, onReasoning, signal } = options;
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
        const deltaObj = json.choices?.[0]?.delta;
        const reasoning: string | undefined = deltaObj?.reasoning_content;
        if (reasoning) onReasoning?.(reasoning);
        const delta: string | undefined = deltaObj?.content;
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
