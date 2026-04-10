import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilState } from 'recoil';
import { voltageChannelsState, voltageRangeState } from 'state/atoms';
import { useSerial } from 'hooks/useSerial';
import { getFramesSince, getLatestFrame, pushFrame, subscribe } from 'services/voltageFrameStore';
import './VoltageMonitor.css';

const MOCK_SAMPLE_INTERVAL_MS = 50;
const WINDOW_MS = 10_000;
const STALE_THRESHOLD_MS = 500;
const X_TICK_COUNT = 5;
const Y_TICK_COUNT = 5;
const DRAW_INTERVAL_MS = 33;
const STREAM_RETRY_INTERVAL_MS = 1500;
const STREAM_INITIAL_DELAY_MS = 400;

interface VoltageStreamingChartChannel {
  id: number;
  label: string;
  color: string;
}

const clampVoltage = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const defaultMockValue = (channelId: number) => {
  const baseValues = [1.68, 1.49, 2.98, 1.78, 1.08, 2.43];
  return baseValues[channelId - 1] ?? 1.5;
};

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const mmm = String(date.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mmm}`;
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

const drawPlaceholder = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  message: string
) => {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.92)';
  ctx.font = '13px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, width / 2, height / 2);
  ctx.restore();
};

interface VoltageStreamingChartProps {
  channels: VoltageStreamingChartChannel[];
  connected: boolean;
  range: {
    min: number;
    max: number;
  };
}

const VoltageStreamingChartComponent: React.FC<VoltageStreamingChartProps> = ({
  channels,
  connected,
  range,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const channelsRef = useRef(channels);
  const connectedRef = useRef(connected);
  const rangeRef = useRef(range);
  const dirtyRef = useRef(true);
  const animationFrameRef = useRef<number>();
  const lastDrawRef = useRef(0);
  const lastStatusKeyRef = useRef('init');

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    dirtyRef.current = true;
  }, []);

  const drawChart = useCallback((now: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    const latestFrame = getLatestFrame();
    const hasFrames = !!latestFrame;
    const isLive = !!(connectedRef.current && latestFrame && (now - latestFrame.timestamp) <= STALE_THRESHOLD_MS);
    const streamState = !connectedRef.current
      ? 'idle'
      : !latestFrame
        ? 'waiting'
        : isLive
          ? 'live'
          : 'stale';
    const rightEdge = latestFrame ? (isLive ? now : latestFrame.timestamp) : now;
    const leftEdge = rightEdge - WINDOW_MS;
    const visibleFrames = latestFrame ? getFramesSince(leftEdge) : [];

    if (!hasFrames || visibleFrames.length === 0) {
      const placeholderMessage = !connectedRef.current
        ? '시리얼 포트를 연결해주세요'
        : '스트림 시작 대기 중...';
      drawPlaceholder(ctx, width, height, placeholderMessage);
    } else {
      const plot = {
        left: 68,
        top: 28,
        right: 18,
        bottom: 56,
      };
      const plotWidth = Math.max(1, width - plot.left - plot.right);
      const plotHeight = Math.max(1, height - plot.top - plot.bottom);
      const yMin = rangeRef.current.min;
      const yMax = rangeRef.current.max;
      const ySpan = Math.max(yMax - yMin, 0.001);

      ctx.clearRect(0, 0, width, height);

      ctx.save();
      ctx.strokeStyle = 'rgba(58, 84, 145, 0.34)';
      ctx.lineWidth = 1;

      for (let index = 0; index < X_TICK_COUNT; index += 1) {
        const ratio = index / (X_TICK_COUNT - 1);
        const x = plot.left + (plotWidth * ratio);
        const tickTime = leftEdge + (WINDOW_MS * ratio);

        ctx.beginPath();
        ctx.moveTo(x, plot.top);
        ctx.lineTo(x, plot.top + plotHeight);
        ctx.stroke();

        ctx.save();
        ctx.translate(x, plot.top + plotHeight + 18);
        ctx.rotate(-Math.PI / 6);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.92)';
        ctx.font = '10px Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatTimestamp(tickTime), 0, 0);
        ctx.restore();
      }

      for (let index = 0; index < Y_TICK_COUNT; index += 1) {
        const ratio = index / (Y_TICK_COUNT - 1);
        const y = plot.top + (plotHeight * ratio);
        const tickValue = yMax - (ySpan * ratio);

        ctx.beginPath();
        ctx.moveTo(plot.left, y);
        ctx.lineTo(plot.left + plotWidth, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.92)';
        ctx.font = '11px Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${tickValue.toFixed(2)}V`, plot.left - 8, y);
      }
      ctx.restore();

      ctx.save();
      ctx.rect(plot.left, plot.top, plotWidth, plotHeight);
      ctx.clip();

      channelsRef.current.forEach((channel) => {
        ctx.beginPath();
        ctx.strokeStyle = channel.color;
        ctx.lineWidth = 2;

        let hasPoint = false;
        let lastX = 0;
        let lastY = 0;

        visibleFrames.forEach((frame) => {
          const value = frame.values[channel.id - 1];
          if (!Number.isFinite(value)) return;

          const x = plot.left + (((frame.timestamp - leftEdge) / WINDOW_MS) * plotWidth);
          const y = plot.top + (((yMax - value) / ySpan) * plotHeight);

          lastX = x;
          lastY = y;

          if (!hasPoint) {
            ctx.moveTo(x, y);
            hasPoint = true;
          } else {
            ctx.lineTo(x, y);
          }
        });

        if (!hasPoint) return;

        ctx.stroke();

        ctx.fillStyle = channel.color;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    const badgeText = streamState === 'live'
      ? 'LIVE'
      : streamState === 'stale'
        ? 'STALE'
        : streamState === 'waiting'
          ? 'WAITING'
          : 'IDLE';
    const badgeColor = streamState === 'live'
      ? '#22c55e'
      : streamState === 'stale'
        ? '#f59e0b'
        : streamState === 'waiting'
          ? '#38bdf8'
          : '#94a3b8';
    const badgeWidth = streamState === 'waiting' ? 72 : 54;
    const badgeHeight = 24;
    const badgeX = width - badgeWidth - 12;
    const badgeY = 10;

    ctx.save();
    drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 8);
    ctx.fillStyle = streamState === 'live'
      ? 'rgba(34, 197, 94, 0.16)'
      : streamState === 'stale'
        ? 'rgba(245, 158, 11, 0.16)'
        : streamState === 'waiting'
          ? 'rgba(56, 189, 248, 0.16)'
          : 'rgba(148, 163, 184, 0.16)';
    ctx.fill();
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = badgeColor;
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
    ctx.restore();

    if (!hasFrames || visibleFrames.length === 0) {
      return;
    }
  }, []);

  useEffect(() => {
    channelsRef.current = channels;
    dirtyRef.current = true;
  }, [channels]);

  useEffect(() => {
    connectedRef.current = connected;
    dirtyRef.current = true;
  }, [connected]);

  useEffect(() => {
    rangeRef.current = range;
    dirtyRef.current = true;
  }, [range]);

  useEffect(() => {
    resizeCanvas();

    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver(() => {
      resizeCanvas();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [resizeCanvas]);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      dirtyRef.current = true;
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const renderLoop = (timestamp: number) => {
      const latestFrame = getLatestFrame();
      const now = Date.now();
      const isLive = !!(connectedRef.current && latestFrame && (now - latestFrame.timestamp) <= STALE_THRESHOLD_MS);
      const statusKey = latestFrame
        ? `${isLive ? 'live' : 'stale'}:${latestFrame.timestamp}:${channelsRef.current.length}:${rangeRef.current.min}:${rangeRef.current.max}`
        : `empty:${connectedRef.current}:${channelsRef.current.length}:${rangeRef.current.min}:${rangeRef.current.max}`;

      const shouldDraw = dirtyRef.current || isLive || statusKey !== lastStatusKeyRef.current;

      if (shouldDraw && (lastDrawRef.current === 0 || timestamp - lastDrawRef.current >= DRAW_INTERVAL_MS)) {
        drawChart(now);
        dirtyRef.current = false;
        lastDrawRef.current = timestamp;
        lastStatusKeyRef.current = statusKey;
      }

      animationFrameRef.current = window.requestAnimationFrame(renderLoop);
    };

    animationFrameRef.current = window.requestAnimationFrame(renderLoop);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawChart]);

  return (
    <div className="voltage__chart-stage" ref={containerRef}>
      <canvas className="voltage__chart-canvas" ref={canvasRef} />
    </div>
  );
};

const areEqual = (prevProps: VoltageStreamingChartProps, nextProps: VoltageStreamingChartProps) => {
  if (prevProps.connected !== nextProps.connected) return false;
  if (prevProps.range.min !== nextProps.range.min || prevProps.range.max !== nextProps.range.max) return false;
  if (prevProps.channels.length !== nextProps.channels.length) return false;

  for (let index = 0; index < prevProps.channels.length; index += 1) {
    const prevChannel = prevProps.channels[index];
    const nextChannel = nextProps.channels[index];
    if (
      prevChannel.id !== nextChannel.id
      || prevChannel.label !== nextChannel.label
      || prevChannel.color !== nextChannel.color
    ) {
      return false;
    }
  }

  return true;
};

const VoltageStreamingChart = React.memo(VoltageStreamingChartComponent, areEqual);

const VoltageMonitorPage: React.FC = () => {
  const { connected, send } = useSerial();
  const [channels, setChannels] = useRecoilState(voltageChannelsState);
  const [range, setRange] = useRecoilState(voltageRangeState);
  const [collectWindowMinutes, setCollectWindowMinutes] = useState(1);
  const [showWindowStats, setShowWindowStats] = useState(false);
  const isMockMode = typeof window !== 'undefined' && !window.electronAPI;

  const enabledChannels = channels.filter((channel) => channel.enabled);

  const chartChannels = useMemo<VoltageStreamingChartChannel[]>(
    () =>
      enabledChannels.map((channel) => ({
        id: channel.id,
        label: channel.label,
        color: channel.color,
      })),
    [enabledChannels]
  );

  useEffect(() => {
    if (isMockMode || !connected) return;

    let retryInterval: number | undefined;

    const requestStreamStart = () => {
      const latestFrame = getLatestFrame();
      const frameAge = latestFrame ? Date.now() - latestFrame.timestamp : Number.POSITIVE_INFINITY;

      if (frameAge > STALE_THRESHOLD_MS) {
        send('vmlog on');
      }
    };

    const initialDelay = window.setTimeout(() => {
      requestStreamStart();
      retryInterval = window.setInterval(() => {
        requestStreamStart();
      }, STREAM_RETRY_INTERVAL_MS);
    }, STREAM_INITIAL_DELAY_MS);

    return () => {
      window.clearTimeout(initialDelay);
      if (retryInterval) {
        window.clearInterval(retryInterval);
      }
      if (connected) {
        send('vmlog off');
      }
    };
  }, [connected, isMockMode, send]);

  const toggleChannel = useCallback(
    (id: number) => {
      setChannels((prev) =>
        prev.map((channel) => (channel.id === id ? { ...channel, enabled: !channel.enabled } : channel))
      );
    },
    [setChannels]
  );

  useEffect(() => {
    if (!connected || !isMockMode) return;

    const interval = window.setInterval(() => {
      const timestamp = Date.now();
      const nextValues: number[] = [];

      setChannels((prev) =>
        prev.map((channel) => {
          const baseValue = channel.currentValue > 0 ? channel.currentValue : defaultMockValue(channel.id);
          const nextValue = clampVoltage(
            parseFloat((baseValue + (Math.random() - 0.5) * 0.03).toFixed(3)),
            range.min,
            range.max
          );
          nextValues[channel.id - 1] = nextValue;

          return {
            ...channel,
            currentValue: nextValue,
          };
        })
      );

      if (nextValues.length === 6) {
        pushFrame({
          timestamp,
          values: nextValues as [number, number, number, number, number, number],
        });
      }
    }, MOCK_SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [connected, isMockMode, range.max, range.min, setChannels]);

  const samplingWindowStats = useMemo(() => {
    if (!showWindowStats) return null;

    const latestFrame = getLatestFrame();
    if (!latestFrame) return null;

    const frames = getFramesSince(latestFrame.timestamp - collectWindowMinutes * 60 * 1000);
    if (frames.length < 2) return null;

    const gaps: number[] = [];
    for (let i = 1; i < frames.length; i += 1) {
      const gap = frames[i].timestamp - frames[i - 1].timestamp;
      if (gap > 0) {
        gaps.push(gap);
      }
    }

    if (gaps.length === 0) return null;

    return {
      average: Math.round((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) * 100) / 100,
      min: Math.min(...gaps),
      max: Math.max(...gaps),
      sampleCount: frames.length,
    };
  }, [collectWindowMinutes, showWindowStats, channels]);

  return (
    <div className="voltage-page">
      <div className="voltage__top">
        <div className="voltage__channels">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className={`voltage__channel ${channel.enabled ? 'voltage__channel--active' : ''}`}
              onClick={() => toggleChannel(channel.id)}
              role="button"
              tabIndex={0}
            >
              <div
                className="voltage__channel-dot"
                style={{ background: channel.enabled ? channel.color : 'var(--text-tertiary)' }}
              />
              <div className="voltage__channel-info">
                <span className="voltage__channel-label">{channel.label}</span>
                <span
                  className="voltage__channel-value"
                  style={{ color: channel.enabled ? channel.color : 'var(--text-tertiary)' }}
                >
                  {channel.currentValue.toFixed(3)}
                  <span className="voltage__channel-unit"> V</span>
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="voltage__range">
          <span className="voltage__range-label">Range</span>
          <input
            className="input voltage__range-input"
            type="number"
            step="0.1"
            value={range.min}
            onChange={(event) => setRange((prev) => ({ ...prev, min: parseFloat(event.target.value) || 0 }))}
          />
          <span style={{ color: 'var(--text-tertiary)' }}>~</span>
          <input
            className="input voltage__range-input"
            type="number"
            step="0.1"
            value={range.max}
            onChange={(event) => setRange((prev) => ({ ...prev, max: parseFloat(event.target.value) || 3.3 }))}
          />
          <span className="voltage__range-label">V</span>
          <label className="voltage__range-label" style={{ marginLeft: 12 }}>
            <input
              type="checkbox"
              checked={showWindowStats}
              onChange={(event) => setShowWindowStats(event.target.checked)}
              style={{ marginRight: 6 }}
            />
            창 단위 통계 보기
          </label>
          {showWindowStats && (
            <>
              <span className="voltage__range-label">Window</span>
              <input
                className="input voltage__range-input"
                type="number"
                min={1}
                max={30}
                style={{ width: 70 }}
                value={collectWindowMinutes}
                onChange={(event) => {
                  const nextValue = parseInt(event.target.value, 10);
                  setCollectWindowMinutes(Number.isNaN(nextValue) ? 1 : Math.max(1, Math.min(30, nextValue)));
                }}
              />
              <span className="voltage__range-label">분</span>
            </>
          )}
        </div>
      </div>

      <div className="voltage__chart">
        {enabledChannels.length === 0 ? (
          <div className="voltage__chart-placeholder">모니터링할 채널을 선택해주세요</div>
        ) : (
          <VoltageStreamingChart channels={chartChannels} connected={connected} range={range} />
        )}
      </div>

      {showWindowStats && (
        <div className="voltage__stats">
          {samplingWindowStats ? (
            <span>
              최근 {collectWindowMinutes}분 | 표본: {samplingWindowStats.sampleCount}개 | 평균 {samplingWindowStats.average}ms / 최소{' '}
              {samplingWindowStats.min}ms / 최대 {samplingWindowStats.max}ms
            </span>
          ) : (
            <span>최근 {collectWindowMinutes}분 통계 데이터가 아직 부족합니다.</span>
          )}
        </div>
      )}
    </div>
  );
};

export default VoltageMonitorPage;
