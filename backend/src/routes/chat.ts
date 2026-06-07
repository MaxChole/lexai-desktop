import type { FastifyInstance } from 'fastify';
import { SkillRegistry, SkillEngine } from '../services/skill-engine/index.js';
import { ModelRouter } from '../services/model-router/index.js';
import { resolveReferencesDir } from '../services/reference-path.js';
import { getAuthenticatedUserFromToken, readBearerToken } from '../services/auth.js';
import { recordTokenUsage } from '../services/usage.js';
import type { Jurisdiction, Plan } from '../types/shared.js';

let registry: SkillRegistry | null = null;
let engine: SkillEngine | null = null;
const modelRouter = new ModelRouter();

async function ensureRegistry(): Promise<SkillRegistry> {
  if (!registry) {
    registry = new SkillRegistry();
    const referencesDir = resolveReferencesDir(process.env.REFERENCES_DIR);
    await registry.load(referencesDir);
    engine = new SkillEngine(registry);
  }
  return registry;
}

export default async function chatRoutes(app: FastifyInstance) {
  // POST /chat — simple non-streaming chat endpoint (for testing)
  app.post('/chat', async (request, reply) => {
    const { message, skillId, jurisdiction, plan } = request.body as {
      message: string;
      skillId?: string;
      jurisdiction?: Jurisdiction;
      plan?: Plan;
    };

    if (!message) {
      return reply.code(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'message is required' },
      });
    }

    // Build system prompt
    let systemPrompt = '';
    if (skillId) {
      await ensureRegistry();
      systemPrompt = engine!.buildSystemPrompt(skillId);
    }

    const token = readBearerToken(request.headers.authorization);
    const authenticated = token
      ? await getAuthenticatedUserFromToken(token).catch(() => null)
      : null;

    // Call model
    const result = await modelRouter.call(
      {
        messages: [{ role: 'user', content: message }],
        systemPrompt,
        cacheControl: !!skillId, // enable Prompt Caching for skill-based calls
      },
      plan || 'starter',
    );

    if (authenticated?.appUser) {
      await recordTokenUsage({
        userId: authenticated.appUser.id,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheCreationTokens: result.cacheCreationTokens,
      });
    }

    return {
      content: result.content,
      model: result.model,
      provider: result.provider,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheCreationTokens: result.cacheCreationTokens,
      },
    };
  });
}
