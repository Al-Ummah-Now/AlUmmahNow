import { englishOf, hasAnyLanguage, primaryText, trimPair } from '../localized-input';

describe('user text in one language (owner rule: user content needs only one)', () => {
  it('saves with only Arabic: valid, and the plain field carries the Arabic', () => {
    const pair = { en: '', ar: ' محمد ' };
    expect(hasAnyLanguage(pair)).toBe(true);
    expect(primaryText(pair)).toBe('محمد');
    expect(trimPair(pair)).toEqual({ en: '', ar: 'محمد' });
  });

  it('saves with only English', () => {
    const pair = { en: 'Muhammad', ar: '' };
    expect(hasAnyLanguage(pair)).toBe(true);
    expect(primaryText(pair)).toBe('Muhammad');
  });

  it('prefers English for the plain field when both are filled', () => {
    expect(primaryText({ en: 'Muhammad', ar: 'محمد' })).toBe('Muhammad');
  });

  it('is missing only when both languages are empty or blank', () => {
    expect(hasAnyLanguage({ en: '  ', ar: '' })).toBe(false);
    expect(hasAnyLanguage(undefined)).toBe(false);
  });
});

describe('englishOf (the edit form after an Arabic-only save)', () => {
  it('leaves the English tab empty when the plain field is the Arabic', () => {
    expect(englishOf('محمد', { en: '', ar: 'محمد' })).toBe('');
  });
  it('keeps a legacy English-only plain field', () => {
    expect(englishOf('Muhammad', undefined)).toBe('Muhammad');
  });
  it('uses the map English first', () => {
    expect(englishOf('Old', { en: 'Muhammad', ar: 'محمد' })).toBe('Muhammad');
  });
});
