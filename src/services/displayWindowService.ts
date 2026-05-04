import {
  DisplayOverlayInput,
  DisplayOverlayRect,
  ElectronDisplayAPI,
  DisplayWindowResult,
  DisplayWindowStatus,
} from 'types';

const ASSET_BASE_URL = process.env.PUBLIC_URL || '.';

export const HEARTBEAT_DISPLAY_URL = `${ASSET_BASE_URL}/heartbeat-display.html`;
const HEARTBEAT_WINDOW_FEATURES = 'popup=yes,width=1920,height=720,left=0,top=0';
const DEFAULT_BACKGROUND_IMAGE = './BackgroundImage/cluster_bg_1920x720.png';

const getMessageTargetOrigin = () => (window.location.origin === 'null' ? '*' : window.location.origin);

const isTrustedDisplayOrigin = (origin: string) => {
  const currentOrigin = window.location.origin;
  return (
    origin === currentOrigin
    || origin === 'null'
    || currentOrigin === 'null'
    || origin.startsWith('file://')
    || currentOrigin.startsWith('file://')
    || origin === ''
  );
};

const cloneOverlayRect = (overlayRect: DisplayOverlayRect | null): DisplayOverlayRect | null => {
  if (!overlayRect) return null;

  return { ...overlayRect };
};

const cloneOverlayRects = (overlayRects: DisplayOverlayRect[] | null | undefined): DisplayOverlayRect[] => {
  if (!overlayRects?.length) return [];

  return overlayRects.map((overlayRect) => ({ ...overlayRect }));
};

const getPrimaryOverlayRect = (overlayRects: DisplayOverlayRect[], fallbackRect: DisplayOverlayRect | null = null) => {
  if (overlayRects.length > 0) {
    return cloneOverlayRect(overlayRects[0]);
  }

  return cloneOverlayRect(fallbackRect);
};

const normalizeOverlayInput = (overlay: DisplayOverlayInput): DisplayOverlayRect => {
  const x = Number.isFinite(overlay.x) ? Number(overlay.x) : 0;
  const y = Number.isFinite(overlay.y) ? Number(overlay.y) : 0;
  const width = Number.isFinite(overlay.width) ? Math.max(0, Number(overlay.width)) : null;
  const height = Number.isFinite(overlay.height) ? Math.max(0, Number(overlay.height)) : null;
  const color = typeof overlay.color === 'string' && overlay.color.trim()
    ? overlay.color.trim()
    : '#ff3b30';

  return {
    color,
    height,
    id: overlay.id,
    label: overlay.label,
    refColor: typeof overlay.refColor === 'number' && Number.isFinite(overlay.refColor)
      ? overlay.refColor
      : null,
    source: typeof overlay.source === 'string' && overlay.source.trim()
      ? overlay.source.trim()
      : undefined,
    visible: typeof overlay.visible === 'boolean'
      ? overlay.visible
      : Boolean(width && height),
    width,
    x,
    y,
  };
};

const normalizeOverlayInputs = (overlays: DisplayOverlayInput[] | null | undefined): DisplayOverlayRect[] => {
  if (!overlays?.length) return [];

  return overlays
    .map((overlay) => normalizeOverlayInput(overlay))
    .filter((overlay) => overlay.visible);
};

const cloneStatus = (status: DisplayWindowStatus): DisplayWindowStatus => {
  const overlayRects = cloneOverlayRects(status.overlayRects);

  return {
    ...status,
    overlayRect: getPrimaryOverlayRect(overlayRects, status.overlayRect),
    overlayRects,
  };
};

const withOverlayState = (
  status: DisplayWindowStatus,
  overlayRect: DisplayOverlayRect | null,
  overlayRects: DisplayOverlayRect[] = []
): DisplayWindowStatus => {
  const nextOverlayRects = cloneOverlayRects(overlayRects);
  return {
    ...status,
    overlayRect: getPrimaryOverlayRect(nextOverlayRects, overlayRect),
    overlayRects: nextOverlayRects,
  };
};

const DEFAULT_HEARTBEAT_STATUS: DisplayWindowStatus = withOverlayState({
  backgroundImage: DEFAULT_BACKGROUND_IMAGE,
  displayAvailable: true,
  heartbeatEnabled: true,
  open: false,
  overlayRect: null,
  overlayRects: [],
  url: HEARTBEAT_DISPLAY_URL,
}, null, []);

let browserFallbackWindow: Window | null = null;
let browserFallbackState: DisplayWindowStatus = cloneStatus(DEFAULT_HEARTBEAT_STATUS);
const browserStateListeners = new Set<(status: DisplayWindowStatus) => void>();

type DisplayApiLike = Partial<ElectronDisplayAPI>;

const fallbackResult = (status?: DisplayWindowStatus): DisplayWindowResult => ({
  success: true,
  status: cloneStatus(status || browserFallbackState),
});

const getDisplayApi = (): DisplayApiLike | null => {
  if (!window.electronAPI?.display) return null;
  return window.electronAPI.display as DisplayApiLike;
};

const hasDisplayMethod = <K extends keyof ElectronDisplayAPI>(
  api: DisplayApiLike | null,
  method: K
): api is DisplayApiLike & Pick<ElectronDisplayAPI, K> => Boolean(api && typeof api[method] === 'function');

const toDisplayErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallbackMessage;
};

const failureResult = (message: string): DisplayWindowResult => ({
  success: false,
  error: message,
});

const emitBrowserFallbackState = () => {
  const nextStatus = cloneStatus(browserFallbackState);
  browserStateListeners.forEach((listener) => listener(nextStatus));

  if (browserFallbackWindow && !browserFallbackWindow.closed) {
    browserFallbackWindow.postMessage(
      {
        type: 'heartbeat-display:state',
        payload: nextStatus,
      },
      getMessageTargetOrigin()
    );
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (!isTrustedDisplayOrigin(event.origin)) return;
    if (event.data?.type !== 'heartbeat-display:ready') return;
    emitBrowserFallbackState();
  });
}

class DisplayWindowService {
  async openHeartbeatWindow(): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      if (!hasDisplayMethod(displayApi, 'openHeartbeatWindow')) {
        return failureResult('Display bridge에서 openHeartbeatWindow 함수를 찾지 못했습니다.');
      }

      try {
        return await displayApi.openHeartbeatWindow();
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, 'Heartbeat 창 열기 중 오류가 발생했습니다.'));
      }
    }

    browserFallbackWindow = window.open(HEARTBEAT_DISPLAY_URL, 'heartbeat-display', HEARTBEAT_WINDOW_FEATURES);
    browserFallbackState = cloneStatus({
      ...browserFallbackState,
      open: Boolean(browserFallbackWindow && !browserFallbackWindow.closed),
    });
    emitBrowserFallbackState();
    window.setTimeout(emitBrowserFallbackState, 120);
    return fallbackResult(browserFallbackState);
  }

  async closeHeartbeatWindow(): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      if (!hasDisplayMethod(displayApi, 'closeHeartbeatWindow')) {
        return failureResult('Display bridge에서 closeHeartbeatWindow 함수를 찾지 못했습니다.');
      }

      try {
        return await displayApi.closeHeartbeatWindow();
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, 'Heartbeat 창 닫기 중 오류가 발생했습니다.'));
      }
    }

    if (browserFallbackWindow && !browserFallbackWindow.closed) {
      browserFallbackWindow.close();
    }

    browserFallbackWindow = null;
    browserFallbackState = cloneStatus({
      ...browserFallbackState,
      open: false,
    });
    emitBrowserFallbackState();
    return fallbackResult(browserFallbackState);
  }

  async startHeartbeat(): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      if (!hasDisplayMethod(displayApi, 'startHeartbeat')) {
        return failureResult('Display bridge에서 startHeartbeat 함수를 찾지 못했습니다.');
      }

      try {
        return await displayApi.startHeartbeat();
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, 'Heartbeat 시작 중 오류가 발생했습니다.'));
      }
    }

    browserFallbackState = cloneStatus({
      ...browserFallbackState,
      heartbeatEnabled: true,
    });
    emitBrowserFallbackState();
    return fallbackResult(browserFallbackState);
  }

  async stopHeartbeat(): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      if (!hasDisplayMethod(displayApi, 'stopHeartbeat')) {
        return failureResult('Display bridge에서 stopHeartbeat 함수를 찾지 못했습니다.');
      }

      try {
        return await displayApi.stopHeartbeat();
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, 'Heartbeat 중단 중 오류가 발생했습니다.'));
      }
    }

    browserFallbackState = cloneStatus({
      ...browserFallbackState,
      heartbeatEnabled: false,
    });
    emitBrowserFallbackState();
    return fallbackResult(browserFallbackState);
  }

  async setHeartbeatEnabled(enabled: boolean): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      if (!hasDisplayMethod(displayApi, 'setHeartbeatEnabled')) {
        return failureResult('Display bridge에서 setHeartbeatEnabled 함수를 찾지 못했습니다.');
      }

      try {
        return await displayApi.setHeartbeatEnabled(enabled);
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, 'Heartbeat 상태 변경 중 오류가 발생했습니다.'));
      }
    }

    browserFallbackState = cloneStatus({
      ...browserFallbackState,
      heartbeatEnabled: enabled,
    });
    emitBrowserFallbackState();
    return fallbackResult(browserFallbackState);
  }

  async setOverlayRect(overlay: DisplayOverlayInput): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      try {
        if (hasDisplayMethod(displayApi, 'setOverlayRect')) {
          return await displayApi.setOverlayRect(overlay);
        }

        if (hasDisplayMethod(displayApi, 'setOverlayRects')) {
          return await displayApi.setOverlayRects([overlay]);
        }

        return failureResult('Display bridge에서 overlay 설정 함수를 찾지 못했습니다.');
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, '오버레이 반영 중 오류가 발생했습니다.'));
      }
    }

    const normalizedOverlay = normalizeOverlayInput(overlay);
    browserFallbackState = withOverlayState({
      ...browserFallbackState,
    }, normalizedOverlay, normalizedOverlay.visible ? [normalizedOverlay] : []);
    emitBrowserFallbackState();
    return fallbackResult(browserFallbackState);
  }

  async setOverlayRects(overlays: DisplayOverlayInput[]): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      try {
        if (hasDisplayMethod(displayApi, 'setOverlayRects')) {
          return await displayApi.setOverlayRects(overlays);
        }

        if (hasDisplayMethod(displayApi, 'setOverlayRect')) {
          if (overlays.length <= 1) {
            return await displayApi.setOverlayRect(overlays[0] || {});
          }

          return failureResult('현재 Electron display bridge가 다중 오버레이를 지원하지 않습니다. Electron 앱을 재시작해 preload를 갱신해주세요.');
        }

        return failureResult('Display bridge에서 multi-overlay 설정 함수를 찾지 못했습니다.');
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, '다중 오버레이 반영 중 오류가 발생했습니다.'));
      }
    }

    const normalizedOverlays = normalizeOverlayInputs(overlays);
    browserFallbackState = withOverlayState({
      ...browserFallbackState,
    }, normalizedOverlays[0] || null, normalizedOverlays);
    emitBrowserFallbackState();
    return fallbackResult(browserFallbackState);
  }

  async clearOverlayRect(): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      try {
        if (hasDisplayMethod(displayApi, 'clearOverlayRect')) {
          return await displayApi.clearOverlayRect();
        }

        if (hasDisplayMethod(displayApi, 'clearOverlayRects')) {
          return await displayApi.clearOverlayRects();
        }

        return failureResult('Display bridge에서 overlay clear 함수를 찾지 못했습니다.');
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, '오버레이 제거 중 오류가 발생했습니다.'));
      }
    }

    browserFallbackState = withOverlayState({
      ...browserFallbackState,
    }, null, []);
    emitBrowserFallbackState();
    return fallbackResult(browserFallbackState);
  }

  async clearOverlayRects(): Promise<DisplayWindowResult> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      try {
        if (hasDisplayMethod(displayApi, 'clearOverlayRects')) {
          return await displayApi.clearOverlayRects();
        }

        if (hasDisplayMethod(displayApi, 'clearOverlayRect')) {
          return await displayApi.clearOverlayRect();
        }

        return failureResult('Display bridge에서 multi-overlay clear 함수를 찾지 못했습니다.');
      } catch (error) {
        return failureResult(toDisplayErrorMessage(error, '다중 오버레이 제거 중 오류가 발생했습니다.'));
      }
    }

    browserFallbackState = withOverlayState({
      ...browserFallbackState,
    }, null, []);
    emitBrowserFallbackState();
    return fallbackResult(browserFallbackState);
  }

  async getStatus(): Promise<DisplayWindowStatus> {
    const displayApi = getDisplayApi();
    if (displayApi) {
      if (!hasDisplayMethod(displayApi, 'status')) {
        return {
          ...cloneStatus(browserFallbackState),
          error: 'Display bridge에서 status 함수를 찾지 못했습니다.',
        };
      }

      try {
        return await displayApi.status();
      } catch (error) {
        return {
          ...cloneStatus(browserFallbackState),
          error: toDisplayErrorMessage(error, 'Display 상태 조회 중 오류가 발생했습니다.'),
        };
      }
    }

    const open = Boolean(browserFallbackWindow && !browserFallbackWindow.closed);
    browserFallbackState = cloneStatus({
      ...browserFallbackState,
      open,
    });

    return cloneStatus(browserFallbackState);
  }

  onState(callback: (status: DisplayWindowStatus) => void): () => void {
    const displayApi = getDisplayApi();
    if (displayApi) {
      if (!hasDisplayMethod(displayApi, 'onState')) {
        console.warn('[DisplayWindowService] display.onState is not available.');
        return () => undefined;
      }

      try {
        return displayApi.onState(callback);
      } catch (error) {
        console.warn('[DisplayWindowService] display.onState registration failed:', error);
        return () => undefined;
      }
    }

    browserStateListeners.add(callback);
    return () => {
      browserStateListeners.delete(callback);
    };
  }
}

export const displayWindowService = new DisplayWindowService();
