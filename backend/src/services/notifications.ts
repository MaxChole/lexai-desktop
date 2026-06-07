import { query } from '../db/index.js';

export interface NotificationRecord {
  id: string;
  userId: string;
  agentId?: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

function toNotificationRecord(row: Record<string, unknown>): NotificationRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    agentId: row.agent_id ? String(row.agent_id) : undefined,
    title: String(row.title),
    body: String(row.body),
    read: Boolean(row.read),
    createdAt: String(row.created_at),
  };
}

export async function listNotifications(userId: string): Promise<NotificationRecord[]> {
  const result = await query(
    `SELECT id, user_id, agent_id, title, body, read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [userId],
  );

  return result.rows.map((row) => toNotificationRecord(row));
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await query(
    `UPDATE notifications
     SET read = true
     WHERE id = $1 AND user_id = $2`,
    [notificationId, userId],
  );

  return (result.rowCount || 0) > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await query(
    `UPDATE notifications
     SET read = true
     WHERE user_id = $1 AND read = false`,
    [userId],
  );
}
