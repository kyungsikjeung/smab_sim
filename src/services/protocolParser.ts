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

interface VoltagePattern {
  channel: number;
  raw: string;
}

const VOLTAGE_SCALE = 10000;
const VOLT_MON_CHANNELS = 6;
const shouldTraceVoltageParse = process.env.NODE_ENV !== 'production';

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

  // Example: "ADC CH1 33000 CH2 32000", "ADC CH1=3.30V"
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

    pairs.forEach((p) => {
      if (p.channel < 1 || p.channel > 6) return;

      const parsed = parseRawVoltageToken(p.raw, cleanChunk);
      parsed.forEach((sample) => {
        samples.push({
          ...sample,
          channelId: p.channel,
        });
      });
    });
  });

  if (samples.length > 0) {
    return samples;
  }

  return samples;
};

export const parseVoltageEvents = (line: string): VoltMonEvent[] => {
  return parseVoltMonEventLine(line);
};
