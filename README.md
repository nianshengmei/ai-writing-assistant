# AI 写作助手（ai-writing-assistant）

AI 小说写作神器：**记忆库 · 风格库 · 草稿工作流 · 生成历史全程落盘可追溯**。

## 核心设计

- **磁盘文件是唯一数据源**：全部内容以 JSON 文件保存在用户自选的数据目录，IndexedDB 只存可重建的导航索引。Tauri 壳（Rust）提供原子文件读写，WebView 通过适配层调用。
- **记忆库**：主角、配角、世界观（标签种类可自定义，可导入小说原文全量提取）、作者要求、后文预设、伏笔表（手动维护）+ 分层前情记忆（近 15 章逐章摘要 + 更早每 10 章段摘要）、全文脉络、后文预测（AI 辅助维护）。
- **记忆只整合不覆盖**：AI 更新记忆时必须完整保留原有设定，只做增补与修正；结果先在弹窗里逐项核对，点「应用并保存」才写盘。
- **全局风格库**：独立于作品。灌入素材自动分块提炼风格画像（含语言示例、动作描写、经典场面描写），支持手动增删改。生成时可叠加多条风格。
- **大纲双模式**：章节细纲手动维护；也可开「AI 讨论」边聊边定，敲定时把结论整理成大纲，已有章节整合保留、新章追加。
- **草稿工作流**：生成 → 编辑 → 提意见重新生成 → 作者采纳才写入正式章节；放弃则留档可恢复。采纳后点「更新本章记忆」一次补齐设定/前情/伏笔/脉络/后文预测。
- **提示词可见可编辑**：每个 AI 入口都是「顶部确定 + 下方可编辑 System / User / 补充要求」的确认弹窗；System 与补充要求按功能持久化到 `prompts.json`。
- **后文预测闭环**：上一章记忆更新时生成下一章预测；作者生成下一章前若没改过预测，会先弹窗让人过目确认，再进入提示词确认。
- **生成历史**：每次模型调用的完整提示词、输出、意见、状态全部落盘 `generations/`，可追溯、可恢复为草稿；记忆库等非正文调用另存 `ai-calls/`。

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

## 打包（无需本地安装 Rust）

**方式一：GitHub Actions 云端构建（推荐）**。仓库已内置 `.github/workflows/release.yml`，两种触发方式：

1. **手动构建**：GitHub 仓库页 → Actions → Release → Run workflow，跑完在 Artifacts 里下载各平台安装包（Windows exe/msi、macOS dmg、Linux AppImage/deb、Android APK）；
2. **发版**：推送 `v*` 标签（如 `git tag v0.1.0 && git push --tags`），自动创建带全部安装包的 Release（草稿状态，确认后发布）。

**方式二：本地构建**（需要 Rust 工具链，https://rustup.rs）：

```bash
npm run tauri:build          # Windows: exe/msi · macOS: app/dmg · Linux: AppImage/deb

# Android（需 Android SDK + NDK）
npx tauri android init
npx tauri android build
```

说明：AI 请求经 Tauri HTTP 插件发出（绕过 WebView CORS 限制）；导出经原生保存对话框落盘。CI 产物未签名——macOS 首次打开需右键 → 打开（或 `xattr -cr xxx.app`），Windows 有 SmartScreen 提示点"仍要运行"即可。

## 数据目录结构

```
数据根目录/
├── config.json            # 模型配置（API Key 也在此，注意备份）
├── prompts.json           # 各功能提示词的 System / 补充要求覆盖（全局）
├── styles/                # 全局风格库
└── w-xxxx/                # 每部作品一个目录
    ├── project.json       # 作品元信息
    ├── outline.json       # 章节目录（细纲的事实来源）
    ├── outline-chat.json  # 大纲 AI 讨论记录
    ├── memory/            # 主角 / 配角 / 世界观 / 作者要求 / 后文预设
    ├── foreshadows.json   # 伏笔表
    ├── recap.json         # 逐章前情摘要
    ├── recap-long.json    # 每 10 章段摘要（长篇记忆压缩）
    ├── story-arc.json     # 全文脉络（主线 / 阶段 / 关系演变）
    ├── future-prediction.json  # 后文预测（AI 版 + 作者版 + 过目时间）
    ├── worldview-categories.json # 世界观标签种类
    ├── drafts/            # 草稿（未采纳）
    ├── chapters/          # 正式章节（采纳后写入）
    ├── generations/       # 生成历史（一次调用一个文件）
    └── ai-calls/          # 记忆库等非正文 AI 调用记录
```

## 技术栈

Next.js 15（静态导出）· React 19 · Tailwind CSS 4 · Dexie（索引）· Tauri 2（Rust 壳，dialog/http 插件）
