import { userDisplayName } from '../display-name';

describe('userDisplayName (owner rule: first + last when there is no display name)', () => {
  it('own profile with an empty display name shows first + last, not the email', () => {
    expect(userDisplayName({ displayName: '', firstName: 'Mahmoud', lastName: 'Darwish' }, 'en', 'owner@example.org')).toBe('Mahmoud Darwish');
  });

  it('prefers the display name in the page language', () => {
    expect(userDisplayName({ displayName: 'Plain', displayNameLocalized: { ar: 'عربي' } }, 'ar', 'a@b.c')).toBe('عربي');
    expect(userDisplayName({ displayName: 'Plain', displayNameLocalized: { ar: 'عربي' } }, 'en', 'a@b.c')).toBe('Plain');
  });

  it('a public profile (no first/last fields) uses the API resolved name', () => {
    expect(userDisplayName({ displayName: '', resolvedDisplayName: 'Mahmoud Darwish' }, 'en', 'a@b.c')).toBe('Mahmoud Darwish');
  });

  it('email as the last resort (users have no handle), never a blank', () => {
    expect(userDisplayName({ displayName: ' ', userName: 'mahmoud' } as never, 'en', 'a@b.c')).toBe('a@b.c');
    expect(userDisplayName({ displayName: ' ', resolvedDisplayName: ' ' }, 'en', 'a@b.c')).toBe('a@b.c');
    expect(userDisplayName(null, 'en')).toBe('');
  });

  it('follows display name → first + last → resolvedDisplayName → email, and never shows an @handle (owner review 2026-11-16)', () => {
    const handles = { userName: 'fixture', handle: '@fixture', channelHandle: '@fixture-channel' };
    const account = { ...handles, displayName: 'Fixture Creator', firstName: 'Amina', lastName: 'Yusuf', resolvedDisplayName: 'Resolved Name' };
    expect(userDisplayName(account as never, 'en', 'a@b.c')).toBe('Fixture Creator');
    expect(userDisplayName({ ...account, displayName: '' } as never, 'en', 'a@b.c')).toBe('Amina Yusuf');
    expect(userDisplayName({ ...account, displayName: '', firstName: '', lastName: '' } as never, 'en', 'a@b.c')).toBe('Resolved Name');
    expect(userDisplayName({ ...handles, displayName: '', resolvedDisplayName: '' } as never, 'en', 'a@b.c')).toBe('a@b.c');
    for (const shown of [
      userDisplayName(account as never, 'en', 'a@b.c'),
      userDisplayName({ ...handles } as never, 'en', 'a@b.c'),
      userDisplayName({ ...handles } as never, 'en', null),
    ]) {
      expect(shown).not.toMatch(/^@|fixture(-channel)?$/);
    }
    expect(userDisplayName({ ...handles } as never, 'en', null)).toBe('');
  });
});
