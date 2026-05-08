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
    const result = postProcessCurves(
      [
        makeCurve('a', 'Machine A', makeWindow(1, 10, 100)),
        makeCurve('b', 'Machine B', makeWindow(1, 12.25, 102)),
      ],
      { edgeGuardSeconds: 0.5 },
    );

    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].alignedStartSeconds).toBe(0);

    const starts = ['a', 'b'].map((curveId) =>
      Math.min(...result.cleanedPoints.filter((point) => point.curveId === curveId).map((point) => point.alignedSeconds)),
    );
    expect(starts).toEqual([0, 0]);
  });

  it('aligns each window from its own first sample and trims the tail for common duration', () => {
    const result = postProcessCurves(
      [
        makeCurve('a', 'Machine A', makeWindowFromCycles(1, 10, 100, [0, 0.5, 1, 1.5, 2, 2.5, 3])),
        makeCurve('b', 'Machine B', makeWindowFromCycles(1, 12, 105, [0.4, 0.9, 1.4, 1.9, 2.4, 2.9, 3.4])),
      ],
      { edgeGuardSeconds: 0.5 },
    );

    const machineA = result.cleanedPoints.filter((point) => point.curveId === 'a');
    const machineB = result.cleanedPoints.filter((point) => point.curveId === 'b');

    expect(machineA[0].originalCycleSeconds).toBe(0);
    expect(machineB[0].originalCycleSeconds).toBe(0.4);
    expect(machineA[0].alignedSeconds).toBe(0);
    expect(machineB[0].alignedSeconds).toBe(0);
    expect(machineA.map((point) => point.originalCycleSeconds)).not.toContain(3);
    expect(machineB.map((point) => point.originalCycleSeconds)).not.toContain(3.4);
  });

  it('keeps leading samples and clips only the tail guard', () => {
    const result = postProcessCurves([makeCurve('a', 'Machine A', makeWindow(1, 10, 100))], {
      edgeGuardSeconds: 0.5,
    });

    const sourceRows = result.cleanedPoints.map((point) => point.originalCycleSeconds);
    expect(sourceRows).not.toContain(3);
    expect(sourceRows).toContain(0);
    expect(sourceRows).toContain(0.5);
    expect(sourceRows).toContain(2.5);
  });

  it('skips leading off-level transition samples before aligning the window start', () => {
    const result = postProcessCurves(
      [
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
      ],
      { edgeGuardSeconds: 0.5 },
    );

    expect(result.cleanedPoints[0].originalCycleSeconds).toBe(0.5);
    expect(result.cleanedPoints[0].alignedSeconds).toBe(0);
    expect(result.cleanedPoints[0].luminanceNits).toBe(160);
    expect(result.cleanedPoints.map((point) => point.originalCycleSeconds)).not.toContain(0);
  });

  it('retains short luminance spikes as source data', () => {
    const result = postProcessCurves([makeCurve('a', 'Machine A', makeWindow(1, 10, 100, 1.5))], {
      edgeGuardSeconds: 0.5,
    });

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
});
