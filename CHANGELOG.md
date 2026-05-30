# Changelog

所有重要变更记录在此文件中。  
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循语义化版本。

---

## [Unreleased]

### Added
- 初始化项目工作区结构（`frontend/`、`backend/`、`docs/`、`references/`）
- 创建 `CLAUDE.md` 项目工作规则
- 创建 PRD `docs/tasks/prd-legal-ai-desktop.md`
- 创建任务列表 `docs/tasks/tasks.md`
- 创建架构文档（Skill 格式规范、数据库 Schema、API Contract）
- 导入三个参考仓库（`claude-for-legal`、`claude-for-legal-ZH`、`claw-code`）

### Changed
- T-01 项目初始化完成：
  - Backend: Node.js 20 + Fastify 4 脚手架，健康检查接口 `/v1/health`
  - Frontend: Electron 28 + Vite + React 18 + Tailwind CSS 脚手架
  - Electron IPC Bridge（主进程 ↔ 渲染进程通信）
  - 共享类型定义 `backend/src/types/shared.ts`
  - `docker-compose.yml`（PostgreSQL 16 + Redis 7）
  - `.env.example` 列出全部环境变量
  - `git init` + `.gitignore`
  - `npm run dev` 可同时启动前后端
- T-02 Skill 引擎完成：
  - SkillRegistry: 递归扫描两个参考仓库，解析 301 个 SKILL.md 和 20 个 Agent .md
  - YAML frontmatter 解析器（支持 CRLF）
  - 按 jurisdiction 标签索引（CN 150 / US 151）
  - API 端点 `GET /v1/skills` 和 `GET /v1/agents`（按 jurisdiction/userInvocable 过滤）
  - SkillEngine.buildSystemPrompt(skillId, practiceProfile) 接口
- T-03 多模型路由层完成：
  - ModelRouter.call(options, plan) 统一接口
  - Anthropic SDK 适配（含 Prompt Caching `cache_control`）
  - DeepSeek API 适配
  - Kimi (Moonshot) API 适配
  - 按套餐自动选择默认模型 + 备选模型降级
  - Token 用量追踪（input/output/cache_read/cache_creation）
  - `POST /v1/chat` 端点串联 SkillEngine + ModelRouter
- AgentRunner 完整实现（基于 claw-code 架构）：
  - AgentRegistry: 单例模式，加载 20 个 headless agent 定义
  - AgentEngine: 多轮 LLM 对话循环，含 max_turns / max_budget / context compaction
  - ToolExecutor: Read/Write/WebSearch/MCP proxy 工具执行
  - AgentRunner: cron 调度 + 执行 + 持久化 + 通知
  - ModelRouter.callWithTools() 支持 Agent tool-use 调用
- 前端 Skill & Agent 联合展示：
  - 侧边栏按 jurisdiction 加载 Skills + Agents
  - Agent 带 `type: 'agent'` 标签和蓝色左边框区分
  - `GET /v1/agents` 端点返回 agent 元数据（含 defaultCron）

---

## 版本说明

| 标签 | 含义 |
|------|------|
| `Added` | 新增功能 |
| `Changed` | 对现有功能的修改 |
| `Deprecated` | 即将废弃 |
| `Removed` | 已删除 |
| `Fixed` | Bug 修复 |
| `Security` | 安全修复 |
