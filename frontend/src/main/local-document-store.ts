import fs from 'fs/promises';
import path from 'path';
import type { LocalConversationAttachment } from './local-chat-store.js';

export interface StoredDocumentInput {
  path: string;
  name: string;
  size: number;
}

export interface StoredDocumentRecord {
  id: string;
  name: string;
  storedPath: string;
  originalPath: string;
  size: number;
  createdAt: string;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isTextPreviewable(fileName: string): boolean {
  return ['.txt', '.md', '.markdown'].includes(path.extname(fileName).toLowerCase());
}

export class LocalDocumentStore {
  constructor(private readonly rootDir: string) {}

  async saveFiles(conversationId: string, files: StoredDocumentInput[]): Promise<StoredDocumentRecord[]> {
    const conversationDir = path.join(this.rootDir, conversationId);
    await fs.mkdir(conversationDir, { recursive: true });

    const now = new Date().toISOString();
    const storedRecords: StoredDocumentRecord[] = [];

    for (const file of files) {
      const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fileName = `${id}-${sanitizeFileName(file.name)}`;
      const destinationPath = path.join(conversationDir, fileName);

      await fs.copyFile(file.path, destinationPath);

      storedRecords.push({
        id,
        name: file.name,
        storedPath: destinationPath,
        originalPath: file.path,
        size: file.size,
        createdAt: now,
      });
    }

    return storedRecords;
  }

  async deleteConversationFiles(conversationId: string): Promise<void> {
    const conversationDir = path.join(this.rootDir, conversationId);
    await fs.rm(conversationDir, { recursive: true, force: true });
  }

  async buildAttachmentContext(attachments: LocalConversationAttachment[]): Promise<string | undefined> {
    if (attachments.length === 0) {
      return undefined;
    }

    const sections = await Promise.all(attachments.map(async (attachment, index) => {
      const header = [
        `Attachment ${index + 1}`,
        `name: ${attachment.name}`,
        `size: ${attachment.size} bytes`,
      ];

      if (!isTextPreviewable(attachment.name)) {
        header.push('preview: unavailable (binary document; rely on filename and user instructions)');
        return header.join('\n');
      }

      try {
        const raw = await fs.readFile(attachment.storedPath, 'utf-8');
        const normalized = raw.replace(/\r\n/g, '\n').trim();
        const preview = normalized.slice(0, 4000);
        header.push('preview:');
        header.push(preview || '(empty file)');
        if (normalized.length > preview.length) {
          header.push('[truncated]');
        }
        return header.join('\n');
      } catch (error) {
        header.push(`preview: unavailable (${error instanceof Error ? error.message : String(error)})`);
        return header.join('\n');
      }
    }));

    return `# Local Attachment Context\n\nThe current desktop conversation includes these local files. Use them when relevant, and explicitly say when a binary file could not be fully read.\n\n${sections.join('\n\n---\n\n')}`;
  }
}
