import type { FastifyInstance } from 'fastify';
import { getAuthenticatedUserFromToken, readBearerToken } from '../services/auth.js';
import {
  createCase,
  createDocumentUploadUrl,
  deleteCase,
  deleteDocument,
  getCaseDetail,
  listCases,
  listDocuments,
  registerDocument,
  storeManagedUpload,
  updateCase,
  verifyUploadToken,
} from '../services/cases.js';

async function requireAuth(header: string | undefined) {
  const token = readBearerToken(header);
  if (!token) {
    throw new Error('Authorization Bearer token is required');
  }
  return getAuthenticatedUserFromToken(token);
}

export default async function caseRoutes(app: FastifyInstance) {
  app.get('/cases', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const query = request.query as { q?: string; jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL' };
      return {
        cases: await listCases(appUser.id, {
          q: query.q,
          jurisdiction: query.jurisdiction,
        }),
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.post('/cases', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const body = request.body as {
        title?: string;
        description?: string;
        tags?: string[];
        jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
      };

      if (!body.title?.trim()) {
        return reply.code(422).send({
          error: { code: 'VALIDATION_ERROR', message: 'title is required' },
        });
      }

      return {
        case: await createCase({
          userId: appUser.id,
          title: body.title.trim(),
          description: body.description?.trim(),
          tags: body.tags ?? [],
          jurisdiction: body.jurisdiction,
        }),
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.get('/cases/:caseId', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const params = request.params as { caseId: string };
      const query = request.query as { q?: string; skillId?: string; dateFrom?: string; dateTo?: string };
      const detail = await getCaseDetail(appUser.id, params.caseId, query);
      if (!detail) {
        return reply.code(404).send({
          error: { code: 'CASE_NOT_FOUND', message: 'Case not found' },
        });
      }
      return detail;
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.patch('/cases/:caseId', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const params = request.params as { caseId: string };
      const body = request.body as {
        title?: string;
        description?: string;
        tags?: string[];
        jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
      };
      const updated = await updateCase({
        userId: appUser.id,
        caseId: params.caseId,
        title: body.title?.trim(),
        description: body.description?.trim(),
        tags: body.tags,
        jurisdiction: body.jurisdiction,
      });

      if (!updated) {
        return reply.code(404).send({
          error: { code: 'CASE_NOT_FOUND', message: 'Case not found' },
        });
      }

      return { case: updated };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.delete('/cases/:caseId', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const params = request.params as { caseId: string };
      const deleted = await deleteCase(appUser.id, params.caseId);
      if (!deleted) {
        return reply.code(404).send({
          error: { code: 'CASE_NOT_FOUND', message: 'Case not found' },
        });
      }
      return { ok: true };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.post('/cases/:caseId/documents/upload-url', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const params = request.params as { caseId: string };
      const body = request.body as {
        filename?: string;
        mimeType?: string;
        sizeBytes?: number;
      };

      if (!body.filename || !body.mimeType || !body.sizeBytes) {
        return reply.code(422).send({
          error: { code: 'VALIDATION_ERROR', message: 'filename, mimeType, and sizeBytes are required' },
        });
      }

      return await createDocumentUploadUrl({
        userId: appUser.id,
        caseId: params.caseId,
        filename: body.filename,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === 'Case not found' ? 404 : message === 'S3 configuration is incomplete' ? 503 : 401;
      const code = statusCode === 404 ? 'CASE_NOT_FOUND' : statusCode === 503 ? 'S3_NOT_CONFIGURED' : 'AUTH_REQUIRED';
      return reply.code(statusCode).send({
        error: { code, message },
      });
    }
  });

  app.post('/cases/:caseId/documents', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const params = request.params as { caseId: string };
      const body = request.body as {
        documentId?: string;
        filename?: string;
        mimeType?: string;
        sizeBytes?: number;
        s3Key?: string;
      };

      if (!body.documentId || !body.filename || !body.mimeType || !body.sizeBytes || !body.s3Key) {
        return reply.code(422).send({
          error: { code: 'VALIDATION_ERROR', message: 'documentId, filename, mimeType, sizeBytes, and s3Key are required' },
        });
      }

      return {
        document: await registerDocument({
          documentId: body.documentId,
          caseId: params.caseId,
          userId: appUser.id,
          filename: body.filename,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
          s3Key: body.s3Key,
        }),
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.put('/cases/:caseId/documents/:documentId/upload', async (request, reply) => {
    const params = request.params as { caseId: string; documentId: string };
    const query = request.query as { token?: string };
    const payload = query.token ? verifyUploadToken(query.token) : null;

    if (!payload || payload.caseId !== params.caseId || payload.documentId !== params.documentId) {
      return reply.code(401).send({
        error: { code: 'UPLOAD_TOKEN_INVALID', message: 'Upload token is invalid or expired' },
      });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request.raw) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    await storeManagedUpload(payload, Buffer.concat(chunks));
    return reply.code(204).send();
  });

  app.get('/cases/:caseId/documents', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const params = request.params as { caseId: string };
      return {
        documents: await listDocuments(appUser.id, params.caseId),
      };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.delete('/cases/:caseId/documents/:documentId', async (request, reply) => {
    try {
      const { appUser } = await requireAuth(request.headers.authorization);
      const params = request.params as { caseId: string; documentId: string };
      const deleted = await deleteDocument(appUser.id, params.caseId, params.documentId);
      if (!deleted) {
        return reply.code(404).send({
          error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
        });
      }
      return { ok: true };
    } catch (error) {
      return reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
