# API Contract

**协议:** HTTPS REST + Server-Sent Events（流式响应）
**版本:** v1
**Base URL:** `https://api.lexai.app/v1`（本地开发：`http://localhost:3001/v1`）
**认证:** Bearer Token（JWT，由 Supabase Auth 签发）
**版本:** 1.0 — 2026-05-22

---

## 认证

所有接口（除 `/auth/*`）均需 Header：
```
Authorization: Bearer <jwt_token>
```

---

## 接口列表

### 认证

| Method | Path | 说明 |
|--------|------|------|
| POST | `/auth/register` | 邮箱注册 |
| POST | `/auth/login` | 邮箱登录 |
| GET | `/auth/me` | 获取当前用户信息 |
| POST | `/auth/logout` | 登出（清除服务端 session） |

---

### 订阅计费

| Method | Path | 说明 |
|--------|------|------|
| GET | `/subscriptions/plans` | 获取套餐列表（含价格） |
| POST | `/subscriptions` | 创建订阅（返回 Stripe Checkout URL） |
| GET | `/subscriptions/current` | 获取当前订阅状态 |
| DELETE | `/subscriptions/current` | 取消订阅 |
| POST | `/webhooks/stripe` | Stripe Webhook（无需 Auth） |

---

### Skills

| Method | Path | 说明 |
|--------|------|------|
| GET | `/skills` | 获取 Skill 列表 |
| GET | `/skills/:skillId` | 获取单个 Skill 元数据 |

**GET `/skills` 查询参数：**
```
jurisdiction: CN | US | INT | CROSS | ALL（默认 ALL）
userInvocable: true | false（默认 true）
```

**响应示例：**
```json
{
  "skills": [
    {
      "id": "cn:commercial-legal:review",
      "name": "review",
      "plugin": "commercial-legal",
      "jurisdiction": "CN",
      "description": "根据审查指引审查供应商协议...",
      "argumentHint": "[文件路径 | 粘贴文本]",
      "userInvocable": true
    }
  ]
}
```

---

### 对话（核心 AI 调用）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/chat/sessions` | 新建会话 |
| GET | `/chat/sessions/:sessionId` | 获取会话（含消息历史） |
| POST | `/chat/sessions/:sessionId/messages` | 发送消息（流式 SSE） |
| DELETE | `/chat/sessions/:sessionId` | 删除会话 |

**POST `/chat/sessions` 请求体：**
```json
{
  "caseId": "uuid（可选，绑定到案件）",
  "skillId": "cn:commercial-legal:review（可选）",
  "jurisdiction": "CN"
}
```

**POST `/chat/sessions/:sessionId/messages` 请求体：**
```json
{
  "content": "用户输入的文本",
  "attachments": [
    { "documentId": "uuid" }
  ]
}
```

**响应：Server-Sent Events 流**
```
Content-Type: text/event-stream

data: {"type": "content_delta", "delta": "根据您上传的"}
data: {"type": "content_delta", "delta": "合同，主要风险..."}
data: {"type": "usage", "inputTokens": 1200, "outputTokens": 450, "cacheReadTokens": 800}
data: {"type": "done"}
```

---

### 案件管理

| Method | Path | 说明 |
|--------|------|------|
| GET | `/cases` | 获取案件列表 |
| POST | `/cases` | 创建案件 |
| GET | `/cases/:caseId` | 获取案件详情（含文档列表、会话列表） |
| PATCH | `/cases/:caseId` | 更新案件 |
| DELETE | `/cases/:caseId` | 删除案件 |

**GET `/cases` 查询参数：**
```
q: 关键词搜索
tags: 标签过滤（逗号分隔）
jurisdiction: CN | US | INT | CROSS
page: 页码（默认 1）
pageSize: 每页数量（默认 20，最大 100）
```

**POST `/cases` 请求体：**
```json
{
  "title": "某科技公司 SaaS 合同审查",
  "description": "2026 Q3 续约谈判",
  "tags": ["SaaS", "合同审查"],
  "jurisdiction": "CN"
}
```

---

### 文档管理

| Method | Path | 说明 |
|--------|------|------|
| POST | `/cases/:caseId/documents/upload-url` | 获取 S3 预签名上传 URL |
| POST | `/cases/:caseId/documents` | 上传完成后登记文档记录 |
| GET | `/cases/:caseId/documents` | 获取文档列表 |
| DELETE | `/cases/:caseId/documents/:documentId` | 删除文档 |

**POST `/cases/:caseId/documents/upload-url` 请求体：**
```json
{
  "filename": "contract.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 1048576
}
```

**响应：**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "documentId": "uuid（提交 /documents 时使用）",
  "expiresIn": 300
}
```

---

### Agent 管理

| Method | Path | 说明 |
|--------|------|------|
| GET | `/agents` | 获取所有可用 Agent 列表（含用户启用状态） |
| GET | `/agents/:agentId` | 获取 Agent 详情 |
| PUT | `/agents/:agentId/config` | 更新 Agent 配置（启用/禁用/cron） |
| POST | `/agents/:agentId/run` | 手动触发 Agent（立即执行一次） |

**GET `/agents` 响应示例：**
```json
{
  "agents": [
    {
      "id": "cn:commercial-legal:renewal-watcher",
      "name": "renewal-watcher",
      "plugin": "commercial-legal",
      "jurisdiction": "CN",
      "description": "监控合同续签窗口...",
      "defaultCron": "0 9 * * 1",
      "model": "sonnet",
      "userConfig": {
        "enabled": true,
        "cronExpr": null,
        "lastRunAt": "2026-05-20T09:00:00Z",
        "lastStatus": "success"
      }
    }
  ]
}
```

---

### 消息通知

| Method | Path | 说明 |
|--------|------|------|
| GET | `/notifications` | 获取通知列表 |
| PATCH | `/notifications/:id/read` | 标记已读 |
| PATCH | `/notifications/read-all` | 全部标记已读 |

---

### 用量统计

| Method | Path | 说明 |
|--------|------|------|
| GET | `/usage/current` | 获取当月用量汇总 |
| GET | `/usage/history` | 获取历史用量（按日聚合） |
| GET | `/usage/team` | 企业版：获取团队成员用量（仅 admin） |

**GET `/usage/current` 响应：**
```json
{
  "plan": "professional",
  "periodStart": "2026-05-01T00:00:00Z",
  "periodEnd": "2026-05-31T23:59:59Z",
  "quota": 5000000,
  "used": {
    "total": 1234567,
    "inputTokens": 800000,
    "outputTokens": 234567,
    "cacheReadTokens": 150000,
    "cacheCreationTokens": 50000
  },
  "usagePercent": 24.7,
  "warningThreshold": 80,
  "hardLimit": 100
}
```

---

### Practice Profile（用户配置）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/profiles` | 获取所有 plugin 的配置列表 |
| GET | `/profiles/:pluginId/:jurisdiction` | 获取某 plugin 的配置 |
| PUT | `/profiles/:pluginId/:jurisdiction` | 更新某 plugin 的配置（CLAUDE.md 格式文本） |

---

## 错误格式

所有错误响应统一格式：
```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "当月 Token 配额已用完，请升级套餐后继续使用。",
    "details": {}
  }
}
```

**常见错误码：**

| Code | HTTP | 说明 |
|------|------|------|
| `UNAUTHORIZED` | 401 | Token 无效或已过期 |
| `FORBIDDEN` | 403 | 无权限访问该资源 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `QUOTA_EXCEEDED` | 429 | Token 配额已用完 |
| `RATE_LIMITED` | 429 | 请求频率超限 |
| `VALIDATION_ERROR` | 422 | 请求参数验证失败 |
| `MODEL_ERROR` | 502 | 上游模型 API 调用失败 |
| `INTERNAL_ERROR` | 500 | 服务内部错误 |

---

## Electron IPC 事件（前端 ↔ 主进程）

前端通过 Electron IPC 调用，主进程转发给后端 API：

| Channel | 方向 | 说明 |
|---------|------|------|
| `chat:stream` | renderer → main → backend | 发送消息并接收 SSE 流 |
| `chat:stream:chunk` | main → renderer | 转发流式 chunk |
| `notification:new` | main → renderer | 推送新通知（来自 Agent） |
| `auth:token:refresh` | renderer → main | 刷新 JWT |
| `file:upload:progress` | main → renderer | 文件上传进度 |
