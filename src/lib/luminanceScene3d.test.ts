import { describe, expect, it } from 'vitest';
import { buildLuminanceScene3DData } from './luminanceScene3d';
import type { CurveSeries, PostProcessResult, WindowSummary } from '../types';

const createCurve = (id: string, name: string, color = '#007aff'): CurveSeries => ({
  id,
  name,
  color,
  visible: true,
  importedAt: '2026-01-01T00:00:00.000Z',
  sheetName: 'page_1',
  points: [],
  stats: {
    pointCount: 0,
    minLuminance: 0,
    maxLuminance: 0,
    averageLuminance: 0,
    minElapsedSeconds: 0,
    maxElapsedSeconds: 0,
    levels: [],
  },
});

const createSummary = (
  curveId: string,
  curveName: string,
  windowLevel: number,
  meanLuminance: number,
  maxLuminance = meanLuminance,
): WindowSummary => ({
  curveId,
  curveName,
  windowLevel,
  stableStartSeconds: 0,
  stableEndSeconds: 1,
  stableDurationSeconds: 1,
  meanLuminance,
  medianLuminance: meanLuminance - 1,
  minLuminance: meanLuminance - 2,
  maxLuminance,
  stdevLuminance: 1,
  samplesKept: 4,
  samplesDropped: 1,
  outliersDropped: 0,
});

const createResult = (summaries: WindowSummary[]): PostProcessResult => ({
  generatedAt: '2026-01-01T00:00:00.000Z',
  options: {
    edgeGuardSeconds: 0.5,
    minStableSeconds: 0.25,
    minSamplesPerWindow: 3,
    outlierThreshold: 3.5,
    outlierWindowRadius: 3,
    relativeOutlierTolerance: 0.08,
    minimumOutlierDeltaNits: 5,
    windowGapSeconds: 8,
  },
  windows: [],
  cleanedPoints: [],
  summaries,
  diagnostics: [],
});

describe('buildLuminanceScene3DData', () => {
  it('maps visible curves and window summaries into a 3D bar grid', () => {
    const curves = [createCurve('a', 'A', '#111111'), createCurve('b', 'B', '#222222')];
    const data = buildLuminanceScene3DData(
      curves,
      createResult([
        createSummary('a', 'A', 1, 100),
        createSummary('a', 'A', 2, 200),
        createSummary('b', 'B', 1, 150),
      ]),
    );

    expect(data.curves.map((curve) => curve.name)).toEqual(['A', 'B']);
    expect(data.bars).toEqual([
      expect.objectContaining({ curveId: 'a', levelPercent: 1, xIndex: 0, zIndex: 0, meanLuminance: 100 }),
      expect.objectContaining({ curveId: 'a', levelPercent: 2, xIndex: 1, zIndex: 0, meanLuminance: 200 }),
      expect.objectContaining({ curveId: 'b', levelPercent: 1, xIndex: 0, zIndex: 1, meanLuminance: 150 }),
    ]);
  });

  it('does not synthesize bars for missing windows', () => {
    const data = buildLuminanceScene3DData(
      [createCurve('a', 'A')],
      createResult([createSummary('a', 'A', 1, 100), createSummary('a', 'A', 5, 250)]),
    );

    expect(data.bars).toHaveLength(2);
    expect(data.bars.map((bar) => bar.levelPercent)).toEqual([1, 5]);
  });

  it('keeps a stable nice luminance axis maximum', () => {
    const data = buildLuminanceScene3DData(
      [createCurve('a', 'A')],
      createResult([createSummary('a', 'A', 1, 118, 137)]),
    );

    expect(data.maxMeanLuminance).toBe(118);
    expect(data.axisMaxLuminance).toBe(200);
  });

  it('returns empty scene data when no visible summaries exist', () => {
    const data = buildLuminanceScene3DData([createCurve('a', 'A')], createResult([]));

    expect(data.curves).toEqual([]);
    expect(data.bars).toEqual([]);
    expect(data.maxMeanLuminance).toBe(0);
    expect(data.axisMaxLuminance).toBe(1);
  });
});
