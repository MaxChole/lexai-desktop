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
- 本地模式发送链路已支持 skill prompt：选中 skill 后，云端与本地模式都会携带 `skillId`，本地模式由 Electron Main 直接解析参考仓库中的 `SKILL.md`
- 本地模式选择已持久化到桌面端设置，重启后保留云端/本地运行模式
- 前端发送链路已接入桌面 IPC：云端模式走后端 `/chat`，本地模式直连本地推理接口
- 前端接入本地推理状态展示与模式切换入口，可在界面查看 embedded/Ollama provider、健康状态与当前云端/本地模式
- 将 T-11 和 PRD 的本地模式方案从“Ollama 唯一方案”调整为“embedded sidecar 优先，兼容 Ollama”
- 接入本地推理引擎 sidecar 骨架：Electron Main 负责启动、停止和健康检查本地 runtime
- ModelRouter 增加本地 provider 路由能力，支持 `embedded:` / `ollama:` 模型前缀和本地 OpenAI-compatible 接口
- `.env.example` 补充本地推理 sidecar 与 Ollama 兼容模式所需环境变量
- 修复本地开发环境依赖安装，恢复前后端 `npm run build` / `npm run typecheck` 可用
- 初始化并同步 `references/` 子模块，确保 Skill/Agent 索引基于真实参考仓库内容
- 后端统一改为自动解析 `references/` 绝对路径，避免不同启动目录下索引失败
- 修复 `POST /v1/chat` 首次传入 `skillId` 时不构建 System Prompt 的初始化问题
- Skill/Agent 查询结果改为稳定排序，并在列表接口返回 `total`
- Skill 引擎增加基于显式 frontmatter 与插件提示的 `INT` 司法管辖区识别
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
