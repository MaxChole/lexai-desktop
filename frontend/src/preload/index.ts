import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lexai', {
  // API proxy — renderer calls main process which forwards to backend
  api: {
    health: () => ipcRenderer.invoke('api:health'),
  },

  // Platform info
  platform: process.platform,

  // Event listeners from main process
  onNotification: (callback: (data: unknown) => void) => {
    ipcRenderer.on('notification:new', (_event, data) => callback(data));
  },
});