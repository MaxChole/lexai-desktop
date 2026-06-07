import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lexai', {
  // API proxy — renderer calls main process which forwards to backend
  api: {
    health: () => ipcRenderer.invoke('api:health'),
  },
  localInference: {
    status: () => ipcRenderer.invoke('local-inference:status'),
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
    open: (filePath: string) => ipcRenderer.invoke('local-document:open', filePath),
  },
  chat: {
    send: (message: string, skillId?: string, conversationId?: string) => ipcRenderer.invoke('chat:send', { message, skillId, conversationId }),
  },

  // Platform info
  platform: process.platform,

  // Event listeners from main process
  onNotification: (callback: (data: unknown) => void) => {
    ipcRenderer.on('notification:new', (_event, data) => callback(data));
  },
});
