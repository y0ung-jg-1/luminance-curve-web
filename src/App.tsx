import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Box,
  ChevronDown,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FileDown,
  FileSpreadsheet,
  Layers,
  Moon,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ChartPanel, type ChartPanelHandle } from './components/ChartPanel';
import { ExecutionPicker, type SelectionEntry } from './components/ExecutionPicker';
import { LuminanceScene3D, type LuminanceScene3DHandle } from './components/LuminanceScene3D';
import { downloadBlob, downloadDataUrl, downloadTextFile } from './lib/download';
import { buildCleanWorkbookArrayBuffer, buildCleanWorkbookBase64 } from './lib/exportCleanWorkbook';
import { formatCompact, formatNumber } from './lib/format';
import { buildIllustratorLayeredSvgs } from './lib/illustratorSvg';
import {
  buildCurveFromExecution,
  listLuminanceExecutions,
  type DatabaseFileExecutions,
} from './lib/parseDatabase';
import { base64ToUint8Array, parseWorkbook } from './lib/parseWorkbook';
import { postProcessCurves } from './lib/postProcess';
import { readBrowserFile } from './lib/readBrowserFile';
import { windowSequenceLabel } from './lib/windowSequence';
import type {
  AlignmentMode,
  CurveSeries,
  DisplayMode,
  ImportedExcelFile,
  ParsedWorkbook,
  ProcessingMode,
  ViewMode,
} from './types';

const colors = [
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#AF52DE',
  '#FF2D55',
  '#00C7BE',
  '#5856D6',
  '#FFCC00',
  '#5AC8FA',
  '#FF3B30',
  '#64D2FF',
  '#BF5AF2',
];

const maxWorkbookBytes = 25 * 1024 * 1024;
const createId = (name: string) => `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const isExcelFile = (fileName: string) => fileName.toLowerCase().endsWith('.xlsx');
const isDatabaseFile = (fileName: string) => fileName.toLowerCase().endsWith('.db');

const sampleImbalanceThreshold = 1.2;

interface SampleImbalance {
  level: number;
  ratio: number;
  minCount: number;
  maxCount: number;
}

const detectSampleImbalance = (curves: CurveSeries[]): SampleImbalance | null => {
  if (curves.length < 2) return null;
  const levels = new Set<number>();
  for (const curve of curves) {
    for (const point of curve.points) levels.add(point.levelPercent);
  }
  let worst: SampleImbalance | null = null;
  for (const level of levels) {
    const counts: number[] = [];
    for (const curve of curves) {
      let count = 0;
      for (const point of curve.points) {
        if (Math.abs(point.levelPercent - level) < 1e-6) count += 1;
      }
      if (count > 0) counts.push(count);
    }
    if (counts.length < 2) continue;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (min === 0) continue;
    const ratio = max / min;
    if (ratio > sampleImbalanceThreshold && (!worst || ratio > worst.ratio)) {
      worst = { level, ratio, minCount: min, maxCount: max };
    }
  }
  return worst;
};

interface PickerState {
  files: DatabaseFileExecutions[];
  buffers: Map<string, Uint8Array>;
}

interface AppProps {
  initialCurves?: CurveSeries[];
}

export const App = ({ initialCurves = [] }: AppProps) => {
  const [curves, setCurves] = useState<CurveSeries[]>(initialCurves);
  const [viewMode, setViewMode] = useState<ViewMode>('time');
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('raw');
  const [alignmentMode, setAlignmentMode] = useState<AlignmentMode>('index');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('2d');
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [alignmentAlert, setAlignmentAlert] = useState<SampleImbalance | null>(null);
  const [renameState, setRenameState] = useState<{ id: string; draft: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dbInputRef = useRef<HTMLInputElement | null>(null);
  const chartRef = useRef<ChartPanelHandle | null>(null);
  const scene3DRef = useRef<LuminanceScene3DHandle | null>(null);

  const visibleCurves = useMemo(() => curves.filter((curve) => curve.visible), [curves]);
  const sampleImbalance = useMemo(() => detectSampleImbalance(visibleCurves), [visibleCurves]);
  const showImbalanceWarning =
    sampleImbalance !== null && processingMode === 'processed' && alignmentMode === 'index';
  const processedResult = useMemo(
    () => postProcessCurves(visibleCurves, { alignmentMode }),
    [visibleCurves, alignmentMode],
  );
  const has3DData = processedResult.cleanedPoints.length > 0;
  const totalPoints = useMemo(
    () => curves.reduce((sum, curve) => sum + curve.stats.pointCount, 0),
    [curves],
  );
  const maxLuminance = useMemo(
    () => (curves.length ? Math.max(...curves.map((curve) => curve.stats.maxLuminance)) : 0),
    [curves],
  );
  const processedDroppedPoints = useMemo(
    () => processedResult.summaries.reduce((sum, summary) => sum + summary.samplesDropped, 0),
    [processedResult],
  );
  const processedWarningCount = useMemo(
    () => processedResult.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    [processedResult],
  );

  useEffect(() => {
    if (displayMode === '3d' && !has3DData) {
      setDisplayMode('2d');
    }
  }, [displayMode, has3DData]);

  const prevCurveCountRef = useRef(curves.length);
  useEffect(() => {
    const grew = curves.length > prevCurveCountRef.current;
    prevCurveCountRef.current = curves.length;
    if (!grew) return;
    if (processingMode !== 'processed') return;
    if (alignmentMode !== 'index') return;
    if (!sampleImbalance) return;
    setAlignmentMode('normalized');
    setAlignmentAlert(sampleImbalance);
  }, [curves, alignmentMode, processingMode, sampleImbalance]);

  const addParsedWorkbooks = useCallback((workbooks: ParsedWorkbook[]) => {
    if (workbooks.length === 0) return;

    setCurves((current) => [
      ...current,
      ...workbooks.map((workbook, index) => ({
        ...workbook,
        id: createId(workbook.name),
        color: colors[(current.length + index) % colors.length],
        visible: true,
        importedAt: new Date().toISOString(),
      })),
    ]);
  }, []);

  const importDesktopFiles = useCallback(
    async (files: ImportedExcelFile[]) => {
      const parsed: ParsedWorkbook[] = [];
      const errors: string[] = [];

      for (const file of files) {
        try {
          if (!isExcelFile(file.name)) {
            throw new Error('只支持 .xlsx 文件。');
          }
          parsed.push(parseWorkbook(base64ToUint8Array(file.data), file.name, file.path));
        } catch (error) {
          errors.push(`${file.name}: ${(error as Error).message}`);
        }
      }

      addParsedWorkbooks(parsed);

      if (parsed.length > 0) {
        const count = parsed.reduce((sum, item) => sum + item.stats.pointCount, 0);
        setMessage(`已导入 ${parsed.length} 个文件，${formatCompact(count)} 个采样点。`);
      }
      if (errors.length > 0) {
        setMessage(errors.join(' / '));
      }
    },
    [addParsedWorkbooks],
  );

  const importBrowserFiles = useCallback(
    async (files: File[]) => {
      const parsed: ParsedWorkbook[] = [];
      const errors: string[] = [];

      setIsImporting(true);
      for (const file of files) {
        try {
          if (!isExcelFile(file.name)) {
            throw new Error('只支持 .xlsx 文件。');
          }
          if (file.size > maxWorkbookBytes) {
            throw new Error('文件超过 25 MB，已拒绝导入。');
          }
          parsed.push(parseWorkbook(await readBrowserFile(file), file.name));
        } catch (error) {
          errors.push(`${file.name}: ${(error as Error).message}`);
        }
      }
      setIsImporting(false);

      addParsedWorkbooks(parsed);

      if (parsed.length > 0) {
        const count = parsed.reduce((sum, item) => sum + item.stats.pointCount, 0);
        setMessage(`已导入 ${parsed.length} 个文件，${formatCompact(count)} 个采样点。`);
      }
      if (errors.length > 0) {
        setMessage(errors.join(' / '));
      }
    },
    [addParsedWorkbooks],
  );

  const importDatabaseFiles = useCallback(
    async (entries: Array<{ name: string; path?: string; buffer: Uint8Array }>) => {
      const files: DatabaseFileExecutions[] = [];
      const buffers = new Map<string, Uint8Array>();
      const errors: string[] = [];

      for (const entry of entries) {
        try {
          if (entry.buffer.byteLength === 0) {
            throw new Error('文件为空，无法读取。');
          }
          const result = await listLuminanceExecutions(entry.buffer, entry.name, entry.path);
          files.push(result);
          buffers.set(entry.name, entry.buffer);
        } catch (error) {
          errors.push(`${entry.name}: ${(error as Error).message}`);
        }
      }

      if (errors.length > 0) {
        setMessage(errors.join(' / '));
      }

      const totalExecutions = files.reduce((sum, f) => sum + f.executions.length, 0);
      if (totalExecutions === 0) {
        if (errors.length === 0) {
          setMessage('所选数据库中没有亮度测试执行记录。');
        }
        return;
      }

      setPickerState({ files, buffers });
    },
    [],
  );

  const handlePickerCancel = useCallback(() => setPickerState(null), []);

  const handlePickerConfirm = useCallback(
    async (selections: SelectionEntry[]) => {
      if (!pickerState) {
        setPickerState(null);
        return;
      }
      const parsed: ParsedWorkbook[] = [];
      const errors: string[] = [];

      for (const entry of selections) {
        const buffer = pickerState.buffers.get(entry.fileName);
        if (!buffer) {
          errors.push(`${entry.fileName}: 缓冲区已丢失。`);
          continue;
        }
        try {
          const workbook = await buildCurveFromExecution(buffer, entry.execution, {
            fileName: entry.fileName,
            filePath: entry.filePath,
          });
          parsed.push(workbook);
        } catch (error) {
          errors.push(`${entry.fileName} #${entry.execution.executionId}: ${(error as Error).message}`);
        }
      }

      addParsedWorkbooks(parsed);

      if (parsed.length > 0) {
        const count = parsed.reduce((sum, item) => sum + item.stats.pointCount, 0);
        setMessage(`已导入 ${parsed.length} 条曲线，${formatCompact(count)} 个采样点。`);
      }
      if (errors.length > 0) {
        setMessage(errors.join(' / '));
      }

      setPickerState(null);
    },
    [pickerState, addParsedWorkbooks],
  );

  const handleSelectDatabase = async () => {
    if (window.luminanceAPI) {
      setIsImporting(true);
      try {
        const files = await window.luminanceAPI.selectDatabaseFiles();
        if (files.length === 0) return;
        const entries = files.map((file) => ({
          name: file.name,
          path: file.path,
          buffer: base64ToUint8Array(file.data),
        }));
        await importDatabaseFiles(entries);
      } catch (error) {
        setMessage((error as Error).message);
      } finally {
        setIsImporting(false);
      }
      return;
    }

    dbInputRef.current?.click();
  };

  const handleDatabaseFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    setIsImporting(true);
    try {
      const entries = await Promise.all(
        files.map(async (file) => {
          if (file.size > maxWorkbookBytes) {
            throw new Error(`${file.name} 超过 25 MB，已拒绝导入。`);
          }
          const arrayBuffer = await file.arrayBuffer();
          return { name: file.name, buffer: new Uint8Array(arrayBuffer) };
        }),
      );
      await importDatabaseFiles(entries);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleSelectFiles = async () => {
    if (window.luminanceAPI) {
      setIsImporting(true);
      try {
        const files = await window.luminanceAPI.selectExcelFiles();
        await importDesktopFiles(files);
      } catch (error) {
        setMessage((error as Error).message);
      } finally {
        setIsImporting(false);
      }
      return;
    }

    fileInputRef.current?.click();
  };

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    await importBrowserFiles(Array.from(input.files ?? []));
    input.value = '';
  };

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const dbFiles = files.filter((file) => isDatabaseFile(file.name));
    const excelFiles = files.filter((file) => isExcelFile(file.name));
    const ignored = files.filter((file) => !isDatabaseFile(file.name) && !isExcelFile(file.name));

    if (excelFiles.length > 0) {
      await importBrowserFiles(excelFiles);
    }
    if (dbFiles.length > 0) {
      setIsImporting(true);
      try {
        const entries = await Promise.all(
          dbFiles.map(async (file) => {
            if (file.size > maxWorkbookBytes) {
              throw new Error(`${file.name} 超过 25 MB，已拒绝导入。`);
            }
            const arrayBuffer = await file.arrayBuffer();
            return { name: file.name, buffer: new Uint8Array(arrayBuffer) };
          }),
        );
        await importDatabaseFiles(entries);
      } catch (error) {
        setMessage((error as Error).message);
      } finally {
        setIsImporting(false);
      }
    }
    if (ignored.length > 0) {
      setMessage(`忽略不支持的文件：${ignored.map((file) => file.name).join('、')}`);
    }
  };

  const handleExportPng = async () => {
    setIsExportMenuOpen(false);
    const dataUrl = displayMode === '3d' ? scene3DRef.current?.exportPng() : chartRef.current?.exportPng();
    if (!dataUrl) {
      setMessage('当前没有可导出的图表。');
      return;
    }

    if (window.luminanceAPI) {
      try {
        const savedPath = await window.luminanceAPI.saveChartImage(dataUrl);
        if (savedPath) setMessage(`已导出 PNG：${savedPath}`);
      } catch (error) {
        setMessage((error as Error).message);
      }
      return;
    }

    downloadDataUrl(dataUrl, `luminance-curve-${displayMode === '3d' ? '3d' : `${processingMode}-${viewMode}`}.png`);
    setMessage('已开始下载 PNG。');
  };

  const handleExportSvg = async () => {
    setIsExportMenuOpen(false);
    const svg = chartRef.current?.exportSvg();
    if (!svg) {
      setMessage('当前没有可导出的 SVG 图表。');
      return;
    }

    if (window.luminanceAPI) {
      try {
        const savedPath = await window.luminanceAPI.saveChartSvg(svg);
        if (savedPath) setMessage(`已导出 SVG：${savedPath}`);
      } catch (error) {
        setMessage((error as Error).message);
      }
      return;
    }

    downloadTextFile(svg, `luminance-curve-${processingMode}-${viewMode}.svg`, 'image/svg+xml;charset=utf-8');
    setMessage('已开始下载 SVG。');
  };

  const handleExportLayeredSvg = async () => {
    setIsExportMenuOpen(false);
    if (processedResult.cleanedPoints.length === 0) {
      setMessage('后处理没有得到足够稳定的窗口样本，暂时不能导出 AI 分层 SVG。');
      return;
    }

    const yExtent = chartRef.current?.getYAxisExtent();
    const fallbackMax = Math.max(...processedResult.cleanedPoints.map((point) => point.luminanceNits), 1);
    const yMin = yExtent?.[0] ?? 0;
    const yMax = yExtent?.[1] ?? fallbackMax;
    const files = buildIllustratorLayeredSvgs(processedResult, visibleCurves, { yMin, yMax });

    if (files.length === 0) {
      setMessage('没有可导出的可见曲线。');
      return;
    }

    if (window.luminanceAPI) {
      try {
        const savedPaths = await window.luminanceAPI.saveLayeredSvgs(files);
        if (savedPaths.length > 0) {
          setMessage(`已导出 ${savedPaths.length} 个 AI 分层 SVG。`);
        }
      } catch (error) {
        setMessage((error as Error).message);
      }
      return;
    }

    for (const file of files) {
      downloadTextFile(file.svg, file.fileName, 'image/svg+xml;charset=utf-8');
    }
    setMessage(`已开始下载 ${files.length} 个 AI 分层 SVG。`);
  };

  const handleExportCleanWorkbook = async () => {
    setIsExportMenuOpen(false);
    if (processedResult.summaries.length === 0) {
      setMessage('后处理没有得到足够稳定的窗口样本，暂时不能导出干净 Excel。');
      return;
    }

    if (window.luminanceAPI) {
      try {
        const savedPath = await window.luminanceAPI.saveCleanWorkbook(buildCleanWorkbookBase64(processedResult));
        if (savedPath) setMessage(`已导出干净 Excel：${savedPath}`);
      } catch (error) {
        setMessage((error as Error).message);
      }
      return;
    }

    downloadBlob(
      buildCleanWorkbookArrayBuffer(processedResult),
      'clean-luminance-data.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    setMessage('已开始下载干净 Excel。');
  };

  const toggleCurve = (id: string) => {
    setCurves((current) =>
      current.map((curve) => (curve.id === id ? { ...curve, visible: !curve.visible } : curve)),
    );
  };

  const removeCurve = (id: string) => {
    setCurves((current) => current.filter((curve) => curve.id !== id));
  };

  const startRename = (curve: CurveSeries) => {
    setRenameState({ id: curve.id, draft: curve.name });
  };

  const cancelRename = () => {
    setRenameState(null);
  };

  const commitRename = () => {
    if (!renameState) return;
    const trimmed = renameState.draft.trim();
    setRenameState(null);
    if (!trimmed) return;
    setCurves((current) =>
      current.map((curve) => (curve.id === renameState.id ? { ...curve, name: trimmed } : curve)),
    );
  };

  const clearCurves = () => {
    setCurves([]);
    setDisplayMode('2d');
    setMessage('已清空所有曲线。');
  };

  const handleDisplayModeChange = (nextMode: DisplayMode) => {
    if (nextMode === displayMode) return;

    if (nextMode === '3d') {
      if (!has3DData) {
        setMessage('3D 模式需要至少一个后处理稳定采样点。');
        return;
      }
      setDisplayMode('3d');
      return;
    }

    setDisplayMode('2d');
  };

  return (
    <div
      className={`app-shell ${theme}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".xlsx"
        multiple
        onChange={handleFileInput}
        aria-label="选择 Excel 文件"
      />
      <input
        ref={dbInputRef}
        className="file-input"
        type="file"
        accept=".db"
        multiple
        onChange={handleDatabaseFileInput}
        aria-label="选择数据库文件"
      />

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Layers size={20} />
          </div>
          <div>
            <h1>Luminance Curve</h1>
            <p>Local Excel luminance overlay</p>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="button excel" type="button" onClick={handleSelectFiles} disabled={isImporting}>
            <Upload size={17} />
            {isImporting ? '导入中' : '导入 Excel'}
          </button>
          <button className="button database" type="button" onClick={handleSelectDatabase} disabled={isImporting}>
            <Database size={17} />
            导入数据库
          </button>
          <div className="export-menu">
            <button
              className="button secondary"
              type="button"
              onClick={() => setIsExportMenuOpen((current) => !current)}
              disabled={visibleCurves.length === 0}
              aria-expanded={isExportMenuOpen}
            >
              <Download size={17} />
              导出
              <ChevronDown size={15} />
            </button>
            {isExportMenuOpen ? (
              <div className="export-popover" role="menu">
                <button type="button" role="menuitem" onClick={handleExportCleanWorkbook} disabled={processedResult.summaries.length === 0}>
                  <FileSpreadsheet size={16} />
                  干净 Excel
                </button>
                <button type="button" role="menuitem" onClick={handleExportSvg}>
                  <FileCode2 size={16} />
                  SVG 图表
                </button>
                <button type="button" role="menuitem" onClick={handleExportLayeredSvg} disabled={processedResult.cleanedPoints.length === 0}>
                  <Layers size={16} />
                  AI 分层 SVG
                </button>
                <button type="button" role="menuitem" onClick={handleExportPng}>
                  <FileDown size={16} />
                  PNG 图表
                </button>
              </div>
            ) : null}
          </div>
          <button className="icon-button" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="切换明暗模式">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar" aria-label="曲线列表">
          <div className="sidebar-header">
            <div>
              <span className="eyebrow">CURVES</span>
              <h2>{curves.length ? `${curves.length} 条曲线` : '等待导入'}</h2>
            </div>
            <button className="icon-button subtle" type="button" onClick={clearCurves} disabled={curves.length === 0} aria-label="清空曲线">
              <Trash2 size={17} />
            </button>
          </div>

          <div className="summary-grid">
            <div>
              <span>采样点</span>
              <strong>{formatCompact(totalPoints)}</strong>
            </div>
            <div>
              <span>峰值</span>
              <strong>{formatNumber(maxLuminance, 0)}</strong>
            </div>
          </div>

          <div className="privacy-note">
            Excel 文件只在本机解析，不上传到服务器。
          </div>

          <div className="curve-list">
            {curves.length === 0 ? (
              <div className="empty-list">
                <FileSpreadsheet size={28} />
                <p>导入多个 Excel 后，它们会作为独立曲线叠加在同一张图里。</p>
              </div>
            ) : (
              curves.map((curve) => {
                const isEditing = renameState?.id === curve.id;
                return (
                  <article className={`curve-item ${curve.visible ? '' : 'muted'}`} key={curve.id}>
                    <label className="curve-switch">
                      <input
                        type="checkbox"
                        checked={curve.visible}
                        onChange={() => toggleCurve(curve.id)}
                        aria-label={`${curve.visible ? '隐藏' : '显示'} ${curve.name}`}
                      />
                      <span className="swatch" style={{ backgroundColor: curve.color }} />
                      {curve.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </label>
                    <div className="curve-copy">
                      {isEditing ? (
                        <input
                          className="curve-name-input"
                          value={renameState.draft}
                          autoFocus
                          aria-label="重命名曲线"
                          onChange={(event) =>
                            setRenameState({ id: curve.id, draft: event.target.value })
                          }
                          onBlur={commitRename}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitRename();
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      ) : (
                        <strong
                          className="curve-name"
                          title={`${curve.name}（点击重命名）`}
                          role="button"
                          tabIndex={0}
                          onClick={() => startRename(curve)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              startRename(curve);
                            }
                          }}
                        >
                          {curve.name}
                        </strong>
                      )}
                      <span>
                        {formatCompact(curve.stats.pointCount)} 点 · 峰值 {formatNumber(curve.stats.maxLuminance, 1)} nits · {curve.stats.levels.length} 级
                      </span>
                    </div>
                    <button
                      className="icon-button tiny"
                      type="button"
                      onClick={() => removeCurve(curve.id)}
                      aria-label={`移除 ${curve.name}`}
                    >
                      <X size={15} />
                    </button>
                  </article>
                );
              })
            )}
          </div>
        </aside>

        <section className="chart-section" aria-label="亮度图表">
          <div className="chart-toolbar">
            <div className="toolbar-controls">
              <div className="segmented-control" aria-label="显示模式">
                <button
                  className={displayMode === '2d' ? 'active' : ''}
                  type="button"
                  onClick={() => handleDisplayModeChange('2d')}
                  aria-pressed={displayMode === '2d'}
                >
                  <BarChart3 size={16} />
                  2D
                </button>
                <button
                  className={displayMode === '3d' ? 'active' : ''}
                  type="button"
                  onClick={() => handleDisplayModeChange('3d')}
                  aria-pressed={displayMode === '3d'}
                  disabled={!has3DData}
                >
                  <Box size={16} />
                  3D
                </button>
              </div>

              <div className="segmented-control" aria-label="处理模式">
                <button
                  className={processingMode === 'raw' ? 'active' : ''}
                  type="button"
                  onClick={() => setProcessingMode('raw')}
                  aria-pressed={processingMode === 'raw'}
                >
                  <Clock3 size={16} />
                  原始
                </button>
                <button
                  className={processingMode === 'processed' ? 'active' : ''}
                  type="button"
                  onClick={() => setProcessingMode('processed')}
                  aria-pressed={processingMode === 'processed'}
                >
                  <BarChart3 size={16} />
                  后处理
                </button>
              </div>

              {processingMode === 'raw' ? (
                <div className="segmented-control" aria-label="视图模式">
                  <button
                    className={viewMode === 'time' ? 'active' : ''}
                    type="button"
                    onClick={() => setViewMode('time')}
                    aria-pressed={viewMode === 'time'}
                  >
                    <Clock3 size={16} />
                    时间曲线
                  </button>
                  <button
                    className={viewMode === 'percent' ? 'active' : ''}
                    type="button"
                    onClick={() => setViewMode('percent')}
                    aria-pressed={viewMode === 'percent'}
                  >
                    <Layers size={16} />
                    百分比分布
                  </button>
                </div>
              ) : (
                <div className="alignment-block">
                  {showImbalanceWarning ? (
                    <div className="alignment-warning" role="alert">
                      <AlertTriangle size={14} />
                      <span>
                        当前数据采样率差异过大，请使用「<strong>归一化</strong>」
                      </span>
                    </div>
                  ) : null}
                  <div className="segmented-control" aria-label="对齐方式">
                    <button
                      className={alignmentMode === 'index' ? 'active' : ''}
                      type="button"
                      onClick={() => setAlignmentMode('index')}
                      aria-pressed={alignmentMode === 'index'}
                    >
                      采样序号
                    </button>
                    <button
                      className={alignmentMode === 'normalized' ? 'active' : ''}
                      type="button"
                      onClick={() => setAlignmentMode('normalized')}
                      aria-pressed={alignmentMode === 'normalized'}
                    >
                      归一化
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="chart-meta">
              <span>{visibleCurves.length} 条可见</span>
              {displayMode === '3d' ? (
                <>
                  <span>{formatCompact(processedResult.cleanedPoints.length)} 个时间采样柱</span>
                  <span>峰值 {formatNumber(maxLuminance, 0)} nits</span>
                </>
              ) : processingMode === 'processed' ? (
                <>
                  <span>{formatCompact(processedResult.cleanedPoints.length)} 个干净采样点</span>
                  <span>裁切 {formatCompact(processedDroppedPoints)} 点</span>
                  {processedWarningCount > 0 ? <span className="warning-meta">{processedWarningCount} 个警告</span> : null}
                </>
              ) : (
                <>
                  <span>{viewMode === 'time' ? 'X: 总时间秒' : 'X: 窗口 / 百分比'}</span>
                  {viewMode === 'time' ? <span className="window-sequence">窗口顺序：{windowSequenceLabel}</span> : null}
                </>
              )}
            </div>
          </div>

          <div className="chart-frame">
            {curves.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <Upload size={30} />
                </div>
                <h2>把 Excel 或数据库亮度数据拖到这里</h2>
                <p>Excel 读取首个工作表的 B-E 列；数据库读取「亮度测试」项的所有执行，导入时可多选。</p>
                <div className="empty-state-actions">
                  <button className="button excel" type="button" onClick={handleSelectFiles} disabled={isImporting}>
                    <Upload size={17} />
                    导入 Excel
                  </button>
                  <button className="button database" type="button" onClick={handleSelectDatabase} disabled={isImporting}>
                    <Database size={17} />
                    导入数据库
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={`visual-layer ${displayMode === '2d' ? 'visible' : 'hidden'}`} aria-hidden={displayMode !== '2d'}>
                  <ChartPanel
                    ref={chartRef}
                    curves={curves}
                    viewMode={viewMode}
                    processingMode={processingMode}
                    processedResult={processedResult}
                    theme={theme}
                  />
                </div>
                {displayMode === '3d' ? (
                  <div className="visual-layer visible">
                    <LuminanceScene3D
                      ref={scene3DRef}
                      visibleCurves={visibleCurves}
                      processedResult={processedResult}
                      theme={theme}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </main>

      {isDragging ? (
        <div className="drop-overlay" aria-hidden="true">
          <div>
            <Upload size={34} />
            <span>松开鼠标导入 .xlsx 或 .db 文件</span>
          </div>
        </div>
      ) : null}

      <ExecutionPicker
        open={pickerState !== null}
        files={pickerState?.files ?? []}
        onCancel={handlePickerCancel}
        onConfirm={handlePickerConfirm}
      />

      {alignmentAlert ? (
        <div
          className="alert-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alignment-alert-title"
        >
          <div className="alert-card">
            <div className="alert-icon" aria-hidden="true">
              <Sparkles size={42} />
            </div>
            <h2 id="alignment-alert-title" className="alert-title">
              已自动切换到归一化模式
            </h2>
            <p className="alert-body">
              检测到 <strong>{alignmentAlert.level}%</strong> 窗口在不同数据源之间采样数差异约
              <strong> {Math.round((alignmentAlert.ratio - 1) * 100)}%</strong>
              （{alignmentAlert.minCount} vs {alignmentAlert.maxCount}）。
              <br />
              「采样序号」模式会丢弃大量数据，已自动切换到「归一化」对齐方式。
            </p>
            <button
              type="button"
              className="button primary alert-action"
              onClick={() => setAlignmentAlert(null)}
              autoFocus
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="toast" role="status">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="关闭通知">
            <X size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
};
