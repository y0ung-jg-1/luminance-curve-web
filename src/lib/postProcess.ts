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
  edgeGuardSeconds: 0.5,
  minStableSeconds: 0.25,
  minSamplesPerWindow: 3,
  outlierThreshold: 3.5,
  outlierWindowRadius: 3,
  relativeOutlierTolerance: 0.08,
  minimumOutlierDeltaNits: 5,
  windowGapSeconds: 2,
};

interface CurveWindowGroup {
  curve: CurveSeries;
  points: LuminancePoint[];
}

interface CurveWindowRange extends CurveWindowGroup {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

const leadingTransitionRatio = 0.5;

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

const findReachedWindowStartSeconds = (points: LuminancePoint[]): number => {
  if (points.length === 0) return 0;
  const firstSeconds = points[0].cycleSeconds;

  const referencePoints = points.slice(Math.floor(points.length / 2));
  const referenceMedian = median(referencePoints.map((point) => point.luminanceNits));
  if (!Number.isFinite(referenceMedian) || referenceMedian <= 0) return firstSeconds;

  const reachedThreshold = referenceMedian * leadingTransitionRatio;
  const firstReachedPoint = points.find((point) => point.luminanceNits >= reachedThreshold);

  return firstReachedPoint?.cycleSeconds ?? firstSeconds;
};

const detectTrimmedTailNoise = (
  group: CurveWindowGroup,
  stablePoints: LuminancePoint[],
  options: PostProcessOptions,
): PostProcessDiagnostic[] => {
  if (stablePoints.length < options.minSamplesPerWindow) return [];

  const stableMedian = median(stablePoints.map((point) => point.luminanceNits));
  const tolerance = Math.max(
    Math.abs(stableMedian) * options.relativeOutlierTolerance,
    options.minimumOutlierDeltaNits,
  );
  const keptRows = new Set(stablePoints.map((point) => point.rowNumber));
  const boundaryPoints = group.points.filter((point) => !keptRows.has(point.rowNumber));
  const noisyBoundaryCount = boundaryPoints.filter((point) => Math.abs(point.luminanceNits - stableMedian) > tolerance).length;

  if (noisyBoundaryCount === 0) return [];

  return [
    {
      severity: 'info',
      curveId: group.curve.id,
      curveName: group.curve.name,
      windowLevel: stablePoints[0].levelPercent,
      message: `${group.curve.name} ${formatLevel(stablePoints[0].levelPercent)} clipped ${noisyBoundaryCount} boundary sample(s) that differ from the kept median.`,
    },
  ];
};

const summarizeWindow = (
  group: CurveWindowGroup,
  level: number,
  keptPoints: LuminancePoint[],
  originalPointCount: number,
  stableStartSeconds: number,
  stableEndSeconds: number,
  stableDurationSeconds: number,
): WindowSummary => {
  const luminance = keptPoints.map((point) => point.luminanceNits);

  return {
    curveId: group.curve.id,
    curveName: group.curve.name,
    windowLevel: level,
    stableStartSeconds,
    stableEndSeconds,
    stableDurationSeconds,
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

export const postProcessCurves = (
  curves: CurveSeries[],
  partialOptions: Partial<PostProcessOptions> = {},
): PostProcessResult => {
  const options = { ...defaultPostProcessOptions, ...partialOptions };
  const diagnostics: PostProcessDiagnostic[] = [];
  const windows: PostProcessWindow[] = [];
  const cleanedPoints: CleanedLuminancePoint[] = [];
  const summaries: WindowSummary[] = [];
  let alignedCursor = 0;

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

    const rangeGroups = groups.filter((group) => group.points.length >= options.minSamplesPerWindow);
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

    if (rangeGroups.length === 0) continue;

    const ranges: CurveWindowRange[] = rangeGroups.map((group) => {
      const startSeconds = findReachedWindowStartSeconds(group.points);
      const endSeconds = Math.max(...group.points.map((point) => point.cycleSeconds)) - options.edgeGuardSeconds;

      return {
        ...group,
        startSeconds,
        endSeconds,
        durationSeconds: endSeconds - startSeconds,
      };
    });

    const stableDurationSeconds = Math.min(...ranges.map((group) => group.durationSeconds));

    if (!Number.isFinite(stableDurationSeconds) || stableDurationSeconds < options.minStableSeconds) {
      diagnostics.push({
        severity: 'warning',
        windowLevel: level,
        message: `${formatLevel(level)} has no shared aligned duration after the ${options.edgeGuardSeconds}s tail guard.`,
      });
      continue;
    }

    const window: PostProcessWindow = {
      windowLevel: level,
      stableStartSeconds: 0,
      stableEndSeconds: stableDurationSeconds,
      stableDurationSeconds,
      alignedStartSeconds: alignedCursor,
      alignedEndSeconds: alignedCursor + stableDurationSeconds,
    };
    windows.push(window);

    for (const group of ranges) {
      const stableStartSeconds = group.startSeconds;
      const stableEndSeconds = group.startSeconds + stableDurationSeconds;
      const stablePoints = group.points.filter(
        (point) => point.cycleSeconds >= stableStartSeconds && point.cycleSeconds <= stableEndSeconds,
      );

      diagnostics.push(...detectTrimmedTailNoise(group, stablePoints, options));

      if (stablePoints.length < options.minSamplesPerWindow) {
        diagnostics.push({
          severity: 'warning',
          curveId: group.curve.id,
          curveName: group.curve.name,
          windowLevel: level,
          message: `${group.curve.name} ${formatLevel(level)} has only ${stablePoints.length} stable sample(s) after tail alignment.`,
        });
        continue;
      }

      summaries.push(
        summarizeWindow(
          group,
          level,
          stablePoints,
          group.points.length,
          stableStartSeconds,
          stableEndSeconds,
          stableDurationSeconds,
        ),
      );
      cleanedPoints.push(
        ...stablePoints.map((point) => ({
          curveId: group.curve.id,
          curveName: group.curve.name,
          windowLevel: level,
          rowNumber: point.rowNumber,
          originalElapsedSeconds: point.elapsedSeconds,
          originalCycleSeconds: point.cycleSeconds,
          windowSeconds: point.cycleSeconds - stableStartSeconds,
          alignedSeconds: window.alignedStartSeconds + (point.cycleSeconds - stableStartSeconds),
          luminanceNits: point.luminanceNits,
        })),
      );
    }

    alignedCursor += stableDurationSeconds + options.windowGapSeconds;
  }

  return {
    generatedAt: new Date().toISOString(),
    options,
    windows,
    cleanedPoints: cleanedPoints.sort((a, b) => a.alignedSeconds - b.alignedSeconds || a.curveName.localeCompare(b.curveName)),
    summaries: summaries.sort((a, b) => a.windowLevel - b.windowLevel || a.curveName.localeCompare(b.curveName)),
    diagnostics,
  };
};
