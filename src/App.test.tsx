import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LuminanceApi } from './types';

vi.mock('./components/ChartPanel', async () => {
  const React = await import('react');
  return {
    ChartPanel: React.forwardRef(({ viewMode, processingMode }: { viewMode: string; processingMode: string }, ref) => {
      React.useImperativeHandle(ref, () => ({
        exportPng: () => 'data:image/png;base64,AAAA',
        exportSvg: () => '<svg viewBox="0 0 100 100"></svg>',
        getYAxisExtent: () => [0, 2500],
      }));
      return <div data-testid="chart-panel">{`${processingMode}:${viewMode}`}</div>;
    }),
  };
});

vi.mock('./components/LuminanceScene3D', async () => {
  const React = await import('react');
  return {
    LuminanceScene3D: React.forwardRef((_props: Record<string, never>, ref) => {
      React.useImperativeHandle(ref, () => ({
        exportPng: () => 'data:image/png;base64,THREED',
      }));
      return <div data-testid="scene3d-panel">3D scene</div>;
    }),
  };
});

vi.mock('./lib/download', () => ({
  downloadBlob: vi.fn(),
  downloadDataUrl: vi.fn(),
  downloadTextFile: vi.fn(),
}));

import { App } from './App';

const createWorkbook = (processable = false) => {
  const rows = processable
    ? [
        [null, 0, 1, 2, 3],
        ...[0, 0.5, 1, 1.5, 2, 2.5, 3].map((cycleSeconds, index) => [
          index,
          10 + cycleSeconds,
          cycleSeconds,
          1,
          100 + index,
        ]),
      ]
    : [
        [null, 0, 1, 2, 3],
        [0, 1.1, 0.1, 1, 101.3],
        [1, 1.6, 0.6, 1, 102.8],
        [2, 2.1, 1.1, 2, 0],
      ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'page_1');
  return workbook;
};

const createFile = (name = 'fixture.xlsx', processable = false) => {
  const data = XLSX.write(createWorkbook(processable), { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([data], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

const createWorkbookBase64 = (processable = false) => {
  return XLSX.write(createWorkbook(processable), { bookType: 'xlsx', type: 'base64' }) as string;
};

const setupElectronApi = (selectExcelFiles: LuminanceApi['selectExcelFiles'] = vi.fn().mockResolvedValue([])) => {
  window.luminanceAPI = {
    selectExcelFiles,
    selectDatabaseFiles: vi.fn().mockResolvedValue([]),
    saveChartImage: vi.fn().mockResolvedValue('C:\\chart.png'),
    saveChartSvg: vi.fn().mockResolvedValue('C:\\chart.svg'),
    saveLayeredSvgs: vi.fn().mockResolvedValue(['C:\\ai-layered.svg']),
    saveCleanWorkbook: vi.fn().mockResolvedValue('C:\\clean.xlsx'),
  };
};

describe('App', () => {
  beforeEach(() => {
    delete window.luminanceAPI;
    vi.clearAllMocks();
  });

  it('renders an empty dual-runtime import state', () => {
    render(<App />);

    expect(screen.getByText('把 Excel 或数据库亮度数据拖到这里')).toBeInTheDocument();
    expect(screen.getByText('等待导入')).toBeInTheDocument();
    expect(screen.getByText('Excel 文件只在本机解析，不上传到服务器。')).toBeInTheDocument();
    expect(screen.getByText(/窗口顺序：1% -> 2% -> 3% -> 5%/)).toBeInTheDocument();
  });

  it('imports workbook from browser file input and switches view modes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText('选择 Excel 文件'), createFile());

    expect(await screen.findByText('fixture.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/3 点/)).toBeInTheDocument();
    expect(screen.getByTestId('chart-panel')).toHaveTextContent('raw:time');

    await user.click(screen.getByRole('button', { name: /百分比分布/i }));
    expect(screen.getByTestId('chart-panel')).toHaveTextContent('raw:percent');

    await user.click(screen.getByRole('button', { name: /后处理/i }));
    expect(screen.getByTestId('chart-panel')).toHaveTextContent('processed:percent');
  });

  it('switches to the 3D scene and routes PNG export to the WebGL snapshot', async () => {
    const { downloadDataUrl } = await import('./lib/download');
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('button', { name: /3D/i })).toBeDisabled();

    await user.upload(screen.getByLabelText('选择 Excel 文件'), createFile('cleanable.xlsx', true));
    await screen.findByText('cleanable.xlsx');

    await user.click(screen.getByRole('button', { name: /3D/i }));

    expect(screen.getByTestId('scene3d-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /PNG 图表/i }));

    expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,THREED', 'luminance-curve-3d.png');
  });

  it('downloads browser exports for PNG, SVG, AI layered SVG, and clean Excel', async () => {
    const { downloadBlob, downloadDataUrl, downloadTextFile } = await import('./lib/download');
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText('选择 Excel 文件'), createFile('cleanable.xlsx', true));
    await screen.findByText('cleanable.xlsx');

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /PNG 图表/i }));
    expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,AAAA', 'luminance-curve-raw-time.png');

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /SVG 图表/i }));
    expect(downloadTextFile).toHaveBeenCalledWith(
      '<svg viewBox="0 0 100 100"></svg>',
      'luminance-curve-raw-time.svg',
      'image/svg+xml;charset=utf-8',
    );

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /AI 分层 SVG/i }));
    expect(downloadTextFile).toHaveBeenCalledWith(
      expect.stringContaining('inkscape:label="1%"'),
      expect.stringMatching(/cleanable.*AI-layered\.svg/i),
      'image/svg+xml;charset=utf-8',
    );

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /干净 Excel/i }));
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'clean-luminance-data.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('imports workbook from the Electron file picker', async () => {
    const user = userEvent.setup();
    setupElectronApi(
      vi.fn().mockResolvedValue([
        {
          name: 'fixture.xlsx',
          path: 'C:\\fixture.xlsx',
          data: createWorkbookBase64(),
        },
      ]),
    );

    render(<App />);

    await user.click(screen.getAllByRole('button', { name: /导入 Excel/i })[0]);

    expect(window.luminanceAPI!.selectExcelFiles).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('fixture.xlsx')).toBeInTheDocument();
    expect(screen.getByTestId('chart-panel')).toHaveTextContent('raw:time');
  });

  it('uses Electron save APIs for PNG, SVG, AI layered SVG, and clean Excel', async () => {
    const user = userEvent.setup();
    setupElectronApi(
      vi.fn().mockResolvedValue([
        {
          name: 'cleanable.xlsx',
          data: createWorkbookBase64(true),
        },
      ]),
    );

    render(<App />);

    await user.click(screen.getAllByRole('button', { name: /导入 Excel/i })[0]);
    await screen.findByText('cleanable.xlsx');

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /PNG 图表/i }));
    expect(window.luminanceAPI!.saveChartImage).toHaveBeenCalledWith('data:image/png;base64,AAAA');

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /SVG 图表/i }));
    expect(window.luminanceAPI!.saveChartSvg).toHaveBeenCalledWith('<svg viewBox="0 0 100 100"></svg>');

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /AI 分层 SVG/i }));
    expect(window.luminanceAPI!.saveLayeredSvgs).toHaveBeenCalledWith([
      expect.objectContaining({
        fileName: expect.stringMatching(/cleanable.*AI-layered\.svg/i),
        svg: expect.stringContaining('inkscape:label="1%"'),
      }),
    ]);

    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /干净 Excel/i }));
    expect(window.luminanceAPI!.saveCleanWorkbook).toHaveBeenCalledWith(expect.any(String));
  });
});
