import {
  RegisterValueFormat,
  RohmBitfieldDefinition,
  RohmRegisterByteMap,
  RohmRegisterFieldRow,
  RohmRegisterMap,
} from 'types';

const sortNumeric = (a: number, b: number) => a - b;

const getAddressDigits = (value: number, minimumDigits: number): number => {
  const rawDigits = value.toString(16).toUpperCase().length;
  return Math.max(minimumDigits, rawDigits);
};

export const formatRohmHex = (value: number, minimumDigits = 2): string =>
  `0x${value.toString(16).toUpperCase().padStart(getAddressDigits(value, minimumDigits), '0')}`;

export const formatRohmByte = (value: number): string =>
  `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;

export const parseFlexibleNumber = (input: string): number | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return parseInt(trimmed, 16);
  }

  if (/^[0-9]+$/i.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  return null;
};

export const getUniqueRegisterAddresses = (registerMap: RohmRegisterMap): number[] => {
  const addresses = new Set<number>();
  registerMap.bitfields.forEach((field) => {
    field.subfields.forEach((subfield) => {
      addresses.add(subfield.address);
    });
  });
  return Array.from(addresses).sort(sortNumeric);
};

const getFieldBitRange = (field: RohmBitfieldDefinition) => {
  const starts = field.subfields.map((subfield) => subfield.start);
  const ends = field.subfields.map((subfield) => subfield.end);

  return {
    minStart: Math.min(...starts),
    maxEnd: Math.max(...ends),
  };
};

const getFieldBitLength = (field: RohmBitfieldDefinition): number => {
  const { minStart, maxEnd } = getFieldBitRange(field);
  return maxEnd - minStart + 1;
};

const getFieldAddressSpan = (field: RohmBitfieldDefinition): number[] =>
  Array.from(new Set(field.subfields.map((subfield) => subfield.address))).sort(sortNumeric);

export const getRohmFieldKey = (field: RohmBitfieldDefinition): string => {
  const addressSpan = getFieldAddressSpan(field);
  return `${addressSpan[0]}-${field.name}`;
};

const resolveFieldValue = (field: RohmBitfieldDefinition, rawBytes: RohmRegisterByteMap) => {
  const { minStart } = getFieldBitRange(field);
  let value = 0;

  for (const subfield of field.subfields) {
    const rawByte = rawBytes[subfield.address];
    if (typeof rawByte !== 'number') {
      return {
        resolved: false,
        value: null as number | null,
      };
    }

    const mask = (1 << subfield.length) - 1;
    const source = (rawByte >> subfield.offset) & mask;
    value += source * (2 ** (subfield.start - minStart));
  }

  return {
    resolved: true,
    value,
  };
};

export const formatRohmFieldValue = (
  fieldValue: number | null,
  bitLength: number,
  format: RegisterValueFormat
): string => {
  if (fieldValue === null) return '--';
  if (format === 'dec') return `${fieldValue}`;
  const hexDigits = Math.max(1, Math.ceil(bitLength / 4));
  return `0x${fieldValue.toString(16).toUpperCase().padStart(hexDigits, '0')}`;
};

const formatFieldRawBytes = (addresses: number[], rawBytes: RohmRegisterByteMap): string =>
  addresses
    .map((address) => (typeof rawBytes[address] === 'number' ? formatRohmByte(rawBytes[address]) : '??'))
    .join(' ');

const formatAccess = (field: RohmBitfieldDefinition): string => {
  if (field.readable && field.writable) return 'R/W';
  if (field.readable) return 'R';
  if (field.writable) return 'W';
  return '-';
};

const FIELD_TOKEN_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  AGING: 'Aging',
  AUTO: 'Auto',
  B: 'Blue',
  BDP: 'BDP',
  BG: 'Background',
  BIST: 'BIST',
  BLANK: 'Blank',
  CALC: 'Calculation',
  CALCDATA: 'Calculation Data',
  CH: 'Channel',
  CHK: 'Check',
  CHKSUM: 'Checksum',
  CHR: 'Character',
  CLK: 'Clock',
  CNT: 'Counter',
  COLOR: 'Color',
  COORD: 'Coordinate',
  CRC: 'CRC',
  CS: 'Checksum',
  CTRL: 'Control',
  DATA: 'Data',
  DE: 'DE',
  DET: 'Detect',
  DIS: 'Disable',
  DISP: 'Display',
  DMAP: 'DMAP',
  DRV: 'Driver',
  EN: 'Enable',
  ERR: 'Error',
  ERRLV: 'Error Level',
  FAIL: 'Fail',
  FAILDET: 'FAIL_DET',
  FLIPMODE: 'Flip Mode',
  FREQ: 'Frequency',
  FRAMCNT: 'Frame Count',
  G: 'Green',
  H: 'Latched',
  HIGHT: 'Height',
  HP1: 'H Position 1',
  HP2: 'H Position 2',
  HS: 'HSYNC',
  IMG: 'IMG',
  INV: 'Invert',
  IRQ: 'IRQ',
  LVDS: 'LVDS',
  LVRX: 'LVDS Rx',
  LVTX: 'LVDS Tx',
  MAP: 'Map',
  MAX: 'Max',
  MIN: 'Min',
  MODE: 'Mode',
  MSPI: 'MSPI',
  OEC: 'OEC',
  OFF: 'Off',
  ON: 'On',
  OSC: 'OSC',
  OSD: 'OSD',
  OSD1: 'OSD1',
  OSD2: 'OSD2',
  PARAM1: 'Param1',
  PARAM2: 'Param2',
  PGEN: 'Pattern Generator',
  PIN: 'Pin',
  PORCH: 'Porch',
  R: '현재',
  REF: 'Refresh',
  REG: 'Register',
  ROM: 'ROM',
  RX: 'Rx',
  SCK: 'SCK',
  SDI: 'SDI',
  SDO: 'SDO',
  SEL: 'Select',
  SEQ: 'Sequence',
  SINGLE: 'Single',
  SIZE: 'Size',
  SPACE: 'Space',
  SPI: 'SPI',
  SSCG: 'SSCG',
  SSN: 'SSN',
  SSPI: 'SSPI',
  ST: 'Status',
  START: 'Start',
  STATUS: 'Status',
  SWAP: 'Swap',
  SYNC: 'Sync',
  SYSTEM: 'System',
  TIME: 'Time',
  TIMEOUT: 'Timeout',
  TOTAL: 'Total',
  TX: 'Tx',
  UP: 'Update',
  UPCNT: 'Update Counter',
  V: 'Vertical',
  VCHKSUM: 'VCHKSUM',
  VOD: 'VOD',
  VP1: 'V Position 1',
  VP2: 'V Position 2',
  VS: 'VSYNC',
  VSBIMC: 'VSB/IMC',
  WD: 'Watchdog',
  WHITE: 'White',
  WIDTH: 'Width',
  WINDOW: 'Window',
  X: 'X',
  Y: 'Y',
};

const FIELD_SUFFIX_TOKENS = new Set([
  'DIS',
  'EN',
  'INV',
  'SEL',
  'MODE',
  'R',
  'H',
]);

const compactText = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();

const toFieldSubject = (name: string): string => {
  const tokens = name.split(/[_\s]+/).filter(Boolean);
  const subjectTokens = tokens.length > 1 && FIELD_SUFFIX_TOKENS.has(tokens[tokens.length - 1])
    ? tokens.slice(0, -1)
    : tokens;

  return subjectTokens
    .map((token) => FIELD_TOKEN_LABELS[token] || token)
    .join(' ');
};

const cleanChoiceValue = (value: string): string =>
  compactText(value)
    .replace(/\bEnable\b/gi, 'Enable')
    .replace(/\bDisable\b/gi, 'Disable')
    .replace(/\bNegative Logic\b/gi, 'Negative')
    .replace(/\bPositive Logic\b/gi, 'Positive')
    .replace(/\bOutput\b/gi, 'Output')
    .replace(/\binput\b/gi, 'input')
    .replace(/\bRefresh OFF\b/gi, 'Refresh OFF')
    .replace(/\bRefresh ON\b/gi, 'Refresh ON')
    .replace(/\bChecksum OFF\b/gi, 'Checksum OFF')
    .replace(/\bChecksum ON\b/gi, 'Checksum ON')
    .split(/\bWhen\b|\bIf\b|\bDevice\b|[.;]/i)[0]
    .trim();

const formatDocChoices = (doc: string): string[] => {
  const choices: string[] = [];
  const optionRegex = /\{\s*([^}]+)\s*\}\s*=\s*([^{}()]*?)(?=\s*\{|[),]|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = optionRegex.exec(doc)) !== null && choices.length < 4) {
    const key = compactText(match[1]);
    const value = cleanChoiceValue(match[2]);

    if (!key || !value) {
      continue;
    }

    choices.push(`${key}: ${value}`);
  }

  return choices;
};

const inferDescriptionAction = (field: RohmBitfieldDefinition, doc: string): string => {
  const name = field.name;

  if (/write\s+1\s+to\s+clear/i.test(doc) || /_H(?:_|$)/.test(name) || name.endsWith('_H')) {
    return 'latched 상태. 1 쓰면 clear';
  }

  if (/_R(?:_|$)/.test(name) || name.endsWith('_R') || /\bState\b/i.test(doc)) {
    return '현재 상태';
  }

  if (/Error Detection Criteria|ERRLV/i.test(doc) || name.includes('ERRLV')) {
    return 'error 판정 기준';
  }

  if (/Calculation Result|CALCDATA/i.test(doc) || name.includes('CALCDATA')) {
    return '계산 결과';
  }

  if (/Counter|CNT|FRAMCNT|UPCNT|CRCCNT/i.test(doc) || /(?:CNT|FRAMCNT|UPCNT|CRCCNT)(?:_|$)/.test(name)) {
    return '카운터 값';
  }

  if (/Coordinate|COORD|WINDOW|CROSS/i.test(doc) || /(?:COORD|WINDOW|CROSS|HP1|HP2|VP1|VP2)(?:_|$)/.test(name)) {
    return '좌표 설정';
  }

  if (/checksum|check sum/i.test(doc) || name.includes('CHECKSUM') || name.includes('CHKSUM')) {
    return 'checksum 값';
  }

  if (/timeout/i.test(doc) || name.includes('TIMEOUT')) {
    return 'timeout 설정';
  }

  if (/Time Setting|Pulse Width|Period|Width|Active|Blank|Porch/i.test(doc) || /(?:TIME|WIDTH|ACTIVE|BLANK|PORCH|TOTAL)(?:_|$)/.test(name)) {
    return '타이밍 설정';
  }

  if (/clear command|clear/i.test(doc) || name.includes('CLEAR')) {
    return 'clear 명령';
  }

  if (/invert/i.test(doc) || name.endsWith('_INV')) {
    return '극성 반전';
  }

  if (/select|selection/i.test(doc) || name.endsWith('_SEL')) {
    return '선택';
  }

  if (/Disable/i.test(doc) || name.endsWith('_DIS')) {
    return '비활성 설정';
  }

  if (/Enable/i.test(doc) || name.endsWith('_EN')) {
    return 'Enable 설정';
  }

  if (/mode/i.test(doc) || name.endsWith('_MODE')) {
    return '모드 설정';
  }

  if (/frequency|freq/i.test(doc) || name.includes('FREQ')) {
    return '주파수 설정';
  }

  if (/Level/i.test(doc) || name.includes('LEVEL')) {
    return 'level 설정';
  }

  if (/Setting/i.test(doc)) {
    return '설정';
  }

  if (/bitmap/i.test(doc)) {
    return 'bitmap 값';
  }

  return '값';
};

const formatRohmDescription = (field: RohmBitfieldDefinition): string => {
  const subject = toFieldSubject(field.name);
  const doc = compactText(field.doc);
  const choices = formatDocChoices(doc);

  return [
    `${subject} ${inferDescriptionAction(field, doc)}`,
    ...choices,
  ].join('\n');
};

export const buildRohmFieldWriteBytes = (
  field: RohmBitfieldDefinition,
  rawBytes: RohmRegisterByteMap,
  nextValue: number
): Array<{ address: number; value: number }> | null => {
  const bitLength = getFieldBitLength(field);
  const maxValue = (2 ** bitLength) - 1;

  if (!Number.isSafeInteger(nextValue) || nextValue < 0 || nextValue > maxValue) {
    return null;
  }

  const { minStart } = getFieldBitRange(field);
  const nextBytes = new Map<number, number>();

  for (const subfield of field.subfields) {
    const currentByte = nextBytes.has(subfield.address)
      ? nextBytes.get(subfield.address)
      : rawBytes[subfield.address];

    if (typeof currentByte !== 'number') {
      return null;
    }

    const valueMask = (1 << subfield.length) - 1;
    const sourceValue = Math.floor(nextValue / (2 ** (subfield.start - minStart))) % (2 ** subfield.length);
    const byteMask = valueMask << subfield.offset;
    const mergedValue = (currentByte & ~byteMask) | ((sourceValue << subfield.offset) & byteMask);

    nextBytes.set(subfield.address, mergedValue & 0xff);
  }

  return Array.from(nextBytes.entries())
    .map(([address, value]) => ({ address, value }))
    .sort((left, right) => left.address - right.address);
};

export const buildRohmRegisterRows = (
  registerMap: RohmRegisterMap,
  rawBytes: RohmRegisterByteMap,
  format: RegisterValueFormat
): RohmRegisterFieldRow[] =>
  registerMap.bitfields
    .map((field) => {
      const addressSpan = getFieldAddressSpan(field);
      const primaryAddress = addressSpan[0];
      const bitLength = getFieldBitLength(field);
      const resolvedField = resolveFieldValue(field, rawBytes);

      return {
        access: formatAccess(field),
        addressSpan,
        bitLength,
        description: formatRohmDescription(field),
        key: getRohmFieldKey(field),
        name: field.name,
        numericValue: resolvedField.value,
        primaryAddress,
        primaryAddressDec: `${primaryAddress}`,
        primaryAddressHex: formatRohmHex(primaryAddress, 2),
        rawValueText: formatFieldRawBytes(addressSpan, rawBytes),
        resolved: resolvedField.resolved,
        valueText: formatRohmFieldValue(resolvedField.value, bitLength, format),
      };
    })
    .sort((left, right) => {
      if (left.primaryAddress !== right.primaryAddress) {
        return left.primaryAddress - right.primaryAddress;
      }
      return left.name.localeCompare(right.name);
    });
