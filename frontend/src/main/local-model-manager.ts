import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';

export interface ManagedLocalModelStatus {
  id: string;
  name: string;
  provider: 'embedded';
  fileName: string;
  sizeBytes: number;
  recommendedRamGb: number;
  state: 'not_installed' | 'downloading' | 'paused' | 'installed';
  downloadedBytes: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  filePath?: string;
  sourceUrl?: string;
  warning?: string;
  lastError?: string;
}

interface DownloadSnapshot {
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  startedAt: number;
  state: ManagedLocalModelStatus['state'];
}

const MODEL_ID = 'qwen2.5-7b-instruct-q4_k_m';
const MODEL_FILE = 'Qwen2.5-7B-Instruct-Q4_K_M.gguf';
const MODEL_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
const RECOMMENDED_RAM_GB = 16;

export class LocalModelManager {
  private downloadAbortController: AbortController | null = null;
  private downloadSnapshot: DownloadSnapshot | null = null;
  private lastError?: string;

  constructor(
    private readonly rootDir: string,
    private readonly sourceUrl?: string,
  ) {}

  private get modelPath(): string {
    return path.join(this.rootDir, MODEL_FILE);
  }

  private get partialPath(): string {
    return `${this.modelPath}.part`;
  }

  private async ensureRootDir(): Promise<void> {
    await fsPromises.mkdir(this.rootDir, { recursive: true });
  }

  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stat = await fsPromises.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  private getWarning(): string | undefined {
    const ramGb = os.totalmem() / 1024 / 1024 / 1024;
    if (ramGb < RECOMMENDED_RAM_GB) {
      return `检测到内存约 ${ramGb.toFixed(1)} GB，低于推荐的 ${RECOMMENDED_RAM_GB} GB，本地推理可能较慢。`;
    }
    return undefined;
  }

  async getStatus(): Promise<ManagedLocalModelStatus> {
    await this.ensureRootDir();

    const installedBytes = await this.getFileSize(this.modelPath);
    const partialBytes = await this.getFileSize(this.partialPath);
    const downloadState = this.downloadSnapshot?.state;
    const downloadedBytes = installedBytes > 0 ? installedBytes : partialBytes;
    const state: ManagedLocalModelStatus['state'] = installedBytes > 0
      ? 'installed'
      : downloadState === 'downloading'
        ? 'downloading'
        : downloadState === 'paused'
          ? 'paused'
          : 'not_installed';

    return {
      id: MODEL_ID,
      name: 'Qwen2.5-7B-Instruct-Q4_K_M',
      provider: 'embedded',
      fileName: MODEL_FILE,
      sizeBytes: MODEL_SIZE_BYTES,
      recommendedRamGb: RECOMMENDED_RAM_GB,
      state,
      downloadedBytes: this.downloadSnapshot?.downloadedBytes ?? downloadedBytes,
      speedBytesPerSecond: this.downloadSnapshot?.speedBytesPerSecond,
      etaSeconds: this.downloadSnapshot?.etaSeconds,
      filePath: installedBytes > 0 ? this.modelPath : undefined,
      sourceUrl: this.sourceUrl,
      warning: this.getWarning(),
      lastError: this.lastError,
    };
  }

  async startDownload(): Promise<ManagedLocalModelStatus> {
    if (!this.sourceUrl) {
      this.lastError = '未配置 LOCAL_LLM_MODEL_URL，无法下载内嵌模型文件。';
      return this.getStatus();
    }

    if (this.downloadSnapshot?.state === 'downloading') {
      return this.getStatus();
    }

    await this.ensureRootDir();
    const existingBytes = await this.getFileSize(this.partialPath);
    this.downloadAbortController = new AbortController();
    this.downloadSnapshot = {
      downloadedBytes: existingBytes,
      totalBytes: MODEL_SIZE_BYTES,
      startedAt: Date.now(),
      state: 'downloading',
    };
    this.lastError = undefined;

    void this.runDownload(existingBytes);
    return this.getStatus();
  }

  async pauseDownload(): Promise<ManagedLocalModelStatus> {
    if (this.downloadAbortController) {
      this.downloadSnapshot = this.downloadSnapshot
        ? { ...this.downloadSnapshot, state: 'paused', speedBytesPerSecond: 0, etaSeconds: undefined }
        : null;
      this.downloadAbortController.abort();
      this.downloadAbortController = null;
    }
    return this.getStatus();
  }

  async deleteModel(): Promise<ManagedLocalModelStatus> {
    await this.pauseDownload();
    await fsPromises.rm(this.modelPath, { force: true });
    await fsPromises.rm(this.partialPath, { force: true });
    this.downloadSnapshot = null;
    this.lastError = undefined;
    return this.getStatus();
  }

  private async runDownload(existingBytes: number): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (existingBytes > 0) {
        headers.Range = `bytes=${existingBytes}-`;
      }

      const response = await fetch(this.sourceUrl as string, {
        headers,
        signal: this.downloadAbortController?.signal,
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const contentLength = Number(response.headers.get('content-length') || '0');
      const totalBytes = existingBytes + (Number.isFinite(contentLength) ? contentLength : 0);
      if (this.downloadSnapshot) {
        this.downloadSnapshot.totalBytes = totalBytes > 0 ? totalBytes : MODEL_SIZE_BYTES;
      }

      const body = response.body;
      if (!body) {
        throw new Error('Model download stream is unavailable');
      }

      const writer = fs.createWriteStream(this.partialPath, { flags: existingBytes > 0 ? 'a' : 'w' });
      const reader = body.getReader();
      let downloadedBytes = existingBytes;
      const startedAt = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        await new Promise<void>((resolve, reject) => {
          writer.write(Buffer.from(value), (error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        downloadedBytes += value.byteLength;
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
        const speedBytesPerSecond = downloadedBytes / elapsedSeconds;
        const remainingBytes = Math.max((this.downloadSnapshot?.totalBytes ?? MODEL_SIZE_BYTES) - downloadedBytes, 0);
        const etaSeconds = speedBytesPerSecond > 0 ? Math.round(remainingBytes / speedBytesPerSecond) : undefined;

        if (this.downloadSnapshot) {
          this.downloadSnapshot = {
            ...this.downloadSnapshot,
            downloadedBytes,
            speedBytesPerSecond,
            etaSeconds,
            state: 'downloading',
          };
        }
      }

      await new Promise<void>((resolve, reject) => {
        writer.end((error?: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
      });

      await fsPromises.rename(this.partialPath, this.modelPath);
      this.downloadSnapshot = null;
      this.downloadAbortController = null;
      this.lastError = undefined;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      this.lastError = error instanceof Error ? error.message : String(error);
      if (this.downloadSnapshot) {
        this.downloadSnapshot = {
          ...this.downloadSnapshot,
          state: 'paused',
          speedBytesPerSecond: 0,
          etaSeconds: undefined,
        };
      }
      this.downloadAbortController = null;
    }
  }
}
