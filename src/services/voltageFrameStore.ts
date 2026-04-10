import { VoltageFrame } from 'types';

const MAX_FRAMES = 1500;

type Listener = () => void;

const buffer: Array<VoltageFrame | null> = new Array(MAX_FRAMES).fill(null);
const listeners = new Set<Listener>();

let nextWriteIndex = 0;
let frameCount = 0;

const getStartIndex = () => (nextWriteIndex - frameCount + MAX_FRAMES) % MAX_FRAMES;

const emit = () => {
  listeners.forEach((listener) => listener());
};

export const pushFrame = (frame: VoltageFrame): void => {
  buffer[nextWriteIndex] = frame;
  nextWriteIndex = (nextWriteIndex + 1) % MAX_FRAMES;
  frameCount = Math.min(frameCount + 1, MAX_FRAMES);
  emit();
};

export const getFramesSince = (timestamp: number): VoltageFrame[] => {
  if (frameCount === 0) return [];

  const frames: VoltageFrame[] = [];
  const startIndex = getStartIndex();

  for (let i = 0; i < frameCount; i += 1) {
    const frame = buffer[(startIndex + i) % MAX_FRAMES];
    if (frame && frame.timestamp >= timestamp) {
      frames.push(frame);
    }
  }

  return frames;
};

export const getLatestFrame = (): VoltageFrame | null => {
  if (frameCount === 0) return null;
  return buffer[(nextWriteIndex - 1 + MAX_FRAMES) % MAX_FRAMES];
};

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
