import type { FastifyInstance } from 'fastify';
import { SkillRegistry, SkillEngine } from '../services/skill-engine/index.js';
import { resolveReferencesDir } from '../services/reference-path.js';
import type { Jurisdiction } from '../types/shared.js';

let registry: SkillRegistry | null = null;
let engine: SkillEngine | null = null;

async function ensureRegistry(): Promise<SkillRegistry> {
  if (!registry) {
    registry = new SkillRegistry();
    const referencesDir = resolveReferencesDir(process.env.REFERENCES_DIR);
    await registry.load(referencesDir);
    engine = new SkillEngine(registry);
  }
  return registry;
}

export default async function skillRoutes(app: FastifyInstance) {
  // GET /skills — list skills with optional filters
  app.get('/skills', async (request) => {
    const reg = await ensureRegistry();
    const { jurisdiction, userInvocable } = request.query as {
      jurisdiction?: Jurisdiction | 'ALL';
      userInvocable?: string;
    };

    const skills = reg.querySkills(
      jurisdiction || 'ALL',
      userInvocable === 'true' ? true : userInvocable === 'false' ? false : undefined,
    );

    // Strip systemPromptRaw from listing — only return metadata
    const skillsMeta = skills.map((s) => ({
      id: s.id,
      name: s.name,
      plugin: s.plugin,
      jurisdiction: s.jurisdiction,
      description: s.description.trim(),
      argumentHint: s.argumentHint,
      userInvocable: s.userInvocable,
    }));

    return {
      skills: skillsMeta,
      total: skillsMeta.length,
    };
  });

  // GET /skills/:skillId — get single skill metadata (still no raw prompt in listing)
  app.get('/skills/:skillId', async (request) => {
    const reg = await ensureRegistry();
    const { skillId } = request.params as { skillId: string };
    const skill = reg.getSkill(skillId);
    if (!skill) {
      return { error: { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` } };
    }
    // Return metadata only; raw prompt is accessed via SkillEngine.buildSystemPrompt
    return {
      id: skill.id,
      name: skill.name,
      plugin: skill.plugin,
      jurisdiction: skill.jurisdiction,
      description: skill.description.trim(),
      argumentHint: skill.argumentHint,
      userInvocable: skill.userInvocable,
    };
  });
}
