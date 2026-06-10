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
- 本地模式新增“联网增强”第一版：前端输入区可切换联网增强，Electron Main 会在本地推理前先检索免费公开资料源并注入来源上下文，回答末尾附参考来源列表；当前默认走免费公开资料检索，并预留 `FREE_SEARCH_BASE_URL` 以兼容自建 SearXNG，同时补充了检索词清洗与官方站点优先排序，减少把自然语言礼貌词误当搜索关键词的问题
- 为桌面端新增独立“设置”视图：将离线引擎状态、模型管理和本地工作偏好从左侧工作台移入设置页，主界面只保留任务、案件、记录等高频工作入口，整体语义更清晰、更接近正式产品
- 进一步优化桌面端布局层级：侧边栏改为更宽的毛玻璃信息栏，法律体系切换改成分组按钮，主内容区和设置卡片统一为更大的圆角与留白，整体视觉密度明显下降，更接近成品桌面应用
- 继续统一主界面产品语言：将 `Embedded/Recommended/Experimental/Agent` 等工程化词汇替换为“内置引擎 / 推荐 / 高级 / 自动任务”等用户可理解表述，并同步收口模型管理、离线记录、消息提醒和工作偏好等区块标题
- 核心对话页去除了显式 `Skill` 暴露：左侧列表和 slash 主入口改为“任务模式 + 自动分析”产品形态，系统仍沿用后台 skill 路由，但前台默认只展示合同审查、文档总结、风险排查、起草回复、跨法域对照等任务入口
- 本地推荐模型现在内置 Qwen2.5-7B 的默认下载源；即使 `.env` 未填写 `LOCAL_LLM_MODEL_URL`，桌面端也能直接提供应用内下载入口，减少非技术用户的环境配置负担
- 精简并重排本地模型设置 UI：将“当前模型”和“离线模型列表”收束为更专业的“模型中心”结构，弱化说明式文案，突出状态、体积、内存要求、来源入口和下载动作
- 本地模型管理面板升级为“离线模型列表”视图：保留 Qwen2.5-7B 作为推荐的一键离线模型，并新增官方页面/下载地址入口；同时加入 DeepSeek V4 实验性条目，明确标注其运行时要求与当前桌面端不支持一键 embedded 运行的限制，便于非技术用户理解和选择
- 新增 [本地模式手测记录（2026-06-09）](/Users/wanghan/code/lexai-desktop/docs/tasks/local-mode-smoke-test-2026-06-09.md)，记录桌面端本地模式切换、附件入口验证，以及本地附件上下文参与模型生成的冒烟测试结果
- 本地 embedded runtime 现在支持带引号和空格路径的 `LOCAL_LLM_ARGS`，并完成基于 ModelScope + `llama-cpp-python` 的本地 Qwen2.5-7B 模型下载与测试接线
- Electron Main 在桌面端开发模式下会主动读取项目根目录 `.env`，避免本地推理 sidecar 配置已填写却未生效
- 本地推理 sidecar 启动时会隔离并覆盖子进程的 `HOST/PORT`，避免被项目根 `.env` 中的后端端口配置误导到 `3001`
- Electron 开发脚本现在显式注入 `NODE_ENV=development`，主进程也统一基于该标记加载 Vite dev server，避免 `npm run dev` 误打开旧的 `dist` 页面
- 本地推理 sidecar 不再把 Uvicorn 的常规 `INFO:` 日志误记为错误，健康检查成功后也会清空旧错误提示，避免桌面端把运行成功状态显示成红色报错
- T-06 从“融合答案”调整为“跨法域对照”工作流：新增 6 个 `CROSS` skills，SkillRegistry 支持加载本地 cross skills，云端与本地模式都会对 CN / US 两套 prompts 并行分析后按固定双栏模板输出
- T-10 打包分发链路已接入：前端新增 electron-builder / electron-updater 发布配置、macOS entitlements 与 notarize 脚本、GitHub Actions 打包工作流，并在 Electron Main 中接入生产环境自动更新检查
- T-08 定时 Agent 面板已落地：后端新增 Agent 配置与手动运行接口、通知读取接口和调度同步，Electron Main 新增桌面通知轮询，前端补充 Agent 面板、启停开关、立即执行和消息中心
- T-07 案件与文档管理已接入首个完整闭环：后端新增 `cases/documents/sessions` 数据层与案件搜索接口，云端聊天可绑定案件并写入会话历史，前端新增案件库、文档登记上传、案件内会话筛选与离线缓存
- T-09 用量追踪开始落地：云端聊天会在已登录状态下记录 `token_usage`，后端新增月度用量统计接口，前端新增账户用量卡与 80%/100% 用量提示
- T-05 核心对话 UI 明显收口：前端补充 Slash Command 技能补全、Markdown/代码渲染、验证标记高亮，以及本地模式拖拽上传入口
- T-04 认证与计费开始落地：后端新增 Supabase 邮箱注册/登录/当前用户接口、Stripe 订阅接口与 webhook 路由，Electron Main 新增本地加密会话令牌存储桥接
- 本地模式会话元数据已切到 SQLite：Electron Main 现在把本地会话、消息和附件索引写入 `userData/local.db`，附件内容仍存本地文件系统
- 本地模型管理面板已接入：支持查看 Qwen2.5-7B 安装状态、下载进度、速度、剩余时间、RAM 警告，以及下载/暂停/删除操作
- 本地模式发送链路已开始利用本地附件：会话中绑定的文件会在生成时自动注入附件上下文，TXT/Markdown 提供文本片段，二进制文档提供元数据说明
- 本地模式附件开始落到桌面端文件系统：可从界面选择 PDF/Word/TXT/Markdown 文件，复制到 `userData` 下本地工作区并绑定当前本地会话
- 本地模式聊天数据开始落到桌面端：Electron 侧已接入本地会话存储，支持保存、读取、切换和删除本地聊天历史，不再依赖后端会话接口
- 本地模式的 practice profile 已支持用户级本地覆盖：Electron 保存插件专属 profile，前端可直接编辑，生成 prompt 时优先使用本地内容再回退到仓库模板
- 本地模式 prompt 进一步对齐参考工作流：Electron Main 在解析 `SKILL.md` 之外，会同时注入对应插件的 `CLAUDE.md` practice profile 模板
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
