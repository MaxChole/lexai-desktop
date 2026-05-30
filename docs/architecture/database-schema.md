# 数据库 Schema

**数据库:** PostgreSQL 16
**版本:** 1.0 — 2026-05-22

---

## 表结构总览

```
users
  └── subscriptions (1:1)
  └── cases (1:N)
       └── documents (1:N)
       └── sessions (1:N)
  └── token_usage (1:N)
  └── agent_configs (1:N)
  └── notifications (1:N)
  └── practice_profiles (1:N, 按 plugin 分)
```

---

## 表定义

### `users`

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  supabase_id   TEXT NOT NULL UNIQUE,   -- Supabase Auth 用户 ID
  plan          TEXT NOT NULL DEFAULT 'starter'
                  CHECK (plan IN ('starter', 'professional', 'enterprise')),
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('member', 'admin')),
  org_id        UUID REFERENCES orgs(id),   -- 企业版关联组织
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `orgs`（企业版）

```sql
CREATE TABLE orgs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  owner_id      UUID NOT NULL,           -- 管理员 user_id
  token_quota   INTEGER NOT NULL DEFAULT 10000000,  -- 月度配额（tokens）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `subscriptions`

```sql
CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id  TEXT NOT NULL UNIQUE,
  stripe_customer_id      TEXT NOT NULL,
  plan                    TEXT NOT NULL CHECK (plan IN ('starter', 'professional', 'enterprise')),
  status                  TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  current_period_start    TIMESTAMPTZ NOT NULL,
  current_period_end      TIMESTAMPTZ NOT NULL,
  token_quota             INTEGER NOT NULL,     -- 该周期 token 上限
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `cases`

```sql
CREATE TABLE cases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  jurisdiction TEXT CHECK (jurisdiction IN ('CN', 'US', 'INT', 'CROSS', 'ALL')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cases_user_id ON cases(user_id);
CREATE INDEX idx_cases_tags ON cases USING GIN(tags);
```

### `documents`

```sql
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  s3_key      TEXT NOT NULL UNIQUE,    -- S3 对象路径（加密存储）
  size_bytes  INTEGER NOT NULL,
  mime_type   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_case_id ON documents(case_id);
```

### `sessions`（对话历史）

```sql
CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id      UUID REFERENCES cases(id) ON DELETE SET NULL,
  skill_id     TEXT,              -- "cn:commercial-legal:review"
  jurisdiction TEXT CHECK (jurisdiction IN ('CN', 'US', 'INT', 'CROSS')),
  model        TEXT NOT NULL,     -- 实际使用的模型
  messages     JSONB NOT NULL DEFAULT '[]',
                                  -- [{role, content, timestamp}]
  title        TEXT,              -- 自动生成的会话标题
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_case_id ON sessions(case_id);
CREATE INDEX idx_sessions_skill_id ON sessions(skill_id);
CREATE INDEX idx_sessions_messages ON sessions USING GIN(messages);
```

### `token_usage`

```sql
CREATE TABLE token_usage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id            UUID REFERENCES sessions(id) ON DELETE SET NULL,
  model                 TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,   -- Prompt Cache 命中
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,   -- Prompt Cache 写入
  cost_usd              NUMERIC(10, 6),               -- 估算成本（可选）
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_token_usage_user_id ON token_usage(user_id);
CREATE INDEX idx_token_usage_created_at ON token_usage(created_at);
```

### `agent_configs`（用户的 Agent 启用配置）

```sql
CREATE TABLE agent_configs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL,          -- "cn:commercial-legal:renewal-watcher"
  enabled      BOOLEAN NOT NULL DEFAULT false,
  cron_expr    TEXT,                   -- 覆盖默认 cron（NULL = 使用默认）
  last_run_at  TIMESTAMPTZ,
  last_status  TEXT CHECK (last_status IN ('success', 'error', 'running')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_id)
);
```

### `notifications`

```sql
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id    TEXT,              -- 来源 agent（可选）
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id_read ON notifications(user_id, read);
```

### `practice_profiles`（用户的 Practice Profile，对应 CLAUDE.md 配置）

```sql
CREATE TABLE practice_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id   TEXT NOT NULL,      -- "commercial-legal"、"corporate-legal" 等
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('CN', 'US', 'INT')),
  content     TEXT NOT NULL,      -- CLAUDE.md 格式的配置文本
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, plugin_id, jurisdiction)
);
```

---

## Redis 使用

| Key 模式 | 内容 | TTL |
|----------|------|-----|
| `session:{session_id}:stream` | 流式响应缓冲 | 5 分钟 |
| `user:{user_id}:token_count` | 当月 Token 累计（快速读取） | 重置到月底 |
| `skill_registry:snapshot` | SkillRegistry 序列化缓存 | 1 小时 |
| `rate_limit:{user_id}` | 请求频率限制计数 | 1 分钟 |

---

## Migrations 策略

- 使用 `node-pg-migrate` 管理 migration 文件
- 路径：`backend/src/db/migrations/`
- 命名规则：`{timestamp}_{description}.sql`
- 每次数据库结构变更必须新建 migration 文件，不直接修改已有 migration
