// AgentEngine — stateful multi-turn LLM loop for a single agent run
//
// Architecture borrowed from claw-code's QueryEnginePort:
//   - turn loop with max_turns / max_budget guards (QueryEngineConfig)
//   - history compaction to avoid context overflow (compact_messages_if_needed)
//   - structured streaming events (stream_submit_message)
//   - session persistence (persist_session / TranscriptStore)
//
// Differences from claw-code:
//   - Real LLM calls via ModelRouter (not simulated)
//   - Real tool execution via ToolExecutor
//   - Token usage tracked from API responses
//   - Async throughout

import { randomUUID } from 'crypto';
import type { ModelRouter } from '../model-router/index.js';
import { ToolExecutor } from './tool-executor.js';
import { AgentRegistry } from './registry.js';
import type {
  AgentEngineConfig,
  AgentEvent,
  AgentMeta,
  AgentRun,
  AgentTurnResult,
  StopReason,
  ToolCall,
  ToolDenial,
  ToolResult,
  TokenUsage,
} from './types.js';

const DEFAULT_CONFIG: AgentEngineConfig = {
  maxTurns: 10,
  maxBudgetTokens: 100_000,
  compactAfterTurns: 8,
};

// ── Message types for the LLM conversation history ───────────────────────────

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  text?: string;
  is_error?: boolean;
}

// ── AgentEngine ───────────────────────────────────────────────────────────────

export class AgentEngine {
  private runId: string;
  private messages: Message[] = [];
  private turns: AgentTurnResult[] = [];
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  private config: AgentEngineConfig;
  private toolExecutor: ToolExecutor;
  private allowedTools: Set<string>;

  constructor(
    private agentMeta: AgentMeta,
    private modelRouter: ModelRouter,
    private userId: string,
    config?: Partial<AgentEngineConfig>,
  ) {
    this.runId = randomUUID();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.toolExecutor = new ToolExecutor();
    this.allowedTools = AgentRegistry.getInstance().resolveAllowedTools(agentMeta);
  }

  // ── Build system prompt (mirrors claw-code build_system_init_message) ──────

  private buildSystemPrompt(practiceProfile?: string): string {
    const base = this.agentMeta.instructionsRaw;
    if (!practiceProfile) return base;
    return [
      base,
      '',
      '---',
      '## Practice Profile (User Configuration)',
      practiceProfile,
    ].join('\n');
  }

  // ── Core turn loop (mirrors claw-code QueryEnginePort.submit_message) ───────

  async *run(
    triggerContext: string,
    practiceProfile?: string,
  ): AsyncGenerator<AgentEvent> {
    const startedAt = new Date();

    yield { type: 'run_start', runId: this.runId, agentId: this.agentMeta.id, userId: this.userId };

    // Seed the conversation with the trigger context as the first user message
    this.messages.push({
      role: 'user',
      content: triggerContext || 'Run the scheduled agent task as described in the instructions.',
    });

    const systemPrompt = this.buildSystemPrompt(practiceProfile);
    let finalOutput = '';
    let lastError: string | undefined;

    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      yield { type: 'turn_start', turnIndex: turn };

      // ── Budget guard (mirrors claw-code max_budget_reached) ────────────────
      const budgetUsed = this.totalUsage.inputTokens + this.totalUsage.outputTokens;
      if (budgetUsed >= this.config.maxBudgetTokens) {
        const result = this.makeTurnResult(turn, '(budget limit reached)', [], [], [], { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, 'max_budget_reached');
        this.turns.push(result);
        yield { type: 'turn_end', result };
        break;
      }

      try {
        // ── Call LLM ─────────────────────────────────────────────────────────
        const response = await this.modelRouter.callWithTools({
          model: this.agentMeta.model,
          systemPrompt,
          messages: this.compactMessages(),
          tools: this.buildToolDefinitions(),
          userId: this.userId,
        });

        const turnUsage: TokenUsage = {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: response.usage?.cache_creation_input_tokens ?? 0,
        };
        this.accumulateUsage(turnUsage);

        // ── Parse assistant response ──────────────────────────────────────────
        const toolCalls: ToolCall[] = [];
        const toolResults: ToolResult[] = [];
        const denials: ToolDenial[] = [];
        let assistantText = '';
        const assistantBlocks: ContentBlock[] = [];

        for (const block of response.content ?? []) {
          if (block.type === 'text') {
            assistantText += block.text ?? '';
            yield { type: 'content_delta', delta: block.text ?? '' };
            assistantBlocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            const toolCall: ToolCall = {
              id: block.id,
              name: block.name,
              input: block.input ?? {},
            };

            // ── Permission check (mirrors claw-code _infer_permission_denials) ─
            const registry = AgentRegistry.getInstance();
            if (!registry.isToolAllowed(block.name, this.allowedTools)) {
              const denial: ToolDenial = {
                toolName: block.name,
                reason: `Tool not in agent's allowed list: ${this.agentMeta.tools.join(', ')}`,
              };
              denials.push(denial);
              yield { type: 'tool_denial', denial };
              toolResults.push({
                toolCallId: block.id,
                toolName: block.name,
                output: `Permission denied: ${denial.reason}`,
                isError: true,
              });
              assistantBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
              continue;
            }

            toolCalls.push(toolCall);
            yield { type: 'tool_call', toolCall };
            assistantBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });

            // ── Execute tool ─────────────────────────────────────────────────
            const toolResult = await this.toolExecutor.execute(block.name, block.input ?? {});
            toolResults.push(toolResult);
            yield { type: 'tool_result', toolResult };
          }
        }

        // Append assistant message + tool results to history
        this.messages.push({ role: 'assistant', content: assistantBlocks });
        if (toolResults.length > 0) {
          this.messages.push({
            role: 'user',
            content: toolResults.map(r => ({
              type: 'tool_result' as const,
              tool_use_id: r.toolCallId,
              content: r.output,
              is_error: r.isError,
            })),
          });
        }

        // ── Determine stop reason ─────────────────────────────────────────────
        const stopReason = this.resolveStopReason(response.stop_reason, toolCalls.length);
        finalOutput = assistantText || finalOutput;

        const turnResult = this.makeTurnResult(
          turn, assistantText, toolCalls, toolResults, denials, turnUsage, stopReason,
        );
        this.turns.push(turnResult);
        yield { type: 'turn_end', result: turnResult };

        if (stopReason === 'end_turn') break;

      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        yield { type: 'error', message: lastError };
        break;
      }
    }

    // ── Turns exhausted without end_turn ──────────────────────────────────────
    if (this.turns.length >= this.config.maxTurns) {
      const sentinel = this.makeTurnResult(
        this.turns.length, '', [], [], [], { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, 'max_turns_reached',
      );
      this.turns.push(sentinel);
      yield { type: 'turn_end', result: sentinel };
    }

    const run: AgentRun = {
      runId: this.runId,
      agentId: this.agentMeta.id,
      userId: this.userId,
      startedAt,
      finishedAt: new Date(),
      status: lastError ? 'error' : 'success',
      turns: this.turns,
      totalUsage: this.totalUsage,
      finalOutput,
      error: lastError,
    };

    yield { type: 'run_end', run };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveStopReason(apiStopReason: string | undefined, toolCallCount: number): StopReason {
    if (toolCallCount > 0) return 'end_turn'; // will continue loop to handle tool results
    if (apiStopReason === 'end_turn') return 'end_turn';
    if (apiStopReason === 'tool_use') return 'end_turn'; // continue
    return 'end_turn';
  }

  // Mirrors claw-code compact_messages_if_needed
  private compactMessages(): Message[] {
    if (this.messages.length <= this.config.compactAfterTurns) {
      return this.messages;
    }
    // Keep the first user message (trigger context) + last N messages
    return [this.messages[0], ...this.messages.slice(-this.config.compactAfterTurns)];
  }

  private accumulateUsage(usage: TokenUsage): void {
    this.totalUsage = {
      inputTokens: this.totalUsage.inputTokens + usage.inputTokens,
      outputTokens: this.totalUsage.outputTokens + usage.outputTokens,
      cacheReadTokens: this.totalUsage.cacheReadTokens + usage.cacheReadTokens,
      cacheCreationTokens: this.totalUsage.cacheCreationTokens + usage.cacheCreationTokens,
    };
  }

  private makeTurnResult(
    turnIndex: number,
    assistantMessage: string,
    toolCalls: ToolCall[],
    toolResults: ToolResult[],
    denials: ToolDenial[],
    usage: TokenUsage,
    stopReason: StopReason,
  ): AgentTurnResult {
    return { turnIndex, assistantMessage, toolCalls, toolResults, denials, usage, stopReason };
  }

  // Build Anthropic-format tool definitions from the allowed tool patterns
  private buildToolDefinitions(): object[] {
    return [
      {
        name: 'Read',
        description: 'Read a file from the filesystem',
        input_schema: {
          type: 'object',
          properties: { file_path: { type: 'string', description: 'Absolute path to the file' } },
          required: ['file_path'],
        },
      },
      {
        name: 'Write',
        description: 'Write content to a file',
        input_schema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['file_path', 'content'],
        },
      },
      {
        name: 'WebSearch',
        description: 'Search the web for information',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ].filter(tool =>
      AgentRegistry.getInstance().isToolAllowed(tool.name, this.allowedTools),
    );
  }
}
