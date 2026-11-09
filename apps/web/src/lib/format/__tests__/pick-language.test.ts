import { pickLanguage } from '../pick-language';

describe('pickLanguage', () => {
  it('picks the locale from piped titles', () => {
    expect(pickLanguage('Old Cities and Rivers | مدن عتيقة وأنهار', 'en')).toBe('Old Cities and Rivers');
    expect(pickLanguage('Old Cities and Rivers | مدن عتيقة وأنهار', 'ar')).toBe('مدن عتيقة وأنهار');
  });

  it('picks the locale from mixed sentences', () => {
    expect(pickLanguage('A tour of mosques. جولة في المساجد.', 'ar')).toBe('جولة في المساجد.');
  });

  it('leaves single-language text alone, including pipes', () => {
    expect(pickLanguage('Only English here.', 'ar')).toBe('Only English here.');
    expect(pickLanguage('Surah | Al-Fatiha', 'en')).toBe('Surah | Al-Fatiha');
  });
});
