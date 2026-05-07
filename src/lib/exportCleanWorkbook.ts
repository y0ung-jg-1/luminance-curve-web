import * as XLSX from 'xlsx';
import type { PostProcessResult } from '../types';

const round = (value: number, decimals = 6): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const setColumnWidths = (sheet: XLSX.WorkSheet, widths: number[]) => {
  sheet['!cols'] = widths.map((wch) => ({ wch }));
};

export const buildCleanWorkbookArrayBuffer = (result: PostProcessResult): ArrayBuffer => {
  const workbook = XLSX.utils.book_new();

  const summaryRows = result.summaries.map((summary) => ({
    Machine: summary.curveName,
    'Window %': summary.windowLevel,
    'Median nits': round(summary.medianLuminance, 3),
    'Mean nits': round(summary.meanLuminance, 3),
    'Min nits': round(summary.minLuminance, 3),
    'Max nits': round(summary.maxLuminance, 3),
    'Stdev nits': round(summary.stdevLuminance, 3),
    'Samples kept': summary.samplesKept,
    'Samples dropped': summary.samplesDropped,
    'Outliers dropped': summary.outliersDropped,
    'Stable start s': round(summary.stableStartSeconds, 6),
    'Stable end s': round(summary.stableEndSeconds, 6),
    'Stable duration s': round(summary.stableDurationSeconds, 6),
  }));
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  setColumnWidths(summarySheet, [34, 10, 14, 12, 11, 11, 12, 13, 15, 16, 15, 13, 17]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  const pointRows = result.cleanedPoints.map((point) => ({
    Machine: point.curveName,
    'Window %': point.windowLevel,
    'Aligned seconds': round(point.alignedSeconds, 6),
    'Window seconds': round(point.windowSeconds, 6),
    'Original elapsed seconds': round(point.originalElapsedSeconds, 6),
    'Original cycle seconds': round(point.originalCycleSeconds, 6),
    'Luminance nits': round(point.luminanceNits, 6),
    'Source row': point.rowNumber,
  }));
  const pointsSheet = XLSX.utils.json_to_sheet(pointRows);
  setColumnWidths(pointsSheet, [34, 10, 16, 16, 24, 22, 16, 12]);
  XLSX.utils.book_append_sheet(workbook, pointsSheet, 'Cleaned Points');

  const diagnosticRows = result.diagnostics.map((diagnostic) => ({
    Severity: diagnostic.severity,
    Machine: diagnostic.curveName ?? '',
    'Window %': diagnostic.windowLevel ?? '',
    Message: diagnostic.message,
  }));
  const diagnosticsSheet = XLSX.utils.json_to_sheet([
    {
      Severity: 'info',
      Machine: '',
      'Window %': '',
      Message: `Generated at ${result.generatedAt}. Edge guard ${result.options.edgeGuardSeconds}s, min stable ${result.options.minStableSeconds}s, outlier threshold ${result.options.outlierThreshold}.`,
    },
    ...diagnosticRows,
  ]);
  setColumnWidths(diagnosticsSheet, [12, 34, 10, 96]);
  XLSX.utils.book_append_sheet(workbook, diagnosticsSheet, 'Diagnostics');

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};
