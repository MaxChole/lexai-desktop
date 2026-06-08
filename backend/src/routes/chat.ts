import type { FastifyInstance } from 'fastify';
import { SkillRegistry, SkillEngine } from '../services/skill-engine/index.js';
import { ModelRouter } from '../services/model-router/index.js';
import { resolveReferencesDir } from '../services/reference-path.js';
import { getAuthenticatedUserFromToken, readBearerToken } from '../services/auth.js';
import { saveChatSessionExchange } from '../services/cases.js';
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
    const { message, skillId, caseId, sessionId, jurisdiction, plan } = request.body as {
      message: string;
      skillId?: string;
      caseId?: string;
      sessionId?: string;
      jurisdiction?: Jurisdiction;
      plan?: Plan;
    };

    if (!message) {
      return reply.code(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'message is required' },
      });
    }

    let systemPrompt = '';
    let crossCompareResult:
      | {
          content: string;
          model: string;
          provider: string;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheCreationTokens: number;
        }
      | null = null;
    if (skillId) {
      const reg = await ensureRegistry();
      const skill = reg.getSkill(skillId);
      if (skill?.jurisdiction === 'CROSS') {
        const { cnSkillRef, usSkillRef } = engine!.getCrossSkillRefs(skillId);
        const [cnResult, usResult] = await Promise.all([
          modelRouter.call(
            {
              messages: [{ role: 'user', content: message }],
              systemPrompt: engine!.buildSystemPrompt(cnSkillRef),
              cacheControl: true,
            },
            plan || 'starter',
          ),
          modelRouter.call(
            {
              messages: [{ role: 'user', content: message }],
              systemPrompt: engine!.buildSystemPrompt(usSkillRef),
              cacheControl: true,
            },
            plan || 'starter',
          ),
        ]);

        crossCompareResult = {
          content: engine!.formatCrossComparison({
            skillId,
            userMessage: message,
            cnTitle: '中国法视角',
            usTitle: '美国法视角',
            cnContent: cnResult.content,
            usContent: usResult.content,
          }),
          model: `compare:${cnResult.model}|${usResult.model}`,
          provider: 'cross-compare',
          inputTokens: cnResult.inputTokens + usResult.inputTokens,
          outputTokens: cnResult.outputTokens + usResult.outputTokens,
          cacheReadTokens: cnResult.cacheReadTokens + usResult.cacheReadTokens,
          cacheCreationTokens: cnResult.cacheCreationTokens + usResult.cacheCreationTokens,
        };
      } else {
        systemPrompt = engine!.buildSystemPrompt(skillId);
      }
    }

    const token = readBearerToken(request.headers.authorization);
    const authenticated = token
      ? await getAuthenticatedUserFromToken(token).catch(() => null)
      : null;

    // Call model
    const result = crossCompareResult ?? await modelRouter.call(
      {
        messages: [{ role: 'user', content: message }],
        systemPrompt,
        cacheControl: !!skillId, // enable Prompt Caching for skill-based calls
      },
      plan || 'starter',
    );

    const session = authenticated?.appUser
      ? await saveChatSessionExchange({
          userId: authenticated.appUser.id,
          sessionId,
          caseId,
          skillId,
          jurisdiction,
          model: result.model,
          userMessage: message,
          assistantMessage: result.content,
        })
      : null;

    if (authenticated?.appUser) {
      await recordTokenUsage({
        userId: authenticated.appUser.id,
        sessionId: session?.id,
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
      sessionId: session?.id,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheCreationTokens: result.cacheCreationTokens,
      },
    };
  });
}
