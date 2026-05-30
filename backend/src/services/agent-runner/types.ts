// AgentRunner type definitions
// Modelled after claw-code's TurnResult / RuntimeSession / PermissionDenial patterns

export type StopReason =
  | 'end_turn'
  | 'max_turns_reached'
  | 'max_budget_reached'
  | 'tool_error'
  | 'error';

export type AgentStatus = 'idle' | 'running' | 'success' | 'error';

// ── Per-tool permission (from agent frontmatter `tools: [...]`) ──────────────

export interface ToolPermission {
  pattern: string;   // e.g. "Read", "mcp__ironclad__*", "mcp__*__slack_send_message"
  allowed: boolean;
}

export interface ToolDenial {
  toolName: string;
  reason: string;
}

// ── Single turn in the agent loop (mirrors claw-code TurnResult) ─────────────

export interface AgentTurnResult {
  turnIndex: number;
  assistantMessage: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  denials: ToolDenial[];
  usage: TokenUsage;
  stopReason: StopReason;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// ── Full agent run (mirrors claw-code RuntimeSession) ────────────────────────

export interface AgentRun {
  runId: string;
  agentId: string;
  userId: string;
  startedAt: Date;
  finishedAt?: Date;
  status: AgentStatus;
  turns: AgentTurnResult[];
  totalUsage: TokenUsage;
  finalOutput: string;
  error?: string;
}

// ── Streaming events (mirrors claw-code stream_submit_message events) ─────────

export type AgentEvent =
  | { type: 'run_start';    runId: string; agentId: string; userId: string }
  | { type: 'turn_start';   turnIndex: number }
  | { type: 'content_delta'; delta: string }
  | { type: 'tool_call';    toolCall: ToolCall }
  | { type: 'tool_result';  toolResult: ToolResult }
  | { type: 'tool_denial';  denial: ToolDenial }
  | { type: 'turn_end';     result: AgentTurnResult }
  | { type: 'run_end';      run: AgentRun }
  | { type: 'error';        message: string };

// ── Agent metadata (from .md frontmatter in references) ──────────────────────

export interface AgentMeta {
  id: string;                        // "cn:commercial-legal:renewal-watcher"
  name: string;
  plugin: string;
  jurisdiction: 'CN' | 'US' | 'INT';
  description: string;
  model: string;                     // "sonnet" | "opus" | "haiku"
  tools: string[];                   // raw tool patterns from frontmatter
  defaultCron: string;               // "0 9 * * 1" = Monday 9am
  instructionsRaw: string;           // Markdown body (system prompt source)
  filePath: string;
}

// ── Scheduler entry ───────────────────────────────────────────────────────────

export interface ScheduledJob {
  agentId: string;
  userId: string;
  cronExpr: string;
  enabled: boolean;
  lastRunAt?: Date;
  lastStatus?: AgentStatus;
  job?: unknown;  // node-cron ScheduledTask, typed as unknown to avoid import leak
}

// ── Engine config (mirrors claw-code QueryEngineConfig) ──────────────────────

export interface AgentEngineConfig {
  maxTurns: number;           // default 10
  maxBudgetTokens: number;    // default 100_000
  compactAfterTurns: number;  // default 8 — keep last N turns in context
}
