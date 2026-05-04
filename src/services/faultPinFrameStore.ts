import { FaultPinFrame } from 'types';

const MAX_FRAMES = 1500;

type Listener = () => void;

const buffer: Array<FaultPinFrame | null> = new Array(MAX_FRAMES).fill(null);
const listeners = new Set<Listener>();

let nextWriteIndex = 0;
let frameCount = 0;

const getStartIndex = () => (nextWriteIndex - frameCount + MAX_FRAMES) % MAX_FRAMES;

const emit = () => {
  listeners.forEach((listener) => listener());
};

export const pushFaultPinFrame = (frame: FaultPinFrame): void => {
  buffer[nextWriteIndex] = frame;
  nextWriteIndex = (nextWriteIndex + 1) % MAX_FRAMES;
  frameCount = Math.min(frameCount + 1, MAX_FRAMES);
  emit();
};

export const getFaultPinFramesSince = (timestamp: number): FaultPinFrame[] => {
  if (frameCount === 0) return [];

  const frames: FaultPinFrame[] = [];
  const startIndex = getStartIndex();

  for (let index = 0; index < frameCount; index += 1) {
    const frame = buffer[(startIndex + index) % MAX_FRAMES];
    if (frame && frame.timestamp >= timestamp) {
      frames.push(frame);
    }
  }

  return frames;
};

export const getLatestFaultPinFrame = (): FaultPinFrame | null => {
  if (frameCount === 0) return null;
  return buffer[(nextWriteIndex - 1 + MAX_FRAMES) % MAX_FRAMES];
};

export const subscribeFaultPinFrames = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
