import { describe, expect, it } from 'vitest';
import type { CurveSeries, LuminancePoint } from '../types';
import { buildIllustratorLayeredSvgs } from './illustratorSvg';
import { postProcessCurves } from './postProcess';

const makeCurve = (id: string, name: string, levels: number[]): CurveSeries => {
  const points: LuminancePoint[] = levels.flatMap((level, levelIndex) =>
    [0, 0.5, 1, 1.5, 2, 2.5, 3].map((cycleSeconds, index) => ({
      rowNumber: levelIndex * 10 + index + 2,
      elapsedSeconds: levelIndex * 10 + cycleSeconds,
      cycleSeconds,
      levelPercent: level,
      luminanceNits: 100 + level * 5 + Math.sin(index) * 2,
    })),
  );

  return {
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
      levels,
    },
    color: '#007aff',
    visible: true,
    importedAt: '2026-05-07T00:00:00.000Z',
  };
};

describe('buildIllustratorLayeredSvgs', () => {
  it('creates separate movable window layers with waveform paths', () => {
    const curve = makeCurve('a', 'Display A', [1, 2]);
    const result = postProcessCurves([curve]);
    const files = buildIllustratorLayeredSvgs(result, [curve], { yMin: 0, yMax: 250 });

    expect(files).toHaveLength(1);
    expect(files[0].svg).toContain('inkscape:label="1%"');
    expect(files[0].svg).toContain('inkscape:label="2%"');
    expect(files[0].svg).toContain('data-name="1% waveform"');
  });

  it('exports overlaid curves as separate SVG files', () => {
    const first = makeCurve('a', 'Display A', [1]);
    const second = makeCurve('b', 'Display B', [1]);
    const result = postProcessCurves([first, second]);
    const files = buildIllustratorLayeredSvgs(result, [first, second], { yMin: 0, yMax: 250 });

    expect(files.map((file) => file.fileName)).toEqual(['Display A-AI-layered.svg', 'Display B-AI-layered.svg']);
  });
});
