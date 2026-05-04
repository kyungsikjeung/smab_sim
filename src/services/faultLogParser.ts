import { FaultLogEntry, FaultLogParseResult } from 'types';

const normalizeHex = (value: number) => `0x${(value >>> 0).toString(16).toUpperCase()}`;
const HEADER_REGEX = /^===\s*Fault Log Recent\s*\((\d+)\s*max\)\s*===$/i;
const ENTRY_REGEX = /^Entry:\s*(\d+)\/(\d+)\s*\(recent_idx=(\d+)(?:,\s*newest)?\)\s*$/i;
const ADDR_REGEX = /^Addr:\s*(0x[0-9A-Fa-f]+)\s*$/i;
const UPTIME_REGEX = /^Uptime:\s*(.+)$/i;
const FLAGS_REGEX = /^Flags:\s*(0x[0-9A-Fa-f]+)\s*$/i;
const BITS_HEADER_REGEX = /^Bits:\s*$/i;
const BIT_REGEX = /^-\s*bit(\d+)\s+(.+?)\s*$/i;
const PROMPT_REGEX = /^>\s*$/;
const INFO_REGEX = /^(?:\[I\]\[flash_mgr\].*|\S*checkpoint\s+0x[0-9A-Fa-f]+\s*->\s*0x[0-9A-Fa-f]+.*)$/i;

const finalizeEntry = (
  entries: FaultLogEntry[],
  candidate: FaultLogEntry | null
) => {
  if (!candidate) return;

  entries.push({
    ...candidate,
    bits: [...candidate.bits],
  });
};

const isFaultLogContentLine = (line: string) => (
  HEADER_REGEX.test(line)
  || ENTRY_REGEX.test(line)
  || ADDR_REGEX.test(line)
  || UPTIME_REGEX.test(line)
  || FLAGS_REGEX.test(line)
  || BITS_HEADER_REGEX.test(line)
  || BIT_REGEX.test(line)
  || INFO_REGEX.test(line)
);

const extractFaultLogResponseLines = (lines: string[]) => {
  const normalizedLines = lines
    .map((line) => line.trim())
    .filter(Boolean);

  const responseLines: string[] = [];
  const pendingInfoLines: string[] = [];
  let started = false;
  let completed = false;

  for (const line of normalizedLines) {
    const startsResponse = HEADER_REGEX.test(line) || ENTRY_REGEX.test(line);

    if (!started) {
      if (INFO_REGEX.test(line)) {
        pendingInfoLines.push(line);
        continue;
      }

      if (!startsResponse) {
        pendingInfoLines.length = 0;
        continue;
      }

      started = true;
      responseLines.push(...pendingInfoLines);
      pendingInfoLines.length = 0;
    }

    if (PROMPT_REGEX.test(line)) {
      completed = true;
      break;
    }

    if (!isFaultLogContentLine(line)) {
      completed = responseLines.length > 0;
      break;
    }

    responseLines.push(line);
  }

  return {
    completed,
    responseLines,
  };
};

export const parseFaultLogResponseLines = (lines: string[]): FaultLogParseResult => {
  const entries: FaultLogEntry[] = [];
  const infoLines: string[] = [];
  const { completed, responseLines: rawLines } = extractFaultLogResponseLines(lines);

  let currentEntry: FaultLogEntry | null = null;
  let hasHeader = false;
  let totalExpected: number | null = null;

  rawLines.forEach((line) => {
    const headerMatch = line.match(HEADER_REGEX);
    if (headerMatch) {
      finalizeEntry(entries, currentEntry);
      currentEntry = null;
      hasHeader = true;
      totalExpected = Number.parseInt(headerMatch[1], 10);
      return;
    }

    if (INFO_REGEX.test(line)) {
      infoLines.push(line);
      return;
    }

    const entryMatch = line.match(ENTRY_REGEX);
    if (entryMatch) {
      finalizeEntry(entries, currentEntry);
      totalExpected = totalExpected ?? Number.parseInt(entryMatch[2], 10);
      currentEntry = {
        address: '-',
        bits: [],
        entryNumber: Number.parseInt(entryMatch[1], 10),
        flags: 0,
        flagsHex: '0x0',
        isNewest: /newest/i.test(line),
        recentIndex: Number.parseInt(entryMatch[3], 10),
        totalEntries: Number.parseInt(entryMatch[2], 10),
        uptime: '-',
      };
      return;
    }

    if (!currentEntry) {
      return;
    }

    const addressMatch = line.match(ADDR_REGEX);
    if (addressMatch) {
      currentEntry.address = addressMatch[1].toUpperCase();
      return;
    }

    const uptimeMatch = line.match(UPTIME_REGEX);
    if (uptimeMatch) {
      currentEntry.uptime = uptimeMatch[1].trim();
      return;
    }

    const flagsMatch = line.match(FLAGS_REGEX);
    if (flagsMatch) {
      const parsedFlags = Number.parseInt(flagsMatch[1].replace(/^0x/i, ''), 16);
      if (Number.isFinite(parsedFlags)) {
        currentEntry.flags = parsedFlags >>> 0;
        currentEntry.flagsHex = normalizeHex(parsedFlags);
      }
      return;
    }

    const bitMatch = line.match(BIT_REGEX);
    if (bitMatch) {
      currentEntry.bits.push({
        bit: Number.parseInt(bitMatch[1], 10),
        label: bitMatch[2].trim(),
      });
    }
  });

  finalizeEntry(entries, currentEntry);

  return {
    completed,
    entries,
    hasHeader,
    infoLines,
    rawLines,
    totalExpected,
  };
};

export const buildFaultLogDownloadText = (result: FaultLogParseResult) => {
  if (result.rawLines.length === 0) {
    return '에러 로그 기록이 없습니다.';
  }

  const summaryLines = result.entries.flatMap((entry) => {
    const bitLines = entry.bits.length > 0
      ? entry.bits.map((bit) => `- bit${bit.bit} ${bit.label}`)
      : ['- none'];

    return [
      `Entry ${entry.entryNumber}/${entry.totalEntries}${entry.isNewest ? ' (newest)' : ''}`,
      `Addr: ${entry.address}`,
      `Uptime: ${entry.uptime}`,
      `Flags: ${entry.flagsHex}`,
      'Bits:',
      ...bitLines,
      '',
    ];
  });

  return [
    '=== Fault Log Recent Summary ===',
    `Entries: ${result.entries.length}${result.totalExpected !== null ? ` / ${result.totalExpected}` : ''}`,
    '',
    ...summaryLines,
    '=== Raw RX ===',
    ...result.rawLines,
  ].join('\r\n');
};
