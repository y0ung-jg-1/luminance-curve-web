import * as XLSX from 'xlsx';
import type { LuminancePoint, ParsedWorkbook } from '../types';
import { summarizeLuminancePoints } from './luminanceStats';

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const parseWorkbook = (input: ArrayBuffer | Uint8Array, name: string, workbookPath?: string): ParsedWorkbook => {
  const workbook = XLSX.read(input, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error(`${name} 没有可读取的工作表。`);
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  });

  const points: LuminancePoint[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const elapsedSeconds = toNumber(row[1]);
    const cycleSeconds = toNumber(row[2]);
    const levelPercent = toNumber(row[3]);
    const luminanceNits = toNumber(row[4]);

    if (
      elapsedSeconds === null ||
      cycleSeconds === null ||
      levelPercent === null ||
      luminanceNits === null
    ) {
      continue;
    }

    points.push({
      rowNumber: rowIndex + 1,
      elapsedSeconds,
      cycleSeconds,
      levelPercent,
      luminanceNits,
    });
  }

  if (points.length === 0) {
    throw new Error(`${name} 没有找到有效的 B-E 列亮度数据。`);
  }

  return {
    name,
    path: workbookPath,
    sheetName,
    points,
    stats: summarizeLuminancePoints(points),
  };
};
