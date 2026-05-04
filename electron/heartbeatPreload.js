const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('heartbeatDisplay', {
  getState: () => ipcRenderer.invoke('heartbeat-display:get-state'),
  onState: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('heartbeat-display:state', handler);
    return () => ipcRenderer.removeListener('heartbeat-display:state', handler);
  },
});

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('heartbeat-display:ready');
});
