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

export interface LexaiBridge {
  api: LexaiAPI;
  localInference: {
    status: () => Promise<LocalInferenceStatus>;
  };
  platform: string;
  onNotification: (callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    lexai: LexaiBridge;
  }
}
