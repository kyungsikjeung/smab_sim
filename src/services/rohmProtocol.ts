import { RohmProtocolEvent, RohmReadResponse } from 'types';

interface PendingRead {
  addr: number;
  bytes: number[];
  len: number;
}

const READ_HEADER_REGEX = /^\[ROHM\]\s+RD_PRM(?:1B)?\s+addr=0x([0-9A-F]+)\s+len=(\d+)/i;
const READ_DATA_REGEX = /^(?:0x)?([0-9A-F]+)\s*:\s*([0-9A-F\s]+)$/i;

let pendingRead: PendingRead | null = null;
const protocolListeners = new Set<(event: RohmProtocolEvent) => void>();

const toReadResponse = (read: PendingRead): RohmReadResponse => ({
  addr: read.addr,
  len: read.len,
  values: read.bytes.slice(0, read.len),
});

const emitProtocolEvent = (event: RohmProtocolEvent) => {
  protocolListeners.forEach((listener) => {
    listener(event);
  });
};

export const subscribeRohmProtocolEvents = (listener: (event: RohmProtocolEvent) => void): (() => void) => {
  protocolListeners.add(listener);
  return () => {
    protocolListeners.delete(listener);
  };
};

export const resetRohmProtocolState = (): void => {
  pendingRead = null;
};

export const parseRohmProtocolLine = (line: string): RohmProtocolEvent[] => {
  const content = line.trim();
  if (!content) return [];

  const headerMatch = content.match(READ_HEADER_REGEX);
  if (headerMatch) {
    pendingRead = {
      addr: parseInt(headerMatch[1], 16),
      bytes: [],
      len: parseInt(headerMatch[2], 10),
    };

    if (!pendingRead) {
      return [];
    }

    const event: RohmProtocolEvent = { type: 'read-start', response: toReadResponse(pendingRead) };
    emitProtocolEvent(event);
    return [event];
  }

  if (!pendingRead) {
    return [];
  }

  const dataMatch = content.match(READ_DATA_REGEX);
  if (!dataMatch) {
    return [];
  }

  const rowAddr = parseInt(dataMatch[1], 16);
  const byteTokens = dataMatch[2]
    .trim()
    .split(/\s+/)
    .filter((token) => /^[0-9A-F]{1,2}$/i.test(token))
    .map((token) => parseInt(token, 16));
  if (byteTokens.length === 0) {
    return [];
  }

  const expectedAddr = pendingRead.addr + pendingRead.bytes.length;
  if (rowAddr !== expectedAddr && rowAddr !== pendingRead.addr) {
    pendingRead = null;
    return [];
  }

  pendingRead.bytes.push(...byteTokens);

  if (pendingRead.bytes.length < pendingRead.len) {
    return [];
  }

  const completed = toReadResponse(pendingRead);
  pendingRead = null;
  const event: RohmProtocolEvent = { type: 'read-complete', response: completed };
  emitProtocolEvent(event);
  return [event];
};
