import type { CurveSeries, LuminanceScene3DData, PostProcessResult, WindowSummary } from '../types';
import { windowSequence } from './windowSequence';

const makeSummaryKey = (curveId: string, level: number) => `${curveId}::${level}`;

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
  const summariesByCurveAndLevel = new Map<string, WindowSummary>();

  for (const summary of processedResult.summaries) {
    if (visibleIds.has(summary.curveId)) {
      summariesByCurveAndLevel.set(makeSummaryKey(summary.curveId, summary.windowLevel), summary);
    }
  }

  const curves = visibleCurves
    .filter((curve) => windowSequence.some((level) => summariesByCurveAndLevel.has(makeSummaryKey(curve.id, level))))
    .map((curve) => ({
      id: curve.id,
      name: curve.name,
      color: curve.color,
    }));

  const bars = curves.flatMap((curve, zIndex) =>
    windowSequence.flatMap((level, xIndex) => {
      const summary = summariesByCurveAndLevel.get(makeSummaryKey(curve.id, level));
      if (!summary) return [];

      return [
        {
          curveId: curve.id,
          curveName: curve.name,
          curveColor: curve.color,
          levelPercent: level,
          xIndex,
          zIndex,
          meanLuminance: summary.meanLuminance,
          medianLuminance: summary.medianLuminance,
          minLuminance: summary.minLuminance,
          maxLuminance: summary.maxLuminance,
          samplesKept: summary.samplesKept,
        },
      ];
    }),
  );

  const maxMeanLuminance = bars.length > 0 ? Math.max(...bars.map((bar) => bar.meanLuminance)) : 0;
  const maxMeasuredLuminance = bars.length > 0 ? Math.max(...bars.map((bar) => bar.maxLuminance)) : 0;

  return {
    levels: [...windowSequence],
    curves,
    bars,
    maxMeanLuminance,
    axisMaxLuminance: niceAxisMax(Math.max(maxMeanLuminance, maxMeasuredLuminance)),
  };
};
