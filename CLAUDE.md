# LexAI Desktop — 项目工作规则

> **每次开始工作前必读此文件。** 本文件定义了项目结构、协作规则、架构决策和参考源码说明。

---

## 项目概述

**LexAI Desktop** 是一款 Electron 桌面应用，融合中国法律 AI Skills（`claude-for-legal-ZH`）和国际法律 AI Skills（`claude-for-legal`），为律师、法务和法学生提供统一的 AI 法律工作台。

用户订阅后即可使用，无需配置 API Key，服务商统一管理模型和 Token。支持多模型路由（Claude / DeepSeek / Kimi），按套餐分配模型质量。

**核心文档：**
- PRD: `docs/tasks/prd-legal-ai-desktop.md`
- 任务列表: `docs/tasks/tasks.md`
- Skill 格式规范: `docs/architecture/skill-format.md`
- 数据库 Schema: `docs/architecture/database-schema.md`
- API 接口约定: `docs/architecture/api-contract.md`

---

## 工作区结构

```
lexai-desktop/
├── CLAUDE.md                        ← 本文件，每次必读
├── CHANGELOG.md                     ← 每次 commit 必须更新
├── .env.example                     ← 环境变量模板（不含值）
├── docker-compose.yml               ← 本地开发环境（PostgreSQL + Redis）
├── docs/
│   ├── tasks/
│   │   ├── prd-legal-ai-desktop.md  ← 产品需求文档
│   │   └── tasks.md                 ← 任务列表与进度
│   └── architecture/
│       ├── skill-format.md          ← Skill/Agent 格式规范
│       ├── database-schema.md       ← 数据库表结构
│       └── api-contract.md          ← 前后端接口约定
├── frontend/                        ← Electron + React 前端
│   ├── src/
│   │   ├── renderer/                ← React UI 组件
│   │   ├── main/                    ← Electron Main Process
│   │   └── preload/                 ← Electron Preload Scripts
│   └── package.json
├── backend/                         ← Node.js Fastify API 服务
│   ├── src/
│   │   ├── routes/                  ← HTTP 路由
│   │   ├── services/
│   │   │   ├── skill-engine/        ← 解析并执行 SKILL.md
│   │   │   ├── model-router/        ← 多模型路由层
│   │   │   └── agent-runner/        ← 定时 Agent 执行（参考 claw-code）
│   │   ├── db/                      ← 数据库 migrations + queries
│   │   └── types/
│   │       └── shared.ts            ← 前后端共享类型
│   └── package.json
└── references/                      ← 参考源码（只读）
    ├── README.md                    ← 各仓库说明
    ├── claude-for-legal/            ← 国际法律 Skills 原版
    ├── claude-for-legal-ZH/         ← 中文法律 Skills fork
    └── claw-code/                   ← Agent 运行时架构参考
```

---

## 参考源码说明

### `references/claude-for-legal/` — 国际法律 Skills

**Skill 文件格式：** `<plugin>/<category>/skills/<skill-name>/SKILL.md`
```yaml
---
name: review
description: >
  一句话描述，用于 slash command 匹配
argument-hint: '[file path | ...]'
user-invocable: true   # false = 只被其他 skill 调用，不直接暴露给用户
---
# /command-name
## Instructions
...
```

**Agent 文件格式：** `<plugin>/<category>/agents/<agent-name>.md`
```yaml
---
name: renewal-watcher
description: >
  定时执行的 headless agent 描述
model: sonnet
tools: ["Read", "Write", "mcp__ironclad__*"]
---
# Agent Name
## Schedule / What it does / Output format
...
```

**插件配置：** 每个插件有 `CLAUDE.md`，存储用户的执法律事务所/公司配置（practice profile）。我们的 SkillEngine 需要支持类似的用户配置注入。

### `references/claude-for-legal-ZH/` — 中文法律 Skills

结构与原版相同，所有文本中文化，法律引用替换为中国法律体系（PIPL、公司法、民法典等），MCP 连接器替换为中国法律数据库（元典、北大法宝等）。

### `references/claw-code/` — Agent 运行时架构参考

一个 Python/Rust 多 Agent 协调系统，核心哲学：**人设方向，Agent 执行**。

我们从中借鉴的架构模式：
- `src/skills/` → 我们的 `skill-engine` 的 Skill 解析和执行模式
- `src/coordinator/` → 我们的 `agent-runner` 的任务调度模式
- `prd.json` 格式 → 我们的 `docs/tasks/` 文档格式
- Lane/Event 模式 → Agent 任务状态机设计

---

## 每次工作必须遵守的规则

### 规则 1 — 每次 commit 前更新 CHANGELOG

在 `CHANGELOG.md` 的 `[Unreleased]` 段追加变更：
```markdown
### Added / Changed / Fixed / Security
- 具体描述
```
**不更新 CHANGELOG，不得提交。**

### 规则 2 — 开工前先读 tasks.md

读 `docs/tasks/tasks.md`，确认当前任务和依赖。不做超出当前 Task 范围的工作。

### 规则 3 — 遇到 Skill 格式问题先查 references

设计 SkillEngine 相关代码前，先读：
- `references/claude-for-legal/commercial-legal/skills/review/SKILL.md`（完整示例）
- `docs/architecture/skill-format.md`（我们的格式规范）

### 规则 4 — 前后端严格分离

- **frontend/** 只做 UI 和 Electron IPC，不直接调 AI API
- **backend/** 只做业务逻辑、AI 调用、数据库
- 共享类型定义在 `backend/src/types/shared.ts`

### 规则 5 — 敏感信息不进 git

API Key、密码只放 `.env`。`.env.example` 必须列出所有变量名（无值）并保持同步。

### 规则 6 — 不过度设计

只实现当前 Task 要求的功能。函数在第二次复用时才提取为工具函数。禁止为"未来需求"预留接口或抽象层。

---

## 核心架构决策（已定，不再讨论）

### 多模型路由

| 套餐 | 默认模型 | 备选 |
|------|---------|------|
| 入门版 | DeepSeek-V3 | Kimi |
| 专业版 | claude-sonnet-4-6 | DeepSeek-V3 |
| 企业版 | claude-opus-4-6 | claude-sonnet-4-6 |

路由在 `backend/src/services/model-router/` 实现，SkillEngine 调用时无需关心具体模型。

### Skill 司法管辖区标签

| 标签 | 来源 |
|------|------|
| `CN` | claude-for-legal-ZH |
| `US` | claude-for-legal |
| `INT` | claude-for-legal（国际法部分） |
| `CROSS` | 自研跨体系融合 Skill |

### Prompt Caching

Skill 的 System Prompt 作为 Anthropic Prompt Caching 前缀，目标命中率 ≥ 60%。

### 技术栈（锁定）

| 层 | 技术 |
|----|------|
| 桌面壳 | Electron 28+ |
| 前端 | React 18 + Tailwind CSS + Vite |
| 后端 | Node.js 20 + Fastify 4 |
| 数据库 | PostgreSQL 16 + Redis 7 |
| 文件存储 | AWS S3（AES-256 加密） |
| 认证 | Supabase Auth |
| 计费 | Stripe |
| 监控 | Sentry |
