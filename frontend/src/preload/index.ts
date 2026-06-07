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
  chat: {
    send: (message: string) => ipcRenderer.invoke('chat:send', { message }),
  },

  // Platform info
  platform: process.platform,

  // Event listeners from main process
  onNotification: (callback: (data: unknown) => void) => {
    ipcRenderer.on('notification:new', (_event, data) => callback(data));
  },
});
