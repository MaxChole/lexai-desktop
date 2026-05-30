# Skill 格式规范

**基于:** `references/claude-for-legal/` 和 `references/claude-for-legal-ZH/` 实际文件
**版本:** 1.0 — 2026-05-22

---

## 概述

Skills 是纯文本文件，由 YAML 前置元数据 + Markdown 指令正文组成。SkillEngine 读取这些文件，构建 System Prompt 后传给 LLM。

---

## 1. Skill 文件格式（SKILL.md）

### 文件路径规则

```
references/<repo>/<plugin>/<category>/skills/<skill-name>/SKILL.md
```

示例：
```
references/claude-for-legal/commercial-legal/skills/review/SKILL.md
references/claude-for-legal-ZH/commercial-legal/skills/review/SKILL.md
```

### YAML 前置元数据

```yaml
---
name: review                          # Skill 标识符（用于 slash command）
description: >                        # 一句话描述（用于菜单显示和命令匹配）
  Review a vendor agreement or NDA against your playbook.
argument-hint: '[file path | paste text]'  # 用户输入提示（可选）
user-invocable: true                  # true = 用户直接调用；false = 仅被其他 Skill 调用
---
```

### Markdown 正文

正文即为 System Prompt 的主体内容，包含：
- 技能目的说明
- 分步执行指令（带编号）
- 决策表格（路由规则、风险矩阵等）
- 输出格式模板

### 引用安全标记规则

- 中文 Skill：需要人工验证的引用用 `[需验证]` 标记
- 英文 Skill：用 `[verify]` 标记
- **SkillEngine 严禁在构建 System Prompt 时移除这些标记**

---

## 2. Agent 文件格式（agent-name.md）

### 文件路径规则

```
references/<repo>/<plugin>/<category>/agents/<agent-name>.md
```

示例：
```
references/claude-for-legal/commercial-legal/agents/renewal-watcher.md
```

### YAML 前置元数据

```yaml
---
name: renewal-watcher
description: >
  Scheduled agent that checks the renewal register and posts upcoming renewals.
  Runs weekly by default.
model: sonnet                         # 指定模型（sonnet / opus / haiku）
tools: ["Read", "Write", "mcp__ironclad__*", "mcp__*__slack_send_message"]
---
```

### Markdown 正文

包含：
- Purpose（目的）
- Schedule（执行频率）
- What it does（执行步骤，带编号）
- Output format（输出格式模板）
- What this agent does NOT do（明确边界）

---

## 3. 插件配置文件（CLAUDE.md）

每个插件目录下有 `CLAUDE.md`，存储用户的 Practice Profile（律所/公司配置）。

```
references/<repo>/<plugin>/<category>/CLAUDE.md
```

**内容结构：**
```markdown
# Commercial Contracts Practice Profile

## Who we are
[公司名称]、[规模]、[主要业务]...

## Who's using this
[角色]、[权限级别]...

## Available integrations
| Integration | Status |
|-------------|--------|
| CLM         | ✓/✗    |
| E-signature | ✓/✗    |

## Review preferences
confirm_routing: true/false

## Playbook
[用户自定义的审查标准...]
```

**SkillEngine 在构建 System Prompt 时必须注入用户对应的 Practice Profile 内容。**

---

## 4. 我们的 Skill 注册表（SkillRegistry）

### jurisdiction 标签规则

| 标签 | 来源 | 说明 |
|------|------|------|
| `CN` | claude-for-legal-ZH | 中国法律体系 |
| `US` | claude-for-legal（US 专属部分） | 美国法律 |
| `INT` | claude-for-legal（国际部分） | 国际法 |
| `CROSS` | 自研 | 跨体系融合（同时调用 CN + US） |

### Skill ID 命名规则

```
<jurisdiction>:<plugin>:<skill-name>

示例：
cn:commercial-legal:review
us:commercial-legal:nda-review
cross:cn-us-contract-review
```

### SkillRegistry 数据结构

```typescript
interface SkillMeta {
  id: string;                    // "cn:commercial-legal:review"
  name: string;                  // "review"
  plugin: string;                // "commercial-legal"
  jurisdiction: 'CN' | 'US' | 'INT' | 'CROSS';
  description: string;
  argumentHint?: string;
  userInvocable: boolean;
  filePath: string;              // 原始 SKILL.md 绝对路径
  systemPromptRaw: string;       // SKILL.md 正文（未注入 profile）
}

interface AgentMeta {
  id: string;
  name: string;
  plugin: string;
  jurisdiction: 'CN' | 'US' | 'INT';
  description: string;
  model: 'sonnet' | 'opus' | 'haiku';
  tools: string[];
  filePath: string;
  instructionsRaw: string;
}
```

### System Prompt 构建顺序

```
1. [cache_control: ephemeral 标记开始]
2. Skill 的 Markdown 正文（来自 SKILL.md）
3. 用户的 Practice Profile（来自 CLAUDE.md 用户配置）
4. [cache_control 标记结束]
5. 用户输入（不进缓存）
```

---

## 5. CROSS Skill 格式

跨体系融合 Skill 格式与普通 Skill 相同，但执行时特殊处理：

```yaml
---
name: cn-us-contract-review
description: >
  并行使用中国法和美国法审查合同，输出双栏对比风险报告。
argument-hint: '[合同文件路径 | 粘贴文本]'
user-invocable: true
jurisdiction: CROSS
cn-skill-ref: cn:commercial-legal:review    # 引用的 CN Skill
us-skill-ref: us:commercial-legal:review    # 引用的 US Skill
---
```

执行时 SkillEngine 并行发起两个 LLM 请求，合并结果为双栏对比格式后返回。
