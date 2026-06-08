import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { URL } from 'url';

export interface LocalInferenceConfig {
  executablePath?: string;
  args: string[];
  baseUrl: string;
  healthPath: string;
  provider: 'embedded' | 'ollama';
  model: string;
  autostart: boolean;
}

export interface LocalInferenceStatus {
  enabled: boolean;
  provider: 'embedded' | 'ollama';
  model: string;
  baseUrl: string;
  pid?: number;
  running: boolean;
  healthy: boolean;
  lastError?: string;
}

function parseArgs(raw: string | undefined): string[] {
  if (!raw) return [];

  const args: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaping = false;

  for (const char of raw) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function loadLocalInferenceConfig(): LocalInferenceConfig {
  return {
    executablePath: process.env.LOCAL_LLM_EXECUTABLE_PATH,
    args: parseArgs(process.env.LOCAL_LLM_ARGS),
    baseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435/v1',
    healthPath: process.env.LOCAL_LLM_HEALTH_PATH || '/health',
    provider: process.env.LOCAL_LLM_PROVIDER === 'ollama' ? 'ollama' : 'embedded',
    model: process.env.LOCAL_LLM_MODEL || 'qwen2.5-7b-instruct-q4_k_m',
    autostart: process.env.LOCAL_LLM_AUTOSTART === 'true',
  };
}

export class LocalInferenceSidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lastError: string | undefined;

  constructor(private readonly config: LocalInferenceConfig) {}

  async start(): Promise<void> {
    if (!this.config.autostart || !this.config.executablePath || this.child) {
      return;
    }

    const runtimeUrl = new URL(this.config.baseUrl);
    const port = runtimeUrl.port || (runtimeUrl.protocol === 'https:' ? '443' : '80');

    this.child = spawn(this.config.executablePath, this.config.args, {
      stdio: 'pipe',
      env: {
        ...process.env,
        HOST: runtimeUrl.hostname,
        PORT: port,
      },
    });

    this.child.stdout.on('data', (chunk) => {
      console.log(`[local-llm] ${chunk.toString().trim()}`);
    });

    this.child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (!message) {
        return;
      }

      if (/^INFO:\s+/i.test(message)) {
        console.log(`[local-llm] ${message}`);
        return;
      }

      this.lastError = message;
      console.warn(`[local-llm] ${message}`);
    });

    this.child.on('exit', (code, signal) => {
      console.log(`[local-llm] exited with code=${code} signal=${signal}`);
      this.child = null;
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
  }

  async healthcheck(): Promise<boolean> {
    try {
      const response = await fetch(new URL(this.config.healthPath, this.config.baseUrl).toString());
      if (response.ok) {
        this.lastError = undefined;
      }
      return response.ok;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async getStatus(): Promise<LocalInferenceStatus> {
    return {
      enabled: Boolean(this.config.executablePath) || this.config.provider === 'ollama',
      provider: this.config.provider,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      pid: this.child?.pid,
      running: this.child !== null,
      healthy: await this.healthcheck(),
      lastError: this.lastError,
    };
  }
}
