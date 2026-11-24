/**
 * Offline downloads & Listen mode types, download rate-limit validation, and switch defaults (E14-S1 / E14-D2).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DOWNLOAD_RATE_LIMIT,
  DOWNLOAD_RATE_LIMIT_BOUNDS,
  normaliseDownloadRateLimit,
  validateDownloadRateLimit,
} from '../src/download-rate-limit.ts';
import { DEFAULT_FEATURE_SWITCHES } from '../src/feature-registry.ts';

describe('offline download rate-limit settings and switch defaults', () => {
  it('validates download rate-limit bounds and burst <= perDay (E14-D2)', () => {
    assert.deepEqual(validateDownloadRateLimit({ perDay: 100, burstPerMinute: 10 }), {
      ok: true,
      value: { perDay: 100, burstPerMinute: 10 },
    });
    assert.deepEqual(validateDownloadRateLimit({ perDay: '250', burstPerMinute: '25' }), {
      ok: true,
      value: { perDay: 250, burstPerMinute: 25 },
    });

    const tooLowDay = validateDownloadRateLimit({ perDay: 0, burstPerMinute: 1 });
    assert.equal(tooLowDay.ok, false);
    if (!tooLowDay.ok) assert.equal(tooLowDay.error.field, 'perDay');

    const tooHighDay = validateDownloadRateLimit({ perDay: DOWNLOAD_RATE_LIMIT_BOUNDS.perDay.max + 1, burstPerMinute: 10 });
    assert.equal(tooHighDay.ok, false);

    const tooHighBurst = validateDownloadRateLimit({ perDay: 500, burstPerMinute: DOWNLOAD_RATE_LIMIT_BOUNDS.burstPerMinute.max + 1 });
    assert.equal(tooHighBurst.ok, false);

    const burstOverDay = validateDownloadRateLimit({ perDay: 5, burstPerMinute: 6 });
    assert.equal(burstOverDay.ok, false);
    if (!burstOverDay.ok) assert.equal(burstOverDay.error.reason, 'exceeds_per_day');
  });

  it('normalises missing or corrupt stored settings back to defaults', () => {
    assert.deepEqual(normaliseDownloadRateLimit(null), DEFAULT_DOWNLOAD_RATE_LIMIT);
    assert.deepEqual(normaliseDownloadRateLimit({ perDay: -5, burstPerMinute: 999 }), {
      ...DEFAULT_DOWNLOAD_RATE_LIMIT,
    });
    assert.deepEqual(
      normaliseDownloadRateLimit({ perDay: 50, burstPerMinute: 5, updatedAt: '2026-11-23T12:00:00Z', updatedBy: 'admin-1' }),
      { perDay: 50, burstPerMinute: 5, updatedAt: '2026-11-23T12:00:00Z', updatedBy: 'admin-1' },
    );
  });

  it('keeps offline and listen switches OFF by default', () => {
    assert.equal(DEFAULT_FEATURE_SWITCHES.listenMode, false);
    assert.equal(DEFAULT_FEATURE_SWITCHES.offlineDownloads, false);
  });
});
