const { contextBridge, ipcRenderer } = require('electron');

/**
 * RH850 Pilot - Preload Script
 * contextBridge를 통해 Renderer 프로세스에 안전한 IPC API를 노출합니다.
 * 모든 시리얼 통신은 이 bridge를 통해 이루어집니다.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Serial Port API ──
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:list-ports'),
    connect: (config) => ipcRenderer.invoke('serial:connect', config),
    disconnect: () => ipcRenderer.invoke('serial:disconnect'),
    write: (data) => ipcRenderer.invoke('serial:write', data),
    status: () => ipcRenderer.invoke('serial:status'),

    // 이벤트 리스너
    onData: (callback) => {
      let seq = 0;
      const handler = (_event, data) => {
        const currentSeq = ++seq;
        const safeText = String(data).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Serial][Preload][RX] #${currentSeq} data="${safeText}"`);
        }
        callback(data);
      };
      ipcRenderer.on('serial:data', handler);
      return () => ipcRenderer.removeListener('serial:data', handler);
    },
    onError: (callback) => {
      const handler = (_event, error) => callback(error);
      ipcRenderer.on('serial:error', handler);
      return () => ipcRenderer.removeListener('serial:error', handler);
    },
    onDisconnected: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('serial:disconnected', handler);
      return () => ipcRenderer.removeListener('serial:disconnected', handler);
    },
  },

  // ── Python Automation API ──
  automation: {
    startScript: (payload) => ipcRenderer.invoke('automation:start-script', payload),
    stopScript: () => ipcRenderer.invoke('automation:stop-script'),
    onOutput: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('automation:output', handler);
      return () => ipcRenderer.removeListener('automation:output', handler);
    },
  },
});
