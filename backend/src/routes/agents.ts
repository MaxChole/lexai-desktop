import type { FastifyInstance } from 'fastify';
import { AgentRegistry } from '../services/agent-runner/registry.js';
import { resolveReferencesDir } from '../services/reference-path.js';
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

export default async function agentRoutes(app: FastifyInstance) {
  // GET /agents — list all available agents (with metadata)
  app.get('/agents', async (request) => {
    const reg = await ensureRegistry();
    const { jurisdiction } = request.query as { jurisdiction?: Jurisdiction | 'ALL' };

    let agents = reg.getAll();
    if (jurisdiction && jurisdiction !== 'ALL') {
      agents = reg.getByJurisdiction(jurisdiction as 'CN' | 'US' | 'INT');
    }

    // Strip instructionsRaw from listing — only return metadata
    const agentsMeta = agents.map((a) => ({
      id: a.id,
      name: a.name,
      plugin: a.plugin,
      jurisdiction: a.jurisdiction,
      description: a.description.trim(),
      model: a.model,
      tools: a.tools,
      defaultCron: a.defaultCron,
      type: 'agent', // distinguish from skills
    }));

    return {
      agents: agentsMeta,
      total: agentsMeta.length,
    };
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
}
