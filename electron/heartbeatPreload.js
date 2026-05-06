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
  // display 창은 iframe preview와 Electron sub window 양쪽에서 쓰입니다.
  // ready 이벤트를 보내면 부모/메인 프로세스가 현재 heartbeat/overlay 상태를 다시 주입합니다.
  ipcRenderer.send('heartbeat-display:ready');
});
