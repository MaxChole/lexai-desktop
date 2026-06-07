export interface LexaiAPI {
  health: () => Promise<{ status: string; timestamp?: string; message?: string }>;
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

export interface DesktopChatResponse {
  content: string;
  model: string;
  provider: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface LexaiBridge {
  api: LexaiAPI;
  localInference: {
    status: () => Promise<LocalInferenceStatus>;
  };
  runtimeMode: {
    get: () => Promise<'cloud' | 'local'>;
    set: (mode: 'cloud' | 'local') => Promise<'cloud' | 'local'>;
  };
  chat: {
    send: (message: string) => Promise<DesktopChatResponse>;
  };
  platform: string;
  onNotification: (callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    lexai: LexaiBridge;
  }
}
