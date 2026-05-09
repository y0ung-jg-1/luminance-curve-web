import { describe, expect, it } from 'vitest';
import type { CurveSeries, LuminancePoint } from '../types';
import { postProcessCurves } from './postProcess';

const makeCurve = (id: string, name: string, points: LuminancePoint[]): CurveSeries => ({
  id,
  name,
  sheetName: 'Sheet1',
  points,
  stats: {
    pointCount: points.length,
    minLuminance: Math.min(...points.map((point) => point.luminanceNits)),
    maxLuminance: Math.max(...points.map((point) => point.luminanceNits)),
    averageLuminance: points.reduce((sum, point) => sum + point.luminanceNits, 0) / points.length,
    minElapsedSeconds: Math.min(...points.map((point) => point.elapsedSeconds)),
    maxElapsedSeconds: Math.max(...points.map((point) => point.elapsedSeconds)),
    levels: Array.from(new Set(points.map((point) => point.levelPercent))),
  },
  color: '#007aff',
  visible: true,
  importedAt: '2026-05-07T00:00:00.000Z',
});

const makeWindowFromCycles = (
  level: number,
  elapsedOffset: number,
  luminance: number,
  cycles: number[],
  spikeAt?: number,
): LuminancePoint[] =>
  cycles.map((cycleSeconds, index) => ({
    rowNumber: index + 2,
    elapsedSeconds: elapsedOffset + cycleSeconds,
    cycleSeconds,
    levelPercent: level,
    luminanceNits: spikeAt === cycleSeconds ? luminance * 5 : luminance,
  }));

const makeWindow = (level: number, elapsedOffset: number, luminance: number, spikeAt?: number): LuminancePoint[] =>
  makeWindowFromCycles(level, elapsedOffset, luminance, [0, 0.5, 1, 1.5, 2, 2.5, 3], spikeAt);

const makeWindowWithLuminance = (
  level: number,
  elapsedOffset: number,
  values: Array<[cycleSeconds: number, luminanceNits: number]>,
): LuminancePoint[] =>
  values.map(([cycleSeconds, luminanceNits], index) => ({
    rowNumber: index + 2,
    elapsedSeconds: elapsedOffset + cycleSeconds,
    cycleSeconds,
    levelPercent: level,
    luminanceNits,
  }));

describe('postProcessCurves', () => {
  it('aligns slightly offset machines onto the same clean window axis', () => {
    const result = postProcessCurves([
      makeCurve('a', 'Machine A', makeWindow(1, 10, 100)),
      makeCurve('b', 'Machine B', makeWindow(1, 12.25, 102)),
    ]);

    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].alignedIndexStart).toBe(result.options.windowGapSlots);

    const starts = ['a', 'b'].map((curveId) =>
      Math.min(...result.cleanedPoints.filter((point) => point.curveId === curveId).map((point) => point.alignedIndex)),
    );
    expect(starts).toEqual([result.options.windowGapSlots, result.options.windowGapSlots]);
  });

  it('keeps the head of every curve and discards extra tail samples to match the shortest', () => {
    const result = postProcessCurves([
      makeCurve('a', 'Machine A', makeWindowFromCycles(1, 10, 100, [0, 0.5, 1, 1.5, 2])),
      makeCurve('b', 'Machine B', makeWindowFromCycles(1, 12, 105, [0.4, 0.9, 1.4, 1.9, 2.4, 2.9, 3.4])),
    ]);

    const machineA = result.cleanedPoints.filter((point) => point.curveId === 'a');
    const machineB = result.cleanedPoints.filter((point) => point.curveId === 'b');

    expect(machineA).toHaveLength(5);
    expect(machineB).toHaveLength(5);

    expect(machineA[0].originalCycleSeconds).toBe(0);
    expect(machineB[0].originalCycleSeconds).toBe(0.4);
    expect(machineA[0].alignedIndex).toBe(result.options.windowGapSlots);
    expect(machineB[0].alignedIndex).toBe(result.options.windowGapSlots);

    expect(machineB.map((point) => point.originalCycleSeconds)).not.toContain(2.9);
    expect(machineB.map((point) => point.originalCycleSeconds)).not.toContain(3.4);
  });

  it('keeps every leading sample once the window is reached', () => {
    const result = postProcessCurves([makeCurve('a', 'Machine A', makeWindow(1, 10, 100))]);

    const sourceRows = result.cleanedPoints.map((point) => point.originalCycleSeconds);
    expect(sourceRows).toContain(0);
    expect(sourceRows).toContain(0.5);
    expect(sourceRows).toContain(2.5);
    expect(sourceRows).toContain(3);
  });

  it('skips leading off-level transition samples before aligning the window start', () => {
    const result = postProcessCurves([
      makeCurve(
        'a',
        'Machine A',
        makeWindowWithLuminance(50, 10, [
          [0, 0],
          [0.5, 160],
          [1, 130],
          [1.5, 100],
          [2, 100],
          [2.5, 100],
          [3, 100],
        ]),
      ),
    ]);

    expect(result.cleanedPoints[0].originalCycleSeconds).toBe(0.5);
    expect(result.cleanedPoints[0].alignedIndex).toBe(result.options.windowGapSlots);
    expect(result.cleanedPoints[0].luminanceNits).toBe(160);
    expect(result.cleanedPoints.map((point) => point.originalCycleSeconds)).not.toContain(0);
  });

  it('retains short luminance spikes as source data', () => {
    const result = postProcessCurves([makeCurve('a', 'Machine A', makeWindow(1, 10, 100, 1.5))]);

    expect(result.cleanedPoints.some((point) => point.luminanceNits === 500)).toBe(true);
    expect(result.summaries[0].outliersDropped).toBe(0);
    expect(result.summaries[0].medianLuminance).toBe(100);
  });

  it('reports missing windows without failing the whole clean export', () => {
    const result = postProcessCurves([
      makeCurve('a', 'Machine A', [...makeWindow(1, 10, 100), ...makeWindow(2, 20, 110)]),
      makeCurve('b', 'Machine B', makeWindow(1, 12, 105)),
    ]);

    expect(result.summaries.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((item) => item.severity === 'warning' && item.windowLevel === 2)).toBe(true);
  });

  it('normalizes each window so curves with different counts share the same span', () => {
    const denseCurve = makeCurve(
      'a',
      'Dense A',
      makeWindowFromCycles(1, 10, 100, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]),
    );
    const sparseCurve = makeCurve('b', 'Sparse B', makeWindowFromCycles(1, 12, 105, [0, 0.5, 1.0]));

    const result = postProcessCurves([denseCurve, sparseCurve], { alignmentMode: 'normalized' });

    const denseFirst = result.cleanedPoints.find((p) => p.curveId === 'a');
    const denseLast = [...result.cleanedPoints].reverse().find((p) => p.curveId === 'a');
    const sparseFirst = result.cleanedPoints.find((p) => p.curveId === 'b');
    const sparseLast = [...result.cleanedPoints].reverse().find((p) => p.curveId === 'b');

    const dense = result.cleanedPoints.filter((p) => p.curveId === 'a');
    const sparse = result.cleanedPoints.filter((p) => p.curveId === 'b');

    expect(dense).toHaveLength(11);
    expect(sparse).toHaveLength(3);

    expect(denseFirst!.windowIndex).toBe(0);
    expect(sparseFirst!.windowIndex).toBe(0);
    expect(denseLast!.windowIndex).toBe(result.options.normalizedWindowSlots);
    expect(sparseLast!.windowIndex).toBe(result.options.normalizedWindowSlots);
  });

  it('lays out windows contiguously on the aligned index axis with a slot gap between them', () => {
    const result = postProcessCurves([
      makeCurve('a', 'Machine A', [...makeWindow(1, 10, 100), ...makeWindow(2, 20, 110)]),
    ]);

    expect(result.windows).toHaveLength(2);
    expect(result.windows[0].alignedIndexStart).toBe(result.options.windowGapSlots);
    const firstCount = result.windows[0].sampleCount;
    expect(result.windows[1].alignedIndexStart).toBe(result.options.windowGapSlots + firstCount + result.options.windowGapSlots);
  });
});
