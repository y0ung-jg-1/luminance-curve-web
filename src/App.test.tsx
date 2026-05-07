import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';

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

vi.mock('./lib/download', () => ({
  downloadBlob: vi.fn(),
  downloadDataUrl: vi.fn(),
  downloadTextFile: vi.fn(),
}));

import { App } from './App';

const createFile = () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [null, 0, 1, 2, 3],
    [0, 1.1, 0.1, 1, 101.3],
    [1, 1.6, 0.6, 1, 102.8],
    [2, 2.1, 1.1, 2, 0],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'page_1');
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([data], 'fixture.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

const createProcessableFile = () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [null, 0, 1, 2, 3],
    ...[0, 0.5, 1, 1.5, 2, 2.5, 3].map((cycleSeconds, index) => [
      index,
      10 + cycleSeconds,
      cycleSeconds,
      1,
      100 + index,
    ]),
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'page_1');
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([data], 'cleanable.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

describe('App', () => {
  it('renders an empty web import state', () => {
    render(<App />);

    expect(screen.getByText('把 Excel 亮度数据拖到这里')).toBeInTheDocument();
    expect(screen.getByText('等待导入')).toBeInTheDocument();
    expect(screen.getByText('Excel 文件只在浏览器本地解析，不上传到服务器。')).toBeInTheDocument();
    expect(screen.getByText(/窗口顺序：1% -> 2% -> 3% -> 5%/)).toBeInTheDocument();
  });

  it('imports workbook from file input and switches view modes', async () => {
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

  it('exports AI layered SVG from post-processed samples', async () => {
    const { downloadTextFile } = await import('./lib/download');
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText('选择 Excel 文件'), createProcessableFile());
    await screen.findByText('cleanable.xlsx');
    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('menuitem', { name: /AI 分层 SVG/i }));

    expect(downloadTextFile).toHaveBeenCalledWith(
      expect.stringContaining('inkscape:label="1%"'),
      expect.stringMatching(/cleanable.*AI-layered\.svg/i),
      'image/svg+xml;charset=utf-8',
    );
  });
});
