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
- 💬 **行内评论** — 直接在 PR 的具体代码行上标注问题（不只是整体评论）
- 📂 **智能跳过** — 自动跳过 lock 文件、二进制文件、自动生成代码、依赖目录
- ✅ **自动审批** — 无问题时可自动 approve PR
- 📏 **智能截断** — 自动控制 diff 大小，避免 token 超限
- 🔄 **去重更新** — 同一 PR 多次提交只更新评论，不重复发帖
- 🌍 **多语言** — 支持中文 / 英文审查报告
- ⚙️ **可配置** — 通过 `.review.yml` 自定义审查规则、忽略文件、严重级阈值

## 🚀 快速开始

### 1. 创建 workflow

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
      - uses: liushengping/ai-commit-review-bot@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          api-key: ${{ secrets.AI_API_KEY }}
          api-base-url: 'https://api.xiaomimimo.com/v1'
          model: 'MiMo-V2.5-Pro'
          review-language: 'zh'
          auto-approve: 'true'
          inline-comments: 'true'
```

### 2. 配置 API Key

在仓库 Settings → Secrets and variables → Actions 中添加：

| Secret | 说明 |
|--------|------|
| `AI_API_KEY` | 你的 AI 模型 API Key |

### 3. 可选：添加配置文件

在仓库根目录创建 `.review.yml` 自定义审查规则：

```yaml
review:
  language: zh
  auto_approve: true

severity:
  block_threshold: error      # error 及以上会阻止合并
  inline_threshold: warning   # warning 及以上会生成行内评论

custom_prompt: |
  重点关注安全漏洞和性能问题

ignore:
  - "docs/"
  - "*.md"
```

完整配置示例见 [.review.yml.example](.review.yml.example)。

## 📋 配置参数

### Action Inputs

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `github-token` | ✅ | `${{ github.token }}` | GitHub Token |
| `api-key` | ✅ | — | AI 模型 API Key |
| `api-base-url` | ❌ | `https://api.xiaomimimo.com/v1` | API 地址 |
| `model` | ❌ | `MiMo-V2.5-Pro` | 模型名称 |
| `provider` | ❌ | `openai-compatible` | 提供商类型 |
| `max-diff-lines` | ❌ | `500` | 最大 diff 行数 |
| `review-language` | ❌ | `zh` | 审查语言 |
| `auto-approve` | ❌ | `false` | 无问题时自动审批 |
| `inline-comments` | ❌ | `true` | 行内评论 |
| `block-threshold` | ❌ | `critical` | 阻止合并的最低严重级 |

### .review.yml 配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `review.language` | 审查语言 | `zh` |
| `review.auto_approve` | 自动审批 | `false` |
| `review.max_diff_lines` | 最大 diff 行数 | `500` |
| `severity.block_threshold` | 阻止阈值 | `critical` |
| `severity.inline_threshold` | 行内评论阈值 | `warning` |
| `custom_prompt` | 自定义审查提示 | — |
| `ignore` | 忽略的文件/路径 | `[]` |

## 🔧 支持的模型

| 模型 | api-base-url | model |
|------|-------------|-------|
| **Xiaomi MiMo** | `https://api.xiaomimimo.com/v1` | `MiMo-V2.5-Pro` |
| **OpenAI GPT-4o** | `https://api.openai.com/v1` | `gpt-4o` |
| **Claude** | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` (需设置 `provider: anthropic`) |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **其他 OpenAI 兼容** | 自定义 API 地址 | 对应模型名 |

## 📸 审查效果

### 整体评论
```
## 🟡 AI Code Review

**发现 2 个问题，整体代码质量良好。**
> Risk Level: MEDIUM
> ⚠️ 2 warning

### Issues Found (2)

⚠️ **🔒 安全** — `src/auth.js:45`
> 使用 eval() 处理用户输入，存在代码注入风险
> 💡 **Suggestion:** 使用 JSON.parse() 或安全的表达式解析器替代

⚠️ **📋 缺失处理** — `src/api.js:12`
> 外部 API 调用缺少超时设置和错误重试机制
> 💡 **Suggestion:** 添加 AbortController 超时和指数退避重试
```

### 行内评论
机器人会直接在 PR 的代码行上标注问题，开发者一眼就能看到问题所在。

## 📂 智能跳过

自动跳过以下文件类型，节省 token：
- Lock 文件（package-lock.json、yarn.lock 等）
- 自动生成代码（.generated.、.d.ts 等）
- 构建产物（dist/、build/、.next/ 等）
- 依赖目录（node_modules/、vendor/ 等）
- 二进制/媒体文件
- 超过 500 行的大文件
- 纯删除的文件

## 🏗️ 项目结构

```
ai-commit-review-bot/
├── .github/workflows/
│   └── review.yml          # 示例 GitHub Action 配置
├── src/
│   ├── index.js            # 主入口 (GitHub Action runner)
│   ├── ai-client.js        # AI API 调用封装
│   ├── diff-parser.js      # Git diff 解析器
│   ├── reviewer.js         # 代码审查逻辑 + Prompt
│   ├── file-filter.js      # 智能文件过滤
│   └── config.js           # 配置文件加载
├── action.yml              # GitHub Action 元数据
├── .review.yml.example     # 配置文件示例
├── package.json
├── README.md
└── LICENSE
```

## 📄 License

[MIT](LICENSE)

---

> Built with ❤️ by AI | Powered by Xiaomi MiMo
