import { localizedText, pairOf, pairPayload, playlistDescription, playlistName } from '../playlist-names';

describe('playlistName', () => {
  it('shows the viewer’s language when the playlist has it', () => {
    const p = { title: 'Tafsir', titleLocalized: { en: 'Tafsir', ar: 'تفسير' } };
    expect(playlistName(p, 'en')).toBe('Tafsir');
    expect(playlistName(p, 'ar')).toBe('تفسير');
  });
  it('falls back to the base name in both languages for older playlists', () => {
    expect(playlistName({ title: 'Tafsir' }, 'ar')).toBe('Tafsir');
    expect(playlistName({ name: 'Fiqh', title: 'Other' }, 'en')).toBe('Fiqh');
  });
  it('a language left empty shows the base, and an old "EN | AR" name shows the viewer’s half', () => {
    expect(playlistName({ title: 'Tafsir', titleLocalized: { en: 'Tafsir', ar: '  ' } }, 'ar')).toBe('Tafsir');
    expect(playlistName({ title: 'Old Cities | مدن عتيقة' }, 'ar')).toBe('مدن عتيقة');
  });
  it('no base at all: the other language rather than nothing', () => {
    expect(localizedText('', { ar: 'تفسير' }, 'en')).toBe('تفسير');
  });
  it('descriptions follow the same rules', () => {
    expect(playlistDescription({ description: 'About', descriptionLocalized: { ar: 'نبذة' } }, 'ar')).toBe('نبذة');
    expect(playlistDescription({ description: 'About', descriptionLocalized: { ar: 'نبذة' } }, 'en')).toBe('About');
  });
});

describe('pairOf (form prefill)', () => {
  it('uses the stored languages', () => {
    expect(pairOf('Tafsir', { en: 'Tafsir', ar: 'تفسير' })).toEqual({ en: 'Tafsir', ar: 'تفسير' });
  });
  it('puts an older name in the language it is written in', () => {
    expect(pairOf('Tafsir', undefined)).toEqual({ en: 'Tafsir', ar: '' });
    expect(pairOf('تفسير', undefined)).toEqual({ en: '', ar: 'تفسير' });
    expect(pairOf('Old Cities | مدن عتيقة', undefined)).toEqual({ en: 'Old Cities', ar: 'مدن عتيقة' });
    expect(pairOf(undefined, undefined)).toEqual({ en: '', ar: '' });
  });
});

describe('pairPayload', () => {
  it('base is English, else Arabic; empty languages are left out', () => {
    expect(pairPayload({ en: ' Tafsir ', ar: 'تفسير' })).toEqual({ base: 'Tafsir', localized: { en: 'Tafsir', ar: 'تفسير' } });
    expect(pairPayload({ en: '', ar: 'تفسير' })).toEqual({ base: 'تفسير', localized: { ar: 'تفسير' } });
    expect(pairPayload({ en: ' ', ar: '' })).toEqual({ base: '', localized: {} });
  });
});
