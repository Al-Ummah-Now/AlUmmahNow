/**
 * AI category suggestions in the upload/edit forms: a confident suggestion is
 * preselected (marked as AI), a low-confidence one offers options instead, and
 * a category a person chose is never changed. Explore hides empty categories.
 */
import { VideoCategory } from '@al-ummah/shared-types';
import { applySuggestion, formText, newDraftKey, pickCategory, suggestionOptions, type CategorySuggestionView } from '@/lib/category-suggestion/form';
import { visibleCategories } from '@/components/explore/ExploreSections';

const done = (extra: Partial<CategorySuggestionView>): CategorySuggestionView => ({
  status: 'done', preselect: null, lowConfidence: false, category: null, confidence: null, options: [], model: 'm', outcome: 'pending', ...extra,
});
const confident = done({ preselect: 'fiqh', category: 'fiqh', confidence: 0.9, options: [{ category: 'fiqh', confidence: 0.9 }] });
const unsure = done({ lowConfidence: true, category: 'dawah', confidence: 0.4, options: [{ category: 'dawah', confidence: 0.4 }, { category: 'aqeedah', confidence: 0.3 }, { category: 'nonsense', confidence: 0.2 }, { category: 'fiqh', confidence: 0.1 }] });
const empty = { aiApplied: false, touched: false };

describe('applySuggestion', () => {
  it('preselects a confident suggestion as the AI\'s', () => {
    expect(applySuggestion(empty, confident)).toEqual({ category: VideoCategory.FIQH, aiApplied: true, touched: false });
  });

  it('does not preselect a low-confidence suggestion and clears a stale AI preselection', () => {
    expect(applySuggestion(empty, unsure)).toBe(empty);
    expect(applySuggestion({ category: VideoCategory.FIQH, aiApplied: true, touched: false }, unsure)).toEqual({ category: undefined, aiApplied: false, touched: false });
  });

  it('never changes a category a person picked, or cleared', () => {
    const picked = pickCategory(VideoCategory.RAMADAN);
    expect(applySuggestion(picked, confident)).toBe(picked);
    const cleared = pickCategory(undefined);
    expect(applySuggestion(cleared, confident)).toBe(cleared);
    expect(applySuggestion({ category: VideoCategory.RAMADAN, aiApplied: false, touched: false }, confident).category).toBe(VideoCategory.RAMADAN);
  });

  it('ignores pending, failed and missing suggestions', () => {
    expect(applySuggestion(empty, null)).toBe(empty);
    expect(applySuggestion(empty, { ...confident, status: 'pending' })).toBe(empty);
    expect(applySuggestion(empty, { ...confident, status: 'budget' })).toBe(empty);
  });

  it('follows a newer confident suggestion while the AI value is unconfirmed', () => {
    const first = applySuggestion(empty, confident);
    expect(applySuggestion(first, done({ preselect: 'ramadan' })).category).toBe(VideoCategory.RAMADAN);
  });
});

describe('suggestion options and form text', () => {
  it('offers up to 3 known categories, best first', () => {
    expect(suggestionOptions(unsure).map((o) => o.category)).toEqual(['dawah', 'aqeedah', 'fiqh']);
    expect(suggestionOptions({ ...unsure, status: 'failed' })).toEqual([]);
  });

  it('builds the Arabic and English text the AI reads; nothing to read is null', () => {
    expect(formText({ titleEn: '', titleAr: '  شرح الأربعين النووية ', descriptionEn: 'Lesson 1', tags: [' حديث ', ''] })).toEqual({
      title: 'شرح الأربعين النووية',
      titleLocalized: { ar: 'شرح الأربعين النووية' },
      description: 'Lesson 1',
      descriptionLocalized: { en: 'Lesson 1' },
      tags: ['حديث'],
    });
    expect(formText({ titleEn: ' ', tags: [] })).toBeNull();
  });

  it('draft keys match the API format', () => {
    expect(newDraftKey('upload')).toMatch(/^upload-[A-Za-z0-9_-]{8,73}$/);
    expect(newDraftKey('edit')).not.toBe(newDraftKey('edit'));
  });
});

describe('Explore categories', () => {
  it('hides categories without videos', () => {
    const tile = (value: string, count: number) => ({ value, count, label: { en: value, ar: value } });
    expect(visibleCategories([tile('fiqh', 2), tile('ramadan', 0), tile('dawah', 1)] as never).map((c) => c.value)).toEqual(['fiqh', 'dawah']);
  });
});
