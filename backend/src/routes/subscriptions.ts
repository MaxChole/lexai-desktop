import type { FastifyInstance } from 'fastify';
import {
  cancelCurrentSubscription,
  createCheckoutSession,
  getCurrentSubscription,
  listPlans,
} from '../services/billing.js';
import { getAuthenticatedUserFromToken, readBearerToken } from '../services/auth.js';
import type { Plan } from '../types/shared.js';

async function requireAuth(header: string | undefined) {
  const token = readBearerToken(header);
  if (!token) {
    throw new Error('Authorization Bearer token is required');
  }
  return getAuthenticatedUserFromToken(token);
}

export default async function subscriptionRoutes(app: FastifyInstance) {
  app.get('/subscriptions/plans', async () => {
    return { plans: listPlans() };
  });

  app.post('/subscriptions', async (request, reply) => {
    const { appUser } = await requireAuth(request.headers.authorization);
    const {
      plan,
      successUrl = 'https://app.lexai.local/subscriptions/success',
      cancelUrl = 'https://app.lexai.local/subscriptions/cancel',
    } = request.body as {
      plan?: Plan;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (!plan) {
      return reply.code(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'plan is required' },
      });
    }

    const session = await createCheckoutSession({
      userId: appUser.id,
      email: appUser.email,
      plan,
      successUrl,
      cancelUrl,
    });

    return session;
  });

  app.get('/subscriptions/current', async (request) => {
    const { appUser } = await requireAuth(request.headers.authorization);
    return {
      subscription: await getCurrentSubscription(appUser.id),
    };
  });

  app.delete('/subscriptions/current', async (request) => {
    const { appUser } = await requireAuth(request.headers.authorization);
    return {
      subscription: await cancelCurrentSubscription(appUser.id),
    };
  });
}
