/**
 * The one allowlist of sign-in returns (login's returnTo): Studio pages, the locale's home and
 * the request page for the sign-in's own locale; everything else is refused (the Referer then
 * decides).
 */
import { safeSignInReturn, upgradePath } from '../sign-in-return';

describe('sign-in return allowlist', () => {
  it('names the request page in the page language', () => {
    expect(upgradePath('en')).toBe('/en/upgrade');
    expect(upgradePath('ar')).toBe('/ar/upgrade');
    expect(upgradePath('fr')).toBe('/en/upgrade');
  });

  it('allows Studio pages', () => {
    expect(safeSignInReturn('/en/studio/abc/content', 'en')).toBe('/en/studio/abc/content');
    expect(safeSignInReturn('/ar/studio', 'en')).toBe('/ar/studio');
  });

  it("allows the locale's home and /upgrade only for the sign-in's own locale", () => {
    expect(safeSignInReturn('/en', 'en')).toBe('/en');
    expect(safeSignInReturn('/ar', 'ar')).toBe('/ar');
    expect(safeSignInReturn('/en/upgrade', 'en')).toBe('/en/upgrade');
    expect(safeSignInReturn('/ar/upgrade', 'ar')).toBe('/ar/upgrade');
    expect(safeSignInReturn('/ar', 'en')).toBeNull();
    expect(safeSignInReturn('/en/upgrade', 'ar')).toBeNull();
    expect(safeSignInReturn('/en', 'fr')).toBeNull();
  });

  it('refuses everything else', () => {
    for (const value of ['/', '/en/', '/en?x=1', '/fr', '/en/settings', '/en/upgrade/x', '/en/upgrade?next=//evil.example', 'https://evil.example/en', '//evil.example/en/upgrade', '/de/upgrade', '', null, undefined, 42, ['/en']]) {
      expect(safeSignInReturn(value, 'en')).toBeNull();
    }
  });
});
