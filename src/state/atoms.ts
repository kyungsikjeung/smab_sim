import { atom, selector } from 'recoil';
import {
  PortInfo,
  TerminalLine,
  RegisterEntry,
  RohmRegisterByteMap,
  ErrorFlagSnapshot,
  TestSequence,
  TestResult,
  WarningLight,
  VoltageChannel,
  VoltMonThresholdChannel,
  FaultOutputPinSnapshot,
  GpioMonitorSnapshot,
  DisplayOverlayRect,
} from 'types';
import { createDefaultTestSequences, DEFAULT_TEST_SEQUENCE_ID } from 'data/testAutomationPresets';

// ═══════════════════════════════════════════════
//  Serial Port State
// ═══════════════════════════════════════════════

export const serialConnectedState = atom<boolean>({
  key: 'serialConnected',
  default: false,
});

export const serialPortPathState = atom<string>({
  key: 'serialPortPath',
  default: '',
});

export const serialBaudRateState = atom<number>({
  key: 'serialBaudRate',
  default: 115200,
});

export const availablePortsState = atom<PortInfo[]>({
  key: 'availablePorts',
  default: [],
});

// ═══════════════════════════════════════════════
//  Terminal State
// ═══════════════════════════════════════════════

export const terminalLinesState = atom<TerminalLine[]>({
  key: 'terminalLines',
  default: [],
});

export const terminalAutoScrollState = atom<boolean>({
  key: 'terminalAutoScroll',
  default: true,
});

export const terminalTimestampVisibleState = atom<boolean>({
  key: 'terminalTimestampVisible',
  default: true,
});

export const terminalFilterState = atom<'all' | 'rx' | 'tx' | 'system'>({
  key: 'terminalFilter',
  default: 'all',
});

export const terminalSearchQueryState = atom<string>({
  key: 'terminalSearchQuery',
  default: '',
});

export const filteredTerminalLinesState = selector<TerminalLine[]>({
  key: 'filteredTerminalLines',
  get: ({ get }) => {
    const lines = get(terminalLinesState);
    const filter = get(terminalFilterState);
    const searchQuery = get(terminalSearchQueryState).trim().toLowerCase();

    return lines.filter((line) => {
      const directionMatched = filter === 'all' ? true : line.direction === filter;
      if (!directionMatched) return false;
      if (!searchQuery) return true;

      return line.content.toLowerCase().includes(searchQuery);
    });
  },
});

// ═══════════════════════════════════════════════
//  Register State
// ═══════════════════════════════════════════════

export const registerListState = atom<RegisterEntry[]>({
  key: 'registerList',
  default: [],
});

export const registerLoadingState = atom<boolean>({
  key: 'registerLoading',
  default: false,
});

export const rohmRegisterBytesState = atom<RohmRegisterByteMap>({
  key: 'rohmRegisterBytes',
  default: {},
});

export const errorFlagLatestState = atom<ErrorFlagSnapshot | null>({
  key: 'errorFlagLatest',
  default: null,
});

export const errorFlagHistoryState = atom<ErrorFlagSnapshot[]>({
  key: 'errorFlagHistory',
  default: [],
});

// ═══════════════════════════════════════════════
//  Test Automation State
// ═══════════════════════════════════════════════

export const testSequencesState = atom<TestSequence[]>({
  key: 'testSequences',
  default: createDefaultTestSequences(),
});

export const activeTestIdState = atom<string | null>({
  key: 'activeTestId',
  default: DEFAULT_TEST_SEQUENCE_ID,
});

export const testResultsState = atom<TestResult[]>({
  key: 'testResults',
  default: [],
});

export const testRunningState = atom<boolean>({
  key: 'testRunning',
  default: false,
});

// ═══════════════════════════════════════════════
//  Warning Lights State (1~32)
// ═══════════════════════════════════════════════

export const WARNING_LIGHT_COUNT = 32;

const defaultWarningLights: WarningLight[] = Array.from({ length: WARNING_LIGHT_COUNT }, (_, i) => ({
  id: i + 1,
  label: `Warning ${String(i + 1).padStart(2, '0')}`,
  isOn: false,
}));

export const warningLightsState = atom<WarningLight[]>({
  key: 'warningLights',
  default: defaultWarningLights,
});

// ═══════════════════════════════════════════════
//  Voltage Monitor State (CH1~CH6, 0~3.3V)
// ═══════════════════════════════════════════════

const CHANNEL_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const defaultVoltageChannels: VoltageChannel[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  label: `DC${i + 1}`,
  enabled: i < 2,
  color: CHANNEL_COLORS[i],
  currentValue: 0,
}));

export const voltageChannelsState = atom<VoltageChannel[]>({
  key: 'voltageChannels',
  default: defaultVoltageChannels,
});

export const voltageRangeState = atom<{ min: number; max: number }>({
  key: 'voltageRange',
  default: { min: 0, max: 3.3 },
});

const defaultVoltMonThresholds: VoltMonThresholdChannel[] = Array.from({ length: 6 }, (_, index) => ({
  channelId: index + 1,
  commandIndex: index,
  currentVoltage: null,
  highRaw: 33000,
  highVoltage: 3.3,
  lowRaw: 0,
  lowVoltage: 0,
  rawAdc: null,
  state: null,
  statusText: 'UNKNOWN',
  updatedAt: null,
}));

export const voltMonThresholdsState = atom<VoltMonThresholdChannel[]>({
  key: 'voltMonThresholds',
  default: defaultVoltMonThresholds,
});

export const faultOutputPinsState = atom<FaultOutputPinSnapshot>({
  key: 'faultOutputPins',
  default: {
    extFault: {
      level: 'UNKNOWN',
      source: null,
      updatedAt: null,
    },
    sysFault: {
      level: 'UNKNOWN',
      source: null,
      updatedAt: null,
    },
  },
});

const createDefaultGpioPin = (label: string): GpioMonitorSnapshot['outputs']['sysFault'] => ({
  label,
  level: 'UNKNOWN',
  source: null,
  statusText: null,
  updatedAt: null,
});

export const gpioMonitorState = atom<GpioMonitorSnapshot>({
  key: 'gpioMonitor',
  default: {
    inputs: {
      gmslTpDesLock: createDefaultGpioPin('GMSL(TP_DES_LOCK)'),
      lcdFail: createDefaultGpioPin('LCD_FAIL'),
      ledFail: createDefaultGpioPin('LED_FAIL'),
    },
    lastCommandBytes: null,
    lastHeaderSeenAt: null,
    lastUpdatedAt: null,
    outputs: {
      extFault: createDefaultGpioPin('EXT_FAULT'),
      sysFault: createDefaultGpioPin('SYS_FAULT'),
    },
  },
});

// ═══════════════════════════════════════════════
//  Display Control State
// ═══════════════════════════════════════════════

export const displayInitReceivedState = atom<boolean>({
  key: 'displayInitReceived',
  default: false,
});

export const displayStreamingState = atom<boolean>({
  key: 'displayStreaming',
  default: false,
});

export const displayWindowOpenState = atom<boolean>({
  key: 'displayWindowOpen',
  default: false,
});

export const displayHeartbeatEnabledState = atom<boolean>({
  key: 'displayHeartbeatEnabled',
  default: true,
});

export const displayOverlayRectState = atom<DisplayOverlayRect | null>({
  key: 'displayOverlayRect',
  default: null,
});

export const displayOverlayRectsState = atom<DisplayOverlayRect[]>({
  key: 'displayOverlayRects',
  default: [],
});

// ═══════════════════════════════════════════════
//  UI State
// ═══════════════════════════════════════════════

export const sidebarCollapsedState = atom<boolean>({
  key: 'sidebarCollapsed',
  default: false,
});

export const activePageState = atom<string>({
  key: 'activePage',
  default: '/terminal',
});

export const toastMessageState = atom<{ type: 'info' | 'success' | 'error' | 'warning'; message: string } | null>({
  key: 'toastMessage',
  default: null,
});
