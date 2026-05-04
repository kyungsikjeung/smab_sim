import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { errorFlagDefinitions } from 'data/errorFlagDefinitions';
import { useSerial } from 'hooks/useSerial';
import {
  errorFlagLatestState,
  toastMessageState,
} from 'state/atoms';
import { ErrorFlagBitStatus } from 'types';
import './ErrorMonitor.css';

const DEFAULT_INTERVAL_MS = '1000';
const ERROR_READ_COMMAND = 'error read';

const formatBit = (bit: number) => `BIT ${String(bit).padStart(2, '0')}`;
const formatMask = (mask: number) => `0x${mask.toString(16).toUpperCase().padStart(8, '0')}`;
const formatBitRange = (startBit: number, endBit: number) =>
  `BIT ${String(startBit).padStart(2, '0')}-${String(endBit).padStart(2, '0')}`;

interface ChangedFlag {
  bit: number;
  currentValue: 0 | 1;
  meaning: string;
  name: string;
  previousValue: 0 | 1;
}

type IconProps = {
  className?: string;
};

const ShieldIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3 5 6v5.6c0 4.6 3 8.85 7 9.9 4-1.05 7-5.3 7-9.9V6l-7-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m9.3 12.2 1.9 1.9 3.7-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PulseIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 12h4l2.2-4.4L13 17l2.2-5H21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const parseIntervalValue = (value: string): number | null => {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const ErrorMonitorPage: React.FC = () => {
  const { connected, send } = useSerial();
  const latestSnapshot = useRecoilValue(errorFlagLatestState);
  const setToast = useSetRecoilState(toastMessageState);

  const [intervalInput, setIntervalInput] = useState(DEFAULT_INTERVAL_MS);
  const [continuousMonitoring, setContinuousMonitoring] = useState(false);
  const requestInFlightRef = useRef(false);
  const previousFlagsRef = useRef<number | null>(null);
  const hasLiveSnapshot = !!latestSnapshot;
  const [changedFlags, setChangedFlags] = useState<ChangedFlag[]>([]);
  const displayFlags = latestSnapshot?.flags ?? 0;

  const monitoringIntervalMs = parseIntervalValue(intervalInput);

  const requestErrorRead = useCallback(async () => {
    if (!connected || requestInFlightRef.current) return;

    requestInFlightRef.current = true;
    try {
      const result = await send(ERROR_READ_COMMAND);
      if (!result.success) {
        setToast({ type: 'error', message: result.error || 'error read 전송 실패' });
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

    void requestErrorRead();
  }, [connected, requestErrorRead, setToast]);

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

    void requestErrorRead();
    const intervalId = window.setInterval(() => {
      void requestErrorRead();
    }, monitoringIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [connected, continuousMonitoring, monitoringIntervalMs, requestErrorRead]);

  useEffect(() => {
    if (!latestSnapshot) {
      previousFlagsRef.current = null;
      setChangedFlags([]);
      return;
    }

    const previousFlags = previousFlagsRef.current;
    const currentFlags = latestSnapshot.flags >>> 0;

    if (previousFlags === null) {
      previousFlagsRef.current = currentFlags;
      setChangedFlags([]);
      return;
    }

    const nextChangedFlags = errorFlagDefinitions
      .map((definition) => {
        const previousValue = ((previousFlags >>> definition.bit) & 0x1) as 0 | 1;
        const currentValue = ((currentFlags >>> definition.bit) & 0x1) as 0 | 1;
        if (previousValue === currentValue) return null;

        return {
          bit: definition.bit,
          currentValue,
          meaning: definition.meaning,
          name: definition.name,
          previousValue,
        } as ChangedFlag;
      })
      .filter((entry): entry is ChangedFlag => entry !== null);

    previousFlagsRef.current = currentFlags;
    setChangedFlags(nextChangedFlags);

    if (nextChangedFlags.length > 0) {
      const firstChange = nextChangedFlags[0];
      const message = nextChangedFlags.length === 1
        ? `${firstChange.name} ${firstChange.previousValue} -> ${firstChange.currentValue}`
        : `${firstChange.name} 포함 ${nextChangedFlags.length}개 비트 변경`;
      setToast({ type: 'info', message: `에러 플래그 변경 감지: ${message}` });
    }
  }, [latestSnapshot, setToast]);

  const decodedFlags = useMemo<ErrorFlagBitStatus[]>(() => {
    return errorFlagDefinitions.map((definition) => {
      const value = ((displayFlags >>> definition.bit) & 0x1) as 0 | 1;

      return {
        ...definition,
        value,
        isError: value === 1,
      };
    });
  }, [displayFlags]);

  const activeFlags = useMemo(
    () => decodedFlags.filter((flag) => flag.isError),
    [decodedFlags]
  );

  const raisedFlags = useMemo(
    () => changedFlags.filter((flag) => flag.currentValue === 1),
    [changedFlags]
  );

  const recoveredFlags = useMemo(
    () => changedFlags.filter((flag) => flag.currentValue === 0),
    [changedFlags]
  );

  const flagLookup = useMemo(
    () => new Map(decodedFlags.map((flag) => [flag.bit, flag])),
    [decodedFlags]
  );

  const bitGridGroups = useMemo(() => {
    return Array.from({ length: 4 }, (_, groupIndex) => {
      const lowBit = groupIndex * 8;
      const highBit = lowBit + 7;
      const flags = Array.from({ length: 8 }, (_, columnIndex) => flagLookup.get(lowBit + columnIndex))
        .filter((flag): flag is ErrorFlagBitStatus => flag !== undefined);

      return {
        flags,
        key: `${highBit}-${lowBit}`,
        label: formatBitRange(lowBit, highBit),
      };
    });
  }, [displayFlags, flagLookup]);

  return (
    <div className="error-monitor">
      <section className="card error-monitor__hero">
        <div className="error-monitor__hero-top">
          <div className="error-monitor__hero-copy">
            <div className="error-monitor__eyebrow">Fault Overview</div>
            <div className="card__title">Error Read Monitor</div>
          </div>

          <div className={`error-monitor__mode-pill ${continuousMonitoring ? 'error-monitor__mode-pill--live' : 'error-monitor__mode-pill--idle'}`}>
            <PulseIcon className="error-monitor__mode-icon" />
            {continuousMonitoring ? 'Monitoring' : 'Idle'}
          </div>
        </div>

        <div className="error-monitor__toolbar">
          <div className="error-monitor__toolbar-group">
            <div className="error-monitor__command-box">
              <span className="error-monitor__toolbar-label">Command</span>
              <code className="error-monitor__command-value">{ERROR_READ_COMMAND}</code>
            </div>

            <label className="error-monitor__interval-field">
              <span className="error-monitor__toolbar-label">Interval (ms)</span>
              <input
                className="input error-monitor__interval-input"
                value={intervalInput}
                onChange={(event) => setIntervalInput(event.target.value)}
                inputMode="numeric"
                placeholder="1000"
              />
            </label>
          </div>

          <div className="error-monitor__toolbar-actions">
            <button className="btn btn--primary" onClick={handleReadOnce} disabled={!connected} type="button">
              Read Once
            </button>
            {continuousMonitoring ? (
              <button className="btn btn--danger" onClick={handleStopContinuous} type="button">
                Stop
              </button>
            ) : (
              <button className="btn btn--secondary" onClick={handleStartContinuous} disabled={!connected} type="button">
                Start Continuous
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="error-monitor__content-grid">
        <section className="card error-monitor__register-panel">
          <div className="card__header">
            <div className="card__title">Fault Register</div>
            <div className="error-monitor__legend">
              <span className="error-monitor__legend-item error-monitor__legend-item--error">Error</span>
              <span className="error-monitor__legend-item error-monitor__legend-item--normal">Normal</span>
            </div>
          </div>

          <div className="error-monitor__bit-matrix-scroll">
            <div className="error-monitor__bit-matrix">
              {bitGridGroups.map((group) => (
                <div key={group.key} className="error-monitor__bit-group">
                  <div className="error-monitor__bit-group-head">
                    <span className="error-monitor__bit-row-label">{group.label}</span>
                  </div>
                  <div className="error-monitor__bit-name-grid">
                    {group.flags.map((flag) => {
                      const toneClass = flag.value === 1
                        ? 'error-monitor__bit-name-cell--error'
                        : 'error-monitor__bit-name-cell--normal';

                      return (
                        <div
                          key={`name-${flag.bit}`}
                          className={[
                            'error-monitor__bit-name-cell',
                            toneClass,
                          ].filter(Boolean).join(' ')}
                          title={`${formatBit(flag.bit)} · ${flag.name}`}
                        >
                          <div className="error-monitor__bit-name-text">{flag.meaning}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="error-monitor__bit-value-grid">
                    {group.flags.map((flag) => {
                      const valueClass = flag.value === 1
                        ? 'error-monitor__bit-value-cell--error'
                        : 'error-monitor__bit-value-cell--normal';

                      return (
                        <div
                          key={`value-${flag.bit}`}
                          className={[
                            'error-monitor__bit-value-cell',
                            valueClass,
                          ].filter(Boolean).join(' ')}
                          title={`${formatBit(flag.bit)} · ${flag.name} · ${formatMask(flag.mask)}`}
                        >
                          <div className="error-monitor__bit-value-number mono">
                            {flag.value === null ? '-' : flag.value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="error-monitor__side-stack">
          <section className="card error-monitor__faults-panel">
            <div className="card__header">
              <div>
                <div className="card__title">Active Errors</div>
                <div className="error-monitor__section-note">현재 에러 상태인 비트만 모아 표시합니다.</div>
              </div>
              <div className={`badge ${activeFlags.length > 0 ? 'badge--error' : 'badge--success'}`}>
                {activeFlags.length > 0 ? `${activeFlags.length} Active` : 'None'}
              </div>
            </div>

            {activeFlags.length === 0 ? (
              <div className="error-monitor__safe-state">
                <div className="error-monitor__safe-icon">
                  <ShieldIcon className="error-monitor__health-svg" />
                </div>
                <div className="error-monitor__safe-title">
                  {hasLiveSnapshot ? '활성 에러 없음' : '기본값 0으로 표시 중'}
                </div>
                <div className="error-monitor__safe-text">
                  {hasLiveSnapshot
                    ? '마지막 스냅샷 기준으로 모든 비트가 정상 상태입니다.'
                    : '시리얼 연결 전에는 모든 비트를 0으로 표시하고, Read 이후 실데이터로 갱신합니다.'}
                </div>
              </div>
            ) : (
              <div className="error-monitor__active-list">
                {activeFlags.map((flag) => (
                  <div key={flag.bit} className="error-monitor__active-item">
                    <div className="error-monitor__active-item-top">
                      <span className="error-monitor__flag-bit">{formatBit(flag.bit)}</span>
                      <span className="badge badge--error">Error</span>
                    </div>
                    <div className="error-monitor__active-item-title">{flag.meaning}</div>
                    <div className="error-monitor__active-item-subtitle">{flag.name}</div>
                    <div className="error-monitor__active-item-meta mono">{formatMask(flag.mask)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card error-monitor__changes-panel">
            <div className="card__header">
              <div>
                <div className="card__title">Recent Changes</div>
                <div className="error-monitor__section-note">직전 응답과 비교한 변경 비트입니다.</div>
              </div>
              <div className="error-monitor__change-summary">
                <span className="badge badge--error">Raised {raisedFlags.length}</span>
                <span className="badge badge--success">Recovered {recoveredFlags.length}</span>
              </div>
            </div>

            {!hasLiveSnapshot ? (
              <div className="error-monitor__empty">
                첫 Read 이후부터 변경 비트를 표시합니다.
              </div>
            ) : changedFlags.length === 0 ? (
              <div className="error-monitor__empty">
                직전 수신값과 비교했을 때 변경된 비트가 없습니다.
              </div>
            ) : (
              <div className="error-monitor__changes-list">
                {changedFlags.map((flag) => (
                  <div
                    key={flag.bit}
                    className={`error-monitor__change-item ${flag.currentValue === 1 ? 'error-monitor__change-item--error' : 'error-monitor__change-item--normal'}`}
                  >
                    <div className="error-monitor__change-top">
                      <span className="error-monitor__flag-bit">{formatBit(flag.bit)}</span>
                      <span className={`badge ${flag.currentValue === 1 ? 'badge--error' : 'badge--success'}`}>
                        {flag.currentValue === 1 ? 'Raised' : 'Recovered'}
                      </span>
                    </div>
                    <div className="error-monitor__change-title">{flag.meaning}</div>
                    <div className="error-monitor__change-subtitle">{flag.name}</div>
                    <div className="error-monitor__change-values mono">
                      {flag.previousValue} -&gt; {flag.currentValue}
                      {' · '}
                      {formatMask(flagLookup.get(flag.bit)?.mask ?? 0)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ErrorMonitorPage;
