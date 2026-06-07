import type { FastifyInstance } from 'fastify';
import { AgentRegistry } from '../services/agent-runner/registry.js';
import { resolveReferencesDir } from '../services/reference-path.js';
import { getAuthenticatedUserFromToken, readBearerToken } from '../services/auth.js';
import { listAgentConfigs, runAgentNow, updateAgentConfig } from '../services/agent-control.js';
import type { Jurisdiction } from '../types/shared.js';

let registryInitialized = false;

async function ensureRegistry(): Promise<AgentRegistry> {
  const registry = AgentRegistry.getInstance();
  if (!registryInitialized) {
    const referencesDir = resolveReferencesDir(process.env.REFERENCES_DIR);
    await registry.init(referencesDir);
    registryInitialized = true;
  }
  return registry;
}

async function requireAuth(header: string | undefined) {
  const token = readBearerToken(header);
  if (!token) {
    throw new Error('Authorization Bearer token is required');
  }
  return getAuthenticatedUserFromToken(token);
}

export default async function agentRoutes(app: FastifyInstance) {
  // GET /agents — list all available agents (with metadata)
  app.get('/agents', async (request, reply) => {
    const reg = await ensureRegistry();
    const { jurisdiction } = request.query as { jurisdiction?: Jurisdiction | 'ALL' };

    let agents = reg.getAll();
    if (jurisdiction && jurisdiction !== 'ALL') {
      agents = reg.getByJurisdiction(jurisdiction as 'CN' | 'US' | 'INT');
    }

    // Strip instructionsRaw from listing — only return metadata
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const configMap = await listAgentConfigs(appUser.id);
      const agentsMeta = agents.map((a) => ({
        id: a.id,
        name: a.name,
        plugin: a.plugin,
        jurisdiction: a.jurisdiction,
        description: a.description.trim(),
        model: a.model,
        tools: a.tools,
        defaultCron: a.defaultCron,
        userConfig: configMap.get(a.id) ?? {
          enabled: false,
          cronExpr: null,
          lastStatus: 'idle',
        },
        type: 'agent',
      }));

      return {
        agents: agentsMeta,
        total: agentsMeta.length,
      };
    } catch {
      const agentsMeta = agents.map((a) => ({
        id: a.id,
        name: a.name,
        plugin: a.plugin,
        jurisdiction: a.jurisdiction,
        description: a.description.trim(),
        model: a.model,
        tools: a.tools,
        defaultCron: a.defaultCron,
        userConfig: {
          enabled: false,
          cronExpr: null,
          lastStatus: 'idle',
        },
        type: 'agent',
      }));

      return {
        agents: agentsMeta,
        total: agentsMeta.length,
      };
    }
  });

  // GET /agents/:agentId — get single agent metadata
  app.get('/agents/:agentId', async (request) => {
    const reg = await ensureRegistry();
    const { agentId } = request.params as { agentId: string };
    const agent = reg.getById(agentId);
    if (!agent) {
      return { error: { code: 'NOT_FOUND', message: `Agent not found: ${agentId}` } };
    }
    return {
      id: agent.id,
      name: agent.name,
      plugin: agent.plugin,
      jurisdiction: agent.jurisdiction,
      description: agent.description.trim(),
      model: agent.model,
      tools: agent.tools,
      defaultCron: agent.defaultCron,
      type: 'agent',
    };
  });

  app.put('/agents/:agentId/config', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const { agentId } = request.params as { agentId: string };
      const body = request.body as { enabled?: boolean; cronExpr?: string | null };
      const reg = await ensureRegistry();
      if (!reg.getById(agentId)) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `Agent not found: ${agentId}` },
        });
      }
      return {
        userConfig: await updateAgentConfig({
          userId: appUser.id,
          agentId,
          enabled: Boolean(body.enabled),
          cronExpr: body.cronExpr ?? null,
        }),
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.post('/agents/:agentId/run', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const { agentId } = request.params as { agentId: string };
      const reg = await ensureRegistry();
      if (!reg.getById(agentId)) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `Agent not found: ${agentId}` },
        });
      }
      const run = await runAgentNow(appUser.id, agentId);
      return {
        run: {
          runId: run.runId,
          status: run.status,
          finalOutput: run.finalOutput,
          error: run.error,
          totalUsage: run.totalUsage,
          finishedAt: run.finishedAt,
        },
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
