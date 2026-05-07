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
  windowGapSeconds: 1,
};

interface CurveWindowGroup {
  curve: CurveSeries;
  points: LuminancePoint[];
}

const levelMatches = (value: number, level: number) => Math.abs(value - level) < 0.000001;

const median = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
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

const mad = (values: number[], center = median(values)): number =>
  median(values.map((value) => Math.abs(value - center)));

const findGroup = (curve: CurveSeries, level: number): LuminancePoint[] =>
  curve.points
    .filter((point) => levelMatches(point.levelPercent, level))
    .sort((a, b) => a.cycleSeconds - b.cycleSeconds);

const formatLevel = (level: number) => `${level}%`;

const detectBoundaryNoise = (
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
  const edgeRows = new Set(stablePoints.map((point) => point.rowNumber));
  const edgePoints = group.points.filter((point) => !edgeRows.has(point.rowNumber));
  const noisyEdgeCount = edgePoints.filter((point) => Math.abs(point.luminanceNits - stableMedian) > tolerance).length;

  if (noisyEdgeCount === 0) return [];

  return [
    {
      severity: 'info',
      curveId: group.curve.id,
      curveName: group.curve.name,
      windowLevel: stablePoints[0].levelPercent,
      message: `${group.curve.name} ${formatLevel(stablePoints[0].levelPercent)} clipped ${noisyEdgeCount} edge sample(s) that differ from the stable median.`,
    },
  ];
};

const removeOutliers = (
  points: LuminancePoint[],
  options: PostProcessOptions,
): { kept: LuminancePoint[]; dropped: LuminancePoint[] } => {
  if (points.length < options.minSamplesPerWindow) return { kept: points, dropped: [] };

  const kept: LuminancePoint[] = [];
  const dropped: LuminancePoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const start = Math.max(0, index - options.outlierWindowRadius);
    const end = Math.min(points.length, index + options.outlierWindowRadius + 1);
    const localValues = points.slice(start, end).map((point) => point.luminanceNits);
    const localMedian = median(localValues);
    const robustSigma = mad(localValues, localMedian) * 1.4826;
    const threshold = Math.max(
      robustSigma * options.outlierThreshold,
      Math.abs(localMedian) * options.relativeOutlierTolerance,
      options.minimumOutlierDeltaNits,
    );

    if (Math.abs(points[index].luminanceNits - localMedian) > threshold) {
      dropped.push(points[index]);
    } else {
      kept.push(points[index]);
    }
  }

  return { kept, dropped };
};

const summarizeWindow = (
  group: CurveWindowGroup,
  level: number,
  keptPoints: LuminancePoint[],
  originalPointCount: number,
  outliersDropped: number,
  window: PostProcessWindow,
): WindowSummary => {
  const luminance = keptPoints.map((point) => point.luminanceNits);

  return {
    curveId: group.curve.id,
    curveName: group.curve.name,
    windowLevel: level,
    stableStartSeconds: window.stableStartSeconds,
    stableEndSeconds: window.stableEndSeconds,
    stableDurationSeconds: window.stableDurationSeconds,
    meanLuminance: mean(luminance),
    medianLuminance: median(luminance),
    minLuminance: Math.min(...luminance),
    maxLuminance: Math.max(...luminance),
    stdevLuminance: stdev(luminance),
    samplesKept: keptPoints.length,
    samplesDropped: originalPointCount - keptPoints.length,
    outliersDropped,
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

    const stableStartSeconds = Math.max(
      ...rangeGroups.map((group) => Math.min(...group.points.map((point) => point.cycleSeconds)) + options.edgeGuardSeconds),
    );
    const stableEndSeconds = Math.min(
      ...rangeGroups.map((group) => Math.max(...group.points.map((point) => point.cycleSeconds)) - options.edgeGuardSeconds),
    );
    const stableDurationSeconds = stableEndSeconds - stableStartSeconds;

    if (!Number.isFinite(stableDurationSeconds) || stableDurationSeconds < options.minStableSeconds) {
      diagnostics.push({
        severity: 'warning',
        windowLevel: level,
        message: `${formatLevel(level)} has no shared stable range after the ${options.edgeGuardSeconds}s edge guard.`,
      });
      continue;
    }

    const window: PostProcessWindow = {
      windowLevel: level,
      stableStartSeconds,
      stableEndSeconds,
      stableDurationSeconds,
      alignedStartSeconds: alignedCursor,
      alignedEndSeconds: alignedCursor + stableDurationSeconds,
    };
    windows.push(window);

    for (const group of rangeGroups) {
      const stablePoints = group.points.filter(
        (point) => point.cycleSeconds >= stableStartSeconds && point.cycleSeconds <= stableEndSeconds,
      );

      diagnostics.push(...detectBoundaryNoise(group, stablePoints, options));

      if (stablePoints.length < options.minSamplesPerWindow) {
        diagnostics.push({
          severity: 'warning',
          curveId: group.curve.id,
          curveName: group.curve.name,
          windowLevel: level,
          message: `${group.curve.name} ${formatLevel(level)} has only ${stablePoints.length} stable sample(s) after clipping.`,
        });
        continue;
      }

      const { kept, dropped } = removeOutliers(stablePoints, options);

      if (dropped.length > 0) {
        diagnostics.push({
          severity: 'info',
          curveId: group.curve.id,
          curveName: group.curve.name,
          windowLevel: level,
          message: `${group.curve.name} ${formatLevel(level)} removed ${dropped.length} short spike sample(s).`,
        });
      }

      if (kept.length < options.minSamplesPerWindow) continue;

      summaries.push(summarizeWindow(group, level, kept, group.points.length, dropped.length, window));
      cleanedPoints.push(
        ...kept.map((point) => ({
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
