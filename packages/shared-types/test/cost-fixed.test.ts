/**
 * Fixed and other costs (COST-GAPS): validation, a yearly amount spread over its months, partial
 * months at the start and end, and the month so far.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedCostMonthShare, fixedCostsForMonth, parseFixedCostInput, accruedMonthCents, centsByDay, fixedCostsDay } from '../src/cost-fixed.ts';

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

test('cents per day without drift: a steady day is not rounded up every day, and the month is its exact total', () => {
  const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  const cells = centsByDay(days.map((d) => [d, 8.25 / 30] as const));
  assert.equal([...cells.values()].reduce((a, b) => a + b, 0), 825);
  assert.ok([...cells.values()].every((c) => c === 27 || c === 28));
  // A later day arriving never changes an earlier one, and each month starts afresh
  const first20 = centsByDay(days.slice(0, 20).map((d) => [d, 8.25 / 30] as const));
  for (const [d, c] of first20) assert.equal(cells.get(d), c);
  const two = centsByDay([['2026-10-31', 0.004], ['2026-11-01', 0.004]]);
  assert.deepEqual([...two.values()], [0, 0]);
});

test('a month to date by days only grows through the day, and equals the exact month rounded once', () => {
  const items = [{ amountUsd: 99, period: 'yearly' as const, startDate: '2026-01-10', endDate: null }, { amountUsd: 10, period: 'monthly' as const, startDate: '2026-11-16', endDate: null }];
  let prev = 0;
  for (let m = 0; m < 1440; m += 7) {
    const now = new Date(Date.parse('2026-11-21T00:00:00Z') + m * 60_000);
    const cents = accruedMonthCents((d) => fixedCostsDay(items, d), now);
    assert.ok(cents >= prev, `stepped back at ${now.toISOString()}`);
    prev = cents;
  }
  const noon = new Date('2026-11-21T12:00:00Z');
  assert.equal(accruedMonthCents((d) => fixedCostsDay(items, d), noon), Math.round(((8.25 * 20.5) / 30 + (10 * 5.5) / 30) * 100));
});
