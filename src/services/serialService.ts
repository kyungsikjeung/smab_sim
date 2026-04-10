import { PortInfo, SerialConfig, SerialResult, SerialStatus } from 'types';

/**
 * SerialService
 * Electron IPC 시리얼 API를 추상화합니다.
 * 브라우저 개발 환경에서는 Mock 데이터를 반환합니다.
 */
class SerialService {
  private isElectron: boolean;
  private mockDataListeners: Set<(data: string) => void>;
  private mockIntervalId: number | null;
  private mockRohmBytes: Record<number, number>;

  constructor() {
    this.isElectron = !!window.electronAPI;
    this.mockDataListeners = new Set();
    this.mockIntervalId = null;
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

  private ensureMockInterval() {
    if (this.isElectron || this.mockIntervalId !== null) return;

    this.mockIntervalId = window.setInterval(() => {
      if (this.mockDataListeners.size === 0) return;

      const mockLines = [
        '[RH850] System Init OK',
        '[RH850] UART Ready',
        'VoltMon log: ON',
        '[VoltMon] ADC: 15620 14980 30010 17890 10980 25100',
        '[RH850] Display Init String Received',
        'SPI state: 0x0b 0x00 0x00 0x5b FAILDET: HIGH',
      ];
      const randomLine = mockLines[Math.floor(Math.random() * mockLines.length)];
      this.emitMockData(randomLine);
    }, 2000);
  }

  private parseMockNumber(input: string): number | null {
    const trimmed = input.trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return parseInt(trimmed, 16);
    if (/^[0-9]+$/i.test(trimmed)) return parseInt(trimmed, 10);
    return null;
  }

  private formatMockHex(value: number, minimumDigits = 2): string {
    const rawDigits = value.toString(16).toUpperCase().length;
    const digits = Math.max(minimumDigits, rawDigits <= 2 ? 2 : 4);
    return `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;
  }

  private formatMockByte(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, '0');
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

  // ── 포트 목록 조회 ──
  async listPorts(): Promise<PortInfo[]> {
    if (this.isElectron) {
      return window.electronAPI!.serial.listPorts();
    }
    // Mock: 브라우저 개발용
    return [
      { path: 'COM3', manufacturer: 'FTDI', vendorId: '0403', productId: '6001' },
      { path: 'COM5', manufacturer: 'Silicon Labs', vendorId: '10C4', productId: 'EA60' },
      { path: '/dev/ttyUSB0', manufacturer: 'Renesas', vendorId: '045B', productId: '0053' },
    ];
  }

  // ── 포트 연결 ──
  async connect(config: SerialConfig): Promise<SerialResult> {
    if (this.isElectron) {
      return window.electronAPI!.serial.connect(config);
    }
    console.log(`[Mock] 시리얼 연결: ${config.portPath} @ ${config.baudRate}`);
    return { success: true };
  }

  // ── 포트 연결 해제 ──
  async disconnect(): Promise<SerialResult> {
    if (this.isElectron) {
      return window.electronAPI!.serial.disconnect();
    }
    console.log('[Mock] 시리얼 연결 해제');
    return { success: true };
  }

  // ── 데이터 전송 ──
  async write(data: string): Promise<SerialResult> {
    if (this.isElectron) {
      return window.electronAPI!.serial.write(data);
    }
    console.log(`[Mock] TX: ${data}`);
    const normalizedCommand = data.trim();
    if (this.handleMockRohmRead(normalizedCommand) || this.handleMockRohmWrite(normalizedCommand)) {
      return { success: true };
    }
    return { success: true };
  }

  // ── 연결 상태 확인 ──
  async getStatus(): Promise<SerialStatus> {
    if (this.isElectron) {
      return window.electronAPI!.serial.status();
    }
    return { connected: false, port: null };
  }

  // ── 수신 데이터 이벤트 리스너 ──
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

  // ── 에러 이벤트 리스너 ──
  onError(callback: (error: string) => void): () => void {
    if (this.isElectron) {
      return window.electronAPI!.serial.onError(callback);
    }
    return () => {};
  }

  // ── 연결 해제 이벤트 리스너 ──
  onDisconnected(callback: () => void): () => void {
    if (this.isElectron) {
      return window.electronAPI!.serial.onDisconnected(callback);
    }
    return () => {};
  }
}

// 싱글톤 인스턴스
export const serialService = new SerialService();
