import type { LuminancePoint, LuminanceStats } from '../types';

export const summarizeLuminancePoints = (points: LuminancePoint[]): LuminanceStats => {
  const luminance = points.map((point) => point.luminanceNits);
  const elapsed = points.map((point) => point.elapsedSeconds);
  const levels = Array.from(new Set(points.map((point) => point.levelPercent))).sort((a, b) => a - b);
  const sum = luminance.reduce((total, value) => total + value, 0);

  return {
    pointCount: points.length,
    minLuminance: Math.min(...luminance),
    maxLuminance: Math.max(...luminance),
    averageLuminance: sum / points.length,
    minElapsedSeconds: Math.min(...elapsed),
    maxElapsedSeconds: Math.max(...elapsed),
    levels,
  };
};
