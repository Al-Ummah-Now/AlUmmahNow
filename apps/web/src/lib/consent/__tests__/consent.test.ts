/**
 * Story 1.3 AC 3, 4: default-deny consent, granular choices, withdrawal purges data,
 * server-side enforcement on beacon routes.
 */
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  consentFromCookieHeader,
  isCategoryAllowed,
  parseConsent,
  serializeConsent,
} from '../consent-cookie';
import { ConsentManager, hasConsent } from '../ConsentManager';

function clearCookies() {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

describe('consent cookie format', () => {
  const state = { version: 1, analytics: true, experiments: false, performance: true, decidedAt: 1_760_000_000_000 };

  it('round-trips', () => {
    expect(serializeConsent(state)).toBe('v1.a1.e0.p1.1760000000000');
    expect(parseConsent('v1.a1.e0.p1.1760000000000', state.decidedAt + 1000)).toEqual(state);
  });

  it('rejects malformed, outdated-version, future and expired values', () => {
    expect(parseConsent('garbage')).toBeNull();
    expect(parseConsent('v0.a1.e1.p1.1760000000000', state.decidedAt)).toBeNull();
    expect(parseConsent('v1.a1.e1.p1.1760000000000', state.decidedAt - 3_600_000)).toBeNull();
    expect(parseConsent('v1.a1.e1.p1.1760000000000', state.decidedAt + (CONSENT_MAX_AGE_SECONDS + 1) * 1000)).toBeNull();
  });

  it('reads the value out of a Cookie header', () => {
    const header = `foo=bar; ${CONSENT_COOKIE}=v1.a0.e1.p0.1760000000000; other=1`;
    expect(consentFromCookieHeader(header, state.decidedAt)).toMatchObject({ analytics: false, experiments: true, performance: false });
    expect(consentFromCookieHeader('foo=bar')).toBeNull();
  });

  it('defaults to deny', () => {
    expect(isCategoryAllowed(null, 'analytics')).toBe(false);
  });
});

describe('ConsentManager', () => {
  beforeEach(() => {
    clearCookies();
    localStorage.clear();
    ConsentManager.resetCache();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
  });

  it('has no consent before the user decides', () => {
    expect(ConsentManager.hasDecided()).toBe(false);
    expect(hasConsent('analytics')).toBe(false);
    expect(hasConsent('experiments')).toBe(false);
    expect(hasConsent('performance')).toBe(false);
  });

  it('accept all / reject all set every category', () => {
    ConsentManager.acceptAll();
    expect(['analytics', 'experiments', 'performance'].every(c => hasConsent(c as 'analytics'))).toBe(true);
    ConsentManager.rejectAll();
    expect(['analytics', 'experiments', 'performance'].some(c => hasConsent(c as 'analytics'))).toBe(false);
    expect(ConsentManager.hasDecided()).toBe(true);
  });

  it('persists granular choices in the first-party cookie', () => {
    ConsentManager.setConsent({ analytics: true, experiments: false, performance: true });
    expect(document.cookie).toMatch(new RegExp(`${CONSENT_COOKIE}=v1\\.a1\\.e0\\.p1\\.\\d+`));
    ConsentManager.resetCache();
    expect(hasConsent('analytics')).toBe(true);
    expect(hasConsent('experiments')).toBe(false);
  });

  it('withdrawing consent purges data collected under that category', () => {
    ConsentManager.acceptAll();
    localStorage.setItem('al-ummah-ab-assignments', '{"u":{}}');
    localStorage.setItem('pendingVideoAnalytics', '[]');
    localStorage.setItem('darkmode', 'true');
    ConsentManager.setConsent({ analytics: true, experiments: false, performance: true });
    expect(localStorage.getItem('al-ummah-ab-assignments')).toBeNull();
    expect(localStorage.getItem('pendingVideoAnalytics')).toBe('[]');
    ConsentManager.rejectAll();
    expect(localStorage.getItem('pendingVideoAnalytics')).toBeNull();
    expect(localStorage.getItem('darkmode')).toBe('true');
  });

  it('notifies subscribers and preference listeners', () => {
    const listener = jest.fn();
    const unsubscribe = ConsentManager.subscribe(listener);
    ConsentManager.acceptAll();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ analytics: true }));
    unsubscribe();
    const open = jest.fn();
    const off = ConsentManager.onOpenPreferences(open);
    ConsentManager.openPreferences();
    expect(open).toHaveBeenCalled();
    off();
  });
});
