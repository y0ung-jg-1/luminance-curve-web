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

const makeWindow = (level: number, elapsedOffset: number, luminance: number, spikeAt?: number): LuminancePoint[] =>
  [0, 0.5, 1, 1.5, 2, 2.5, 3].map((cycleSeconds, index) => ({
    rowNumber: index + 2,
    elapsedSeconds: elapsedOffset + cycleSeconds,
    cycleSeconds,
    levelPercent: level,
    luminanceNits: spikeAt === cycleSeconds ? luminance * 5 : luminance,
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

    const starts = ['a', 'b'].map((curveId) =>
      Math.min(...result.cleanedPoints.filter((point) => point.curveId === curveId).map((point) => point.alignedSeconds)),
    );
    expect(starts).toEqual([0, 0]);
  });

  it('clips edge samples before summarizing stable luminance', () => {
    const result = postProcessCurves([makeCurve('a', 'Machine A', makeWindow(1, 10, 100))], {
      edgeGuardSeconds: 0.5,
    });

    const sourceCycles = result.cleanedPoints.map((point) => point.originalCycleSeconds);
    expect(sourceCycles).not.toContain(0);
    expect(sourceCycles).not.toContain(3);
    expect(sourceCycles).toContain(0.5);
    expect(sourceCycles).toContain(2.5);
  });

  it('removes short luminance spikes with a Hampel-style filter', () => {
    const result = postProcessCurves([makeCurve('a', 'Machine A', makeWindow(1, 10, 100, 1.5))], {
      edgeGuardSeconds: 0.5,
    });

    expect(result.cleanedPoints.some((point) => point.luminanceNits === 500)).toBe(false);
    expect(result.summaries[0].outliersDropped).toBe(1);
  });
});
