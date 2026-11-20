import { identityInitial, identityName, lastIdentityName, rememberIdentityName, resetIdentityNames } from '../identity-name';

describe('identityName (#1673: the header never labels you with your email)', () => {
  it('takes the first real name', () => {
    expect(identityName(['', '  ', 'Amina Yusuf', 'Other'], 'amina@test.local')).toBe('Amina Yusuf');
  });

  it('skips the email the session uses as a stand-in name, in any case', () => {
    expect(identityName(['Amina@Test.Local', 'Amina'], 'amina@test.local')).toBe('Amina');
  });

  it('skips anything shaped like an email, even another account\'s', () => {
    expect(identityName(['omar@test.local'], 'amina@test.local')).toBe('');
  });

  it('is empty rather than the email when nothing is known', () => {
    expect(identityName([null, undefined, 'amina@test.local'], 'amina@test.local')).toBe('');
  });
});

describe('identityInitial', () => {
  it('is the name\'s first letter, and empty with no name', () => {
    expect(identityInitial('amina')).toBe('A');
    expect(identityInitial('أمينة')).toBe('أ');
    expect(identityInitial('')).toBe('');
  });
});

describe('last known names', () => {
  beforeEach(() => resetIdentityNames());

  it('remembers names per account across reads', () => {
    rememberIdentityName('u1', 'Amina Yusuf');
    expect(lastIdentityName('u1')).toBe('Amina Yusuf');
    expect(lastIdentityName('u2')).toBe('');
    expect(JSON.parse(window.sessionStorage.getItem('aun-identity-names') ?? '{}')).toEqual({ u1: 'Amina Yusuf' });
  });

  it('never stores an email', () => {
    rememberIdentityName('u1', 'amina@test.local');
    expect(lastIdentityName('u1')).toBe('');
  });

  it('still works when storage throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    rememberIdentityName('u1', 'Amina');
    expect(lastIdentityName('u1')).toBe('Amina');
    spy.mockRestore();
  });
});
