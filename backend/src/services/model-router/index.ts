import Anthropic from '@anthropic-ai/sdk';
import type { LocalModelConfig, ModelProvider, Plan } from '../../types/shared.js';

// ── Types ──

export interface ModelCallOptions {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemPrompt?: string;
  stream?: boolean;
  cacheControl?: boolean;
  /** Override the plan-selected model */
  modelOverride?: string;
  localConfig?: LocalModelConfig;
}

export interface CallWithToolsOptions {
  model: string;
  systemPrompt?: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string | object[] }>;
  tools: object[];
  userId?: string;
}

export type CallWithToolsContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface CallWithToolsResult {
  content: CallWithToolsContentBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  stop_reason: string;
  model: string;
}

export interface ModelCallResult {
  content: string;
  model: string;
  provider: ModelProvider;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  finishReason: string;
}

export interface StreamChunk {
  type: 'content_delta' | 'usage' | 'done' | 'error';
  delta?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  error?: string;
}

// ── Plan → Model mapping ──

const PLAN_DEFAULT_MODEL: Record<Plan, string> = {
  starter: 'deepseek-chat',
  professional: 'claude-sonnet-4-6',
  enterprise: 'claude-opus-4-6',
};

const PLAN_FALLBACK_MODEL: Record<Plan, string> = {
  starter: 'moonshot-v1-8k',
  professional: 'deepseek-chat',
  enterprise: 'claude-sonnet-4-6',
};

// ── Anthropic adapter ──

async function callAnthropic(
  options: ModelCallOptions,
  apiKey: string,
): Promise<ModelCallResult> {
  const client = new Anthropic({ apiKey });

  // Anthropic system prompt with optional Prompt Caching (cache_control)
  const systemParam: Anthropic.TextBlockParam[] | undefined = options.systemPrompt
    ? [{
        type: 'text' as const,
        text: options.systemPrompt,
        ...(options.cacheControl ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }]
    : undefined;

  // Filter system messages from the messages array (Anthropic uses separate system param)
  const filteredMessages = options.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await client.messages.create({
    model: options.modelOverride || 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemParam,
    messages: filteredMessages,
  });

  const textContent = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as Anthropic.TextBlock).text)
    .join('');

  return {
    content: textContent,
    model: response.model,
    provider: 'anthropic',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,
    finishReason: response.stop_reason || 'end_turn',
  };
}

// ── DeepSeek adapter ──

async function callDeepSeek(
  options: ModelCallOptions,
  apiKey: string,
  baseUrl: string,
): Promise<ModelCallResult> {
  const model = options.modelOverride || 'deepseek-chat';

  const messages = options.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // If systemPrompt provided, prepend as system message
  if (options.systemPrompt) {
    messages.unshift({ role: 'system', content: options.systemPrompt });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} ${errText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content || '',
    model: data.model,
    provider: 'deepseek',
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
    cacheReadTokens: 0, // DeepSeek doesn't support cache reporting
    cacheCreationTokens: 0,
    finishReason: data.choices[0]?.finish_reason || 'stop',
  };
}

// ── Kimi (Moonshot) adapter ──

async function callKimi(
  options: ModelCallOptions,
  apiKey: string,
  baseUrl: string,
): Promise<ModelCallResult> {
  const model = options.modelOverride || 'moonshot-v1-8k';

  const messages = options.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  if (options.systemPrompt) {
    messages.unshift({ role: 'system', content: options.systemPrompt });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Kimi API error: ${response.status} ${errText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content || '',
    model: data.model,
    provider: 'kimi',
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    finishReason: data.choices[0]?.finish_reason || 'stop',
  };
}

async function callOpenAICompatibleLocal(
  options: ModelCallOptions,
  config: LocalModelConfig,
): Promise<ModelCallResult> {
  const model = options.modelOverride || config.model;
  const messages = options.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  if (options.systemPrompt) {
    messages.unshift({ role: 'system', content: options.systemPrompt });
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Local inference API error: ${response.status} ${errText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: data.choices[0]?.message?.content || '',
    model: data.model || model,
    provider: config.provider === 'ollama' ? 'local-ollama' : 'local-embedded',
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    finishReason: data.choices[0]?.finish_reason || 'stop',
  };
}

// ── ModelRouter ──

export class ModelRouter {
  /**
   * Unified model call interface. Selects model based on user plan,
   * falls back on failure.
   */
  async call(options: ModelCallOptions, plan: Plan = 'starter'): Promise<ModelCallResult> {
    if (options.localConfig?.enabled) {
      return this.callLocalModel(options.localConfig, options);
    }

    const model = options.modelOverride || PLAN_DEFAULT_MODEL[plan];
    const fallbackModel = PLAN_FALLBACK_MODEL[plan];

    try {
      return await this.callModel(model, options);
    } catch (primaryError) {
      console.warn(`Primary model ${model} failed, falling back to ${fallbackModel}:`, primaryError);
      try {
        return await this.callModel(fallbackModel, options);
      } catch (fallbackError) {
        throw new Error(
          `Both primary (${model}) and fallback (${fallbackModel}) models failed. Primary: ${primaryError}. Fallback: ${fallbackError}`,
        );
      }
    }
  }

  // ── Tool-use call (for AgentEngine) ──────────────────────────────────────

  /**
   * Make a tool-use enabled LLM call. Returns the raw Anthropic-style response
   * with content[] blocks (text + tool_use) and stop_reason.
   * Only Claude models support tool_use in this implementation.
   */
  async callWithTools(options: CallWithToolsOptions): Promise<CallWithToolsResult> {
    const model = this.resolveModelAlias(options.model);

    if (model.startsWith('claude-')) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
      return this.callAnthropicWithTools(options, model, apiKey);
    }

    throw new Error(
      `Tool use not supported for model "${model}". Assign a Claude model to agents.`,
    );
  }

  private resolveModelAlias(model: string): string {
    const aliases: Record<string, string> = {
      sonnet: 'claude-sonnet-4-6',
      opus:   'claude-opus-4-6',
      haiku:  'claude-haiku-4-5-20251001',
    };
    return aliases[model] ?? model;
  }

  private async callLocalModel(
    config: LocalModelConfig,
    options: ModelCallOptions,
  ): Promise<ModelCallResult> {
    return callOpenAICompatibleLocal(options, config);
  }

  private async callAnthropicWithTools(
    options: CallWithToolsOptions,
    model: string,
    apiKey: string,
  ): Promise<CallWithToolsResult> {
    const client = new Anthropic({ apiKey });

    const systemParam: Anthropic.TextBlockParam[] | undefined = options.systemPrompt
      ? [{
          type: 'text' as const,
          text: options.systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        }]
      : undefined;

    // Convert engine message format → Anthropic format.
    // Engine stores tool results as { role: 'user', content: [{type:'tool_result',...}] }
    // which maps directly to Anthropic's expected shape.
    const messages = options.messages
      .filter(m => m.role !== 'tool')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content as Anthropic.ContentBlockParam[] | string,
      }));

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemParam,
      messages,
      tools: options.tools as Anthropic.Tool[],
    });

    return {
      content: response.content.reduce<CallWithToolsContentBlock[]>((acc, block) => {
        if (block.type === 'text') {
          acc.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          acc.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
        // Ignore other block types (tool_result, thinking, etc.)
        return acc;
      }, []),
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
      },
      stop_reason: response.stop_reason ?? 'end_turn',
      model: response.model,
    };
  }

  /**
   * Route to the correct provider based on model name.
   */
  private async callModel(model: string, options: ModelCallOptions): Promise<ModelCallResult> {
    if (model.startsWith('claude-')) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
      // Override model in options for Anthropic call
      return callAnthropic({ ...options, modelOverride: model }, apiKey);
    }

    if (model.startsWith('deepseek-')) {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
      if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
      return callDeepSeek({ ...options, modelOverride: model }, apiKey, baseUrl);
    }

    if (model.startsWith('moonshot-')) {
      const apiKey = process.env.KIMI_API_KEY;
      const baseUrl = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
      if (!apiKey) throw new Error('KIMI_API_KEY not configured');
      return callKimi({ ...options, modelOverride: model }, apiKey, baseUrl);
    }

    if (model.startsWith('embedded:')) {
      const localConfig: LocalModelConfig = {
        provider: 'embedded',
        model: model.slice('embedded:'.length),
        baseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435/v1',
        enabled: true,
      };
      return this.callLocalModel(localConfig, options);
    }

    if (model.startsWith('ollama:')) {
      const localConfig: LocalModelConfig = {
        provider: 'ollama',
        model: model.slice('ollama:'.length),
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
        enabled: true,
      };
      return this.callLocalModel(localConfig, options);
    }

    throw new Error(`Unknown model: ${model}`);
  }
}
