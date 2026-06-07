import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface LocalConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: string;
}

export interface LocalConversationAttachment {
  id: string;
  name: string;
  storedPath: string;
  originalPath: string;
  size: number;
  createdAt: string;
}

export interface LocalConversationRecord {
  id: string;
  title: string;
  skillId?: string;
  createdAt: string;
  updatedAt: string;
  messages: LocalConversationMessage[];
  attachments: LocalConversationAttachment[];
}

export interface LocalConversationSummary {
  id: string;
  title: string;
  skillId?: string;
  updatedAt: string;
  messageCount: number;
  attachmentCount: number;
}

function makeConversationTitle(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新本地会话';
  return normalized.slice(0, 36);
}

function sqlText(value: string | undefined): string {
  if (value === undefined) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlInteger(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

export class LocalChatStore {
  private readonly sqlitePath = '/usr/bin/sqlite3';
  private readonly ready: Promise<void>;

  constructor(private readonly dbPath: string) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    await this.run(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        skill_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta TEXT,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        original_path TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id, position);
      CREATE INDEX IF NOT EXISTS idx_attachments_conversation_id ON attachments (conversation_id, created_at);
    `);
  }

  private async run(sql: string): Promise<void> {
    await execFileAsync(this.sqlitePath, [this.dbPath, sql]);
  }

  private async query<T>(sql: string): Promise<T[]> {
    const { stdout } = await execFileAsync(this.sqlitePath, ['-json', this.dbPath, sql]);
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed) as T[];
  }

  async listConversations(): Promise<LocalConversationSummary[]> {
    await this.ready;
    const rows = await this.query<Array<{
      id: string;
      title: string;
      skill_id?: string | null;
      updated_at: string;
      message_count: number;
      attachment_count: number;
    }>[number]>(`
      SELECT
        c.id,
        c.title,
        c.skill_id,
        c.updated_at,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
        (SELECT COUNT(*) FROM attachments a WHERE a.conversation_id = c.id) AS attachment_count
      FROM conversations c
      ORDER BY c.updated_at DESC;
    `);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      skillId: row.skill_id ?? undefined,
      updatedAt: row.updated_at,
      messageCount: Number(row.message_count ?? 0),
      attachmentCount: Number(row.attachment_count ?? 0),
    }));
  }

  async getConversation(id: string): Promise<LocalConversationRecord | null> {
    await this.ready;
    const [conversation] = await this.query<Array<{
      id: string;
      title: string;
      skill_id?: string | null;
      created_at: string;
      updated_at: string;
    }>[number]>(`
      SELECT id, title, skill_id, created_at, updated_at
      FROM conversations
      WHERE id = ${sqlText(id)}
      LIMIT 1;
    `);

    if (!conversation) return null;

    const messages = await this.query<Array<{
      role: LocalConversationMessage['role'];
      content: string;
      meta?: string | null;
    }>[number]>(`
      SELECT role, content, meta
      FROM messages
      WHERE conversation_id = ${sqlText(id)}
      ORDER BY position ASC;
    `);

    const attachments = await this.query<Array<{
      id: string;
      name: string;
      stored_path: string;
      original_path: string;
      size: number;
      created_at: string;
    }>[number]>(`
      SELECT id, name, stored_path, original_path, size, created_at
      FROM attachments
      WHERE conversation_id = ${sqlText(id)}
      ORDER BY created_at ASC;
    `);

    return {
      id: conversation.id,
      title: conversation.title,
      skillId: conversation.skill_id ?? undefined,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        meta: message.meta ?? undefined,
      })),
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        storedPath: attachment.stored_path,
        originalPath: attachment.original_path,
        size: Number(attachment.size),
        createdAt: attachment.created_at,
      })),
    };
  }

  async deleteConversation(id: string): Promise<void> {
    await this.ready;
    await this.run(`
      BEGIN TRANSACTION;
      DELETE FROM messages WHERE conversation_id = ${sqlText(id)};
      DELETE FROM attachments WHERE conversation_id = ${sqlText(id)};
      DELETE FROM conversations WHERE id = ${sqlText(id)};
      COMMIT;
    `);
  }

  async createConversation(skillId?: string): Promise<LocalConversationRecord> {
    await this.ready;
    const now = new Date().toISOString();
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await this.run(`
      INSERT INTO conversations (id, title, skill_id, created_at, updated_at)
      VALUES (${sqlText(id)}, '新本地会话', ${sqlText(skillId)}, ${sqlText(now)}, ${sqlText(now)});
    `);

    return {
      id,
      title: '新本地会话',
      skillId,
      createdAt: now,
      updatedAt: now,
      messages: [],
      attachments: [],
    };
  }

  async addAttachments(payload: {
    conversationId: string;
    skillId?: string;
    attachments: LocalConversationAttachment[];
  }): Promise<LocalConversationRecord> {
    await this.ready;
    const now = new Date().toISOString();
    const values = payload.attachments.map((attachment) => `(
      ${sqlText(attachment.id)},
      ${sqlText(payload.conversationId)},
      ${sqlText(attachment.name)},
      ${sqlText(attachment.storedPath)},
      ${sqlText(attachment.originalPath)},
      ${sqlInteger(attachment.size)},
      ${sqlText(attachment.createdAt)}
    )`).join(',\n');

    await this.run(`
      BEGIN TRANSACTION;
      UPDATE conversations
      SET skill_id = COALESCE(${sqlText(payload.skillId)}, skill_id),
          updated_at = ${sqlText(now)}
      WHERE id = ${sqlText(payload.conversationId)};
      INSERT INTO attachments (id, conversation_id, name, stored_path, original_path, size, created_at)
      VALUES ${values};
      COMMIT;
    `);

    const conversation = await this.getConversation(payload.conversationId);
    if (!conversation) {
      throw new Error(`Local conversation not found: ${payload.conversationId}`);
    }
    return conversation;
  }

  async saveExchange(payload: {
    conversationId?: string;
    skillId?: string;
    userMessage: LocalConversationMessage;
    assistantMessage: LocalConversationMessage;
  }): Promise<LocalConversationRecord> {
    await this.ready;
    const now = new Date().toISOString();
    const existing = payload.conversationId ? await this.getConversation(payload.conversationId) : null;
    const id = existing?.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const currentMessageCount = existing?.messages.length ?? 0;
    const title = existing?.title ?? makeConversationTitle(payload.userMessage.content);
    const createdAt = existing?.createdAt ?? now;

    await this.run(`
      BEGIN TRANSACTION;
      INSERT OR REPLACE INTO conversations (id, title, skill_id, created_at, updated_at)
      VALUES (${sqlText(id)}, ${sqlText(title)}, ${sqlText(payload.skillId ?? existing?.skillId)}, ${sqlText(createdAt)}, ${sqlText(now)});
      INSERT INTO messages (id, conversation_id, role, content, meta, position, created_at)
      VALUES
        (${sqlText(`${id}-msg-${currentMessageCount + 1}`)}, ${sqlText(id)}, ${sqlText(payload.userMessage.role)}, ${sqlText(payload.userMessage.content)}, ${sqlText(payload.userMessage.meta)}, ${sqlInteger(currentMessageCount + 1)}, ${sqlText(now)}),
        (${sqlText(`${id}-msg-${currentMessageCount + 2}`)}, ${sqlText(id)}, ${sqlText(payload.assistantMessage.role)}, ${sqlText(payload.assistantMessage.content)}, ${sqlText(payload.assistantMessage.meta)}, ${sqlInteger(currentMessageCount + 2)}, ${sqlText(now)});
      COMMIT;
    `);

    const conversation = await this.getConversation(id);
    if (!conversation) {
      throw new Error(`Failed to load saved conversation: ${id}`);
    }
    return conversation;
  }
}
