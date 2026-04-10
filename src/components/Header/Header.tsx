import React from 'react';
import { useLocation } from 'react-router-dom';
import { useSerial } from 'hooks/useSerial';
import './Header.css';

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const PAGE_TITLES: Record<string, string> = {
  '/terminal':        '시리얼 터미널',
  '/commands':        'CMD 명령어',
  '/register':        '레지스터 R/W',
  '/rohm-monitor':    'ROHM 모니터',
  '/voltage-monitor': '전압 모니터링',
  '/warning-lights':  '경고등 제어',
  '/display-control': '디스플레이 제어',
  '/test-automation': '테스트 자동화',
};

const Header: React.FC = () => {
  const location = useLocation();
  const {
    connected, portPath, setPortPath,
    baudRate, setBaudRate, ports,
    refreshPorts, connect, disconnect,
  } = useSerial({ manageSideEffects: true });

  return (
    <header className="header">
      {/* ── Left: Page Title ── */}
      <div className="header__left">
        <h1 className="header__page-title">
          {PAGE_TITLES[location.pathname] || 'RH850 Pilot'}
        </h1>
      </div>

      {/* ── Right: Serial Controls ── */}
      <div className="header__right">
        <div className="header__serial-group">
          {/* Port Select */}
          <select
            className="select header__port-select"
            value={portPath}
            onChange={(e) => setPortPath(e.target.value)}
            disabled={connected}
          >
            <option value="">포트 선택...</option>
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path} ({p.manufacturer})
              </option>
            ))}
          </select>

          {/* Baud Rate */}
          <select
            className="select header__baud-select"
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            disabled={connected}
          >
            {BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>{rate}</option>
            ))}
          </select>

          {/* Refresh */}
          <button
            className="header__refresh-btn"
            onClick={refreshPorts}
            disabled={connected}
            title="포트 목록 새로고침"
          >
            ↻
          </button>

          <div className="header__divider" />

          {/* Connect / Disconnect */}
          {connected ? (
            <button className="btn btn--danger btn--sm" onClick={disconnect}>
              Disconnect
            </button>
          ) : (
            <button className="btn btn--primary btn--sm" onClick={connect} disabled={!portPath}>
              Connect
            </button>
          )}
        </div>

        {/* Status Indicator */}
        <div className="header__status">
          <span
            className={`header__status-dot ${
              connected ? 'header__status-dot--connected' : 'header__status-dot--disconnected'
            }`}
          />
          <span style={{ color: connected ? 'var(--color-success)' : 'var(--text-tertiary)' }}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
    </header>
  );
};

export default Header;
