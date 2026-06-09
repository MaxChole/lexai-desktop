import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import Store from 'electron-store';
import path from 'path';
import type { OpenDialogOptions } from 'electron';
import {
  LocalInferenceSidecar,
  loadLocalInferenceConfig,
} from './local-inference-sidecar.js';
import { LocalChatStore } from './local-chat-store.js';
import { LocalDocumentStore } from './local-document-store.js';
import { LocalModelManager } from './local-model-manager.js';
import { LocalSkillEngine } from './local-skill-engine.js';
import { SecureTokenStore } from './secure-token-store.js';

function loadDesktopEnv(): void {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ];

  for (const envPath of envCandidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const raw = fs.readFileSync(envPath, 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
    return;
  }
}

loadDesktopEnv();
const isDevelopment = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let updateStatus: {
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  version?: string;
  error?: string;
} = {
  checking: false,
  available: false,
  downloaded: false,
};
const localInferenceSidecar = new LocalInferenceSidecar(loadLocalInferenceConfig());
const localProfilesDir = path.join(app.getPath('userData'), 'practice-profiles');
const localDocumentsDir = path.join(app.getPath('userData'), 'local-documents');
const localModelsDir = path.join(app.getPath('userData'), 'local-models');
const localDbPath = path.join(app.getPath('userData'), 'local.db');
const localChatStore = new LocalChatStore(localDbPath);
const localDocumentStore = new LocalDocumentStore(localDocumentsDir);
const localModelManager = new LocalModelManager(localModelsDir, process.env.LOCAL_LLM_MODEL_URL);
const localSkillEngine = new LocalSkillEngine(localProfilesDir);
const secureTokenStore = new SecureTokenStore();
const settingsStore = new Store<{ runtimeMode: 'cloud' | 'local' }>({
  defaults: {
    runtimeMode: 'cloud',
  },
});
const caseCacheStore = new Store<{
  caseList: CaseSummary[];
  caseDetails: Record<string, CaseDetailResponse>;
}>({
  name: 'case-cache',
  defaults: {
    caseList: [],
    caseDetails: {},
  },
});
const notificationStore = new Store<{ shownNotificationIds: string[] }>({
  name: 'notification-cache',
  defaults: {
    shownNotificationIds: [],
  },
});

interface ChatRequestPayload {
  message: string;
  skillId?: string;
  conversationId?: string;
  caseId?: string;
  sessionId?: string;
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS';
}

interface ChatResponsePayload {
  content: string;
  model: string;
  provider: string;
  conversationId?: string;
  sessionId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

interface AuthSessionPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number | null;
}

interface UsageCurrentResponse {
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

interface CurrentUserResponse {
  user: {
    id: string;
    email: string;
    plan: 'starter' | 'professional' | 'enterprise';
    role: 'member' | 'admin';
  };
}

interface CaseSummary {
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

interface CloudDocumentRecord {
  id: string;
  caseId: string;
  filename: string;
  s3Key: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

interface CloudSessionRecord {
  id: string;
  caseId?: string;
  skillId?: string;
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS';
  model: string;
  title?: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: string }>;
  createdAt: string;
  updatedAt: string;
}

interface CaseDetailResponse {
  case: CaseSummary;
  documents: CloudDocumentRecord[];
  sessions: CloudSessionRecord[];
}

interface AgentUserConfigState {
  enabled: boolean;
  cronExpr: string | null;
  lastRunAt?: string;
  lastStatus?: 'idle' | 'running' | 'success' | 'error';
}

interface ManagedAgentRecord {
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

interface NotificationRecord {
  id: string;
  userId: string;
  agentId?: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

function getApiBaseUrl(): string {
  return process.env.VITE_API_BASE_URL || 'http://localhost:3001/v1';
}

function getAuthHeaders(): Record<string, string> {
  const session = secureTokenStore.getSession();
  if (!session.accessToken) {
    throw new Error('AUTH_REQUIRED');
  }

  return {
    Authorization: `Bearer ${session.accessToken}`,
  };
}

async function fetchAuthedJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers || {}),
    },
  });

  if (response.status === 401) {
    throw new Error('AUTH_REQUIRED');
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  return await response.json() as T;
}

async function syncDesktopNotifications(): Promise<void> {
  try {
    const payload = await fetchAuthedJson<{ notifications: NotificationRecord[] }>(`${getApiBaseUrl()}/notifications`, {
      method: 'GET',
    });
    const shownIds = new Set(notificationStore.get('shownNotificationIds'));
    for (const item of payload.notifications) {
      if (item.read || shownIds.has(item.id)) continue;
      if (Notification.isSupported()) {
        new Notification({
          title: item.title,
          body: item.body,
        }).show();
      }
      mainWindow?.webContents.send('notification:new', item);
      shownIds.add(item.id);
    }
    notificationStore.set('shownNotificationIds', Array.from(shownIds).slice(-200));
  } catch {
    // no-op when user is not logged in or backend unavailable
  }
}

function broadcastUpdateStatus() {
  mainWindow?.webContents.send('app-update:status', updateStatus);
}

function initAutoUpdater() {
  if (isDevelopment) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    updateStatus = { checking: true, available: false, downloaded: false };
    broadcastUpdateStatus();
  });

  autoUpdater.on('update-available', (info) => {
    updateStatus = {
      checking: false,
      available: true,
      downloaded: false,
      version: info.version,
    };
    broadcastUpdateStatus();
    if (Notification.isSupported()) {
      new Notification({
        title: 'LexAI 更新可用',
        body: `正在下载 ${info.version}`,
      }).show();
    }
  });

  autoUpdater.on('update-not-available', () => {
    updateStatus = { checking: false, available: false, downloaded: false };
    broadcastUpdateStatus();
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = {
      checking: false,
      available: true,
      downloaded: true,
      version: info.version,
    };
    broadcastUpdateStatus();
    if (Notification.isSupported()) {
      new Notification({
        title: 'LexAI 更新已下载',
        body: '退出应用后将自动安装更新。',
      }).show();
    }
  });

  autoUpdater.on('error', (error) => {
    updateStatus = {
      checking: false,
      available: false,
      downloaded: false,
      error: error.message,
    };
    broadcastUpdateStatus();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'LexAI Desktop',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from the Vite dev server.
  if (isDevelopment) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load built files
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers — forward renderer calls to backend API
ipcMain.handle('api:health', async () => {
  const baseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/health`);
    return await res.json();
  } catch (err) {
    return { status: 'error', message: String(err) };
  }
});

ipcMain.handle('app-update:get-status', async () => updateStatus);

ipcMain.handle('app-update:check', async () => {
  if (isDevelopment) {
    return {
      ...updateStatus,
      error: 'Auto update is disabled in development',
    };
  }
  await autoUpdater.checkForUpdates();
  return updateStatus;
});

ipcMain.handle('local-inference:status', async () => {
  return localInferenceSidecar.getStatus();
});

ipcMain.handle('local-model:get-status', async () => {
  return localModelManager.getStatus();
});

ipcMain.handle('local-model:list', async () => {
  return localModelManager.listModels();
});

ipcMain.handle('local-model:start-download', async () => {
  return localModelManager.startDownload();
});

ipcMain.handle('local-model:pause-download', async () => {
  return localModelManager.pauseDownload();
});

ipcMain.handle('local-model:delete', async () => {
  return localModelManager.deleteModel();
});

ipcMain.handle('local-model:open-link', async (_event, url: string) => {
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('runtime-mode:get', async () => {
  return settingsStore.get('runtimeMode');
});

ipcMain.handle('runtime-mode:set', async (_event, mode: 'cloud' | 'local') => {
  settingsStore.set('runtimeMode', mode);
  return settingsStore.get('runtimeMode');
});

ipcMain.handle('auth-session:get', async () => {
  return secureTokenStore.getSession();
});

ipcMain.handle('auth-session:set', async (_event, payload: AuthSessionPayload) => {
  return secureTokenStore.setSession(payload);
});

ipcMain.handle('auth-session:clear', async () => {
  return secureTokenStore.clearSession();
});

ipcMain.handle('auth:get-current-user', async (): Promise<CurrentUserResponse['user'] | null> => {
  try {
    const payload = await fetchAuthedJson<CurrentUserResponse>(`${getApiBaseUrl()}/auth/me`, {
      method: 'GET',
    });
    return payload.user;
  } catch (error) {
    if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
      return null;
    }
    throw error;
  }
});

ipcMain.handle('usage:get-current', async (): Promise<UsageCurrentResponse | null> => {
  try {
    return await fetchAuthedJson<UsageCurrentResponse>(`${getApiBaseUrl()}/usage/current`, {
      method: 'GET',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
      return null;
    }
    throw error;
  }
});

ipcMain.handle('agents:list', async (_event, jurisdiction?: string): Promise<ManagedAgentRecord[]> => {
  const suffix = jurisdiction ? `?jurisdiction=${encodeURIComponent(jurisdiction)}` : '';
  const payload = await fetchAuthedJson<{ agents: ManagedAgentRecord[] }>(`${getApiBaseUrl()}/agents${suffix}`, {
    method: 'GET',
  });
  return payload.agents;
});

ipcMain.handle('agents:update-config', async (_event, payload: {
  agentId: string;
  enabled: boolean;
  cronExpr?: string | null;
}) => {
  return await fetchAuthedJson<{ userConfig: AgentUserConfigState }>(`${getApiBaseUrl()}/agents/${payload.agentId}/config`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
});

ipcMain.handle('agents:run', async (_event, agentId: string) => {
  return await fetchAuthedJson<{
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
  }>(`${getApiBaseUrl()}/agents/${agentId}/run`, {
    method: 'POST',
  });
});

ipcMain.handle('notifications:list', async () => {
  const payload = await fetchAuthedJson<{ notifications: NotificationRecord[] }>(`${getApiBaseUrl()}/notifications`, {
    method: 'GET',
  });
  return payload.notifications;
});

ipcMain.handle('notifications:mark-read', async (_event, id: string) => {
  return await fetchAuthedJson<{ ok: true }>(`${getApiBaseUrl()}/notifications/${id}/read`, {
    method: 'PATCH',
  });
});

ipcMain.handle('notifications:mark-all-read', async () => {
  return await fetchAuthedJson<{ ok: true }>(`${getApiBaseUrl()}/notifications/read-all`, {
    method: 'PATCH',
  });
});

ipcMain.handle('cases:list', async (_event, filters: { q?: string; jurisdiction?: string } = {}) => {
  try {
    const searchParams = new URLSearchParams();
    if (filters.q?.trim()) searchParams.set('q', filters.q.trim());
    if (filters.jurisdiction?.trim()) searchParams.set('jurisdiction', filters.jurisdiction.trim());
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
    const payload = await fetchAuthedJson<{ cases: CaseSummary[] }>(`${getApiBaseUrl()}/cases${suffix}`, {
      method: 'GET',
    });
    caseCacheStore.set('caseList', payload.cases);
    return payload.cases;
  } catch (error) {
    if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
      return caseCacheStore.get('caseList');
    }
    throw error;
  }
});

ipcMain.handle('cases:create', async (_event, payload: {
  title: string;
  description?: string;
  tags?: string[];
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
}) => {
  const result = await fetchAuthedJson<{ case: CaseSummary }>(`${getApiBaseUrl()}/cases`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  caseCacheStore.set('caseList', [result.case, ...caseCacheStore.get('caseList').filter((item) => item.id !== result.case.id)]);
  return result.case;
});

ipcMain.handle('cases:update', async (_event, payload: {
  caseId: string;
  title?: string;
  description?: string;
  tags?: string[];
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
}) => {
  const result = await fetchAuthedJson<{ case: CaseSummary }>(`${getApiBaseUrl()}/cases/${payload.caseId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  caseCacheStore.set('caseList', caseCacheStore.get('caseList').map((item) => item.id === result.case.id ? result.case : item));
  return result.case;
});

ipcMain.handle('cases:get', async (_event, payload: {
  caseId: string;
  q?: string;
  skillId?: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  try {
    const searchParams = new URLSearchParams();
    if (payload.q?.trim()) searchParams.set('q', payload.q.trim());
    if (payload.skillId?.trim()) searchParams.set('skillId', payload.skillId.trim());
    if (payload.dateFrom?.trim()) searchParams.set('dateFrom', payload.dateFrom.trim());
    if (payload.dateTo?.trim()) searchParams.set('dateTo', payload.dateTo.trim());
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
    const detail = await fetchAuthedJson<CaseDetailResponse>(`${getApiBaseUrl()}/cases/${payload.caseId}${suffix}`, {
      method: 'GET',
    });
    caseCacheStore.set('caseDetails', {
      ...caseCacheStore.get('caseDetails'),
      [payload.caseId]: detail,
    });
    return detail;
  } catch (error) {
    if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
      return caseCacheStore.get('caseDetails')[payload.caseId] ?? null;
    }
    throw error;
  }
});

ipcMain.handle('cases:delete', async (_event, caseId: string) => {
  await fetchAuthedJson<{ ok: true }>(`${getApiBaseUrl()}/cases/${caseId}`, {
    method: 'DELETE',
  });
  caseCacheStore.set('caseList', caseCacheStore.get('caseList').filter((item) => item.id !== caseId));
  const nextDetails = { ...caseCacheStore.get('caseDetails') };
  delete nextDetails[caseId];
  caseCacheStore.set('caseDetails', nextDetails);
  return { ok: true };
});

ipcMain.handle('documents:create-upload', async (_event, payload: {
  caseId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) => {
  return await fetchAuthedJson<{ uploadUrl: string; documentId: string; s3Key: string; expiresIn: number }>(
    `${getApiBaseUrl()}/cases/${payload.caseId}/documents/upload-url`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
});

ipcMain.handle('documents:register', async (_event, payload: {
  caseId: string;
  documentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
}) => {
  const result = await fetchAuthedJson<{ document: CloudDocumentRecord }>(
    `${getApiBaseUrl()}/cases/${payload.caseId}/documents`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return result.document;
});

ipcMain.handle('documents:delete', async (_event, payload: { caseId: string; documentId: string }) => {
  return await fetchAuthedJson<{ ok: true }>(
    `${getApiBaseUrl()}/cases/${payload.caseId}/documents/${payload.documentId}`,
    {
      method: 'DELETE',
    },
  );
});

ipcMain.handle('practice-profile:get', async (_event, plugin: string) => {
  return localSkillEngine.readLocalPracticeProfile(plugin);
});

ipcMain.handle('practice-profile:set', async (_event, payload: { plugin: string; content: string }) => {
  await localSkillEngine.saveLocalPracticeProfile(payload.plugin, payload.content);
  return { ok: true };
});

ipcMain.handle('local-chat:list', async () => {
  return await localChatStore.listConversations();
});

ipcMain.handle('local-chat:get', async (_event, conversationId: string) => {
  return await localChatStore.getConversation(conversationId);
});

ipcMain.handle('local-chat:delete', async (_event, conversationId: string) => {
  await localDocumentStore.deleteConversationFiles(conversationId);
  await localChatStore.deleteConversation(conversationId);
  return { ok: true };
});

ipcMain.handle('local-document:pick', async (_event, payload: { conversationId?: string; skillId?: string }) => {
  const dialogOptions: OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Legal Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const conversation = payload.conversationId
    ? await localChatStore.getConversation(payload.conversationId)
    : null;
  const ensuredConversation = conversation ?? await localChatStore.createConversation(payload.skillId);
  const fileStats = await Promise.all(result.filePaths.map(async (filePath) => {
    const stat = await fs.promises.stat(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
    };
  }));
  const storedDocuments = await localDocumentStore.saveFiles(ensuredConversation.id, fileStats);
  const updatedConversation = await localChatStore.addAttachments({
    conversationId: ensuredConversation.id,
    skillId: payload.skillId,
    attachments: storedDocuments,
  });

  return updatedConversation;
});

ipcMain.handle('local-document:import-files', async (_event, payload: {
  conversationId?: string;
  skillId?: string;
  files: Array<{ path: string; name: string; size: number }>;
}) => {
  if (!payload.files.length) {
    return null;
  }

  const conversation = payload.conversationId
    ? await localChatStore.getConversation(payload.conversationId)
    : null;
  const ensuredConversation = conversation ?? await localChatStore.createConversation(payload.skillId);
  const storedDocuments = await localDocumentStore.saveFiles(ensuredConversation.id, payload.files);
  const updatedConversation = await localChatStore.addAttachments({
    conversationId: ensuredConversation.id,
    skillId: payload.skillId,
    attachments: storedDocuments,
  });

  return updatedConversation;
});

ipcMain.handle('local-document:open', async (_event, filePath: string) => {
  const error = await shell.openPath(filePath);
  return { ok: error.length === 0, error: error || undefined };
});

ipcMain.handle('chat:send', async (_event, payload: ChatRequestPayload): Promise<ChatResponsePayload> => {
  const runtimeMode = settingsStore.get('runtimeMode');

  if (runtimeMode === 'local') {
    const localStatus = await localInferenceSidecar.getStatus();
    if (!localStatus.enabled) {
      throw new Error('Local inference runtime is not configured');
    }

    const skillDefinition = payload.skillId
      ? await localSkillEngine.getSkillDefinition(payload.skillId)
      : null;

    if (skillDefinition?.jurisdiction === 'CROSS' && skillDefinition.cnSkillRef && skillDefinition.usSkillRef) {
      const [cnPrompt, usPrompt] = await Promise.all([
        localSkillEngine.buildSystemPrompt(skillDefinition.cnSkillRef),
        localSkillEngine.buildSystemPrompt(skillDefinition.usSkillRef),
      ]);
      const [cnResponse, usResponse] = await Promise.all([cnPrompt, usPrompt].map(async (systemPrompt) => {
        const response = await fetch(`${localStatus.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: localStatus.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: payload.message },
            ],
            max_tokens: 4096,
            stream: false,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Local inference API error: ${response.status} ${errText}`);
        }

        return await response.json() as {
          choices: Array<{ message: { content: string } }>;
          model?: string;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
      }));

      const mergedContent = await localSkillEngine.buildCrossComparison(
        payload.skillId!,
        payload.message,
        cnResponse.choices[0]?.message?.content || '',
        usResponse.choices[0]?.message?.content || '',
      );

      const chatResponse: ChatResponsePayload = {
        content: mergedContent,
        model: `compare:${localStatus.model}`,
        provider: 'cross-compare',
        usage: {
          inputTokens: (cnResponse.usage?.prompt_tokens || 0) + (usResponse.usage?.prompt_tokens || 0),
          outputTokens: (cnResponse.usage?.completion_tokens || 0) + (usResponse.usage?.completion_tokens || 0),
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      };

      const conversation = await localChatStore.saveExchange({
        conversationId: payload.conversationId,
        skillId: payload.skillId,
        userMessage: {
          role: 'user',
          content: payload.message,
          meta: `skill · ${payload.skillId}`,
        },
        assistantMessage: {
          role: 'assistant',
          content: chatResponse.content,
          meta: `${chatResponse.provider} · ${chatResponse.model}`,
        },
      });

      return {
        ...chatResponse,
        conversationId: conversation.id,
      };
    }

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (payload.skillId) {
      const systemPrompt = await localSkillEngine.buildSystemPrompt(payload.skillId);
      messages.push({ role: 'system', content: systemPrompt });
    }
    const existingConversation = payload.conversationId
      ? await localChatStore.getConversation(payload.conversationId)
      : null;
    const attachmentContext = await localDocumentStore.buildAttachmentContext(existingConversation?.attachments ?? []);
    if (attachmentContext) {
      messages.push({ role: 'system', content: attachmentContext });
    }
    messages.push({ role: 'user', content: payload.message });

    const response = await fetch(`${localStatus.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: localStatus.model,
        messages,
        max_tokens: 4096,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Local inference API error: ${response.status} ${errText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const chatResponse: ChatResponsePayload = {
      content: data.choices[0]?.message?.content || '',
      model: data.model || localStatus.model,
      provider: localStatus.provider === 'ollama' ? 'local-ollama' : 'local-embedded',
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    };

    const conversation = await localChatStore.saveExchange({
      conversationId: payload.conversationId,
      skillId: payload.skillId,
      userMessage: {
        role: 'user',
        content: payload.message,
        meta: payload.skillId ? `skill · ${payload.skillId}` : undefined,
      },
      assistantMessage: {
        role: 'assistant',
        content: chatResponse.content,
        meta: `${chatResponse.provider} · ${chatResponse.model}`,
      },
    });

    return {
      ...chatResponse,
      conversationId: conversation.id,
    };
  }

  const response = await fetch(`${getApiBaseUrl()}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secureTokenStore.getSession().accessToken
        ? { Authorization: `Bearer ${secureTokenStore.getSession().accessToken}` }
        : {}),
    },
    body: JSON.stringify({
      message: payload.message,
      skillId: payload.skillId,
      caseId: payload.caseId,
      sessionId: payload.sessionId,
      jurisdiction: payload.jurisdiction,
      plan: 'starter',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Backend chat error: ${response.status} ${errText}`);
  }

  return await response.json() as ChatResponsePayload;
});

app.whenReady().then(async () => {
  initAutoUpdater();
  await localInferenceSidecar.start();
  createWindow();
  void syncDesktopNotifications();
  if (!isDevelopment) {
    setTimeout(() => {
      void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
        updateStatus = {
          checking: false,
          available: false,
          downloaded: false,
          error: error instanceof Error ? error.message : String(error),
        };
        broadcastUpdateStatus();
      });
    }, 5000);
  }
  setInterval(() => {
    void syncDesktopNotifications();
  }, 15000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await localInferenceSidecar.stop();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
