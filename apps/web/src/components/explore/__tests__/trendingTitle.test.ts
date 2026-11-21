/**
 * Explore's Trending heading (wiki E07 "Discovery ranking"): what the ranked list is right now. With
 * no viewer signal it reads "New this week", never "Trending"; the search fallback reads "Popular this month".
 */
import { AR_TRANSLATIONS, EN_TRANSLATIONS } from '@al-ummah/shared-types';
import { trendingTitle } from '../ExploreSections';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({}) }));

describe('trendingTitle', () => {
  it('follows the ranked label', () => {
    expect(trendingTitle(EN_TRANSLATIONS, false, 'new_this_week')).toBe('New this week');
    expect(trendingTitle(EN_TRANSLATIONS, false, 'trending_this_week')).toBe('Trending this week');
    expect(trendingTitle(AR_TRANSLATIONS, false, 'new_this_week')).toBe('جديد هذا الأسبوع');
  });

  it('falls back to Trending for an API without a label, and to Popular this month for the search fallback', () => {
    expect(trendingTitle(EN_TRANSLATIONS, false, null)).toBe('Trending');
    expect(trendingTitle(EN_TRANSLATIONS, true, 'new_this_week')).toBe('Popular this month');
  });
});
