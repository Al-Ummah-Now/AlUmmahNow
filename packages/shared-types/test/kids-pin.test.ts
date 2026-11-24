import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidKidsPin,
  isValidKidsTime,
  nextPinLockout,
  KIDS_STEP_UP_MAX_AGE_SECONDS,
} from '../src/kids.ts';

describe('Ummah Kids PIN and parental control validators', () => {
  it('validates 4-6 digit ASCII PINs only', () => {
    for (const valid of ['0000', '1234', '98765', '012345']) {
      assert.equal(isValidKidsPin(valid), true, valid);
    }
    for (const invalid of ['', '123', '1234567', '12a4', '١٢٣٤', ' 1234', null, 1234]) {
      assert.equal(isValidKidsPin(invalid), false, String(invalid));
    }
  });

  it('validates 24-hour HH:MM bedtime strings', () => {
    for (const valid of ['00:00', '06:30', '19:45', '23:59']) {
      assert.equal(isValidKidsTime(valid), true, valid);
    }
    for (const invalid of ['24:00', '7:30', '12:60', '12:00 PM', '', null]) {
      assert.equal(isValidKidsTime(invalid), false, String(invalid));
    }
  });

  it('escalates PIN failure lockouts (5->5m, 6->15m, 7->1h, 8->hard stop)', () => {
    const now = Date.UTC(2026, 10, 23, 12, 0, 0);
    for (let failures = 0; failures < 4; failures++) {
      const next = nextPinLockout(failures, now);
      assert.equal(next.failedAttempts, failures + 1);
      assert.equal(next.lockedUntilIso, null);
      assert.equal(next.retryAfterSeconds, 0);
      assert.equal(next.hardLocked, false);
    }

    const fifth = nextPinLockout(4, now);
    assert.equal(fifth.failedAttempts, 5);
    assert.equal(fifth.retryAfterSeconds, 300);
    assert.equal(fifth.lockedUntilIso, new Date(now + 300_000).toISOString());
    assert.equal(fifth.hardLocked, false);

    const sixth = nextPinLockout(5, now);
    assert.equal(sixth.failedAttempts, 6);
    assert.equal(sixth.retryAfterSeconds, 900);
    assert.equal(sixth.hardLocked, false);

    const seventh = nextPinLockout(6, now);
    assert.equal(seventh.failedAttempts, 7);
    assert.equal(seventh.retryAfterSeconds, 3600);
    assert.equal(seventh.hardLocked, false);

    const eighth = nextPinLockout(7, now);
    assert.equal(eighth.failedAttempts, 8);
    assert.equal(eighth.hardLocked, true);
    assert.equal(eighth.lockedUntilIso, null);
  });

  it('uses a 5-minute step-up window', () => {
    assert.equal(KIDS_STEP_UP_MAX_AGE_SECONDS, 300);
  });
});
