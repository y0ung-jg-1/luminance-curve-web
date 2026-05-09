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

const formatDateTime = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const labelOf = (execution: DatabaseExecution, fileName: string): string => {
  const product = execution.productName.trim();
  const model = execution.model.trim();
  if (product && model) return `${product} ${model}`;
  if (product) return product;
  if (model) return model;
  return `${fileName} #${execution.executionId}`;
};

const buildKey = (fileName: string, execId: number) => `${fileName}::${execId}`;

export const ExecutionPicker = ({ open, files, onCancel, onConfirm }: ExecutionPickerProps) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const file of files) {
      for (const exec of file.executions) {
        keys.push(buildKey(file.fileName, exec.executionId));
      }
    }
    return keys;
  }, [files]);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(allKeys));
  }, [open, allKeys]);

  if (!open) return null;

  const totalCount = allKeys.length;
  const allSelected = totalCount > 0 && selected.size === totalCount;

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  };

  const handleConfirm = () => {
    const entries: SelectionEntry[] = [];
    for (const file of files) {
      for (const exec of file.executions) {
        if (selected.has(buildKey(file.fileName, exec.executionId))) {
          entries.push({ fileName: file.fileName, filePath: file.filePath, execution: exec });
        }
      }
    }
    onConfirm(entries);
  };

  return (
    <div className="picker-overlay" role="dialog" aria-modal="true" aria-label="选择数据库测试执行">
      <div className="picker-card">
        <div className="picker-header">
          <div>
            <span className="eyebrow">DATABASE</span>
            <h2>选择要导入的亮度测试执行</h2>
            <p className="picker-sub">
              共 {totalCount} 条亮度测试执行；已勾选 {selected.size} 条
            </p>
          </div>
          <button className="icon-button subtle" type="button" onClick={onCancel} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="picker-toolbar">
          <button className="button secondary" type="button" onClick={handleSelectAll} disabled={totalCount === 0}>
            {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            {allSelected ? '取消全选' : '全选'}
          </button>
        </div>

        <div className="picker-body">
          {files.length === 0 || totalCount === 0 ? (
            <p className="picker-empty">该数据库中未找到 “亮度测试” 执行记录。</p>
          ) : (
            files.map((file) => (
              <div key={file.fileName} className="picker-group">
                <div className="picker-group-title">{file.fileName}</div>
                <ul className="picker-list">
                  {file.executions.map((exec) => {
                    const key = buildKey(file.fileName, exec.executionId);
                    const checked = selected.has(key);
                    return (
                      <li key={key}>
                        <label className={`picker-row ${checked ? 'active' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggle(key)} />
                          <div className="picker-row-main">
                            <strong>{labelOf(exec, file.fileName)}</strong>
                            <span className="picker-row-meta">
                              #{exec.executionId}
                              {exec.status ? ` · ${exec.status}` : ''}
                              {exec.createdAt ? ` · ${formatDateTime(exec.createdAt)}` : ''}
                            </span>
                          </div>
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
