import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useSerial } from 'hooks/useSerial';
import ShellCommandPanel from 'components/Terminal/ShellCommandPanel';
import {
  terminalLinesState,
  terminalTimestampVisibleState,
} from 'state/atoms';
import 'components/Terminal/Terminal.css';
import './CommandPage.css';

const QUICK_COMMANDS = ['vmlog on', 'vmlog off'];
const EMBEDDED_TERMINAL_LINE_LIMIT = 120;

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

const getDisplayTimestamp = (value: string | null | undefined) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || '--:--:--.---';
};

const CommandPage: React.FC = () => {
  const { send, connected } = useSerial();
  const terminalLines = useRecoilValue(terminalLinesState);
  const timestampVisible = useRecoilValue(terminalTimestampVisibleState);
  const [customCommand, setCustomCommand] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const embeddedTerminalRef = useRef<HTMLDivElement>(null);

  const isEmbeddedTerminalVisible = selectedCategory !== 'all';
  const embeddedTerminalLines = useMemo(
    () => terminalLines.slice(-EMBEDDED_TERMINAL_LINE_LIMIT),
    [terminalLines]
  );

  useEffect(() => {
    if (!isEmbeddedTerminalVisible || !embeddedTerminalRef.current) {
      return;
    }

    embeddedTerminalRef.current.scrollTop = embeddedTerminalRef.current.scrollHeight;
  }, [embeddedTerminalLines, isEmbeddedTerminalVisible]);

  const sendCustom = useCallback(() => {
    const cmd = customCommand.trim();
    if (!cmd) return;
    send(cmd);
    setCustomCommand('');
  }, [customCommand, send]);

  const sendQuick = useCallback(
    (command: string) => {
      if (!connected) return;
      send(command);
    },
    [connected, send]
  );

  return (
    <div className={`command-page ${isEmbeddedTerminalVisible ? 'command-page--split' : ''}`}>
      <div className="command-page__controls">
        <div className="command-page__top">
          <div className="command-page__title">CMD 명령어</div>
          <div className="command-page__quick">
            {QUICK_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                className="btn btn--secondary btn--sm"
                onClick={() => sendQuick(cmd)}
                disabled={!connected}
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>

        <div className="command-page__inline-input">
          <input
            className="input"
            value={customCommand}
            onChange={(e) => setCustomCommand(e.target.value)}
            placeholder={connected ? '직접 CMD 입력 후 Send' : '포트 연결 필요'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                sendCustom();
              }
            }}
            disabled={!connected}
          />
          <button className="btn btn--primary" onClick={sendCustom} disabled={!connected || !customCommand.trim()}>
            Send
          </button>
        </div>

        <ShellCommandPanel
          onSend={send}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />
      </div>

      {isEmbeddedTerminalVisible && (
        <section className="command-page__terminal">
          <div className="command-page__terminal-header">
            <div className="command-page__terminal-copy">
              <div className="command-page__terminal-title">시리얼 터미널</div>
              <div className="command-page__terminal-subtitle">{selectedCategory} 선택 중</div>
            </div>
            <div className="command-page__terminal-meta">
              최근 {embeddedTerminalLines.length}줄
            </div>
          </div>

          <div className="terminal__log command-page__terminal-log" ref={embeddedTerminalRef}>
            {embeddedTerminalLines.length === 0 ? (
              <div className="terminal__empty">
                {connected ? '명령 전송 후 시리얼 로그를 표시합니다.' : '시리얼 포트를 연결해주세요'}
              </div>
            ) : (
              embeddedTerminalLines.map((line) => {
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
                    {timestampVisible && (
                      <span className="terminal__line-time">{getDisplayTimestamp(line.timestamp)}</span>
                    )}
                    <span className={`terminal__line-dir terminal__line-dir--${line.direction}`}>
                      {line.direction}
                    </span>
                    <span className="terminal__line-content">{line.content}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default CommandPage;
