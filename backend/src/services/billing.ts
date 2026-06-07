import Stripe from 'stripe';
import { query } from '../db/index.js';
import type { Plan } from '../types/shared.js';

let stripeClient: Stripe | null = null;

export interface SubscriptionRecord {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  plan: Plan;
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  tokenQuota: number;
  createdAt: string;
  updatedAt: string;
}

const PLAN_PRICE_ENV: Record<Plan, string> = {
  starter: 'STRIPE_STARTER_PRICE_ID',
  professional: 'STRIPE_PROFESSIONAL_PRICE_ID',
  enterprise: 'STRIPE_ENTERPRISE_PRICE_ID',
};

const PLAN_QUOTA: Record<Plan, number> = {
  starter: 1_000_000,
  professional: 5_000_000,
  enterprise: 10_000_000,
};

const PLAN_LABEL: Record<Plan, string> = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

function getStripeClient(): Stripe {
  if (!stripeClient) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY is required');
    stripeClient = new Stripe(apiKey);
  }
  return stripeClient;
}

function getPriceId(plan: Plan): string {
  const envName = PLAN_PRICE_ENV[plan];
  const priceId = process.env[envName];
  if (!priceId) {
    throw new Error(`${envName} is required`);
  }
  return priceId;
}

function mapPlan(value: unknown): Plan {
  return value === 'professional' || value === 'enterprise' ? value : 'starter';
}

function toSubscriptionRecord(row: Record<string, unknown>): SubscriptionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    stripeSubscriptionId: String(row.stripe_subscription_id),
    stripeCustomerId: String(row.stripe_customer_id),
    plan: mapPlan(row.plan),
    status: row.status === 'past_due' || row.status === 'canceled' || row.status === 'trialing' ? row.status : 'active',
    currentPeriodStart: String(row.current_period_start),
    currentPeriodEnd: String(row.current_period_end),
    tokenQuota: Number(row.token_quota),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listPlans() {
  return (Object.keys(PLAN_LABEL) as Plan[]).map((plan) => ({
    plan,
    label: PLAN_LABEL[plan],
    priceId: process.env[PLAN_PRICE_ENV[plan]] || null,
    tokenQuota: PLAN_QUOTA[plan],
  }));
}

export async function getCurrentSubscription(userId: string): Promise<SubscriptionRecord | null> {
  const result = await query(
    `SELECT id, user_id, stripe_subscription_id, stripe_customer_id, plan, status,
            current_period_start, current_period_end, token_quota, created_at, updated_at
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? toSubscriptionRecord(result.rows[0]) : null;
}

export async function createCheckoutSession(input: {
  userId: string;
  email: string;
  plan: Plan;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  const stripe = getStripeClient();
  const priceId = getPriceId(input.plan);
  const existing = await getCurrentSubscription(input.userId);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: existing ? undefined : input.email,
    customer: existing?.stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      userId: input.userId,
      plan: input.plan,
    },
  });

  if (!session.url) {
    throw new Error('Stripe checkout URL was not returned');
  }

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
  };
}

export async function cancelCurrentSubscription(userId: string): Promise<SubscriptionRecord | null> {
  const stripe = getStripeClient();
  const current = await getCurrentSubscription(userId);
  if (!current) {
    return null;
  }

  await stripe.subscriptions.update(current.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  const updated = await query(
    `UPDATE subscriptions
     SET status = 'canceled', updated_at = now()
     WHERE id = $1
     RETURNING id, user_id, stripe_subscription_id, stripe_customer_id, plan, status,
               current_period_start, current_period_end, token_quota, created_at, updated_at`,
    [current.id],
  );

  return updated.rows[0] ? toSubscriptionRecord(updated.rows[0]) : null;
}

export async function upsertSubscriptionFromStripe(input: {
  userId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  plan: Plan;
  status: SubscriptionRecord['status'];
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}): Promise<SubscriptionRecord> {
  const result = await query(
    `INSERT INTO subscriptions (
       user_id, stripe_subscription_id, stripe_customer_id, plan, status,
       current_period_start, current_period_end, token_quota
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (stripe_subscription_id)
     DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       token_quota = EXCLUDED.token_quota,
       updated_at = now()
     RETURNING id, user_id, stripe_subscription_id, stripe_customer_id, plan, status,
               current_period_start, current_period_end, token_quota, created_at, updated_at`,
    [
      input.userId,
      input.stripeSubscriptionId,
      input.stripeCustomerId,
      input.plan,
      input.status,
      input.currentPeriodStart.toISOString(),
      input.currentPeriodEnd.toISOString(),
      PLAN_QUOTA[input.plan],
    ],
  );

  await query(
    `UPDATE users SET plan = $1, updated_at = now() WHERE id = $2`,
    [input.plan, input.userId],
  );

  return toSubscriptionRecord(result.rows[0]);
}

export function constructStripeEvent(payload: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is required');
  return getStripeClient().webhooks.constructEvent(payload, signature, secret);
}
