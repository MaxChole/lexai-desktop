import { createClient, type SupabaseClient, type User as SupabaseUser } from '@supabase/supabase-js';
import { query } from '../db/index.js';
import type { Plan, User } from '../types/shared.js';

let publicClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is required');
  return url;
}

function getAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('SUPABASE_ANON_KEY is required');
  return key;
}

function getServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is required');
  return key;
}

export function getSupabasePublicClient(): SupabaseClient {
  if (!publicClient) {
    publicClient = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return publicClient;
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(getSupabaseUrl(), getServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

function mapPlan(raw: unknown): Plan {
  return raw === 'professional' || raw === 'enterprise' ? raw : 'starter';
}

function toAppUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    supabaseId: String(row.supabase_id),
    plan: mapPlan(row.plan),
    role: row.role === 'admin' ? 'admin' : 'member',
    orgId: row.org_id ? String(row.org_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function ensureLocalUser(input: {
  email: string;
  supabaseId: string;
}): Promise<User> {
  const existing = await query(
    `SELECT id, email, supabase_id, plan, role, org_id, created_at, updated_at
     FROM users
     WHERE supabase_id = $1
     LIMIT 1`,
    [input.supabaseId],
  );

  if (existing.rows[0]) {
    return toAppUser(existing.rows[0]);
  }

  const inserted = await query(
    `INSERT INTO users (email, supabase_id)
     VALUES ($1, $2)
     RETURNING id, email, supabase_id, plan, role, org_id, created_at, updated_at`,
    [input.email, input.supabaseId],
  );

  return toAppUser(inserted.rows[0]);
}

export async function getUserBySupabaseId(supabaseId: string): Promise<User | null> {
  const result = await query(
    `SELECT id, email, supabase_id, plan, role, org_id, created_at, updated_at
     FROM users
     WHERE supabase_id = $1
     LIMIT 1`,
    [supabaseId],
  );

  return result.rows[0] ? toAppUser(result.rows[0]) : null;
}

export async function getAuthenticatedUserFromToken(token: string): Promise<{ appUser: User; supabaseUser: SupabaseUser }> {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.auth.getUser(token);

  if (error || !data.user) {
    throw new Error(error?.message || 'Invalid auth token');
  }

  const appUser = await ensureLocalUser({
    email: data.user.email || '',
    supabaseId: data.user.id,
  });

  return {
    appUser,
    supabaseUser: data.user,
  };
}

export function readBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
