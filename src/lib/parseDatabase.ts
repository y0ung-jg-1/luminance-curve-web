import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { LuminancePoint, ParsedWorkbook } from '../types';
import { summarizeLuminancePoints } from './luminanceStats';

export interface DatabaseExecution {
  executionId: number;
  productName: string;
  productVersion: string;
  model: string;
  status: string;
  notes: string;
  createdAt: number;
  pointCount: number;
  litDurationSeconds: number;
}

export interface DatabaseFileExecutions {
  fileName: string;
  filePath?: string;
  executions: DatabaseExecution[];
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export const loadSqlJs = (): Promise<SqlJsStatic> => {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: () => sqlWasmUrl,
    });
  }
  return sqlJsPromise;
};

export const __setSqlJsForTesting = (instance: SqlJsStatic | null): void => {
  sqlJsPromise = instance ? Promise.resolve(instance) : null;
};

const luminanceItemQuery = `
  SELECT item_id FROM test_items
  WHERE item_name = '亮度测试' OR item_name LIKE '%亮度%'
`;

const executionListQuery = `
  SELECT
    e.execution_id   AS execution_id,
    e.model          AS model,
    e.status         AS status,
    e.notes          AS notes,
    e.created_at     AS created_at,
    p.product_name   AS product_name,
    p.product_version AS product_version,
    (SELECT length(td.data)
       FROM test_datas td
       WHERE td.execution_id = e.execution_id
         AND td.param_name = 'brightness_data') AS brightness_size,
    (SELECT td.data
       FROM test_datas td
       WHERE td.execution_id = e.execution_id
         AND td.param_name = 'window_time') AS window_time_data
  FROM test_executions e
  LEFT JOIN products p ON e.product_id = p.product_id
  WHERE e.item_id = ?
  ORDER BY e.execution_id
`;

const executionDataQuery = `
  SELECT param_name, data
  FROM test_datas
  WHERE execution_id = ?
    AND param_name IN ('time', 'window_time', 'window_size', 'brightness_data')
`;

const stringValue = (value: SqlValue): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
};

const numberValue = (value: SqlValue): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const parseFloatArray = (raw: SqlValue): number[] => {
  if (raw === null || raw === undefined) return [];
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => (typeof value === 'number' ? value : Number(value))).filter((value) => Number.isFinite(value));
  } catch {
    return [];
  }
};

export const openDatabase = async (buffer: Uint8Array): Promise<Database> => {
  const sqlJs = await loadSqlJs();
  return new sqlJs.Database(buffer);
};

const maxFiniteOrZero = (values: number[]): number => {
  let max = 0;
  for (const value of values) {
    if (value > max) max = value;
  }
  return max;
};

const findLuminanceItemIds = (db: Database): number[] => {
  const result = db.exec(luminanceItemQuery);
  if (result.length === 0) return [];
  return result[0].values.map((row) => numberValue(row[0]));
};

export const listLuminanceExecutions = async (
  buffer: Uint8Array,
  fileName: string,
  filePath?: string,
): Promise<DatabaseFileExecutions> => {
  const db = await openDatabase(buffer);
  try {
    const itemIds = findLuminanceItemIds(db);
    if (itemIds.length === 0) {
      return { fileName, filePath, executions: [] };
    }

    const executions: DatabaseExecution[] = [];
    for (const itemId of itemIds) {
      const result = db.exec(executionListQuery, [itemId]);
      if (result.length === 0) continue;
      const { columns, values } = result[0];
      const idx = (col: string) => columns.indexOf(col);
      for (const row of values) {
        const windowTime = parseFloatArray(row[idx('window_time_data')] ?? null);
        executions.push({
          executionId: numberValue(row[idx('execution_id')]),
          productName: stringValue(row[idx('product_name')]),
          productVersion: stringValue(row[idx('product_version')]),
          model: stringValue(row[idx('model')]),
          status: stringValue(row[idx('status')]),
          notes: stringValue(row[idx('notes')]),
          createdAt: numberValue(row[idx('created_at')]),
          pointCount: numberValue(row[idx('brightness_size')]),
          litDurationSeconds: maxFiniteOrZero(windowTime),
        });
      }
    }

    executions.sort((a, b) => a.executionId - b.executionId);
    return { fileName, filePath, executions };
  } finally {
    db.close();
  }
};

const buildPoints = (
  time: number[],
  windowTime: number[],
  windowSize: number[],
  brightness: number[],
): LuminancePoint[] => {
  const length = Math.min(time.length, windowTime.length, windowSize.length, brightness.length);
  const points: LuminancePoint[] = [];
  for (let index = 0; index < length; index += 1) {
    const elapsed = time[index];
    const cycle = windowTime[index];
    const level = windowSize[index];
    const nits = brightness[index];
    if (
      !Number.isFinite(elapsed) ||
      !Number.isFinite(cycle) ||
      !Number.isFinite(level) ||
      !Number.isFinite(nits)
    ) {
      continue;
    }
    points.push({
      rowNumber: index + 1,
      elapsedSeconds: elapsed,
      cycleSeconds: cycle,
      levelPercent: level,
      luminanceNits: nits,
    });
  }
  return points;
};

const buildCurveName = (execution: DatabaseExecution, fileName: string): string => {
  const parts = [execution.productName, execution.model].map((part) => part.trim()).filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  const stem = fileName.replace(/\.db$/i, '');
  return `${stem} #${execution.executionId}`;
};

export interface BuildCurveOptions {
  fileName: string;
  filePath?: string;
}

export const buildCurveFromExecution = async (
  buffer: Uint8Array,
  execution: DatabaseExecution,
  options: BuildCurveOptions,
): Promise<ParsedWorkbook> => {
  const db = await openDatabase(buffer);
  try {
    const result = db.exec(executionDataQuery, [execution.executionId]);
    if (result.length === 0) {
      throw new Error(`执行 #${execution.executionId} 没有可读取的亮度数据。`);
    }
    const { values } = result[0];
    const dataMap = new Map<string, SqlValue>();
    for (const row of values) {
      const name = stringValue(row[0]);
      dataMap.set(name, row[1]);
    }

    const time = parseFloatArray(dataMap.get('time') ?? null);
    const windowTime = parseFloatArray(dataMap.get('window_time') ?? null);
    const windowSize = parseFloatArray(dataMap.get('window_size') ?? null);
    const brightness = parseFloatArray(dataMap.get('brightness_data') ?? null);

    if (brightness.length === 0) {
      throw new Error(`执行 #${execution.executionId} 缺少 brightness_data 字段，可能未完成。`);
    }
    if (time.length === 0) {
      throw new Error(`执行 #${execution.executionId} 缺少 time 字段。`);
    }

    const points = buildPoints(
      time,
      windowTime.length > 0 ? windowTime : time,
      windowSize,
      brightness,
    );

    if (points.length === 0) {
      throw new Error(`执行 #${execution.executionId} 没有有效的数据点。`);
    }

    return {
      name: buildCurveName(execution, options.fileName),
      path: options.filePath ? `${options.filePath}#execution=${execution.executionId}` : undefined,
      sheetName: `exec-${execution.executionId}`,
      points,
      stats: summarizeLuminancePoints(points),
    };
  } finally {
    db.close();
  }
};
