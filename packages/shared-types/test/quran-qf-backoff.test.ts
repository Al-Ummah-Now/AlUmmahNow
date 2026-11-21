/**
 * Quran Foundation 429 handling (QF 2026-11-21: no fixed limits; back off and honour Retry-After).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QF_BACKOFF_MAX_MS, qfBackoffMs, qfRetryAfterMs } from '../src/quran.ts';

describe('qfRetryAfterMs', () => {
  const now = Date.parse('2026-11-21T07:00:00.000Z');
  it('reads delta-seconds', () => {
    assert.equal(qfRetryAfterMs('120', now), 120_000);
    assert.equal(qfRetryAfterMs(' 0 ', now), 0);
  });
  it('reads an HTTP date, never negative', () => {
    assert.equal(qfRetryAfterMs('Sat, 21 Nov 2026 07:02:30 GMT', now), 150_000);
    assert.equal(qfRetryAfterMs('Sat, 21 Nov 2026 06:00:00 GMT', now), 0);
  });
  it('absent or unreadable is null', () => {
    assert.equal(qfRetryAfterMs(null, now), null);
    assert.equal(qfRetryAfterMs('', now), null);
    assert.equal(qfRetryAfterMs('soon', now), null);
    assert.equal(qfRetryAfterMs('-5', now), null);
  });
});

describe('qfBackoffMs', () => {
  it('doubles per strike with jitter between half and the full step, bounded', () => {
    assert.equal(qfBackoffMs(1, null, () => 1), 1000);
    assert.equal(qfBackoffMs(1, null, () => 0), 500);
    assert.equal(qfBackoffMs(4, null, () => 1), 8000);
    assert.equal(qfBackoffMs(40, null, () => 1), QF_BACKOFF_MAX_MS);
  });
  it('never sooner than Retry-After, even past the cap', () => {
    assert.equal(qfBackoffMs(1, 120_000, () => 1), 120_000);
    assert.equal(qfBackoffMs(40, 3_600_000, () => 1), 3_600_000);
  });
});
