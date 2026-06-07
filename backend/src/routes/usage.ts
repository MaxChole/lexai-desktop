import type { FastifyInstance } from 'fastify';
import { getAuthenticatedUserFromToken, readBearerToken } from '../services/auth.js';
import { getCurrentUsageSummary, getUsageHistory } from '../services/usage.js';

async function requireAuth(header: string | undefined) {
  const token = readBearerToken(header);
  if (!token) {
    throw new Error('Authorization Bearer token is required');
  }
  return getAuthenticatedUserFromToken(token);
}

export default async function usageRoutes(app: FastifyInstance) {
  app.get('/usage/current', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      return await getCurrentUsageSummary(appUser.id);
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.get('/usage/history', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      return {
        history: await getUsageHistory(appUser.id),
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
