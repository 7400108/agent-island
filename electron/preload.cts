const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('island', {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  subscribe: (fn: (value: unknown) => void) => { const listener = (_: unknown, value: unknown) => fn(value); ipcRenderer.on('state', listener); return () => ipcRenderer.removeListener('state', listener); },
  onOpen: (fn: (value: string) => void) => { const listener = (_: unknown, value: string) => fn(value); ipcRenderer.on('open-page', listener); return () => ipcRenderer.removeListener('open-page', listener); },
  onCollapse: (fn: () => void) => { ipcRenderer.on('collapse', fn); return () => ipcRenderer.removeListener('collapse', fn); },
  updateSettings: (value: unknown) => ipcRenderer.invoke('settings', value),
  clearNotifications: () => ipcRenderer.invoke('clear-notifications'),
  dismissTask: (id: string) => ipcRenderer.invoke('dismiss-task', id),
  demo: () => ipcRenderer.invoke('demo'),
  setExpanded: (value: boolean, height?: number, focus = false) => ipcRenderer.send('expanded', value, height, focus),
  setInteractive: (value: boolean) => ipcRenderer.send('interactive', value),
  chooseDirectory: (source: string) => ipcRenderer.invoke('directory', source),
  openExternal: (url: string) => ipcRenderer.invoke('external', url),
  quit: () => ipcRenderer.send('quit')
});
