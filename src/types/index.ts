/** ─── Serial Port Types ─── */

export interface PortInfo {
  path: string;
  manufacturer: string;
  vendorId: string;
  productId: string;
}

export interface SerialConfig {
  portPath: string;
  baudRate: number;
}

export interface SerialResult {
  success: boolean;
  error?: string;
}

export interface SerialStatus {
  connected: boolean;
  port: string | null;
}

/** ─── Electron API (window.electronAPI) ─── */

export interface ElectronSerialAPI {
  listPorts: () => Promise<PortInfo[]>;
  connect: (config: SerialConfig) => Promise<SerialResult>;
  disconnect: () => Promise<SerialResult>;
  write: (data: string) => Promise<SerialResult>;
  status: () => Promise<SerialStatus>;
  onData: (callback: (data: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  onDisconnected: (callback: () => void) => () => void;
}

export interface AutomationScriptRequest {
  fileName: string;
  content: string;
}

export interface AutomationScriptResult {
  success: boolean;
  error?: string;
  pythonCommand?: string;
  scriptPath?: string;
}

export interface AutomationOutputEvent {
  stream: 'status' | 'stdout' | 'stderr';
  message: string;
  timestamp: string;
  exitCode?: number | null;
}

export interface ElectronAutomationAPI {
  startScript: (payload: AutomationScriptRequest) => Promise<AutomationScriptResult>;
  stopScript: () => Promise<AutomationScriptResult>;
  onOutput: (callback: (event: AutomationOutputEvent) => void) => () => void;
}

export interface DisplayWindowResult {
  success: boolean;
  error?: string;
  status?: DisplayWindowStatus;
}

export interface DisplayOverlayRect {
  color: string;
  height: number | null;
  id?: number | string;
  label?: string;
  refColor?: number | null;
  source?: string;
  visible: boolean;
  width: number | null;
  x: number;
  y: number;
}

export interface DisplayOverlayInput {
  color?: string | null;
  height?: number | null;
  id?: number | string;
  label?: string;
  refColor?: number | null;
  source?: string;
  visible?: boolean | null;
  width?: number | null;
  x?: number | null;
  y?: number | null;
}

export interface DisplayOverlayPreset {
  color: string;
  height: number;
  illumi: number;
  label: string;
  refColor: number;
  slot: number;
  smode: number;
  source: string;
  width: number;
  x: number;
  y: number;
}

export interface DisplayWindowStatus {
  backgroundImage?: string | null;
  displayAvailable?: boolean;
  heartbeatEnabled: boolean;
  open: boolean;
  overlayRect: DisplayOverlayRect | null;
  overlayRects: DisplayOverlayRect[];
  url: string;
  error?: string | null;
}

export interface ElectronDisplayAPI {
  openHeartbeatWindow: () => Promise<DisplayWindowResult>;
  closeHeartbeatWindow: () => Promise<DisplayWindowResult>;
  startHeartbeat: () => Promise<DisplayWindowResult>;
  stopHeartbeat: () => Promise<DisplayWindowResult>;
  setHeartbeatEnabled: (enabled: boolean) => Promise<DisplayWindowResult>;
  setOverlayRect: (overlay: DisplayOverlayInput) => Promise<DisplayWindowResult>;
  setOverlayRects: (overlays: DisplayOverlayInput[]) => Promise<DisplayWindowResult>;
  clearOverlayRect: () => Promise<DisplayWindowResult>;
  clearOverlayRects: () => Promise<DisplayWindowResult>;
  status: () => Promise<DisplayWindowStatus>;
  onState: (callback: (status: DisplayWindowStatus) => void) => () => void;
}

export interface HeartbeatDisplayAPI {
  getState: () => Promise<DisplayWindowStatus>;
  onState: (callback: (status: DisplayWindowStatus) => void) => () => void;
}

export interface ElectronAPI {
  serial: ElectronSerialAPI;
  automation: ElectronAutomationAPI;
  display: ElectronDisplayAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    heartbeatDisplay?: HeartbeatDisplayAPI;
  }
}

/** ─── Register Types ─── */

export interface RegisterEntry {
  address: string;
  name: string;
  value: string;
  description: string;
  bitFields?: BitField[];
}

export interface BitField {
  bits: string;
  name: string;
  value: string;
  description: string;
}

export interface RohmSubfieldDefinition {
  address: number;
  end: number;
  length: number;
  offset: number;
  start: number;
}

export interface RohmBitfieldDefinition {
  doc: string;
  name: string;
  readable: number;
  subfields: RohmSubfieldDefinition[];
  writable: number;
}

export interface RohmRegisterMap {
  bitfields: RohmBitfieldDefinition[];
  chip: string;
}

export interface RohmReadResponse {
  addr: number;
  len: number;
  values: number[];
}

export interface RohmProtocolEvent {
  type: 'read-start' | 'read-complete';
  response: RohmReadResponse;
}

export type RegisterValueFormat = 'hex' | 'dec';

export type RohmRegisterByteMap = Record<number, number>;

export interface RohmRegisterFieldRow {
  access: string;
  addressSpan: number[];
  bitLength: number;
  description: string;
  key: string;
  name: string;
  numericValue: number | null;
  primaryAddress: number;
  primaryAddressDec: string;
  primaryAddressHex: string;
  rawValueText: string;
  resolved: boolean;
  valueText: string;
}

/** ─── Test Automation Types ─── */

export interface TestStep {
  id: string;
  type: 'send' | 'wait' | 'expect' | 'delay';
  command?: string;
  expectedResponse?: string;
  matchMode?: 'contains' | 'regex';
  timeoutMs?: number;
  delayMs?: number;
  description: string;
}

export interface SequencePythonScript {
  content: string;
  fileName: string;
  uploadedAt: string;
}

export interface TestSequence {
  id: string;
  name: string;
  description: string;
  pythonScript?: SequencePythonScript | null;
  steps: TestStep[];
  createdAt: string;
}

export interface TestResult {
  sequenceId: string;
  stepResults: StepResult[];
  startedAt: string;
  completedAt: string;
  passed: boolean;
}

export interface StepResult {
  stepId: string;
  status: 'pass' | 'fail' | 'skip' | 'running';
  actualResponse?: string;
  error?: string;
}

/** ─── Warning Light Types ─── */

export interface WarningLight {
  id: number;
  label: string;
  isOn: boolean;
}

/** ─── Voltage Monitor Types ─── */

export interface VoltageChannel {
  id: number;
  label: string;
  enabled: boolean;
  color: string;
  currentValue: number;
}

export interface VoltageFrame {
  timestamp: number;
  values: [number, number, number, number, number, number];
}

export interface VoltMonThresholdChannel {
  channelId: number;
  commandIndex: number;
  currentVoltage: number | null;
  highRaw: number;
  highVoltage: number;
  lowRaw: number;
  lowVoltage: number;
  rawAdc: number | null;
  state: number | null;
  statusText: string;
  updatedAt: number | null;
}

export interface FaultOutputPinSnapshot {
  extFault: {
    level: 'H' | 'L' | 'UNKNOWN';
    source: string | null;
    updatedAt: number | null;
  };
  sysFault: {
    level: 'H' | 'L' | 'UNKNOWN';
    source: string | null;
    updatedAt: number | null;
  };
}

export type GpioSignalLevel = 'HIGH' | 'LOW' | 'UNKNOWN';
export type GpioOutputKey = 'sysFault' | 'extFault';
export type GpioInputKey = 'gmslTpDesLock' | 'lcdFail' | 'ledFail';
export type FaultPinKey = 'sysFault' | 'extFault';

export interface GpioPinSnapshot {
  label: string;
  level: GpioSignalLevel;
  source: string | null;
  statusText: string | null;
  updatedAt: number | null;
}

export interface GpioCommandBytesSnapshot {
  bytes: number[];
  commandId: string;
  raw: string;
  updatedAt: number | null;
}

export interface GpioMonitorSnapshot {
  inputs: Record<GpioInputKey, GpioPinSnapshot>;
  lastCommandBytes: GpioCommandBytesSnapshot | null;
  lastHeaderSeenAt: number | null;
  lastUpdatedAt: number | null;
  outputs: Record<GpioOutputKey, GpioPinSnapshot>;
}

export interface FaultPinSnapshot {
  lastStreamUpdatedAt: number | null;
  lastUpdatedAt: number | null;
  pins: Record<FaultPinKey, GpioPinSnapshot>;
}

export interface FaultPinFrame {
  timestamp: number;
  values: {
    extFault: 0 | 1;
    sysFault: 0 | 1;
  };
}

/** ─── Error Monitor Types ─── */

export interface ErrorFlagDefinition {
  bit: number;
  mask: number;
  meaning: string;
  name: string;
}

export interface ErrorFlagBitStatus extends ErrorFlagDefinition {
  isError: boolean;
  value: 0 | 1 | null;
}

export interface ErrorFlagSnapshot {
  commandName: 'error' | 'err' | 'faultinj';
  flags: number;
  normalizedHex: string;
  rawHex: string;
  receivedAt: number;
  source: string;
}

export interface FaultLogBit {
  bit: number;
  label: string;
}

export interface FaultLogEntry {
  address: string;
  bits: FaultLogBit[];
  entryNumber: number;
  flags: number;
  flagsHex: string;
  isNewest: boolean;
  recentIndex: number;
  totalEntries: number;
  uptime: string;
}

export interface FaultLogParseResult {
  completed: boolean;
  entries: FaultLogEntry[];
  hasHeader: boolean;
  infoLines: string[];
  rawLines: string[];
  totalExpected: number | null;
}

/** ─── Terminal Types ─── */

export interface TerminalLine {
  id: string;
  timestamp: string;
  direction: 'rx' | 'tx' | 'system';
  content: string;
}

/** ─── Navigation ─── */

export type PageRoute =
  | '/terminal'
  | '/commands'
  | '/fault-injection'
  | '/fault-log-monitor'
  | '/fault-pin-monitor'
  | '/error-monitor'
  | '/gpio-monitor'
  | '/register'
  | '/test-automation'
  | '/display-control'
  | '/warning-lights'
  | '/voltage-monitor';
