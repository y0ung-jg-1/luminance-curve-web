import type { CurveSeries, PostProcessResult, PostProcessWindow } from '../types';
import { windowSequence } from './windowSequence';

export interface IllustratorSvgFile {
  fileName: string;
  svg: string;
}

export interface IllustratorSvgExportOptions {
  yMin: number;
  yMax: number;
  width?: number;
  height?: number;
}

const defaultWidth = 1600;
const defaultHeight = 900;
const margin = {
  top: 130,
  right: 120,
  bottom: 120,
  left: 120,
};

const escapeXml = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const sanitizeSvgFileName = (value: string): string => {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return sanitized || 'luminance';
};

const safeId = (value: string): string => {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'layer';
};

const formatPoint = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/g, '').replace(/\.$/g, '');
};

const buildBarPath = ({
  window,
  points,
  barLeft,
  barWidth,
  baselineY,
  toY,
}: {
  window: PostProcessWindow;
  points: Array<{ windowIndex: number; luminanceNits: number }>;
  barLeft: number;
  barWidth: number;
  baselineY: number;
  toY: (value: number) => number;
}): { fillPath: string; topPath: string } => {
  const span = Math.max(window.sampleCount - 1, 1);
  const topPoints = points.map((point) => ({
    x: barLeft + (Math.max(0, Math.min(span, point.windowIndex)) / span) * barWidth,
    y: toY(point.luminanceNits),
  }));

  const first = topPoints[0];
  const last = topPoints[topPoints.length - 1];
  const topCommands = [
    `M ${formatPoint(barLeft)} ${formatPoint(first.y)}`,
    ...topPoints.map((point) => `L ${formatPoint(point.x)} ${formatPoint(point.y)}`),
    `L ${formatPoint(barLeft + barWidth)} ${formatPoint(last.y)}`,
  ];

  const fillPath = [
    `M ${formatPoint(barLeft)} ${formatPoint(baselineY)}`,
    `L ${formatPoint(barLeft)} ${formatPoint(first.y)}`,
    ...topPoints.map((point) => `L ${formatPoint(point.x)} ${formatPoint(point.y)}`),
    `L ${formatPoint(barLeft + barWidth)} ${formatPoint(last.y)}`,
    `L ${formatPoint(barLeft + barWidth)} ${formatPoint(baselineY)}`,
    'Z',
  ].join(' ');

  return {
    fillPath,
    topPath: topCommands.join(' '),
  };
};

export const buildIllustratorLayeredSvgs = (
  result: PostProcessResult,
  visibleCurves: CurveSeries[],
  options: IllustratorSvgExportOptions,
): IllustratorSvgFile[] => {
  const width = options.width ?? defaultWidth;
  const height = options.height ?? defaultHeight;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const baselineY = height - margin.bottom;
  const yMin = Number.isFinite(options.yMin) ? options.yMin : 0;
  const rawYMax = Number.isFinite(options.yMax) && options.yMax > yMin ? options.yMax : 1;
  const yMax = rawYMax === yMin ? rawYMax + 1 : rawYMax;
  const levels = windowSequence.filter((level) =>
    result.cleanedPoints.some((point) => visibleCurves.some((curve) => curve.id === point.curveId) && point.windowLevel === level),
  );
  const gap = levels.length > 1 ? Math.min(34, plotWidth * 0.028) : 0;
  const barWidth = levels.length > 0 ? (plotWidth - gap * (levels.length - 1)) / levels.length : plotWidth;
  const fileNameCounts = new Map<string, number>();

  const toY = (value: number): number => {
    const ratio = (value - yMin) / (yMax - yMin);
    const clamped = Math.max(0, Math.min(1, ratio));
    return baselineY - clamped * plotHeight;
  };

  return visibleCurves.flatMap((curve) => {
    const layers = levels.flatMap((level, index) => {
      const window = result.windows.find((candidate) => candidate.windowLevel === level);
      if (!window) return [];

      const points = result.cleanedPoints
        .filter((point) => point.curveId === curve.id && point.windowLevel === level)
        .sort((a, b) => a.windowIndex - b.windowIndex);
      if (points.length === 0) return [];

      const barLeft = margin.left + index * (barWidth + gap);
      const { fillPath, topPath } = buildBarPath({
        window,
        points,
        barLeft,
        barWidth,
        baselineY,
        toY,
      });
      const label = `${level}%`;
      const id = safeId(`window-${level}-percent`);

      return `
  <g id="${id}" data-name="${escapeXml(label)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(label)}">
    <path id="${id}-bar" data-name="${escapeXml(label)} bar" d="${fillPath}" fill="#B3B3B3"/>
    <path id="${id}-wave" data-name="${escapeXml(label)} waveform" d="${topPath}" fill="none" stroke="#8C8C8C" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
    });

    if (layers.length === 0) return [];

    const title = `${curve.name} AI layered luminance SVG`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" version="1.1">
  <title>${escapeXml(title)}</title>
  <desc>Each percentage window is a separate group/layer. Y scale: ${formatPoint(yMin)} to ${formatPoint(yMax)} nits.</desc>
  <rect id="artboard-background" data-name="Artboard background" x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>
${layers.join('\n')}
</svg>
`;

    const baseFileName = sanitizeSvgFileName(curve.name);
    const count = fileNameCounts.get(baseFileName) ?? 0;
    fileNameCounts.set(baseFileName, count + 1);

    return [
      {
        fileName: `${baseFileName}${count > 0 ? `-${count + 1}` : ''}-AI-layered.svg`,
        svg,
      },
    ];
  });
};
