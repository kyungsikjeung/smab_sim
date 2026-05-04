import React, { useEffect, useMemo, useState } from 'react';
import { getFaultPinFramesSince, getLatestFaultPinFrame, subscribeFaultPinFrames } from 'services/faultPinFrameStore';
import { FaultPinFrame, FaultPinKey } from 'types';

interface FaultPinLevelChartChannel {
  color: string;
  key: FaultPinKey;
  label: string;
}

interface FaultPinLevelChartProps {
  channels: FaultPinLevelChartChannel[];
  connected: boolean;
}

const WINDOW_MS = 10_000;
const STALE_THRESHOLD_MS = 1200;
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 320;
const PLOT = {
  bottom: 54,
  left: 72,
  right: 18,
  top: 28,
};
const X_TICK_COUNT = 5;

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const mmm = String(date.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mmm}`;
};

const plotWidth = VIEWBOX_WIDTH - PLOT.left - PLOT.right;
const plotHeight = VIEWBOX_HEIGHT - PLOT.top - PLOT.bottom;

const getYPosition = (value: 0 | 1) => (value === 1 ? PLOT.top + 8 : PLOT.top + plotHeight - 8);

const buildStepPath = (
  frames: FaultPinFrame[],
  channel: FaultPinLevelChartChannel,
  leftEdge: number,
  offset: number
) => {
  if (frames.length === 0) return '';

  const toX = (timestamp: number) => (
    PLOT.left + (((timestamp - leftEdge) / WINDOW_MS) * plotWidth)
  );

  const firstFrame = frames[0];
  let prevX = toX(firstFrame.timestamp);
  let prevY = getYPosition(firstFrame.values[channel.key]) + offset;
  let path = `M ${PLOT.left} ${prevY} L ${prevX} ${prevY}`;

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const nextX = toX(frame.timestamp);
    const nextY = getYPosition(frame.values[channel.key]) + offset;
    path += ` L ${nextX} ${prevY} L ${nextX} ${nextY}`;
    prevX = nextX;
    prevY = nextY;
  }

  path += ` L ${PLOT.left + plotWidth} ${prevY}`;
  return path;
};

const FaultPinLevelChart: React.FC<FaultPinLevelChartProps> = ({
  channels,
  connected,
}) => {
  const [now, setNow] = useState(() => Date.now());
  const [frameVersion, setFrameVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeFaultPinFrames(() => {
      setFrameVersion((prev) => prev + 1);
      setNow(Date.now());
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const chartState = useMemo(() => {
    const latestFrame = getLatestFaultPinFrame();
    const hasFrames = !!latestFrame;
    const isLive = !!(connected && latestFrame && (now - latestFrame.timestamp) <= STALE_THRESHOLD_MS);
    const streamState = !connected
      ? 'idle'
      : !latestFrame
        ? 'waiting'
        : isLive
          ? 'live'
          : 'stale';
    const rightEdge = latestFrame ? (isLive ? now : latestFrame.timestamp) : now;
    const leftEdge = rightEdge - WINDOW_MS;
    const visibleFrames = latestFrame ? getFaultPinFramesSince(leftEdge) : [];

    return {
      hasFrames,
      leftEdge,
      latestFrame,
      streamState,
      visibleFrames,
    };
  }, [connected, frameVersion, now]);

  if (!chartState.hasFrames || chartState.visibleFrames.length === 0) {
    return (
      <div className="fault-pin-monitor__chart-stage">
        <div className="fault-pin-monitor__chart-empty">
          {connected ? 'fault_pin_stream 시작 대기 중...' : '시리얼 포트를 연결해주세요'}
        </div>
      </div>
    );
  }

  const highY = getYPosition(1);
  const lowY = getYPosition(0);
  const badgeColor = chartState.streamState === 'live'
    ? '#22c55e'
    : chartState.streamState === 'stale'
      ? '#f59e0b'
      : 'rgba(148, 163, 184, 0.92)';
  const badgeFill = chartState.streamState === 'live'
    ? 'rgba(34, 197, 94, 0.16)'
    : chartState.streamState === 'stale'
      ? 'rgba(245, 158, 11, 0.16)'
      : 'rgba(148, 163, 184, 0.12)';
  const badgeText = chartState.streamState === 'live'
    ? 'LIVE'
    : chartState.streamState === 'stale'
      ? 'STALE'
      : chartState.streamState === 'waiting'
        ? 'WAIT'
        : 'IDLE';

  return (
    <div className="fault-pin-monitor__chart-stage">
      <svg
        className="fault-pin-monitor__chart-svg"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
      >
        {Array.from({ length: X_TICK_COUNT }, (_, index) => {
          const ratio = index / (X_TICK_COUNT - 1);
          const x = PLOT.left + (plotWidth * ratio);
          const tickTime = chartState.leftEdge + (WINDOW_MS * ratio);

          return (
            <g key={`x-${index}`}>
              <line
                x1={x}
                y1={PLOT.top}
                x2={x}
                y2={PLOT.top + plotHeight}
                stroke="rgba(58, 84, 145, 0.34)"
                strokeWidth="1"
              />
              <text
                x={x}
                y={PLOT.top + plotHeight + 22}
                fill="rgba(148, 163, 184, 0.92)"
                fontFamily="Consolas, monospace"
                fontSize="10"
                textAnchor="end"
                transform={`rotate(-30 ${x} ${PLOT.top + plotHeight + 22})`}
              >
                {formatTimestamp(tickTime)}
              </text>
            </g>
          );
        })}

        {[highY, lowY].map((y, index) => (
          <g key={`y-${index}`}>
            <line
              x1={PLOT.left}
              y1={y}
              x2={PLOT.left + plotWidth}
              y2={y}
              stroke="rgba(58, 84, 145, 0.34)"
              strokeWidth="1"
            />
            <text
              x={PLOT.left - 10}
              y={y}
              fill="rgba(148, 163, 184, 0.92)"
              fontFamily="Consolas, monospace"
              fontSize="11"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {index === 0 ? 'HIGH' : 'LOW'}
            </text>
          </g>
        ))}

        {channels.map((channel, channelIndex) => {
          const offset = channelIndex === 0 ? -4 : 4;
          const path = buildStepPath(chartState.visibleFrames, channel, chartState.leftEdge, offset);
          const latest = chartState.visibleFrames[chartState.visibleFrames.length - 1];
          const latestX = PLOT.left + (((latest.timestamp - chartState.leftEdge) / WINDOW_MS) * plotWidth);
          const latestY = getYPosition(latest.values[channel.key]) + offset;

          return (
            <g key={channel.key}>
              <path
                d={path}
                fill="none"
                stroke={channel.color}
                strokeWidth="4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle
                cx={latestX}
                cy={latestY}
                r="5"
                fill={channel.color}
              />
            </g>
          );
        })}

        <g>
          <rect
            x={VIEWBOX_WIDTH - 70}
            y={10}
            width={58}
            height={24}
            rx={8}
            ry={8}
            fill={badgeFill}
            stroke={badgeColor}
            strokeWidth="1"
          />
          <text
            x={VIEWBOX_WIDTH - 41}
            y={22}
            fill={badgeColor}
            fontFamily="Consolas, monospace"
            fontSize="11"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {badgeText}
          </text>
        </g>
      </svg>
    </div>
  );
};

export default FaultPinLevelChart;
