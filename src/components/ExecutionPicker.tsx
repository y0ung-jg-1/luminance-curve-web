import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Square, X } from 'lucide-react';
import type { DatabaseExecution, DatabaseFileExecutions } from '../lib/parseDatabase';

interface ExecutionPickerProps {
  open: boolean;
  files: DatabaseFileExecutions[];
  onCancel: () => void;
  onConfirm: (selections: SelectionEntry[]) => void;
}

export interface SelectionEntry {
  fileName: string;
  filePath?: string;
  execution: DatabaseExecution;
}

type HdrFilter = 'all' | 'hdr' | 'sdr';

const formatDateTime = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const productLabel = (execution: DatabaseExecution, fileName: string): string => {
  const product = execution.productName.trim();
  if (product) return product;
  return fileName.replace(/\.db$/i, '');
};

const modeTitle = (execution: DatabaseExecution): string => {
  const mode = execution.displayMode.trim() || '默认';
  return /模式$/u.test(mode) ? mode : `${mode}模式`;
};

const buildKey = (fileName: string, execId: number) => `${fileName}::${execId}`;

const litToneClass = (seconds: number): string => {
  const rounded = Math.round(seconds);
  if (rounded === 8) return 'lit-tone-short';
  if (rounded === 20) return 'lit-tone-mid';
  if (rounded === 40) return 'lit-tone-long';
  return 'lit-tone-other';
};

const durationBucket = (seconds: number): number => Math.max(0, Math.round(seconds));

interface FlatExecution {
  fileName: string;
  filePath?: string;
  execution: DatabaseExecution;
  key: string;
}

export const ExecutionPicker = ({ open, files, onCancel, onConfirm }: ExecutionPickerProps) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [modeFilter, setModeFilter] = useState<Set<string>>(() => new Set());
  const [hdrFilter, setHdrFilter] = useState<HdrFilter>('all');
  const [durationFilter, setDurationFilter] = useState<Set<number>>(() => new Set());

  const flat = useMemo<FlatExecution[]>(() => {
    const list: FlatExecution[] = [];
    for (const file of files) {
      for (const exec of file.executions) {
        list.push({
          fileName: file.fileName,
          filePath: file.filePath,
          execution: exec,
          key: buildKey(file.fileName, exec.executionId),
        });
      }
    }
    return list;
  }, [files]);

  const allKeys = useMemo(() => flat.map((f) => f.key), [flat]);

  const modeOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of flat) {
      const m = item.execution.displayMode;
      if (m && !seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  }, [flat]);

  const durationOptions = useMemo(() => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const item of flat) {
      const b = durationBucket(item.execution.litDurationSeconds);
      if (b > 0 && !seen.has(b)) {
        seen.add(b);
        out.push(b);
      }
    }
    out.sort((a, b) => a - b);
    return out;
  }, [flat]);

  const hasHdr = useMemo(() => flat.some((f) => f.execution.isHdr), [flat]);
  const hasSdr = useMemo(() => flat.some((f) => !f.execution.isHdr), [flat]);

  useEffect(() => {
    setSelected(new Set());
    setModeFilter(new Set());
    setHdrFilter('all');
    setDurationFilter(new Set());
  }, [open, allKeys]);

  const matches = (item: FlatExecution): boolean => {
    if (modeFilter.size > 0 && !modeFilter.has(item.execution.displayMode)) return false;
    if (hdrFilter === 'hdr' && !item.execution.isHdr) return false;
    if (hdrFilter === 'sdr' && item.execution.isHdr) return false;
    if (durationFilter.size > 0 && !durationFilter.has(durationBucket(item.execution.litDurationSeconds))) {
      return false;
    }
    return true;
  };

  const visibleByFile = useMemo(() => {
    const groups = new Map<string, { fileName: string; filePath?: string; items: FlatExecution[] }>();
    for (const item of flat) {
      if (!matches(item)) continue;
      const existing = groups.get(item.fileName);
      if (existing) existing.items.push(item);
      else groups.set(item.fileName, { fileName: item.fileName, filePath: item.filePath, items: [item] });
    }
    return Array.from(groups.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, modeFilter, hdrFilter, durationFilter]);

  const visibleKeys = useMemo(
    () => visibleByFile.flatMap((g) => g.items.map((i) => i.key)),
    [visibleByFile],
  );

  if (!open) return null;

  const totalCount = allKeys.length;
  const visibleCount = visibleKeys.length;
  const selectedVisibleCount = visibleKeys.reduce((acc, k) => (selected.has(k) ? acc + 1 : acc), 0);
  const allVisibleSelected = visibleCount > 0 && selectedVisibleCount === visibleCount;
  const filtersActive =
    modeFilter.size > 0 || hdrFilter !== 'all' || durationFilter.size > 0;

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const k of visibleKeys) next.delete(k);
      } else {
        for (const k of visibleKeys) next.add(k);
      }
      return next;
    });
  };

  const toggleMode = (mode: string) => {
    setModeFilter((current) => {
      const next = new Set(current);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  };

  const toggleDuration = (bucket: number) => {
    setDurationFilter((current) => {
      const next = new Set(current);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };

  const clearFilters = () => {
    setModeFilter(new Set());
    setHdrFilter('all');
    setDurationFilter(new Set());
  };

  const handleConfirm = () => {
    const entries: SelectionEntry[] = [];
    for (const item of flat) {
      if (selected.has(item.key)) {
        entries.push({ fileName: item.fileName, filePath: item.filePath, execution: item.execution });
      }
    }
    onConfirm(entries);
  };

  const showFilters = totalCount > 0 && (modeOptions.length > 1 || durationOptions.length > 1 || (hasHdr && hasSdr));

  return (
    <div className="picker-overlay" role="dialog" aria-modal="true" aria-label="选择数据库测试执行">
      <div className="picker-card">
        <div className="picker-header">
          <div>
            <span className="eyebrow">DATABASE</span>
            <h2>选择要导入的亮度测试执行</h2>
            <p className="picker-sub">
              共 {totalCount} 条；当前显示 {visibleCount} 条；已勾选 {selected.size} 条
            </p>
          </div>
          <button className="icon-button subtle" type="button" onClick={onCancel} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {showFilters ? (
          <div className="picker-filters">
            {modeOptions.length > 1 ? (
              <div className="picker-filter-row">
                <span className="picker-filter-label">模式</span>
                <div className="picker-chip-row">
                  {modeOptions.map((mode) => {
                    const active = modeFilter.has(mode);
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`picker-chip ${active ? 'active' : ''}`}
                        onClick={() => toggleMode(mode)}
                        aria-pressed={active}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {hasHdr && hasSdr ? (
              <div className="picker-filter-row">
                <span className="picker-filter-label">HDR</span>
                <div className="picker-chip-row">
                  {([
                    { value: 'all' as HdrFilter, label: '全部' },
                    { value: 'hdr' as HdrFilter, label: 'HDR' },
                    { value: 'sdr' as HdrFilter, label: 'SDR' },
                  ]).map((opt) => {
                    const active = hdrFilter === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`picker-chip ${active ? 'active' : ''}`}
                        onClick={() => setHdrFilter(opt.value)}
                        aria-pressed={active}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {durationOptions.length > 1 ? (
              <div className="picker-filter-row">
                <span className="picker-filter-label">时长</span>
                <div className="picker-chip-row">
                  {durationOptions.map((bucket) => {
                    const active = durationFilter.has(bucket);
                    return (
                      <button
                        key={bucket}
                        type="button"
                        className={`picker-chip ${active ? 'active' : ''}`}
                        onClick={() => toggleDuration(bucket)}
                        aria-pressed={active}
                      >
                        {bucket} s
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="picker-toolbar">
          <button
            className="button secondary"
            type="button"
            onClick={handleSelectAllVisible}
            disabled={visibleCount === 0}
          >
            {allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            {allVisibleSelected ? '取消全选' : '全选'}
            {filtersActive ? <span className="picker-toolbar-hint">（{visibleCount}）</span> : null}
          </button>
          {filtersActive ? (
            <button className="button ghost" type="button" onClick={clearFilters}>
              清除筛选
            </button>
          ) : null}
        </div>

        <div className="picker-body">
          {totalCount === 0 ? (
            <p className="picker-empty">该数据库中未找到 “亮度测试” 执行记录。</p>
          ) : visibleCount === 0 ? (
            <p className="picker-empty">没有匹配当前筛选的执行记录。</p>
          ) : (
            visibleByFile.map((file) => (
              <div key={file.fileName} className="picker-group">
                <div className="picker-group-title">{file.fileName}</div>
                <ul className="picker-list">
                  {file.items.map(({ execution: exec, key }) => {
                    const checked = selected.has(key);
                    const seconds = Math.round(exec.litDurationSeconds);
                    const metaParts = [
                      productLabel(exec, file.fileName),
                      exec.createdAt ? formatDateTime(exec.createdAt) : null,
                    ].filter(Boolean) as string[];
                    return (
                      <li key={key}>
                        <label className={`picker-row ${checked ? 'active' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggle(key)} />
                          <div className="picker-row-main">
                            <div className="picker-row-headline">
                              <span className={`picker-tag ${exec.isHdr ? 'tag-hdr' : 'tag-sdr'}`}>
                                {exec.isHdr ? 'HDR' : 'SDR'}
                              </span>
                              <strong className="picker-row-title">{modeTitle(exec)}</strong>
                            </div>
                            <span className="picker-row-meta">{metaParts.join(' · ')}</span>
                          </div>
                          {seconds > 0 ? (
                            <span className={`lit-badge ${litToneClass(seconds)}`}>{seconds} s</span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="picker-footer">
          <button className="button secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            onClick={handleConfirm}
            disabled={selected.size === 0}
          >
            导入 {selected.size} 条
          </button>
        </div>
      </div>
    </div>
  );
};
