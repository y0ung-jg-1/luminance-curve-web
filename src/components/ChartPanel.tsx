import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import type {
  CleanedLuminancePoint,
  CurveSeries,
  LuminancePoint,
  PostProcessResult,
  ProcessingMode,
  ViewMode,
} from '../types';
import { formatNumber } from '../lib/format';
import { windowSequence } from '../lib/windowSequence';

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  CanvasRenderer,
  SVGRenderer,
]);

export interface ChartPanelHandle {
  exportPng: () => string | null;
  exportSvg: () => string | null;
  getYAxisExtent: () => [number, number] | null;
}

interface ChartPanelProps {
  curves: CurveSeries[];
  viewMode: ViewMode;
  processingMode: ProcessingMode;
  processedResult: PostProcessResult;
  theme: 'light' | 'dark';
}

interface TooltipDatum {
  point: LuminancePoint;
  curveName: string;
}

interface ProcessedDatum {
  point?: CleanedLuminancePoint;
  curveName: string;
}

interface WindowStage {
  level: number;
  start: number;
  end: number;
}

interface ChartOptionInput {
  visibleCurves: CurveSeries[];
  viewMode: ViewMode;
  processingMode: ProcessingMode;
  processedResult: PostProcessResult;
  theme: 'light' | 'dark';
  shouldAnimate: boolean;
}

const escapeHtml = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const readDatum = (value: unknown): TooltipDatum | null => {
  const candidate = value as { data?: TooltipDatum };
  if (!candidate?.data?.point) return null;
  return candidate.data;
};

const readProcessedDatum = (value: unknown): ProcessedDatum | null => {
  const candidate = value as { data?: ProcessedDatum };
  if (!candidate?.data?.curveName) return null;
  return candidate.data;
};

const matchesWindowLevel = (value: number, level: number): boolean => Math.abs(value - level) < 0.000001;

const buildWindowStages = (curves: CurveSeries[]): WindowStage[] => {
  const primaryCurve = curves.find((curve) => curve.points.length > 0);
  if (!primaryCurve) return [];

  return windowSequence.flatMap((level) => {
    const points = primaryCurve.points.filter((point) => matchesWindowLevel(point.levelPercent, level));
    if (points.length === 0) return [];

    const times = points.map((point) => point.elapsedSeconds);
    const start = Math.min(...times);
    const end = Math.max(...times);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return [];

    return [{ level, start, end }];
  });
};

const findNearestByX = <T,>(items: T[], target: number, getX: (item: T) => number): T | null => {
  if (items.length === 0) return null;
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (getX(items[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  let best = items[lo];
  let bestDist = Math.abs(getX(best) - target);
  if (lo > 0) {
    const prev = items[lo - 1];
    const prevDist = Math.abs(getX(prev) - target);
    if (prevDist < bestDist) {
      best = prev;
      bestDist = prevDist;
    }
  }
  return best;
};

const dotMarker = (color: string): string =>
  `<span style="display:inline-block;margin-right:6px;border-radius:50%;width:10px;height:10px;background-color:${escapeHtml(
    color,
  )};vertical-align:middle;"></span>`;

const readAxisValue = (items: unknown[]): number | null => {
  for (const item of items) {
    const candidate = item as { axisValue?: number; value?: unknown };
    if (typeof candidate?.axisValue === 'number' && Number.isFinite(candidate.axisValue)) {
      return candidate.axisValue;
    }
    if (Array.isArray(candidate?.value) && typeof candidate.value[0] === 'number' && Number.isFinite(candidate.value[0])) {
      return candidate.value[0];
    }
  }
  return null;
};

const buildRawTooltip = (viewMode: ViewMode, visibleCurves: CurveSeries[]) => (params: unknown): string => {
  const items = Array.isArray(params) ? params : [params];
  const axisValue = readAxisValue(items);
  if (axisValue === null) return '';

  const isTime = viewMode === 'time';
  const getX = (point: LuminancePoint) => (isTime ? point.elapsedSeconds : point.levelPercent);

  const headerLabel = isTime
    ? `时间: ${formatNumber(axisValue, 2)} 秒`
    : `窗口: ${formatNumber(axisValue, 2)}%`;

  const sortedCurves = visibleCurves.map((curve) => ({
    curve,
    points: [...curve.points].sort((a, b) => getX(a) - getX(b)),
  }));

  const rows = sortedCurves
    .map(({ curve, points }) => {
      const point = findNearestByX(points, axisValue, getX);
      if (!point) return '';
      return `
        <div class="chart-tooltip-row">
          <span class="chart-tooltip-name">${dotMarker(curve.color)}${escapeHtml(curve.name)}</span>
          <span class="chart-tooltip-value">${formatNumber(point.luminanceNits, 2)}</span>
        </div>
      `;
    })
    .join('');

  if (!rows) return '';

  return `<div class="chart-tooltip">
    <div class="chart-tooltip-header">${escapeHtml(headerLabel)}</div>
    ${rows}
  </div>`;
};

const buildProcessedTooltip =
  (visibleCurves: CurveSeries[], processedResult: PostProcessResult) =>
  (params: unknown): string => {
    const items = Array.isArray(params) ? params : [params];
    const axisValue = readAxisValue(items);
    if (axisValue === null) return '';

    const isNormalized = processedResult.options.alignmentMode === 'normalized';
    const headerLabel = isNormalized
      ? `归一化位置: ${formatNumber(axisValue, 1)}`
      : `采样位置: #${formatNumber(axisValue, 0)}`;

    const rows = visibleCurves
      .map((curve) => {
        const points = processedResult.cleanedPoints
          .filter((p) => p.curveId === curve.id)
          .sort((a, b) => a.alignedIndex - b.alignedIndex);
        const point = findNearestByX(points, axisValue, (p) => p.alignedIndex);
        if (!point) return '';
        return `
          <div class="chart-tooltip-row">
            <span class="chart-tooltip-name">${dotMarker(curve.color)}${escapeHtml(curve.name)}</span>
            <span class="chart-tooltip-value">${formatNumber(point.luminanceNits, 2)}</span>
          </div>
        `;
      })
      .join('');

    if (!rows) return '';

    return `<div class="chart-tooltip">
    <div class="chart-tooltip-header">${escapeHtml(headerLabel)}</div>
    ${rows}
  </div>`;
  };

const commonText = (theme: 'light' | 'dark') => ({
  text: theme === 'dark' ? '#f5f5f7' : '#1d1d1f',
  muted: theme === 'dark' ? '#a1a1a8' : '#6e6e73',
  axis: theme === 'dark' ? '#c7c7cc' : '#6e6e73',
  line: theme === 'dark' ? '#3a3a3c' : '#d2d2d7',
  split: theme === 'dark' ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)',
});

const buildRawOption = ({
  visibleCurves,
  viewMode,
  theme,
  shouldAnimate,
}: ChartOptionInput): EChartsCoreOption => {
  const text = commonText(theme);
  const isTimeView = viewMode === 'time';
  const windowStages = isTimeView ? buildWindowStages(visibleCurves) : [];
  const windowBoundaries = Array.from(new Set(windowStages.flatMap((stage) => [stage.start, stage.end]))).sort(
    (a, b) => a - b,
  );
  const series = visibleCurves.map((curve, index) => ({
    name: curve.name,
    type: isTimeView ? 'line' : 'scatter',
    data: curve.points.map((point) => ({
      value: [isTimeView ? point.elapsedSeconds : point.levelPercent, point.luminanceNits],
      point,
      curveName: curve.name,
    })),
    showSymbol: !isTimeView,
    symbol: 'circle',
    symbolSize: isTimeView ? 8 : 5,
    sampling: isTimeView ? 'lttb' : undefined,
    smooth: false,
    animationDuration: shouldAnimate ? 220 : 0,
    progressive: shouldAnimate ? 3000 : 0,
    lineStyle: {
      color: curve.color,
      width: 2.2,
      opacity: 0.92,
    },
    itemStyle: {
      color: curve.color,
      opacity: isTimeView ? 1 : 0.68,
    },
    emphasis: {
      focus: 'none',
      lineStyle: {
        width: 3.4,
      },
    },
    markArea:
      isTimeView && index === 0 && windowStages.length > 0
        ? {
            silent: true,
            itemStyle: {
              color: theme === 'dark' ? 'rgba(255, 255, 255, 0.034)' : 'rgba(0, 0, 0, 0.026)',
            },
            label: {
              show: true,
              position: 'insideTop',
              color: text.muted,
              fontSize: 11,
              fontWeight: 600,
              formatter: (params: { name?: string }) => params.name ?? '',
            },
            data: windowStages.map((stage) => [
              { name: `${stage.level}%`, xAxis: stage.start },
              { xAxis: stage.end },
            ]),
          }
        : undefined,
    markLine:
      isTimeView && index === 0 && windowBoundaries.length > 0
        ? {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: {
              color: theme === 'dark' ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.12)',
              type: 'dashed',
              width: 1,
            },
            data: windowBoundaries.map((xAxis) => ({ xAxis })),
          }
        : undefined,
  }));

  return {
    backgroundColor: 'transparent',
    color: visibleCurves.map((curve) => curve.color),
    animation: shouldAnimate,
    grid: {
      left: 72,
      right: 28,
      top: 36,
      bottom: 86,
    },
    title: {
      show: visibleCurves.length === 0,
      text: '没有可见曲线',
      subtext: '打开左侧曲线开关，或导入新的 Excel 文件。',
      left: 'center',
      top: 'center',
      textStyle: {
        fontSize: 18,
        fontWeight: 650,
        color: text.text,
      },
      subtextStyle: {
        fontSize: 13,
        color: text.muted,
      },
    },
    tooltip: {
      trigger: isTimeView ? 'axis' : 'item',
      order: 'valueDesc',
      confine: true,
      appendToBody: true,
      backgroundColor: theme === 'dark' ? 'rgba(30, 30, 34, 0.96)' : 'rgba(255, 255, 255, 0.96)',
      borderColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)',
      textStyle: {
        color: text.text,
      },
      axisPointer: {
        type: 'cross',
        snap: true,
        lineStyle: {
          color: theme === 'dark' ? '#8e8e93' : '#86868b',
          width: 1,
        },
      },
      formatter: buildRawTooltip(viewMode, visibleCurves),
    },
    xAxis: {
      type: 'value',
      name: isTimeView ? '总时间 (s)' : '窗口 / 百分比 (%)',
      min: isTimeView ? 'dataMin' : 0,
      max: isTimeView ? 'dataMax' : 100,
      scale: isTimeView,
      axisLine: {
        lineStyle: {
          color: text.line,
        },
      },
      axisLabel: {
        color: text.axis,
        formatter: (value: number) => formatNumber(value, 0),
      },
      nameTextStyle: {
        color: text.muted,
        padding: [12, 0, 0, 0],
      },
      splitLine: {
        lineStyle: {
          color: text.split,
        },
      },
    },
    yAxis: {
      type: 'value',
      name: '亮度 (nits)',
      min: 0,
      scale: true,
      axisLabel: {
        color: text.axis,
      },
      axisLine: {
        lineStyle: {
          color: text.line,
        },
      },
      nameTextStyle: {
        color: text.muted,
        padding: [0, 0, 12, 0],
      },
      splitLine: {
        lineStyle: {
          color: text.split,
        },
      },
    },
    dataZoom: [
      {
        type: 'inside',
        throttle: 40,
      },
      {
        type: 'slider',
        height: 28,
        bottom: 24,
        borderColor: 'transparent',
        fillerColor: theme === 'dark' ? 'rgba(10, 132, 255, 0.28)' : 'rgba(0, 122, 255, 0.18)',
        handleStyle: {
          color: theme === 'dark' ? '#f5f5f7' : '#ffffff',
          borderColor: theme === 'dark' ? '#4a4a4f' : '#c7c7cc',
        },
        textStyle: {
          color: text.muted,
        },
      },
    ],
    series,
  };
};

const buildProcessedOption = ({
  visibleCurves,
  processedResult,
  theme,
  shouldAnimate,
}: ChartOptionInput): EChartsCoreOption => {
  const text = commonText(theme);
  const visibleIds = new Set(visibleCurves.map((curve) => curve.id));
  const visibleWindows = processedResult.windows.filter((window) =>
    processedResult.cleanedPoints.some((point) => point.windowLevel === window.windowLevel && visibleIds.has(point.curveId)),
  );
  const windowBoundaries = Array.from(
    new Set(visibleWindows.flatMap((window) => [window.alignedIndexStart, window.alignedIndexEnd])),
  ).sort((a, b) => a - b);
  const series = visibleCurves.map((curve, index) => {
    const data = visibleWindows.flatMap((window) => {
      const points = processedResult.cleanedPoints
        .filter((point) => point.curveId === curve.id && point.windowLevel === window.windowLevel)
        .sort((a, b) => a.alignedIndex - b.alignedIndex);

      if (points.length === 0) return [];

      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];

      return [
        {
          value: [firstPoint.alignedIndex, 0],
          curveName: curve.name,
        },
        ...points.map((point) => ({
          value: [point.alignedIndex, point.luminanceNits],
          point,
          curveName: curve.name,
        })),
        {
          value: [lastPoint.alignedIndex, 0],
          curveName: curve.name,
        },
        {
          value: [window.alignedIndexEnd, null],
          curveName: curve.name,
        },
      ];
    });

    return {
      name: curve.name,
      type: 'line',
      data,
      showSymbol: false,
      symbol: 'circle',
      symbolSize: 8,
      sampling: 'lttb',
      smooth: false,
      connectNulls: false,
      animationDuration: shouldAnimate ? 220 : 0,
      progressive: shouldAnimate ? 3000 : 0,
      lineStyle: {
        color: curve.color,
        width: 2.2,
        opacity: 0.92,
      },
      itemStyle: {
        color: curve.color,
      },
      emphasis: {
        focus: 'series',
        lineStyle: {
          width: 3.4,
        },
      },
      markArea:
        index === 0 && visibleWindows.length > 0
          ? {
              silent: true,
              itemStyle: {
                color: theme === 'dark' ? 'rgba(255, 255, 255, 0.034)' : 'rgba(0, 0, 0, 0.026)',
              },
              label: {
                show: true,
                position: 'insideTop',
                color: text.muted,
                fontSize: 11,
                fontWeight: 600,
                formatter: (params: { name?: string }) => params.name ?? '',
              },
              data: visibleWindows.map((window) => [
                { name: `${window.windowLevel}%`, xAxis: window.alignedIndexStart },
                { xAxis: window.alignedIndexEnd },
              ]),
            }
          : undefined,
      markLine:
        index === 0 && windowBoundaries.length > 0
          ? {
              silent: true,
              symbol: 'none',
              label: { show: false },
              lineStyle: {
                color: theme === 'dark' ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.12)',
                type: 'dashed',
                width: 1,
              },
              data: windowBoundaries.map((xAxis) => ({ xAxis })),
            }
          : undefined,
    };
  });

  return {
    backgroundColor: 'transparent',
    color: visibleCurves.map((curve) => curve.color),
    animation: shouldAnimate,
    grid: {
      left: 72,
      right: 28,
      top: 36,
      bottom: 86,
    },
    title: {
      show: processedResult.cleanedPoints.length === 0,
      text: '没有干净数据',
      subtext: '后处理没有得到足够稳定的窗口样本。',
      left: 'center',
      top: 'center',
      textStyle: {
        fontSize: 18,
        fontWeight: 650,
        color: text.text,
      },
      subtextStyle: {
        fontSize: 13,
        color: text.muted,
      },
    },
    tooltip: {
      trigger: 'axis',
      order: 'valueDesc',
      confine: true,
      appendToBody: true,
      backgroundColor: theme === 'dark' ? 'rgba(30, 30, 34, 0.96)' : 'rgba(255, 255, 255, 0.96)',
      borderColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)',
      textStyle: {
        color: text.text,
      },
      axisPointer: {
        type: 'cross',
        snap: true,
        lineStyle: {
          color: theme === 'dark' ? '#8e8e93' : '#86868b',
          width: 1,
        },
      },
      formatter: buildProcessedTooltip(visibleCurves, processedResult),
    },
    legend: {
      show: visibleCurves.length > 1,
      top: 8,
      right: 24,
      textStyle: {
        color: text.muted,
      },
      type: 'scroll',
    },
    xAxis: {
      type: 'value',
      name: processedResult.options.alignmentMode === 'normalized' ? '归一化位置' : '采样序号',
      min: 0,
      max:
        visibleWindows.length > 0
          ? Math.max(...visibleWindows.map((window) => window.alignedIndexEnd)) + processedResult.options.windowGapSlots
          : 'dataMax',
      scale: true,
      axisLine: {
        lineStyle: {
          color: text.line,
        },
      },
      axisLabel: {
        color: text.axis,
        formatter: (value: number) => formatNumber(value, 0),
      },
      nameTextStyle: {
        color: text.muted,
        padding: [12, 0, 0, 0],
      },
      splitLine: {
        lineStyle: {
          color: text.split,
        },
      },
    },
    yAxis: {
      type: 'value',
      name: '亮度 (nits)',
      min: 0,
      scale: true,
      axisLabel: {
        color: text.axis,
      },
      axisLine: {
        lineStyle: {
          color: text.line,
        },
      },
      nameTextStyle: {
        color: text.muted,
        padding: [0, 0, 12, 0],
      },
      splitLine: {
        lineStyle: {
          color: text.split,
        },
      },
    },
    dataZoom: [
      {
        type: 'inside',
        throttle: 40,
      },
      {
        type: 'slider',
        height: 28,
        bottom: 24,
        borderColor: 'transparent',
        fillerColor: theme === 'dark' ? 'rgba(10, 132, 255, 0.28)' : 'rgba(0, 122, 255, 0.18)',
        handleStyle: {
          color: theme === 'dark' ? '#f5f5f7' : '#ffffff',
          borderColor: theme === 'dark' ? '#4a4a4f' : '#c7c7cc',
        },
        textStyle: {
          color: text.muted,
        },
      },
    ],
    series,
  };
};

const buildChartOption = (input: ChartOptionInput): EChartsCoreOption =>
  input.processingMode === 'processed' ? buildProcessedOption(input) : buildRawOption(input);

const readYAxisExtent = (chart: echarts.ECharts | null): [number, number] | null => {
  const model = (chart as unknown as {
    getModel?: () => {
      getComponent?: (mainType: string, index?: number) => {
        axis?: {
          scale?: {
            getExtent?: () => [number, number];
          };
        };
      };
    };
  } | null)?.getModel?.();
  const extent = model?.getComponent?.('yAxis', 0)?.axis?.scale?.getExtent?.();
  if (!extent || extent.length !== 2 || !Number.isFinite(extent[0]) || !Number.isFinite(extent[1])) return null;
  return extent;
};

export const ChartPanel = forwardRef<ChartPanelHandle, ChartPanelProps>(
  ({ curves, viewMode, processingMode, processedResult, theme }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const visibleCurves = useMemo(() => curves.filter((curve) => curve.visible), [curves]);
    const shouldAnimate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const option = useMemo(
      () =>
        buildChartOption({
          visibleCurves,
          viewMode,
          processingMode,
          processedResult,
          theme,
          shouldAnimate,
        }),
      [processingMode, processedResult, shouldAnimate, theme, viewMode, visibleCurves],
    );

    useEffect(() => {
      if (!containerRef.current) return undefined;

      const chart = echarts.init(containerRef.current, theme === 'dark' ? 'dark' : undefined, {
        renderer: 'canvas',
      });
      chartRef.current = chart;

      const resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        chart.dispose();
        chartRef.current = null;
      };
    }, [theme]);

    useEffect(() => {
      chartRef.current?.setOption(option, true);
    }, [option]);

    useImperativeHandle(
      ref,
      () => ({
        exportPng: () =>
          chartRef.current?.getDataURL({
            type: 'png',
            pixelRatio: 2,
            backgroundColor: theme === 'dark' ? '#111114' : '#f5f5f7',
          }) ?? null,
        exportSvg: () => {
          const width = chartRef.current?.getWidth() ?? 1200;
          const height = chartRef.current?.getHeight() ?? 720;
          const staticOption = buildChartOption({
            visibleCurves,
            viewMode,
            processingMode,
            processedResult,
            theme,
            shouldAnimate: false,
          });
          const container = document.createElement('div');
          container.style.position = 'fixed';
          container.style.left = '-10000px';
          container.style.top = '-10000px';
          container.style.width = `${width}px`;
          container.style.height = `${height}px`;
          document.body.appendChild(container);

          const svgChart = echarts.init(container, theme === 'dark' ? 'dark' : undefined, {
            renderer: 'svg',
            width,
            height,
          });
          try {
            svgChart.setOption(staticOption, true);
            return svgChart.renderToSVGString({ useViewBox: true });
          } finally {
            svgChart.dispose();
            container.remove();
          }
        },
        getYAxisExtent: () => readYAxisExtent(chartRef.current),
      }),
      [option, processedResult, processingMode, theme, viewMode, visibleCurves],
    );

    return <div className="chart-canvas" ref={containerRef} aria-label="亮度图表" />;
  },
);

ChartPanel.displayName = 'ChartPanel';
