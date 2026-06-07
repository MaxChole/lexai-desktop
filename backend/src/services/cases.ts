import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { query } from '../db/index.js';
import type { CaseRecord, ChatMessage, DocumentRecord, Session } from '../types/shared.js';

interface CaseFilters {
  q?: string;
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
}

interface SessionFilters {
  q?: string;
  skillId?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface UploadTokenPayload {
  documentId: string;
  caseId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  expiresAt: number;
}

const managedUploadsDir = path.resolve(process.cwd(), '.data', 'managed-uploads');

function toCaseRecord(row: Record<string, unknown>): CaseRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
    jurisdiction: row.jurisdiction ? String(row.jurisdiction) as CaseRecord['jurisdiction'] : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    documentCount: row.document_count !== undefined ? Number(row.document_count) : undefined,
    sessionCount: row.session_count !== undefined ? Number(row.session_count) : undefined,
  };
}

function toDocumentRecord(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    userId: String(row.user_id),
    filename: String(row.filename),
    s3Key: String(row.s3_key),
    sizeBytes: Number(row.size_bytes),
    mimeType: String(row.mime_type),
    createdAt: String(row.created_at),
  };
}

function toSessionRecord(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    caseId: row.case_id ? String(row.case_id) : undefined,
    skillId: row.skill_id ? String(row.skill_id) : undefined,
    jurisdiction: row.jurisdiction ? String(row.jurisdiction) as Session['jurisdiction'] : undefined,
    model: String(row.model),
    messages: Array.isArray(row.messages) ? row.messages as ChatMessage[] : [],
    title: row.title ? String(row.title) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function buildCaseWhere(userId: string, filters: CaseFilters): { sql: string; params: unknown[] } {
  const clauses = ['c.user_id = $1'];
  const params: unknown[] = [userId];

  if (filters.q) {
    params.push(`%${filters.q.trim()}%`);
    const position = params.length;
    clauses.push(`(c.title ILIKE $${position} OR COALESCE(c.description, '') ILIKE $${position} OR EXISTS (
      SELECT 1 FROM unnest(c.tags) AS tag WHERE tag ILIKE $${position}
    ))`);
  }

  if (filters.jurisdiction && filters.jurisdiction !== 'ALL') {
    params.push(filters.jurisdiction);
    clauses.push(`c.jurisdiction = $${params.length}`);
  }

  return {
    sql: clauses.join(' AND '),
    params,
  };
}

function buildSessionWhere(userId: string, caseId: string, filters: SessionFilters): { sql: string; params: unknown[] } {
  const clauses = ['user_id = $1', 'case_id = $2'];
  const params: unknown[] = [userId, caseId];

  if (filters.q) {
    params.push(`%${filters.q.trim()}%`);
    clauses.push(`(title ILIKE $${params.length} OR CAST(messages AS TEXT) ILIKE $${params.length})`);
  }

  if (filters.skillId) {
    params.push(filters.skillId);
    clauses.push(`skill_id = $${params.length}`);
  }

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    clauses.push(`updated_at >= $${params.length}`);
  }

  if (filters.dateTo) {
    params.push(filters.dateTo);
    clauses.push(`updated_at <= $${params.length}`);
  }

  return {
    sql: clauses.join(' AND '),
    params,
  };
}

export async function listCases(userId: string, filters: CaseFilters): Promise<CaseRecord[]> {
  const where = buildCaseWhere(userId, filters);
  const result = await query(
    `SELECT
       c.id, c.user_id, c.title, c.description, c.tags, c.jurisdiction, c.created_at, c.updated_at,
       COUNT(DISTINCT d.id) AS document_count,
       COUNT(DISTINCT s.id) AS session_count
     FROM cases c
     LEFT JOIN documents d ON d.case_id = c.id
     LEFT JOIN sessions s ON s.case_id = c.id
     WHERE ${where.sql}
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    where.params,
  );

  return result.rows.map((row) => toCaseRecord(row));
}

export async function createCase(input: {
  userId: string;
  title: string;
  description?: string;
  tags?: string[];
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
}): Promise<CaseRecord> {
  const result = await query(
    `INSERT INTO cases (user_id, title, description, tags, jurisdiction)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, title, description, tags, jurisdiction, created_at, updated_at`,
    [input.userId, input.title, input.description || null, input.tags || [], input.jurisdiction || null],
  );

  return toCaseRecord(result.rows[0]);
}

export async function updateCase(input: {
  userId: string;
  caseId: string;
  title?: string;
  description?: string;
  tags?: string[];
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
}): Promise<CaseRecord | null> {
  const result = await query(
    `UPDATE cases
     SET
       title = COALESCE($3, title),
       description = $4,
       tags = COALESCE($5, tags),
       jurisdiction = COALESCE($6, jurisdiction),
       updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, title, description, tags, jurisdiction, created_at, updated_at`,
    [input.caseId, input.userId, input.title || null, input.description || null, input.tags || null, input.jurisdiction || null],
  );

  return result.rows[0] ? toCaseRecord(result.rows[0]) : null;
}

export async function deleteCase(userId: string, caseId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM cases WHERE id = $1 AND user_id = $2`,
    [caseId, userId],
  );

  return (result.rowCount || 0) > 0;
}

export async function getCaseDetail(userId: string, caseId: string, filters: SessionFilters) {
  const caseResult = await query(
    `SELECT id, user_id, title, description, tags, jurisdiction, created_at, updated_at
     FROM cases
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [caseId, userId],
  );

  if (!caseResult.rows[0]) return null;

  const documentsResult = await query(
    `SELECT id, case_id, user_id, filename, s3_key, size_bytes, mime_type, created_at
     FROM documents
     WHERE case_id = $1 AND user_id = $2
     ORDER BY created_at DESC`,
    [caseId, userId],
  );

  const sessionWhere = buildSessionWhere(userId, caseId, filters);
  const sessionsResult = await query(
    `SELECT id, user_id, case_id, skill_id, jurisdiction, model, messages, title, created_at, updated_at
     FROM sessions
     WHERE ${sessionWhere.sql}
     ORDER BY updated_at DESC
     LIMIT 50`,
    sessionWhere.params,
  );

  return {
    case: toCaseRecord(caseResult.rows[0]),
    documents: documentsResult.rows.map((row) => toDocumentRecord(row)),
    sessions: sessionsResult.rows.map((row) => toSessionRecord(row)),
  };
}

function getUploadSigningSecret(): string {
  return process.env.JWT_SECRET || 'lexai-dev-upload-secret';
}

function signUploadPayload(payload: UploadTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', getUploadSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyUploadToken(token: string): UploadTokenPayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = createHmac('sha256', getUploadSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as UploadTokenPayload;
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function storeManagedUpload(payload: UploadTokenPayload, body: Buffer): Promise<void> {
  const uploadDir = path.join(managedUploadsDir, payload.userId, payload.caseId, payload.documentId);
  await fs.promises.mkdir(uploadDir, { recursive: true });
  await fs.promises.writeFile(path.join(uploadDir, payload.filename), body);
}

export async function createDocumentUploadUrl(input: {
  userId: string;
  caseId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const caseExists = await query(
    `SELECT id FROM cases WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [input.caseId, input.userId],
  );

  if (!caseExists.rows[0]) {
    throw new Error('Case not found');
  }

  const documentId = randomUUID();
  const sanitizedName = input.filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  const s3Key = `${input.userId}/${input.caseId}/${documentId}/${sanitizedName}`;
  const token = signUploadPayload({
    documentId,
    caseId: input.caseId,
    userId: input.userId,
    filename: sanitizedName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    s3Key,
    expiresAt: Date.now() + 300_000,
  });
  const apiBase = process.env.VITE_API_BASE_URL || 'http://localhost:3001/v1';
  const uploadUrl = `${apiBase}/cases/${input.caseId}/documents/${documentId}/upload?token=${encodeURIComponent(token)}`;

  return {
    uploadUrl,
    documentId,
    s3Key,
    expiresIn: 300,
  };
}

export async function registerDocument(input: {
  documentId: string;
  caseId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
}): Promise<DocumentRecord> {
  const result = await query(
    `INSERT INTO documents (id, case_id, user_id, filename, s3_key, size_bytes, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, case_id, user_id, filename, s3_key, size_bytes, mime_type, created_at`,
    [input.documentId, input.caseId, input.userId, input.filename, input.s3Key, input.sizeBytes, input.mimeType],
  );

  await query(
    `UPDATE cases SET updated_at = now() WHERE id = $1 AND user_id = $2`,
    [input.caseId, input.userId],
  );

  return toDocumentRecord(result.rows[0]);
}

export async function listDocuments(userId: string, caseId: string): Promise<DocumentRecord[]> {
  const result = await query(
    `SELECT id, case_id, user_id, filename, s3_key, size_bytes, mime_type, created_at
     FROM documents
     WHERE case_id = $1 AND user_id = $2
     ORDER BY created_at DESC`,
    [caseId, userId],
  );

  return result.rows.map((row) => toDocumentRecord(row));
}

export async function deleteDocument(userId: string, caseId: string, documentId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM documents WHERE id = $1 AND case_id = $2 AND user_id = $3`,
    [documentId, caseId, userId],
  );

  if ((result.rowCount || 0) > 0) {
    await query(
      `UPDATE cases SET updated_at = now() WHERE id = $1 AND user_id = $2`,
      [caseId, userId],
    );
  }

  return (result.rowCount || 0) > 0;
}

export async function saveChatSessionExchange(input: {
  userId: string;
  sessionId?: string;
  caseId?: string;
  skillId?: string;
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS';
  model: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<Session | null> {
  if (!input.caseId && !input.sessionId) {
    return null;
  }

  const existing = input.sessionId
    ? await query(
        `SELECT id, messages, title
         FROM sessions
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [input.sessionId, input.userId],
      )
    : { rows: [] };

  const existingRow = existing.rows[0];
  const previousMessages = Array.isArray(existingRow?.messages) ? existingRow.messages as ChatMessage[] : [];
  const nextMessages: ChatMessage[] = [
    ...previousMessages,
    { role: 'user', content: input.userMessage, timestamp: new Date().toISOString() },
    { role: 'assistant', content: input.assistantMessage, timestamp: new Date().toISOString() },
  ];
  const title = existingRow?.title
    ? String(existingRow.title)
    : input.userMessage.trim().slice(0, 60) || '新会话';

  const result = await query(
    `INSERT INTO sessions (id, user_id, case_id, skill_id, jurisdiction, model, messages, title, updated_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb, $8, now())
     ON CONFLICT (id)
     DO UPDATE SET
       case_id = COALESCE(EXCLUDED.case_id, sessions.case_id),
       skill_id = COALESCE(EXCLUDED.skill_id, sessions.skill_id),
       jurisdiction = COALESCE(EXCLUDED.jurisdiction, sessions.jurisdiction),
       model = EXCLUDED.model,
       messages = EXCLUDED.messages,
       title = EXCLUDED.title,
       updated_at = now()
     RETURNING id, user_id, case_id, skill_id, jurisdiction, model, messages, title, created_at, updated_at`,
    [
      input.sessionId || null,
      input.userId,
      input.caseId || null,
      input.skillId || null,
      input.jurisdiction || null,
      input.model,
      JSON.stringify(nextMessages),
      title,
    ],
  );

  if (input.caseId) {
    await query(
      `UPDATE cases SET updated_at = now() WHERE id = $1 AND user_id = $2`,
      [input.caseId, input.userId],
    );
  }

  return toSessionRecord(result.rows[0]);
}
