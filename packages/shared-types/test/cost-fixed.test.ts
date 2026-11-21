/**
 * Fixed and other costs (COST-GAPS): validation, a yearly amount spread over its months, partial
 * months at the start and end, and the month so far.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedCostMonthShare, fixedCostsForMonth, parseFixedCostInput } from '../src/cost-fixed.ts';

const apple = { amountUsd: 99, period: 'yearly' as const, startDate: '2026-01-10', endDate: null };
const linear = { amountUsd: 10, period: 'monthly' as const, startDate: '2026-11-16', endDate: null };

test('a yearly amount is a twelfth of it each full month', () => {
  assert.equal(fixedCostMonthShare(apple, '2026-11'), 8.25);
  assert.equal(fixedCostMonthShare(apple, '2025-12'), 0);
});

test('a cost starting or ending mid-month counts only its days', () => {
  // 15 of November's 30 days
  assert.equal(fixedCostMonthShare(linear, '2026-11'), 5);
  assert.equal(fixedCostMonthShare({ ...linear, startDate: '2026-11-01', endDate: '2026-11-03' }, '2026-11'), 1);
  assert.equal(fixedCostMonthShare({ ...linear, startDate: '2026-10-01', endDate: '2026-10-31' }, '2026-11'), 0);
});

test('month so far follows the days elapsed; the whole month is the projection', () => {
  const noon21 = new Date('2026-11-21T12:00:00Z');
  const r = fixedCostsForMonth([apple, linear], noon21);
  assert.equal(r.projected, 13.25);
  // Apple: 20.5 of 30 days of 8.25; Linear: 5.5 days (16th to noon on the 21st) of 10/30
  assert.equal(r.mtd, Math.round(((8.25 * 20.5) / 30 + (10 * 5.5) / 30) * 100) / 100);
  assert.deepEqual(fixedCostsForMonth([{ ...linear, startDate: '2026-12-01' }], noon21), { mtd: 0, projected: 0 });
});

test('input is validated and cleaned', () => {
  const ok = parseFixedCostInput({ name: '  Apple   Developer ', amountUsd: 99.005, period: 'yearly', startDate: '2026-01-10', endDate: '', note: ' ' });
  assert.deepEqual(ok, { name: 'Apple Developer', amountUsd: 99.01, period: 'yearly', startDate: '2026-01-10', endDate: null, note: null });
  assert.equal((parseFixedCostInput({ name: '', amountUsd: 1, period: 'monthly', startDate: '2026-01-01' }) as { field: string }).field, 'name');
  assert.equal((parseFixedCostInput({ name: 'x', amountUsd: 0, period: 'monthly', startDate: '2026-01-01' }) as { field: string }).field, 'amountUsd');
  assert.equal((parseFixedCostInput({ name: 'x', amountUsd: 1, period: 'weekly', startDate: '2026-01-01' }) as { field: string }).field, 'period');
  assert.equal((parseFixedCostInput({ name: 'x', amountUsd: 1, period: 'monthly', startDate: '2026-02-30' }) as { field: string }).field, 'startDate');
  assert.equal((parseFixedCostInput({ name: 'x', amountUsd: 1, period: 'monthly', startDate: '2026-02-01', endDate: '2026-01-01' }) as { field: string }).field, 'endDate');
});
