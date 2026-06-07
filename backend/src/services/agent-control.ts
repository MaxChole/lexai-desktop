import { getPool } from '../db/index.js';
import { ModelRouter } from './model-router/index.js';
import { AgentRunner } from './agent-runner/index.js';
import { resolveReferencesDir } from './reference-path.js';
import { query } from '../db/index.js';

const modelRouter = new ModelRouter();
let runnerPromise: Promise<AgentRunner> | null = null;

export interface AgentUserConfig {
  enabled: boolean;
  cronExpr: string | null;
  lastRunAt?: string;
  lastStatus?: 'idle' | 'running' | 'success' | 'error';
}

export async function getAgentRunner(): Promise<AgentRunner> {
  if (!runnerPromise) {
    runnerPromise = (async () => {
      const runner = new AgentRunner(modelRouter, getPool(), resolveReferencesDir(process.env.REFERENCES_DIR));
      await runner.init();
      return runner;
    })();
  }
  return runnerPromise;
}

export async function listAgentConfigs(userId: string): Promise<Map<string, AgentUserConfig>> {
  const result = await query(
    `SELECT agent_id, enabled, cron_expr, last_run_at, last_status
     FROM agent_configs
     WHERE user_id = $1`,
    [userId],
  );

  return new Map(result.rows.map((row) => [
    String(row.agent_id),
    {
      enabled: Boolean(row.enabled),
      cronExpr: row.cron_expr ? String(row.cron_expr) : null,
      lastRunAt: row.last_run_at ? String(row.last_run_at) : undefined,
      lastStatus: row.last_status ? String(row.last_status) as AgentUserConfig['lastStatus'] : undefined,
    },
  ]));
}

export async function updateAgentConfig(input: {
  userId: string;
  agentId: string;
  enabled: boolean;
  cronExpr?: string | null;
}): Promise<AgentUserConfig> {
  const result = await query(
    `INSERT INTO agent_configs (user_id, agent_id, enabled, cron_expr, last_status)
     VALUES ($1, $2, $3, $4, 'idle')
     ON CONFLICT (user_id, agent_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       cron_expr = EXCLUDED.cron_expr
     RETURNING enabled, cron_expr, last_run_at, last_status`,
    [input.userId, input.agentId, input.enabled, input.cronExpr ?? null],
  );

  const runner = await getAgentRunner();
  await runner.syncUserSchedules(input.userId);

  const row = result.rows[0];
  return {
    enabled: Boolean(row.enabled),
    cronExpr: row.cron_expr ? String(row.cron_expr) : null,
    lastRunAt: row.last_run_at ? String(row.last_run_at) : undefined,
    lastStatus: row.last_status ? String(row.last_status) as AgentUserConfig['lastStatus'] : undefined,
  };
}

export async function runAgentNow(userId: string, agentId: string) {
  const runner = await getAgentRunner();
  await query(
    `INSERT INTO agent_configs (user_id, agent_id, enabled, last_run_at, last_status)
     VALUES ($1, $2, false, now(), 'running')
     ON CONFLICT (user_id, agent_id)
     DO UPDATE SET last_run_at = now(), last_status = 'running'`,
    [userId, agentId],
  );

  const run = await runner.executeAgent(agentId, userId);

  await query(
    `UPDATE agent_configs
     SET last_run_at = now(), last_status = $1
     WHERE user_id = $2 AND agent_id = $3`,
    [run.status, userId, agentId],
  );

  return run;
}
