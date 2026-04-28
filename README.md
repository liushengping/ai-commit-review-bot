# AI Commit Review Bot

> 🤖 AI 驱动的多平台 PR/MR 自动代码审查机器人。支持 GitHub、GitLab、Bitbucket、Gitea。

[![GitHub Actions](https://img.shields.io/badge/GitHub-Actions-blue?logo=githubactions)](https://github.com/features/actions)
[![GitLab CI](https://img.shields.io/badge/GitLab-CI-orange?logo=gitlab)](https://docs.gitlab.com/ee/ci/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-yellow?logo=node.js)](https://nodejs.org)

---

## ✨ 功能特点

### 核心功能
- 🔄 **自动触发** — PR/MR 创建或更新时自动运行代码审查
- 🧠 **多模型支持** — 支持 MiMo、Claude、GPT、DeepSeek 等任意 OpenAI 兼容 API
- 📊 **结构化评审** — 从 Bug、安全、性能、质量、缺失处理五个维度分析
- 💬 **行内评论** — 直接在 PR/MR 的具体代码行上标注问题
- 📂 **智能跳过** — 自动跳过 lock 文件、二进制文件、自动生成代码
- ✅ **自动审批** — 无问题时可自动 approve
- 📏 **智能截断** — 自动控制 diff 大小，避免 token 超限
- 🔄 **去重更新** — 同一 PR/MR 多次提交只更新评论，不重复发帖
- 🌍 **多语言** — 支持中文 / 英文审查报告
- ⚙️ **可配置** — 通过 `.review.yml` 自定义审查规则

### 🌐 多平台支持（v3.0 新增）
| 平台 | CI 环境 | 状态 |
|------|---------|------|
| **GitHub** | GitHub Actions | ✅ 完整支持 |
| **GitLab** | GitLab CI | ✅ 完整支持 |
| **Gitea** | Gitea Actions | ✅ 完整支持 |
| **Bitbucket** | Bitbucket Pipelines | ✅ 完整支持 |
| **本地/自定义** | 任意环境 | ✅ 通过环境变量 |

---

## 🚀 快速开始

### GitHub Actions

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
```

### GitLab CI

在仓库根目录创建 `.gitlab-ci.yml`：

```yaml
ai-code-review:
  stage: review
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    REVIEW_PLATFORM: gitlab
    GITLAB_TOKEN: $GITLAB_TOKEN
    AI_API_KEY: $AI_API_KEY
    AI_API_BASE_URL: "https://api.xiaomimimo.com/v1"
    AI_MODEL: "MiMo-V2.5-Pro"
  script:
    - npm install --production
    - node src/index.js
```

### Bitbucket Pipelines

在仓库根目录创建 `bitbucket-pipelines.yml`：

```yaml
pipelines:
  pull-requests:
    '**':
      - step:
          name: AI Code Review
          image: node:20
          script:
            - export REVIEW_PLATFORM=bitbucket
            - export BITBUCKET_TOKEN=$BITBUCKET_TOKEN
            - export AI_API_KEY=$AI_API_KEY
            - npm install --production
            - node src/index.js
```

### Gitea Actions

在仓库中创建 `.gitea/workflows/review.yml`：

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: liushengping/ai-commit-review-bot@main
        env:
          REVIEW_PLATFORM: gitea
          GITEA_TOKEN: ${{ secrets.GITEA_TOKEN }}
          GITEA_URL: "https://gitea.example.com"
        with:
          api-key: ${{ secrets.AI_API_KEY }}
```

### 本地/命令行运行

支持直接通过环境变量在任何环境运行：

```bash
export REVIEW_PLATFORM=gitlab
export GITLAB_TOKEN=glpat-xxx
export CI_PROJECT_ID=12345
export CI_MERGE_REQUEST_IID=42
export AI_API_KEY=sk-xxx
export AI_API_BASE_URL=https://api.xiaomimimo.com/v1

npm install --production
node src/index.js
```

---

## 📋 配置参数

### Action Inputs

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `platform` | ❌ | 自动检测 | SCM 平台：`github`、`gitlab`、`gitea`、`bitbucket` |
| `github-token` | ❌ | `${{ github.token }}` | GitHub Token |
| `gitlab-token` | ❌ | — | GitLab Token |
| `gitea-token` | ❌ | — | Gitea Token |
| `bitbucket-token` | ❌ | — | Bitbucket Token |
| `api-key` | ✅ | — | AI 模型 API Key |
| `api-base-url` | ❌ | `https://api.xiaomimimo.com/v1` | API 地址 |
| `model` | ❌ | `MiMo-V2.5-Pro` | 模型名称 |
| `fallback-model` | ❌ | — | 备用模型 |
| `review-language` | ❌ | `zh` | 审查语言 |
| `auto-approve` | ❌ | `false` | 无问题时自动审批 |
| `inline-comments` | ❌ | `true` | 行内评论 |

### 环境变量（非 Action 模式）

| 变量 | 说明 |
|------|------|
| `REVIEW_PLATFORM` | 平台名（github/gitlab/gitea/bitbucket） |
| `REVIEW_TOKEN` | 通用 Token（或用平台专用变量） |
| `GITLAB_TOKEN` | GitLab Token |
| `GITEA_TOKEN` / `GITEA_URL` | Gitea 配置 |
| `BITBUCKET_TOKEN` / `BITBUCKET_USERNAME` | Bitbucket 配置 |
| `AI_API_KEY` | AI API Key |
| `AI_API_BASE_URL` | AI API 地址 |
| `AI_MODEL` | 模型名称 |
| `AI_FALLBACK_MODEL` | 备用模型 |
| `REVIEW_LANGUAGE` | 审查语言 |
| `REVIEW_AUTO_APPROVE` | 自动审批 |
| `REVIEW_PR_NUMBER` | PR/MR 编号 |

---

## 🏗️ 架构设计

```
src/
├── core/                        # 平台无关的核心逻辑
│   ├── ai-client.js             # AI API 调用（OpenAI/Anthropic 兼容）
│   ├── reviewer.js              # 审查 prompt + 结果解析
│   ├── diff-parser.js           # diff 解析、行号映射、token 截断
│   ├── file-filter.js           # 文件过滤（跳过 lock/binary 等）
│   ├── config.js                # .review.yml 配置加载
│   ├── stats.js                 # 审查统计
│   └── notifier.js              # Webhook 通知（钉钉/企微/飞书/Slack）
│
├── platforms/                   # 平台适配层
│   ├── adapter.js               # 抽象基类（统一接口定义）
│   ├── github.js                # GitHub 适配器
│   ├── gitlab.js                # GitLab 适配器
│   ├── gitea.js                 # Gitea 适配器
│   ├── bitbucket.js             # Bitbucket 适配器
│   └── index.js                 # 工厂：自动检测 + 创建适配器
│
└── index.js                     # 统一入口（多平台路由）
```

### 适配器接口

每个平台适配器必须实现以下方法：

| 方法 | 说明 |
|------|------|
| `authenticate(credentials)` | 平台认证 |
| `getMergeRequestInfo()` | 获取 PR/MR 信息 |
| `getDiff(mrNumber, options)` | 获取 diff（支持增量） |
| `postOrUpdateSummaryComment()` | 发布/更新总结评论 |
| `postInlineComments()` | 发布行内评论 |
| `approve()` | 自动审批 |
| `addLabels()` | 添加标签 |
| `findLastReviewCommit()` | 查找上次审查 commit（增量审查） |
| `getMergeRequestUrl()` | 获取 MR/PR 链接 |

---

## ⚙️ 审查配置

在仓库根目录创建 `.review.yml` 自定义审查规则：

```yaml
review:
  language: zh
  auto_approve: true
  incremental: true

model:
  fallback: deepseek-chat

severity:
  block_threshold: error
  inline_threshold: warning

language_rules:
  - pattern: "*.py"
    prompt: "重点关注类型提示、f-string 安全"
  - pattern: "*.go"
    prompt: "重点关注 goroutine 泄露、error 处理"

webhooks:
  - type: dingtalk
    url: https://oapi.dingtalk.com/robot/send?access_token=xxx

labels:
  enabled: true
  prefix: ai-review

custom_prompt: |
  重点关注安全漏洞和性能问题

ignore:
  - "docs/"
  - "*.md"
```

---

## 📦 添加新平台

如需支持其他 SCM 平台（如 Azure DevOps、Phabricator 等），只需：

1. 创建 `src/platforms/your-platform.js`，继承 `PlatformAdapter`
2. 实现所有接口方法
3. 在 `src/platforms/index.js` 中注册
4. 在 `src/index.js` 的 `loadInputs()` 中添加环境变量映射

```javascript
// src/platforms/your-platform.js
const PlatformAdapter = require('./adapter');

class YourPlatformAdapter extends PlatformAdapter {
  get platformName() { return 'your-platform'; }
  async authenticate(credentials) { /* ... */ }
  async getMergeRequestInfo() { /* ... */ }
  async getDiff(mrNumber, options) { /* ... */ }
  async postOrUpdateSummaryComment(mrNumber, body, botMarker) { /* ... */ }
  async postInlineComments(mrNumber, comments) { /* ... */ }
  async approve(mrNumber, body) { /* ... */ }
  async addLabels(mrNumber, labels) { /* ... */ }
  async findLastReviewCommit(mrNumber, botMarker) { /* ... */ }
  getMergeRequestUrl(mrNumber) { /* ... */ }
}

module.exports = YourPlatformAdapter;
```

---

## License

MIT
