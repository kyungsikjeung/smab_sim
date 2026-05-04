import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { useSerial } from 'hooks/useSerial';
import FaultPinLevelChart from 'components/FaultPinMonitor/FaultPinLevelChart';
import { DISPLAY_VSB_PRESETS } from 'data/displayVsbPresets';
import { displayWindowService } from 'services/displayWindowService';
import {
  displayOverlayRectsState,
  displayWindowOpenState,
  faultPinMonitorState,
  toastMessageState,
  voltMonThresholdsState,
  warningLightsState,
} from 'state/atoms';
import { DisplayOverlayPreset, GpioPinSnapshot, WarningLight } from 'types';
import './FaultPinMonitor.css';

const FAULT_PIN_STREAM_START_COMMAND = 'fault_pin_stream start';
const FAULT_PIN_STREAM_STOP_COMMAND = 'fault_pin_stream stop';
const VOLTAGE_FAULT_SET_COMMAND = 'voltmon set 0 30000 33000';
const VOLTAGE_FAULT_CLEAR_COMMAND = 'voltmon set 0 0 33000';
const RAM_ECC_COMMAND = 'lram_ecc_inj der';
const WDT_FAULT_COMMAND = 'wdt_fault inject';
const VIDEO_FREEZE_COMMAND = 'faultinj set 16';
const VIDEO_FREEZE_CLEAR_COMMAND = 'faultinj clear 16';
const VSB_ERROR_SLOT = 1;
const STREAM_RESTART_DELAY_MS = 500;
const STREAM_STALE_THRESHOLD_MS = 1200;
const STREAM_HEALTHCHECK_INITIAL_DELAY_MS = 400;
const STREAM_HEALTHCHECK_INTERVAL_MS = 1000;

const toLightsMask = (lights: WarningLight[]) => {
  const bitMask = lights.reduce((acc, light) => {
    const lightBit = light.isOn ? (1 << (light.id - 1)) >>> 0 : 0;
    return (acc | lightBit) >>> 0;
  }, 0);

  return bitMask.toString(16).toUpperCase().padStart(8, '0');
};

const buildOverlayInputFromPreset = (preset: DisplayOverlayPreset) => ({
  color: preset.color,
  height: preset.height,
  id: preset.slot,
  label: preset.label,
  refColor: preset.refColor,
  source: preset.source,
  visible: true,
  width: preset.width,
  x: preset.x,
  y: preset.y,
});

const formatUpdatedAt = (timestamp: number | null) => {
  if (!timestamp) return '미수신';

  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour12: false,
  });
};

const getLevelTone = (level: GpioPinSnapshot['level']) => {
  if (level === 'HIGH') return 'fault-pin-monitor__pin-card--high';
  if (level === 'LOW') return 'fault-pin-monitor__pin-card--low';
  return 'fault-pin-monitor__pin-card--unknown';
};

const getBadgeTone = (level: GpioPinSnapshot['level']) => {
  if (level === 'HIGH') return 'badge--success';
  if (level === 'LOW') return 'badge--error';
  return 'badge--info';
};

const FaultPinMonitorPage: React.FC = () => {
  const { connected, send } = useSerial();
  const faultPinSnapshot = useRecoilValue(faultPinMonitorState);
  const [warningLights, setWarningLights] = useRecoilState(warningLightsState);
  const setDisplayWindowOpen = useSetRecoilState(displayWindowOpenState);
  const displayOverlays = useRecoilValue(displayOverlayRectsState);
  const voltMonThresholds = useRecoilValue(voltMonThresholdsState);
  const setToast = useSetRecoilState(toastMessageState);
  const [, setIsStreaming] = useState(false);
  const [voltageFaultEnabled, setVoltageFaultEnabled] = useState(false);
  const [videoFreezeEnabled, setVideoFreezeEnabled] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [restartAfterResetPending, setRestartAfterResetPending] = useState(false);
  const startedByPageRef = useRef(false);
  const connectedRef = useRef(connected);
  const restartRequestAtRef = useRef<number | null>(null);
  const restartIntervalRef = useRef<number | null>(null);

  const pins = useMemo(
    () => [faultPinSnapshot.pins.sysFault, faultPinSnapshot.pins.extFault],
    [faultPinSnapshot.pins.extFault, faultPinSnapshot.pins.sysFault]
  );

  const highCount = pins.filter((pin) => pin.level === 'HIGH').length;
  const lowCount = pins.filter((pin) => pin.level === 'LOW').length;
  const activeVoltMonThreshold = voltMonThresholds.find((channel) => channel.channelId === 1) ?? null;
  const vsbPreset = DISPLAY_VSB_PRESETS.find((preset) => preset.slot === VSB_ERROR_SLOT) ?? DISPLAY_VSB_PRESETS[0];
  const isVsbErrorEnabled = useMemo(
    () => warningLights.some((light) => light.id === VSB_ERROR_SLOT && light.isOn)
      || displayOverlays.some((overlay) => Number(overlay.id) === VSB_ERROR_SLOT),
    [displayOverlays, warningLights]
  );

  useEffect(() => {
    if (!activeVoltMonThreshold) return;
    setVoltageFaultEnabled(activeVoltMonThreshold.lowRaw >= 30000);
  }, [activeVoltMonThreshold]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    if (!connected) {
      startedByPageRef.current = false;
      setIsStreaming(false);
      setRestartAfterResetPending(false);
    }
  }, [connected]);

  const clearRestartInterval = useCallback(() => {
    if (restartIntervalRef.current !== null) {
      window.clearInterval(restartIntervalRef.current);
      restartIntervalRef.current = null;
    }
  }, []);

  const startFaultPinStream = useCallback(async (showErrorToast = true) => {
    if (!connectedRef.current) return false;

    const result = await send(FAULT_PIN_STREAM_START_COMMAND);
    if (!result.success) {
      if (showErrorToast) {
        setToast({ type: 'error', message: result.error || 'fault pin stream 시작에 실패했습니다.' });
      }
      return false;
    }

    startedByPageRef.current = true;
    setIsStreaming(true);
    return true;
  }, [send, setToast]);

  useEffect(() => {
    let cancelled = false;

    const startStream = async () => {
      if (!connected || startedByPageRef.current) return;

      const started = await startFaultPinStream();
      if (cancelled) return;
      if (!started) return;
    };

    void startStream();

    return () => {
      cancelled = true;
    };
  }, [connected, startFaultPinStream]);

  useEffect(() => {
    if (!connected) return;

    let retryInterval: number | undefined;

    const ensureStreamAlive = () => {
      const lastStreamUpdatedAt = faultPinSnapshot.lastStreamUpdatedAt;
      const streamAge = lastStreamUpdatedAt ? Date.now() - lastStreamUpdatedAt : Number.POSITIVE_INFINITY;

      if (streamAge > STREAM_STALE_THRESHOLD_MS) {
        void startFaultPinStream(false);
      }
    };

    const initialDelay = window.setTimeout(() => {
      ensureStreamAlive();
      retryInterval = window.setInterval(() => {
        ensureStreamAlive();
      }, STREAM_HEALTHCHECK_INTERVAL_MS);
    }, STREAM_HEALTHCHECK_INITIAL_DELAY_MS);

    return () => {
      window.clearTimeout(initialDelay);
      if (retryInterval !== undefined) {
        window.clearInterval(retryInterval);
      }
    };
  }, [connected, faultPinSnapshot.lastStreamUpdatedAt, startFaultPinStream]);

  useEffect(() => {
    const restartRequestedAt = restartRequestAtRef.current;
    const lastStreamUpdatedAt = faultPinSnapshot.lastStreamUpdatedAt;

    if (
      restartAfterResetPending
      && restartRequestedAt !== null
      && lastStreamUpdatedAt !== null
      && lastStreamUpdatedAt >= restartRequestedAt
    ) {
      restartRequestAtRef.current = null;
      setRestartAfterResetPending(false);
      clearRestartInterval();
    }
  }, [clearRestartInterval, faultPinSnapshot.lastStreamUpdatedAt, restartAfterResetPending]);

  useEffect(() => {
    if (!restartAfterResetPending) {
      clearRestartInterval();
      return;
    }

    if (!connected) {
      clearRestartInterval();
      return;
    }

    if (restartIntervalRef.current !== null) {
      return;
    }

    restartIntervalRef.current = window.setInterval(() => {
      if (!restartAfterResetPending || !connectedRef.current) {
        clearRestartInterval();
        return;
      }

      void startFaultPinStream(false);
    }, STREAM_RESTART_DELAY_MS);

    return () => {
      clearRestartInterval();
    };
  }, [clearRestartInterval, connected, restartAfterResetPending, startFaultPinStream]);

  useEffect(() => {
    return () => {
      clearRestartInterval();
      restartRequestAtRef.current = null;

      if (!startedByPageRef.current || !connectedRef.current) {
        startedByPageRef.current = false;
        return;
      }

      startedByPageRef.current = false;
      void send(FAULT_PIN_STREAM_STOP_COMMAND);
    };
  }, [clearRestartInterval, send]);

  const ensureConnected = useCallback(() => {
    if (connected) return true;
    setToast({ type: 'warning', message: '포트를 먼저 연결해주세요.' });
    return false;
  }, [connected, setToast]);

  const setWarningLightOne = useCallback(async (enabled: boolean) => {
    const nextLights = warningLights.map((light) => (
      light.id === VSB_ERROR_SLOT ? { ...light, isOn: enabled } : light
    ));
    setWarningLights(nextLights);

    const result = await send(`lights ${toLightsMask(nextLights)}`);
    if (!result.success) {
      throw new Error(result.error || '경고등 상태 반영에 실패했습니다.');
    }
  }, [send, setWarningLights, warningLights]);

  const toggleVsbError = useCallback(async () => {
    if (!ensureConnected() || !vsbPreset) return;

    setActionBusyKey('vsb');
    try {
      const nextEnabled = !isVsbErrorEnabled;

      if (nextEnabled) {
        const openResult = await displayWindowService.openHeartbeatWindow();
        if (openResult.status) {
          setDisplayWindowOpen(openResult.status.open);
        }
        if (!openResult.success) {
          setToast({ type: 'error', message: openResult.error || 'Heartbeat 창 열기에 실패했습니다.' });
          return;
        }

        const overlayResult = await displayWindowService.setOverlayRects([buildOverlayInputFromPreset(vsbPreset)]);
        if (overlayResult.status) {
          setDisplayWindowOpen(overlayResult.status.open);
        }
        if (!overlayResult.success) {
          setToast({ type: 'error', message: overlayResult.error || 'VSB 오버레이 반영에 실패했습니다.' });
          return;
        }

        await setWarningLightOne(true);
        setToast({ type: 'success', message: 'VSB 에러 시나리오를 활성화했습니다.' });
        return;
      }

      const clearResult = await displayWindowService.clearOverlayRects();
      if (clearResult.status) {
        setDisplayWindowOpen(clearResult.status.open);
      }
      if (!clearResult.success) {
        setToast({ type: 'error', message: clearResult.error || 'VSB 오버레이 해제에 실패했습니다.' });
        return;
      }

      await setWarningLightOne(false);
      setToast({ type: 'info', message: 'VSB 에러 시나리오를 해제했습니다.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'VSB 에러 토글 처리 중 오류가 발생했습니다.';
      setToast({ type: 'error', message });
    } finally {
      setActionBusyKey(null);
    }
  }, [ensureConnected, isVsbErrorEnabled, setDisplayWindowOpen, setToast, setWarningLightOne, vsbPreset]);

  const toggleVoltageFault = useCallback(async () => {
    if (!ensureConnected()) return;

    setActionBusyKey('voltage');
    try {
      const nextEnabled = !voltageFaultEnabled;
      const command = nextEnabled ? VOLTAGE_FAULT_SET_COMMAND : VOLTAGE_FAULT_CLEAR_COMMAND;
      const result = await send(command);
      if (!result.success) {
        setToast({ type: 'error', message: result.error || '전압 이상 토글 전송에 실패했습니다.' });
        return;
      }

      setVoltageFaultEnabled(nextEnabled);
      setToast({
        type: nextEnabled ? 'warning' : 'info',
        message: nextEnabled ? 'CH1 전압 이상 시나리오를 활성화했습니다.' : 'CH1 전압 이상 시나리오를 해제했습니다.',
      });
    } finally {
      setActionBusyKey(null);
    }
  }, [ensureConnected, send, setToast, voltageFaultEnabled]);

  const triggerAction = useCallback(async (key: string, command: string, successMessage: string) => {
    if (!ensureConnected()) return;

    setActionBusyKey(key);
    try {
      const result = await send(command);
      if (!result.success) {
        setToast({ type: 'error', message: result.error || `${command} 전송에 실패했습니다.` });
        return;
      }

      setToast({ type: 'warning', message: successMessage });
    } finally {
      setActionBusyKey(null);
    }
  }, [ensureConnected, send, setToast]);

  const toggleVideoFreeze = useCallback(async () => {
    if (!ensureConnected()) return;

    setActionBusyKey('video-freeze');
    try {
      const nextEnabled = !videoFreezeEnabled;
      const command = nextEnabled ? VIDEO_FREEZE_COMMAND : VIDEO_FREEZE_CLEAR_COMMAND;
      const result = await send(command);
      if (!result.success) {
        setToast({ type: 'error', message: result.error || 'Video Freeze 명령 전송에 실패했습니다.' });
        return;
      }

      setVideoFreezeEnabled(nextEnabled);
      setToast({
        type: nextEnabled ? 'warning' : 'info',
        message: nextEnabled ? 'Video Freeze fault를 설정했습니다.' : 'Video Freeze fault를 해제했습니다.',
      });
    } finally {
      setActionBusyKey(null);
    }
  }, [ensureConnected, send, setToast, videoFreezeEnabled]);

  const handleWdtFault = useCallback(async () => {
    if (!ensureConnected()) return;

    setActionBusyKey('wdt-fault');
    restartRequestAtRef.current = Date.now();
    startedByPageRef.current = false;
    setIsStreaming(false);
    clearRestartInterval();
    setRestartAfterResetPending(true);

    try {
      const result = await send(WDT_FAULT_COMMAND);
      if (!result.success) {
        restartRequestAtRef.current = null;
        setRestartAfterResetPending(false);
        setToast({ type: 'error', message: result.error || 'WDT Fault 명령 전송에 실패했습니다.' });
        return;
      }

      setToast({ type: 'warning', message: 'WDT Fault를 주입했습니다. MCU reset 후 stream을 자동 재시작합니다.' });
    } finally {
      setActionBusyKey(null);
    }
  }, [clearRestartInterval, ensureConnected, send, setToast]);

  return (
    <div className="fault-pin-monitor">
      <section className="card fault-pin-monitor__hero">
        <div className="fault-pin-monitor__hero-copy">
          <div className="fault-pin-monitor__eyebrow">Fault Pin Level Monitor</div>
          <h2 className="fault-pin-monitor__title">
            <code className="mono">SYS_FAULT</code>
            {' , '}
            <code className="mono">EXT_FAULT</code>
            {' '}디지털 레벨이 실제로 LOW로 떨어지는지 fault 주입과 함께 확인합니다.
          </h2>
          <p className="fault-pin-monitor__description">
            <code className="mono">{FAULT_PIN_STREAM_START_COMMAND}</code>
            {' '}를 페이지 진입 시 자동 시작하고, step chart로 레벨 변화를 계속 추적합니다.
          </p>
        </div>

        <div className={`fault-pin-monitor__hero-status ${connected ? 'fault-pin-monitor__hero-status--connected' : 'fault-pin-monitor__hero-status--disconnected'}`}>
          <span className="fault-pin-monitor__hero-status-dot" />
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </div>
      </section>

      <section className="fault-pin-monitor__top-grid">
        <div className="fault-pin-monitor__pin-grid">
        {pins.map((pin) => (
          <article key={pin.label} className={`card fault-pin-monitor__pin-card ${getLevelTone(pin.level)}`}>
            <div className="fault-pin-monitor__pin-top">
              <div>
                <div className="fault-pin-monitor__pin-label">{pin.label}</div>
                <div className="fault-pin-monitor__pin-time">{formatUpdatedAt(pin.updatedAt)}</div>
              </div>
              <span className={`badge ${getBadgeTone(pin.level)}`}>{pin.level}</span>
            </div>

            <div className="fault-pin-monitor__pin-state">{pin.level}</div>
            <div className="fault-pin-monitor__pin-source">{pin.source || '로그 대기 중'}</div>
          </article>
        ))}
        </div>

        <section className="card fault-pin-monitor__action-card">
          <div className="card__header">
            <div>
              <div className="card__title">Fault Actions</div>
              <div className="fault-pin-monitor__chart-note">
                작은 토글/트리거로 fault를 주입하고 SYS/EXT FAULT가 LOW로 떨어지는지 바로 확인합니다.
              </div>
            </div>
            <span className={`badge ${lowCount > 0 ? 'badge--warning' : 'badge--success'}`}>
              {lowCount > 0 ? `${lowCount} Low` : `${highCount} High`}
            </span>
          </div>

          <div className="fault-pin-monitor__action-grid">
            <button
              className={`fault-pin-monitor__action-btn ${isVsbErrorEnabled ? 'fault-pin-monitor__action-btn--active' : ''}`}
              type="button"
              onClick={toggleVsbError}
              disabled={actionBusyKey !== null}
            >
              <span>VSB Error</span>
              <small>Light 01 + VSB 01</small>
            </button>

            <button
              className={`fault-pin-monitor__action-btn ${voltageFaultEnabled ? 'fault-pin-monitor__action-btn--active' : ''}`}
              type="button"
              onClick={toggleVoltageFault}
              disabled={actionBusyKey !== null}
            >
              <span>Voltage Fault</span>
              <small>CH1 under-range toggle</small>
            </button>

            <button
              className={`fault-pin-monitor__action-btn ${videoFreezeEnabled ? 'fault-pin-monitor__action-btn--active' : ''}`}
              type="button"
              onClick={toggleVideoFreeze}
              disabled={actionBusyKey !== null}
            >
              <span>Video Freeze</span>
              <small>bit16 set / clear</small>
            </button>

            <button
              className="fault-pin-monitor__action-btn fault-pin-monitor__action-btn--danger"
              type="button"
              onClick={() => void triggerAction('ecc', RAM_ECC_COMMAND, 'RAM ECC fault를 주입했습니다.')}
              disabled={actionBusyKey !== null}
            >
              <span>RAM ECC</span>
              <small>one-shot inject</small>
            </button>

            <button
              className="fault-pin-monitor__action-btn fault-pin-monitor__action-btn--danger"
              type="button"
              onClick={() => void handleWdtFault()}
              disabled={actionBusyKey !== null}
            >
              <span>WDT Fault</span>
              <small>reset 후 stream restart</small>
            </button>
          </div>
        </section>
      </section>

      <section className="card fault-pin-monitor__chart-card">
        <div className="card__header">
          <div>
            <div className="card__title">Fault Pin Digital Level</div>
            <div className="fault-pin-monitor__chart-note">
              HIGH=1, LOW=0 기준으로 최근 10초 구간을 step chart로 표시합니다.
            </div>
          </div>
        </div>

        <div className="fault-pin-monitor__legend">
          <span className="fault-pin-monitor__legend-item">
            <span className="fault-pin-monitor__legend-dot" style={{ background: '#f97316' }} />
            SYS_FAULT
          </span>
          <span className="fault-pin-monitor__legend-item">
            <span className="fault-pin-monitor__legend-dot" style={{ background: '#22c55e' }} />
            EXT_FAULT
          </span>
        </div>

        <div className="fault-pin-monitor__chart-wrap">
          <FaultPinLevelChart
            connected={connected}
            channels={[
              { color: '#f97316', key: 'sysFault', label: 'SYS_FAULT' },
              { color: '#22c55e', key: 'extFault', label: 'EXT_FAULT' },
            ]}
          />
        </div>
      </section>
    </div>
  );
};

export default FaultPinMonitorPage;
