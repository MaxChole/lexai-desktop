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
import { FreeWebSearch, type WebSearchSource } from './free-web-search.js';

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
const freeWebSearch = new FreeWebSearch(process.env.FREE_SEARCH_BASE_URL);
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
  webSearchEnabled?: boolean;
}

interface ChatResponsePayload {
  content: string;
  model: string;
  provider: string;
  conversationId?: string;
  sessionId?: string;
  sources?: WebSearchSource[];
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

function normalizeSearchJurisdiction(
  jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL',
): 'CN' | 'US' | 'INT' | 'CROSS' {
  if (!jurisdiction || jurisdiction === 'ALL') {
    return 'CN';
  }
  return jurisdiction;
}

function buildSourcesMarkdown(sources: WebSearchSource[]): string {
  if (!sources.length) {
    return '';
  }

  const authorityLabel: Record<WebSearchSource['authority'], string> = {
    official: '官方来源',
    reference: '参考资料',
    secondary: '二级来源',
  };

  const lines = sources.map((source, index) =>
    `[来源${index + 1}] [${source.title}](${source.url})\n类型：${authorityLabel[source.authority]} · 抓取：${source.source}\n摘要：${source.snippet || '无摘要'}`,
  );

  return `\n\n## 参考来源\n\n${lines.join('\n\n')}`;
}

function buildWebSearchInstruction(sources: WebSearchSource[]): string {
  if (!sources.length) {
    return '';
  }

  return [
    '请直接回答，不要重复用户原问题，也不要写“根据公开资料”这类空泛开场。',
    '优先依据已提供的证据卡片作答，涉及法律结论时优先引用官方来源，不要只复述二级资料。',
    '如果检索结果主要是法条正文，请写成“可从现有条文归纳的核心规则/要求”，不要凭空发明原则名称。',
    '正文建议结构：先写一句简短结论，再用 2-4 个要点展开；每个要点都应包含“规则/要求 + 简短解释 + 句末引用”。',
    '对有明确依据的结论，请在句末用 [来源1]、[来源2] 这类格式标注引用；如果资料不足以支持确定结论，请明确写出 [需验证]。',
  ].join('\n');
}

function buildCitationTag(sources: WebSearchSource[]): string {
  const preferredIndexes = sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.authority === 'official')
    .slice(0, 2)
    .map(({ index }) => index + 1);

  const fallbackIndexes = (preferredIndexes.length > 0
    ? preferredIndexes
    : sources.slice(0, 2).map((_, index) => index + 1));

  return fallbackIndexes.map((index) => `[来源${index}]`).join('');
}

function isSourceOnlyLine(line: string, sources: WebSearchSource[]): boolean {
  const normalizedLine = line
    .replace(/^[-*]\s*/, '')
    .replace(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedLine) {
    return false;
  }

  return sources.some((source) => {
    const normalizedTitle = source.title.replace(/\s+/g, ' ').trim();
    return normalizedLine === normalizedTitle || normalizedLine.includes(normalizedTitle);
  });
}

function stripQuestionEcho(content: string, userMessage?: string): string {
  const trimmed = content.trim();
  if (!trimmed || !userMessage) {
    return trimmed;
  }

  const normalizedQuestion = userMessage.replace(/\s+/g, '').trim();
  if (!normalizedQuestion) {
    return trimmed;
  }

  const lines = trimmed.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return trimmed;
  }

  const firstLine = lines[0].trim();
  const compactFirstLine = firstLine.replace(/\s+/g, '');
  const normalizedQuestionPrefix = normalizedQuestion.slice(0, 18);

  if (
    compactFirstLine === normalizedQuestion
    || compactFirstLine.startsWith(normalizedQuestion)
    || compactFirstLine.includes(normalizedQuestionPrefix)
  ) {
    lines.shift();
    return lines.join('\n').trim();
  }

  return trimmed;
}

function rewriteGroundedLead(content: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, items) => !(line.trim() === '' && items[index - 1]?.trim() === ''));

  if (lines.length === 0) {
    return '';
  }

  const firstLine = lines[0].trim();
  if (/^《.+》的.+如下[:：]?\s*\[来源\d+\]/u.test(firstLine)) {
    lines[0] = firstLine
      .replace(/^《(.+)》的/u, '结合《$1》，可归纳出')
      .replace(/如下[:：]?/u, '以下核心规则：');
  }

  return lines.join('\n').trim();
}

function normalizeGroundedAnswer(
  content: string,
  sources: WebSearchSource[],
  userMessage?: string,
): string {
  if (!content.trim() || sources.length === 0) {
    return content.trim();
  }

  const citationTag = buildCitationTag(sources);
  const sourceLookup = new Map(
    sources.map((source, index) => [source.url.replace(/^https?:\/\//, ''), `[来源${index + 1}]`]),
  );
  const titleLookup = new Map(
    sources.map((source, index) => [source.title, `[来源${index + 1}]`]),
  );

  let normalizedContent = stripQuestionEcho(content, userMessage)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_match, title, url) => {
    const normalizedUrl = String(url).replace(/^https?:\/\//, '');
    return sourceLookup.get(normalizedUrl) || titleLookup.get(String(title)) || String(title);
  });

  normalizedContent = normalizedContent
    .replace(/[（(]参考来源同上[）)]/g, ` ${citationTag}`)
    .replace(/[（(]参考来源[:：]\s*/g, ' ')
    .replace(/参考来源同上/g, citationTag);

  const cleanedLines: string[] = [];
  let skippingSourceLines = false;

  for (const rawLine of normalizedContent.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      cleanedLines.push('');
      skippingSourceLines = false;
      continue;
    }

    if (/^来源[:：]\s*$/.test(trimmed)) {
      skippingSourceLines = true;
      continue;
    }

    if (skippingSourceLines && isSourceOnlyLine(trimmed, sources)) {
      continue;
    }

    if (skippingSourceLines) {
      skippingSourceLines = false;
    }

    cleanedLines.push(line);
  }

  const normalizedBlocks = cleanedLines
    .join('\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/\[来源\d+\]/.test(block) || /\[需验证\]/.test(block)) {
        return block;
      }

      if (!/[\p{Script=Han}A-Za-z]/u.test(block)) {
        return block;
      }

      if (block.length < 18) {
        return block;
      }

      if (/^(参考来源|来源)$/u.test(block)) {
        return block;
      }

      if (/[。；！？”"]$/u.test(block)) {
        return `${block} ${citationTag}`;
      }

      return `${block} ${citationTag}`;
    });

  normalizedContent = normalizedBlocks.join('\n\n');
  normalizedContent = rewriteGroundedLead(normalizedContent);

  return normalizedContent;
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
    const searchJurisdiction = normalizeSearchJurisdiction(
      payload.jurisdiction ?? (skillDefinition?.jurisdiction as 'CN' | 'US' | 'INT' | 'CROSS' | undefined),
    );
    const webSearchResult = payload.webSearchEnabled
      ? await freeWebSearch.search(payload.message, searchJurisdiction)
      : null;
    const webSearchInstruction = buildWebSearchInstruction(webSearchResult?.sources || []);

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
              ...(webSearchResult?.context ? [{ role: 'system', content: webSearchResult.context }] : []),
              ...(webSearchInstruction ? [{ role: 'system', content: webSearchInstruction }] : []),
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
      const groundedBody = webSearchResult?.sources?.length
        ? normalizeGroundedAnswer(mergedContent, webSearchResult.sources, payload.message)
        : mergedContent;
      const groundedContent = webSearchResult?.sources?.length
        ? `${groundedBody}${buildSourcesMarkdown(webSearchResult.sources)}`
        : groundedBody;

      const chatResponse: ChatResponsePayload = {
        content: groundedContent,
        model: `compare:${localStatus.model}`,
        provider: 'cross-compare',
        sources: webSearchResult?.sources,
        webSearch: {
          enabled: Boolean(payload.webSearchEnabled),
          provider: webSearchResult?.provider,
          sourceCount: webSearchResult?.sources.length || 0,
        },
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
          meta: `${chatResponse.provider} · ${chatResponse.model}${webSearchResult?.sources.length ? ` · 联网增强 ${webSearchResult.sources.length} 条来源` : ''}`,
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
    if (webSearchResult?.context) {
      messages.push({ role: 'system', content: webSearchResult.context });
    }
    if (webSearchInstruction) {
      messages.push({ role: 'system', content: webSearchInstruction });
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

    const groundedBody = webSearchResult?.sources?.length
      ? normalizeGroundedAnswer(data.choices[0]?.message?.content || '', webSearchResult.sources, payload.message)
      : (data.choices[0]?.message?.content || '');
    const groundedContent = webSearchResult?.sources?.length
      ? `${groundedBody}${buildSourcesMarkdown(webSearchResult.sources)}`
      : groundedBody;

    const chatResponse: ChatResponsePayload = {
      content: groundedContent,
      model: data.model || localStatus.model,
      provider: localStatus.provider === 'ollama' ? 'local-ollama' : 'local-embedded',
      sources: webSearchResult?.sources,
      webSearch: {
        enabled: Boolean(payload.webSearchEnabled),
        provider: webSearchResult?.provider,
        sourceCount: webSearchResult?.sources.length || 0,
      },
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
        meta: `${chatResponse.provider} · ${chatResponse.model}${webSearchResult?.sources.length ? ` · 联网增强 ${webSearchResult.sources.length} 条来源` : ''}`,
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
