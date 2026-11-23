/**
 * The error card's body is drawn one sentence a span, so a line never ends on the next sentence's
 * first words («… الصفحة. ربما» / “… a problem. Try”).
 */
import { errorBodyHtml, errorBodySentences, errorScreenStrings } from '@al-ummah/shared-types';

test('splits at . ! ? and ؟ before a space, in both languages', () => {
  expect(errorBodySentences('We couldn’t find this page. The link may be wrong, or the page may have moved.')).toEqual(['We couldn’t find this page.', 'The link may be wrong, or the page may have moved.']);
  expect(errorBodySentences('لم نعثر على هذه الصفحة. ربما الرابط غير صحيح أو نُقلت الصفحة.')).toEqual(['لم نعثر على هذه الصفحة.', 'ربما الرابط غير صحيح أو نُقلت الصفحة.']);
  expect(errorBodySentences('هل تريد؟ جرّب مجددًا!')).toEqual(['هل تريد؟', 'جرّب مجددًا!']);
  expect(errorBodySentences('One sentence only.')).toEqual(['One sentence only.']);
});

test('keeps a no-break space and a version number whole', () => {
  expect(errorBodySentences('انتقل إلى الصفحة\u00a0الرئيسية.')).toEqual(['انتقل إلى الصفحة\u00a0الرئيسية.']);
  expect(errorBodySentences('Version 1.2 is out.')).toEqual(['Version 1.2 is out.']);
});

test('the HTML form escapes the text and joins the spans with a space', () => {
  expect(errorBodyHtml('A <b> & c. Next.')).toEqual('<span class="ep-s">A &lt;b&gt; &amp; c.</span> <span class="ep-s">Next.</span>');
});

test('every kind’s body, en and ar, splits back into the same words', () => {
  for (const locale of ['en', 'ar'] as const) {
    for (const [kind, copy] of Object.entries(errorScreenStrings(locale).kinds)) {
      const body = (copy as { body: string }).body;
      expect([locale, kind, errorBodySentences(body).join(' ')]).toEqual([locale, kind, body]);
    }
  }
});
