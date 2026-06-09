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
  state: 'not_installed' | 'downloading' | 'paused' | 'installed' | 'unsupported';
  downloadedBytes: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  filePath?: string;
  sourceUrl?: string;
  sourcePageUrl?: string;
  recommended?: boolean;
  experimental?: boolean;
  supportsEmbeddedRuntime?: boolean;
  summary?: string;
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

interface LocalModelDefinition {
  id: string;
  name: string;
  provider: 'embedded';
  fileName: string;
  sizeBytes: number;
  recommendedRamGb: number;
  recommended: boolean;
  experimental: boolean;
  supportsEmbeddedRuntime: boolean;
  summary: string;
  sourcePageUrl: string;
  directDownloadUrl?: string;
}

const MODEL_CATALOG: LocalModelDefinition[] = [
  {
    id: MODEL_ID,
    name: 'Qwen2.5-7B-Instruct-Q4_K_M',
    provider: 'embedded',
    fileName: MODEL_FILE,
    sizeBytes: MODEL_SIZE_BYTES,
    recommendedRamGb: RECOMMENDED_RAM_GB,
    recommended: true,
    experimental: false,
    supportsEmbeddedRuntime: true,
    summary: '推荐给大多数用户，约 5 GB，16 GB 内存即可稳定本地运行。',
    sourcePageUrl: 'https://www.modelscope.cn/models/Qwen/Qwen2.5-7B-Instruct-GGUF',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    provider: 'embedded',
    fileName: 'DeepSeek-V4-Flash-GGUF',
    sizeBytes: 81 * 1024 * 1024 * 1024,
    recommendedRamGb: 96,
    recommended: false,
    experimental: true,
    supportsEmbeddedRuntime: false,
    summary: '实验性选项。模型体积和显存/内存需求远高于 Qwen，当前桌面端 embedded runtime 不支持一键离线运行。',
    sourcePageUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash',
    directDownloadUrl: 'https://huggingface.co/teamblobfish/DeepSeek-V4-Flash-GGUF',
  },
];

export class LocalModelManager {
  private downloadAbortController: AbortController | null = null;
  private downloadSnapshot: DownloadSnapshot | null = null;
  private lastError?: string;

  constructor(
    private readonly rootDir: string,
    private readonly sourceUrl?: string,
  ) {}

  private get primaryModel(): LocalModelDefinition {
    return MODEL_CATALOG[0];
  }

  private get modelPath(): string {
    return path.join(this.rootDir, this.primaryModel.fileName);
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
    if (ramGb < this.primaryModel.recommendedRamGb) {
      return `检测到内存约 ${ramGb.toFixed(1)} GB，低于推荐的 ${this.primaryModel.recommendedRamGb} GB，本地推理可能较慢。`;
    }
    return undefined;
  }

  async listModels(): Promise<ManagedLocalModelStatus[]> {
    await this.ensureRootDir();

    const installedBytes = await this.getFileSize(this.modelPath);
    const partialBytes = await this.getFileSize(this.partialPath);
    const activeState = installedBytes > 0
      ? 'installed'
      : this.downloadSnapshot?.state === 'downloading'
        ? 'downloading'
        : this.downloadSnapshot?.state === 'paused'
          ? 'paused'
          : 'not_installed';

    return MODEL_CATALOG.map((definition) => {
      const isPrimary = definition.id === this.primaryModel.id;
      const downloadedBytes = isPrimary
        ? (installedBytes > 0 ? installedBytes : partialBytes)
        : 0;

      return {
        id: definition.id,
        name: definition.name,
        provider: definition.provider,
        fileName: definition.fileName,
        sizeBytes: definition.sizeBytes,
        recommendedRamGb: definition.recommendedRamGb,
        state: definition.supportsEmbeddedRuntime
          ? activeState
          : 'unsupported',
        downloadedBytes: isPrimary
          ? (this.downloadSnapshot?.downloadedBytes ?? downloadedBytes)
          : 0,
        speedBytesPerSecond: isPrimary ? this.downloadSnapshot?.speedBytesPerSecond : undefined,
        etaSeconds: isPrimary ? this.downloadSnapshot?.etaSeconds : undefined,
        filePath: isPrimary && installedBytes > 0 ? this.modelPath : undefined,
        sourceUrl: isPrimary ? (this.sourceUrl || definition.directDownloadUrl) : definition.directDownloadUrl,
        sourcePageUrl: definition.sourcePageUrl,
        recommended: definition.recommended,
        experimental: definition.experimental,
        supportsEmbeddedRuntime: definition.supportsEmbeddedRuntime,
        summary: definition.summary,
        warning: isPrimary ? this.getWarning() : undefined,
        lastError: isPrimary ? this.lastError : definition.supportsEmbeddedRuntime
          ? undefined
          : '当前桌面端 embedded runtime 暂不支持该模型的一键离线运行。',
      };
    });
  }

  async getStatus(): Promise<ManagedLocalModelStatus> {
    const [primaryStatus] = await this.listModels();
    return primaryStatus;
  }

  async startDownload(modelId = this.primaryModel.id): Promise<ManagedLocalModelStatus> {
    if (modelId !== this.primaryModel.id) {
      this.lastError = '当前桌面端 embedded runtime 仅支持一键下载并运行推荐的 Qwen 本地模型。';
      return (await this.listModels()).find((item) => item.id === modelId) ?? this.getStatus();
    }

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

  async deleteModel(modelId = this.primaryModel.id): Promise<ManagedLocalModelStatus> {
    if (modelId !== this.primaryModel.id) {
      return (await this.listModels()).find((item) => item.id === modelId) ?? this.getStatus();
    }

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
