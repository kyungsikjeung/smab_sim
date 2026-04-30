import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useSerial } from 'hooks/useSerial';
import {
  toastMessageState,
  voltMonThresholdsState,
  voltageChannelsState,
} from 'state/atoms';
import { VoltMonThresholdChannel } from 'types';
import './FaultInjection.css';

type FaultSectionKey = 'adc' | 'wdg' | 'ecc' | 'rohmFw';

interface ChannelDraft {
  high: string;
  low: string;
}

type ChannelDraftMap = Record<number, ChannelDraft>;

const MAX_VOLTAGE = 3.3;
const MIN_VOLTAGE = 0;
const VOLT_MON_READ_COMMAND = 'voltmon read';
const WATCHDOG_INJECT_COMMAND = 'wdt_fault inject';
const ECC_DOUBLE_ERROR_COMMAND = 'lram_ecc_inj der';
const ROHM_FW_CHECKSUM_INJECT_COMMAND = 'rohm_fw fault';
const WATCHDOG_BUSY_HOLD_MS = 250;
const ECC_BUSY_HOLD_MS = 250;
const ROHM_FW_BUSY_HOLD_MS = 1000;
const DEFAULT_RANGE = { low: '0.00', high: '3.30' };

const buildDraftsFromThresholds = (
  thresholds: VoltMonThresholdChannel[]
): ChannelDraftMap => (
  thresholds.reduce<ChannelDraftMap>((acc, channel) => {
    acc[channel.channelId] = {
      high: channel.highVoltage.toFixed(2),
      low: channel.lowVoltage.toFixed(2),
    };
    return acc;
  }, {})
);

const formatVoltage = (value: number | null, digits = 2) => {
  if (value === null || Number.isNaN(value)) return '--';
  return value.toFixed(digits);
};

const formatUpdatedAt = (timestamp: number | null) => {
  if (!timestamp) return '미동기화';

  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour12: false,
  });
};

const parseVoltageInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return null;
  if (parsed < MIN_VOLTAGE || parsed > MAX_VOLTAGE) return null;

  return Math.round(parsed * 100) / 100;
};

const toRawVoltMonValue = (value: number) => Math.round(value * 10000);

const deriveRangeStatus = (rawAdc: number | null, lowRaw: number, highRaw: number, fallbackText = 'UNKNOWN') => {
  if (rawAdc === null || !Number.isFinite(rawAdc)) {
    return { state: null as number | null, statusText: fallbackText };
  }

  if (rawAdc < lowRaw) {
    return { state: 1, statusText: 'UNDER' };
  }

  if (rawAdc > highRaw) {
    return { state: 2, statusText: 'OVER' };
  }

  return { state: 0, statusText: 'OK' };
};

const FaultInjectionPage: React.FC = () => {
  const { connected, send } = useSerial();
  const voltMonThresholds = useRecoilValue(voltMonThresholdsState);
  const voltageChannels = useRecoilValue(voltageChannelsState);
  const setVoltMonThresholds = useSetRecoilState(voltMonThresholdsState);
  const setToast = useSetRecoilState(toastMessageState);

  const [expandedSections, setExpandedSections] = useState<Record<FaultSectionKey, boolean>>({
    adc: false,
    wdg: false,
    ecc: false,
    rohmFw: false,
  });
  const [channelDrafts, setChannelDrafts] = useState<ChannelDraftMap>(() => buildDraftsFromThresholds(voltMonThresholds));
  const [bulkRange, setBulkRange] = useState(DEFAULT_RANGE);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [watchdogBusy, setWatchdogBusy] = useState(false);
  const [eccBusy, setEccBusy] = useState(false);
  const [rohmChecksumBusy, setRohmChecksumBusy] = useState(false);
  const [draftSyncSuspended, setDraftSyncSuspended] = useState(false);
  const mountedRef = useRef(true);
  const voltMonReadInFlightRef = useRef(false);
  const voltMonAutoSyncDoneRef = useRef(false);
  const rohmChecksumBusyTimerRef = useRef<number | null>(null);

  const setBusyKeySafely = useCallback((nextBusyKey: string | null) => {
    if (!mountedRef.current) return;
    setBusyKey(nextBusyKey);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      voltMonReadInFlightRef.current = false;
      if (rohmChecksumBusyTimerRef.current !== null) {
        window.clearTimeout(rohmChecksumBusyTimerRef.current);
        rohmChecksumBusyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (draftSyncSuspended) return;
    setChannelDrafts(buildDraftsFromThresholds(voltMonThresholds));
  }, [draftSyncSuspended, voltMonThresholds]);

  const adcChannels = useMemo(() => {
    const liveMap = new Map(voltageChannels.map((channel) => [channel.id, channel.currentValue]));

    return voltMonThresholds.map((channel) => ({
      ...channel,
      liveVoltage: liveMap.get(channel.channelId) ?? channel.currentVoltage,
    }));
  }, [voltMonThresholds, voltageChannels]);

  const ensureConnected = useCallback(() => {
    if (connected) return true;

    setToast({ type: 'warning', message: '포트를 먼저 연결해주세요.' });
    return false;
  }, [connected, setToast]);

  const syncThresholdLocally = useCallback((channelId: number, lowVoltage: number, highVoltage: number) => {
    const lowRaw = toRawVoltMonValue(lowVoltage);
    const highRaw = toRawVoltMonValue(highVoltage);

    setVoltMonThresholds((prev) =>
      prev.map((channel) => {
        if (channel.channelId !== channelId) return channel;

        const nextState = deriveRangeStatus(channel.rawAdc, lowRaw, highRaw, channel.statusText);

        return {
          ...channel,
          highRaw,
          highVoltage,
          lowRaw,
          lowVoltage,
          state: nextState.state,
          statusText: nextState.statusText,
          updatedAt: Date.now(),
        };
      })
    );
  }, [setVoltMonThresholds]);

  const requestVoltMonThresholds = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!connected) {
      if (!silent) {
        setToast({ type: 'warning', message: '포트를 먼저 연결해주세요.' });
      }
      return null;
    }

    if (voltMonReadInFlightRef.current) {
      return null;
    }

    voltMonReadInFlightRef.current = true;
    setBusyKeySafely('adc-sync');

    try {
      const result = await send(VOLT_MON_READ_COMMAND);
      if (!result.success) {
        if (!silent) {
          setToast({ type: 'error', message: result.error || '현재 threshold 동기화에 실패했습니다.' });
        }
        return result;
      }

      if (!silent) {
        setToast({ type: 'info', message: '현재 threshold 동기화를 요청했습니다.' });
      }

      return result;
    } finally {
      voltMonReadInFlightRef.current = false;
      setBusyKeySafely(null);
    }
  }, [connected, send, setBusyKeySafely, setToast]);

  const toggleSection = useCallback((key: FaultSectionKey) => {
    const willOpen = !expandedSections[key];

    setExpandedSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));

    if (key !== 'adc' || !willOpen || !connected || voltMonAutoSyncDoneRef.current) {
      return;
    }

    voltMonAutoSyncDoneRef.current = true;
    setDraftSyncSuspended(false);
    void requestVoltMonThresholds({ silent: true });
  }, [connected, expandedSections, requestVoltMonThresholds]);

  const handleUpdateVoltMonSettings = useCallback(() => {
    setDraftSyncSuspended(false);
    void requestVoltMonThresholds();
  }, [requestVoltMonThresholds]);

  const updateChannelDraft = useCallback((channelId: number, key: keyof ChannelDraft, value: string) => {
    setDraftSyncSuspended(true);
    setChannelDrafts((prev) => ({
      ...prev,
      [channelId]: {
        ...(prev[channelId] || DEFAULT_RANGE),
        [key]: value,
      },
    }));
  }, []);

  const validateRange = useCallback((lowInput: string, highInput: string) => {
    const lowVoltage = parseVoltageInput(lowInput);
    const highVoltage = parseVoltageInput(highInput);

    if (lowVoltage === null || highVoltage === null) {
      setToast({ type: 'warning', message: '전압 값은 0.00V ~ 3.30V 범위에서 소수 둘째 자리까지 입력해주세요.' });
      return null;
    }

    if (lowVoltage > highVoltage) {
      setToast({ type: 'warning', message: 'LOW 값은 HIGH 값보다 클 수 없습니다.' });
      return null;
    }

    return { highVoltage, lowVoltage };
  }, [setToast]);

  const applyChannelRange = useCallback(async (channelId: number) => {
    if (!ensureConnected()) return;

    const channel = adcChannels.find((entry) => entry.channelId === channelId);
    const draft = channelDrafts[channelId];
    if (!channel || !draft) return;

    const validated = validateRange(draft.low, draft.high);
    if (!validated) return;

    const command = `voltmon set ${channel.commandIndex} ${toRawVoltMonValue(validated.lowVoltage)} ${toRawVoltMonValue(validated.highVoltage)}`;

    setBusyKeySafely(`adc-${channelId}`);
    try {
      const result = await send(command);
      if (!result.success) {
        setToast({ type: 'error', message: result.error || `CH${channelId} 설정 전송에 실패했습니다.` });
        return;
      }

      syncThresholdLocally(channelId, validated.lowVoltage, validated.highVoltage);
      setToast({
        type: 'success',
        message: `CH${channelId} 범위를 ${validated.lowVoltage.toFixed(2)}V ~ ${validated.highVoltage.toFixed(2)}V로 설정했습니다.`,
      });
    } finally {
      setBusyKeySafely(null);
    }
  }, [adcChannels, channelDrafts, ensureConnected, send, setBusyKeySafely, setToast, syncThresholdLocally, validateRange]);

  const handleFillBulkRange = useCallback(() => {
    const validated = validateRange(bulkRange.low, bulkRange.high);
    if (!validated) return;

    setDraftSyncSuspended(true);
    setChannelDrafts((prev) => {
      const next = { ...prev };
      adcChannels.forEach((channel) => {
        next[channel.channelId] = {
          high: validated.highVoltage.toFixed(2),
          low: validated.lowVoltage.toFixed(2),
        };
      });
      return next;
    });

    setToast({
      type: 'info',
      message: `공통 Range를 모든 채널 입력칸에 반영했습니다. (${validated.lowVoltage.toFixed(2)}V ~ ${validated.highVoltage.toFixed(2)}V)`,
    });
  }, [adcChannels, bulkRange.high, bulkRange.low, setToast, validateRange]);

  const handleApplyBulkRange = useCallback(async () => {
    if (!ensureConnected()) return;

    const validated = validateRange(bulkRange.low, bulkRange.high);
    if (!validated) return;

    setBusyKeySafely('adc-bulk');
    try {
      for (const channel of adcChannels) {
        const command = `voltmon set ${channel.commandIndex} ${toRawVoltMonValue(validated.lowVoltage)} ${toRawVoltMonValue(validated.highVoltage)}`;
        const result = await send(command);

        if (!result.success) {
          setToast({
            type: 'error',
            message: result.error || `CH${channel.channelId} 전체 적용 중 전송에 실패했습니다.`,
          });
          return;
        }

        syncThresholdLocally(channel.channelId, validated.lowVoltage, validated.highVoltage);
      }

      setChannelDrafts((prev) => {
        const next = { ...prev };
        adcChannels.forEach((channel) => {
          next[channel.channelId] = {
            high: validated.highVoltage.toFixed(2),
            low: validated.lowVoltage.toFixed(2),
          };
        });
        return next;
      });

      setToast({
        type: 'success',
        message: `6개 채널 전체를 ${validated.lowVoltage.toFixed(2)}V ~ ${validated.highVoltage.toFixed(2)}V로 설정했습니다.`,
      });
    } finally {
      setBusyKeySafely(null);
    }
  }, [adcChannels, bulkRange.high, bulkRange.low, ensureConnected, send, setBusyKeySafely, setToast, syncThresholdLocally, validateRange]);

  const handleWatchdogInject = useCallback(async () => {
    if (!ensureConnected() || watchdogBusy) return;

    setWatchdogBusy(true);
    setToast({ type: 'info', message: `${WATCHDOG_INJECT_COMMAND}를 전송했습니다.` });

    let released = false;
    const releaseBusy = () => {
      if (released || !mountedRef.current) return;
      released = true;
      setWatchdogBusy(false);
    };

    const timeoutId = window.setTimeout(() => {
      releaseBusy();
    }, WATCHDOG_BUSY_HOLD_MS);

    void send(WATCHDOG_INJECT_COMMAND)
      .then((result) => {
        if (!result.success) {
          window.clearTimeout(timeoutId);
          setToast({ type: 'error', message: result.error || 'Watchdog 명령 전송에 실패했습니다.' });
          releaseBusy();
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        releaseBusy();
      });
  }, [ensureConnected, send, setToast, watchdogBusy]);

  const handleEccDoubleErrorInject = useCallback(async () => {
    if (!ensureConnected() || eccBusy) return;

    setEccBusy(true);
    setToast({ type: 'info', message: `${ECC_DOUBLE_ERROR_COMMAND}를 전송했습니다.` });

    let released = false;
    const releaseBusy = () => {
      if (released || !mountedRef.current) return;
      released = true;
      setEccBusy(false);
    };

    const timeoutId = window.setTimeout(() => {
      releaseBusy();
    }, ECC_BUSY_HOLD_MS);

    void send(ECC_DOUBLE_ERROR_COMMAND)
      .then((result) => {
        if (!result.success) {
          window.clearTimeout(timeoutId);
          setToast({ type: 'error', message: result.error || 'Local RAM ECC Test 명령 전송에 실패했습니다.' });
          releaseBusy();
          return;
        }

        setToast({
          type: 'warning',
          message: 'Local RAM ECC Test를 실행했습니다. Power on Reset으로 정상 복구됩니다.',
        });
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        releaseBusy();
      });
  }, [eccBusy, ensureConnected, send, setToast]);

  const handleRohmChecksumInject = useCallback(async () => {
    if (!ensureConnected()) return;

    setRohmChecksumBusy(true);
    setToast({ type: 'info', message: `${ROHM_FW_CHECKSUM_INJECT_COMMAND}를 전송했습니다.` });

    if (rohmChecksumBusyTimerRef.current !== null) {
      window.clearTimeout(rohmChecksumBusyTimerRef.current);
    }

    rohmChecksumBusyTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        setRohmChecksumBusy(false);
      }
      rohmChecksumBusyTimerRef.current = null;
    }, ROHM_FW_BUSY_HOLD_MS);

    try {
      const result = await send(ROHM_FW_CHECKSUM_INJECT_COMMAND);
      if (!result.success) {
        setToast({ type: 'error', message: result.error || 'Rohm IC FW Data Checksum Test 명령 전송에 실패했습니다.' });
        return;
      }

      setToast({
        type: 'warning',
        message: 'Fault Injection을 위해 Power on Reset을 해주세요.',
      });
    } finally {
      // busy 해제는 응답과 무관하게 타이머가 담당합니다.
    }
  }, [ensureConnected, send, setToast]);

  return (
    <div className="fault-injection">
      <section className="card fault-injection__hero">
          <div>
            <div className="fault-injection__eyebrow">Safety Tools</div>
            <div className="card__title">Fault Injection</div>
            <div className="fault-injection__hero-text">
            VoltMon threshold, WDT Fault Inject, Local RAM ECC Test, Rohm IC FW Data Checksum Test를 한 화면에서 다룹니다.
            </div>
          </div>

        <div className={`fault-injection__hero-status ${connected ? 'fault-injection__hero-status--connected' : 'fault-injection__hero-status--disconnected'}`}>
          {connected ? 'Serial Connected' : 'Serial Disconnected'}
        </div>
      </section>

      <section className={`card fault-accordion ${expandedSections.adc ? 'fault-accordion--open' : ''}`}>
        <button className="fault-accordion__header" type="button" onClick={() => toggleSection('adc')}>
          <div>
            <div className="fault-accordion__eyebrow">ADC</div>
            <div className="card__title">VoltMon Threshold Injection</div>
            <div className="fault-accordion__description">
              펼칠 때 현재 threshold를 1회 동기화하고, 이후에는 수동 업데이트로 다시 읽습니다.
            </div>
          </div>

          <div className="fault-accordion__header-meta">
            <span className="badge badge--info">6 Channels</span>
            <span className="fault-accordion__chevron">{expandedSections.adc ? '▾' : '▸'}</span>
          </div>
        </button>

        {expandedSections.adc && (
          <div className="fault-accordion__body">
            <div className="fault-injection__toolbar-actions">
              <button
                className="btn btn--secondary"
                type="button"
                onClick={handleUpdateVoltMonSettings}
                disabled={!connected || busyKey !== null}
              >
                {busyKey === 'adc-sync' ? '업데이트 중...' : '업데이트'}
              </button>
            </div>

            <div className="fault-injection__bulk-card">
              <div>
                <div className="fault-injection__bulk-title">Range 빠른 설정</div>
                <div className="fault-injection__bulk-text">
                  공통 LOW / HIGH 값을 모든 채널 입력칸에 채우거나 즉시 전체 채널에 적용할 수 있습니다.
                </div>
              </div>

              <div className="fault-injection__bulk-controls">
                <label className="fault-injection__field">
                  <span>LOW (V)</span>
                  <input
                    className="input"
                    type="number"
                    min={MIN_VOLTAGE}
                    max={MAX_VOLTAGE}
                    step="0.01"
                    value={bulkRange.low}
                    onChange={(event) => setBulkRange((prev) => ({ ...prev, low: event.target.value }))}
                  />
                </label>

                <label className="fault-injection__field">
                  <span>HIGH (V)</span>
                  <input
                    className="input"
                    type="number"
                    min={MIN_VOLTAGE}
                    max={MAX_VOLTAGE}
                    step="0.01"
                    value={bulkRange.high}
                    onChange={(event) => setBulkRange((prev) => ({ ...prev, high: event.target.value }))}
                  />
                </label>

                <button className="btn btn--secondary" type="button" onClick={handleFillBulkRange} disabled={busyKey !== null}>
                  입력칸에 채우기
                </button>
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={handleApplyBulkRange}
                  disabled={!connected || busyKey !== null}
                >
                  {busyKey === 'adc-bulk' ? '전체 적용 중...' : '전체 채널 적용'}
                </button>
              </div>
            </div>

            <div className="fault-injection__channel-grid">
              {adcChannels.map((channel) => {
                const draft = channelDrafts[channel.channelId] || DEFAULT_RANGE;
                const statusTone = channel.state === 0
                  ? 'badge--success'
                  : channel.state === null
                    ? 'badge--info'
                    : 'badge--warning';

                return (
                  <article key={channel.channelId} className="fault-injection__channel-card">
                    <div className="fault-injection__channel-top">
                      <div className="fault-injection__channel-name">CH{channel.channelId}</div>
                      <span className={`badge ${statusTone}`}>{channel.statusText}</span>
                    </div>

                    <div className="fault-injection__channel-stats">
                      <div className="fault-injection__stat">
                        <span className="fault-injection__stat-label">현재 전압</span>
                        <strong>{formatVoltage(channel.liveVoltage, 3)} V</strong>
                      </div>
                      <div className="fault-injection__stat">
                        <span className="fault-injection__stat-label">Raw ADC</span>
                        <strong>{channel.rawAdc ?? '--'}</strong>
                      </div>
                      <div className="fault-injection__stat">
                        <span className="fault-injection__stat-label">현재 Range</span>
                        <strong>{formatVoltage(channel.lowVoltage)} ~ {formatVoltage(channel.highVoltage)} V</strong>
                      </div>
                      <div className="fault-injection__stat">
                        <span className="fault-injection__stat-label">마지막 동기화</span>
                        <strong>{formatUpdatedAt(channel.updatedAt)}</strong>
                      </div>
                    </div>

                    <div className="fault-injection__channel-edit">
                      <label className="fault-injection__field">
                        <span>LOW (V)</span>
                        <input
                          className="input"
                          type="number"
                          min={MIN_VOLTAGE}
                          max={MAX_VOLTAGE}
                          step="0.01"
                          value={draft.low}
                          onChange={(event) => updateChannelDraft(channel.channelId, 'low', event.target.value)}
                        />
                      </label>

                      <label className="fault-injection__field">
                        <span>HIGH (V)</span>
                        <input
                          className="input"
                          type="number"
                          min={MIN_VOLTAGE}
                          max={MAX_VOLTAGE}
                          step="0.01"
                          value={draft.high}
                          onChange={(event) => updateChannelDraft(channel.channelId, 'high', event.target.value)}
                        />
                      </label>

                      <button
                        className="btn btn--primary"
                        type="button"
                        onClick={() => void applyChannelRange(channel.channelId)}
                        disabled={!connected || busyKey !== null}
                      >
                        {busyKey === `adc-${channel.channelId}` ? '적용 중...' : '채널 적용'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className={`card fault-accordion ${expandedSections.wdg ? 'fault-accordion--open' : ''}`}>
        <button className="fault-accordion__header" type="button" onClick={() => toggleSection('wdg')}>
          <div>
            <div className="fault-accordion__eyebrow">WDG</div>
            <div className="card__title">WDT FAULT INJECT</div>
            <div className="fault-accordion__description">
              Watchdog의 Feed를 중단하여 시스템 멈춤 현상을 재현합니다.
            </div>
          </div>

          <div className="fault-accordion__header-meta">
            <span className="badge badge--warning">Safety Test</span>
            <span className="fault-accordion__chevron">{expandedSections.wdg ? '▾' : '▸'}</span>
          </div>
        </button>

        {expandedSections.wdg && (
          <div className="fault-accordion__body">
            <div className="fault-injection__action-card fault-injection__action-card--danger">
              <div>
                <div className="fault-injection__action-title">WDT FAULT INJECT</div>
                <div className="fault-injection__action-text">
                  Command: <code>{WATCHDOG_INJECT_COMMAND}</code>
                </div>
                <div className="fault-injection__command-note">
                  시스템 멈춤 현상 재현 후 SOFTWARE RESET으로 정상 복구됩니다.
                </div>
              </div>

              <div className="fault-injection__toolbar-actions">
                <button
                  className="btn btn--danger"
                  type="button"
                  onClick={() => void handleWatchdogInject()}
                  disabled={!connected || watchdogBusy}
                >
                  {watchdogBusy ? '전송 중...' : 'Feed 중지'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={`card fault-accordion ${expandedSections.ecc ? 'fault-accordion--open' : ''}`}>
        <button className="fault-accordion__header" type="button" onClick={() => toggleSection('ecc')}>
          <div>
            <div className="fault-accordion__eyebrow">ECC</div>
            <div className="card__title">Local RAM ECC Test</div>
            <div className="fault-accordion__description">
              Local RAM PE0의 2bit 데이터를 변경하여 ECC 에러를 주입합니다.
            </div>
          </div>

          <div className="fault-accordion__header-meta">
            <span className="badge badge--error">Safety Test</span>
            <span className="fault-accordion__chevron">{expandedSections.ecc ? '▾' : '▸'}</span>
          </div>
        </button>

        {expandedSections.ecc && (
          <div className="fault-accordion__body">
            <div className="fault-injection__action-card fault-injection__action-card--danger">
              <div>
                <div className="fault-injection__action-title">Local RAM ECC Test</div>
                <div className="fault-injection__action-text">
                  Command: <code>{ECC_DOUBLE_ERROR_COMMAND}</code>
                </div>
                <div className="fault-injection__command-note">
                  1비트 에러는 자동 정정되며, 2비트 에러는 정정할 수 없습니다. Power on Reset으로 정상 복구됩니다.
                </div>
              </div>

              <div className="fault-injection__toolbar-actions">
                <button
                  className="btn btn--danger"
                  type="button"
                  onClick={() => void handleEccDoubleErrorInject()}
                  disabled={!connected || eccBusy}
                >
                  {eccBusy ? '전송 중...' : 'Safety Test 실행'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={`card fault-accordion ${expandedSections.rohmFw ? 'fault-accordion--open' : ''}`}>
        <button className="fault-accordion__header" type="button" onClick={() => toggleSection('rohmFw')}>
          <div>
            <div className="fault-accordion__eyebrow">ROHM FW</div>
            <div className="card__title">Rohm IC FW Data Checksum Test</div>
            <div className="fault-accordion__description">
              Rohm IC FW Data의 Checksum 값을 변경하여 오류를 유도하고, Safety MCU의 복구 동작을 확인합니다.
            </div>
          </div>

          <div className="fault-accordion__header-meta">
            <span className="badge badge--error">Safety Test</span>
            <span className="fault-accordion__chevron">{expandedSections.rohmFw ? '▾' : '▸'}</span>
          </div>
        </button>

        {expandedSections.rohmFw && (
          <div className="fault-accordion__body">
            <div className="fault-injection__action-card fault-injection__action-card--danger">
              <div>
                <div className="fault-injection__action-title">Rohm IC FW Data Checksum Test</div>
                <div className="fault-injection__action-text">
                  Command: <code>{ROHM_FW_CHECKSUM_INJECT_COMMAND}</code>
                </div>
                <div className="fault-injection__command-note">
                  Rohm IC의 Checksum 값을 변경하여 오류를 유도합니다. 펌웨어 무결성 검증에 실패하면 Safety MCU가 이를 이상 상태로 판단하고,
                  정상 펌웨어를 다시 쓰는 복구 시퀀스가 시작되는지 확인합니다.
                </div>
              </div>

              <div className="fault-injection__toolbar-actions">
                <button
                  className="btn btn--danger"
                  type="button"
                  onClick={() => void handleRohmChecksumInject()}
                >
                  {rohmChecksumBusy ? '전송 중...' : 'Safety Test 실행'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default FaultInjectionPage;
