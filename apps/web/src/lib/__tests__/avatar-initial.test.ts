import { avatarInitial, FALLBACK_INITIAL, firstGrapheme } from '../avatar-initial';

describe('avatarInitial (letter avatars never throw on a missing name)', () => {
  it('upper-cases the first letter of a Latin name', () => {
    expect(avatarInitial('salam channel')).toBe('S');
  });

  it('takes the first Arabic letter whole, with its mark', () => {
    expect(avatarInitial('قناة السلام')).toBe('ق');
    // A letter with a damma is one grapheme: the mark stays with its letter
    expect(avatarInitial('مُحمد')).toBe('مُ');
  });

  it('never splits a surrogate pair', () => {
    expect(avatarInitial('😀 smiles')).toBe('😀');
    expect(avatarInitial('𝒜lpha')).toBe('𝒜');
  });

  it('falls through undefined, null, empty and blank names to the next candidate', () => {
    expect(avatarInitial(undefined, 'Fallback')).toBe('F');
    expect(avatarInitial(null, '', '   ', 'x')).toBe('X');
  });

  it('skips a handle\'s leading @', () => {
    expect(avatarInitial(undefined, '@salam')).toBe('S');
    expect(avatarInitial('', '@@')).toBe(FALLBACK_INITIAL);
  });

  it('shows the neutral glyph when nothing has text', () => {
    expect(avatarInitial()).toBe('?');
    expect(avatarInitial(undefined, null, '')).toBe('?');
  });
});

describe('firstGrapheme', () => {
  it('is empty for an empty string', () => {
    expect(firstGrapheme('')).toBe('');
  });

  it('keeps a flag (two regional indicators) together', () => {
    expect(firstGrapheme('🇸🇦 KSA')).toBe('🇸🇦');
  });
});
