import type { FastifyInstance } from 'fastify';
import { getAuthenticatedUserFromToken, readBearerToken } from '../services/auth.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications.js';

async function requireAuth(header: string | undefined) {
  const token = readBearerToken(header);
  if (!token) {
    throw new Error('Authorization Bearer token is required');
  }
  return getAuthenticatedUserFromToken(token);
}

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      return {
        notifications: await listNotifications(appUser.id),
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.patch('/notifications/:id/read', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const { id } = request.params as { id: string };
      const ok = await markNotificationRead(appUser.id, id);
      if (!ok) {
        return reply.code(404).send({
          error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found' },
        });
      }
      return { ok: true };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.patch('/notifications/read-all', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      await markAllNotificationsRead(appUser.id);
      return { ok: true };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
