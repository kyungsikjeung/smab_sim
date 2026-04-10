import React, { useState, useCallback } from 'react';
import { useSerial } from 'hooks/useSerial';
import ShellCommandPanel from 'components/Terminal/ShellCommandPanel';
import 'components/Terminal/Terminal.css';
import './CommandPage.css';

const QUICK_COMMANDS = ['vmlog on', 'vmlog off'];

const CommandPage: React.FC = () => {
  const { send, connected } = useSerial();
  const [customCommand, setCustomCommand] = useState('');

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
    <div className="command-page">
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

      <ShellCommandPanel onSend={send} />
    </div>
  );
};

export default CommandPage;
