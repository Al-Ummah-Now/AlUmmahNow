import {
  getInitialEditMetadata,
  haveTagsChanged,
  normalizeTag,
  parseVideoCategory,
  parseVideoTags,
} from '../edit-metadata';

describe('edit-metadata', () => {
  describe('parseVideoTags', () => {
    it('reads an array of tags, trimming and de-duplicating', () => {
      expect(parseVideoTags([' quran ', 'tafsir', 'quran', ''])).toEqual(['quran', 'tafsir']);
    });

    it('reads a legacy comma-separated string', () => {
      expect(parseVideoTags('hadith, fiqh ,  ,hadith')).toEqual(['hadith', 'fiqh']);
    });

    it('ignores non-string values and missing tags', () => {
      expect(parseVideoTags([1, null, 'ok'])).toEqual(['ok']);
      expect(parseVideoTags(undefined)).toEqual([]);
    });
  });

  describe('parseVideoCategory', () => {
    it('accepts known categories', () => {
      expect(parseVideoCategory('quran_recitation')).toBe('quran_recitation');
    });

    it('rejects unknown or missing categories', () => {
      expect(parseVideoCategory('not_a_category')).toBe('');
      expect(parseVideoCategory(undefined)).toBe('');
    });
  });

  it('getInitialEditMetadata loads tags and category from the video', () => {
    expect(getInitialEditMetadata({ tags: ['a', 'b'], category: 'fiqh' })).toEqual({
      tags: ['a', 'b'],
      category: 'fiqh',
    });
    expect(getInitialEditMetadata({})).toEqual({ tags: [], category: '' });
  });

  it('normalizeTag collapses whitespace and caps length', () => {
    expect(normalizeTag('  islamic   history ')).toBe('islamic history');
    expect(normalizeTag('x'.repeat(80))).toHaveLength(50);
    expect(normalizeTag('   ')).toBe('');
  });

  it('haveTagsChanged detects additions, removals and reordering', () => {
    expect(haveTagsChanged(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(haveTagsChanged(['a', 'b'], ['a'])).toBe(true);
    expect(haveTagsChanged(['a', 'b'], ['b', 'a'])).toBe(true);
  });
});
