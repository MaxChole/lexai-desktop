import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
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

let mainWindow: BrowserWindow | null = null;
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

interface ChatRequestPayload {
  message: string;
  skillId?: string;
  conversationId?: string;
}

interface ChatResponsePayload {
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

interface AuthSessionPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number | null;
}

function getApiBaseUrl(): string {
  return process.env.VITE_API_BASE_URL || 'http://localhost:3001/v1';
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

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
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

ipcMain.handle('local-inference:status', async () => {
  return localInferenceSidecar.getStatus();
});

ipcMain.handle('local-model:get-status', async () => {
  return localModelManager.getStatus();
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
    },
    body: JSON.stringify({
      message: payload.message,
      skillId: payload.skillId,
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
  await localInferenceSidecar.start();
  createWindow();
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
