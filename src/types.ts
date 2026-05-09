export type ViewMode = 'time' | 'percent';

export type ProcessingMode = 'raw' | 'processed';

export type DisplayMode = '2d' | '3d';

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

export type AlignmentMode = 'index' | 'normalized';

export interface PostProcessOptions {
  alignmentMode: AlignmentMode;
  minSamplesPerWindow: number;
  relativeOutlierTolerance: number;
  minimumOutlierDeltaNits: number;
  windowGapSlots: number;
  normalizedWindowSlots: number;
}

export interface CleanedLuminancePoint {
  curveId: string;
  curveName: string;
  windowLevel: number;
  rowNumber: number;
  originalElapsedSeconds: number;
  originalCycleSeconds: number;
  windowIndex: number;
  alignedIndex: number;
  luminanceNits: number;
}

export interface WindowSummary {
  curveId: string;
  curveName: string;
  windowLevel: number;
  firstCycleSeconds: number;
  lastCycleSeconds: number;
  spanSeconds: number;
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
  sampleCount: number;
  alignedIndexStart: number;
  alignedIndexEnd: number;
}

export interface PostProcessResult {
  generatedAt: string;
  options: PostProcessOptions;
  windows: PostProcessWindow[];
  cleanedPoints: CleanedLuminancePoint[];
  summaries: WindowSummary[];
  diagnostics: PostProcessDiagnostic[];
}

export interface LuminanceBar3DDatum {
  curveId: string;
  curveName: string;
  curveColor: string;
  windowLevel: number;
  rowNumber: number;
  alignedIndex: number;
  windowIndex: number;
  luminanceNits: number;
  xIndex: number;
  zIndex: number;
}

export interface LuminanceScene3DWindowBand {
  windowLevel: number;
  alignedIndexStart: number;
  alignedIndexEnd: number;
}

export interface LuminanceScene3DData {
  curves: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  windows: LuminanceScene3DWindowBand[];
  bars: LuminanceBar3DDatum[];
  maxAlignedIndex: number;
  maxLuminance: number;
  axisMaxLuminance: number;
}

export interface LuminanceApi {
  selectExcelFiles: () => Promise<ImportedExcelFile[]>;
  selectDatabaseFiles: () => Promise<ImportedExcelFile[]>;
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
