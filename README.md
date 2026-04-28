# AI Commit Review Bot

> 🤖 AI 驱动的 GitHub PR 自动代码审查机器人。支持 MiMo、Claude、GPT 等主流模型。

[![GitHub Actions](https://img.shields.io/badge/GitHub-Actions-blue?logo=githubactions)](https://github.com/features/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-yellow?logo=node.js)](https://nodejs.org)

---

## ✨ 功能特点

- 🔄 **自动触发** — PR 创建或更新时自动运行代码审查
- 🧠 **多模型支持** — 支持 MiMo、Claude、GPT、DeepSeek 等任意 OpenAI 兼容 API
- 📊 **结构化评审** — 从 Bug、安全、性能、质量、缺失处理五个维度分析
- 💬 **自动评论** — 审查结果自动以 Markdown 格式评论到 PR
- 📏 **智能截断** — 自动控制 diff 大小，避免 token 超限
- 🔄 **去重更新** — 同一 PR 多次提交只更新评论，不重复发帖
- 🌍 **多语言** — 支持中文 / 英文审查报告

## 🚀 快速开始

### 1. Fork 或使用本项目

在你的仓库中创建 `.github/workflows/review.yml`：

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-username/ai-commit-review-bot@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          api-key: ${{ secrets.AI_API_KEY }}
          api-base-url: 'https://api.xiaomimimo.com/v1'
          model: 'MiMo-V2.5-Pro'
          review-language: 'zh'
```

### 2. 配置 API Key

在仓库 Settings → Secrets and variables → Actions 中添加：

| Secret | 说明 |
|--------|------|
| `AI_API_KEY` | 你的 AI 模型 API Key |

### 3. 提交 PR 测试

创建一个包含代码变更的 PR，机器人会自动运行审查并评论结果。

## 📋 配置参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `github-token` | ✅ | `${{ github.token }}` | GitHub Token |
| `api-key` | ✅ | — | AI 模型 API Key |
| `api-base-url` | ❌ | `https://api.xiaomimimo.com/v1` | API 地址 |
| `model` | ❌ | `MiMo-V2.5-Pro` | 模型名称 |
| `provider` | ❌ | `openai-compatible` | 提供商类型：`openai-compatible` / `anthropic` |
| `max-diff-lines` | ❌ | `500` | 最大 diff 行数 |
| `review-language` | ❌ | `zh` | 审查语言：`zh` / `en` |
| `skip-if-no-diff` | ❌ | `true` | 无代码变更时是否跳过 |

## 🔧 支持的模型

| 模型 | api-base-url | model |
|------|-------------|-------|
| **Xiaomi MiMo** | `https://api.xiaomimimo.com/v1` | `MiMo-V2.5-Pro` |
| **OpenAI GPT-4o** | `https://api.openai.com/v1` | `gpt-4o` |
| **Claude** | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` (需设置 `provider: anthropic`) |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **其他 OpenAI 兼容** | 自定义 API 地址 | 对应模型名 |

## 📸 审查效果

AI 会从五个维度对 PR 进行审查：

- 🐛 **潜在 Bug** — 逻辑错误、空指针、类型错误
- 🔒 **安全风险** — SQL 注入、XSS、敏感信息泄露
- ⚡ **性能问题** — 不必要的循环、内存泄漏
- 📝 **代码质量** — 命名规范、代码重复
- 📋 **缺失处理** — 缺少错误处理、输入校验

审查结果示例：

```
## 🟡 AI Code Review

**发现 2 个问题，整体代码质量良好。**

### Issues Found (2)

⚠️ **🔒 安全** — `src/auth.js:45`
> 使用 eval() 处理用户输入，存在代码注入风险
> 💡 **Suggestion:** 使用 JSON.parse() 或安全的表达式解析器替代

⚠️ **📋 缺失处理** — `src/api.js:12`
> 外部 API 调用缺少超时设置和错误重试机制
> 💡 **Suggestion:** 添加 AbortController 超时和指数退避重试
```

## 🏗️ 项目结构

```
ai-commit-review-bot/
├── .github/workflows/
│   └── review.yml          # 示例 GitHub Action 配置
├── src/
│   ├── index.js            # 主入口 (GitHub Action runner)
│   ├── ai-client.js        # AI API 调用封装
│   ├── diff-parser.js      # Git diff 解析器
│   └── reviewer.js         # 代码审查逻辑 + Prompt
├── action.yml              # GitHub Action 元数据
├── package.json
├── README.md
└── LICENSE
```

## 📄 License

[MIT](LICENSE)

---

> Built with ❤️ by AI | Powered by Xiaomi MiMo
