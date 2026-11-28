import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardDesignSchema, cardDimensions, cardDocument } from '../src/lib/cards/design';

const fonts = { amiri: 'YQ==', sourceSerif: 'Yg==' };

test('the card renderer accepts only the supported palettes and formats', () => {
  assert.deepEqual(cardDimensions('square'), { width: 1080, height: 1080 });
  assert.deepEqual(cardDimensions('portrait'), { width: 1080, height: 1350 });
  assert.equal(cardDesignSchema.safeParse({ template: 'folio', palette: 2, format: 'square' }).success, false);
  assert.equal(cardDesignSchema.safeParse({ template: 'folio', palette: 1, format: 'square', background: 'https://example.org/a.png' }).success, false);
});

test('render markup retains source and escapes the entire literal passage', () => {
  const html = cardDocument({
    text: 'نص  <script>alert(1)</script> & "text"',
    citation: 'سورة البقرة · الآية ٢٨٢',
    credit: 'المصدر: مؤسسة القرآن',
  }, { template: 'fawanees', palette: 0, format: 'portrait' }, 'ar', fonts);
  assert.match(html, /<html lang="ar" dir="rtl">/u);
  assert.match(html, /نص  &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;text&quot;/u);
  assert.match(html, /سورة البقرة · الآية ٢٨٢/u);
  assert.match(html, /المصدر: مؤسسة القرآن/u);
  assert.doesNotMatch(html, /<script>alert\(1\)/u);
});
