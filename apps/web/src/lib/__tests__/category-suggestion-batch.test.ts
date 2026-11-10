/**
 * Batch uploader categories: rows start from the batch default, the AI fills
 * rows left empty (read only, never re-requested), a row picked by hand keeps
 * its category, and a new default reaches only rows nobody picked.
 */
import { VideoCategory } from '@al-ummah/shared-types';
import { MAX_ROW_POLLS, applyBatchDefault, newBatchRow, pickRow, waitsForSuggestion, withSuggestion } from '@/lib/category-suggestion/batch';
import type { CategorySuggestionView } from '@/lib/category-suggestion/form';

const view = (extra: Partial<CategorySuggestionView>): CategorySuggestionView => ({
  status: 'done', preselect: null, lowConfidence: false, category: null, confidence: null, options: [], model: 'm', outcome: 'pending', ...extra,
});
const confident = view({ preselect: 'fiqh', category: 'fiqh', confidence: 0.95, options: [{ category: 'fiqh', confidence: 0.95 }] });
const unsure = view({ lowConfidence: true, category: 'dawah', confidence: 0.3, options: [{ category: 'dawah', confidence: 0.3 }, { category: 'aqeedah', confidence: 0.2 }] });

describe('batch rows', () => {
  it('a row starts from the batch default and does not wait for the AI', () => {
    const row = newBatchRow(VideoCategory.RAMADAN);
    expect(row).toMatchObject({ category: VideoCategory.RAMADAN, fromDefault: true, touched: false });
    expect(waitsForSuggestion(row)).toBe(false);
  });

  it('a row without a default waits for the AI, which preselects a confident answer', () => {
    let row = newBatchRow(undefined);
    expect(waitsForSuggestion(row)).toBe(true);
    row = withSuggestion(row, view({ status: 'pending' }));
    expect(waitsForSuggestion(row)).toBe(true);
    row = withSuggestion(row, confident);
    expect(row).toMatchObject({ category: VideoCategory.FIQH, aiApplied: true });
    expect(waitsForSuggestion(row)).toBe(false);
  });

  it('an unsure answer preselects nothing (the row offers the options)', () => {
    const row = withSuggestion(newBatchRow(undefined), unsure);
    expect(row.category).toBeUndefined();
    expect(row.suggestion).toBe(unsure);
    expect(waitsForSuggestion(row)).toBe(false);
  });

  it('stops polling after MAX_ROW_POLLS (no answer: pick by hand)', () => {
    let row = newBatchRow(undefined);
    for (let i = 0; i < MAX_ROW_POLLS; i++) row = withSuggestion(row, null);
    expect(waitsForSuggestion(row)).toBe(false);
  });

  it('a row picked by hand is the uploader\'s: the AI and later defaults leave it alone', () => {
    const picked = pickRow(withSuggestion(newBatchRow(undefined), confident), VideoCategory.AQEEDAH);
    expect(picked).toMatchObject({ category: VideoCategory.AQEEDAH, aiApplied: false, touched: true, save: 'saving' });
    expect(withSuggestion(picked, view({ preselect: 'dawah' })).category).toBe(VideoCategory.AQEEDAH);
    expect(applyBatchDefault(picked, VideoCategory.RAMADAN)).toEqual({ row: picked, save: false });
  });

  it('a new default reaches rows nobody picked (also replacing an AI suggestion) and saves them', () => {
    const fromDefault = newBatchRow(VideoCategory.FIQH);
    const ai = withSuggestion(newBatchRow(undefined), confident);
    for (const row of [fromDefault, ai]) {
      const applied = applyBatchDefault(row, VideoCategory.RAMADAN);
      expect(applied.save).toBe(true);
      expect(applied.row).toMatchObject({ category: VideoCategory.RAMADAN, aiApplied: false, fromDefault: true });
    }
    // Same default: nothing to save; clearing the default leaves rows as they are
    expect(applyBatchDefault(newBatchRow(VideoCategory.RAMADAN), VideoCategory.RAMADAN).save).toBe(false);
    expect(applyBatchDefault(fromDefault, undefined)).toEqual({ row: fromDefault, save: false });
  });
});
