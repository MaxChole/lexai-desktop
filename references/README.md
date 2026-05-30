# References 参考源码说明

本目录存放只读参考源码，用于理解 Skill 格式、Agent 结构和 Agent 运行时架构。

**规则：只读，不修改。** 编写代码时从这里获取灵感和格式参考。

---

## 目录说明

### `claude-for-legal/` — 国际法律 Skills（原版）

- **来源:** https://github.com/anthropics/claude-for-legal
- **用途:** 国际法律 Skill 格式参考、Agent 定义格式、MCP 连接器配置
- **重点文件:**
  - `commercial-legal/skills/review/SKILL.md` — 最完整的 Skill 示例
  - `commercial-legal/agents/renewal-watcher.md` — Agent 格式示例
  - `commercial-legal/CLAUDE.md` — Practice Profile 配置模板
  - `managed-agent-cookbooks/` — headless agent 完整实现

### `claude-for-legal-ZH/` — 中文法律 Skills（fork）

- **来源:** https://github.com/CSlawyer1985/claude-for-legal-ZH
- **用途:** 中文法律 Skill 格式参考，与原版的差异（法律引用替换、MCP 连接器替换）
- **重点文件:**
  - `commercial-legal/skills/review/SKILL.md` — 对比原版 review Skill 的中文化
  - `docs/` — 中国法律引用规范文档

### `claw-code/` — Agent 运行时架构参考

- **来源:** 本地提供
- **用途:** 多 Agent 协调系统架构参考，特别是 SkillEngine 和 AgentRunner 的设计模式
- **重点文件:**
  - `PHILOSOPHY.md` — 核心设计哲学（人设方向，Agent 执行）
  - `prd.json` — 用户故事格式参考（即我们 docs/tasks/ 的格式来源）
  - `src/skills/` — Skill 解析和执行实现参考
  - `src/coordinator/` — 多 Agent 协调参考
  - `CLAUDE.md` — Rust 工作区约定

---

## 快速索引：我要找什么

| 我在找... | 去哪里看 |
|----------|---------|
| Skill YAML 前置元数据格式 | `claude-for-legal/commercial-legal/skills/review/SKILL.md` |
| Agent .md 格式 | `claude-for-legal/commercial-legal/agents/renewal-watcher.md` |
| Practice Profile (CLAUDE.md) 结构 | `claude-for-legal/commercial-legal/CLAUDE.md` |
| 中文 Skill 示例 | `claude-for-legal-ZH/commercial-legal/skills/review/SKILL.md` |
| Agent 运行时设计 | `claw-code/src/coordinator/` + `claw-code/PHILOSOPHY.md` |
| prd.json / 任务格式 | `claw-code/prd.json` |
| MCP 连接器配置 | `claude-for-legal/CONNECTORS.md` |
| 中文法律数据库连接器 | `claude-for-legal-ZH/CONNECTORS.md` |
