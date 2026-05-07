import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseWorkbook } from './parseWorkbook';

const makeWorkbook = () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [null, 0, 1, 2, 3],
    [0, 1.1, 0.1, 1, 101.3],
    [1, '1.6', '0.6', '1', '102.8'],
    [2, 2.1, 1.1, 2, 0],
    [3, null, null, null, null],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'page_1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};

describe('parseWorkbook', () => {
  it('parses B-E columns and keeps zero luminance samples', () => {
    const parsed = parseWorkbook(makeWorkbook(), 'fixture.xlsx');

    expect(parsed.sheetName).toBe('page_1');
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[0]).toMatchObject({
      rowNumber: 2,
      elapsedSeconds: 1.1,
      cycleSeconds: 0.1,
      levelPercent: 1,
      luminanceNits: 101.3,
    });
    expect(parsed.points[2].luminanceNits).toBe(0);
    expect(parsed.stats.maxLuminance).toBe(102.8);
    expect(parsed.stats.levels).toEqual([1, 2]);
  });
});
