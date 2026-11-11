import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { issueBody, tally } from '../nightly-flaky-issue.ts';

const row = (id: string, repeat: number, outcome: string, errors: string[] = []) => ({ id, repeat, outcome, errors });

describe('nightly-flaky-issue', () => {
  it('lists only tests that are not 3/3, worst first, with their errors', () => {
    const bad = tally([
      row('a', 0, 'expected'), row('a', 1, 'expected'), row('a', 2, 'expected'),
      row('b', 0, 'expected'), row('b', 1, 'unexpected', ['Timeout 15000ms']), row('b', 2, 'expected'),
      row('c', 0, 'unexpected', ['boom']), row('c', 1, 'unexpected', ['boom']), row('c', 2, 'expected'),
      row('d', 0, 'skipped'), row('d', 1, 'skipped'), row('d', 2, 'skipped'),
    ], 3);
    assert.deepEqual(bad.map((t) => [t.id, t.passed, t.runs]), [['c', 1, 3], ['b', 2, 3]]);
    assert.deepEqual(bad[0].errors, ['boom']);
  });

  it('a test missing from a repeat counts that repeat as failed', () => {
    assert.deepEqual(tally([row('a', 0, 'expected')], 3).map((t) => [t.passed, t.runs]), [[1, 3]]);
  });

  it('renders a table that keeps pipes out of the cells', () => {
    const body = issueBody([{ id: 'x | y', passed: 2, runs: 3, errors: ['a|b'] }], 'https://run', '2026-11-11');
    assert.match(body, /\| x \\\| y \| 2\/3 \| a\\\|b \|/);
    // A backslash is escaped first, so it cannot un-escape the pipe after it
    assert.ok(issueBody([{ id: String.raw`p\|q`, passed: 0, runs: 3, errors: [] }], 'u', 'd').includes(String.raw`| p\\\|q |`));
  });
});
