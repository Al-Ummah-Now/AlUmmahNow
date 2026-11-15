/**
 * Live video categories in the browser: the built-in list until the API
 * answers (and when it fails), retired categories hidden from pickers but
 * kept as the current value of an edit form, labels for retired ones.
 */
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import {
  CATEGORY_REFRESH_MS,
  categoryLabelIn,
  getCachedCategories,
  loadCategories,
  pickerCategories,
  resetCategoriesForTests,
  subscribeCategories,
} from '@/lib/api/categories';
import { isKnownCategory } from '@/lib/category-suggestion/form';

jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const live = {
  success: true,
  result: {
    categories: [
      { value: 'seerah_for_kids', label: { en: 'Seerah for kids', ar: 'السيرة للأطفال' }, position: 5, retired: false },
      { value: 'fiqh', label: { en: 'Fiqh', ar: 'الفقه' }, position: 50, retired: false },
      { value: 'islamic_news', label: { en: 'Islamic News', ar: 'أخبار إسلامية' }, position: 120, retired: true },
    ],
  },
};
const ok = (body: unknown) => jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

afterEach(() => resetCategoriesForTests());

describe('video categories (web)', () => {
  it('starts with the built-in list', () => {
    expect(getCachedCategories().map((c) => c.value)).toEqual(VIDEO_CATEGORIES.map((c) => c.value));
  });

  it('reads the live list once a minute and tells subscribers', async () => {
    const fetchImpl = ok(live);
    const seen: string[][] = [];
    subscribeCategories((list) => seen.push(list.map((c) => c.value)));
    await loadCategories(1_000, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/api/categories');
    expect(seen).toEqual([['seerah_for_kids', 'fiqh', 'islamic_news']]);
    await loadCategories(1_000 + CATEGORY_REFRESH_MS - 1, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await loadCategories(1_000 + CATEGORY_REFRESH_MS, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the current list when the API fails or answers nonsense', async () => {
    await loadCategories(1_000, jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(getCachedCategories().length).toBe(VIDEO_CATEGORIES.length);
    await loadCategories(1_000 + CATEGORY_REFRESH_MS, ok({ success: true, result: { categories: 'x' } }));
    expect(getCachedCategories().length).toBe(VIDEO_CATEGORIES.length);
  });

  it('pickers show active categories; a retired current value stays selectable; labels cover retired ones', async () => {
    await loadCategories(1_000, ok(live));
    const all = getCachedCategories();
    expect(pickerCategories(all).map((c) => c.value)).toEqual(['seerah_for_kids', 'fiqh']);
    expect(pickerCategories(all, 'islamic_news').map((c) => c.value)).toEqual(['seerah_for_kids', 'fiqh', 'islamic_news']);
    expect(pickerCategories(all, 'fiqh').map((c) => c.value)).toEqual(['seerah_for_kids', 'fiqh']);
    expect(categoryLabelIn(all, 'islamic_news', 'ar')).toBe('أخبار إسلامية');
    expect(categoryLabelIn(all, 'made_up', 'en')).toBeNull();
  });

  it('AI suggestions only offer available categories of the live list', async () => {
    await loadCategories(1_000, ok(live));
    expect(isKnownCategory('seerah_for_kids')).toBe(true);
    expect(isKnownCategory('islamic_news')).toBe(false);
    expect(isKnownCategory('aqeedah')).toBe(false);
  });
});
