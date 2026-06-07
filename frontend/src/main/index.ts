import { app, BrowserWindow, ipcMain } from 'electron';
import Store from 'electron-store';
import path from 'path';
import {
  LocalInferenceSidecar,
  loadLocalInferenceConfig,
} from './local-inference-sidecar.js';
import { LocalSkillEngine } from './local-skill-engine.js';

let mainWindow: BrowserWindow | null = null;
const localInferenceSidecar = new LocalInferenceSidecar(loadLocalInferenceConfig());
const localSkillEngine = new LocalSkillEngine();
const settingsStore = new Store<{ runtimeMode: 'cloud' | 'local' }>({
  defaults: {
    runtimeMode: 'cloud',
  },
});

interface ChatRequestPayload {
  message: string;
  skillId?: string;
}

interface ChatResponsePayload {
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

ipcMain.handle('runtime-mode:get', async () => {
  return settingsStore.get('runtimeMode');
});

ipcMain.handle('runtime-mode:set', async (_event, mode: 'cloud' | 'local') => {
  settingsStore.set('runtimeMode', mode);
  return settingsStore.get('runtimeMode');
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

    return {
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
