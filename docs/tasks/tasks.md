# 任务列表

**最后更新:** 2026-06-07

---

## 进行中

_无_

---

## 待开始（按依赖顺序）

### 阶段 1 — 基础设施

| # | 任务 | 依赖 | 状态 |
|---|------|------|------|
| T-01 | 项目初始化：Electron + React + Node.js 脚手架 | 无 | done |
| T-02 | Skill 引擎：解析并索引两个仓库的全部 SKILL.md | T-01 | done |
| T-03 | 多模型路由层：Claude / DeepSeek / Kimi 统一接口 | T-01 | done |
| T-04 | 用户认证与 Stripe 订阅计费 | T-01 | pending |

### 阶段 2 — 核心功能

| # | 任务 | 依赖 | 状态 |
|---|------|------|------|
| T-05 | 核心对话 UI：Slash Command 补全 + 法律体系切换 | T-02, T-03 | pending |
| T-06 | 跨体系融合 Skills：6 个中美双体系对比 Skill | T-02, T-03 | pending |
| T-07 | 案件与文档管理：案件库 + 文档上传 + 会话历史搜索 | T-04, T-05 | pending |
| T-08 | 定时 Agent 面板：后台任务调度 + 桌面通知 | T-03, T-05 | pending |
| T-09 | 用量追踪与配额管理：Token 计量 + 超限控制 | T-03, T-04 | pending |
| T-11 | 本地模型引擎：本地推理引擎 sidecar（embedded 优先，兼容 Ollama）+ Qwen2.5-7B 下载管理 + 本地模式切换 | T-01, T-05 | done |

### 阶段 3 — 发布

| # | 任务 | 依赖 | 状态 |
|---|------|------|------|
| T-10 | Electron 打包分发：macOS + Windows + 自动更新 | T-05~T-09 | pending |

---

## 已完成

| # | 任务 | 完成日期 |
|---|------|---------|
| D-01 | 项目工作区结构搭建（目录、CLAUDE.md、CHANGELOG） | 2026-05-22 |
| D-02 | PRD 编写（v0.2） | 2026-05-22 |
| D-03 | 架构文档编写（Skill 格式、DB Schema、API Contract） | 2026-05-22 |
| D-04 | 导入参考仓库（claude-for-legal、ZH、claw-code） | 2026-05-22 |

---

## 任务详情

### T-01 — 项目初始化

**目标:** 搭建可运行的 Electron + React + Node.js 开发环境

**包含:**
- Electron 28 + Vite + React 18 + Tailwind CSS（`frontend/`）
- Node.js 20 + Fastify 4（`backend/`）
- Electron IPC Bridge（主进程 ↔ 渲染进程通信）
- `docker-compose.yml`（PostgreSQL 16 + Redis 7 本地开发）
- `.env.example` 列出所有必要环境变量
- `git init` + `.gitignore`（Node / Python / Electron / .env）
- 验证：`npm run dev` 能同时启动前后端并打开 Electron 窗口

---

### T-02 — Skill 引擎

**目标:** 解析两个仓库的 SKILL.md，构建可查询的 SkillRegistry

**包含:**
- 递归扫描 `references/claude-for-legal/` 和 `references/claude-for-legal-ZH/` 下所有 `SKILL.md`
- 解析 YAML frontmatter（name, description, argument-hint, user-invocable）
- 解析 Agent `.md` frontmatter（name, description, model, tools）
- 按 jurisdiction 标签索引（CN / US / INT / CROSS）
- `SkillRegistry.query(jurisdiction, userInvocable)` 接口
- `SkillEngine.buildSystemPrompt(skillId, practiceProfile)` 接口
- 详细格式见 `docs/architecture/skill-format.md`

---

### T-03 — 多模型路由层

**目标:** 统一接口调用 Claude / DeepSeek / Kimi，屏蔽模型差异

**包含:**
- `ModelRouter.call(messages, options)` 统一接口
- 按用户套餐（plan）自动选择默认模型
- Anthropic SDK 接入（含 Prompt Caching `cache_control`）
- DeepSeek API 接入
- Kimi API 接入
- 每次调用后记录 token 用量（input / output / cache_read / cache_creation）
- 详细见 `docs/architecture/api-contract.md`

---

### T-04 — 用户认证与计费

**目标:** 实现注册/登录和 Stripe 订阅管理

**包含:**
- Supabase Auth：邮箱密码 + Google OAuth
- JWT 令牌 Electron 本地加密存储（electron-store + keytar）
- Stripe：三档订阅创建/取消/续费
- Webhook 处理 `invoice.paid`、`customer.subscription.deleted`
- 详细见 `docs/architecture/database-schema.md`（users, subscriptions 表）

---

### T-05 — 核心对话 UI

**目标:** 实现完整的法律 AI 对话界面

**包含:**
- 对话消息列表（Markdown 渲染、代码高亮）
- 侧边栏法律体系切换（CN / US / 双体系融合）
- 输入框 `/` 触发 Slash Command 补全菜单（按体系过滤）
- 文件拖拽上传（PDF/Word/TXT）
- `[需验证]` / `[verify]` 标记高亮
- 每条响应底部固定免责声明
- Verify in browser using dev-browser skill

---

### T-06 — 跨体系融合 Skills

**目标:** 自研 6 个 CROSS jurisdiction 融合 Skill

**Skill 列表:**
1. `cross:cn-us-contract-review` — 中美合同双体系审查
2. `cross:cn-us-data-compliance` — PIPL vs GDPR/CCPA 对比
3. `cross:cross-border-ma` — 跨境并购尽职调查
4. `cross:cn-us-ip` — 中美知识产权对比
5. `cross:cross-border-labor` — 跨境劳动合规对比
6. `cross:dispute-resolution` — 跨境争议解决策略

每个 Skill 并行调用 CN + US System Prompt，输出双栏对比格式。

---

### T-07 — 案件与文档管理

**目标:** 实现案件库 UI 和后端

**包含:**
- 案件列表页 + 新建/编辑案件
- 文档上传（S3 预签名 URL，AES-256 加密）
- 会话历史列表（按案件过滤）
- 搜索：关键词 / 日期范围 / Skill 名
- 离线本地缓存（electron-store）
- 详细见 `docs/architecture/database-schema.md`（cases, documents, sessions 表）

---

### T-08 — 定时 Agent 面板

**目标:** 集成 headless agent，实现后台定时执行

**包含:**
- 后端 Cron 调度（node-cron）
- Agent 面板 UI（列表 + 启用/暂停开关）
- 执行结果 → 消息中心 + Electron Notification API
- Agent Token 计入配额
- 参考 `references/claude-for-legal/managed-agent-cookbooks/`

---

### T-09 — 用量追踪与配额管理

**目标:** Token 计量、超限告警和升级引导

**包含:**
- 每次 AI 调用后写入 `token_usage` 表
- 账户设置页用量仪表盘
- 80% / 100% 用量触发器（横幅 / 功能锁定）
- 详细见 `docs/architecture/database-schema.md`（token_usage 表）

---

### T-11 — 本地模型引擎

**目标:** 集成本地推理引擎 sidecar，实现 Qwen2.5-7B 下载管理和本地模式切换

**包含:**
- Electron 启动时自动检测并拉起本地推理引擎进程（sidecar），退出时关闭
- 默认方案为应用内嵌 runtime（embedded inference engine），不要求用户预装 Ollama
- 若系统已安装 Ollama，可作为兼容 provider 接入，但不是功能前提
- 模型管理 UI（设置页）：
  - 显示 Qwen2.5-7B-Instruct-Q4_K_M（~5GB）及其状态（未安装/下载中/已安装）
  - 下载进度条（实时速度、剩余时间、暂停/恢复）
  - 硬件检测：RAM < 16GB 时显示黄色警告
  - 已安装后显示"删除"按钮
- 顶部工具栏模式切换：云端模式 ↔ 本地模式（Qwen2.5-7B）
- 本地模式下 ModelRouter 路由到本地推理引擎统一接口；embedded runtime 为默认 provider，Ollama 为兼容 provider
- 本地模式下数据存 SQLite（`userData/local.db`）+ 本地文件系统，不走后端
- Verify in browser using dev-browser skill

**目标:** 生成可分发的安装包并配置自动更新

**包含:**
- electron-builder：macOS DMG（Universal Binary）+ Windows NSIS
- 代码签名：macOS notarization + Windows Authenticode
- electron-updater：自动检查并安装更新
- GitHub Actions CI/CD 自动触发打包
