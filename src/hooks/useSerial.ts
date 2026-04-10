import { useCallback, useEffect } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { serialService } from 'services/serialService';
import { parseRohmProtocolLine, resetRohmProtocolState } from 'services/rohmProtocol';
import { pushFrame } from 'services/voltageFrameStore';
import { parseVoltageLine, parseVoltageEvents, VoltageSample, VoltMonEvent } from 'services/protocolParser';
import {
  serialConnectedState,
  serialPortPathState,
  serialBaudRateState,
  availablePortsState,
  rohmRegisterBytesState,
  terminalLinesState,
  voltageChannelsState,
  toastMessageState,
} from 'state/atoms';
import { SerialResult, TerminalLine } from 'types';

/** 고유 ID 생성 유틸 */
let lineIdCounter = 0;
const generateId = () => `line-${Date.now()}-${++lineIdCounter}`;
const getTimestamp = () => new Date().toLocaleTimeString('ko-KR', { hour12: false, fractionalSecondDigits: 3 });

const ansiToClearScreen = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ansiClearScreenCommand = /\x1b\[[0-9;]*J/;
const isIgnorableVoltMonControl = (line: string): boolean => /VoltMon\s+log\s*:\s*(on|off)/i.test(line);
let serialRxLineSeq = 0;

const sanitizeSerialLine = (input: string): string => input.replace(ansiToClearScreen, '').trim();

interface UseSerialOptions {
  manageSideEffects?: boolean;
}

const latestVoltageValues: number[] = new Array(6).fill(Number.NaN);

const buildVoltageFrame = (samples: VoltageSample[], timestamp: number) => {
  if (samples.length === 0) return null;

  samples.forEach((sample) => {
    if (sample.channelId >= 1 && sample.channelId <= 6) {
      latestVoltageValues[sample.channelId - 1] = parseFloat(sample.voltage.toFixed(3));
    }
  });

  if (latestVoltageValues.some((value) => Number.isNaN(value))) {
    return null;
  }

  return {
    timestamp,
    values: [...latestVoltageValues] as [number, number, number, number, number, number],
  };
};

export function useSerial(options: UseSerialOptions = {}) {
  const { manageSideEffects = false } = options;
  const [connected, setConnected] = useRecoilState(serialConnectedState);
  const [portPath, setPortPath] = useRecoilState(serialPortPathState);
  const [baudRate, setBaudRate] = useRecoilState(serialBaudRateState);
  const [ports, setPorts] = useRecoilState(availablePortsState);
  const setTerminalLines = useSetRecoilState(terminalLinesState);
  const setVoltageChannels = useSetRecoilState(voltageChannelsState);
  const setToast = useSetRecoilState(toastMessageState);
  const setRohmRegisterBytes = useSetRecoilState(rohmRegisterBytesState);

  const applyVoltageSamples = useCallback((samples: VoltageSample[]) => {
    if (!samples.length) return;
    const now = Date.now();
    const frame = buildVoltageFrame(samples, now);

    setVoltageChannels((prev) =>
      prev.map((ch) => {
        const sample = samples.find((entry) => entry.channelId === ch.id);
        if (!sample) return ch;

        const nextValue = parseFloat(sample.voltage.toFixed(3));
        if (process.env.NODE_ENV !== 'production') {
          console.log(
            `[Voltage RX] CH${sample.channelId}: raw ${sample.rawValue} -> ${sample.voltage.toFixed(3)}V`
          );
        }

        return {
          ...ch,
          currentValue: nextValue,
        };
      })
    );

    if (frame) {
      pushFrame(frame);
    }
  }, [setVoltageChannels]);

  const logVoltageEvents = useCallback((events: VoltMonEvent[]) => {
    if (!events.length) return;

    events.forEach((event) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[VoltMon Event] CH${event.channelId}: ${event.eventType} (source: ${event.source})`
        );
      }
    });
  }, []);

  const applyRohmRead = useCallback((addr: number, values: number[]) => {
    if (!values.length) return;

    setRohmRegisterBytes((prev) => {
      const next = { ...prev };
      values.forEach((value, index) => {
        next[addr + index] = value;
      });
      return next;
    });
  }, [setRohmRegisterBytes]);

  // 시스템 메시지 추가
  const addSystemLine = useCallback(
    (content: string) => {
      const line: TerminalLine = { id: generateId(), timestamp: getTimestamp(), direction: 'system', content };
      setTerminalLines((prev) => [...prev.slice(-999), line]);
    },
    [setTerminalLines]
  );

  // RX 메시지 추가
    const addRxLine = useCallback(
    (rawContent: string) => {
      const seq = ++serialRxLineSeq;

      const safeRaw = String(rawContent).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Serial][Renderer][RX] #${seq} raw="${safeRaw}"`);
      }

      if (ansiClearScreenCommand.test(rawContent)) {
        setTerminalLines([]);
      }

      const content = sanitizeSerialLine(rawContent);
      if (!content) return;

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[RX RAW] ${content}`);
      }

      const chunks = content.split('\n').map((chunk) => chunk.trim()).filter(Boolean);
      chunks.forEach((chunk) => {
        const voltageSamples = parseVoltageLine(chunk);
        if (
          process.env.NODE_ENV !== 'production'
          && voltageSamples.length === 0
          && !isIgnorableVoltMonControl(chunk)
          && /VoltMon|ADC|VOLT|전압|voltage/i.test(chunk)
        ) {
          console.warn(`[Voltage Parse] no matched sample: ${chunk}`);
        }
        applyVoltageSamples(voltageSamples);
        const voltageEvents = parseVoltageEvents(chunk);
        logVoltageEvents(voltageEvents);
        const rohmEvents = parseRohmProtocolLine(chunk);
        rohmEvents.forEach((event) => {
          if (event.type !== 'read-complete') return;
          applyRohmRead(event.response.addr, event.response.values);
        });
      });

      const line: TerminalLine = { id: generateId(), timestamp: getTimestamp(), direction: 'rx', content };
      setTerminalLines((prev) => [...prev.slice(-999), line]);
    },
    [setTerminalLines, applyRohmRead, applyVoltageSamples, logVoltageEvents]
  );

  // 포트 목록 새로고침
  const refreshPorts = useCallback(async () => {
    const portList = await serialService.listPorts();
    setPorts(portList);
  }, [setPorts]);

  const syncConnectedState = useCallback(async () => {
    const status = await serialService.getStatus();
    if (status.connected && status.port) {
      setConnected(true);
      setPortPath(status.port);
      addSystemLine(`✓ 시리얼 연결 상태 복구: ${status.port}`);
    }
  }, [addSystemLine, setConnected, setPortPath]);

  // 연결
  const connect = useCallback(async () => {
    if (!portPath) {
      setToast({ type: 'warning', message: '포트를 선택해주세요.' });
      return;
    }
    resetRohmProtocolState();
    const result = await serialService.connect({ portPath, baudRate });
    if (result.success) {
      setConnected(true);
      addSystemLine(`✓ ${portPath} 연결됨 (${baudRate} baud)`);
      setToast({ type: 'success', message: `${portPath} 연결 성공` });
      return;
    }

    if (result.error === '이미 연결된 포트가 있습니다.') {
      const status = await serialService.getStatus();
      if (status.connected) {
        setConnected(true);
        const finalPort = status.port || portPath;
        setPortPath(finalPort);
        addSystemLine(`✓ 기존 연결 유지: ${finalPort}`);
        setToast({ type: 'info', message: `시리얼이 이미 연결된 상태입니다 (${finalPort})` });
        return;
      }
    }

    setToast({ type: 'error', message: result.error || '연결 실패' });
    addSystemLine(`✗ 연결 실패: ${result.error}`);
    setConnected(false);
  }, [portPath, baudRate, setConnected, addSystemLine, setToast, setPortPath]);

  // 연결 해제
  const disconnect = useCallback(async () => {
    resetRohmProtocolState();
    const result = await serialService.disconnect();
    if (result.success) {
      setConnected(false);
      addSystemLine('─ 연결 해제됨');
      setToast({ type: 'info', message: '포트 연결 해제' });
    }
  }, [setConnected, addSystemLine, setToast]);

  // 데이터 전송
  const send = useCallback(
    async (data: string): Promise<SerialResult> => {
      if (!connected) {
        setToast({ type: 'warning', message: '포트가 연결되어 있지 않습니다.' });
        return { success: false, error: '포트가 연결되어 있지 않습니다.' };
      }
      const txLine: TerminalLine = { id: generateId(), timestamp: getTimestamp(), direction: 'tx', content: data };
      setTerminalLines((prev) => [...prev.slice(-999), txLine]);
      const result = await serialService.write(data);
      if (!result.success) {
        const message = result.error || '시리얼 데이터 전송 실패';
        addSystemLine(`✗ 전송 실패: ${message}`);
        setToast({ type: 'error', message });
      }
      return result;
    },
    [addSystemLine, connected, setTerminalLines, setToast]
  );

  // 시리얼 이벤트 리스너 등록
  useEffect(() => {
    if (!manageSideEffects) return undefined;

    const unsubData = serialService.onData((data) => addRxLine(data));
    const unsubError = serialService.onError((error) => {
      addSystemLine(`✗ 에러: ${error}`);
      setToast({ type: 'error', message: error });
    });
    const unsubDisconnected = serialService.onDisconnected(() => {
      resetRohmProtocolState();
      setConnected(false);
      addSystemLine('─ 연결이 끊어졌습니다');
      setToast({ type: 'warning', message: '시리얼 연결이 끊어졌습니다' });
    });

    return () => {
      unsubData();
      unsubError();
      unsubDisconnected();
    };
  }, [addRxLine, addSystemLine, manageSideEffects, setConnected, setToast]);

  // 초기 포트 목록 로드
  useEffect(() => {
    if (!manageSideEffects) return;

    syncConnectedState();
    refreshPorts();
  }, [manageSideEffects, refreshPorts, syncConnectedState]);

  return {
    connected,
    portPath,
    setPortPath,
    baudRate,
    setBaudRate,
    ports,
    refreshPorts,
    connect,
    disconnect,
    send,
  };
}
