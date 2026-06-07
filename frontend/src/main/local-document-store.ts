import fs from 'fs/promises';
import path from 'path';

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
}
