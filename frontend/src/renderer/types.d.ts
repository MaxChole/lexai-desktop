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

export interface AuthSessionState {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  plan: 'starter' | 'professional' | 'enterprise';
  role: 'member' | 'admin';
}

export interface UsageCurrentState {
  plan: 'starter' | 'professional' | 'enterprise';
  periodStart: string;
  periodEnd: string;
  quota: number;
  used: {
    total: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  usagePercent: number;
  warningThreshold: number;
  hardLimit: number;
}

export interface DesktopChatResponse {
  content: string;
  model: string;
  provider: string;
  conversationId?: string;
  sessionId?: string;
  sources?: Array<{
    title: string;
    url: string;
    snippet: string;
    source: string;
  }>;
  webSearch?: {
    enabled: boolean;
    provider?: string;
    sourceCount: number;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface CloudCaseSummary {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
  sessionCount?: number;
}

export interface CloudDocumentRecord {
  id: string;
  caseId: string;
  filename: string;
  s3Key: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

export interface CloudSessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface CloudSessionRecord {
  id: string;
  caseId?: string;
  skillId?: string;
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS';
  model: string;
  title?: string;
  messages: CloudSessionMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentUserConfigState {
  enabled: boolean;
  cronExpr: string | null;
  lastRunAt?: string;
  lastStatus?: 'idle' | 'running' | 'success' | 'error';
}

export interface ManagedAgentRecord {
  id: string;
  name: string;
  plugin: string;
  jurisdiction: string;
  description: string;
  model: string;
  tools: string[];
  defaultCron: string;
  userConfig: AgentUserConfigState;
  type: 'agent';
}

export interface NotificationState {
  id: string;
  userId: string;
  agentId?: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface CloudCaseDetail {
  case: CloudCaseSummary;
  documents: CloudDocumentRecord[];
  sessions: CloudSessionRecord[];
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
    list: () => Promise<ManagedLocalModelStatus[]>;
    startDownload: () => Promise<ManagedLocalModelStatus>;
    pauseDownload: () => Promise<ManagedLocalModelStatus>;
    delete: () => Promise<ManagedLocalModelStatus>;
    openLink: (url: string) => Promise<{ ok: true }>;
  };
  authSession: {
    get: () => Promise<AuthSessionState>;
    set: (payload: AuthSessionState & { accessToken: string }) => Promise<AuthSessionState>;
    clear: () => Promise<{ ok: true }>;
  };
  auth: {
    getCurrentUser: () => Promise<AuthenticatedUser | null>;
  };
  usage: {
    getCurrent: () => Promise<UsageCurrentState | null>;
  };
  cases: {
    list: (filters?: { q?: string; jurisdiction?: string }) => Promise<CloudCaseSummary[]>;
    create: (payload: { title: string; description?: string; tags?: string[]; jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL' }) => Promise<CloudCaseSummary>;
    update: (payload: { caseId: string; title?: string; description?: string; tags?: string[]; jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL' }) => Promise<CloudCaseSummary>;
    get: (payload: { caseId: string; q?: string; skillId?: string; dateFrom?: string; dateTo?: string }) => Promise<CloudCaseDetail | null>;
    delete: (caseId: string) => Promise<{ ok: true }>;
  };
  documents: {
    createUpload: (payload: { caseId: string; filename: string; mimeType: string; sizeBytes: number }) => Promise<{ uploadUrl: string; documentId: string; s3Key: string; expiresIn: number }>;
    register: (payload: { caseId: string; documentId: string; filename: string; mimeType: string; sizeBytes: number; s3Key: string }) => Promise<CloudDocumentRecord>;
    delete: (payload: { caseId: string; documentId: string }) => Promise<{ ok: true }>;
  };
  agents: {
    list: (jurisdiction?: string) => Promise<ManagedAgentRecord[]>;
    updateConfig: (payload: { agentId: string; enabled: boolean; cronExpr?: string | null }) => Promise<{ userConfig: AgentUserConfigState }>;
    run: (agentId: string) => Promise<{
      run: {
        runId: string;
        status: string;
        finalOutput: string;
        error?: string;
        totalUsage: {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheCreationTokens: number;
        };
        finishedAt?: string;
      };
    }>;
  };
  notifications: {
    list: () => Promise<NotificationState[]>;
    markRead: (id: string) => Promise<{ ok: true }>;
    markAllRead: () => Promise<{ ok: true }>;
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
    importFiles: (conversationId: string | undefined, skillId: string | undefined, files: Array<{ path: string; name: string; size: number }>) => Promise<LocalConversationRecord | null>;
    open: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  };
  chat: {
    send: (
      message: string,
      skillId?: string,
      conversationId?: string,
      caseId?: string,
      sessionId?: string,
      jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS',
      webSearchEnabled?: boolean,
    ) => Promise<DesktopChatResponse>;
  };
  platform: string;
  onNotification: (callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    lexai: LexaiBridge;
  }
}
