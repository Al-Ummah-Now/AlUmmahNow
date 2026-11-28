import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardPages, paginateCardText } from '../src/lib/cards/paginate';

const design = { format: 'square', template: 'fawanees', palette: 0 } as const;

test('Quran pagination prefers whole ayat and uses only word boundaries for a long ayah', () => {
  const short = 'كَلِمَاتٌ قَلِيلَةٌ';
  const long = '  كَلِمَةٌ أُخْرَىٰ ۚ كَلِمَةٌ وَكَلِمَةٌ\n'.repeat(18);
  const pages = paginateCardText([short, long], design, true);
  assert.equal(pages[0], short + '\n');
  assert.ok(pages.length > 2);
  assert.deepEqual(Buffer.from(pages.join('')), Buffer.from(short + '\n' + long));
  for (const page of pages.slice(0, -1)) assert.match(page, /\s$/u);
});

test('quotations keep punctuation and literal whitespace, with a full citation and localized number on every slide', () => {
  const text = 'نصّ طويل، وكلمات متتابعة.  '.repeat(18);
  for (const locale of ['en', 'ar'] as const) {
    const pages = cardPages({ text, citation: 'كتاب، ج ٢، ص ٣؛ ج ٢، ص ٤', credit: 'قاف' }, design, locale);
    assert.ok(pages.length > 1);
    assert.equal(pages.map((page) => page.text).join(''), text);
    assert.match(pages[0].pageLabel ?? '', locale === 'ar' ? /^١\//u : /^1\//u);
    for (const page of pages) {
      assert.equal(page.citation, 'كتاب، ج ٢، ص ٣؛ ج ٢، ص ٤');
      assert.equal(page.credit, 'قاف');
    }
  }
});
