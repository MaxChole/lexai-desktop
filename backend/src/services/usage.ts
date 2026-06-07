import { query } from '../db/index.js';
import type { Plan, TokenUsage } from '../types/shared.js';

const PLAN_QUOTA: Record<Plan, number> = {
  starter: 1_000_000,
  professional: 5_000_000,
  enterprise: 10_000_000,
};

function planFromValue(value: unknown): Plan {
  return value === 'professional' || value === 'enterprise' ? value : 'starter';
}

function toTokenUsage(row: Record<string, unknown>): TokenUsage {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sessionId: row.session_id ? String(row.session_id) : undefined,
    model: String(row.model),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    cacheCreationTokens: Number(row.cache_creation_tokens),
    costUsd: row.cost_usd !== null && row.cost_usd !== undefined ? Number(row.cost_usd) : undefined,
    createdAt: String(row.created_at),
  };
}

export async function recordTokenUsage(input: {
  userId: string;
  sessionId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
}): Promise<TokenUsage> {
  const result = await query(
    `INSERT INTO token_usage (
       user_id, session_id, model, input_tokens, output_tokens,
       cache_read_tokens, cache_creation_tokens, cost_usd
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, session_id, model, input_tokens, output_tokens,
               cache_read_tokens, cache_creation_tokens, cost_usd, created_at`,
    [
      input.userId,
      input.sessionId || null,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.cacheReadTokens || 0,
      input.cacheCreationTokens || 0,
      input.costUsd || null,
    ],
  );

  return toTokenUsage(result.rows[0]);
}

export async function getCurrentUsageSummary(userId: string) {
  const userResult = await query(
    `SELECT plan FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );

  const plan = planFromValue(userResult.rows[0]?.plan);
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

  const usageResult = await query(
    `SELECT
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
     FROM token_usage
     WHERE user_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
    [userId, periodStart.toISOString(), periodEnd.toISOString()],
  );

  const row = usageResult.rows[0] || {};
  const inputTokens = Number(row.input_tokens || 0);
  const outputTokens = Number(row.output_tokens || 0);
  const cacheReadTokens = Number(row.cache_read_tokens || 0);
  const cacheCreationTokens = Number(row.cache_creation_tokens || 0);
  const total = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  const quota = PLAN_QUOTA[plan];
  const usagePercent = quota > 0 ? Number(((total / quota) * 100).toFixed(1)) : 0;

  return {
    plan,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    quota,
    used: {
      total,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
    },
    usagePercent,
    warningThreshold: 80,
    hardLimit: 100,
  };
}

export async function getUsageHistory(userId: string) {
  const result = await query(
    `SELECT
       DATE(created_at) AS usage_date,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
     FROM token_usage
     WHERE user_id = $1
     GROUP BY DATE(created_at)
     ORDER BY usage_date DESC
     LIMIT 31`,
    [userId],
  );

  return result.rows.map((row) => {
    const inputTokens = Number(row.input_tokens || 0);
    const outputTokens = Number(row.output_tokens || 0);
    const cacheReadTokens = Number(row.cache_read_tokens || 0);
    const cacheCreationTokens = Number(row.cache_creation_tokens || 0);
    return {
      date: String(row.usage_date),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      total: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    };
  });
}
