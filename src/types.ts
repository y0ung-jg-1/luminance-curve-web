export type ViewMode = 'time' | 'percent';

export type ProcessingMode = 'raw' | 'processed';

export interface ImportedExcelFile {
  name: string;
  path?: string;
  data: string;
}

export interface SvgExportFile {
  fileName: string;
  svg: string;
}

export interface LuminancePoint {
  rowNumber: number;
  elapsedSeconds: number;
  cycleSeconds: number;
  levelPercent: number;
  luminanceNits: number;
}

export interface LuminanceStats {
  pointCount: number;
  minLuminance: number;
  maxLuminance: number;
  averageLuminance: number;
  minElapsedSeconds: number;
  maxElapsedSeconds: number;
  levels: number[];
}

export interface ParsedWorkbook {
  name: string;
  path?: string;
  sheetName: string;
  points: LuminancePoint[];
  stats: LuminanceStats;
}

export interface CurveSeries extends ParsedWorkbook {
  id: string;
  color: string;
  visible: boolean;
  importedAt: string;
}

export interface PostProcessOptions {
  edgeGuardSeconds: number;
  minStableSeconds: number;
  minSamplesPerWindow: number;
  outlierThreshold: number;
  outlierWindowRadius: number;
  relativeOutlierTolerance: number;
  minimumOutlierDeltaNits: number;
  windowGapSeconds: number;
}

export interface CleanedLuminancePoint {
  curveId: string;
  curveName: string;
  windowLevel: number;
  rowNumber: number;
  originalElapsedSeconds: number;
  originalCycleSeconds: number;
  windowSeconds: number;
  alignedSeconds: number;
  luminanceNits: number;
}

export interface WindowSummary {
  curveId: string;
  curveName: string;
  windowLevel: number;
  stableStartSeconds: number;
  stableEndSeconds: number;
  stableDurationSeconds: number;
  meanLuminance: number;
  medianLuminance: number;
  minLuminance: number;
  maxLuminance: number;
  stdevLuminance: number;
  samplesKept: number;
  samplesDropped: number;
  outliersDropped: number;
}

export interface PostProcessDiagnostic {
  severity: 'info' | 'warning';
  curveId?: string;
  curveName?: string;
  windowLevel?: number;
  message: string;
}

export interface PostProcessWindow {
  windowLevel: number;
  stableStartSeconds: number;
  stableEndSeconds: number;
  stableDurationSeconds: number;
  alignedStartSeconds: number;
  alignedEndSeconds: number;
}

export interface PostProcessResult {
  generatedAt: string;
  options: PostProcessOptions;
  windows: PostProcessWindow[];
  cleanedPoints: CleanedLuminancePoint[];
  summaries: WindowSummary[];
  diagnostics: PostProcessDiagnostic[];
}

export interface LuminanceApi {
  selectExcelFiles: () => Promise<ImportedExcelFile[]>;
  saveChartImage: (dataUrl: string) => Promise<string | null>;
  saveChartSvg: (svg: string) => Promise<string | null>;
  saveLayeredSvgs: (files: SvgExportFile[]) => Promise<string[]>;
  saveCleanWorkbook: (base64: string) => Promise<string | null>;
}

declare global {
  interface Window {
    luminanceAPI?: LuminanceApi;
  }
}
