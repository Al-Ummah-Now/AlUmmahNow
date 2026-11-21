/**
 * The Cloudflare billing model (COST-GAPS) reconciled against the owner's invoice for
 * 2026-10-23 → 2026-11-21: total $262.51 after the account's included usage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billLine, billMonth, CF_METERS, type CfMeterKey } from '../src/cost-billing.ts';

/** Total usage per invoice line, as the invoice printed it (CPU at the precision its $37.52 implies). */
const INVOICE_USAGE: Partial<Record<CfMeterKey, number>> = {
  d1_rows_written: 110.46e6,
  r2_class_b: 160.98e6,
  logs_events: 102.75e6,
  workers_cpu_ms: 1.906e9,
  r2_class_a: 6.62e6,
  workers_requests: 60.73e6,
  kv_writes: 1.62e6,
  kv_lists: 1.69e6,
  queues_operations: 9.73e6,
  logpush_requests: 42.35e6,
  do_storage_writes: 1.64e6,
  do_storage_reads: 4.01e6,
  do_requests: 3.96e6,
  r2_storage_gb: 11.75,
  kv_deletes: 0.18792e6,
  kv_storage_gb: 0.06,
  d1_storage_gb: 1,
  browser_hours: 1.36,
  kv_reads: 5.58e6,
  do_gb_seconds: 44.06e3,
  d1_rows_read: 19.39e9,
};

const INVOICE_LINES: Partial<Record<CfMeterKey, number>> = {
  d1_rows_written: 61,
  r2_class_b: 54.36,
  logs_events: 49.8,
  workers_cpu_ms: 37.52,
  r2_class_a: 27,
  workers_requests: 15.3,
  kv_writes: 5,
  kv_lists: 5,
  queues_operations: 3.6,
  logpush_requests: 1.65,
  do_storage_writes: 1,
  do_storage_reads: 0.8,
  do_requests: 0.45,
  r2_storage_gb: 0.03,
};

test('the invoice of 2026-10-23 → 11-21 reconciles line by line and to $262.51', () => {
  const bill = billMonth(INVOICE_USAGE);
  for (const line of bill.lines) assert.equal(line.cost, INVOICE_LINES[line.key] ?? 0, `${line.key}`);
  assert.equal(bill.total, 262.51);
  // At list price, before allowances and rounding, the same usage costs more
  assert.ok(bill.listTotal > bill.total);
});

test('a meter is billed in whole units once past its allowance', () => {
  assert.equal(billLine('kv_writes', 1e6).cost, 0);
  assert.equal(billLine('kv_writes', 1e6 + 1).cost, 5);
  assert.equal(billLine('r2_class_a', 6.62e6).billable, 5.62e6);
  // Float noise right at a step is not billed as one more unit
  assert.equal(billLine('d1_rows_written', 50e6 + 0.1e6 + 0.2e6 - 0.3e6 + 1e6).cost, 1);
});

test('meters Cloudflare does not bill cost nothing, and bad input counts as no usage', () => {
  assert.equal(CF_METERS.analytics_engine_writes.billed, false);
  assert.equal(billLine('analytics_engine_writes', 500e6).cost, 0);
  assert.equal(billLine('workers_requests', Number.NaN).cost, 0);
  assert.equal(billLine('workers_requests', -5).used, 0);
});

test('Browser Run past its 10 free hours, Images past 5,000 transformations', () => {
  assert.equal(billLine('browser_hours', 12.2).cost, 0.27);
  assert.equal(billLine('images_transformations', 5001).cost, 0.5);
});
