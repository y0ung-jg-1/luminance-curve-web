import type {
  CleanedLuminancePoint,
  CurveSeries,
  LuminancePoint,
  PostProcessDiagnostic,
  PostProcessOptions,
  PostProcessResult,
  PostProcessWindow,
  WindowSummary,
} from '../types';
import { windowSequence } from './windowSequence';

export const defaultPostProcessOptions: PostProcessOptions = {
  alignmentMode: 'index',
  minSamplesPerWindow: 3,
  relativeOutlierTolerance: 0.08,
  minimumOutlierDeltaNits: 5,
  windowGapSlots: 0,
  normalizedWindowSlots: 180,
};

interface CurveWindowGroup {
  curve: CurveSeries;
  points: LuminancePoint[];
}

interface CurveWindowSlice extends CurveWindowGroup {
  riseIndex: number;
  availableCount: number;
}

const leadingTransitionMaxNits = 1;

const levelMatches = (value: number, level: number) => Math.abs(value - level) < 0.000001;

const sortNumbers = (values: number[]) => [...values].sort((a, b) => a - b);

const median = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = sortNumbers(values);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const stdev = (values: number[]): number => {
  if (values.length <= 1) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const findGroup = (curve: CurveSeries, level: number): LuminancePoint[] =>
  curve.points
    .filter((point) => levelMatches(point.levelPercent, level))
    .sort((a, b) => a.cycleSeconds - b.cycleSeconds);

const formatLevel = (level: number) => `${level}%`;

const findReachedWindowStartIndex = (points: LuminancePoint[]): number => {
  if (points.length === 0) return 0;

  const reachedIndex = points.findIndex((point) => point.luminanceNits >= leadingTransitionMaxNits);

  return reachedIndex >= 0 ? reachedIndex : 0;
};

const detectTrimmedTailNoise = (
  group: CurveWindowGroup,
  keptPoints: LuminancePoint[],
  options: PostProcessOptions,
): PostProcessDiagnostic[] => {
  if (keptPoints.length < options.minSamplesPerWindow) return [];

  const keptMedian = median(keptPoints.map((point) => point.luminanceNits));
  const tolerance = Math.max(
    Math.abs(keptMedian) * options.relativeOutlierTolerance,
    options.minimumOutlierDeltaNits,
  );
  const keptRows = new Set(keptPoints.map((point) => point.rowNumber));
  const droppedPoints = group.points.filter((point) => !keptRows.has(point.rowNumber));
  const noisyDroppedCount = droppedPoints.filter((point) => Math.abs(point.luminanceNits - keptMedian) > tolerance).length;

  if (noisyDroppedCount === 0) return [];

  return [
    {
      severity: 'info',
      curveId: group.curve.id,
      curveName: group.curve.name,
      windowLevel: keptPoints[0].levelPercent,
      message: `${group.curve.name} ${formatLevel(keptPoints[0].levelPercent)} clipped ${noisyDroppedCount} sample(s) outside the kept median.`,
    },
  ];
};

const summarizeWindow = (
  group: CurveWindowGroup,
  level: number,
  keptPoints: LuminancePoint[],
  originalPointCount: number,
): WindowSummary => {
  const luminance = keptPoints.map((point) => point.luminanceNits);
  const firstCycleSeconds = keptPoints[0].cycleSeconds;
  const lastCycleSeconds = keptPoints[keptPoints.length - 1].cycleSeconds;

  return {
    curveId: group.curve.id,
    curveName: group.curve.name,
    windowLevel: level,
    firstCycleSeconds,
    lastCycleSeconds,
    spanSeconds: lastCycleSeconds - firstCycleSeconds,
    meanLuminance: mean(luminance),
    medianLuminance: median(luminance),
    minLuminance: Math.min(...luminance),
    maxLuminance: Math.max(...luminance),
    stdevLuminance: stdev(luminance),
    samplesKept: keptPoints.length,
    samplesDropped: originalPointCount - keptPoints.length,
    outliersDropped: 0,
  };
};

interface ValidatedWindow {
  level: number;
  windowSpan: number;
  perCurve: Array<{
    slice: CurveWindowSlice;
    keptPoints: LuminancePoint[];
  }>;
}

export const postProcessCurves = (
  curves: CurveSeries[],
  partialOptions: Partial<PostProcessOptions> = {},
): PostProcessResult => {
  const options = { ...defaultPostProcessOptions, ...partialOptions };
  const diagnostics: PostProcessDiagnostic[] = [];
  const windows: PostProcessWindow[] = [];
  const cleanedPoints: CleanedLuminancePoint[] = [];
  const summaries: WindowSummary[] = [];
  const isNormalized = options.alignmentMode === 'normalized';

  const validatedWindows: ValidatedWindow[] = [];
  const keptCounts: number[] = [];

  for (const level of windowSequence) {
    const groups: CurveWindowGroup[] = curves
      .map((curve) => ({ curve, points: findGroup(curve, level) }))
      .filter((group) => group.points.length > 0);

    if (groups.length === 0) continue;

    const missingCurves = curves.filter((curve) => !groups.some((group) => group.curve.id === curve.id));
    for (const curve of missingCurves) {
      diagnostics.push({
        severity: 'warning',
        curveId: curve.id,
        curveName: curve.name,
        windowLevel: level,
        message: `${curve.name} is missing the ${formatLevel(level)} window.`,
      });
    }

    const slices: CurveWindowSlice[] = groups
      .map((group) => {
        const riseIndex = findReachedWindowStartIndex(group.points);
        const availableCount = group.points.length - riseIndex;
        return { ...group, riseIndex, availableCount };
      })
      .filter((slice) => slice.availableCount >= options.minSamplesPerWindow);

    for (const group of groups) {
      if (group.points.length < options.minSamplesPerWindow) {
        diagnostics.push({
          severity: 'warning',
          curveId: group.curve.id,
          curveName: group.curve.name,
          windowLevel: level,
          message: `${group.curve.name} ${formatLevel(level)} has only ${group.points.length} sample(s), below the ${options.minSamplesPerWindow} sample minimum.`,
        });
      }
    }

    if (slices.length === 0) continue;

    const indexKeepCount = Math.min(...slices.map((slice) => slice.availableCount));

    if (!isNormalized && (!Number.isFinite(indexKeepCount) || indexKeepCount < options.minSamplesPerWindow)) {
      diagnostics.push({
        severity: 'warning',
        windowLevel: level,
        message: `${formatLevel(level)} has fewer than ${options.minSamplesPerWindow} aligned samples after rise detection.`,
      });
      continue;
    }

    const windowSpan = isNormalized ? options.normalizedWindowSlots : indexKeepCount;
    const perCurve = slices.map((slice) => {
      const keptPoints = isNormalized
        ? slice.points.slice(slice.riseIndex)
        : slice.points.slice(slice.riseIndex, slice.riseIndex + indexKeepCount);
      keptCounts.push(keptPoints.length);
      return { slice, keptPoints };
    });

    validatedWindows.push({ level, windowSpan, perCurve });
  }

  const computedGap = isNormalized
    ? options.normalizedWindowSlots
    : keptCounts.length > 0
      ? Math.round(keptCounts.reduce((sum, value) => sum + value, 0) / keptCounts.length)
      : 0;
  options.windowGapSlots = computedGap;

  let alignedCursor = computedGap;
  for (const { level, windowSpan, perCurve } of validatedWindows) {
    const window: PostProcessWindow = {
      windowLevel: level,
      sampleCount: windowSpan,
      alignedIndexStart: alignedCursor,
      alignedIndexEnd: alignedCursor + windowSpan,
    };
    windows.push(window);

    for (const { slice, keptPoints } of perCurve) {
      diagnostics.push(...detectTrimmedTailNoise(slice, keptPoints, options));
      summaries.push(summarizeWindow(slice, level, keptPoints, slice.points.length));

      const stretchDenominator = Math.max(keptPoints.length - 1, 1);
      cleanedPoints.push(
        ...keptPoints.map((point, sampleIndex) => {
          const windowIndex = isNormalized
            ? (sampleIndex / stretchDenominator) * options.normalizedWindowSlots
            : sampleIndex;
          return {
            curveId: slice.curve.id,
            curveName: slice.curve.name,
            windowLevel: level,
            rowNumber: point.rowNumber,
            originalElapsedSeconds: point.elapsedSeconds,
            originalCycleSeconds: point.cycleSeconds,
            windowIndex,
            alignedIndex: window.alignedIndexStart + windowIndex,
            luminanceNits: point.luminanceNits,
          };
        }),
      );
    }

    alignedCursor += windowSpan + computedGap;
  }

  return {
    generatedAt: new Date().toISOString(),
    options,
    windows,
    cleanedPoints: cleanedPoints.sort((a, b) => a.alignedIndex - b.alignedIndex || a.curveName.localeCompare(b.curveName)),
    summaries: summaries.sort((a, b) => a.windowLevel - b.windowLevel || a.curveName.localeCompare(b.curveName)),
    diagnostics,
  };
};
