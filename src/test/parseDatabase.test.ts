import { describe, expect, beforeAll, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import {
  __setSqlJsForTesting,
  buildCurveFromExecution,
  listLuminanceExecutions,
} from '../lib/parseDatabase';

const wasmPath = resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');

const buildFixtureBuffer = async (): Promise<Uint8Array> => {
  const wasmBuffer = readFileSync(wasmPath);
  const wasmArrayBuffer = wasmBuffer.buffer.slice(
    wasmBuffer.byteOffset,
    wasmBuffer.byteOffset + wasmBuffer.byteLength,
  ) as ArrayBuffer;
  const sqlJs = await initSqlJs({ wasmBinary: wasmArrayBuffer });
  const db = new sqlJs.Database();
  db.run(`
    CREATE TABLE products (
      product_id INTEGER PRIMARY KEY,
      product_name TEXT,
      product_version TEXT
    );
    CREATE TABLE test_items (
      item_id INTEGER PRIMARY KEY,
      item_name TEXT
    );
    CREATE TABLE test_executions (
      execution_id INTEGER PRIMARY KEY,
      project_id INTEGER,
      item_id INTEGER,
      product_id INTEGER,
      tester_id INTEGER,
      model TEXT,
      status TEXT,
      notes TEXT,
      created_at INTEGER
    );
    CREATE TABLE test_datas (
      data_id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER,
      param_name TEXT,
      data TEXT
    );
    INSERT INTO products VALUES (1, '85XR90 二代', '1.0');
    INSERT INTO test_items VALUES (1, 'Battery Test');
    INSERT INTO test_items VALUES (7, '亮度测试');
    INSERT INTO test_executions VALUES (101, 1, 1, 1, NULL, 'Battery', 'completed', '', 1700000000000);
    INSERT INTO test_executions VALUES (102, 1, 7, 1, NULL, 'HDR 标准模式', 'completed', '', 1700000001000);
    INSERT INTO test_executions VALUES (103, 1, 7, 1, NULL, '电影模式', 'completed', '', 1700000002000);
  `);

  const time = [0.1, 0.2, 0.3, 0.4, 0.5];
  const windowTime = [0.1, 0.2, 0.3, 0.4, 0.5];
  const windowSize = [1, 2, 3, 5, 10];
  const brightness = [10, 20, 30, 40, 50];

  const insert = db.prepare('INSERT INTO test_datas (execution_id, param_name, data) VALUES (?, ?, ?)');
  insert.run([102, 'time', JSON.stringify(time)]);
  insert.run([102, 'window_time', JSON.stringify(windowTime)]);
  insert.run([102, 'window_size', JSON.stringify(windowSize)]);
  insert.run([102, 'brightness_data', JSON.stringify(brightness)]);
  insert.run([103, 'time', JSON.stringify(time)]);
  insert.run([103, 'window_time', JSON.stringify(windowTime)]);
  insert.run([103, 'window_size', JSON.stringify(windowSize)]);
  insert.run([103, 'brightness_data', JSON.stringify([5, 15, 25, 35, 45])]);
  insert.free();

  const exported = db.export();
  db.close();
  __setSqlJsForTesting(sqlJs);
  return exported;
};

describe('parseDatabase', () => {
  let buffer: Uint8Array;

  beforeAll(async () => {
    buffer = await buildFixtureBuffer();
  });

  it('lists only luminance executions and ignores other test items', async () => {
    const result = await listLuminanceExecutions(buffer, 'fixture.db');
    expect(result.executions).toHaveLength(2);
    expect(result.executions.map((e) => e.executionId)).toEqual([102, 103]);
    expect(result.executions[0].productName).toBe('85XR90 二代');
    expect(result.executions[0].model).toBe('HDR 标准模式');
  });

  it('builds a curve whose points preserve array order', async () => {
    const list = await listLuminanceExecutions(buffer, 'fixture.db');
    const exec = list.executions[0];
    const curve = await buildCurveFromExecution(buffer, exec, { fileName: 'fixture.db' });

    expect(curve.name).toBe('85XR90 二代 HDR 标准模式');
    expect(curve.points).toHaveLength(5);
    expect(curve.points.map((p) => p.luminanceNits)).toEqual([10, 20, 30, 40, 50]);
    expect(curve.points.map((p) => p.levelPercent)).toEqual([1, 2, 3, 5, 10]);
    expect(curve.points.map((p) => p.elapsedSeconds)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('computes stats matching hand calculation', async () => {
    const list = await listLuminanceExecutions(buffer, 'fixture.db');
    const exec = list.executions[0];
    const curve = await buildCurveFromExecution(buffer, exec, { fileName: 'fixture.db' });

    expect(curve.stats.pointCount).toBe(5);
    expect(curve.stats.minLuminance).toBe(10);
    expect(curve.stats.maxLuminance).toBe(50);
    expect(curve.stats.averageLuminance).toBe(30);
    expect(curve.stats.minElapsedSeconds).toBeCloseTo(0.1);
    expect(curve.stats.maxElapsedSeconds).toBeCloseTo(0.5);
    expect(curve.stats.levels).toEqual([1, 2, 3, 5, 10]);
  });
});
