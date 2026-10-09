import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('cuhk', {
  load: (days: number) => ipcRenderer.invoke('cuhk:load', days),
  login: () => ipcRenderer.invoke('cuhk:login'),
  course: (id: string, resource: string) => ipcRenderer.invoke('cuhk:course', id, resource),
  open: (url: string) => ipcRenderer.invoke('cuhk:open', url),
});
