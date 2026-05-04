import { PortInfo, SerialConfig, SerialResult, SerialStatus } from 'types';

type MockFaultLevel = 'HIGH' | 'LOW';

interface MockVoltMonChannel {
  channelId: number;
  commandIndex: number;
  highRaw: number;
  lowRaw: number;
  rawAdc: number;
}

/**
 * SerialService
 * Electron IPC 시리얼 API를 추상화합니다.
 * 브라우저 개발 환경에서는 Mock 데이터를 반환합니다.
 */
class SerialService {
  private isElectron: boolean;
  private mockDataListeners: Set<(data: string) => void>;
  private mockDisconnectedListeners: Set<() => void>;
  private mockErrorListeners: Set<(error: string) => void>;
  private mockFaultOutputLevels: { extFault: MockFaultLevel; sysFault: MockFaultLevel };
  private mockGpioInputs: { gmslTpDesLock: MockFaultLevel; lcdFail: MockFaultLevel; ledFail: MockFaultLevel };
  private mockConnected: boolean;
  private mockErrorFlags: number;
  private mockIntervalId: number | null;
  private mockPort: string | null;
  private mockRohmBytes: Record<number, number>;
  private mockVoltMonChannels: MockVoltMonChannel[];
  private mockWarningLightMask: number;

  constructor() {
    this.isElectron = !!window.electronAPI;
    this.mockDataListeners = new Set();
    this.mockDisconnectedListeners = new Set();
    this.mockErrorListeners = new Set();
    this.mockConnected = false;
    this.mockErrorFlags = 0x00000000;
    this.mockIntervalId = null;
    this.mockPort = null;
    this.mockFaultOutputLevels = {
      extFault: 'HIGH',
      sysFault: 'LOW',
    };
    this.mockGpioInputs = {
      gmslTpDesLock: 'HIGH',
      lcdFail: 'LOW',
      ledFail: 'HIGH',
    };
    this.mockVoltMonChannels = [
      { channelId: 1, commandIndex: 0, lowRaw: 0, highRaw: 33000, rawAdc: 15620 },
      { channelId: 2, commandIndex: 1, lowRaw: 0, highRaw: 33000, rawAdc: 14980 },
      { channelId: 3, commandIndex: 2, lowRaw: 0, highRaw: 33000, rawAdc: 30010 },
      { channelId: 4, commandIndex: 3, lowRaw: 0, highRaw: 33000, rawAdc: 17890 },
      { channelId: 5, commandIndex: 4, lowRaw: 0, highRaw: 33000, rawAdc: 10980 },
      { channelId: 6, commandIndex: 5, lowRaw: 0, highRaw: 33000, rawAdc: 25100 },
    ];
    this.mockWarningLightMask = 0x00000005;
    this.mockRohmBytes = {
      0x53: 0x6f,
      0x52: 0x03,
      0x7e: 0x02,
      0x7f: 0x01,
      0x80: 0x01,
      0x83: 0x2a,
      0x110: 0x52,
      0x111: 0x01,
      0x128: 0x00,
      0x129: 0x00,
      0x12a: 0x00,
      0x12b: 0x00,
      0x12c: 0x00,
      0x12d: 0x00,
    };
  }

  private emitMockData(line: string) {
    this.mockDataListeners.forEach((listener) => listener(line));
  }

  private emitMockDataLines(lines: string[], intervalMs = 24) {
    lines.forEach((line, index) => {
      window.setTimeout(() => {
        this.emitMockData(line);
      }, index * intervalMs);
    });
  }

  private ensureMockInterval() {
    if (this.isElectron || this.mockIntervalId !== null) return;

    this.mockIntervalId = window.setInterval(() => {
      if (!this.mockConnected || this.mockDataListeners.size === 0) return;

      this.mockVoltMonChannels = this.mockVoltMonChannels.map((channel) => {
        const jitter = Math.round((Math.random() - 0.5) * 900);
        const nextRaw = Math.min(33000, Math.max(0, channel.rawAdc + jitter));
        return {
          ...channel,
          rawAdc: nextRaw,
        };
      });

      const rawPayload = this.mockVoltMonChannels.map((channel) => channel.rawAdc).join(' ');
      this.emitMockData(`[VoltMon] ADC: ${rawPayload}`);

      if (Math.random() > 0.84) {
        this.mockErrorFlags ^= (1 << Math.floor(Math.random() * 6)) >>> 0;
        this.emitMockData(`[error] flags=${this.toNormalizedHex(this.mockErrorFlags)}`);
      }
    }, 2000);
  }

  private parseMockNumber(input: string): number | null {
    const trimmed = input.trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return parseInt(trimmed, 16);
    if (/^[0-9]+$/i.test(trimmed)) return parseInt(trimmed, 10);
    return null;
  }

  private toNormalizedHex(value: number) {
    return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  }

  private formatMockHex(value: number, minimumDigits = 2): string {
    const rawDigits = value.toString(16).toUpperCase().length;
    const digits = Math.max(minimumDigits, rawDigits <= 2 ? 2 : 4);
    return `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;
  }

  private formatMockByte(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, '0');
  }

  private formatMockLightBytes(mask: number): string {
    const bytes = [
      (mask >>> 24) & 0xff,
      (mask >>> 16) & 0xff,
      (mask >>> 8) & 0xff,
      mask & 0xff,
    ];

    return bytes.map((value) => `0x${this.formatMockByte(value)}`).join(', ');
  }

  private deriveVoltMonStatus(channel: MockVoltMonChannel) {
    if (channel.rawAdc < channel.lowRaw) {
      return { state: 1, statusText: 'UNDER' };
    }

    if (channel.rawAdc > channel.highRaw) {
      return { state: 2, statusText: 'OVER' };
    }

    return { state: 0, statusText: 'OK' };
  }

  private toVoltage(rawAdc: number) {
    return (rawAdc / 10000).toFixed(4);
  }

  private emitMockVoltMonRead() {
    const lines = this.mockVoltMonChannels.map((channel) => {
      const status = this.deriveVoltMonStatus(channel);
      return `[VoltMon] CH${channel.channelId}: low=${channel.lowRaw} high=${channel.highRaw} raw=${channel.rawAdc} state=${status.state} status=${status.statusText} voltage=${this.toVoltage(channel.rawAdc)}`;
    });
    this.emitMockDataLines(lines);
  }

  private handleMockVoltMonRead(command: string): boolean {
    if (!/^voltmon\s+read\b/i.test(command)) return false;

    window.setTimeout(() => {
      this.emitMockVoltMonRead();
    }, 40);

    return true;
  }

  private handleMockVoltMonSet(command: string): boolean {
    const match = command.match(/^voltmon\s+set\s+(\d+)\s+(\d+)\s+(\d+)$/i);
    if (!match) return false;

    const commandIndex = Number.parseInt(match[1], 10);
    const lowRaw = Number.parseInt(match[2], 10);
    const highRaw = Number.parseInt(match[3], 10);
    const channel = this.mockVoltMonChannels.find((entry) => entry.commandIndex === commandIndex);
    if (!channel) return true;

    channel.lowRaw = lowRaw;
    channel.highRaw = highRaw;

    window.setTimeout(() => {
      this.emitMockData(`[VoltMon] set ch=${commandIndex} low=${lowRaw} high=${highRaw}`);
      const status = this.deriveVoltMonStatus(channel);
      this.emitMockData(
        `[VoltMon] CH${channel.channelId}: low=${channel.lowRaw} high=${channel.highRaw} raw=${channel.rawAdc} state=${status.state} status=${status.statusText} voltage=${this.toVoltage(channel.rawAdc)}`
      );
    }, 40);

    return true;
  }

  private handleMockFaultOut(command: string): boolean {
    if (!/^faultout\b/i.test(command)) return false;

    const sysState = this.mockFaultOutputLevels.sysFault === 'HIGH' ? 'NORMAL(HIGH)' : 'FAULT(LOW)';
    const extState = this.mockFaultOutputLevels.extFault === 'HIGH' ? 'NORMAL(HIGH)' : 'FAULT(LOW)';

    window.setTimeout(() => {
      this.emitMockData(`[FaultHandler] SYS fault output -> ${sysState}`);
      this.emitMockData(`[FaultHandler] EXT fault output -> ${extState}`);
    }, 30);

    return true;
  }

  private handleMockGpioStatus(command: string): boolean {
    if (!/^gpio_status\b/i.test(command)) return false;

    window.setTimeout(() => {
      this.emitMockDataLines([
        '=== GPIO Status ===',
        `  [OUT] SYS_FAULT        : ${this.mockFaultOutputLevels.sysFault}`,
        `  [OUT] EXT_FAULT        : ${this.mockFaultOutputLevels.extFault}`,
        `  [IN ] GMSL(TP_DES_LOCK): ${this.mockGpioInputs.gmslTpDesLock} (NORMAL)`,
        `  [IN ] LCD_FAIL         : ${this.mockGpioInputs.lcdFail} (NORMAL)`,
        `  [IN ] LED_FAIL         : ${this.mockGpioInputs.ledFail} (NORMAL)`,
        '  [CMD0x06] bytes        : 0 1 5 0',
      ]);
    }, 30);

    return true;
  }

  private handleMockErrorRead(command: string): boolean {
    const match = command.match(/^(error|err|faultinj)\s+read\b/i);
    if (!match) return false;

    window.setTimeout(() => {
      this.emitMockData(`[${match[1].toLowerCase()}] flags=${this.toNormalizedHex(this.mockErrorFlags)}`);
    }, 30);

    return true;
  }

  private handleMockSimLightRead(command: string): boolean {
    if (!/^simlightr\b/i.test(command)) return false;

    window.setTimeout(() => {
      this.emitMockData(`simlightr: RX=[${this.formatMockLightBytes(this.mockWarningLightMask)}]`);
    }, 30);

    return true;
  }

  private handleMockLightsWrite(command: string): boolean {
    const match = command.match(/^lights\s+([0-9a-fA-F]{1,8})$/i);
    if (!match) return false;

    const nextMask = Number.parseInt(match[1], 16);
    if (!Number.isFinite(nextMask)) return true;

    this.mockWarningLightMask = nextMask >>> 0;
    return true;
  }

  private handleMockFaultLogLatest(command: string): boolean {
    if (!/^flog\s+latest\b/i.test(command)) return false;

    window.setTimeout(() => {
      this.emitMockDataLines([
        '[I][flash_mgr] Read fault ptr raw 0xFFE198 -> use 0xFFE198',
        '[I][flash_mgr] Recovered next fault ptr from checkpoint 0xFFE198 -> 0xFFE5F8',
        '=== Fault Log Recent (5 max) ===',
        '[I][flash_mgr] Read fault ptr raw 0xFFE198 -> use 0xFFE198',
        '[I][flash_mgr] Recovered next fault ptr from checkpoint 0xFFE198 -> 0xFFE5F8',
        'Entry: 1/5 (recent_idx=0, newest)',
        'Addr: 0xFFE5F0',
        'Uptime: 0:1:26.58',
        'Flags: 0x20000',
        'Bits:',
        '- bit17 NM_IMG_CRC',
        '[I][flash_mgr] Read fault ptr raw 0xFFE198 -> use 0xFFE198',
        '[I][flash_mgr] Recovered next fault ptr from checkpoint 0xFFE198 -> 0xFFE5F8',
        'Entry: 2/5 (recent_idx=1)',
        'Addr: 0xFFE5E8',
        'Uptime: 0:0:0.3',
        'Flags: 0x8000',
        'Bits:',
        '- bit15 WDG_FAIL',
        '[I][flash_mgr] Read fault ptr raw 0xFFE198 -> use 0xFFE198',
        '[I][flash_mgr] Recovered next fault ptr from checkpoint 0xFFE198 -> 0xFFE5F8',
        'Entry: 3/5 (recent_idx=2)',
        'Addr: 0xFFE5E0',
        'Uptime: 0:13:28.3',
        'Flags: 0x8000',
        'Bits:',
        '- bit15 WDG_FAIL',
        '[I][flash_mgr] Read fault ptr raw 0xFFE198 -> use 0xFFE198',
        '[I][flash_mgr] Recovered next fault ptr from checkpoint 0xFFE198 -> 0xFFE5F8',
        'Entry: 4/5 (recent_idx=3)',
        'Addr: 0xFFE5D8',
        'Uptime: 0:13:6.88',
        'Flags: 0x10000',
        'Bits:',
        '- bit16 LVDS_VID_FREEZE',
        '[I][flash_mgr] Read fault ptr raw 0xFFE198 -> use 0xFFE198',
        '[I][flash_mgr] Recovered next fault ptr from checkpoint 0xFFE198 -> 0xFFE5F8',
        'Entry: 5/5 (recent_idx=4)',
        'Addr: 0xFFE5D0',
        'Uptime: 0:13:2.78',
        'Flags: 0x10000',
        'Bits:',
        '- bit16 LVDS_VID_FREEZE',
      ]);
    }, 40);

    return true;
  }

  private handleMockRohmRead(command: string): boolean {
    const match = command.match(/^rohm_rd_prm(?:1b)?\s+(\S+)(?:\s+(\S+))?$/i);
    if (!match) return false;

    const address = this.parseMockNumber(match[1]);
    const length = this.parseMockNumber(match[2] || '1');
    if (address === null || length === null || length <= 0) return true;

    window.setTimeout(() => {
      const values = Array.from({ length }, (_, index) => {
        const currentAddress = address + index;
        if (typeof this.mockRohmBytes[currentAddress] !== 'number') {
          this.mockRohmBytes[currentAddress] = (currentAddress * 37 + 0x4d) & 0xff;
        }
        return this.mockRohmBytes[currentAddress];
      });

      this.emitMockData(`[ROHM] RD_PRM addr=${this.formatMockHex(address)} len=${length}`);
      this.emitMockData(`${address.toString(16).toUpperCase()}: ${values.map((value) => this.formatMockByte(value)).join(' ')}`);
    }, 50);

    return true;
  }

  private handleMockRohmWrite(command: string): boolean {
    const match = command.match(/^rohm_wr_prm(?:1b)?\s+(\S+)\s+(\S+)$/i);
    if (!match) return false;

    const address = this.parseMockNumber(match[1]);
    if (address === null) return true;

    const dataToken = match[2].replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '');
    const normalizedToken = dataToken.length % 2 === 0 ? dataToken : `0${dataToken}`;
    const bytes = normalizedToken.match(/[0-9a-f]{2}/gi)?.map((token) => parseInt(token, 16)) || [];
    if (bytes.length === 0) return true;

    bytes.forEach((value, index) => {
      this.mockRohmBytes[address + index] = value;
    });

    window.setTimeout(() => {
      this.emitMockData(`[ROHM] WR_PRM addr=${this.formatMockHex(address)} len=${bytes.length}`);
    }, 30);

    return true;
  }

  async listPorts(): Promise<PortInfo[]> {
    if (this.isElectron) {
      return window.electronAPI!.serial.listPorts();
    }

    return [
      { path: 'COM3', manufacturer: 'FTDI', vendorId: '0403', productId: '6001' },
      { path: 'COM5', manufacturer: 'Silicon Labs', vendorId: '10C4', productId: 'EA60' },
      { path: '/dev/ttyUSB0', manufacturer: 'Renesas', vendorId: '045B', productId: '0053' },
    ];
  }

  async connect(config: SerialConfig): Promise<SerialResult> {
    if (this.isElectron) {
      return window.electronAPI!.serial.connect(config);
    }

    this.mockConnected = true;
    this.mockPort = config.portPath;
    this.ensureMockInterval();

    window.setTimeout(() => {
      this.emitMockData('[RH850] System Init OK');
      this.emitMockData('[RH850] UART Ready');
      this.emitMockData('[RH850] Display Init String Received');
      this.emitMockData(`[VoltMon] ADC: ${this.mockVoltMonChannels.map((channel) => channel.rawAdc).join(' ')}`);
    }, 80);

    return { success: true };
  }

  async disconnect(): Promise<SerialResult> {
    if (this.isElectron) {
      return window.electronAPI!.serial.disconnect();
    }

    this.mockConnected = false;
    this.mockPort = null;
    return { success: true };
  }

  async write(data: string): Promise<SerialResult> {
    if (this.isElectron) {
      return window.electronAPI!.serial.write(data);
    }

    if (!this.mockConnected) {
      return { success: false, error: '포트가 연결되어 있지 않습니다.' };
    }

    const normalizedCommand = data.trim();
    if (
      this.handleMockVoltMonRead(normalizedCommand)
      || this.handleMockVoltMonSet(normalizedCommand)
      || this.handleMockFaultOut(normalizedCommand)
      || this.handleMockGpioStatus(normalizedCommand)
      || this.handleMockErrorRead(normalizedCommand)
      || this.handleMockSimLightRead(normalizedCommand)
      || this.handleMockLightsWrite(normalizedCommand)
      || this.handleMockFaultLogLatest(normalizedCommand)
      || this.handleMockRohmRead(normalizedCommand)
      || this.handleMockRohmWrite(normalizedCommand)
    ) {
      return { success: true };
    }

    return { success: true };
  }

  async getStatus(): Promise<SerialStatus> {
    if (this.isElectron) {
      return window.electronAPI!.serial.status();
    }

    return {
      connected: this.mockConnected,
      port: this.mockPort,
    };
  }

  onData(callback: (data: string) => void): () => void {
    if (this.isElectron) {
      return window.electronAPI!.serial.onData(callback);
    }

    this.mockDataListeners.add(callback);
    this.ensureMockInterval();

    return () => {
      this.mockDataListeners.delete(callback);
      if (this.mockDataListeners.size === 0 && this.mockIntervalId !== null) {
        window.clearInterval(this.mockIntervalId);
        this.mockIntervalId = null;
      }
    };
  }

  onError(callback: (error: string) => void): () => void {
    if (this.isElectron) {
      return window.electronAPI!.serial.onError(callback);
    }

    this.mockErrorListeners.add(callback);
    return () => {
      this.mockErrorListeners.delete(callback);
    };
  }

  onDisconnected(callback: () => void): () => void {
    if (this.isElectron) {
      return window.electronAPI!.serial.onDisconnected(callback);
    }

    this.mockDisconnectedListeners.add(callback);
    return () => {
      this.mockDisconnectedListeners.delete(callback);
    };
  }
}

export const serialService = new SerialService();
