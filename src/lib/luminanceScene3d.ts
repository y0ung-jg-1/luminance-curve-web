import type { CurveSeries, LuminanceScene3DData, PostProcessResult } from '../types';

const niceAxisMax = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;

  return niceFraction * exponent;
};

export const buildLuminanceScene3DData = (
  visibleCurves: CurveSeries[],
  processedResult: PostProcessResult,
): LuminanceScene3DData => {
  const visibleIds = new Set(visibleCurves.map((curve) => curve.id));
  const points = processedResult.cleanedPoints
    .filter((point) => visibleIds.has(point.curveId))
    .sort((a, b) => a.alignedSeconds - b.alignedSeconds || a.curveName.localeCompare(b.curveName));

  const pointCurveIds = new Set(points.map((point) => point.curveId));
  const curves = visibleCurves.filter((curve) => pointCurveIds.has(curve.id));
  const curveIndexById = new Map(curves.map((curve, index) => [curve.id, index]));
  const curveColorById = new Map(curves.map((curve) => [curve.id, curve.color]));
  const pointIndexByCurveId = new Map<string, number>();

  const bars = points.map((point) => {
    const xIndex = pointIndexByCurveId.get(point.curveId) ?? 0;
    pointIndexByCurveId.set(point.curveId, xIndex + 1);

    return {
      curveId: point.curveId,
      curveName: point.curveName,
      curveColor: curveColorById.get(point.curveId) ?? '#007aff',
      windowLevel: point.windowLevel,
      rowNumber: point.rowNumber,
      alignedSeconds: point.alignedSeconds,
      windowSeconds: point.windowSeconds,
      luminanceNits: point.luminanceNits,
      xIndex,
      zIndex: curveIndexById.get(point.curveId) ?? 0,
    };
  });

  const maxLuminance = bars.length > 0 ? Math.max(...bars.map((bar) => bar.luminanceNits)) : 0;
  const maxAlignedSeconds = bars.length > 0 ? Math.max(...bars.map((bar) => bar.alignedSeconds)) : 0;
  const windows = processedResult.windows
    .filter((window) => points.some((point) => point.windowLevel === window.windowLevel))
    .map((window) => ({
      windowLevel: window.windowLevel,
      alignedStartSeconds: window.alignedStartSeconds,
      alignedEndSeconds: window.alignedEndSeconds,
    }));

  return {
    curves: curves.map((curve) => ({
      id: curve.id,
      name: curve.name,
      color: curve.color,
    })),
    windows,
    bars,
    maxAlignedSeconds,
    maxLuminance,
    axisMaxLuminance: niceAxisMax(maxLuminance),
  };
};
