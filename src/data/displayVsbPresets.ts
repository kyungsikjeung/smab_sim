import { DisplayOverlayInput, DisplayOverlayPreset } from 'types';

const toColorByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export const bgrNumberToHexColor = (value: number) => {
  const normalized = Math.max(0, Math.min(0xffffff, Math.round(value)));
  const red = toColorByte(normalized & 0xff);
  const green = toColorByte((normalized >> 8) & 0xff);
  const blue = toColorByte((normalized >> 16) & 0xff);

  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
};

export const hexColorToBgrNumber = (value: string) => {
  const normalized = value.replace(/^#/, '');
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);

  return ((blue << 16) | (green << 8) | red) >>> 0;
};

const normalizeHexColor = (value: unknown, fallbackColor: string) => {
  if (typeof value !== 'string') return fallbackColor;

  const normalized = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallbackColor;

  return `#${normalized.toLowerCase()}`;
};

const toIntegerOrFallback = (value: unknown, fallbackValue: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallbackValue;
};

const toPositiveIntegerOrFallback = (value: unknown, fallbackValue: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.max(1, Math.round(parsed));
};

const buildPreset = (
  slot: number,
  source: string,
  x: number,
  y: number,
  width: number,
  height: number,
  refColor: number,
  illumi: number,
  smode: number
): DisplayOverlayPreset => ({
  slot,
  source,
  label: `Warning ${String(slot).padStart(2, '0')}`,
  color: bgrNumberToHexColor(refColor),
  x,
  y,
  width,
  height,
  refColor,
  illumi,
  smode,
});

export const DISPLAY_VSB_PRESETS: DisplayOverlayPreset[] = [
  buildPreset(1, '0.bin', 615, 60, 50, 50, 64381, 1, 2),
  buildPreset(2, '1.bin', 1255, 60, 50, 50, 64381, 1, 2),
  buildPreset(3, '2.bin', 478, 335, 50, 50, 7167, 1, 2),
  buildPreset(4, '3.bin', 450, 249, 50, 50, 16773360, 1, 2),
  buildPreset(5, '4.bin', 377, 197, 50, 50, 270079, 1, 2),
  buildPreset(6, '5.bin', 288, 197, 50, 50, 16734755, 1, 2),
  buildPreset(7, '6.bin', 215, 249, 50, 50, 16734498, 1, 2),
  buildPreset(8, '7.bin', 188, 335, 50, 50, 269823, 1, 2),
  buildPreset(9, '8.bin', 215, 420, 50, 50, 270079, 1, 2),
  buildPreset(10, '9.bin', 288, 472, 50, 50, 327454, 1, 2),
  buildPreset(11, '10.bin', 377, 472, 50, 50, 7167, 1, 2),
  buildPreset(12, '11.bin', 450, 420, 50, 50, hexColorToBgrNumber('#ff0f0a'), 1, 2),
  buildPreset(13, '12.bin', 1682, 335, 50, 50, 204543, 1, 2),
  buildPreset(14, '13.bin', 1654, 249, 50, 50, 204799, 1, 2),
  buildPreset(15, '14.bin', 1581, 197, 50, 50, 36095, 1, 2),
  buildPreset(16, '15.bin', 1492, 197, 50, 50, 269823, 1, 2),
  buildPreset(17, '16.bin', 1419, 249, 50, 50, 270079, 1, 2),
  buildPreset(18, '17.bin', 1392, 335, 50, 50, 204543, 1, 2),
  buildPreset(19, '18.bin', 1419, 420, 50, 50, 16773360, 1, 2),
  buildPreset(20, '19.bin', 1492, 472, 50, 50, 269823, 1, 2),
  buildPreset(21, '20.bin', 1581, 472, 50, 50, 269823, 1, 2),
  buildPreset(22, '21.bin', 1654, 420, 50, 50, 270079, 1, 2),
  buildPreset(23, '22.bin', 333, 335, 50, 50, 7167, 1, 2),
  buildPreset(24, '23.bin', 1537, 335, 50, 50, 270079, 1, 2),
  buildPreset(25, '24.bin', 910, 310, 100, 100, 16773360, 0, 2),
  buildPreset(26, '25.bin', 1095, 163, 86, 30, 16187390, 0, 2),
  buildPreset(27, '26.bin', 100, 30, 145, 30, 255, 0, 2),
  buildPreset(28, '27.bin', 842, 460, 237, 68, 1908209, 0, 1),
  buildPreset(29, '28.bin', 855, 140, 79, 104, 66042, 0, 1),
  buildPreset(30, '29.bin', 850, 93, 79, 104, 66042, 0, 1),
  buildPreset(31, '30.bin', 1600, 600, 79, 104, 66042, 0, 1),
  buildPreset(32, '31.bin', 0, 0, 79, 104, 16777215, 0, 1),
];

export const DISPLAY_VSB_SLOT_COUNT = DISPLAY_VSB_PRESETS.length;

export const cloneDisplayVsbPresets = (presets: DisplayOverlayPreset[] = DISPLAY_VSB_PRESETS): DisplayOverlayPreset[] => (
  presets.map((preset) => ({ ...preset }))
);

export const createDisplayVsbSampleJson = (presets: DisplayOverlayPreset[] = DISPLAY_VSB_PRESETS) => JSON.stringify(
  presets.map((preset) => ({
    slot: preset.slot,
    label: preset.label,
    color: preset.color,
    x: preset.x,
    y: preset.y,
    width: preset.width,
    height: preset.height,
  })),
  null,
  2
);

export const importDisplayVsbPresetJson = (
  input: unknown,
  fallbackPresets: DisplayOverlayPreset[] = DISPLAY_VSB_PRESETS
): DisplayOverlayPreset[] => {
  if (!Array.isArray(input)) {
    throw new Error('Sample.json 형식은 배열이어야 합니다.');
  }

  const nextPresetMap = new Map(
    cloneDisplayVsbPresets(fallbackPresets).map((preset) => [preset.slot, preset])
  );

  input.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Sample.json ${index + 1}번째 항목 형식이 올바르지 않습니다.`);
    }

    const slot = Number((entry as { slot?: unknown }).slot);
    if (!Number.isInteger(slot) || !nextPresetMap.has(slot)) {
      throw new Error(`Sample.json ${index + 1}번째 slot 값이 잘못되었습니다.`);
    }

    const basePreset = nextPresetMap.get(slot);
    if (!basePreset) {
      throw new Error(`slot ${slot} preset을 찾을 수 없습니다.`);
    }

    const nextColor = normalizeHexColor((entry as { color?: unknown }).color, basePreset.color);

    nextPresetMap.set(slot, {
      ...basePreset,
      label: typeof (entry as { label?: unknown }).label === 'string' && (entry as { label?: string }).label?.trim()
        ? (entry as { label: string }).label.trim()
        : basePreset.label,
      source: typeof (entry as { source?: unknown }).source === 'string' && (entry as { source?: string }).source?.trim()
        ? (entry as { source: string }).source.trim()
        : basePreset.source,
      color: nextColor,
      refColor: typeof (entry as { refColor?: unknown }).refColor === 'number' && Number.isFinite((entry as { refColor: number }).refColor)
        ? Math.max(0, Math.min(0xffffff, Math.round((entry as { refColor: number }).refColor)))
        : hexColorToBgrNumber(nextColor),
      x: toIntegerOrFallback((entry as { x?: unknown }).x, basePreset.x),
      y: toIntegerOrFallback((entry as { y?: unknown }).y, basePreset.y),
      width: toPositiveIntegerOrFallback((entry as { width?: unknown }).width, basePreset.width),
      height: toPositiveIntegerOrFallback((entry as { height?: unknown }).height, basePreset.height),
      illumi: toIntegerOrFallback((entry as { illumi?: unknown }).illumi, basePreset.illumi),
      smode: toIntegerOrFallback((entry as { smode?: unknown }).smode, basePreset.smode),
    });
  });

  return fallbackPresets.map((preset) => {
    const nextPreset = nextPresetMap.get(preset.slot);
    if (!nextPreset) {
      throw new Error(`slot ${preset.slot} preset 복원에 실패했습니다.`);
    }
    return nextPreset;
  });
};

export const buildOverlayInputFromPreset = (preset: DisplayOverlayPreset): DisplayOverlayInput => ({
  id: preset.slot,
  label: preset.label,
  source: preset.source,
  refColor: preset.refColor,
  color: preset.color,
  height: preset.height,
  width: preset.width,
  x: preset.x,
  y: preset.y,
});
