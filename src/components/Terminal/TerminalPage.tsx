import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import {
  terminalLinesState,
  terminalAutoScrollState,
  terminalFilterState,
  filteredTerminalLinesState,
} from 'state/atoms';
import { useSerial } from 'hooks/useSerial';
import './Terminal.css';

const FILTERS = [
  { key: 'all',    label: 'ALL' },
  { key: 'rx',     label: 'RX' },
  { key: 'tx',     label: 'TX' },
  { key: 'system', label: 'SYS' },
] as const;

const TerminalPage: React.FC = () => {
  const { send, connected } = useSerial();
  const filteredLines = useRecoilValue(filteredTerminalLinesState);
  const setTerminalLines = useSetRecoilState(terminalLinesState);
  const [filter, setFilter] = useRecoilState(terminalFilterState);
  const [autoScroll, setAutoScroll] = useRecoilState(terminalAutoScrollState);
  const [inputValue, setInputValue] = useState('');

  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  const handleSend = useCallback(() => {
    const cmd = inputValue.trim();
    if (!cmd) return;
    send(cmd);
    setInputValue('');
  }, [inputValue, send]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  const clearLog = () => setTerminalLines([]);

  return (
    <div className="terminal-page">
      <div className="terminal__toolbar">
        <div className="terminal__filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`terminal__filter-btn ${filter === f.key ? 'terminal__filter-btn--active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="terminal__actions">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button className="btn btn--ghost btn--sm" onClick={clearLog}>Clear</button>
        </div>
      </div>

      {/* ── Log Area ── */}
      <div className="terminal__log" ref={logRef}>
        {filteredLines.length === 0 ? (
          <div className="terminal__empty">
            {connected
              ? '데이터 수신 대기 중...'
              : '시리얼 포트를 연결해주세요'}
          </div>
        ) : (
          filteredLines.map((line) => (
            <div key={line.id} className={`terminal__line terminal__line--${line.direction}`}>
              <span className="terminal__line-time">{line.timestamp}</span>
              <span className={`terminal__line-dir terminal__line-dir--${line.direction}`}>
                {line.direction}
              </span>
              <span className="terminal__line-content">{line.content}</span>
            </div>
          ))
        )}
      </div>

      {/* ── Input Bar ── */}
      <div className="terminal__input-bar">
        <input
          className="input terminal__input"
          type="text"
          placeholder={connected ? '명령어 입력 후 Enter...' : '포트 연결 필요'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!connected}
        />
        <button
          className="btn btn--primary"
          onClick={handleSend}
          disabled={!connected || !inputValue.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default TerminalPage;
