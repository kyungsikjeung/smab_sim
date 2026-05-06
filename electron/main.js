const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');

// serialport는 네이티브 모듈이라 Electron 빌드/패키징 환경에서만 안전하게 로드합니다.
// 로드 실패 시 앱 UI는 유지하고, 브라우저 개발 환경은 renderer의 Mock 서비스가 담당합니다.
let SerialPort;
try {
  const sp = require('serialport');
  SerialPort = sp.SerialPort;
} catch (e) {
  console.warn('[Tovis SB] serialport 모듈 로드 실패:', e.message);
}

let mainWindow = null;
let heartbeatWindow = null;
let activePort = null;
let activeAutomationProcess = null;
let activeAutomationScriptPath = null;
let serialRxSeq = 0;
let serialRxBuffer = '';
let serialRxFlushTimer = null;

// MCU UART는 한 줄이 여러 chunk로 쪼개져 들어올 수 있습니다.
// 개행이 늦게 도착하는 로그도 화면에 멈춰 보이지 않도록 짧은 idle 후 강제 flush합니다.
const SERIAL_RX_FLUSH_DELAY_MS = 40;
const HEARTBEAT_DISPLAY_URL = '/heartbeat-display.html';
const HEARTBEAT_BACKGROUND_IMAGE = './heartbeat-assets/cluster_bg_1920x720.png';
const HEARTBEAT_DISPLAY_WIDTH = 1920;
const HEARTBEAT_DISPLAY_HEIGHT = 720;
const DEFAULT_HEARTBEAT_OVERLAY_COLOR = '#ff3b30';

const heartbeatDisplayState = {
  heartbeatEnabled: true,
  overlayRect: null,
  overlayRects: [],
};

// Windows 현장 PC는 py launcher만 있거나 python3가 없을 수 있어 후보를 순차 시도합니다.
// 첫 번째로 spawn에 성공한 실행 파일을 그대로 사용자 콘솔에 표시합니다.
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

const padNumber = (value, digits = 2) => String(value).padStart(digits, '0');

const buildFallbackTime = (date) => [
  [
    padNumber(date.getHours()),
    padNumber(date.getMinutes()),
    padNumber(date.getSeconds()),
  ].join(':'),
  padNumber(date.getMilliseconds(), 3),
].join('.');

const getEventTimestamp = () => {
  const now = new Date();

  try {
    return now.toLocaleTimeString('ko-KR', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  } catch (_error) {
    return buildFallbackTime(now);
  }
};

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
  // renderer와 파서가 line-oriented로 동작하므로 main process에서 개행 단위로 정규화합니다.
  // force=true는 포트 close나 idle timeout처럼 더 기다리면 마지막 조각을 잃을 수 있는 경우입니다.
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
  // 업로드 파일명을 그대로 쓰지 않고 안전한 basename과 timestamp를 붙여 동시 실행/경로 주입을 피합니다.
  const parsed = path.parse(fileName || 'uploaded_script.py');
  const safeBaseName = (parsed.name || 'uploaded_script').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'uploaded_script';
  return path.join(getAutomationTempDir(), `${safeBaseName}_${Date.now()}.py`);
};

const spawnPythonProcess = (scriptPath) => new Promise((resolve, reject) => {
  // 후보 실행 파일 중 ENOENT만 다음 후보로 넘깁니다. 실행 자체의 오류는 사용자에게 즉시 돌려줍니다.
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
    title: 'Tovis SMAB',
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

const isHeartbeatWindowOpen = () => Boolean(heartbeatWindow && !heartbeatWindow.isDestroyed());

const cloneOverlayRect = (overlayRect) => {
  if (!overlayRect) return null;

  return { ...overlayRect };
};

const cloneOverlayRects = (overlayRects) => {
  if (!Array.isArray(overlayRects) || overlayRects.length === 0) {
    return [];
  }

  return overlayRects.map((overlayRect) => ({ ...overlayRect }));
};

const normalizeInteger = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed);
};

const normalizeOverlayRect = (payload = {}) => {
  // overlay 좌표는 1920x720 기준 원본 좌표계입니다. 실제 화면 배율 적용은 heartbeat-display.js에서 처리합니다.
  // 크기가 없거나 0이면 전송은 허용하되 표시 대상에서는 제외합니다.
  const width = normalizeInteger(payload.width);
  const height = normalizeInteger(payload.height);

  return {
    color: typeof payload.color === 'string' && payload.color.trim()
      ? payload.color.trim()
      : DEFAULT_HEARTBEAT_OVERLAY_COLOR,
    height: typeof height === 'number' && height > 0 ? height : null,
    id: typeof payload.id === 'number' || typeof payload.id === 'string'
      ? payload.id
      : undefined,
    label: typeof payload.label === 'string' && payload.label.trim()
      ? payload.label.trim()
      : undefined,
    refColor: Number.isFinite(payload.refColor) ? Number(payload.refColor) : null,
    source: typeof payload.source === 'string' && payload.source.trim()
      ? payload.source.trim()
      : undefined,
    visible: Boolean(width && width > 0 && height && height > 0),
    width: typeof width === 'number' && width > 0 ? width : null,
    x: normalizeInteger(payload.x, 0),
    y: normalizeInteger(payload.y, 0),
  };
};

const normalizeOverlayRects = (payloads = []) => {
  if (!Array.isArray(payloads)) {
    return [];
  }

  return payloads
    .map((payload) => normalizeOverlayRect(payload))
    .filter((overlayRect) => overlayRect.visible);
};

const getHeartbeatDisplayUrl = () => {
  if (process.env.ELECTRON_START_URL) {
    return new URL(HEARTBEAT_DISPLAY_URL, process.env.ELECTRON_START_URL).toString();
  }

  return url.format({
    pathname: path.join(__dirname, '..', 'build', 'heartbeat-display.html'),
    protocol: 'file:',
    slashes: true,
  });
};

const buildHeartbeatWindowStatus = (error = null) => ({
  backgroundImage: HEARTBEAT_BACKGROUND_IMAGE,
  displayAvailable: screen.getAllDisplays().length > 0,
  heartbeatEnabled: heartbeatDisplayState.heartbeatEnabled,
  open: isHeartbeatWindowOpen(),
  overlayRect: cloneOverlayRect(heartbeatDisplayState.overlayRect),
  overlayRects: cloneOverlayRects(heartbeatDisplayState.overlayRects),
  url: HEARTBEAT_DISPLAY_URL,
  error,
});

const getScaledDisplaySize = (display) => ({
  width: Math.round(display.bounds.width * (display.scaleFactor || 1)),
  height: Math.round(display.bounds.height * (display.scaleFactor || 1)),
});

const matchesHeartbeatDisplaySize = (display) => {
  const scaledSize = getScaledDisplaySize(display);

  // Windows 배율 설정에 따라 bounds/workArea/size가 서로 다르게 보고될 수 있어 네 기준을 모두 확인합니다.
  return (
    (display.bounds.width === HEARTBEAT_DISPLAY_WIDTH && display.bounds.height === HEARTBEAT_DISPLAY_HEIGHT)
    || (display.workArea.width === HEARTBEAT_DISPLAY_WIDTH && display.workArea.height === HEARTBEAT_DISPLAY_HEIGHT)
    || (display.size?.width === HEARTBEAT_DISPLAY_WIDTH && display.size?.height === HEARTBEAT_DISPLAY_HEIGHT)
    || (scaledSize.width === HEARTBEAT_DISPLAY_WIDTH && scaledSize.height === HEARTBEAT_DISPLAY_HEIGHT)
  );
};

const getDedicatedHeartbeatDisplay = () => {
  const displays = screen.getAllDisplays();
  return displays.find(matchesHeartbeatDisplaySize) || null;
};

const getHeartbeatTargetDisplay = () => {
  const displays = screen.getAllDisplays();
  return getDedicatedHeartbeatDisplay() || screen.getPrimaryDisplay() || displays[0] || null;
};

const getHeartbeatWindowBounds = (targetDisplay, useFullscreen) => {
  if (!targetDisplay) return null;
  if (useFullscreen) return targetDisplay.bounds;

  const targetWidth = Math.min(HEARTBEAT_DISPLAY_WIDTH, targetDisplay.workArea.width);
  const targetHeight = Math.min(HEARTBEAT_DISPLAY_HEIGHT, targetDisplay.workArea.height);

  return {
    x: targetDisplay.workArea.x + Math.max(0, Math.round((targetDisplay.workArea.width - targetWidth) / 2)),
    y: targetDisplay.workArea.y + Math.max(0, Math.round((targetDisplay.workArea.height - targetHeight) / 2)),
    width: targetWidth,
    height: targetHeight,
  };
};

const forceHeartbeatWindowToFront = (targetDisplay = null, useFullscreen = false) => {
  if (!isHeartbeatWindowOpen()) {
    return;
  }

  if (targetDisplay) {
    const nextBounds = getHeartbeatWindowBounds(targetDisplay, useFullscreen);
    if (nextBounds) {
      heartbeatWindow.setBounds(nextBounds);
    }
  }

  if (heartbeatWindow.isMinimized()) {
    heartbeatWindow.restore();
  }

  // 전용 1920x720 패널이면 kiosk/fullscreen으로 고정하고, 개발 PC에서는 일반 always-on-top 창처럼 둡니다.
  heartbeatWindow.setFullScreen(useFullscreen);
  heartbeatWindow.setKiosk(useFullscreen);
  heartbeatWindow.setAlwaysOnTop(true, useFullscreen ? 'screen-saver' : 'normal');
  heartbeatWindow.show();

  if (typeof heartbeatWindow.moveTop === 'function') {
    heartbeatWindow.moveTop();
  }

  heartbeatWindow.focus();
};

const emitHeartbeatWindowState = (error = null) => {
  const status = buildHeartbeatWindowStatus(error);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('display-window:state', status);
  }

  if (isHeartbeatWindowOpen()) {
    heartbeatWindow.webContents.send('heartbeat-display:state', status);
  }

  return status;
};

const openHeartbeatWindow = async () => {
  const dedicatedDisplay = getDedicatedHeartbeatDisplay();
  const targetDisplay = getHeartbeatTargetDisplay();
  const useFullscreen = Boolean(dedicatedDisplay);

  if (isHeartbeatWindowOpen()) {
    forceHeartbeatWindowToFront(targetDisplay, useFullscreen);
    return { success: true, status: emitHeartbeatWindowState() };
  }

  if (!targetDisplay) {
    const message = '사용 가능한 디스플레이를 찾지 못했습니다.';
    return { success: false, error: message, status: emitHeartbeatWindowState(message) };
  }

  const windowBounds = getHeartbeatWindowBounds(targetDisplay, useFullscreen);

  heartbeatWindow = new BrowserWindow({
    ...windowBounds,
    fullscreen: useFullscreen,
    kiosk: useFullscreen,
    movable: !useFullscreen,
    resizable: !useFullscreen,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Heartbeat Display',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'heartbeatPreload.js'),
    },
  });

  heartbeatWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  heartbeatWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (key === 'escape' || (input.control && key === 'w')) {
      event.preventDefault();
      if (isHeartbeatWindowOpen()) {
        heartbeatWindow.close();
      }
    }
  });

  heartbeatWindow.on('closed', () => {
    heartbeatWindow = null;
    emitHeartbeatWindowState();
  });

  heartbeatWindow.webContents.on('did-fail-load', (_event, _errorCode, errorDescription) => {
    emitHeartbeatWindowState(errorDescription || 'Heartbeat 화면 로드 실패');
  });

  heartbeatWindow.webContents.on('did-finish-load', () => {
    emitHeartbeatWindowState();
  });

  try {
    await heartbeatWindow.loadURL(getHeartbeatDisplayUrl());
    forceHeartbeatWindowToFront(targetDisplay, useFullscreen);
    return { success: true, status: emitHeartbeatWindowState() };
  } catch (error) {
    const message = error && error.message ? error.message : 'Heartbeat 화면 로드 실패';
    if (isHeartbeatWindowOpen()) {
      heartbeatWindow.close();
    }
    return { success: false, error: message, status: emitHeartbeatWindowState(message) };
  }
};

const setHeartbeatEnabled = (enabled) => {
  heartbeatDisplayState.heartbeatEnabled = Boolean(enabled);
  return emitHeartbeatWindowState();
};

const setHeartbeatOverlayRect = (payload) => {
  const overlayRect = normalizeOverlayRect(payload);
  heartbeatDisplayState.overlayRect = overlayRect;
  heartbeatDisplayState.overlayRects = overlayRect.visible ? [overlayRect] : [];
  return emitHeartbeatWindowState();
};

const setHeartbeatOverlayRects = (payloads) => {
  const overlayRects = normalizeOverlayRects(payloads);
  heartbeatDisplayState.overlayRects = overlayRects;
  heartbeatDisplayState.overlayRect = overlayRects[0] || null;
  return emitHeartbeatWindowState();
};

const clearHeartbeatOverlayRect = () => {
  heartbeatDisplayState.overlayRect = null;
  heartbeatDisplayState.overlayRects = [];
  return emitHeartbeatWindowState();
};

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
    // write 콜백, drain 콜백, 포트 error/close 이벤트 중 어느 경로가 먼저 오든 한 번만 결과를 확정합니다.
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

// ─── IPC: Heartbeat Display Window ─────────────────────────────────

ipcMain.handle('display-window:open-heartbeat', async () => {
  try {
    return await openHeartbeatWindow();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('display-window:close-heartbeat', async () => {
  if (!isHeartbeatWindowOpen()) {
    return { success: true, status: emitHeartbeatWindowState() };
  }

  await new Promise((resolve) => {
    const currentWindow = heartbeatWindow;
    if (!currentWindow || currentWindow.isDestroyed()) {
      resolve();
      return;
    }

    currentWindow.once('closed', () => resolve());
    currentWindow.close();
  });

  return { success: true, status: buildHeartbeatWindowStatus() };
});

ipcMain.handle('display-window:start-heartbeat', async () => ({
  success: true,
  status: setHeartbeatEnabled(true),
}));

ipcMain.handle('display-window:stop-heartbeat', async () => ({
  success: true,
  status: setHeartbeatEnabled(false),
}));

ipcMain.handle('display-window:set-heartbeat-enabled', async (_event, enabled) => ({
  success: true,
  status: setHeartbeatEnabled(enabled),
}));

ipcMain.handle('display-window:set-overlay-rect', async (_event, payload) => ({
  success: true,
  status: setHeartbeatOverlayRect(payload),
}));

ipcMain.handle('display-window:set-overlay-rects', async (_event, payloads) => ({
  success: true,
  status: setHeartbeatOverlayRects(payloads),
}));

ipcMain.handle('display-window:clear-overlay-rect', async () => ({
  success: true,
  status: clearHeartbeatOverlayRect(),
}));

ipcMain.handle('display-window:clear-overlay-rects', async () => ({
  success: true,
  status: clearHeartbeatOverlayRect(),
}));

ipcMain.handle('display-window:status', async () => buildHeartbeatWindowStatus());

ipcMain.handle('heartbeat-display:get-state', async () => buildHeartbeatWindowStatus());

ipcMain.on('heartbeat-display:ready', (event) => {
  event.sender.send('heartbeat-display:state', buildHeartbeatWindowStatus());
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
    // Renderer에는 브라우저 File 객체 경로가 노출되지 않으므로, main process가 temp .py를 만들어 실행합니다.
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

      // 업로드된 Python 내용은 실행용 임시 파일로만 보관하고 프로세스 종료 후 즉시 삭제합니다.
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
