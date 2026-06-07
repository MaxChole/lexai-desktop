import type { FastifyInstance } from 'fastify';
import {
  ensureLocalUser,
  getAuthenticatedUserFromToken,
  getSupabasePublicClient,
  readBearerToken,
} from '../services/auth.js';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      return reply.code(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
      });
    }

    const client = getSupabasePublicClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
    });

    if (error || !data.user) {
      return reply.code(400).send({
        error: { code: 'AUTH_REGISTER_FAILED', message: error?.message || 'Registration failed' },
      });
    }

    const user = await ensureLocalUser({
      email: data.user.email || email,
      supabaseId: data.user.id,
    });

    return {
      user,
      session: data.session
        ? {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at,
          }
        : null,
    };
  });

  app.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      return reply.code(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
      });
    }

    const client = getSupabasePublicClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error || !data.user || !data.session) {
      return reply.code(401).send({
        error: { code: 'AUTH_LOGIN_FAILED', message: error?.message || 'Login failed' },
      });
    }

    const user = await ensureLocalUser({
      email: data.user.email || email,
      supabaseId: data.user.id,
    });

    return {
      user,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    };
  });

  app.get('/auth/google', async (request, reply) => {
    const { redirectTo } = request.query as { redirectTo?: string };
    const client = getSupabasePublicClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo || 'https://app.lexai.local/auth/callback',
        skipBrowserRedirect: true,
      },
    });

    if (error || !data.url) {
      return reply.code(400).send({
        error: { code: 'AUTH_GOOGLE_FAILED', message: error?.message || 'Failed to create Google OAuth URL' },
      });
    }

    return {
      url: data.url,
    };
  });

  app.get('/auth/me', async (request, reply) => {
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: 'Authorization Bearer token is required' },
      });
    }

    try {
      const { appUser, supabaseUser } = await getAuthenticatedUserFromToken(token);
      return {
        user: appUser,
        auth: {
          emailConfirmedAt: supabaseUser.email_confirmed_at,
          lastSignInAt: supabaseUser.last_sign_in_at,
        },
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_INVALID', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.post('/auth/logout', async () => {
    return { ok: true };
  });
}
