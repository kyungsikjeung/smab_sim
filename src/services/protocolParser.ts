import { GpioInputKey, GpioOutputKey } from 'types';

export interface VoltageSample {
  channelId: number;
  rawValue: number;
  voltage: number;
  source: string;
}

export interface VoltMonEvent {
  eventType: 'OnUnderSet' | 'OnOverSet' | 'OnClearFromUnder' | 'OnClearFromOver' | 'OnClear';
  channelId: number;
  source: string;
}

export interface VoltMonStatusEvent {
  channelId: number;
  state: number | null;
  statusText: string;
  source: string;
}

export interface VoltMonReadEvent extends VoltMonStatusEvent {
  channelId: number;
  commandIndex: number;
  currentVoltage: number | null;
  highRaw: number;
  lowRaw: number;
  rawAdc: number | null;
}

export interface FaultOutputStatusEvent {
  key: 'extFault' | 'sysFault';
  level: 'H' | 'L' | 'UNKNOWN';
  source: string;
}

export interface ErrorFlagReadEvent {
  commandName: 'error' | 'err' | 'faultinj';
  flags: number;
  normalizedHex: string;
  rawHex: string;
  source: string;
}

export interface GpioOutputStatusEvent {
  key: GpioOutputKey;
  label: string;
  level: 'HIGH' | 'LOW';
  source: string;
}

export interface GpioInputStatusEvent {
  key: GpioInputKey;
  label: string;
  level: 'HIGH' | 'LOW';
  source: string;
  statusText: string | null;
}

export interface GpioCommandBytesEvent {
  bytes: number[];
  commandId: string;
  source: string;
}

export interface SimLightReadEvent {
  bytes: [number, number, number, number];
  mask: number;
  source: string;
}

interface VoltagePattern {
  channel: number;
  raw: string;
}

const VOLTAGE_SCALE = 10000;
const VOLT_MON_CHANNELS = 6;
const shouldTraceVoltageParse = process.env.NODE_ENV !== 'production';

const GPIO_OUTPUT_KEY_MAP: Record<string, GpioOutputKey> = {
  EXT_FAULT: 'extFault',
  SYS_FAULT: 'sysFault',
};

const GPIO_INPUT_KEY_MAP: Record<string, GpioInputKey> = {
  'GMSL(TP_DES_LOCK)': 'gmslTpDesLock',
  LCD_FAIL: 'lcdFail',
  LED_FAIL: 'ledFail',
};

const stripPromptPrefix = (line: string): string => line
  .replace(/^\s*[>#]\s*/g, '')
  .trim();

const toNumber = (value: string): number | null => {
  const trimmed = value.trim();
  const parsed = trimmed.startsWith('0x') || trimmed.startsWith('0X')
    ? Number.parseInt(trimmed, 16)
    : Number(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStatusText = (value: string | null | undefined): string => {
  if (!value) return 'UNKNOWN';
  const normalized = value.trim().toUpperCase();
  return normalized || 'UNKNOWN';
};

const normalizeGpioLabel = (label: string): string => {
  return label.replace(/\s+/g, ' ').trim().toUpperCase();
};

const toNormalizedHex = (flags: number) => `0x${(flags >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

const deriveVoltMonState = (statusText: string): number | null => {
  const normalized = normalizeStatusText(statusText);
  if (normalized === 'OK' || normalized === 'NORMAL' || normalized === 'CLEAR') return 0;
  if (normalized === 'UNDER' || normalized === 'LOW') return 1;
  if (normalized === 'OVER' || normalized === 'HIGH') return 2;
  return null;
};

const resolveVoltMonChannelRef = (
  rawChannel: number,
  indexMode: 'one-based' | 'zero-based'
): { channelId: number; commandIndex: number } | null => {
  if (indexMode === 'zero-based') {
    if (!Number.isFinite(rawChannel) || rawChannel < 0 || rawChannel >= VOLT_MON_CHANNELS) {
      return null;
    }

    return {
      channelId: rawChannel + 1,
      commandIndex: rawChannel,
    };
  }

  if (!Number.isFinite(rawChannel) || rawChannel < 1 || rawChannel > VOLT_MON_CHANNELS) {
    return null;
  }

  return {
    channelId: rawChannel,
    commandIndex: rawChannel - 1,
  };
};

const extractRawVoltMonChannelPrefix = (line: string): { rawChannel: number; payload: string; source: string } | null => {
  const trimmed = stripPromptPrefix(line);
  const match = trimmed.match(/^(?:\[?VoltMon\]?\s*)?\[?CH(\d+)\]?(?:\s*[:\-]\s*|\s+)(.+)$/i);
  if (!match) return null;

  const rawChannel = Number.parseInt(match[1], 10);
  if (!Number.isFinite(rawChannel)) {
    return null;
  }

  return {
    rawChannel,
    payload: match[2].trim(),
    source: trimmed,
  };
};

const parseRawVoltageToken = (raw: string, source: string): VoltageSample[] => {
  const rawValue = toNumber(raw);
  if (rawValue === null || Number.isNaN(rawValue)) return [];

  const isDecimal = raw.includes('.');
  const voltage = isDecimal
    ? rawValue
    : parseFloat((rawValue / VOLTAGE_SCALE).toFixed(4));

  if (Number.isNaN(voltage) || voltage < 0) return [];

  return [{
    rawValue,
    voltage: Number.isFinite(voltage) ? Number.isNaN(voltage) ? 0 : voltage : 0,
    source,
  } as VoltageSample];
};

const parseVoltMonStreamLine = (line: string): VoltageSample[] => {
  const trimmed = stripPromptPrefix(line).trim();

  if (/VoltMon\s+log\s*:\s*(on|off)/i.test(trimmed)) {
    return [];
  }

  const tagMatch = trimmed.match(/^(?:\s*\[?\s*VoltMon\]?[\s-:]*)?ADC\b[:\s]?(.*)$/i)
    || trimmed.match(/^[^]*?\bADC\b[:\s]?(.*)$/i);
  if (!tagMatch) {
    if (shouldTraceVoltageParse) {
      console.debug(`[VoltMonParser] stream: no ADC tag in "${trimmed}"`);
    }
    return [];
  }

  const tokens = tagMatch[1]
    .replace(/V/gi, ' ')
    .replace(/,/g, ' ')
    .match(/0x[0-9a-fA-F]+|[+-]?(?:\d+\.\d+|\d+)/g);
  if (!tokens) {
    if (shouldTraceVoltageParse) {
      console.debug(`[VoltMonParser] stream: no numeric tokens in "${trimmed}"`);
    }
    return [];
  }

  const values = tokens.map((value) => toNumber(value)).filter((v) => v !== null) as number[];
  if (values.length < VOLT_MON_CHANNELS) {
    if (shouldTraceVoltageParse) {
      console.debug(`[VoltMonParser] stream: parsed ${values.length} values, expected >=${VOLT_MON_CHANNELS} for "${trimmed}"`);
    }
    return [];
  }

  return values.slice(0, VOLT_MON_CHANNELS).map((rawValue, index) => ({
    channelId: index + 1,
    rawValue,
    source: trimmed,
    voltage: parseFloat((rawValue / VOLTAGE_SCALE).toFixed(4)),
  }));
};

const collectPairs = (channel: string, value: string): VoltagePattern[] => {
  const trimmedChannel = channel.trim();
  const parsedChannel = Number.parseInt(trimmedChannel, 10);
  if (!Number.isFinite(parsedChannel) || Number.isNaN(parsedChannel)) return [];

  return [{
    channel: parsedChannel,
    raw: value.trim(),
  }];
};

const parseMultiplePairs = (line: string): VoltagePattern[] => {
  const matches: VoltagePattern[] = [];

  const normalized = line.trim();
  const multiPattern = /CH(\d+)\s*[:=]\s*([+-]?(?:\d+\.?\d*|\.\d+|0x[0-9a-fA-F]+))(?:\s*[A-Za-z%]*)/g;
  let foundAny = false;
  let matched: RegExpExecArray | null;

  while ((matched = multiPattern.exec(normalized)) !== null) {
    foundAny = true;
    const parsed = collectPairs(matched[1], matched[2]);
    if (parsed.length) {
      matches.push(...parsed);
    }
  }

  if (foundAny) return matches;

  const fallbackPattern = /(CH\d+)(?:[=\s:]+)(-?\d+(?:\.\d+)?)(?:\s*[A-Za-z%]*)/gi;
  while ((matched = fallbackPattern.exec(normalized)) !== null) {
    const channel = Number.parseInt(matched[1].replace(/CH/i, ''), 10);
    if (Number.isFinite(channel)) {
      matches.push({ channel, raw: matched[2] });
    }
  }

  return matches;
};

const parseVoltMonEventLine = (line: string): VoltMonEvent[] => {
  const trimmed = stripPromptPrefix(line).trim();
  const eventMatch = trimmed.match(/^(?:\s*\[?\s*VoltMon\]?\s*)?CH(\d)\s*(OnUnderSet|OnOverSet|OnClearFromUnder|OnClearFromOver|OnClear)\s*$/i);
  if (!eventMatch) return [];

  const channel = Number.parseInt(eventMatch[1], 10);
  if (!Number.isFinite(channel) || channel < 1 || channel > 6) return [];

  const rawType = eventMatch[2] as VoltMonEvent['eventType'];

  return [{
    channelId: channel,
    eventType: rawType,
    source: trimmed,
  }];
};

export const parseVoltageLine = (line: string): VoltageSample[] => {
  const trimmed = stripPromptPrefix(line).replace(/\r/g, '').trim();
  const chunks = trimmed.split('\n').map((chunk) => chunk.trim()).filter(Boolean);
  const samples: VoltageSample[] = [];

  chunks.forEach((chunk) => {
    const cleanChunk = stripPromptPrefix(chunk).trim();
    const isVoltageLine = /VoltMon|ADC|VOLT|전압|voltage/i.test(cleanChunk);
    if (!isVoltageLine) {
      if (shouldTraceVoltageParse) {
        console.debug(`[VoltMonParser] ignore: non-voltage line "${cleanChunk}"`);
      }
      return;
    }

    const streamSamples = parseVoltMonStreamLine(cleanChunk);
    if (streamSamples.length > 0) {
      samples.push(...streamSamples);
      return;
    }

    const pairs = parseMultiplePairs(cleanChunk);
    if (pairs.length === 0) {
      if (shouldTraceVoltageParse) {
        console.debug(`[VoltMonParser] no voltage payload parsed from line "${cleanChunk}"`);
      }
      return;
    }

    pairs.forEach((pair) => {
      if (pair.channel < 1 || pair.channel > 6) return;

      const parsed = parseRawVoltageToken(pair.raw, cleanChunk);
      parsed.forEach((sample) => {
        samples.push({
          ...sample,
          channelId: pair.channel,
        });
      });
    });
  });

  return samples;
};

export const parseVoltageEvents = (line: string): VoltMonEvent[] => {
  return parseVoltMonEventLine(line);
};

export const parseVoltMonReadLine = (line: string): VoltMonReadEvent | null => {
  const channelPrefix = extractRawVoltMonChannelPrefix(line);
  if (!channelPrefix) return null;

  const bracketFormatMatch = channelPrefix.payload.match(
    /^ADC\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*\[\s*(0x[0-9a-fA-F]+|\d+)\s*-\s*(0x[0-9a-fA-F]+|\d+)\s*\]\s*([A-Za-z_]+)?(?:\s*\(state\s*=\s*(-?\d+)\))?\s*$/i
  );
  if (bracketFormatMatch) {
    const channelRef = resolveVoltMonChannelRef(channelPrefix.rawChannel, 'zero-based');
    if (!channelRef) return null;

    const rawAdc = toNumber(bracketFormatMatch[1]);
    const lowRaw = toNumber(bracketFormatMatch[2]);
    const highRaw = toNumber(bracketFormatMatch[3]);
    if (rawAdc === null || lowRaw === null || highRaw === null) {
      return null;
    }

    const statusText = normalizeStatusText(bracketFormatMatch[4]);
    const explicitState = bracketFormatMatch[5] ? Number.parseInt(bracketFormatMatch[5], 10) : null;

    return {
      channelId: channelRef.channelId,
      commandIndex: channelRef.commandIndex,
      currentVoltage: parseFloat((rawAdc / VOLTAGE_SCALE).toFixed(4)),
      highRaw,
      lowRaw,
      rawAdc,
      source: channelPrefix.source,
      state: Number.isFinite(explicitState) ? explicitState : deriveVoltMonState(statusText),
      statusText,
    };
  }

  const lowMatch = channelPrefix.payload.match(/\blow\s*=\s*(0x[0-9a-fA-F]+|\d+)/i);
  const highMatch = channelPrefix.payload.match(/\bhigh\s*=\s*(0x[0-9a-fA-F]+|\d+)/i);
  const rawMatch = channelPrefix.payload.match(/\braw(?:_?adc)?\s*=\s*(0x[0-9a-fA-F]+|\d+)/i);
  const stateMatch = channelPrefix.payload.match(/\bstate\s*=\s*(-?\d+)/i);
  const statusMatch = channelPrefix.payload.match(/\bstatus\s*=\s*([A-Za-z_]+)/i);
  const voltageMatch = channelPrefix.payload.match(/\b(?:voltage|current)\s*=\s*([+-]?(?:\d+\.\d+|\d+))/i);

  if (!lowMatch && !highMatch && !rawMatch) {
    return null;
  }

  const channelRef = resolveVoltMonChannelRef(channelPrefix.rawChannel, 'one-based');
  if (!channelRef) return null;

  const lowRaw = lowMatch ? toNumber(lowMatch[1]) : null;
  const highRaw = highMatch ? toNumber(highMatch[1]) : null;
  const rawAdc = rawMatch ? toNumber(rawMatch[1]) : null;
  if (lowRaw === null || highRaw === null) {
    return null;
  }

  const statusText = normalizeStatusText(statusMatch?.[1]);
  const explicitState = stateMatch ? Number.parseInt(stateMatch[1], 10) : null;
  const state = Number.isFinite(explicitState) ? explicitState : deriveVoltMonState(statusText);
  const parsedVoltage = voltageMatch ? Number.parseFloat(voltageMatch[1]) : Number.NaN;
  const currentVoltage = Number.isFinite(parsedVoltage)
    ? parsedVoltage
    : rawAdc !== null
      ? parseFloat((rawAdc / VOLTAGE_SCALE).toFixed(4))
      : null;

  return {
    channelId: channelRef.channelId,
    commandIndex: channelRef.commandIndex,
    currentVoltage,
    highRaw,
    lowRaw,
    rawAdc,
    source: channelPrefix.source,
    state,
    statusText,
  };
};

export const parseVoltMonStatusLine = (line: string): VoltMonStatusEvent | null => {
  const readEvent = parseVoltMonReadLine(line);
  if (readEvent) {
    return {
      channelId: readEvent.channelId,
      source: readEvent.source,
      state: readEvent.state,
      statusText: readEvent.statusText,
    };
  }

  const channelPrefix = extractRawVoltMonChannelPrefix(line);
  if (!channelPrefix) return null;

  const statusMatch = channelPrefix.payload.match(/\bstatus\s*=\s*([A-Za-z_]+)/i);
  const stateMatch = channelPrefix.payload.match(/\bstate\s*=\s*(-?\d+)/i);
  if (!statusMatch && !stateMatch) {
    return null;
  }

  const channelRef = resolveVoltMonChannelRef(
    channelPrefix.rawChannel,
    channelPrefix.rawChannel === 0 ? 'zero-based' : 'one-based'
  );
  if (!channelRef) return null;

  const statusText = normalizeStatusText(statusMatch?.[1]);
  const explicitState = stateMatch ? Number.parseInt(stateMatch[1], 10) : null;

  return {
    channelId: channelRef.channelId,
    source: channelPrefix.source,
    state: Number.isFinite(explicitState) ? explicitState : deriveVoltMonState(statusText),
    statusText,
  };
};

export const parseFaultOutputLine = (line: string): FaultOutputStatusEvent | null => {
  const trimmed = stripPromptPrefix(line);

  const faultHandlerMatch = trimmed.match(/\[FaultHandler\]\s*(SYS|EXT)\s+fault\s+output\s*->\s*(?:FAULT|NORMAL)\((LOW|HIGH)\)/i);
  if (faultHandlerMatch) {
    return {
      key: faultHandlerMatch[1].toUpperCase() === 'SYS' ? 'sysFault' : 'extFault',
      level: faultHandlerMatch[2].toUpperCase() === 'HIGH' ? 'H' : 'L',
      source: trimmed,
    };
  }

  return null;
};

export const parseErrorFlagLine = (line: string): ErrorFlagReadEvent | null => {
  const trimmed = stripPromptPrefix(line);

  const bracketMatch = trimmed.match(/^\[(error|err|faultinj)\]\s*flags\s*=\s*(0x[0-9A-Fa-f]+|[0-9A-Fa-f]+)\s*$/i);
  if (bracketMatch) {
    const flags = Number.parseInt(bracketMatch[2].replace(/^0x/i, ''), 16);
    if (!Number.isFinite(flags)) return null;

    return {
      commandName: bracketMatch[1].toLowerCase() as ErrorFlagReadEvent['commandName'],
      flags,
      normalizedHex: toNormalizedHex(flags),
      rawHex: bracketMatch[2].startsWith('0x') || bracketMatch[2].startsWith('0X')
        ? `0x${bracketMatch[2].replace(/^0x/i, '').toUpperCase()}`
        : `0x${bracketMatch[2].toUpperCase()}`,
      source: trimmed,
    };
  }

  const inlineMatch = trimmed.match(/^(error|err|faultinj)\s+read\s*[:=]\s*(0x[0-9A-Fa-f]+|[0-9A-Fa-f]+)\s*$/i);
  if (!inlineMatch) return null;

  const flags = Number.parseInt(inlineMatch[2].replace(/^0x/i, ''), 16);
  if (!Number.isFinite(flags)) return null;

  return {
    commandName: inlineMatch[1].toLowerCase() as ErrorFlagReadEvent['commandName'],
    flags,
    normalizedHex: toNormalizedHex(flags),
    rawHex: inlineMatch[2].startsWith('0x') || inlineMatch[2].startsWith('0X')
      ? `0x${inlineMatch[2].replace(/^0x/i, '').toUpperCase()}`
      : `0x${inlineMatch[2].toUpperCase()}`,
    source: trimmed,
  };
};

export const isGpioStatusHeaderLine = (line: string): boolean => {
  return /===\s*GPIO Status\s*===/i.test(stripPromptPrefix(line));
};

export const parseGpioOutputLine = (line: string): GpioOutputStatusEvent | null => {
  const trimmed = stripPromptPrefix(line);
  const match = trimmed.match(/^\[OUT\]\s*([^:]+?)\s*:\s*(HIGH|LOW)\s*$/i);
  if (!match) return null;

  const label = normalizeGpioLabel(match[1]);
  const key = GPIO_OUTPUT_KEY_MAP[label];
  if (!key) return null;

  return {
    key,
    label,
    level: match[2].toUpperCase() as 'HIGH' | 'LOW',
    source: trimmed,
  };
};

export const parseGpioInputLine = (line: string): GpioInputStatusEvent | null => {
  const trimmed = stripPromptPrefix(line);
  const match = trimmed.match(/^\[IN\s*\]\s*([^:]+?)\s*:\s*(HIGH|LOW)(?:\s*\(([^)]+)\))?\s*$/i);
  if (!match) return null;

  const label = normalizeGpioLabel(match[1]);
  const key = GPIO_INPUT_KEY_MAP[label];
  if (!key) return null;

  return {
    key,
    label,
    level: match[2].toUpperCase() as 'HIGH' | 'LOW',
    source: trimmed,
    statusText: match[3] ? match[3].trim().toUpperCase() : null,
  };
};

export const parseGpioCommandBytesLine = (line: string): GpioCommandBytesEvent | null => {
  const trimmed = stripPromptPrefix(line);
  const match = trimmed.match(/^\[CMD(0x[0-9A-Fa-f]+)\]\s*bytes\s*:\s*(.+)$/i);
  if (!match) return null;

  const bytes = match[2]
    .trim()
    .split(/\s+/)
    .map((token) => toNumber(token))
    .filter((value): value is number => value !== null);

  if (!bytes.length) return null;

  return {
    bytes,
    commandId: match[1].toUpperCase(),
    source: trimmed,
  };
};

export const parseSimLightReadLine = (line: string): SimLightReadEvent | null => {
  const trimmed = stripPromptPrefix(line);
  const match = trimmed.match(/^simlightr\s*:\s*RX\s*=\s*\[(.+)\]\s*$/i);
  if (!match) return null;

  const tokens = match[1]
    .split(',')
    .map((token) => toNumber(token))
    .filter((value): value is number => value !== null);

  if (tokens.length !== 4) return null;

  const bytes = tokens.map((value) => value & 0xff) as [number, number, number, number];
  const mask = bytes.reduce((acc, value) => (((acc << 8) | value) >>> 0), 0);

  return {
    bytes,
    mask,
    source: trimmed,
  };
};
