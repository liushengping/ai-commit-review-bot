# AI Commit Review Bot

> 🤖 AI 驱动的 GitHub PR 自动代码审查机器人。支持 MiMo、Claude、GPT 等主流模型。

[![GitHub Actions](https://img.shields.io/badge/GitHub-Actions-blue?logo=githubactions)](https://github.com/features/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-yellow?logo=node.js)](https://nodejs.org)

---

## ✨ 功能特点

### 核心功能
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

### v2.0 新增功能
- 🔁 **API 重试 & 模型降级** — 自动重试失败请求，主模型不可用时自动切换备用模型
- 📊 **全局 Token 控制** — 跨文件 token 预算管理，智能截断防止超限
- 🎯 **行号精确映射** — diff 行号自动映射到新文件实际行号，行内评论不再标错位置
- 🔄 **增量审查** — 多次 push 时只审查新增变更，节省 token 和时间
- 📈 **审查统计** — 自动记录审查历史，生成统计报告（问题趋势、高频类别等）
- 🔗 **Webhook 通知** — 支持钉钉、企业微信、Slack、飞书、自定义 webhook
- 🏷️ **PR 自动打标** — 根据审查结果自动添加标签（`ai-review:bug`、`ai-review:security` 等）
- 📝 **语言规则** — 按文件类型/框架配置专项审查规则（Python、Go、Java、SQL 等）
- 🛡️ **错误信息脱敏** — API 调用失败时自动脱敏，防止 key/token 泄露到日志
- 📋 **Draft PR 跳过** — 自动跳过草稿 PR，`ready_for_review` 时再触发
- 📊 **GitHub Job Summary** — 审查统计直接写入 Actions Job Summary 页面
- ✅ **单元测试** — 核心模块完整测试覆盖

## 🚀 快速开始

### 1. 创建 workflow

在你的仓库中创建 `.github/workflows/review.yml`：

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

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
          fallback-model: 'deepseek-chat'
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
  incremental: true      # 增量审查

model:
  fallback: deepseek-chat # 备用模型

severity:
  block_threshold: error      # error 及以上会阻止合并
  inline_threshold: warning   # warning 及以上会生成行内评论

# 语言专项规则
language_rules:
  - pattern: "*.py"
    prompt: "重点关注类型提示、f-string 安全、GIL 并发问题"
  - pattern: "*.go"
    prompt: "重点关注 goroutine 泄露、error 处理"

# Webhook 通知
webhooks:
  - type: dingtalk
    url: https://oapi.dingtalk.com/robot/send?access_token=xxx

# PR 自动打标
labels:
  enabled: true
  prefix: ai-review

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
| `fallback-model` | ❌ | — | 备用模型（主模型失败时自动切换） |
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
| `review.incremental` | 增量审查 | `true` |
| `model.fallback` | 备用模型 | — |
| `severity.block_threshold` | 阻止阈值 | `critical` |
| `severity.inline_threshold` | 行内评论阈值 | `warning` |
| `language_rules` | 语言专项规则 | `[]` |
| `custom_prompt` | 自定义审查提示 | — |
| `ignore` | 忽略的文件/路径 | `[]` |
| `webhooks` | Webhook 通知配置 | `[]` |
| `labels.enabled` | 自动打标 | `false` |
| `labels.prefix` | 标签前缀 | `ai-review` |
| `stats.enabled` | 统计追踪 | `true` |

## 🔧 支持的模型

| 模型 | api-base-url | model |
|------|-------------|-------|
| **Xiaomi MiMo** | `https://api.xiaomimimo.com/v1` | `MiMo-V2.5-Pro` |
| **OpenAI GPT-4o** | `https://api.openai.com/v1` | `gpt-4o` |
| **Claude** | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` (需设置 `provider: anthropic`) |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **其他 OpenAI 兼容** | 自定义 API 地址 | 对应模型名 |

## 🔗 Webhook 通知

支持将审查结果推送到以下平台：

| 平台 | type | 说明 |
|------|------|------|
| 钉钉机器人 | `dingtalk` | 钉钉群机器人 webhook |
| 企业微信 | `wecom` | 企业微信群机器人 webhook |
| Slack | `slack` | Slack incoming webhook |
| 飞书机器人 | `feishu` | 飞书群机器人 webhook |
| 通用 webhook | `generic` | 自定义 HTTP 接口，接收 JSON |

配置示例：

```yaml
webhooks:
  - type: dingtalk
    url: https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN
  - type: wecom
    url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY
  - type: generic
    url: https://your-server.com/webhook
    secret: optional-hmac-secret  # 可选：HMAC 签名验证
```

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

### 增量审查
多次 push 时只审查新增变更：
```
> 🆕 **Incremental review** — only reviewing changes since last review
```

### 审查统计
```
### 📈 Review Statistics
- Files reviewed: 8
- Files skipped: 3
- Total changes: +120 -45
- Review duration: 12s
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

## 🧪 开发与测试

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 监听模式
npm run test:watch
```

## 🏗️ 项目结构

```
ai-commit-review-bot/
├── .github/workflows/
│   └── review.yml          # 示例 GitHub Action 配置
├── src/
│   ├── index.js            # 主入口 (GitHub Action runner)
│   ├── ai-client.js        # AI API 调用封装 + 重试 + 脱敏
│   ├── diff-parser.js      # Git diff 解析器 + 行号映射 + token 估算
│   ├── reviewer.js         # 代码审查逻辑 + Prompt
│   ├── file-filter.js      # 智能文件过滤
│   ├── config.js           # 配置文件加载
│   ├── notifier.js         # Webhook 通知
│   ├── stats.js            # 审查统计
│   └── __tests__/          # 单元测试
│       ├── ai-client.test.js
│       ├── config.test.js
│       ├── diff-parser.test.js
│       ├── file-filter.test.js
│       ├── reviewer.test.js
│       └── stats.test.js
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
