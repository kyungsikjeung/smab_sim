import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useSerial } from 'hooks/useSerial';
import { gpioMonitorState, toastMessageState } from 'state/atoms';
import { GpioPinSnapshot } from 'types';
import './GpioMonitor.css';

const DEFAULT_INTERVAL_MS = '1000';
const GPIO_STATUS_COMMAND = 'gpio_status';

const parseIntervalValue = (value: string): number | null => {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const formatUpdatedAt = (timestamp: number | null) => {
  if (!timestamp) return '미수신';

  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour12: false,
  });
};

const isHealthyInputStatus = (statusText: string | null) => {
  const normalized = statusText?.trim().toUpperCase();
  return normalized === 'NORMAL' || normalized === 'OK' || normalized === 'CLEAR';
};

const getLevelBadgeTone = (level: GpioPinSnapshot['level']) => {
  if (level === 'HIGH') return 'badge--success';
  if (level === 'LOW') return 'badge--warning';
  return 'badge--info';
};

const getSignalCardTone = (pin: GpioPinSnapshot, isInput = false) => {
  if (pin.level === 'UNKNOWN') return 'gpio-monitor__signal-card--idle';
  if (isInput) {
    return isHealthyInputStatus(pin.statusText)
      ? 'gpio-monitor__signal-card--healthy'
      : 'gpio-monitor__signal-card--alert';
  }

  return pin.level === 'HIGH'
    ? 'gpio-monitor__signal-card--healthy'
    : 'gpio-monitor__signal-card--alert';
};

const getInputStatusBadgeTone = (statusText: string | null) => {
  if (!statusText) return 'badge--info';
  return isHealthyInputStatus(statusText) ? 'badge--success' : 'badge--error';
};

const getOutputStateLabel = (level: GpioPinSnapshot['level']) => {
  if (level === 'HIGH') return 'NORMAL';
  if (level === 'LOW') return 'FAULT';
  return 'UNKNOWN';
};

const getOutputStateBadgeTone = (level: GpioPinSnapshot['level']) => {
  if (level === 'HIGH') return 'badge--success';
  if (level === 'LOW') return 'badge--error';
  return 'badge--info';
};

const GpioMonitorPage: React.FC = () => {
  const { connected, send } = useSerial();
  const gpioSnapshot = useRecoilValue(gpioMonitorState);
  const setToast = useSetRecoilState(toastMessageState);

  const [intervalInput, setIntervalInput] = useState(DEFAULT_INTERVAL_MS);
  const [continuousMonitoring, setContinuousMonitoring] = useState(false);
  const requestInFlightRef = useRef(false);

  const monitoringIntervalMs = parseIntervalValue(intervalInput);

  const outputPins = useMemo(
    () => [gpioSnapshot.outputs.sysFault, gpioSnapshot.outputs.extFault],
    [gpioSnapshot.outputs.extFault, gpioSnapshot.outputs.sysFault]
  );
  const inputPins = useMemo(
    () => [
      gpioSnapshot.inputs.gmslTpDesLock,
      gpioSnapshot.inputs.lcdFail,
      gpioSnapshot.inputs.ledFail,
    ],
    [gpioSnapshot.inputs.gmslTpDesLock, gpioSnapshot.inputs.lcdFail, gpioSnapshot.inputs.ledFail]
  );

  const outputLowCount = outputPins.filter((pin) => pin.level === 'LOW').length;
  const inputAlertCount = inputPins.filter((pin) => pin.statusText && !isHealthyInputStatus(pin.statusText)).length;
  const commandBytesText = gpioSnapshot.lastCommandBytes?.bytes.join(' ') || '--';

  const requestGpioStatus = useCallback(async () => {
    if (!connected || requestInFlightRef.current) return;

    requestInFlightRef.current = true;
    try {
      const result = await send(GPIO_STATUS_COMMAND);
      if (!result.success) {
        setToast({ type: 'error', message: result.error || 'gpio_status 전송에 실패했습니다.' });
      }
    } finally {
      requestInFlightRef.current = false;
    }
  }, [connected, send, setToast]);

  const handleReadOnce = useCallback(() => {
    if (!connected) {
      setToast({ type: 'warning', message: '포트를 먼저 연결해주세요.' });
      return;
    }

    void requestGpioStatus();
  }, [connected, requestGpioStatus, setToast]);

  const handleStartContinuous = useCallback(() => {
    if (!connected) {
      setToast({ type: 'warning', message: '포트를 먼저 연결해주세요.' });
      return;
    }

    if (monitoringIntervalMs === null) {
      setToast({ type: 'warning', message: '모니터링 주기를 1ms 이상의 숫자로 입력해주세요.' });
      return;
    }

    setContinuousMonitoring(true);
  }, [connected, monitoringIntervalMs, setToast]);

  const handleStopContinuous = useCallback(() => {
    setContinuousMonitoring(false);
  }, []);

  useEffect(() => {
    if (!connected && continuousMonitoring) {
      setContinuousMonitoring(false);
    }
  }, [connected, continuousMonitoring]);

  useEffect(() => {
    if (continuousMonitoring && monitoringIntervalMs === null) {
      setContinuousMonitoring(false);
      setToast({ type: 'warning', message: '모니터링 주기를 다시 확인해주세요.' });
    }
  }, [continuousMonitoring, monitoringIntervalMs, setToast]);

  useEffect(() => {
    if (!continuousMonitoring || !connected || monitoringIntervalMs === null) return undefined;

    void requestGpioStatus();
    const intervalId = window.setInterval(() => {
      void requestGpioStatus();
    }, monitoringIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [connected, continuousMonitoring, monitoringIntervalMs, requestGpioStatus]);

  useEffect(() => {
    if (!connected || gpioSnapshot.lastUpdatedAt) return;
    void requestGpioStatus();
  }, [connected, gpioSnapshot.lastUpdatedAt, requestGpioStatus]);

  return (
    <div className="gpio-monitor">
      <section className="card gpio-monitor__hero">
        <div className="gpio-monitor__hero-copy">
          <div className="gpio-monitor__eyebrow">GPIO Status Monitor</div>
          <h2 className="gpio-monitor__title">
            입력/출력 핀 상태를
            {' '}
            <code className="mono">gpio_status</code>
            {' '}로그 기준으로 한눈에 확인합니다.
          </h2>
          <p className="gpio-monitor__description">
            RX 로그에서
            {' '}
            <code className="mono">[OUT]</code>
            ,
            {' '}
            <code className="mono">[IN ]</code>
            ,
            {' '}
            <code className="mono">[CMD0x06]</code>
            {' '}라인을 바로 파싱해 출력합니다.
          </p>
        </div>

        <div className={`gpio-monitor__hero-status ${connected ? 'gpio-monitor__hero-status--connected' : 'gpio-monitor__hero-status--disconnected'}`}>
          <span className="gpio-monitor__hero-status-dot" />
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </div>
      </section>

      <section className="card gpio-monitor__toolbar">
        <div className="gpio-monitor__toolbar-copy">
          <div className="gpio-monitor__toolbar-title">실시간 수집 제어</div>
          <div className="gpio-monitor__toolbar-text">
            기본 커맨드:
            {' '}
            <code className="mono">{GPIO_STATUS_COMMAND}</code>
          </div>
        </div>

        <div className="gpio-monitor__toolbar-actions">
          <label className="gpio-monitor__field">
            <span>Polling (ms)</span>
            <input
              className="input mono"
              type="text"
              value={intervalInput}
              onChange={(event) => setIntervalInput(event.target.value)}
              inputMode="numeric"
              placeholder="1000"
            />
          </label>

          <button className="btn btn--secondary" type="button" onClick={handleReadOnce} disabled={!connected}>
            Read Once
          </button>

          {continuousMonitoring ? (
            <button className="btn btn--danger" type="button" onClick={handleStopContinuous}>
              Stop
            </button>
          ) : (
            <button className="btn btn--primary" type="button" onClick={handleStartContinuous} disabled={!connected}>
              Start Polling
            </button>
          )}
        </div>
      </section>

      <section className="gpio-monitor__stats">
        <article className="card gpio-monitor__stat-card">
          <div className="gpio-monitor__stat-label">마지막 수신</div>
          <strong>{formatUpdatedAt(gpioSnapshot.lastUpdatedAt)}</strong>
          <span>{continuousMonitoring ? 'Polling Active' : 'Manual Mode'}</span>
        </article>

        <article className="card gpio-monitor__stat-card">
          <div className="gpio-monitor__stat-label">헤더 감지</div>
          <strong>{formatUpdatedAt(gpioSnapshot.lastHeaderSeenAt)}</strong>
          <span>GPIO Status Header</span>
        </article>

        <article className="card gpio-monitor__stat-card">
          <div className="gpio-monitor__stat-label">출력 LOW</div>
          <strong>{outputLowCount}</strong>
          <span>{outputPins.length} outputs tracked</span>
        </article>

        <article className="card gpio-monitor__stat-card">
          <div className="gpio-monitor__stat-label">입력 Alert</div>
          <strong>{inputAlertCount}</strong>
          <span>{inputPins.length} inputs tracked</span>
        </article>
      </section>

      <div className="gpio-monitor__content-grid">
        <section className="card gpio-monitor__panel">
          <div className="card__header gpio-monitor__panel-header">
            <div>
              <div className="card__title">출력 핀</div>
              <div className="gpio-monitor__panel-text">SYS_FAULT / EXT_FAULT 레벨을 즉시 확인합니다.</div>
            </div>
            <span className="badge badge--info">Output</span>
          </div>

          <div className="gpio-monitor__signal-grid">
            {outputPins.map((pin) => (
              <article key={pin.label} className={`gpio-monitor__signal-card ${getSignalCardTone(pin)}`}>
                <div className="gpio-monitor__signal-top">
                  <div className="gpio-monitor__signal-heading">
                    <div className="gpio-monitor__signal-label">{pin.label}</div>
                    <div className="gpio-monitor__signal-time">{formatUpdatedAt(pin.updatedAt)}</div>
                  </div>
                  <div className="gpio-monitor__signal-badges">
                    <span className={`badge ${getLevelBadgeTone(pin.level)}`}>{pin.level}</span>
                    <span className={`badge ${getOutputStateBadgeTone(pin.level)}`}>{getOutputStateLabel(pin.level)}</span>
                  </div>
                </div>

                <div className="gpio-monitor__signal-source mono">
                  {pin.source || '아직 수신된 raw line이 없습니다.'}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card gpio-monitor__panel">
          <div className="card__header gpio-monitor__panel-header">
            <div>
              <div className="card__title">입력 핀</div>
              <div className="gpio-monitor__panel-text">GMSL / LCD / LED 입력과 상태 텍스트를 함께 표시합니다.</div>
            </div>
            <span className="badge badge--warning">Input</span>
          </div>

          <div className="gpio-monitor__signal-grid">
            {inputPins.map((pin) => (
              <article key={pin.label} className={`gpio-monitor__signal-card ${getSignalCardTone(pin, true)}`}>
                <div className="gpio-monitor__signal-top">
                  <div className="gpio-monitor__signal-heading">
                    <div className="gpio-monitor__signal-label">{pin.label}</div>
                    <div className="gpio-monitor__signal-time">{formatUpdatedAt(pin.updatedAt)}</div>
                  </div>
                  <div className="gpio-monitor__signal-badges">
                    <span className={`badge ${getLevelBadgeTone(pin.level)}`}>{pin.level}</span>
                    <span className={`badge ${getInputStatusBadgeTone(pin.statusText)}`}>
                      {pin.statusText || 'UNKNOWN'}
                    </span>
                  </div>
                </div>

                <div className="gpio-monitor__signal-source mono">
                  {pin.source || '아직 수신된 raw line이 없습니다.'}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="gpio-monitor__meta-grid">
        <article className="card gpio-monitor__meta-card">
          <div className="gpio-monitor__meta-label">마지막 CMD 바이트</div>
          <div className="gpio-monitor__meta-value mono">{commandBytesText}</div>
          <div className="gpio-monitor__meta-sub">
            {gpioSnapshot.lastCommandBytes
              ? `${gpioSnapshot.lastCommandBytes.commandId} · ${formatUpdatedAt(gpioSnapshot.lastCommandBytes.updatedAt)}`
              : 'CMD 바이트 미수신'}
          </div>
          <div className="gpio-monitor__meta-source mono">
            {gpioSnapshot.lastCommandBytes?.raw || '  [CMD0x06] bytes : ...'}
          </div>
        </article>

        <article className="card gpio-monitor__meta-card">
          <div className="gpio-monitor__meta-label">최근 스냅샷 타임라인</div>
          <div className="gpio-monitor__timeline">
            <div className="gpio-monitor__timeline-row">
              <span>Last Update</span>
              <strong>{formatUpdatedAt(gpioSnapshot.lastUpdatedAt)}</strong>
            </div>
            <div className="gpio-monitor__timeline-row">
              <span>Header Seen</span>
              <strong>{formatUpdatedAt(gpioSnapshot.lastHeaderSeenAt)}</strong>
            </div>
            <div className="gpio-monitor__timeline-row">
              <span>Polling</span>
              <strong>{continuousMonitoring ? `${monitoringIntervalMs || '--'} ms` : 'Off'}</strong>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
};

export default GpioMonitorPage;
