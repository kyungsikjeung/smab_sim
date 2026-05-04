import React, { useCallback, useEffect, useRef } from 'react';
import { useRecoilState } from 'recoil';
import { WARNING_LIGHT_COUNT, warningLightsState } from 'state/atoms';
import { useSerial } from 'hooks/useSerial';
import { WarningLight } from 'types';
import './WarningLights.css';

const toLightsMask = (lights: WarningLight[]) => {
  const bitMask = lights.reduce((acc, light) => {
    const lightBit = light.isOn ? (1 << (light.id - 1)) >>> 0 : 0;
    return (acc | lightBit) >>> 0;
  }, 0);

  return bitMask.toString(16).toUpperCase().padStart(8, '0');
};

const WarningLightsPage: React.FC = () => {
  const { send, connected } = useSerial();
  const [lights, setLights] = useRecoilState(warningLightsState);
  const activeCount = lights.filter((l) => l.isOn).length;
  const totalCount = lights.length || WARNING_LIGHT_COUNT;
  const syncRequestedRef = useRef(false);

  useEffect(() => {
    if (!connected || syncRequestedRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      syncRequestedRef.current = true;
      void send('simlightr');
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [connected, send]);

  const setLightsAndSend = useCallback(
    (nextLights: WarningLight[]) => {
      setLights(nextLights);
      if (connected) {
        send(`lights ${toLightsMask(nextLights)}`);
      }
    },
    [connected, send, setLights]
  );

  const toggleLight = useCallback(
    (id: number) => {
      const nextLights = lights.map((l) => (l.id === id ? { ...l, isOn: !l.isOn } : l));
      setLightsAndSend(nextLights);
    },
    [lights, setLightsAndSend]
  );

  const allOn = useCallback(() => {
    setLightsAndSend(lights.map((l) => ({ ...l, isOn: true })));
  }, [lights, setLightsAndSend]);

  const allOff = useCallback(() => {
    setLightsAndSend(lights.map((l) => ({ ...l, isOn: false })));
  }, [lights, setLightsAndSend]);

  return (
    <div className="warning-page">
      <div className="warning__toolbar">
        <div className="warning__info">
          활성화된 경고등: <strong>{activeCount}</strong> / {totalCount}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--secondary btn--sm" onClick={allOn}>All ON</button>
          <button className="btn btn--ghost btn--sm" onClick={allOff}>All OFF</button>
        </div>
      </div>

      <div className="warning__grid">
        {lights.map((light) => (
          <div
            key={light.id}
            className={`warning__light ${light.isOn ? 'warning__light--on' : ''}`}
            onClick={() => toggleLight(light.id)}
            role="button"
            tabIndex={0}
          >
            <div className="warning__indicator" />
            <span className="warning__light-id">#{String(light.id).padStart(2, '0')}</span>
            <span className="warning__light-label">{light.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WarningLightsPage;
