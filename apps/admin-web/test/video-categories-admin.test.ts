/**
 * Videos admin › Categories: every string in English and Arabic (Arabic text in
 * ar, every action and error code the API returns labelled), and labels come
 * from the live list with the built-in list as the fallback.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { categoryLabel } from '../src/lib/category-label';
import { NAV_ITEMS } from '../src/components/shell/nav-model';

const ARABIC = /[؀-ۿ]/;

function leaves(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v as Record<string, unknown>, `${prefix}${k}.`)));
}

describe('Categories admin page', () => {
  it('en and ar define the same keys, with Arabic text in ar', () => {
    const enLeaves = leaves(en.videoCategories as never);
    const arLeaves = new Map(leaves(ar.videoCategories as never));
    assert.deepEqual([...arLeaves.keys()].sort(), enLeaves.map(([k]) => k).sort());
    for (const [key, value] of arLeaves) assert.ok(ARABIC.test(value), `ar videoCategories.${key}`);
    assert.ok(ARABIC.test(ar.nav.categories));
  });

  it('labels every history action and field error the API returns', () => {
    for (const a of ['create', 'update', 'retire', 'restore', 'reorder']) assert.ok((en.videoCategories.actions as Record<string, string>)[a], a);
    for (const f of ['required', 'too_long', 'invalid', 'invalid_slug', 'exists']) assert.ok((en.videoCategories.fieldErrors as Record<string, string>)[f], f);
  });

  it('is in the Content group of the navigation', () => {
    const item = NAV_ITEMS.find((i) => i.href === '/categories');
    assert.equal(item?.group, 'content');
  });

  it('labels come from the live list (renamed and admin-made ones), then the built-in list, then the value', () => {
    const live = [
      { value: 'fiqh', label: { en: 'Jurisprudence', ar: 'أحكام الفقه' } },
      { value: 'seerah_kids', label: { en: 'Seerah for kids', ar: 'السيرة للأطفال' }, retired: true },
    ];
    assert.equal(categoryLabel('fiqh', 'en', live), 'Jurisprudence');
    assert.equal(categoryLabel('seerah_kids', 'ar', live), 'السيرة للأطفال');
    assert.equal(categoryLabel('ramadan', 'en', live), 'Ramadan');
    assert.equal(categoryLabel('made_up', 'en', live), 'made_up');
    assert.equal(categoryLabel(null, 'en', live), null);
  });
});
