import { deviceClass, pageKind, parseRumBeacon } from '../vitals';

describe('field Core Web Vitals (#1207)', () => {
  it('should map paths to page kinds, never keeping the path', () => {
    expect(pageKind('/en')).toBe('home');
    expect(pageKind('/ar/')).toBe('home');
    expect(pageKind('/en/video/0174501b-cbc9-41b4-b386-93f9bb8429a7')).toBe('watch');
    expect(pageKind('/ar/shorts/abc')).toBe('short');
    expect(pageKind('/en/@someone')).toBe('channel');
    expect(pageKind('/en/channels/c1')).toBe('channel');
    expect(pageKind('/en/c/handle')).toBe('channel');
    expect(pageKind('/en/playlist/p1')).toBe('playlist');
    expect(pageKind('/en/search')).toBe('search');
    expect(pageKind('/en/studio/c1/content')).toBe('studio');
    expect(pageKind('/en/settings')).toBe('other');
  });

  it('should bucket the viewport width', () => {
    expect(deviceClass(390)).toBe('phone');
    expect(deviceClass(800)).toBe('tablet');
    expect(deviceClass(1440)).toBe('desktop');
  });

  it('should accept only known fields and sane values', () => {
    expect(parseRumBeacon({ k: 'watch', d: 'phone', l: 'ar', m: { LCP: 2100, CLS: 0.02, INP: 120 } })).toEqual({ k: 'watch', d: 'phone', l: 'ar', m: { LCP: 2100, CLS: 0.02, INP: 120 } });
    expect(parseRumBeacon({ k: 'watch', d: 'phone', l: 'ar', m: { LCP: -1, CLS: 99, INP: 'x', userId: 5 } })).toBeNull();
    expect(parseRumBeacon({ k: '/en/video/123', d: 'phone', l: 'en', m: { LCP: 1 } })).toBeNull();
    expect(parseRumBeacon({ k: 'home', d: 'phone', l: 'fr', m: { LCP: 1 } })).toBeNull();
    expect(parseRumBeacon('nope')).toBeNull();
  });
});
