// The only bridge from the page to the main process: checking for and installing updates.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marketKasa', {
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    defer: () => ipcRenderer.invoke('updates:defer'),
    onStatus(callback) {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('updates:status', listener);
      return () => ipcRenderer.removeListener('updates:status', listener);
    },
  },
});
