import * as XLSX from 'xlsx';
import type { PostProcessResult } from '../types';

const round = (value: number, decimals = 6): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const setColumnWidths = (sheet: XLSX.WorkSheet, widths: number[]) => {
  sheet['!cols'] = widths.map((wch) => ({ wch }));
};

const buildCleanWorkbook = (result: PostProcessResult): XLSX.WorkBook => {
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
    'Tail samples dropped': summary.samplesDropped,
    'Short spikes preserved': 'Yes',
    'First cycle s': round(summary.firstCycleSeconds, 6),
    'Last cycle s': round(summary.lastCycleSeconds, 6),
    'Span s': round(summary.spanSeconds, 6),
  }));
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  setColumnWidths(summarySheet, [34, 10, 14, 12, 11, 11, 12, 13, 16, 16, 14, 14, 12]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  const pointRows = result.cleanedPoints.map((point) => ({
    Machine: point.curveName,
    'Window %': point.windowLevel,
    'Aligned index': point.alignedIndex,
    'Window index': point.windowIndex,
    'Original elapsed seconds': round(point.originalElapsedSeconds, 6),
    'Original cycle seconds': round(point.originalCycleSeconds, 6),
    'Luminance nits': round(point.luminanceNits, 6),
    'Source row': point.rowNumber,
  }));
  const pointsSheet = XLSX.utils.json_to_sheet(pointRows);
  setColumnWidths(pointsSheet, [34, 10, 14, 14, 24, 22, 16, 12]);
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
      Message: `Generated at ${result.generatedAt}. Curves are aligned by sample index from the first reached sample of each window; min ${result.options.minSamplesPerWindow} samples per window, ${result.options.windowGapSlots}-slot gap between windows. Short luminance spikes are preserved.`,
    },
    ...diagnosticRows,
  ]);
  setColumnWidths(diagnosticsSheet, [12, 34, 10, 96]);
  XLSX.utils.book_append_sheet(workbook, diagnosticsSheet, 'Diagnostics');

  return workbook;
};

export const buildCleanWorkbookArrayBuffer = (result: PostProcessResult): ArrayBuffer => {
  return XLSX.write(buildCleanWorkbook(result), { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};

export const buildCleanWorkbookBase64 = (result: PostProcessResult): string => {
  return XLSX.write(buildCleanWorkbook(result), { bookType: 'xlsx', type: 'base64' }) as string;
};
