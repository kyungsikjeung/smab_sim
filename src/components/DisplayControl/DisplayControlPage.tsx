import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import {
  DISPLAY_VSB_SLOT_COUNT,
  buildOverlayInputFromPreset,
  cloneDisplayVsbPresets,
  createDisplayVsbSampleJson,
  hexColorToBgrNumber,
  importDisplayVsbPresetJson,
} from 'data/displayVsbPresets';
import {
  WARNING_LIGHT_COUNT,
  displayHeartbeatEnabledState,
  displayInitReceivedState,
  displayOverlayRectState,
  displayOverlayRectsState,
  displayStreamingState,
  displayWindowOpenState,
  terminalLinesState,
  toastMessageState,
  warningLightsState,
} from 'state/atoms';
import { useSerial } from 'hooks/useSerial';
import { displayWindowService, HEARTBEAT_DISPLAY_URL } from 'services/displayWindowService';
import { DisplayOverlayPreset, DisplayOverlayRect, DisplayWindowResult, DisplayWindowStatus, WarningLight } from 'types';
import './DisplayControl.css';

const PREVIEW_BACKGROUND_IMAGE = './heartbeat-assets/cluster_bg_1920x720.png';
const VSB_SELECT_NONE = 'none';
const WARNING_LIGHT_SELECT_DEFAULT = 'default';
const VSB_SAMPLE_FILE_NAME = 'Sample.json';
const VSB_SAVE_FILE_NAME = 'VSB_COLOR.json';
const MAX_SELECTABLE_DISPLAY_SLOT = 28;
const VSB_COLOR_SWATCHES = [
  '#ffd60a',
  '#ffb300',
  '#ff9500',
  '#ff453a',
  '#30d158',
  '#0a84ff',
  '#64d2ff',
  '#ffffff',
];

const applyStatusTextColor = (streaming: boolean, initReceived: boolean) => {
  if (streaming) return 'var(--color-info)';
  if (initReceived) return 'var(--color-success)';
  return 'var(--color-warning)';
};

const getPrimaryOverlayRect = (overlayRect: DisplayOverlayRect | null, overlayRects: DisplayOverlayRect[]) => (
  overlayRect ?? overlayRects[0] ?? null
);

const getPreviewMessageTargetOrigin = () => (window.location.origin === 'null' ? '*' : window.location.origin);

const isPreviewReadyEvent = (event: MessageEvent, previewWindow: Window | null) => (
  event.data?.type === 'heartbeat-display:ready' && event.source === previewWindow
);

const toLightsMask = (lights: WarningLight[]) => {
  const bitMask = lights.reduce((acc, light) => {
    const lightBit = light.isOn ? (1 << (light.id - 1)) >>> 0 : 0;
    return (acc | lightBit) >>> 0;
  }, 0);

  return bitMask.toString(16).toUpperCase().padStart(8, '0');
};

const buildWarningLightsForSlot = (lights: WarningLight[], activeSlot: number | null) => (
  lights.map((light) => ({
    ...light,
    isOn: activeSlot !== null && light.id === activeSlot,
  }))
);

const formatIndexedLabel = (prefix: string, slot: number) => `${prefix} ${slot}`;

const isSelectableDisplaySlot = (slot: number) => Number.isInteger(slot) && slot > 0 && slot <= MAX_SELECTABLE_DISPLAY_SLOT;

const resolveWarningLightSlot = (warningLightSelection: string, vsbSlotSelection: string): number | null => {
  if (warningLightSelection === VSB_SELECT_NONE) {
    return null;
  }

  if (warningLightSelection === WARNING_LIGHT_SELECT_DEFAULT) {
    const resolvedDefaultSlot = Number(vsbSlotSelection);
    return isSelectableDisplaySlot(resolvedDefaultSlot) ? resolvedDefaultSlot : null;
  }

  const explicitSlot = Number(warningLightSelection);
  return isSelectableDisplaySlot(explicitSlot) ? explicitSlot : null;
};

const normalizePaletteColor = (value: string, fallbackColor: string) => {
  const normalized = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return fallbackColor;
  }

  return `#${normalized.toLowerCase()}`;
};

const downloadTextFile = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
};

const DisplayControlPage: React.FC = () => {
  const { send, connected } = useSerial();
  const terminalLines = useRecoilValue(terminalLinesState);
  const warningLights = useRecoilValue(warningLightsState);
  const [initReceived, setInitReceived] = useRecoilState(displayInitReceivedState);
  const [streaming, setStreaming] = useRecoilState(displayStreamingState);
  const [displayWindowOpen, setDisplayWindowOpen] = useRecoilState(displayWindowOpenState);
  const [heartbeatEnabled, setHeartbeatEnabled] = useRecoilState(displayHeartbeatEnabledState);
  const displayOverlayRect = useRecoilValue(displayOverlayRectState);
  const displayOverlayRects = useRecoilValue(displayOverlayRectsState);
  const setDisplayOverlayRect = useSetRecoilState(displayOverlayRectState);
  const setDisplayOverlayRects = useSetRecoilState(displayOverlayRectsState);
  const setWarningLights = useSetRecoilState(warningLightsState);
  const setToast = useSetRecoilState(toastMessageState);
  const [initString, setInitString] = useState('Device Init');
  const [vsbAccordionOpen, setVsbAccordionOpen] = useState(false);
  const [vsbSyncing, setVsbSyncing] = useState(false);
  const [displayWindowBusy, setDisplayWindowBusy] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const vsbImportInputRef = useRef<HTMLInputElement | null>(null);
  const selectionHydratedRef = useRef(false);
  const [vsbPresets, setVsbPresets] = useState<DisplayOverlayPreset[]>(() => cloneDisplayVsbPresets());
  const [selectedWarningLight, setSelectedWarningLight] = useState(VSB_SELECT_NONE);
  const [selectedVsbSlot, setSelectedVsbSlot] = useState(VSB_SELECT_NONE);

  const activeOverlayRects = useMemo(() => displayOverlayRects || [], [displayOverlayRects]);
  const activeOverlaySlots = useMemo(() => (
    activeOverlayRects
      .map((overlay) => (typeof overlay.id === 'number' ? overlay.id : Number.NaN))
      .filter((slot): slot is number => Number.isFinite(slot))
      .sort((left, right) => left - right)
  ), [activeOverlayRects]);
  const osdSlotLimit = Math.min(DISPLAY_VSB_SLOT_COUNT, MAX_SELECTABLE_DISPLAY_SLOT);
  const selectableVsbPresets = useMemo(
    () => vsbPresets.filter((preset) => isSelectableDisplaySlot(preset.slot)),
    [vsbPresets]
  );
  const selectedVsbPreset = useMemo(
    () => (selectedVsbSlot === VSB_SELECT_NONE ? null : selectableVsbPresets.find((preset) => preset.slot === Number(selectedVsbSlot)) || null),
    [selectableVsbPresets, selectedVsbSlot]
  );

  const applyDisplayStatus = useCallback((status: DisplayWindowStatus) => {
    setDisplayWindowOpen(status.open);
    setHeartbeatEnabled(status.heartbeatEnabled);
    setDisplayOverlayRects(status.overlayRects || []);
    setDisplayOverlayRect(getPrimaryOverlayRect(status.overlayRect, status.overlayRects || []));
  }, [setDisplayOverlayRect, setDisplayOverlayRects, setDisplayWindowOpen, setHeartbeatEnabled]);

  const syncDisplayResult = useCallback((result: DisplayWindowResult) => {
    if (result.status) {
      applyDisplayStatus(result.status);
    }
  }, [applyDisplayStatus]);

  const previewStatus = useMemo<DisplayWindowStatus>(() => ({
    backgroundImage: PREVIEW_BACKGROUND_IMAGE,
    displayAvailable: true,
    heartbeatEnabled,
    open: displayWindowOpen,
    overlayRect: getPrimaryOverlayRect(displayOverlayRect, activeOverlayRects),
    overlayRects: activeOverlayRects,
    url: HEARTBEAT_DISPLAY_URL,
  }), [activeOverlayRects, displayOverlayRect, displayWindowOpen, heartbeatEnabled]);

  const postPreviewState = useCallback(() => {
    const previewWindow = previewFrameRef.current?.contentWindow;
    if (!previewWindow) return;

    previewWindow.postMessage(
      {
        type: 'heartbeat-display:state',
        payload: previewStatus,
      },
      getPreviewMessageTargetOrigin()
    );
  }, [previewStatus]);

  const refreshDisplayWindowStatus = useCallback(async () => {
    const status = await displayWindowService.getStatus();
    applyDisplayStatus(status);
    if (status.error) {
      setToast({ type: 'error', message: status.error });
    }
  }, [applyDisplayStatus, setToast]);

  const handleOpenDisplayWindow = useCallback(async () => {
    setDisplayWindowBusy(true);
    try {
      const result = await displayWindowService.openHeartbeatWindow();
      syncDisplayResult(result);

      if (!result.success) {
        setToast({ type: 'error', message: result.error || 'Heartbeat 서브 창 열기에 실패했습니다.' });
        return;
      }

      setToast({ type: 'info', message: 'Heartbeat 서브 창을 열었습니다.' });
    } finally {
      setDisplayWindowBusy(false);
    }
  }, [setToast, syncDisplayResult]);

  const handleCloseDisplayWindow = useCallback(async () => {
    setDisplayWindowBusy(true);
    try {
      const result = await displayWindowService.closeHeartbeatWindow();
      syncDisplayResult(result);

      if (!result.success) {
        setToast({ type: 'error', message: result.error || 'Heartbeat 서브 창 닫기에 실패했습니다.' });
        return;
      }

      setToast({ type: 'info', message: 'Heartbeat 서브 창을 닫았습니다.' });
    } finally {
      setDisplayWindowBusy(false);
    }
  }, [setToast, syncDisplayResult]);

  const handleToggleDisplayWindow = useCallback(async () => {
    if (displayWindowBusy) {
      return;
    }

    if (displayWindowOpen) {
      await handleCloseDisplayWindow();
      return;
    }

    await handleOpenDisplayWindow();
  }, [displayWindowBusy, displayWindowOpen, handleCloseDisplayWindow, handleOpenDisplayWindow]);

  const handleStartHeartbeat = useCallback(async () => {
    const openResult = await displayWindowService.openHeartbeatWindow();
    syncDisplayResult(openResult);
    if (!openResult.success) {
      setToast({ type: 'error', message: openResult.error || 'Heartbeat 창 열기에 실패했습니다.' });
      return;
    }

    const result = await displayWindowService.startHeartbeat();
    syncDisplayResult(result);
    if (!result.success) {
      setToast({ type: 'error', message: result.error || 'Heartbeat 시작에 실패했습니다.' });
      return;
    }

    setToast({ type: 'success', message: 'Heartbeat를 시작했습니다.' });
  }, [setToast, syncDisplayResult]);

  const handleStopHeartbeat = useCallback(async () => {
    const result = await displayWindowService.stopHeartbeat();
    syncDisplayResult(result);
    if (!result.success) {
      setToast({ type: 'error', message: result.error || 'Heartbeat 중단에 실패했습니다.' });
      return;
    }

    setToast({ type: 'info', message: 'Heartbeat를 중단했습니다.' });
  }, [setToast, syncDisplayResult]);

  const syncPresetOverlays = useCallback(async (
    nextSlots: number[],
    options?: { presets?: DisplayOverlayPreset[]; showToast?: boolean }
  ) => {
    setVsbSyncing(true);

    try {
      if (nextSlots.length > 0 && !displayWindowOpen) {
        setToast({ type: 'warning', message: 'Window open 안되었습니다. 먼저 창 열기를 확인해주세요.' });
        return;
      }

      const nextOverlays = (options?.presets || vsbPresets)
        .filter((preset) => nextSlots.includes(preset.slot))
        .map((preset) => buildOverlayInputFromPreset(preset));

      const result = nextOverlays.length > 0
        ? await displayWindowService.setOverlayRects(nextOverlays)
        : await displayWindowService.clearOverlayRects();

      syncDisplayResult(result);

      if (!result.success) {
        setToast({ type: 'error', message: result.error || 'VSB 오버레이 반영에 실패했습니다.' });
        return;
      }

      if (options?.showToast !== false) {
        const message = nextSlots.length > 0
          ? `VSB 오버레이 ${nextSlots.length}개를 프리뷰와 Heartbeat 창에 반영했습니다.`
          : 'VSB 오버레이를 모두 해제했습니다.';
        setToast({ type: nextSlots.length > 0 ? 'success' : 'info', message });
      }
    } finally {
      setVsbSyncing(false);
    }
  }, [displayWindowOpen, setToast, syncDisplayResult, vsbPresets]);

  const syncWarningLightsForSelection = useCallback(async (
    nextWarningLightSelection: string,
    nextVsbSlotSelection: string,
    options?: { showToast?: boolean; notifyDisconnected?: boolean }
  ) => {
    if (!connected) {
      if (options?.notifyDisconnected !== false) {
        setToast({ type: 'error', message: '시리얼 연결이 안되었습니다.' });
      }
      return;
    }

    const nextLightSlot = resolveWarningLightSlot(nextWarningLightSelection, nextVsbSlotSelection);
    const nextLights = buildWarningLightsForSlot(warningLights, nextLightSlot);

    setWarningLights(nextLights);

    const result = await send(`lights ${toLightsMask(nextLights)}`);
    if (!result.success) {
      setToast({ type: 'error', message: result.error || '경고등 상태 반영에 실패했습니다.' });
      return;
    }

    if (options?.showToast) {
      const message = nextLightSlot === null
        ? '경고등을 모두 OFF로 설정했습니다.'
        : `${formatIndexedLabel('Light', nextLightSlot)}를 ON으로 설정했습니다.`;
      setToast({ type: 'info', message });
    }
  }, [connected, send, setToast, setWarningLights, warningLights]);

  const syncVsbSelections = useCallback(async (
    nextVsbSlotSelection: string,
    nextWarningLightSelection: string,
    options?: { presets?: DisplayOverlayPreset[]; showToast?: boolean; notifyDisconnected?: boolean }
  ) => {
    const nextSlots = nextVsbSlotSelection === VSB_SELECT_NONE ? [] : [Number(nextVsbSlotSelection)];
    await syncPresetOverlays(nextSlots, { presets: options?.presets, showToast: options?.showToast });
    await syncWarningLightsForSelection(nextWarningLightSelection, nextVsbSlotSelection, {
      showToast: false,
      notifyDisconnected: options?.notifyDisconnected,
    });
  }, [syncPresetOverlays, syncWarningLightsForSelection]);

  const handleWarningLightChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSelection = event.target.value;
    setSelectedWarningLight(nextSelection);
    void syncVsbSelections(selectedVsbSlot, nextSelection, { showToast: false });
  }, [selectedVsbSlot, syncVsbSelections]);

  const handleVsbSlotChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSelection = event.target.value;
    setSelectedVsbSlot(nextSelection);
    void syncVsbSelections(nextSelection, selectedWarningLight, { showToast: false });
  }, [selectedWarningLight, syncVsbSelections]);

  const handleClearVsbSelections = useCallback(() => {
    setSelectedWarningLight(VSB_SELECT_NONE);
    setSelectedVsbSlot(VSB_SELECT_NONE);
    void syncVsbSelections(VSB_SELECT_NONE, VSB_SELECT_NONE, { showToast: true, notifyDisconnected: true });
  }, [syncVsbSelections]);

  const handleDownloadVsbSample = useCallback(() => {
    downloadTextFile(VSB_SAMPLE_FILE_NAME, createDisplayVsbSampleJson(vsbPresets));
    setToast({ type: 'info', message: `${VSB_SAMPLE_FILE_NAME}을 다운로드했습니다.` });
  }, [setToast, vsbPresets]);

  const handleSaveVsbConfig = useCallback(() => {
    downloadTextFile(VSB_SAVE_FILE_NAME, createDisplayVsbSampleJson(vsbPresets));
    setToast({ type: 'success', message: `${VSB_SAVE_FILE_NAME}에 현재 VSB Color 설정을 저장했습니다.` });
  }, [setToast, vsbPresets]);

  const handleOpenVsbImport = useCallback(() => {
    vsbImportInputRef.current?.click();
  }, []);

  const handleImportVsbJson = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as unknown;
      const nextPresets = importDisplayVsbPresetJson(parsed, vsbPresets);
      setVsbPresets(nextPresets);
      await syncVsbSelections(selectedVsbSlot, selectedWarningLight, { presets: nextPresets, showToast: false });
      setToast({ type: 'success', message: `${file.name} 설정을 불러왔습니다.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'JSON import 중 오류가 발생했습니다.';
      setToast({ type: 'error', message });
    } finally {
      event.target.value = '';
    }
  }, [selectedVsbSlot, selectedWarningLight, setToast, syncVsbSelections, vsbPresets]);

  const applySelectedVsbColor = useCallback(async (nextColorValue: string) => {
    if (!selectedVsbPreset) {
      return;
    }

    const nextColor = normalizePaletteColor(nextColorValue, selectedVsbPreset.color);
    const nextPresets = vsbPresets.map((preset) => (
      preset.slot === selectedVsbPreset.slot
        ? {
            ...preset,
            color: nextColor,
            refColor: hexColorToBgrNumber(nextColor),
          }
        : preset
    ));

    setVsbPresets(nextPresets);
    await syncVsbSelections(selectedVsbSlot, selectedWarningLight, { presets: nextPresets, showToast: false });
  }, [selectedVsbPreset, selectedVsbSlot, selectedWarningLight, syncVsbSelections, vsbPresets]);

  const handleSelectVsbPaletteColor = useCallback((color: string) => {
    void applySelectedVsbColor(color);
  }, [applySelectedVsbColor]);

  const handleToggleVsbAccordion = useCallback(() => {
    setVsbAccordionOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!connected || initReceived) return;

    const lastLines = terminalLines.filter((line) => line.direction === 'rx').slice(-5);
    const found = lastLines.some((line) => line.content.includes(initString));
    if (found) {
      setInitReceived(true);
    }
  }, [connected, initReceived, initString, setInitReceived, terminalLines]);

  useEffect(() => {
    if (!initReceived || streaming) return;

    const runAutoStart = async () => {
      const result = await send('DISPLAY_START');
      if (!result.success) return;

      setStreaming(true);
      const openResult = await displayWindowService.openHeartbeatWindow();
      syncDisplayResult(openResult);

      if (openResult.success) {
        const heartbeatResult = await displayWindowService.startHeartbeat();
        syncDisplayResult(heartbeatResult);
      }
    };

    void runAutoStart();
  }, [initReceived, send, setStreaming, streaming, syncDisplayResult]);

  useEffect(() => {
    void refreshDisplayWindowStatus();

    const unsubscribe = displayWindowService.onState((status) => {
      applyDisplayStatus(status);
      if (status.error) {
        setToast({ type: 'error', message: status.error });
      }
    });

    return unsubscribe;
  }, [applyDisplayStatus, refreshDisplayWindowStatus, setToast]);

  useEffect(() => {
    postPreviewState();
  }, [postPreviewState]);

  useEffect(() => {
    const handlePreviewReady = (event: MessageEvent) => {
      if (!isPreviewReadyEvent(event, previewFrameRef.current?.contentWindow || null)) {
        return;
      }

      postPreviewState();
    };

    window.addEventListener('message', handlePreviewReady);
    return () => {
      window.removeEventListener('message', handlePreviewReady);
    };
  }, [postPreviewState]);

  useEffect(() => {
    if (selectionHydratedRef.current) {
      return;
    }

    const activeLightSlot = warningLights.find((light) => light.isOn && isSelectableDisplaySlot(light.id))?.id ?? null;
    const activeVsbSlot = activeOverlaySlots.find((slot) => isSelectableDisplaySlot(slot)) ?? null;

    if (activeLightSlot === null && activeVsbSlot === null) {
      return;
    }

    setSelectedVsbSlot(activeVsbSlot ? String(activeVsbSlot) : VSB_SELECT_NONE);
    setSelectedWarningLight(
      activeLightSlot === null
        ? VSB_SELECT_NONE
        : activeVsbSlot !== null && activeLightSlot === activeVsbSlot
          ? WARNING_LIGHT_SELECT_DEFAULT
          : String(activeLightSlot)
    );
    selectionHydratedRef.current = true;
  }, [activeOverlaySlots, warningLights]);

  const handleManualStart = useCallback(async () => {
    const result = await send('DISPLAY_START');
    if (!result.success) return;

    setStreaming(true);
    setInitReceived(true);
    await handleStartHeartbeat();
  }, [handleStartHeartbeat, send, setInitReceived, setStreaming]);

  const handleStopStreaming = useCallback(async () => {
    const result = await send('DISPLAY_STOP');
    if (!result.success) return;

    setStreaming(false);
    setToast({ type: 'info', message: 'DISPLAY_STOP을 전송했습니다.' });
  }, [send, setStreaming, setToast]);

  const handleReset = useCallback(() => {
    setInitReceived(false);
    setStreaming(false);
  }, [setInitReceived, setStreaming]);

  const statusLabel = streaming
    ? 'STREAMING'
    : initReceived
      ? 'READY'
      : 'Init String';

  const statusClass = streaming
    ? 'streaming'
    : initReceived
      ? 'ready'
      : 'waiting';

  const overlaySummary = activeOverlayRects.length > 0
    ? `${activeOverlayRects.length} Active`
    : 'VSB Hidden';

  const resolvedWarningLightSlot = resolveWarningLightSlot(selectedWarningLight, selectedVsbSlot);
  const warningLightSummary = resolvedWarningLightSlot === null
    ? 'All OFF'
    : `${formatIndexedLabel('Light', resolvedWarningLightSlot)} ON`;
  const vsbSelectionSummary = selectedVsbPreset
    ? formatIndexedLabel('VSB', selectedVsbPreset.slot)
    : '선택 안함';
  const heartbeatWindowStatusLabel = !displayWindowOpen
    ? '창 닫힘'
    : heartbeatEnabled
      ? '하트비트 송출'
      : '하트비트 중단';

  return (
    <div className="display-page">
      <div className="display__status-bar">
        <div className="display__status-indicator">
          <div className={`display__status-icon display__status-icon--${statusClass}`} />
          <span className="display__status-text" style={{ color: applyStatusTextColor(streaming, initReceived) }}>
            {statusLabel}
          </span>
        </div>

        <div className="display__init-string">
          <span className="display__init-label">Trigger String:</span>
          <input
            className="input display__init-input"
            value={initString}
            onChange={(event) => setInitString(event.target.value)}
            placeholder="Device Init String..."
            disabled={streaming}
          />
        </div>

        <div className="display__status-actions">
          {!streaming ? (
            <button className="btn btn--primary btn--sm" onClick={() => void handleManualStart()} disabled={!connected}>
              Manual Start
            </button>
          ) : (
            <button className="btn btn--danger btn--sm" onClick={() => void handleStopStreaming()}>
              Stop
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={handleReset} disabled={streaming}>
            Reset
          </button>
        </div>
      </div>

      <div className="display__window-panel">
        <div className="display__window-info">
          <span className={`display__window-dot ${displayWindowOpen ? 'display__window-dot--open' : ''}`} />
          <div>
            <div className="display__window-title">Heartbeat Sub Window</div>
            <div className="display__window-url">{HEARTBEAT_DISPLAY_URL} · 1920 × 720 · Local HTML</div>
          </div>
        </div>

        <div className="display__window-summary">
          <span className={`badge ${heartbeatEnabled ? 'badge--success' : 'badge--warning'}`}>
            {heartbeatEnabled ? 'Heartbeat ON' : 'Heartbeat OFF'}
          </span>
          <span className={`badge ${activeOverlayRects.length > 0 ? 'badge--error' : 'badge--info'}`}>
            {activeOverlayRects.length > 0 ? `${activeOverlayRects.length} VSB Active` : 'VSB Hidden'}
          </span>
        </div>

        <div className="display__window-actions">
          <button
            className={`btn btn--sm ${displayWindowOpen ? 'btn--danger' : 'btn--primary'}`}
            onClick={() => void handleToggleDisplayWindow()}
            disabled={displayWindowBusy}
            type="button"
          >
            {displayWindowBusy
              ? (displayWindowOpen ? '창 닫는 중...' : '창 여는 중...')
              : (displayWindowOpen ? '창 닫기' : '창 열기')}
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => void (heartbeatEnabled ? handleStopHeartbeat() : handleStartHeartbeat())}
            type="button"
          >
            {heartbeatEnabled ? 'HeartBeat 중단' : 'HeartBeat 시작'}
          </button>
        </div>
      </div>

      <div className={`display__vsb-panel ${vsbAccordionOpen ? 'display__vsb-panel--open' : ''}`}>
        <div className="display__vsb-header">
          <button className="display__vsb-header-main" type="button" onClick={handleToggleVsbAccordion}>
            <div>
              <div className="display__vsb-eyebrow">경고등 이미지 에러 확인</div>
              <div className="display__vsb-title">Light 1~28 경고등 이미지 에러 위치 설정</div>
              <div className="display__vsb-description">
                Warning Light와 경고등 이미지 에러 위치를 연결해 확인합니다.
              </div>
            </div>
          </button>

          <div className="display__vsb-header-meta">
            <span className={`badge ${activeOverlayRects.length > 0 ? 'badge--error' : 'badge--info'}`}>
              {activeOverlayRects.length} / {osdSlotLimit}
            </span>
            <button
              className="btn btn--ghost btn--sm display__vsb-clear-button"
              type="button"
              onClick={handleClearVsbSelections}
              disabled={vsbSyncing}
            >
              Clear(Default)
            </button>
            <button
              className="display__vsb-chevron-button"
              type="button"
              onClick={handleToggleVsbAccordion}
              aria-label={vsbAccordionOpen ? 'VSB 설정 접기' : 'VSB 설정 펼치기'}
            >
              <span className="display__vsb-chevron">{vsbAccordionOpen ? '▾' : '▸'}</span>
            </button>
          </div>
        </div>

        {vsbAccordionOpen && (
          <div className="display__vsb-body">
            <div className="display__vsb-toolbar">
              <div className="display__vsb-toolbar-text">
                "Default"는 선택한 VSB와 같은 번호의 경고등을 ON으로 맞춥니다.
              </div>
              <div className="display__vsb-toolbar-actions">
                <input
                  ref={vsbImportInputRef}
                  className="display__file-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportVsbJson}
                />
                <button className="btn btn--secondary btn--sm" type="button" onClick={handleDownloadVsbSample}>
                  Sample.json 다운로드
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={handleSaveVsbConfig}>
                  VSB Color 저장
                </button>
                <button className="btn btn--ghost btn--sm" type="button" onClick={handleOpenVsbImport}>
                  Import JSON
                </button>
                <button className="btn btn--ghost btn--sm" type="button" onClick={handleClearVsbSelections} disabled={vsbSyncing}>
                  Clear(Default)
                </button>
              </div>
            </div>

            <div className="display__vsb-select-row">
              <label className="display__vsb-field">
                <span className="display__vsb-field-label">Warning Light</span>
                <select
                  className="display__vsb-select"
                  value={selectedWarningLight}
                  onChange={handleWarningLightChange}
                  disabled={vsbSyncing}
                >
                  <option value={VSB_SELECT_NONE}>선택 안함</option>
                  <option value={WARNING_LIGHT_SELECT_DEFAULT}>Default</option>
                  {Array.from({ length: Math.min(WARNING_LIGHT_COUNT, MAX_SELECTABLE_DISPLAY_SLOT) }, (_, index) => {
                    const slot = index + 1;
                    return (
                      <option key={slot} value={String(slot)}>
                        {formatIndexedLabel('Light', slot)} ON
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="display__vsb-field">
                <span className="display__vsb-field-label">VSB</span>
                <select
                  className="display__vsb-select"
                  value={selectedVsbSlot}
                  onChange={handleVsbSlotChange}
                  disabled={vsbSyncing}
                >
                  <option value={VSB_SELECT_NONE}>선택 안함</option>
                  {selectableVsbPresets.map((preset) => (
                    <option key={preset.slot} value={String(preset.slot)}>
                      {formatIndexedLabel('VSB', preset.slot)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="display__vsb-field display__vsb-field--color">
                <span className="display__vsb-field-label">VSB Color</span>
                <div className="display__vsb-palette">
                  {VSB_COLOR_SWATCHES.map((color) => (
                    <button
                      key={color}
                      className={`display__vsb-swatch ${selectedVsbPreset?.color === color ? 'display__vsb-swatch--active' : ''}`}
                      type="button"
                      style={{ backgroundColor: color }}
                      onClick={() => handleSelectVsbPaletteColor(color)}
                      disabled={!selectedVsbPreset || vsbSyncing}
                      aria-label={`VSB color ${color}`}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="display__vsb-selection-summary">
              <div className="display__vsb-stat">
                <span className="display__vsb-stat-label">Size</span>
                <strong>{selectedVsbPreset ? `${selectedVsbPreset.width} × ${selectedVsbPreset.height}` : '--'}</strong>
              </div>
              <div className="display__vsb-stat">
                <span className="display__vsb-stat-label">Color</span>
                <strong>{selectedVsbPreset?.color || '--'}</strong>
              </div>
              <div className="display__vsb-stat">
                <span className="display__vsb-stat-label">Position</span>
                <strong>{selectedVsbPreset ? `${selectedVsbPreset.x}, ${selectedVsbPreset.y}` : '--'}</strong>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="display__preview">
        <div className="display__preview-header">
          <span className="display__preview-title">Display Output Preview</span>
          <span className="display__resolution">1920 × 720</span>
        </div>

        <div className="display__preview-area">
          <div className="display__preview-stage">
            <div className="display__preview-media">
              <div className="display__preview-frame-shell">
                <iframe
                  ref={previewFrameRef}
                  className="display__preview-frame"
                  title="Heartbeat Display Preview"
                  src={HEARTBEAT_DISPLAY_URL}
                  onLoad={postPreviewState}
                />
              </div>

              {streaming && (
                <div className="display__streaming-overlay">
                  <div className="display__streaming-dot" />
                  LIVE
                </div>
              )}
            </div>

            <div className="display__preview-copy">
              <div className="display__preview-line">
                <strong>Window</strong>
                <span>{displayWindowOpen ? 'OPEN' : 'CLOSED'}</span>
              </div>
              <div className="display__preview-line">
                <strong>HeartBeat</strong>
                <span>{heartbeatEnabled ? 'RUNNING' : 'STOPPED'}</span>
              </div>
              <div className="display__preview-line">
                <strong>Overlay</strong>
                <span>{overlaySummary}</span>
              </div>
              <div className="display__preview-line">
                <strong>Stream</strong>
                <span>{streaming ? 'DISPLAY_START active' : 'DISPLAY_STOP / idle'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="display__config">
        <div className="display__config-card">
          <div className="display__config-title">Resolution</div>
          <div className="display__config-value">1920 × 720</div>
        </div>
        <div className="display__config-card">
          <div className="display__config-title">Window Status</div>
          <div className="display__config-value">{heartbeatWindowStatusLabel}</div>
        </div>
        <div className="display__config-card">
          <div className="display__config-title">Display Stream</div>
          <div className="display__config-value">{streaming ? 'DISPLAY_START active' : 'DISPLAY_STOP / idle'}</div>
        </div>
        <div className="display__config-card">
          <div className="display__config-title">VSB Overlay</div>
          <div className="display__config-value">{activeOverlayRects.length} / {osdSlotLimit}</div>
        </div>
      </div>
    </div>
  );
};

export default DisplayControlPage;
