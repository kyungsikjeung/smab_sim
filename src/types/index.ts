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

export interface ElectronAPI {
  serial: ElectronSerialAPI;
  automation: ElectronAutomationAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
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
  delayMs?: number;
  description: string;
}

export interface TestSequence {
  id: string;
  name: string;
  description: string;
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
  id: number;       // 1~24
  label: string;
  isOn: boolean;
}

/** ─── Voltage Monitor Types ─── */

export interface VoltageChannel {
  id: number;       // 1~6
  label: string;
  enabled: boolean;
  color: string;
  currentValue: number;
}

export interface VoltageFrame {
  timestamp: number;
  values: [number, number, number, number, number, number];
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
  | '/register'
  | '/rohm-monitor'
  | '/test-automation'
  | '/display-control'
  | '/warning-lights'
  | '/voltage-monitor';
