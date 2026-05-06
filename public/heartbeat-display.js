"use strict";

const CONFIG = {
  background: {
    src: "./heartbeat-assets/cluster_bg_1920x720.png",
    baseWidth: 1920,
    baseHeight: 720,
  },
  heartbeat: {
    color: "rgb(0, 0, 100)",
    fps: 60,
    markers: [
      { anchor: "top-left", marginX: 24, marginY: 24, dirX: 1, dirY: 1 },
    ],
    size: 2,
    stepPerFrame: 1,
    travel: 20,
  },
  notice: {
    durationMs: 900,
    fillColor: "rgba(0, 0, 0, 0.78)",
    fontPx: 28,
    paddingX: 18,
    paddingY: 12,
    strokeColor: "rgba(80, 140, 255, 0.9)",
    textColor: "#e7f0ff",
  },
  overlay: {
    fillAlpha: 0.76,
    lineWidth: 2,
    labelFill: "rgba(8, 12, 20, 0.84)",
    labelFontPx: 13,
    labelPaddingX: 8,
    labelPaddingY: 5,
  },
};

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d", { alpha: false });
const backgroundImage = new Image();
backgroundImage.decoding = "async";

const state = {
  activeElapsedMs: 0,
  backgroundFailed: false,
  backgroundImage: CONFIG.background.src,
  heartbeatEnabled: true,
  lastRenderMs: null,
  noticeText: "",
  noticeUntilMs: 0,
  overlayRect: null,
  overlayRects: [],
  viewportHeight: 0,
  viewportWidth: 0,
};

function getMessageTargetOrigin() {
  // file://와 iframe preview에서는 origin이 "null"일 수 있어 postMessage 대상만 wildcard로 완화합니다.
  // 실제 수신은 isTrustedDisplayOrigin에서 다시 제한합니다.
  return window.location.origin === "null" ? "*" : window.location.origin;
}

function isTrustedDisplayOrigin(origin) {
  return (
    origin === window.location.origin
    || origin === "null"
    || window.location.origin === "null"
    || origin.startsWith("file://")
    || window.location.origin.startsWith("file://")
    || origin === ""
  );
}

function pushNotice(message) {
  if (!message) return;

  state.noticeText = String(message);
  state.noticeUntilMs = performance.now() + CONFIG.notice.durationMs;
}

function resizeCanvas() {
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.viewportWidth = cssWidth;
  state.viewportHeight = cssHeight;
}

function getCoverRect(viewWidth, viewHeight, sourceWidth, sourceHeight) {
  // 1920x720 기준 좌표를 어떤 창 크기에서도 같은 시각 위치에 보이게 하려고 CSS background-size: cover와 같은 계산을 씁니다.
  const scale = Math.max(viewWidth / sourceWidth, viewHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return {
    height: drawHeight,
    width: drawWidth,
    x: (viewWidth - drawWidth) / 2,
    y: (viewHeight - drawHeight) / 2,
  };
}

function getDisplayBaseRect() {
  return getCoverRect(
    state.viewportWidth,
    state.viewportHeight,
    CONFIG.background.baseWidth,
    CONFIG.background.baseHeight
  );
}

function mapOverlayToViewport(overlay) {
  // overlay.x/y/width/height는 원본 클러스터 이미지 좌표입니다.
  // 배경이 cover로 잘리거나 확대되어도 같은 아이콘 영역을 덮도록 viewport 좌표로 변환합니다.
  const displayRect = getDisplayBaseRect();
  const scaleX = displayRect.width / CONFIG.background.baseWidth;
  const scaleY = displayRect.height / CONFIG.background.baseHeight;

  return {
    ...overlay,
    height: overlay.height * scaleY,
    scale: Math.min(scaleX, scaleY),
    width: overlay.width * scaleX,
    x: displayRect.x + overlay.x * scaleX,
    y: displayRect.y + overlay.y * scaleY,
  };
}

function triangleOffset(frame, travel, stepPerFrame) {
  // heartbeat marker는 왕복 삼각파로 움직입니다. 한 방향으로만 증가시키면 화면 밖으로 나갑니다.
  if (travel <= 0 || stepPerFrame <= 0) {
    return 0;
  }

  const period = travel * 2;
  const phase = (frame * stepPerFrame) % period;
  return phase <= travel ? phase : period - phase;
}

function getMarkerBasePosition(marker, viewWidth, viewHeight, size) {
  const left = marker.marginX;
  const top = marker.marginY;
  const right = viewWidth - marker.marginX - size;
  const bottom = viewHeight - marker.marginY - size;

  switch (marker.anchor) {
    case "top-right":
      return { x: right, y: top };
    case "bottom-left":
      return { x: left, y: bottom };
    case "bottom-right":
      return { x: right, y: bottom };
    case "top-left":
    default:
      return { x: left, y: top };
  }
}

function getHeartbeatPositions(frame) {
  const { markers, size, stepPerFrame, travel } = CONFIG.heartbeat;
  const offset = triangleOffset(frame, travel, stepPerFrame);

  return markers.map((marker) => {
    const base = getMarkerBasePosition(
      marker,
      state.viewportWidth,
      state.viewportHeight,
      size
    );

    return {
      anchor: marker.anchor,
      x: base.x + offset * marker.dirX,
      y: base.y + offset * marker.dirY,
    };
  });
}

function setBackgroundImageSource(source) {
  const nextSource = typeof source === "string" && source.trim()
    ? source.trim()
    : CONFIG.background.src;

  if (backgroundImage.src.endsWith(nextSource)) {
    return;
  }

  state.backgroundFailed = false;
  backgroundImage.src = nextSource;
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, state.viewportHeight);
  gradient.addColorStop(0, "#081021");
  gradient.addColorStop(1, "#000000");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.viewportWidth, state.viewportHeight);

  if (!backgroundImage.complete || state.backgroundFailed) {
    return;
  }

  const sourceWidth = backgroundImage.naturalWidth || CONFIG.background.baseWidth;
  const sourceHeight = backgroundImage.naturalHeight || CONFIG.background.baseHeight;
  const coverRect = getCoverRect(
    state.viewportWidth,
    state.viewportHeight,
    sourceWidth,
    sourceHeight
  );

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    backgroundImage,
    coverRect.x,
    coverRect.y,
    coverRect.width,
    coverRect.height
  );
}

function drawHeartbeats(positions) {
  if (!state.heartbeatEnabled) {
    return;
  }

  ctx.fillStyle = CONFIG.heartbeat.color;
  for (const position of positions) {
    ctx.fillRect(position.x, position.y, CONFIG.heartbeat.size, CONFIG.heartbeat.size);
  }
}

function normalizeHexColor(color) {
  if (typeof color !== "string" || !color.trim()) {
    return "#ff3b30";
  }

  const trimmed = color.trim();
  if (!trimmed.startsWith("#")) {
    return trimmed;
  }

  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }

  return trimmed;
}

function hexToRgba(color, alpha) {
  const normalized = normalizeHexColor(color);
  if (!normalized.startsWith("#") || normalized.length !== 7) {
    return normalized;
  }

  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getOverlayContrastColor(color) {
  const normalized = normalizeHexColor(color);
  if (!normalized.startsWith("#") || normalized.length !== 7) {
    return "#ffffff";
  }

  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 160 ? "#07101c" : "#ffffff";
}

function drawOverlayLabel(overlay) {
  const overlayId = overlay.id !== undefined && overlay.id !== null
    ? `#${String(overlay.id).padStart(2, "0")}`
    : "VSB";
  const overlayName = overlay.source || overlay.label || "";
  const labelText = overlayName ? `${overlayId} ${overlayName}` : overlayId;
  const { labelFontPx, labelFill, labelPaddingX, labelPaddingY } = CONFIG.overlay;
  const scale = Number.isFinite(overlay.scale) && overlay.scale > 0 ? overlay.scale : 1;
  const fontPx = Math.max(8, Math.round(labelFontPx * scale));
  const paddingX = Math.max(4, Math.round(labelPaddingX * scale));
  const paddingY = Math.max(3, Math.round(labelPaddingY * scale));
  const labelWidth = Math.max(48, Math.min(160, overlay.width || 48));
  const labelHeight = fontPx + paddingY * 2;
  const labelX = overlay.x;
  const labelY = overlay.y >= labelHeight + 8 ? overlay.y - labelHeight - 6 : overlay.y + 6;

  ctx.save();
  ctx.font = `700 ${fontPx}px Consolas, "Courier New", monospace`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = labelFill;
  ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
  ctx.fillStyle = getOverlayContrastColor(overlay.color);
  ctx.fillText(labelText, labelX + paddingX, labelY + Math.round(labelHeight / 2));
  ctx.restore();
}

function drawSingleOverlayRect(overlay) {
  if (
    !overlay
    || !overlay.visible
    || !Number.isFinite(overlay.width)
    || !Number.isFinite(overlay.height)
    || overlay.width <= 0
    || overlay.height <= 0
  ) {
    return;
  }

  const viewportOverlay = mapOverlayToViewport(overlay);

  ctx.save();
  ctx.fillStyle = hexToRgba(overlay.color || "#ff3b30", CONFIG.overlay.fillAlpha);
  ctx.strokeStyle = getOverlayContrastColor(overlay.color);
  ctx.lineWidth = CONFIG.overlay.lineWidth;
  ctx.fillRect(viewportOverlay.x, viewportOverlay.y, viewportOverlay.width, viewportOverlay.height);
  ctx.strokeRect(viewportOverlay.x, viewportOverlay.y, viewportOverlay.width, viewportOverlay.height);
  drawOverlayLabel(viewportOverlay);
  ctx.restore();
}

function drawOverlayRects() {
  // overlayRects가 있으면 다중 VSB 모드, 없으면 예전 단일 overlayRect 상태를 fallback으로 사용합니다.
  const overlays = state.overlayRects.length
    ? state.overlayRects
    : state.overlayRect && state.overlayRect.visible
      ? [state.overlayRect]
      : [];

  overlays.forEach((overlay) => {
    drawSingleOverlayRect(overlay);
  });
}

function drawNotice(nowMs) {
  if (!state.noticeText || nowMs >= state.noticeUntilMs) {
    return;
  }

  const { fillColor, fontPx, paddingX, paddingY, strokeColor, textColor } = CONFIG.notice;

  ctx.save();
  ctx.font = `700 ${fontPx}px Consolas, "Courier New", monospace`;
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(state.noticeText);
  const boxWidth = Math.ceil(metrics.width + paddingX * 2);
  const boxHeight = Math.ceil(fontPx + paddingY * 2);
  const boxX = Math.round((state.viewportWidth - boxWidth) / 2);
  const boxY = 36;
  const textX = Math.round(boxX + paddingX);
  const textY = Math.round(boxY + boxHeight / 2);

  ctx.fillStyle = fillColor;
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
  ctx.fillStyle = textColor;
  ctx.fillText(state.noticeText, textX, textY);
  ctx.restore();
}

function normalizeOverlayRect(overlay) {
  if (!overlay) return null;

  const width = Number.isFinite(overlay.width) ? Number(overlay.width) : null;
  const height = Number.isFinite(overlay.height) ? Number(overlay.height) : null;

  return {
    color: normalizeHexColor(overlay.color || "#ff3b30"),
    height,
    id: overlay.id,
    label: typeof overlay.label === "string" ? overlay.label : undefined,
    refColor: Number.isFinite(overlay.refColor) ? Number(overlay.refColor) : null,
    source: typeof overlay.source === "string" ? overlay.source : undefined,
    visible: Boolean(overlay.visible && width && width > 0 && height && height > 0),
    width,
    x: Number.isFinite(overlay.x) ? Number(overlay.x) : 0,
    y: Number.isFinite(overlay.y) ? Number(overlay.y) : 0,
  };
}

function normalizeOverlayRects(overlays) {
  if (!Array.isArray(overlays)) {
    return [];
  }

  return overlays
    .map((overlay) => normalizeOverlayRect(overlay))
    .filter((overlay) => overlay && overlay.visible);
}

function applyDisplayState(nextState) {
  if (!nextState || typeof nextState !== "object") {
    return;
  }

  if (
    typeof nextState.backgroundImage === "string"
    && nextState.backgroundImage.trim()
    && nextState.backgroundImage !== state.backgroundImage
  ) {
    state.backgroundImage = nextState.backgroundImage;
    setBackgroundImageSource(nextState.backgroundImage);
  }

  if (typeof nextState.heartbeatEnabled === "boolean" && nextState.heartbeatEnabled !== state.heartbeatEnabled) {
    state.heartbeatEnabled = nextState.heartbeatEnabled;
    pushNotice(nextState.heartbeatEnabled ? "HEARTBEAT ON" : "HEARTBEAT OFF");
  }

  const overlayRects = normalizeOverlayRects(nextState.overlayRects);
  // 단일/다중 overlay API를 동시에 지원하므로 primary overlayRect는 항상 첫 번째 visible rect와 맞춥니다.
  state.overlayRects = overlayRects;
  state.overlayRect = normalizeOverlayRect(nextState.overlayRect) || overlayRects[0] || null;
}

function announceReady() {
  // preview iframe은 parent로, Electron sub window는 opener/preload IPC로 상태를 받을 수 있어 둘 다 알립니다.
  const message = { type: "heartbeat-display:ready" };
  const targetOrigin = getMessageTargetOrigin();

  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, targetOrigin);
  }

  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(message, targetOrigin);
  }
}

function render(nowMs) {
  if (state.lastRenderMs === null) {
    state.lastRenderMs = nowMs;
  }

  const deltaMs = Math.max(nowMs - state.lastRenderMs, 0);
  if (state.heartbeatEnabled) {
    state.activeElapsedMs += deltaMs;
  }

  const frame = Math.floor(state.activeElapsedMs / (1000 / CONFIG.heartbeat.fps));
  const positions = getHeartbeatPositions(frame);

  drawBackground();
  drawHeartbeats(positions);
  drawOverlayRects();
  drawNotice(nowMs);

  state.lastRenderMs = nowMs;
  window.requestAnimationFrame(render);
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("message", (event) => {
  if (!isTrustedDisplayOrigin(event.origin)) return;
  if (event.data?.type !== "heartbeat-display:state") return;
  applyDisplayState(event.data.payload);
});

backgroundImage.addEventListener("load", () => {
  state.backgroundFailed = false;
});

backgroundImage.addEventListener("error", () => {
  state.backgroundFailed = true;
  pushNotice("BACKGROUND FALLBACK");
});

if (window.heartbeatDisplay) {
  window.heartbeatDisplay.getState().then(applyDisplayState).catch(() => {});
  window.heartbeatDisplay.onState(applyDisplayState);
}

resizeCanvas();
setBackgroundImageSource(CONFIG.background.src);
announceReady();
window.requestAnimationFrame(render);
