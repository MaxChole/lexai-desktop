// LexAI Backend — Shared Types (also used by frontend via preload)

export type Jurisdiction = 'CN' | 'US' | 'INT' | 'CROSS';

export interface SkillMeta {
  id: string;                    // "cn:commercial-legal:review"
  name: string;                  // "review"
  plugin: string;                // "commercial-legal"
  jurisdiction: Jurisdiction;
  description: string;
  argumentHint?: string;
  userInvocable: boolean;
  filePath: string;
  systemPromptRaw: string;
  cnSkillRef?: string;
  usSkillRef?: string;
}

export interface AgentMeta {
  id: string;
  name: string;
  plugin: string;
  jurisdiction: Jurisdiction;
  description: string;
  model: 'sonnet' | 'opus' | 'haiku';
  tools: string[];
  filePath: string;
  instructionsRaw: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  userId: string;
  caseId?: string;
  skillId?: string;
  jurisdiction?: Jurisdiction;
  model: string;
  messages: ChatMessage[];
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaseRecord {
  id: string;
  userId: string;
  title: string;
  description?: string;
  tags: string[];
  jurisdiction?: Jurisdiction | 'ALL';
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
  sessionCount?: number;
}

export interface DocumentRecord {
  id: string;
  caseId: string;
  userId: string;
  filename: string;
  s3Key: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

export interface SSEChunk {
  type: 'content_delta' | 'usage' | 'done' | 'error';
  delta?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  error?: string;
}

export interface TokenUsage {
  id: string;
  userId: string;
  sessionId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: number;
  createdAt: string;
}

export type Plan = 'starter' | 'professional' | 'enterprise';

export type ModelProvider = 'anthropic' | 'deepseek' | 'kimi' | 'local-embedded' | 'local-ollama';

export interface User {
  id: string;
  email: string;
  supabaseId: string;
  plan: Plan;
  role: 'member' | 'admin';
  orgId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalModelConfig {
  provider: 'embedded' | 'ollama';
  model: string;
  baseUrl: string;
  enabled: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
