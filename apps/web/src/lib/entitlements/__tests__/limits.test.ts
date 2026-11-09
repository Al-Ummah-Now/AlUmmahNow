import { maxLinksFor, numericLimit, uploadBlock, type EntitlementsView } from '../limits';

const view = (over: Partial<EntitlementsView> = {}): EntitlementsView => ({
  plan: { slug: 'free', name_en: 'Free', name_ar: 'مجاني' },
  entitlements: {
    'channel.about.links.max': { value: 5, source: 'default_plan' },
    'upload.maxDurationMinutes': { value: 30, source: 'default_plan' },
  },
  usage: {
    'upload.monthlyUploads': { current: 0, limit: 10, warning: false },
    'storage.gb': { current: 0, limit: 5, warning: false },
  },
  ...over,
});
const usage = (uploads: number, gb: number) => ({
  usage: { 'upload.monthlyUploads': { current: uploads, limit: 10, warning: false }, 'storage.gb': { current: gb, limit: 5, warning: false } },
});

describe('maxLinksFor', () => {
  it('uses the plan limit', () => expect(maxLinksFor(view(), 2)).toBe(5));
  it('keeps every link on a channel above the limit (grandfathering)', () => expect(maxLinksFor(view(), 8)).toBe(8));
  it('falls back to 10 when the plan is unavailable', () => expect(maxLinksFor(null, 0)).toBe(10));
  it('has no cap on unlimited', () => {
    const v = view({ entitlements: { 'channel.about.links.max': { value: 'unlimited', source: 'override' } } });
    expect(numericLimit(v, 'channel.about.links.max')).toBeNull();
    expect(maxLinksFor(v, 3)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('uploadBlock', () => {
  const one = { count: 1, bytes: 1_000_000 };
  it('allows an upload within limits', () => expect(uploadBlock(view(), { ...one, maxSeconds: 1800 })).toBeNull());
  it('blocks a video over 30 minutes', () => expect(uploadBlock(view(), { ...one, maxSeconds: 1801 })).toBe('duration'));
  it('blocks the 11th upload of the month', () => expect(uploadBlock(view(usage(10, 0)), one)).toBe('uploads'));
  it('blocks a batch that would pass the monthly limit', () => expect(uploadBlock(view(usage(9, 0)), { count: 2, bytes: 2 })).toBe('uploads'));
  it('blocks past 5 GB', () => expect(uploadBlock(view(usage(0, 4.9)), { count: 1, bytes: 200_000_000 })).toBe('storage'));
  it('does not block on an unknown duration', () => expect(uploadBlock(view(), one)).toBeNull());
  it('never blocks without plan data', () => {
    expect(uploadBlock(null, { count: 99, bytes: 1e12, maxSeconds: 99999 })).toBeNull();
    expect(uploadBlock(view({ degraded: true, ...usage(10, 5) }), one)).toBeNull();
  });
});
