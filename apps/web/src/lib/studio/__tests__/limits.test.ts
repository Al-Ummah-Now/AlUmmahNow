import { STUDIO_EN } from '@al-ummah/shared-types';
import { isLimitRefusal, limitRefusalMessage, parseLimitRefusal } from '../limits';

const body = (extra: object) => JSON.stringify({ success: false, error: 'upgrade_required', current: 5, message: 'x', ...extra });

describe('parseLimitRefusal', () => {
  it('reads a refusal from the API', () => {
    expect(parseLimitRefusal(402, body({ entitlement: 'studio.drafts.max', limit: 5 }))).toEqual({ entitlement: 'studio.drafts.max', limit: 5, current: 5 });
  });

  it.each([
    [500, body({ entitlement: 'studio.drafts.max' })],
    [402, JSON.stringify({ error: 'other' })],
    [402, 'not json'],
  ])('ignores status %s body %s', (status, text) => {
    expect(parseLimitRefusal(status, text)).toBeNull();
  });
});

describe('limitRefusalMessage', () => {
  it('states the drafts limit as a plain fact', () => {
    const message = limitRefusalMessage(STUDIO_EN.limits, { entitlement: 'studio.drafts.max', limit: 5, current: 5 });
    expect(message).toBe('This channel can keep 5 drafts. Publish or delete one to save another.');
    expect(message).not.toMatch(/plan/i);
  });

  it('has no words for bulk scheduling being off (the button is hidden instead)', () => {
    expect(limitRefusalMessage(STUDIO_EN.limits, { entitlement: 'studio.bulkSchedule', limit: null, current: null })).toBeNull();
  });

  it('says it plainly for a limit it has no text for', () => {
    expect(limitRefusalMessage(STUDIO_EN.limits, { entitlement: 'other.key', limit: 3, current: 3 })).toBe(STUDIO_EN.limits.other);
  });
});

describe('isLimitRefusal', () => {
  it('tells a refusal from a summary', () => {
    expect(isLimitRefusal({ entitlement: 'a', limit: 1, current: 1 })).toBe(true);
    expect(isLimitRefusal({ total: 1, succeeded: 1, failed: 0 })).toBe(false);
    expect(isLimitRefusal(null)).toBe(false);
  });
});
