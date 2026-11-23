# AI 写作助手（ai-writing-assistant）

AI 小说写作神器：**记忆库 · 风格库 · 草稿工作流 · 生成历史全程落盘可追溯**。

## 核心设计

- **磁盘文件是唯一数据源**：全部内容以 JSON 文件保存在用户自选的数据目录，IndexedDB 只存可重建的导航索引。Tauri 壳（Rust）提供原子文件读写，WebView 通过适配层调用。
- **七类记忆**：主角、配角、世界观、作者要求、后文预设（手动维护）+ 前情记忆、上一章记忆（自动维护）。
- **全局风格库**：独立于作品。灌入素材自动分块提炼风格画像（含语言示例、动作描写、经典场面描写），支持手动增删改。生成时可叠加多条风格。
- **草稿工作流**：生成 → 编辑 → 提意见重新生成 → 作者采纳才写入正式章节；放弃则留档可恢复。
- **提示词可预览**：生成前可查看组装后的完整 System + User 提示词。
- **生成历史**：每次模型调用的完整提示词、输出、意见、状态全部落盘 `generations/`，可追溯、可恢复为草稿。

## 模型支持

设置内置四家国产预设（均为 OpenAI 兼容协议，填 API Key 即用）：

| 服务商 | Base URL | 默认模型 |
|---|---|---|
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | glm-4.6 |
| 通义 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-plus |
| Kimi（月之暗面） | `https://api.moonshot.cn/v1` | kimi-k2-turbo-preview |
| 小米 MiMo | `https://api.xiaomimimo.com/v1` | mimo-v2.6-flash |

另支持自定义（DeepSeek / Ollama / one-api 等任意 OpenAI 兼容服务）。

## 开发

```bash
npm install
npm run dev        # 浏览器模式（数据存 IndexedDB 模拟层，便于调试）
```

## 打包（Tauri 2，一套代码四端）

需要 Rust 工具链（https://rustup.rs）：

```bash
# 桌面端
npm run tauri:build          # Windows: exe/msi · macOS: app/dmg · Linux: AppImage/deb

# Android（需 Android SDK + NDK）
npx tauri android init
npx tauri android build
```

AI 请求经 Tauri HTTP 插件发出（绕过 WebView CORS 限制）；导出经原生保存对话框落盘。

## 数据目录结构

```
数据根目录/
├── config.json            # 模型配置（API Key 也在此，注意备份）
├── styles/                # 全局风格库
└── w-xxxx/                # 每部作品一个目录
    ├── project.json       # 作品元信息
    ├── outline.json       # 章节目录（细纲的事实来源）
    ├── memory/            # 七类记忆
    ├── drafts/            # 草稿（未采纳）
    ├── chapters/          # 正式章节（采纳后写入）
    ├── generations/       # 生成历史（一次调用一个文件）
    └── foreshadows.json
```

## 技术栈

Next.js 15（静态导出）· React 19 · Tailwind CSS 4 · Dexie（索引）· Tauri 2（Rust 壳，dialog/http 插件）
