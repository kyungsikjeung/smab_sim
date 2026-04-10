import { atom, selector } from 'recoil';
import {
  PortInfo,
  TerminalLine,
  RegisterEntry,
  RohmRegisterByteMap,
  TestSequence,
  TestResult,
  WarningLight,
  VoltageChannel,
} from 'types';

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

export const terminalFilterState = atom<'all' | 'rx' | 'tx' | 'system'>({
  key: 'terminalFilter',
  default: 'all',
});

export const filteredTerminalLinesState = selector<TerminalLine[]>({
  key: 'filteredTerminalLines',
  get: ({ get }) => {
    const lines = get(terminalLinesState);
    const filter = get(terminalFilterState);
    if (filter === 'all') return lines;
    return lines.filter((l) => l.direction === filter);
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

// ═══════════════════════════════════════════════
//  Test Automation State
// ═══════════════════════════════════════════════

export const testSequencesState = atom<TestSequence[]>({
  key: 'testSequences',
  default: [],
});

export const activeTestIdState = atom<string | null>({
  key: 'activeTestId',
  default: null,
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
//  Warning Lights State (1~24)
// ═══════════════════════════════════════════════

const defaultWarningLights: WarningLight[] = Array.from({ length: 24 }, (_, i) => ({
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
  enabled: i < 2, // CH1, CH2 기본 활성화
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
