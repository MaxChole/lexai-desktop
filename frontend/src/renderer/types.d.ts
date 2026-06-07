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

export interface AuthSessionState {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number | null;
}

export interface DesktopChatResponse {
  content: string;
  model: string;
  provider: string;
  conversationId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

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

export interface LocalConversationSummary {
  id: string;
  title: string;
  skillId?: string;
  updatedAt: string;
  messageCount: number;
  attachmentCount: number;
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

export interface LexaiBridge {
  api: LexaiAPI;
  localInference: {
    status: () => Promise<LocalInferenceStatus>;
  };
  localModel: {
    getStatus: () => Promise<ManagedLocalModelStatus>;
    startDownload: () => Promise<ManagedLocalModelStatus>;
    pauseDownload: () => Promise<ManagedLocalModelStatus>;
    delete: () => Promise<ManagedLocalModelStatus>;
  };
  authSession: {
    get: () => Promise<AuthSessionState>;
    set: (payload: AuthSessionState & { accessToken: string }) => Promise<AuthSessionState>;
    clear: () => Promise<{ ok: true }>;
  };
  runtimeMode: {
    get: () => Promise<'cloud' | 'local'>;
    set: (mode: 'cloud' | 'local') => Promise<'cloud' | 'local'>;
  };
  practiceProfile: {
    get: (plugin: string) => Promise<string>;
    set: (plugin: string, content: string) => Promise<{ ok: true }>;
  };
  localChat: {
    list: () => Promise<LocalConversationSummary[]>;
    get: (conversationId: string) => Promise<LocalConversationRecord | null>;
    delete: (conversationId: string) => Promise<{ ok: true }>;
  };
  localDocument: {
    pick: (conversationId?: string, skillId?: string) => Promise<LocalConversationRecord | null>;
    open: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  };
  chat: {
    send: (message: string, skillId?: string, conversationId?: string) => Promise<DesktopChatResponse>;
  };
  platform: string;
  onNotification: (callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    lexai: LexaiBridge;
  }
}
