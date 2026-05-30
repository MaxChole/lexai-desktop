// AgentRunner — main orchestrator
//
// Responsibilities:
//   1. Load AgentRegistry on startup
//   2. Maintain per-user scheduled jobs (cron)
//   3. Execute agents via AgentEngine (turn loop)
//   4. Persist run results to DB + emit notifications
//   5. Expose public API used by routes/agents.ts
//
// Architectural lineage (claw-code):
//   PortRuntime.bootstrap_session()  → AgentRunner.runAgent()
//   PortRuntime.run_turn_loop()      → AgentEngine.run()
//   session_store.save_session()     → AgentRunner.persistRun()

import cron from 'node-cron';
import type { Pool } from 'pg';
import type { ModelRouter } from '../model-router/index.js';
import { AgentRegistry } from './registry.js';
import { AgentEngine } from './engine.js';
import type {
  AgentEvent,
  AgentMeta,
  AgentRun,
  AgentStatus,
  ScheduledJob,
} from './types.js';

export class AgentRunner {
  private registry = AgentRegistry.getInstance();
  private scheduledJobs: Map<string, ScheduledJob> = new Map();

  constructor(
    private modelRouter: ModelRouter,
    private db: Pool,
    private referencesRoot: string,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    await this.registry.init(this.referencesRoot);
    console.log(`[AgentRunner] registry ready — ${this.registry.getAll().length} agents`);
  }

  // ── Execute a single agent run (async generator, streams AgentEvents) ──────

  async *runAgent(
    agentId: string,
    userId: string,
    triggerContext?: string,
  ): AsyncGenerator<AgentEvent> {
    const meta = this.registry.getById(agentId);
    if (!meta) {
      yield { type: 'error', message: `Agent not found: ${agentId}` };
      return;
    }

    // Load user's practice profile for this agent's plugin
    const practiceProfile = await this.loadPracticeProfile(userId, meta);

    const engine = new AgentEngine(meta, this.modelRouter, userId);
    const context = triggerContext ?? this.buildTriggerContext(meta);

    let finalRun: AgentRun | undefined;

    for await (const event of engine.run(context, practiceProfile)) {
      yield event;
      if (event.type === 'run_end') {
        finalRun = event.run;
      }
    }

    if (finalRun) {
      await this.persistRun(finalRun, meta);
      await this.emitNotification(finalRun, meta, userId);
    }
  }

  // ── Collect full run result (non-streaming convenience wrapper) ────────────

  async executeAgent(
    agentId: string,
    userId: string,
    triggerContext?: string,
  ): Promise<AgentRun> {
    let finalRun: AgentRun | undefined;
    for await (const event of this.runAgent(agentId, userId, triggerContext)) {
      if (event.type === 'run_end') finalRun = event.run;
      if (event.type === 'error') {
        console.error(`[AgentRunner] ${agentId} error:`, event.message);
      }
    }
    if (!finalRun) throw new Error(`Agent run produced no result: ${agentId}`);
    return finalRun;
  }

  // ── Scheduler: per-user cron jobs ──────────────────────────────────────────

  async syncUserSchedules(userId: string): Promise<void> {
    const rows = await this.db.query<{
      agent_id: string;
      enabled: boolean;
      cron_expr: string | null;
    }>(
      'SELECT agent_id, enabled, cron_expr FROM agent_configs WHERE user_id = $1',
      [userId],
    );

    for (const row of rows.rows) {
      const jobKey = `${userId}:${row.agent_id}`;
      const existing = this.scheduledJobs.get(jobKey);

      // Stop old job if cron changed or disabled
      if (existing?.job) {
        (existing.job as { stop: () => void }).stop();
        this.scheduledJobs.delete(jobKey);
      }

      if (!row.enabled) continue;

      const meta = this.registry.getById(row.agent_id);
      if (!meta) continue;

      const cronExpr = row.cron_expr ?? meta.defaultCron;
      if (!cron.validate(cronExpr)) {
        console.warn(`[AgentRunner] invalid cron "${cronExpr}" for ${row.agent_id}`);
        continue;
      }

      const job = cron.schedule(cronExpr, async () => {
        console.log(`[AgentRunner] cron fire: ${row.agent_id} for user ${userId}`);
        await this.db.query(
          `UPDATE agent_configs SET last_run_at = now(), last_status = 'running'
           WHERE user_id = $1 AND agent_id = $2`,
          [userId, row.agent_id],
        );
        try {
          const run = await this.executeAgent(row.agent_id, userId);
          await this.db.query(
            `UPDATE agent_configs SET last_status = $1 WHERE user_id = $2 AND agent_id = $3`,
            [run.status, userId, row.agent_id],
          );
        } catch (err) {
          await this.db.query(
            `UPDATE agent_configs SET last_status = 'error' WHERE user_id = $1 AND agent_id = $2`,
            [userId, row.agent_id],
          );
          console.error(`[AgentRunner] scheduled run failed for ${row.agent_id}:`, err);
        }
      });

      this.scheduledJobs.set(jobKey, {
        agentId: row.agent_id,
        userId,
        cronExpr,
        enabled: true,
        job,
      });

      console.log(`[AgentRunner] scheduled ${row.agent_id} @ "${cronExpr}" for user ${userId}`);
    }
  }

  // ── Public query interface ─────────────────────────────────────────────────

  getAllAgents(): AgentMeta[] {
    return this.registry.getAll();
  }

  getAgent(agentId: string): AgentMeta | undefined {
    return this.registry.getById(agentId);
  }

  getJobStatus(userId: string, agentId: string): ScheduledJob | undefined {
    return this.scheduledJobs.get(`${userId}:${agentId}`);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private buildTriggerContext(meta: AgentMeta): string {
    return [
      `You are running as a scheduled headless agent: ${meta.name}.`,
      `Jurisdiction: ${meta.jurisdiction}`,
      `Today's date: ${new Date().toISOString().split('T')[0]}`,
      '',
      'Follow the instructions in your system prompt exactly.',
      'Complete the task, produce your output, then stop.',
    ].join('\n');
  }

  private async loadPracticeProfile(userId: string, meta: AgentMeta): Promise<string | undefined> {
    try {
      const result = await this.db.query<{ content: string }>(
        `SELECT content FROM practice_profiles
         WHERE user_id = $1 AND plugin_id = $2 AND jurisdiction = $3
         LIMIT 1`,
        [userId, meta.plugin, meta.jurisdiction],
      );
      return result.rows[0]?.content;
    } catch {
      return undefined;
    }
  }

  // Mirrors claw-code session_store.save_session()
  private async persistRun(run: AgentRun, meta: AgentMeta): Promise<void> {
    const totalInput = run.totalUsage.inputTokens;
    const totalOutput = run.totalUsage.outputTokens;

    await this.db.query(
      `INSERT INTO token_usage
         (user_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        run.userId,
        meta.model,
        totalInput,
        totalOutput,
        run.totalUsage.cacheReadTokens,
        run.totalUsage.cacheCreationTokens,
      ],
    );
  }

  private async emitNotification(run: AgentRun, meta: AgentMeta, userId: string): Promise<void> {
    const statusEmoji = run.status === 'success' ? '✅' : '❌';
    const title = `${statusEmoji} ${meta.name} 已完成`;
    const body = run.status === 'success'
      ? (run.finalOutput.slice(0, 200) + (run.finalOutput.length > 200 ? '…' : ''))
      : `运行失败: ${run.error ?? 'unknown error'}`;

    await this.db.query(
      `INSERT INTO notifications (user_id, agent_id, title, body)
       VALUES ($1, $2, $3, $4)`,
      [userId, meta.id, title, body],
    );
  }

  stopAll(): void {
    for (const job of this.scheduledJobs.values()) {
      if (job.job) (job.job as { stop: () => void }).stop();
    }
    this.scheduledJobs.clear();
    console.log('[AgentRunner] all scheduled jobs stopped');
  }
}

// Re-export for convenience
export { AgentRegistry } from './registry.js';
export type { AgentMeta, AgentRun, AgentEvent, AgentStatus } from './types.js';
