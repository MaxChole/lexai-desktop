import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lexai', {
  // API proxy — renderer calls main process which forwards to backend
  api: {
    health: () => ipcRenderer.invoke('api:health'),
  },
  localInference: {
    status: () => ipcRenderer.invoke('local-inference:status'),
  },
  localModel: {
    getStatus: () => ipcRenderer.invoke('local-model:get-status'),
    list: () => ipcRenderer.invoke('local-model:list'),
    startDownload: () => ipcRenderer.invoke('local-model:start-download'),
    pauseDownload: () => ipcRenderer.invoke('local-model:pause-download'),
    delete: () => ipcRenderer.invoke('local-model:delete'),
    openLink: (url: string) => ipcRenderer.invoke('local-model:open-link', url),
  },
  authSession: {
    get: () => ipcRenderer.invoke('auth-session:get'),
    set: (payload: { accessToken: string; refreshToken?: string; expiresAt?: number | null }) => ipcRenderer.invoke('auth-session:set', payload),
    clear: () => ipcRenderer.invoke('auth-session:clear'),
  },
  auth: {
    getCurrentUser: () => ipcRenderer.invoke('auth:get-current-user'),
  },
  usage: {
    getCurrent: () => ipcRenderer.invoke('usage:get-current'),
  },
  agents: {
    list: (jurisdiction?: string) => ipcRenderer.invoke('agents:list', jurisdiction),
    updateConfig: (payload: { agentId: string; enabled: boolean; cronExpr?: string | null }) => ipcRenderer.invoke('agents:update-config', payload),
    run: (agentId: string) => ipcRenderer.invoke('agents:run', agentId),
  },
  notifications: {
    list: () => ipcRenderer.invoke('notifications:list'),
    markRead: (id: string) => ipcRenderer.invoke('notifications:mark-read', id),
    markAllRead: () => ipcRenderer.invoke('notifications:mark-all-read'),
  },
  cases: {
    list: (filters?: { q?: string; jurisdiction?: string }) => ipcRenderer.invoke('cases:list', filters),
    create: (payload: { title: string; description?: string; tags?: string[]; jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL' }) => ipcRenderer.invoke('cases:create', payload),
    update: (payload: { caseId: string; title?: string; description?: string; tags?: string[]; jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL' }) => ipcRenderer.invoke('cases:update', payload),
    get: (payload: { caseId: string; q?: string; skillId?: string; dateFrom?: string; dateTo?: string }) => ipcRenderer.invoke('cases:get', payload),
    delete: (caseId: string) => ipcRenderer.invoke('cases:delete', caseId),
  },
  documents: {
    createUpload: (payload: { caseId: string; filename: string; mimeType: string; sizeBytes: number }) => ipcRenderer.invoke('documents:create-upload', payload),
    register: (payload: { caseId: string; documentId: string; filename: string; mimeType: string; sizeBytes: number; s3Key: string }) => ipcRenderer.invoke('documents:register', payload),
    delete: (payload: { caseId: string; documentId: string }) => ipcRenderer.invoke('documents:delete', payload),
  },
  runtimeMode: {
    get: () => ipcRenderer.invoke('runtime-mode:get'),
    set: (mode: 'cloud' | 'local') => ipcRenderer.invoke('runtime-mode:set', mode),
  },
  practiceProfile: {
    get: (plugin: string) => ipcRenderer.invoke('practice-profile:get', plugin),
    set: (plugin: string, content: string) => ipcRenderer.invoke('practice-profile:set', { plugin, content }),
  },
  localChat: {
    list: () => ipcRenderer.invoke('local-chat:list'),
    get: (conversationId: string) => ipcRenderer.invoke('local-chat:get', conversationId),
    delete: (conversationId: string) => ipcRenderer.invoke('local-chat:delete', conversationId),
  },
  localDocument: {
    pick: (conversationId?: string, skillId?: string) => ipcRenderer.invoke('local-document:pick', { conversationId, skillId }),
    importFiles: (conversationId: string | undefined, skillId: string | undefined, files: Array<{ path: string; name: string; size: number }>) =>
      ipcRenderer.invoke('local-document:import-files', { conversationId, skillId, files }),
    open: (filePath: string) => ipcRenderer.invoke('local-document:open', filePath),
  },
  chat: {
    send: (message: string, skillId?: string, conversationId?: string, caseId?: string, sessionId?: string, jurisdiction?: 'CN' | 'US' | 'INT' | 'CROSS') =>
      ipcRenderer.invoke('chat:send', { message, skillId, conversationId, caseId, sessionId, jurisdiction }),
  },

  // Platform info
  platform: process.platform,

  // Event listeners from main process
  onNotification: (callback: (data: unknown) => void) => {
    ipcRenderer.on('notification:new', (_event, data) => callback(data));
  },
});
