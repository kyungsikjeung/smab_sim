const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');

// SerialPort는 Electron 환경에서만 로드
let SerialPort;
try {
  const sp = require('serialport');
  SerialPort = sp.SerialPort;
} catch (e) {
  console.warn('[RH850 Pilot] serialport 모듈 로드 실패:', e.message);
}

let mainWindow = null;
let activePort = null;
let activeAutomationProcess = null;
let activeAutomationScriptPath = null;
let serialRxSeq = 0;
let serialRxBuffer = '';
let serialRxFlushTimer = null;

const SERIAL_RX_FLUSH_DELAY_MS = 40;

const PYTHON_CANDIDATES = process.platform === 'win32'
  ? [
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ]
  : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];

const getEventTimestamp = () => new Date().toLocaleTimeString('ko-KR', {
  hour12: false,
  fractionalSecondDigits: 3,
});

const clearSerialRxFlushTimer = () => {
  if (serialRxFlushTimer) {
    clearTimeout(serialRxFlushTimer);
    serialRxFlushTimer = null;
  }
};

const emitSerialData = (data) => {
  const rawText = typeof data === 'string' ? data : data.toString('utf8');
  if (rawText.length === 0) return;

  const seq = ++serialRxSeq;
  const safeText = rawText.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Serial][Main][RX] #${seq} len=${rawText.length} data="${safeText}"`);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('serial:data', rawText);
  }
};

const flushSerialRxBuffer = (force = false) => {
  while (true) {
    const match = serialRxBuffer.match(/\r\n|\n|\r/);
    if (!match || typeof match.index !== 'number') break;

    const line = serialRxBuffer.slice(0, match.index);
    serialRxBuffer = serialRxBuffer.slice(match.index + match[0].length);
    emitSerialData(line);
  }

  if (force && serialRxBuffer.length > 0) {
    emitSerialData(serialRxBuffer);
    serialRxBuffer = '';
  }

  if (serialRxBuffer.length === 0) {
    clearSerialRxFlushTimer();
  }
};

const scheduleSerialRxFlush = () => {
  clearSerialRxFlushTimer();
  if (serialRxBuffer.length === 0) return;

  serialRxFlushTimer = setTimeout(() => {
    flushSerialRxBuffer(true);
  }, SERIAL_RX_FLUSH_DELAY_MS);
};

const resetSerialRxState = () => {
  serialRxSeq = 0;
  serialRxBuffer = '';
  clearSerialRxFlushTimer();
};

const handleSerialChunk = (chunk) => {
  const rawText = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  if (rawText.length === 0) return;

  serialRxBuffer += rawText;
  flushSerialRxBuffer(false);
  scheduleSerialRxFlush();
};

const sendAutomationOutput = (payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('automation:output', payload);
  }
};

const streamOutputLines = (stream, chunk, state) => {
  state.buffer += chunk.toString();
  const lines = state.buffer.split(/\r?\n/);
  state.buffer = lines.pop() || '';

  lines
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .forEach((message) => {
      sendAutomationOutput({
        stream,
        message,
        timestamp: getEventTimestamp(),
      });
    });
};

const flushOutputBuffer = (stream, state) => {
  const message = state.buffer.trim();
  if (!message) return;

  sendAutomationOutput({
    stream,
    message,
    timestamp: getEventTimestamp(),
  });
  state.buffer = '';
};

const getAutomationTempDir = () => path.join(app.getPath('temp'), 'rh850-pilot-automation');

const buildAutomationScriptPath = (fileName) => {
  const parsed = path.parse(fileName || 'uploaded_script.py');
  const safeBaseName = (parsed.name || 'uploaded_script').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'uploaded_script';
  return path.join(getAutomationTempDir(), `${safeBaseName}_${Date.now()}.py`);
};

const spawnPythonProcess = (scriptPath) => new Promise((resolve, reject) => {
  const trySpawn = (index) => {
    if (index >= PYTHON_CANDIDATES.length) {
      reject(new Error('Python 실행 파일을 찾을 수 없습니다. Python 설치 또는 PATH 설정을 확인해주세요.'));
      return;
    }

    const candidate = PYTHON_CANDIDATES[index];
    const child = spawn(candidate.command, [...candidate.args, scriptPath], {
      cwd: path.dirname(scriptPath),
      windowsHide: true,
      env: process.env,
    });

    let settled = false;

    child.once('spawn', () => {
      settled = true;
      resolve({
        child,
        pythonCommand: [candidate.command, ...candidate.args].join(' '),
      });
    });

    child.once('error', (error) => {
      if (settled) return;
      if (error && error.code === 'ENOENT') {
        trySpawn(index + 1);
        return;
      }
      reject(error);
    });
  };

  trySpawn(0);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'RH850 Pilot',
    backgroundColor: '#0a0f1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const startUrl =
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(__dirname, '..', 'build', 'index.html'),
      protocol: 'file:',
      slashes: true,
    });

  mainWindow.loadURL(startUrl);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });

// ─── IPC: Serial Port API ───────────────────────────────────────────

// 사용 가능한 COM 포트 목록 조회
ipcMain.handle('serial:list-ports', async () => {
  if (!SerialPort) return [];
  try {
    const ports = await SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || 'Unknown',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
    }));
  } catch (err) {
    console.error('[Serial] 포트 목록 조회 실패:', err);
    return [];
  }
});

// 시리얼 포트 연결
ipcMain.handle('serial:connect', async (_event, { portPath, baudRate }) => {
  if (activePort && activePort.isOpen) {
    return { success: false, error: '이미 연결된 포트가 있습니다.' };
  }
  try {
    resetSerialRxState();
    activePort = new SerialPort({
      path: portPath,
      baudRate: baudRate || 115200,
      autoOpen: false,
    });
    activePort.on('data', handleSerialChunk);

    activePort.on('error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial:error', err.message);
      }
    });

    activePort.on('close', () => {
      flushSerialRxBuffer(true);
      clearSerialRxFlushTimer();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial:disconnected');
      }
      activePort = null;
    });

    await new Promise((resolve, reject) => {
      activePort.open((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    return { success: true };
  } catch (err) {
    if (activePort && activePort.isOpen) {
      activePort.close(() => {});
    }
    resetSerialRxState();
    activePort = null;
    return { success: false, error: err.message };
  }
});

// 시리얼 포트 연결 해제
ipcMain.handle('serial:disconnect', async () => {
  if (!activePort || !activePort.isOpen) {
    return { success: false, error: '연결된 포트가 없습니다.' };
  }
  return new Promise((resolve) => {
    activePort.close((err) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true });
      activePort = null;
      resetSerialRxState();
    });
  });
});

// 시리얼 데이터 전송
ipcMain.handle('serial:write', async (_event, data) => {
  if (!activePort || !activePort.isOpen) {
    return { success: false, error: '포트가 연결되어 있지 않습니다.' };
  }

  const payload = Buffer.from(`${String(data)}\r\n`, 'utf8');

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      activePort?.removeListener('error', handleWriteError);
      activePort?.removeListener('close', handleWriteClose);
      resolve(result);
    };

    const handleWriteError = (err) => {
      finish({ success: false, error: err?.message || '시리얼 포트 쓰기 실패' });
    };

    const handleWriteClose = () => {
      finish({ success: false, error: '시리얼 포트가 닫혀 전송에 실패했습니다.' });
    };

    activePort.on('error', handleWriteError);
    activePort.on('close', handleWriteClose);

    try {
      activePort.write(payload, (writeError) => {
        if (writeError) {
          finish({ success: false, error: writeError.message });
          return;
        }

        try {
          activePort.drain((drainError) => {
            if (drainError) {
              finish({ success: false, error: drainError.message });
              return;
            }
            finish({ success: true });
          });
        } catch (drainSyncError) {
          finish({ success: false, error: drainSyncError.message });
        }
      });
    } catch (writeSyncError) {
      finish({ success: false, error: writeSyncError.message });
    }
  });
});

// 시리얼 포트 연결 상태 확인
ipcMain.handle('serial:status', async () => {
  return {
    connected: activePort ? activePort.isOpen : false,
    port: activePort ? activePort.path : null,
  };
});

// ─── IPC: Python Automation API ─────────────────────────────────────

ipcMain.handle('automation:start-script', async (_event, payload) => {
  if (activeAutomationProcess) {
    return { success: false, error: '이미 실행 중인 Python 스크립트가 있습니다.' };
  }

  const fileName = payload && typeof payload.fileName === 'string' ? payload.fileName : 'uploaded_script.py';
  const content = payload && typeof payload.content === 'string' ? payload.content : '';

  if (!content.trim()) {
    return { success: false, error: '실행할 Python 코드가 비어 있습니다.' };
  }

  let scriptPath = null;

  try {
    await fs.promises.mkdir(getAutomationTempDir(), { recursive: true });
    scriptPath = buildAutomationScriptPath(fileName);
    await fs.promises.writeFile(scriptPath, content, 'utf8');

    const { child, pythonCommand } = await spawnPythonProcess(scriptPath);
    activeAutomationProcess = child;
    activeAutomationScriptPath = scriptPath;

    sendAutomationOutput({
      stream: 'status',
      message: `Python 실행 시작: ${path.basename(scriptPath)} (${pythonCommand})`,
      timestamp: getEventTimestamp(),
    });

    const stdoutState = { buffer: '' };
    const stderrState = { buffer: '' };

    child.stdout.on('data', (chunk) => {
      streamOutputLines('stdout', chunk, stdoutState);
    });

    child.stderr.on('data', (chunk) => {
      streamOutputLines('stderr', chunk, stderrState);
    });

    child.on('close', async (code) => {
      flushOutputBuffer('stdout', stdoutState);
      flushOutputBuffer('stderr', stderrState);

      sendAutomationOutput({
        stream: 'status',
        message: `Python 실행 종료 (exit code: ${code ?? 'null'})`,
        timestamp: getEventTimestamp(),
        exitCode: code,
      });

      activeAutomationProcess = null;

      if (activeAutomationScriptPath) {
        try {
          await fs.promises.unlink(activeAutomationScriptPath);
        } catch (error) {
          console.warn('[Automation] 임시 스크립트 삭제 실패:', error.message);
        }
      }

      activeAutomationScriptPath = null;
    });

    child.on('error', (error) => {
      sendAutomationOutput({
        stream: 'stderr',
        message: `Python 실행 오류: ${error.message}`,
        timestamp: getEventTimestamp(),
      });
    });

    return {
      success: true,
      pythonCommand,
      scriptPath,
    };
  } catch (error) {
    if (scriptPath) {
      try {
        await fs.promises.unlink(scriptPath);
      } catch (unlinkError) {
        console.warn('[Automation] 실패한 임시 스크립트 삭제 실패:', unlinkError.message);
      }
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle('automation:stop-script', async () => {
  if (!activeAutomationProcess) {
    return { success: false, error: '실행 중인 Python 스크립트가 없습니다.' };
  }

  try {
    sendAutomationOutput({
      stream: 'status',
      message: 'Python 스크립트 중지 요청',
      timestamp: getEventTimestamp(),
    });
    activeAutomationProcess.kill();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
