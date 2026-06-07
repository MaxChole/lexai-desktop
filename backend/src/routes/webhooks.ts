import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { constructStripeEvent, upsertSubscriptionFromStripe } from '../services/billing.js';

function planFromPriceId(priceId: string | undefined): 'starter' | 'professional' | 'enterprise' {
  if (priceId && priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return 'enterprise';
  if (priceId && priceId === process.env.STRIPE_PROFESSIONAL_PRICE_ID) return 'professional';
  return 'starter';
}

function subscriptionStatusFromStripe(status: Stripe.Subscription.Status) {
  if (status === 'past_due') return 'past_due' as const;
  if (status === 'trialing') return 'trialing' as const;
  if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') return 'canceled' as const;
  return 'active' as const;
}

export default async function webhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) {
      return reply.code(400).send({
        error: { code: 'MISSING_SIGNATURE', message: 'stripe-signature header is required' },
      });
    }

    const rawPayload = typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body || {});

    let event: Stripe.Event;
    try {
      event = constructStripeEvent(rawPayload, signature);
    } catch (error) {
      return reply.code(400).send({
        error: { code: 'INVALID_SIGNATURE', message: error instanceof Error ? error.message : String(error) },
      });
    }

    if (event.type === 'invoice.paid' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.userId;
      const plan = planFromPriceId(subscription.items.data[0]?.price?.id);

      if (userId) {
        await upsertSubscriptionFromStripe({
          userId,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: String(subscription.customer),
          plan,
          status: subscriptionStatusFromStripe(subscription.status),
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        });
      }
    }

    return { received: true };
  });
}
