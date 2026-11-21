/**
 * Home rails (wiki E07 "Discovery ranking"): the response check, the heading a rail gets from what it
 * is showing right now (cold start: Trending reads "New this week"), and where "See all" goes.
 */
import { EN_TRANSLATIONS, AR_TRANSLATIONS } from '@al-ummah/shared-types';
import { homeRailHeading, homeRailHref, parseHomeRails, type HomeRail } from '../home-rails';

const video = (id: string) => ({ id, title: id, channelId: 'c', dateCreated: '2026-11-20T00:00:00Z', views: 0 }) as never;
const rail = (over: Partial<HomeRail>): HomeRail => ({
  key: 'trending',
  rail: 'trending:week',
  info: { mode: 'new', label: 'new_this_week', signalItems: 0, computedAt: '2026-11-21T12:00:00Z' },
  data: [video('a')],
  ...over,
});

describe('parseHomeRails', () => {
  it('keeps well-formed rails and drops malformed or empty ones', () => {
    const body = {
      success: true,
      data: {
        rails: [rail({}), { key: 'nope', data: [video('b')], info: { label: 'new' } }, rail({ key: 'popular', data: [] }), { key: 'new', data: [video('c')] }, null],
      },
    };
    expect(parseHomeRails(body).map((r) => r.key)).toEqual(['trending']);
  });

  it('answers an empty list for anything that is not a rails response', () => {
    expect(parseHomeRails(null)).toEqual([]);
    expect(parseHomeRails({ data: {} })).toEqual([]);
    expect(parseHomeRails({ data: { rails: 'x' } })).toEqual([]);
  });
});

describe('homeRailHeading', () => {
  it('with no viewer signal the Trending rail is headed "New this week", never "Trending"', () => {
    expect(homeRailHeading(rail({}), EN_TRANSLATIONS.rails, 'en')).toBe('New this week');
    expect(homeRailHeading(rail({}), AR_TRANSLATIONS.rails, 'ar')).toBe('جديد هذا الأسبوع');
  });

  it('with enough viewers it is headed Trending', () => {
    const live = rail({ info: { mode: 'trending', label: 'trending_this_week', signalItems: 9, computedAt: '' } });
    expect(homeRailHeading(live, EN_TRANSLATIONS.rails, 'en')).toBe('Trending this week');
  });

  it("a category rail is headed with the category's name in the page language", () => {
    const top = rail({ key: 'categories', rail: 'top', category: 'fiqh', categoryLabel: { en: 'Fiqh', ar: 'الفقه' }, info: { mode: 'top', label: 'top', signalItems: 0, computedAt: '' } });
    expect(homeRailHeading(top, EN_TRANSLATIONS.rails, 'en')).toBe('Top in Fiqh');
    expect(homeRailHeading(top, AR_TRANSLATIONS.rails, 'ar')).toBe('الأبرز في الفقه');
    expect(homeRailHeading({ ...top, categoryLabel: undefined }, EN_TRANSLATIONS.rails, 'en')).toBeNull();
  });

  it('a label this build does not know gets no heading (the rail is not shown)', () => {
    expect(homeRailHeading(rail({ info: { mode: 'x', label: 'something_new', signalItems: 0, computedAt: '' } }), EN_TRANSLATIONS.rails, 'en')).toBeNull();
  });

  it('every label has en and ar copy, and Arabic says مرئي, never فيديو', () => {
    for (const [key, text] of Object.entries(AR_TRANSLATIONS.rails.labels)) {
      expect(text).toBeTruthy();
      expect(EN_TRANSLATIONS.rails.labels[key as keyof typeof EN_TRANSLATIONS.rails.labels]).toBeTruthy();
      expect(text).not.toMatch(/فيديو/);
    }
  });
});

describe('homeRailHref', () => {
  it('links each rail to the full list it starts', () => {
    expect(homeRailHref(rail({}), 'ar')).toBe('/ar/explore');
    expect(homeRailHref(rail({ key: 'new', rail: 'new' }), 'en')).toBe('/en/videos');
    expect(homeRailHref(rail({ key: 'featured', rail: 'featured' }), 'en')).toBe('/en/sections');
    expect(homeRailHref(rail({ key: 'popular', rail: 'popular' }), 'en')).toBe('/en/sections');
    expect(homeRailHref(rail({ key: 'categories', rail: 'top', category: 'hajj_umrah' }), 'en')).toBe('/en/search?type=video&category=hajj_umrah');
  });
});
