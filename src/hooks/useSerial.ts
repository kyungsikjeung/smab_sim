import { useCallback, useEffect } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import {
  ErrorFlagReadEvent,
  FaultOutputStatusEvent,
  GpioCommandBytesEvent,
  GpioInputStatusEvent,
  GpioOutputStatusEvent,
  SimLightReadEvent,
  VoltMonEvent,
  VoltMonReadEvent,
  VoltMonStatusEvent,
  VoltageSample,
  isGpioStatusHeaderLine,
  parseErrorFlagLine,
  parseFaultOutputLine,
  parseGpioCommandBytesLine,
  parseGpioInputLine,
  parseGpioOutputLine,
  parseSimLightReadLine,
  parseVoltageEvents,
  parseVoltageLine,
  parseVoltMonReadLine,
  parseVoltMonStatusLine,
} from 'services/protocolParser';
import { parseRohmProtocolLine, resetRohmProtocolState } from 'services/rohmProtocol';
import { serialService } from 'services/serialService';
import { pushFrame } from 'services/voltageFrameStore';
import {
  availablePortsState,
  errorFlagHistoryState,
  errorFlagLatestState,
  faultOutputPinsState,
  gpioMonitorState,
  rohmRegisterBytesState,
  serialBaudRateState,
  serialConnectedState,
  serialPortPathState,
  terminalLinesState,
  toastMessageState,
  voltageChannelsState,
  voltMonThresholdsState,
  warningLightsState,
} from 'state/atoms';
import { SerialResult, TerminalLine } from 'types';
import { formatTimeWithMilliseconds } from 'utils/dateTime';

const MAX_TERMINAL_LINES = 1000;
const MAX_ERROR_HISTORY = 50;

let lineIdCounter = 0;
let serialRxLineSeq = 0;

const generateId = () => `line-${Date.now()}-${++lineIdCounter}`;
const getTimestamp = () => formatTimeWithMilliseconds();
const rawVoltMonToVoltage = (rawValue: number) => parseFloat((rawValue / 10000).toFixed(4));

const ansiToClearScreen = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ansiClearScreenCommand = /\x1b\[[0-9;]*J/;
const isIgnorableVoltMonControl = (line: string): boolean => /VoltMon\s+log\s*:\s*(on|off)/i.test(line);

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

const normalizeFaultOutputLevel = (level: 'HIGH' | 'LOW') => (level === 'HIGH' ? 'H' : 'L') as 'H' | 'L';

const mapVoltMonEventToStatus = (eventType: VoltMonEvent['eventType']) => {
  switch (eventType) {
    case 'OnUnderSet':
      return { state: 1, statusText: 'UNDER' };
    case 'OnOverSet':
      return { state: 2, statusText: 'OVER' };
    case 'OnClear':
    case 'OnClearFromOver':
    case 'OnClearFromUnder':
      return { state: 0, statusText: 'OK' };
    default:
      return { state: null, statusText: 'UNKNOWN' };
  }
};

export function useSerial(options: UseSerialOptions = {}) {
  const { manageSideEffects = false } = options;
  const [connected, setConnected] = useRecoilState(serialConnectedState);
  const [portPath, setPortPath] = useRecoilState(serialPortPathState);
  const [baudRate, setBaudRate] = useRecoilState(serialBaudRateState);
  const [ports, setPorts] = useRecoilState(availablePortsState);
  const setTerminalLines = useSetRecoilState(terminalLinesState);
  const setVoltageChannels = useSetRecoilState(voltageChannelsState);
  const setVoltMonThresholds = useSetRecoilState(voltMonThresholdsState);
  const setFaultOutputPins = useSetRecoilState(faultOutputPinsState);
  const setGpioMonitor = useSetRecoilState(gpioMonitorState);
  const setErrorFlagLatest = useSetRecoilState(errorFlagLatestState);
  const setErrorFlagHistory = useSetRecoilState(errorFlagHistoryState);
  const setToast = useSetRecoilState(toastMessageState);
  const setRohmRegisterBytes = useSetRecoilState(rohmRegisterBytesState);
  const setWarningLights = useSetRecoilState(warningLightsState);

  const appendTerminalLine = useCallback((line: TerminalLine) => {
    setTerminalLines((prev) => [...prev.slice(-(MAX_TERMINAL_LINES - 1)), line]);
  }, [setTerminalLines]);

  const applyVoltageSamples = useCallback((samples: VoltageSample[]) => {
    if (!samples.length) return;

    const now = Date.now();
    const frame = buildVoltageFrame(samples, now);

    setVoltageChannels((prev) =>
      prev.map((channel) => {
        const sample = samples.find((entry) => entry.channelId === channel.id);
        if (!sample) return channel;

        return {
          ...channel,
          currentValue: parseFloat(sample.voltage.toFixed(3)),
        };
      })
    );

    setVoltMonThresholds((prev) =>
      prev.map((channel) => {
        const sample = samples.find((entry) => entry.channelId === channel.channelId);
        if (!sample) return channel;

        return {
          ...channel,
          currentVoltage: parseFloat(sample.voltage.toFixed(4)),
          rawAdc: sample.rawValue,
          updatedAt: now,
        };
      })
    );

    if (frame) {
      pushFrame(frame);
    }
  }, [setVoltageChannels, setVoltMonThresholds]);

  const applyVoltMonEvents = useCallback((events: VoltMonEvent[]) => {
    if (!events.length) return;

    const now = Date.now();
    setVoltMonThresholds((prev) =>
      prev.map((channel) => {
        const matched = events.find((event) => event.channelId === channel.channelId);
        if (!matched) return channel;

        const nextStatus = mapVoltMonEventToStatus(matched.eventType);
        return {
          ...channel,
          state: nextStatus.state,
          statusText: nextStatus.statusText,
          updatedAt: now,
        };
      })
    );
  }, [setVoltMonThresholds]);

  const applyVoltMonRead = useCallback((event: VoltMonReadEvent) => {
    const now = Date.now();
    const lowVoltage = rawVoltMonToVoltage(event.lowRaw);
    const highVoltage = rawVoltMonToVoltage(event.highRaw);

    setVoltMonThresholds((prev) =>
      prev.map((channel) => {
        if (channel.channelId !== event.channelId) return channel;

        return {
          ...channel,
          commandIndex: event.commandIndex,
          currentVoltage: event.currentVoltage,
          highRaw: event.highRaw,
          highVoltage,
          lowRaw: event.lowRaw,
          lowVoltage,
          rawAdc: event.rawAdc,
          state: event.state,
          statusText: event.statusText,
          updatedAt: now,
        };
      })
    );

    const currentVoltage = event.currentVoltage;
    if (currentVoltage !== null) {
      setVoltageChannels((prev) =>
        prev.map((channel) => (
          channel.id === event.channelId
            ? {
                ...channel,
                currentValue: parseFloat(currentVoltage.toFixed(3)),
              }
            : channel
        ))
      );
    }
  }, [setVoltMonThresholds, setVoltageChannels]);

  const applyVoltMonStatus = useCallback((event: VoltMonStatusEvent) => {
    const now = Date.now();

    setVoltMonThresholds((prev) =>
      prev.map((channel) => {
        if (channel.channelId !== event.channelId) return channel;

        return {
          ...channel,
          state: event.state,
          statusText: event.statusText,
          updatedAt: now,
        };
      })
    );
  }, [setVoltMonThresholds]);

  const applyFaultOutputStatus = useCallback((event: FaultOutputStatusEvent) => {
    const now = Date.now();

    setFaultOutputPins((prev) => ({
      ...prev,
      [event.key]: {
        level: event.level,
        source: event.source,
        updatedAt: now,
      },
    }));
  }, [setFaultOutputPins]);

  const applyErrorFlagRead = useCallback((event: ErrorFlagReadEvent) => {
    const snapshot = {
      ...event,
      receivedAt: Date.now(),
    };

    setErrorFlagLatest(snapshot);
    setErrorFlagHistory((prev) => [...prev.slice(-(MAX_ERROR_HISTORY - 1)), snapshot]);
  }, [setErrorFlagHistory, setErrorFlagLatest]);

  const applyGpioStatusHeader = useCallback((source: string) => {
    const now = Date.now();

    setGpioMonitor((prev) => ({
      ...prev,
      lastHeaderSeenAt: now,
      lastUpdatedAt: now,
    }));

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[GPIO] header detected: ${source}`);
    }
  }, [setGpioMonitor]);

  const applyGpioOutputStatus = useCallback((event: GpioOutputStatusEvent) => {
    const now = Date.now();

    setGpioMonitor((prev) => ({
      ...prev,
      lastUpdatedAt: now,
      outputs: {
        ...prev.outputs,
        [event.key]: {
          ...prev.outputs[event.key],
          label: event.label,
          level: event.level,
          source: event.source,
          statusText: null,
          updatedAt: now,
        },
      },
    }));

    setFaultOutputPins((prev) => ({
      ...prev,
      [event.key]: {
        level: normalizeFaultOutputLevel(event.level),
        source: event.source,
        updatedAt: now,
      },
    }));
  }, [setFaultOutputPins, setGpioMonitor]);

  const applyGpioInputStatus = useCallback((event: GpioInputStatusEvent) => {
    const now = Date.now();

    setGpioMonitor((prev) => ({
      ...prev,
      inputs: {
        ...prev.inputs,
        [event.key]: {
          ...prev.inputs[event.key],
          label: event.label,
          level: event.level,
          source: event.source,
          statusText: event.statusText,
          updatedAt: now,
        },
      },
      lastUpdatedAt: now,
    }));
  }, [setGpioMonitor]);

  const applyGpioCommandBytes = useCallback((event: GpioCommandBytesEvent) => {
    const now = Date.now();

    setGpioMonitor((prev) => ({
      ...prev,
      lastCommandBytes: {
        bytes: event.bytes,
        commandId: event.commandId,
        raw: event.source,
        updatedAt: now,
      },
      lastUpdatedAt: now,
    }));
  }, [setGpioMonitor]);

  const applySimLightRead = useCallback((event: SimLightReadEvent) => {
    setWarningLights((prev) => (
      prev.map((light) => ({
        ...light,
        isOn: ((event.mask >>> (light.id - 1)) & 0x1) === 1,
      }))
    ));
  }, [setWarningLights]);

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

  const addSystemLine = useCallback((content: string) => {
    appendTerminalLine({
      id: generateId(),
      timestamp: getTimestamp(),
      direction: 'system',
      content,
    });
  }, [appendTerminalLine]);

  const addRxLine = useCallback((rawContent: string) => {
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

    const chunks = content.split('\n').map((chunk) => chunk.trim()).filter(Boolean);
    chunks.forEach((chunk) => {
      const voltMonRead = parseVoltMonReadLine(chunk);
      const voltMonStatus = parseVoltMonStatusLine(chunk);
      const voltageSamples = parseVoltageLine(chunk);
      if (
        process.env.NODE_ENV !== 'production'
        && voltageSamples.length === 0
        && !voltMonRead
        && !voltMonStatus
        && !isIgnorableVoltMonControl(chunk)
        && /VoltMon|ADC|VOLT|전압|voltage/i.test(chunk)
      ) {
        console.warn(`[Voltage Parse] no matched sample: ${chunk}`);
      }

      applyVoltageSamples(voltageSamples);
      applyVoltMonEvents(parseVoltageEvents(chunk));

      if (voltMonRead) {
        applyVoltMonRead(voltMonRead);
      }

      if (voltMonStatus) {
        applyVoltMonStatus(voltMonStatus);
      }

      const faultOutput = parseFaultOutputLine(chunk);
      if (faultOutput) {
        applyFaultOutputStatus(faultOutput);
      }

      const errorFlag = parseErrorFlagLine(chunk);
      if (errorFlag) {
        applyErrorFlagRead(errorFlag);
      }

      if (isGpioStatusHeaderLine(chunk)) {
        applyGpioStatusHeader(chunk);
      }

      const gpioOutput = parseGpioOutputLine(chunk);
      if (gpioOutput) {
        applyGpioOutputStatus(gpioOutput);
      }

      const gpioInput = parseGpioInputLine(chunk);
      if (gpioInput) {
        applyGpioInputStatus(gpioInput);
      }

      const gpioCommandBytes = parseGpioCommandBytesLine(chunk);
      if (gpioCommandBytes) {
        applyGpioCommandBytes(gpioCommandBytes);
      }

      const simLightRead = parseSimLightReadLine(chunk);
      if (simLightRead) {
        applySimLightRead(simLightRead);
      }

      const rohmEvents = parseRohmProtocolLine(chunk);
      rohmEvents.forEach((event) => {
        if (event.type !== 'read-complete') return;
        applyRohmRead(event.response.addr, event.response.values);
      });
    });

    appendTerminalLine({
      id: generateId(),
      timestamp: getTimestamp(),
      direction: 'rx',
      content,
    });
  }, [
    appendTerminalLine,
    applyErrorFlagRead,
    applyFaultOutputStatus,
    applyGpioCommandBytes,
    applyGpioInputStatus,
    applyGpioOutputStatus,
    applyGpioStatusHeader,
    applyRohmRead,
    applySimLightRead,
    applyVoltageSamples,
    applyVoltMonEvents,
    applyVoltMonRead,
    applyVoltMonStatus,
    setTerminalLines,
  ]);

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

  const disconnect = useCallback(async () => {
    resetRohmProtocolState();
    const result = await serialService.disconnect();
    if (result.success) {
      setConnected(false);
      addSystemLine('─ 연결 해제됨');
      setToast({ type: 'info', message: '포트 연결 해제' });
    }
  }, [setConnected, addSystemLine, setToast]);

  const send = useCallback(async (data: string): Promise<SerialResult> => {
    if (!connected) {
      setToast({ type: 'warning', message: '포트가 연결되어 있지 않습니다.' });
      return { success: false, error: '포트가 연결되어 있지 않습니다.' };
    }

    appendTerminalLine({
      id: generateId(),
      timestamp: getTimestamp(),
      direction: 'tx',
      content: data,
    });

    const result = await serialService.write(data);
    if (!result.success) {
      const message = result.error || '시리얼 데이터 전송 실패';
      addSystemLine(`✗ 전송 실패: ${message}`);
      setToast({ type: 'error', message });
    }

    return result;
  }, [addSystemLine, appendTerminalLine, connected, setToast]);

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

  useEffect(() => {
    if (!manageSideEffects) return;

    void syncConnectedState();
    void refreshPorts();
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
