import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('cuhk', {
  load: (days: number) => ipcRenderer.invoke('cuhk:load', days),
  complete: (key: string, value: boolean | null) => ipcRenderer.invoke('cuhk:complete', key, value),
  login: () => ipcRenderer.invoke('cuhk:login'),
  course: (id: string, resource: string) => ipcRenderer.invoke('cuhk:course', id, resource),
  resource: (id: string) => ipcRenderer.invoke('cuhk:resource', id),
  open: (url: string) => ipcRenderer.invoke('cuhk:open', url),
});
