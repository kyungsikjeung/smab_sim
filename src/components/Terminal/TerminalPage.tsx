import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import {
  terminalLinesState,
  terminalAutoScrollState,
  terminalTimestampVisibleState,
  terminalFilterState,
  terminalSearchQueryState,
  filteredTerminalLinesState,
  toastMessageState,
} from 'state/atoms';
import { useSerial } from 'hooks/useSerial';
import './Terminal.css';

const TERMINAL_HISTORY_STORAGE_KEY = 'terminal-command-history';
const TERMINAL_HISTORY_LIMIT = 10;

const FILTERS = [
  { key: 'all',    label: 'ALL' },
  { key: 'rx',     label: 'RX' },
  { key: 'tx',     label: 'TX' },
  { key: 'system', label: 'SYS' },
] as const;

const getTerminalHighlightClass = (content: string) => {
  if (/ROHM\s+Error:/i.test(content)) {
    return 'terminal__line--error-highlight';
  }

  if (/\[FaultHandler\]\s+(?:SYS|EXT)\s+fault\s+output\s*->\s*FAULT\(LOW\)/i.test(content)) {
    return 'terminal__line--error-highlight';
  }

  if (/\[FaultHandler\]\s+(?:SYS|EXT)\s+fault\s+output\s*->\s*NORMAL\(HIGH\)/i.test(content)) {
    return 'terminal__line--normal-highlight';
  }

  return '';
};

const escapeSearchPattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getDisplayTimestamp = (value: string | null | undefined) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || '--:--:--.---';
};

const buildDownloadFileStamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
};

const readStoredCommandHistory = (): string[] => {
  if (typeof window === 'undefined') return [];

  try {
    const rawValue = window.localStorage.getItem(TERMINAL_HISTORY_STORAGE_KEY);
    if (!rawValue) return [];

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, TERMINAL_HISTORY_LIMIT);
  } catch {
    return [];
  }
};

const writeStoredCommandHistory = (history: string[]) => {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(
    TERMINAL_HISTORY_STORAGE_KEY,
    JSON.stringify(history.slice(0, TERMINAL_HISTORY_LIMIT))
  );
};

const TerminalPage: React.FC = () => {
  const { send, connected } = useSerial();
  const terminalLines = useRecoilValue(terminalLinesState);
  const filteredLines = useRecoilValue(filteredTerminalLinesState);
  const setTerminalLines = useSetRecoilState(terminalLinesState);
  const setToast = useSetRecoilState(toastMessageState);
  const [filter, setFilter] = useRecoilState(terminalFilterState);
  const [autoScroll, setAutoScroll] = useRecoilState(terminalAutoScrollState);
  const [timestampVisible, setTimestampVisible] = useRecoilState(terminalTimestampVisibleState);
  const [searchQuery, setSearchQuery] = useRecoilState(terminalSearchQueryState);
  const [inputValue, setInputValue] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>(() => readStoredCommandHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);

  const logRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef('');

  useEffect(() => {
    writeStoredCommandHistory(commandHistory);
  }, [commandHistory]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  const pushCommandHistory = useCallback((command: string) => {
    setCommandHistory((prev) => {
      const normalized = command.trim();
      if (!normalized) return prev;

      return [
        normalized,
        ...prev.filter((entry) => entry !== normalized),
      ].slice(0, TERMINAL_HISTORY_LIMIT);
    });
  }, []);

  const handleSend = useCallback(() => {
    const cmd = inputValue.trim();
    if (!cmd) return;

    send(cmd);
    pushCommandHistory(cmd);
    setInputValue('');
    setHistoryIndex(-1);
    draftInputRef.current = '';
  }, [inputValue, pushCommandHistory, send]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSend();
      return;
    }

    if (e.key === 'ArrowUp') {
      if (commandHistory.length === 0) return;

      e.preventDefault();
      if (historyIndex === -1) {
        draftInputRef.current = inputValue;
      }

      const nextIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
      setHistoryIndex(nextIndex);
      setInputValue(commandHistory[nextIndex] || '');
      return;
    }

    if (e.key === 'ArrowDown') {
      if (historyIndex === -1) return;

      e.preventDefault();
      const nextIndex = historyIndex - 1;

      if (nextIndex < 0) {
        setHistoryIndex(-1);
        setInputValue(draftInputRef.current);
        return;
      }

      setHistoryIndex(nextIndex);
      setInputValue(commandHistory[nextIndex] || '');
    }
  };

  const clearLog = () => setTerminalLines([]);
  const downloadLog = useCallback(() => {
    if (terminalLines.length === 0) {
      setToast({ type: 'warning', message: '다운로드할 로그가 없습니다.' });
      return;
    }

    const content = terminalLines
      .map((line) => {
        const parts = [];
        if (timestampVisible) {
          parts.push(`[${getDisplayTimestamp(line.timestamp)}]`);
        }
        parts.push(`[${line.direction.toUpperCase()}]`);
        parts.push(line.content);
        return parts.join(' ');
      })
      .join('\r\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `terminal-log-${buildDownloadFileStamp()}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);

    setToast({
      type: 'success',
      message: `로그 ${terminalLines.length}줄을 다운로드했습니다.${timestampVisible ? ' 타임스탬프 포함.' : ''}`,
    });
  }, [setToast, terminalLines, timestampVisible]);
  const clearSearch = useCallback(() => setSearchQuery(''), [setSearchQuery]);

  const renderLineContent = useCallback((content: string) => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      return <span className="terminal__line-content">{content}</span>;
    }

    const matcher = new RegExp(`(${escapeSearchPattern(normalizedQuery)})`, 'gi');
    const fragments = content.split(matcher);
    const lowerQuery = normalizedQuery.toLowerCase();

    return (
      <span className="terminal__line-content">
        {fragments.map((fragment, index) => (
          fragment.toLowerCase() === lowerQuery
            ? <mark key={`${fragment}-${index}`} className="terminal__search-hit">{fragment}</mark>
            : <React.Fragment key={`${fragment}-${index}`}>{fragment}</React.Fragment>
        ))}
      </span>
    );
  }, [searchQuery]);

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
        <div className="terminal__search-group">
          <input
            className="input terminal__search-input"
            type="text"
            placeholder="로그 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="terminal__search-meta">
            <span className="terminal__search-count">
              {searchQuery.trim() ? `${filteredLines.length} matches` : `${filteredLines.length} lines`}
            </span>
            {searchQuery.trim() && (
              <button className="btn btn--ghost btn--sm" onClick={clearSearch}>
                검색 지우기
              </button>
            )}
          </div>
        </div>
        <div className="terminal__actions">
          <label className="terminal__option">
            <input
              type="checkbox"
              checked={timestampVisible}
              onChange={(e) => setTimestampVisible(e.target.checked)}
            />
            Timestamp
          </label>
          <label className="terminal__option">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button className="btn btn--secondary btn--sm" onClick={downloadLog} disabled={terminalLines.length === 0}>
            로그 다운로드
          </button>
          <button className="btn btn--ghost btn--sm" onClick={clearLog}>Clear</button>
        </div>
      </div>

      {/* ── Log Area ── */}
      <div className="terminal__log" ref={logRef}>
        {filteredLines.length === 0 ? (
          <div className="terminal__empty">
            {searchQuery.trim()
              ? '검색 조건에 맞는 로그가 없습니다.'
              : connected
                ? '데이터 수신 대기 중...'
                : '시리얼 포트를 연결해주세요'}
          </div>
        ) : (
          filteredLines.map((line) => {
            const highlightClass = getTerminalHighlightClass(line.content);

            return (
              <div
                key={line.id}
                className={[
                  'terminal__line',
                  `terminal__line--${line.direction}`,
                  highlightClass,
                ].filter(Boolean).join(' ')}
              >
                {timestampVisible && <span className="terminal__line-time">{getDisplayTimestamp(line.timestamp)}</span>}
                <span className={`terminal__line-dir terminal__line-dir--${line.direction}`}>
                  {line.direction}
                </span>
                {renderLineContent(line.content)}
              </div>
            );
          })
        )}
      </div>

      {/* ── Input Bar ── */}
      <div className="terminal__input-bar">
        <input
          className="input terminal__input"
          type="text"
          placeholder={connected ? '명령어 입력 후 Enter...' : '포트 연결 필요'}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (historyIndex === -1) {
              draftInputRef.current = e.target.value;
            }
          }}
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
