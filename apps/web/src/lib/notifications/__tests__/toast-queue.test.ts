import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import {
  EMPTY_QUEUE,
  GROUP_WINDOW_MS,
  TOAST_TTL_MS,
  dismissGroup,
  enqueueToast,
  expireGroups,
  groupText,
  isAlreadyOnScreen,
  pluralText,
  resumeGroups,
  visibleToasts,
  type ToastEntry,
  type ToastQueue,
} from '../toast-queue';
import { videoIdFromActionUrl } from '../upload-results';

const T0 = 1_700_000_000_000;
const ready = (n: number, at = T0 + n * 500): ToastEntry => ({
  id: `n${n}`,
  kind: 'uploadReady',
  title: 'Video Ready',
  message: `Your video "Good Deeds ${n}" has finished processing`,
  href: `/en/video/v${n}`,
  at,
});
const fill = (entries: ToastEntry[], q: ToastQueue = EMPTY_QUEUE) => entries.reduce(enqueueToast, q);

describe('toast queue: grouping', () => {
  it('merges same-kind notifications that arrive together into one group', () => {
    const q = fill([ready(1), ready(2), ready(3)]);
    expect(q.groups).toHaveLength(1);
    expect(q.groups[0].entries.map((e) => e.id)).toEqual(['n1', 'n2', 'n3']);
    expect(q.groups[0].lastAt).toBe(ready(3).at);
  });

  it('keeps growing a group while arrivals stay within the window of the latest one', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ready(i, T0 + i * (GROUP_WINDOW_MS - 1)));
    expect(fill(entries).groups).toHaveLength(1);
  });

  it('starts a new group after the window, and for a different kind', () => {
    const late = ready(9, T0 + GROUP_WINDOW_MS + 1);
    const failed: ToastEntry = { ...ready(4), id: 'f1', kind: 'uploadFailed', message: 'x' };
    const q = fill([ready(0, T0), failed, late]);
    expect(q.groups.map((g) => g.kind)).toEqual(['uploadReady', 'uploadFailed', 'uploadReady']);
    expect(q.groups[0].entries).toHaveLength(1);
  });

  it('moves a group that grows to the front', () => {
    const comment: ToastEntry = { ...ready(1), id: 'c1', kind: 'newComment', message: 'c' };
    const q = fill([ready(1), comment, ready(2)]);
    expect(q.groups[0].kind).toBe('uploadReady');
    expect(q.groups[0].entries).toHaveLength(2);
  });

  it('starts a fresh group once the previous one was dismissed', () => {
    const q1 = fill([ready(1)]);
    const q2 = enqueueToast(dismissGroup(q1, q1.groups[0].id), ready(2));
    expect(q2.groups).toHaveLength(1);
    expect(q2.groups[0].entries.map((e) => e.id)).toEqual(['n2']);
  });
});

describe('toast queue: dedupe', () => {
  it('drops a redelivered id and returns the same queue', () => {
    const q = fill([ready(1)]);
    expect(enqueueToast(q, ready(1))).toBe(q);
  });

  it('drops the same notification under a new id (same kind, target and text)', () => {
    const q = fill([ready(1)]);
    expect(enqueueToast(q, { ...ready(1), id: 'other' })).toBe(q);
  });

  it('does not show a notification again after it was dismissed', () => {
    const q = fill([ready(1)]);
    const dismissed = dismissGroup(q, 'n1');
    expect(enqueueToast(dismissed, ready(1)).groups).toHaveLength(0);
  });

  it('bounds its memory', () => {
    const q = fill(Array.from({ length: 300 }, (_, i) => ready(i, T0)));
    expect(q.seen.length).toBeLessThanOrEqual(200);
  });
});

describe('toast queue: cap and expiry', () => {
  const kinds = ['uploadReady', 'newComment', 'newSubscriber', 'commentReply'];
  const mixed = fill(kinds.map((kind, i) => ({ ...ready(i), id: kind, kind, message: kind })));

  it('shows at most two groups and counts the notifications collapsed behind them', () => {
    const withBulk = fill([{ ...ready(7), id: 'x7', kind: 'newSubscriber', message: 's7' }], mixed);
    const { visible, hiddenCount } = visibleToasts(withBulk);
    expect(visible.map((g) => g.kind)).toEqual(['newSubscriber', 'commentReply']);
    // newComment (1) + uploadReady (1)
    expect(hiddenCount).toBe(2);
  });

  it('has nothing hidden under the cap', () => {
    expect(visibleToasts(fill([ready(1), ready(2)]))).toMatchObject({ hiddenCount: 0 });
  });

  it('expires groups after the TTL from their latest notification', () => {
    const q = fill([ready(1, T0), { ...ready(2), kind: 'newComment', at: T0 + 5000 }]);
    const after = expireGroups(q, T0 + TOAST_TTL_MS + 1);
    expect(after.groups.map((g) => g.kind)).toEqual(['newComment']);
    expect(expireGroups(q, T0 + 1)).toBe(q);
  });

  it('gives paused time back', () => {
    const q = fill([ready(1, T0)]);
    expect(expireGroups(resumeGroups(q, 60_000), T0 + TOAST_TTL_MS + 1).groups).toHaveLength(1);
  });
});

describe('toast copy', () => {
  const en = EN_TRANSLATIONS.notificationCenter.toasts;
  const ar = AR_TRANSLATIONS.notificationCenter.toasts;

  it('keeps a single notification as it is', () => {
    const q = fill([ready(1)]);
    expect(groupText(q.groups[0], en, 'en')).toEqual({
      title: 'Video Ready',
      message: 'Your video "Good Deeds 1" has finished processing',
      href: '/en/video/v1',
      action: 'View',
    });
  });

  it('summarises a group with a count and View all to My Videos', () => {
    const q = fill([ready(1), ready(2), ready(3)]);
    expect(groupText(q.groups[0], en, 'en')).toEqual({
      title: 'Video Ready',
      message: '3 videos finished processing',
      href: '/en/studio/go/content/videos',
      action: 'View all',
    });
    expect(groupText(q.groups[0], ar, 'ar')).toMatchObject({ href: '/ar/studio/go/content/videos', action: 'عرض الكل' });
  });

  it('sends non-upload groups to the notification center', () => {
    const q = fill([1, 2].map((n) => ({ ...ready(n), kind: 'newComment' })));
    expect(groupText(q.groups[0], en, 'en')).toMatchObject({ message: '2 new comments on your videos', href: '/en/notifications' });
  });

  it('uses CLDR plural forms in Arabic with the locale\'s digits', () => {
    const table = ar.grouped.uploadReady;
    const n = (v: number) => new Intl.NumberFormat('ar').format(v);
    expect(pluralText(table, 1, 'ar')).toBe('اكتملت معالجة فيديو واحد');
    expect(pluralText(table, 2, 'ar')).toBe('اكتملت معالجة مقطعي فيديو');
    expect(pluralText(table, 3, 'ar')).toBe(`اكتملت معالجة ${n(3)} مقاطع فيديو`);
    expect(pluralText(table, 11, 'ar')).toBe(`اكتملت معالجة ${n(11)} مقطع فيديو`);
    expect(pluralText(table, 100, 'ar')).toBe(`اكتملت معالجة ${n(100)} مقطع فيديو`);
    expect(pluralText(en.grouped.uploadReady, 1, 'en')).toBe('1 video finished processing');
    expect(pluralText(en.more, 4, 'en')).toBe('+4 more');
  });

  it('has an Arabic text for every English plural table', () => {
    for (const [kind, table] of Object.entries(ar.grouped)) {
      expect(en.grouped).toHaveProperty(kind);
      for (const form of ['one', 'two', 'few', 'many', 'other'] as const) expect(table[form]).toBeTruthy();
    }
  });
});

describe('already on screen', () => {
  it('suppresses upload results on the upload page only', () => {
    expect(isAlreadyOnScreen('uploadReady', '/en/video/v1', '/en/upload')).toBe(true);
    expect(isAlreadyOnScreen('uploadFailed', '/ar/video/v1', '/ar/upload/')).toBe(true);
    expect(isAlreadyOnScreen('uploadReady', '/en/video/v1', '/en/dashboard/videos')).toBe(false);
    expect(isAlreadyOnScreen('newComment', '/en/video/v1', '/en/upload')).toBe(false);
  });

  it('suppresses anything that points at the current page', () => {
    expect(isAlreadyOnScreen('newComment', '/en/video/v1?c=2', '/en/video/v1')).toBe(true);
    expect(isAlreadyOnScreen('newComment', '/en/video/v1', '/en/video/v2')).toBe(false);
    expect(isAlreadyOnScreen('newComment', null, '/en')).toBe(false);
  });

  it('reads the video id from an action url', () => {
    expect(videoIdFromActionUrl('/video/abc-1')).toBe('abc-1');
    expect(videoIdFromActionUrl('/ar/video/abc?t=1')).toBe('abc');
    expect(videoIdFromActionUrl('/channels/abc')).toBeNull();
    expect(videoIdFromActionUrl(undefined)).toBeNull();
  });
});
