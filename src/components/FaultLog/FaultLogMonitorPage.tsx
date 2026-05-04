import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useSerial } from 'hooks/useSerial';
import { buildFaultLogDownloadText, parseFaultLogResponseLines } from 'services/faultLogParser';
import { terminalLinesState, toastMessageState } from 'state/atoms';
import { FaultLogEntry } from 'types';
import { formatTimeWithMilliseconds } from 'utils/dateTime';
import './FaultLogMonitor.css';

const FAULT_LOG_COMMAND = 'flog latest';
const RESPONSE_IDLE_TIMEOUT_MS = 3000;

const getTerminalLineEpoch = (lineId: string) => {
  const match = lineId.match(/^line-(\d+)-/);
  if (!match) return 0;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const downloadTextFile = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const buildDownloadFileName = () => {
  const stamp = formatTimeWithMilliseconds()
    .replace(/:/g, '')
    .replace(/\./g, '-');

  return `fault-log-recent-${stamp}.txt`;
};

const FaultLogMonitorPage: React.FC = () => {
  const { connected, send } = useSerial();
  const terminalLines = useRecoilValue(terminalLinesState);
  const setToast = useSetRecoilState(toastMessageState);

  const seenRxLineIdsRef = useRef<Set<string>>(new Set());
  const [capturedRxLines, setCapturedRxLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);

  const parseResult = useMemo(
    () => parseFaultLogResponseLines(capturedRxLines),
    [capturedRxLines]
  );

  const entries = parseResult.entries;
  const latestEntry = entries[0] ?? null;

  const recurringBits = useMemo(() => {
    const counts = new Map<string, { bit: number; count: number; label: string }>();

    entries.forEach((entry) => {
      entry.bits.forEach((bit) => {
        const key = `${bit.bit}-${bit.label}`;
        const previous = counts.get(key);
        counts.set(key, {
          bit: bit.bit,
          count: (previous?.count || 0) + 1,
          label: bit.label,
        });
      });
    });

    return Array.from(counts.values()).sort((left, right) => (
      right.count - left.count || left.bit - right.bit
    ));
  }, [entries]);

  useEffect(() => {
    if (!loading || requestStartedAt === null) {
      return;
    }

    const nextLines = terminalLines.filter((line) => {
      if (line.direction !== 'rx') return false;
      if (seenRxLineIdsRef.current.has(line.id)) return false;

      return getTerminalLineEpoch(line.id) >= requestStartedAt;
    });

    if (nextLines.length === 0) {
      return;
    }

    nextLines.forEach((line) => {
      seenRxLineIdsRef.current.add(line.id);
    });

    const nextChunks = nextLines
      .flatMap((line) => line.content.split('\n'))
      .map((line) => line.trim())
      .filter(Boolean);

    if (nextChunks.length === 0) {
      return;
    }

    setCapturedRxLines((prev) => [...prev, ...nextChunks]);
  }, [loading, requestStartedAt, terminalLines]);

  useEffect(() => {
    if (!loading) {
      return undefined;
    }

    if (parseResult.completed) {
      setLoading(false);
      setRequestStartedAt(null);
      if (parseResult.rawLines.length > 0) {
        setLastSyncedAt(Date.now());
      }
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setRequestStartedAt(null);
      if (parseResult.rawLines.length > 0) {
        setLastSyncedAt(Date.now());
      }
    }, RESPONSE_IDLE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loading, parseResult.completed, parseResult.rawLines.length]);

  const handleReadLatest = useCallback(async () => {
    if (!connected) {
      setToast({ type: 'warning', message: '포트를 먼저 연결해주세요.' });
      return;
    }

    seenRxLineIdsRef.current.clear();
    setCapturedRxLines([]);
    setLastSyncedAt(null);
    setRequestStartedAt(Date.now());
    setLoading(true);

    const result = await send(FAULT_LOG_COMMAND);
    if (!result.success) {
      setLoading(false);
      setRequestStartedAt(null);
    }
  }, [connected, send, setToast]);

  const handleClear = useCallback(() => {
    seenRxLineIdsRef.current.clear();
    setCapturedRxLines([]);
    setLastSyncedAt(null);
    setLoading(false);
    setRequestStartedAt(null);
  }, []);

  const handleDownload = useCallback(() => {
    if (parseResult.rawLines.length === 0) {
      setToast({ type: 'warning', message: '다운로드할 에러 로그가 없습니다.' });
      return;
    }

    downloadTextFile(buildDownloadFileName(), buildFaultLogDownloadText(parseResult));
    setToast({ type: 'success', message: `에러 로그 ${parseResult.rawLines.length}줄을 다운로드했습니다.` });
  }, [parseResult, setToast]);

  const renderBits = useCallback((entry: FaultLogEntry) => {
    if (entry.bits.length === 0) {
      return <span className="fault-log-monitor__bit-empty">No bit</span>;
    }

    return (
      <div className="fault-log-monitor__bit-list">
        {entry.bits.map((bit) => (
          <span key={`${entry.entryNumber}-${bit.bit}-${bit.label}`} className="fault-log-monitor__bit-chip">
            bit{bit.bit} {bit.label}
          </span>
        ))}
      </div>
    );
  }, []);

  const statusText = loading
    ? '수집 중'
    : lastSyncedAt
      ? `${formatTimeWithMilliseconds(lastSyncedAt)} 동기화`
      : 'Idle';

  return (
    <div className="fault-log-monitor">
      <section className="card fault-log-monitor__hero">
        <div className="fault-log-monitor__hero-top">
          <div className="fault-log-monitor__hero-copy">
            <div className="fault-log-monitor__eyebrow">Recent Fault Log</div>
            <h1 className="fault-log-monitor__title">최근 에러 5건 모니터링</h1>
            <p className="fault-log-monitor__description">
              <code>{FAULT_LOG_COMMAND}</code> 응답을 최근 기록 테이블로 정리합니다.
            </p>
          </div>

          <div className={`fault-log-monitor__status-pill ${loading ? 'fault-log-monitor__status-pill--live' : ''}`}>
            {statusText}
          </div>
        </div>

        <div className="fault-log-monitor__toolbar">
          <div className="fault-log-monitor__command-box">
            <span className="fault-log-monitor__toolbar-label">Command</span>
            <code className="fault-log-monitor__command-value">{FAULT_LOG_COMMAND}</code>
          </div>

          <div className="fault-log-monitor__toolbar-actions">
            <button className="btn btn--primary" type="button" onClick={handleReadLatest} disabled={!connected || loading}>
              최근 5건 조회
            </button>
            <button className="btn btn--secondary" type="button" onClick={handleClear} disabled={!loading && capturedRxLines.length === 0 && parseResult.rawLines.length === 0}>
              Clear
            </button>
            <button className="btn btn--ghost" type="button" onClick={handleDownload} disabled={parseResult.rawLines.length === 0}>
              로그 다운로드
            </button>
          </div>
        </div>
      </section>

      <div className="fault-log-monitor__metric-grid">
        <section className="card fault-log-monitor__metric-card">
          <div className="fault-log-monitor__metric-label">기록 수</div>
          <div className="fault-log-monitor__metric-value">
            {entries.length}
            <span className="fault-log-monitor__metric-unit">
              {parseResult.totalExpected !== null ? ` / ${parseResult.totalExpected}` : ' entries'}
            </span>
          </div>
        </section>

        <section className="card fault-log-monitor__metric-card">
          <div className="fault-log-monitor__metric-label">최신 Flags</div>
          <div className="fault-log-monitor__metric-value fault-log-monitor__metric-value--mono">
            {latestEntry?.flagsHex ?? '-'}
          </div>
        </section>

        <section className="card fault-log-monitor__metric-card">
          <div className="fault-log-monitor__metric-label">최신 Uptime</div>
          <div className="fault-log-monitor__metric-value fault-log-monitor__metric-value--mono">
            {latestEntry?.uptime ?? '-'}
          </div>
        </section>

        <section className="card fault-log-monitor__metric-card">
          <div className="fault-log-monitor__metric-label">비트 종류</div>
          <div className="fault-log-monitor__metric-value">
            {recurringBits.length}
            <span className="fault-log-monitor__metric-unit"> types</span>
          </div>
        </section>
      </div>

      {parseResult.rawLines.length === 0 ? (
        <section className="card fault-log-monitor__empty-state">
          <div className="fault-log-monitor__empty-title">에러 로그 기록이 없습니다.</div>
          <div className="fault-log-monitor__empty-text">
            상단 <strong>최근 5건 조회</strong> 버튼을 눌러 `flog latest` 응답을 가져오세요.
          </div>
        </section>
      ) : (
        <div className="fault-log-monitor__content-grid">
          <section className="card fault-log-monitor__table-card">
            <div className="card__header">
              <div>
                <div className="card__title">최근 에러 5건 로그 기록</div>
                <div className="fault-log-monitor__section-note">최신 순서대로 주소, uptime, flags, bit 정보를 비교합니다.</div>
              </div>
              <div className="fault-log-monitor__table-summary">
                {entries.length > 0 ? `${entries.length} rows` : 'No rows'}
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="fault-log-monitor__empty-table">
                조회 응답은 들어왔지만 구조화된 fault log entry를 찾지 못했습니다.
              </div>
            ) : (
              <div className="fault-log-monitor__table-wrap">
                <table className="fault-log-monitor__table">
                  <thead>
                    <tr>
                      <th>순번</th>
                      <th>상태</th>
                      <th>Addr</th>
                      <th>Uptime</th>
                      <th>Flags</th>
                      <th>Bits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={`${entry.entryNumber}-${entry.address}`} className={entry.isNewest ? 'fault-log-monitor__row--newest' : ''}>
                        <td>{entry.entryNumber}</td>
                        <td>
                          <span className={`fault-log-monitor__state-badge ${entry.isNewest ? 'fault-log-monitor__state-badge--newest' : ''}`}>
                            {entry.isNewest ? 'Newest' : `Recent ${entry.recentIndex}`}
                          </span>
                        </td>
                        <td className="fault-log-monitor__mono">{entry.address}</td>
                        <td className="fault-log-monitor__mono">{entry.uptime}</td>
                        <td className="fault-log-monitor__mono">{entry.flagsHex}</td>
                        <td>{renderBits(entry)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="fault-log-monitor__side-stack">
            <section className="card fault-log-monitor__focus-card">
              <div className="card__header">
                <div>
                  <div className="card__title">최신 기록</div>
                  <div className="fault-log-monitor__section-note">가장 최근에 저장된 fault log entry입니다.</div>
                </div>
              </div>

              {latestEntry ? (
                <div className="fault-log-monitor__focus-body">
                  <div className="fault-log-monitor__focus-row">
                    <span>Addr</span>
                    <code>{latestEntry.address}</code>
                  </div>
                  <div className="fault-log-monitor__focus-row">
                    <span>Uptime</span>
                    <code>{latestEntry.uptime}</code>
                  </div>
                  <div className="fault-log-monitor__focus-row">
                    <span>Flags</span>
                    <code>{latestEntry.flagsHex}</code>
                  </div>
                  <div className="fault-log-monitor__focus-bits">
                    {renderBits(latestEntry)}
                  </div>
                </div>
              ) : (
                <div className="fault-log-monitor__empty-table">최신 기록이 없습니다.</div>
              )}
            </section>

            <section className="card fault-log-monitor__summary-card">
              <div className="card__header">
                <div>
                  <div className="card__title">반복 에러 비트</div>
                  <div className="fault-log-monitor__section-note">최근 5건에서 자주 나온 bit를 먼저 보여줍니다.</div>
                </div>
              </div>

              {recurringBits.length === 0 ? (
                <div className="fault-log-monitor__empty-table">bit 정보가 없습니다.</div>
              ) : (
                <div className="fault-log-monitor__summary-list">
                  {recurringBits.map((bit) => (
                    <div key={`${bit.bit}-${bit.label}`} className="fault-log-monitor__summary-item">
                      <div className="fault-log-monitor__summary-top">
                        <span className="fault-log-monitor__summary-bit">bit{bit.bit}</span>
                        <span className="fault-log-monitor__summary-count">{bit.count}회</span>
                      </div>
                      <div className="fault-log-monitor__summary-label">{bit.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

export default FaultLogMonitorPage;
