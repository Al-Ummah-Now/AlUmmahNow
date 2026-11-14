import {
  SIGN_IN_BANNER_ATTR,
  SIGN_IN_BANNER_DISMISS_MS,
  SIGN_IN_BANNER_SCRIPT,
  SIGN_IN_BANNER_STORAGE_KEY,
  isSignInBannerDismissed,
  rememberSignInBannerDismissed,
} from '../sign-in-banner';

const NOW = Date.UTC(2026, 10, 14, 12);
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const blocked = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('isSignInBannerDismissed', () => {
  it('is false with nothing stored or no storage at all', () => {
    expect(isSignInBannerDismissed(memoryStorage(), NOW)).toBe(false);
    expect(isSignInBannerDismissed(null, NOW)).toBe(false);
  });

  it('is true within 30 days of a dismissal and false from day 30 on', () => {
    const at = (ms: number) => memoryStorage({ [SIGN_IN_BANNER_STORAGE_KEY]: String(NOW - ms) });
    expect(isSignInBannerDismissed(at(0), NOW)).toBe(true);
    expect(isSignInBannerDismissed(at(29 * DAY), NOW)).toBe(true);
    expect(isSignInBannerDismissed(at(SIGN_IN_BANNER_DISMISS_MS), NOW)).toBe(false);
    expect(isSignInBannerDismissed(at(31 * DAY), NOW)).toBe(false);
  });

  it('ignores malformed and future values', () => {
    for (const v of ['', 'yes', '1.5', '-3', 'NaN', String(NOW + DAY)]) {
      expect(isSignInBannerDismissed(memoryStorage({ [SIGN_IN_BANNER_STORAGE_KEY]: v }), NOW)).toBe(false);
    }
  });

  it('treats blocked storage as not dismissed instead of throwing', () => {
    expect(isSignInBannerDismissed(blocked, NOW)).toBe(false);
  });
});

describe('rememberSignInBannerDismissed', () => {
  it('stores the time, which then reads back as dismissed', () => {
    const s = memoryStorage();
    expect(rememberSignInBannerDismissed(s, NOW)).toBe(true);
    expect(s.data[SIGN_IN_BANNER_STORAGE_KEY]).toBe(String(NOW));
    expect(isSignInBannerDismissed(s, NOW + DAY)).toBe(true);
  });

  it('reports blocked storage without throwing', () => {
    expect(rememberSignInBannerDismissed(blocked, NOW)).toBe(false);
    expect(rememberSignInBannerDismissed(null, NOW)).toBe(false);
  });
});

describe('SIGN_IN_BANNER_SCRIPT (pre-paint)', () => {
  const run = (stored: string | null, opts: { throws?: boolean } = {}) => {
    document.documentElement.removeAttribute(SIGN_IN_BANNER_ATTR);
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      if (opts.throws) throw new Error('SecurityError');
      return stored;
    });
    new Function(SIGN_IN_BANNER_SCRIPT)();
    getItem.mockRestore();
    return document.documentElement.getAttribute(SIGN_IN_BANNER_ATTR);
  };

  it('marks <html> hidden for a recent dismissal, matching isSignInBannerDismissed', () => {
    expect(run(String(Date.now() - DAY))).toBe('hidden');
  });

  it('leaves <html> alone when nothing, an old, a malformed or a future value is stored', () => {
    expect(run(null)).toBeNull();
    expect(run(String(Date.now() - 31 * DAY))).toBeNull();
    expect(run('yes')).toBeNull();
    expect(run(String(Date.now() + DAY))).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    expect(run(null, { throws: true })).toBeNull();
  });
});
