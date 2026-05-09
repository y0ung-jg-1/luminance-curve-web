import { describe, expect, it } from 'vitest';
import { buildLuminanceScene3DData } from './luminanceScene3d';
import type { CleanedLuminancePoint, CurveSeries, PostProcessResult, PostProcessWindow } from '../types';

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

const createPoint = (
  curveId: string,
  curveName: string,
  windowLevel: number,
  alignedIndex: number,
  luminanceNits: number,
  rowNumber = 10,
): CleanedLuminancePoint => ({
  curveId,
  curveName,
  windowLevel,
  rowNumber,
  originalElapsedSeconds: alignedIndex + 100,
  originalCycleSeconds: alignedIndex,
  windowIndex: alignedIndex,
  alignedIndex,
  luminanceNits,
});

const createWindow = (windowLevel: number, alignedIndexStart: number, alignedIndexEnd: number): PostProcessWindow => ({
  windowLevel,
  sampleCount: alignedIndexEnd - alignedIndexStart,
  alignedIndexStart,
  alignedIndexEnd,
});

const createResult = (cleanedPoints: CleanedLuminancePoint[], windows: PostProcessWindow[] = []): PostProcessResult => ({
  generatedAt: '2026-01-01T00:00:00.000Z',
  options: {
    alignmentMode: 'index',
    minSamplesPerWindow: 3,
    relativeOutlierTolerance: 0.08,
    minimumOutlierDeltaNits: 5,
    windowGapSlots: 8,
    normalizedWindowSlots: 200,
  },
  windows,
  cleanedPoints,
  summaries: [],
  diagnostics: [],
});

describe('buildLuminanceScene3DData', () => {
  it('maps visible cleaned samples into a 3D index bar grid', () => {
    const curves = [createCurve('a', 'A', '#111111'), createCurve('b', 'B', '#222222')];
    const data = buildLuminanceScene3DData(
      curves,
      createResult(
        [
          createPoint('a', 'A', 1, 0, 100, 11),
          createPoint('a', 'A', 1, 1, 120, 12),
          createPoint('b', 'B', 1, 0, 150, 21),
        ],
        [createWindow(1, 0, 2)],
      ),
    );

    expect(data.curves.map((curve) => curve.name)).toEqual(['A', 'B']);
    expect(data.windows).toEqual([{ windowLevel: 1, alignedIndexStart: 0, alignedIndexEnd: 2 }]);
    expect(data.bars).toEqual([
      expect.objectContaining({ curveId: 'a', windowLevel: 1, alignedIndex: 0, luminanceNits: 100, xIndex: 0, zIndex: 0 }),
      expect.objectContaining({ curveId: 'b', windowLevel: 1, alignedIndex: 0, luminanceNits: 150, xIndex: 0, zIndex: 1 }),
      expect.objectContaining({ curveId: 'a', windowLevel: 1, alignedIndex: 1, luminanceNits: 120, xIndex: 1, zIndex: 0 }),
    ]);
    expect(data.maxAlignedIndex).toBe(1);
    expect(data.maxLuminance).toBe(150);
  });

  it('does not synthesize bars for windows with no cleaned samples', () => {
    const data = buildLuminanceScene3DData(
      [createCurve('a', 'A')],
      createResult([createPoint('a', 'A', 1, 0, 100)], [createWindow(1, 0, 1), createWindow(5, 2, 3)]),
    );

    expect(data.bars).toHaveLength(1);
    expect(data.bars.map((bar) => bar.windowLevel)).toEqual([1]);
    expect(data.windows.map((window) => window.windowLevel)).toEqual([1]);
  });

  it('keeps a stable nice luminance axis maximum from measured samples', () => {
    const data = buildLuminanceScene3DData(
      [createCurve('a', 'A')],
      createResult([createPoint('a', 'A', 1, 0, 118), createPoint('a', 'A', 1, 1, 137)]),
    );

    expect(data.maxLuminance).toBe(137);
    expect(data.axisMaxLuminance).toBe(200);
  });

  it('returns empty scene data when no visible cleaned samples exist', () => {
    const data = buildLuminanceScene3DData([createCurve('a', 'A')], createResult([]));

    expect(data.curves).toEqual([]);
    expect(data.windows).toEqual([]);
    expect(data.bars).toEqual([]);
    expect(data.maxAlignedIndex).toBe(0);
    expect(data.maxLuminance).toBe(0);
    expect(data.axisMaxLuminance).toBe(1);
  });
});
