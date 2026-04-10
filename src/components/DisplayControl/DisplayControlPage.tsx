import React, { useState, useEffect } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import {
  displayInitReceivedState,
  displayStreamingState,
  serialConnectedState,
  terminalLinesState,
} from 'state/atoms';
import { useSerial } from 'hooks/useSerial';
import './DisplayControl.css';

const DisplayControlPage: React.FC = () => {
  const { send, connected } = useSerial();
  const terminalLines = useRecoilValue(terminalLinesState);
  const [initReceived, setInitReceived] = useRecoilState(displayInitReceivedState);
  const [streaming, setStreaming] = useRecoilState(displayStreamingState);
  const [initString, setInitString] = useState('Display Init String Received');

  // RX 데이터에서 Init String 감지
  useEffect(() => {
    if (!connected || initReceived) return;
    const lastLines = terminalLines.filter((l) => l.direction === 'rx').slice(-5);
    const found = lastLines.some((l) => l.content.includes(initString));
    if (found) {
      setInitReceived(true);
    }
  }, [terminalLines, connected, initReceived, initString, setInitReceived]);

  // Init 감지 시 자동 영상 송출 시작
  useEffect(() => {
    if (initReceived && !streaming) {
      // 자동 영상 송출 커맨드
      send('DISPLAY_START');
      setStreaming(true);
    }
  }, [initReceived, streaming, send, setStreaming]);

  const handleManualStart = () => {
    send('DISPLAY_START');
    setStreaming(true);
    setInitReceived(true);
  };

  const handleStop = () => {
    send('DISPLAY_STOP');
    setStreaming(false);
  };

  const handleReset = () => {
    setInitReceived(false);
    setStreaming(false);
  };

  const statusLabel = streaming
    ? 'STREAMING'
    : initReceived
    ? 'READY'
    : 'WAITING FOR INIT';

  const statusClass = streaming
    ? 'streaming'
    : initReceived
    ? 'ready'
    : 'waiting';

  return (
    <div className="display-page">
      {/* ── Status Bar ── */}
      <div className="display__status-bar">
        <div className="display__status-indicator">
          <div className={`display__status-icon display__status-icon--${statusClass}`} />
          <span className="display__status-text" style={{
            color: streaming ? 'var(--color-info)' : initReceived ? 'var(--color-success)' : 'var(--color-warning)'
          }}>
            {statusLabel}
          </span>
        </div>

        <div className="display__init-string">
          <span className="display__init-label">Trigger String:</span>
          <input
            className="input display__init-input"
            value={initString}
            onChange={(e) => setInitString(e.target.value)}
            placeholder="Device Init String..."
            disabled={streaming}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {!streaming ? (
            <button className="btn btn--primary btn--sm" onClick={handleManualStart} disabled={!connected}>
              Manual Start
            </button>
          ) : (
            <button className="btn btn--danger btn--sm" onClick={handleStop}>
              Stop
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={handleReset} disabled={streaming}>
            Reset
          </button>
        </div>
      </div>

      {/* ── Preview Area ── */}
      <div className="display__preview">
        <div className="display__preview-header">
          <span className="display__preview-title">Display Output Preview</span>
          <span className="display__resolution">1920 × 720</span>
        </div>
        <div className="display__preview-area">
          {streaming ? (
            <>
              <div className="display__streaming-overlay">
                <div className="display__streaming-dot" />
                LIVE
              </div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>
                영상 송출 중 — 디스플레이 출력 활성화됨
              </div>
            </>
          ) : (
            <div className="display__placeholder">
              <div className="display__placeholder-icon">▣</div>
              <div className="display__placeholder-text">
                {connected
                  ? `"${initString}" 수신 대기 중...`
                  : '시리얼 포트를 연결해주세요'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Config Cards ── */}
      <div className="display__config">
        <div className="display__config-card">
          <div className="display__config-title">Resolution</div>
          <div className="display__config-value">1920 × 720</div>
        </div>
        <div className="display__config-card">
          <div className="display__config-title">Interface</div>
          <div className="display__config-value">GMSL</div>
        </div>
        <div className="display__config-card">
          <div className="display__config-title">Color Depth</div>
          <div className="display__config-value">24-bit RGB</div>
        </div>
        <div className="display__config-card">
          <div className="display__config-title">Refresh Rate</div>
          <div className="display__config-value">60 Hz</div>
        </div>
      </div>
    </div>
  );
};

export default DisplayControlPage;
